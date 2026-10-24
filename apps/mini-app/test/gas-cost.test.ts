import assert from 'node:assert/strict';
import test from 'node:test';
import type { Address, Hex } from 'viem';
import {
  MAX_FEE_PER_GAS_WEI,
  RouteGasCostCache,
  estimatePlannedRouteCost,
  formatNativeShortfall,
  formatRouteGasCost,
  nativeShortfallWei,
  routeGasCostKey,
} from '../src/lib/fx/gasCost';
import type { FxPublicClient, PlannedRoute } from '../src/lib/fx/types';
import { nativeFundsNotice, routeFacts } from '../src/components/review/actionReviewPresentation';

const wallet = '0x1111111111111111111111111111111111111111' as Address;
const token = '0x2222222222222222222222222222222222222222' as Address;
const actionTarget = '0x4444444444444444444444444444444444444444' as Address;

function route(withApproval = false): PlannedRoute {
  const approval = {
    chainId: 1 as const,
    from: wallet,
    to: token,
    data: '0x095ea7b300000000000000000000000033333333333333333333333333333333333333330000000000000000000000000000000000000000000000000000000000000064' as Hex,
    value: 0n,
    kind: 'approval' as const,
    operation: 'depositAndMint' as const,
  };
  const action = {
    chainId: 1 as const,
    from: wallet,
    to: actionTarget,
    data: '0x12345678' as Hex,
    value: 12n,
    kind: 'action' as const,
    operation: 'depositAndMint' as const,
  };
  return {
    operation: 'depositAndMint',
    chainId: 1,
    walletAddress: wallet,
    transactions: withApproval ? [approval, action] : [action],
  };
}

function clientFor(estimateGas: (to: Address) => Promise<bigint>, chainId: 1 | 8453 = 1): FxPublicClient {
  return {
    chain: { id: chainId },
    getChainId: async () => chainId,
    getBlockNumber: async () => 123n,
    estimateFeesPerGas: async () => ({ maxFeePerGas: 3n, maxPriorityFeePerGas: 1n }),
    estimateGas: async (args: { to: Address }) => estimateGas(args.to),
  } as unknown as FxPublicClient;
}

test('estimates every route step and separates gas from native transaction value', async () => {
  const planned = route();
  const estimate = await estimatePlannedRouteCost(planned, {
    client: clientFor(async () => 21_000n),
    now: () => 10_000,
  });
  assert.equal(estimate.status, 'current');
  assert.equal(estimate.blockNumber, undefined);
  assert.equal(estimate.estimatedGasUnits, 21_000n);
  assert.equal(estimate.executionGasFeeWei, 63_000n);
  assert.equal(estimate.nativeValueWei, 12n);
  assert.equal(estimate.totalNativeCostWei, 63_012n);
  assert.equal(estimate.requiredNativeCostWei, 75_612n, 'wallet funding check uses buffered limit at the max fee cap');
  assert.equal(estimate.steps[0].gasFeeWei, 63_000n);
});

test('route estimate uses the reviewed tier cap and does not re-read an RPC fee', async () => {
  let feeReads = 0;
  const selected = {
    tier: 'fast' as const,
    gasPriceWei: 20n,
    maxFeePerGas: 40n,
    maxPriorityFeePerGas: 5n,
    validUntil: Date.now() + 30_000,
    source: 'rpc' as const,
  };
  const client = {
    ...clientFor(async () => 21_000n),
    estimateFeesPerGas: async () => { feeReads += 1; return { maxFeePerGas: 999n, maxPriorityFeePerGas: 10n }; },
  } as FxPublicClient;
  const estimate = await estimatePlannedRouteCost(route(), {
    client,
    feeTierQuote: selected,
  });
  assert.equal(feeReads, 0);
  assert.equal(estimate.fee?.tier, 'fast');
  assert.equal(estimate.fee?.feePerGasWei, 40n);
  assert.equal(estimate.fee?.displayFeePerGasWei, 20n);
  assert.equal(estimate.executionGasFeeWei, 840_000n);
  assert.equal(estimate.requiredNativeCostWei, 1_008_012n, 'fundability uses maxFeePerGas, not the expected display rate');
  assert.match(formatRouteGasCost(estimate).gasFee ?? '', /max/);
  assert.match(formatRouteGasCost(estimate).gasTier ?? '', /^Fast · /);
});

test('route freshness never extends the selected fee quote deadline', async () => {
  const deadline = Date.now() + 1_000;
  const estimate = await estimatePlannedRouteCost(route(), {
    client: clientFor(async () => 21_000n),
    feeTierQuote: { tier: 'fast', gasPriceWei: 2n, maxFeePerGas: 3n, maxPriorityFeePerGas: 1n, validUntil: deadline },
  });
  assert.equal(estimate.status, 'current');
  assert.equal(estimate.validUntil, deadline);
});

test('exact route getOrRefresh shares prepared gas and force refresh still verifies again', async () => {
  let calls = 0;
  let clock = 1;
  const cache = new RouteGasCostCache({ now: () => clock });
  const client = clientFor(async () => { calls += 1; return 21_000n; });
  const planned = route();
  const first = await cache.getOrRefresh(planned, { client });
  assert.equal(await cache.getOrRefresh(planned, { client }), first);
  assert.equal(calls, 1);
  await cache.refresh(planned, { client });
  assert.equal(calls, 2);
  clock = 15_001;
  await cache.getOrRefresh(planned, { client });
  assert.equal(calls, 3);
});

test('does not spend an RPC request on optional block provenance before estimating gas', async () => {
  let blockReads = 0;
  const client = {
    ...clientFor(async () => 21_000n),
    getBlockNumber: async () => {
      blockReads += 1;
      return new Promise<bigint>(() => undefined);
    },
  } as FxPublicClient;
  const estimate = await estimatePlannedRouteCost(route(), { client, timeoutMs: 250 });
  assert.equal(blockReads, 0);
  assert.equal(estimate.status, 'current');
  assert.equal(estimate.estimatedGasUnits, 21_000n);
});

test('keeps approval estimate when dependent action estimation fails', async () => {
  const planned = route(true);
  const estimatedTargets: Address[] = [];
  const client = {
    ...clientFor(async (to) => {
      estimatedTargets.push(to);
      if (to.toLowerCase() === actionTarget.toLowerCase()) throw new Error('ERC20: insufficient allowance');
      return 46_000n;
    }),
    simulateCalls: async () => ({ results: [{ status: 'success', gasUsed: 46_000n }] }),
  } as unknown as FxPublicClient;
  const estimate = await estimatePlannedRouteCost(planned, {
    client,
  });
  assert.equal(estimate.status, 'partial');
  assert.equal(estimate.steps[0].status, 'estimated');
  assert.equal(estimate.steps[0].gas, 46_000n);
  assert.equal(estimate.steps[1].status, 'unavailable');
  assert.equal(estimate.estimatedGasUnits, undefined);
  assert.equal(estimate.executionGasFeeWei, undefined);
  assert.equal(estimate.totalNativeCostWei, undefined);
  assert.equal(estimate.nativeValueWei, 12n);
  assert.deepEqual(estimatedTargets.map((target) => target.toLowerCase()), [token.toLowerCase(), actionTarget.toLowerCase()]);
  assert.equal(formatRouteGasCost(estimate).gasFee, undefined, 'an approval-only subtotal must not be presented as route gas');
});

test('uses ordered simulation gas for approval routes when every call succeeds', async () => {
  const planned = route(true);
  let simulatedCalls = 0;
  let independentEstimates = 0;
  const client = {
    ...clientFor(async () => {
      independentEstimates += 1;
      throw new Error('ordered simulation should provide route gas');
    }),
    simulateCalls: async ({ calls }: { calls: readonly { to: Address }[] }) => {
      simulatedCalls = calls.length;
      return {
        results: [
          { status: 'success', gasUsed: 46_000n },
          { status: 'success', gasUsed: 180_000n },
        ],
      };
    },
  } as unknown as FxPublicClient;
  const estimate = await estimatePlannedRouteCost(planned, { client });
  assert.equal(simulatedCalls, planned.transactions.length);
  assert.equal(independentEstimates, 0);
  assert.equal(estimate.status, 'current');
  assert.deepEqual(estimate.steps.map((step) => step.gas), [46_000n, 180_000n]);
  assert.equal(estimate.estimatedGasUnits, 226_000n);
  assert.equal(estimate.executionGasFeeWei, 678_000n);
  // The max is what the wallet funds: (55,200 + 216,000) buffered gas × 3 wei.
  assert.equal(formatRouteGasCost(estimate).gasFee, '0.0008136 Gwei (max)');
});

test('route key is scoped to account, chain, calldata, value, and operation', () => {
  const first = route();
  const second = { ...first, walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address };
  assert.notEqual(routeGasCostKey(first), routeGasCostKey(second));
});

test('rejects a transaction whose sender is outside the route account scope', async () => {
  const planned = route();
  planned.transactions[0].from = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
  const estimate = await estimatePlannedRouteCost(planned, {
    client: clientFor(async () => 21_000n),
  });
  assert.equal(estimate.status, 'unavailable');
  assert.match(estimate.error ?? '', /account or chain scope/);
});

test('Base includes OP Stack fee components and counts the bridge native fee once', async () => {
  const planned: PlannedRoute = {
    ...route(),
    chainId: 8453,
    operation: 'buildBridgeTx',
    transactions: [{ ...route().transactions[0], chainId: 8453, operation: 'buildBridgeTx', value: 7n }],
    quote: { nativeFee: 7n, lzTokenFee: 3n },
  };
  const client = clientFor(async () => 10n, 8453) as FxPublicClient & {
    estimateL1Fee: NonNullable<FxPublicClient['estimateL1Fee']>;
    estimateOperatorFee: NonNullable<FxPublicClient['estimateOperatorFee']>;
  };
  client.estimateL1Fee = async () => 4n;
  client.estimateOperatorFee = async () => 5n;
  const estimate = await estimatePlannedRouteCost(planned, { client });
  assert.equal(estimate.status, 'current');
  assert.equal(estimate.nativeValueWei, 7n);
  assert.equal(estimate.layerZeroNativeFeeWei, 7n);
  assert.equal(estimate.layerZeroTokenFeeWei, 3n);
  assert.equal(estimate.executionGasFeeWei, 30n);
  assert.equal(estimate.l1DataFeeWei, 4n);
  assert.equal(estimate.operatorFeeWei, 5n);
  assert.equal(estimate.totalNativeCostWei, 46n);
  assert.equal(estimate.totalNativeCostScope, 'execution-plus-l1-plus-operator-plus-value');
  // 12 buffered gas × 3 wei + 4 wei L1 + 5 wei operator: what the wallet funds.
  assert.equal(formatRouteGasCost(estimate).gasFee, '0.000000045 Gwei (max)', 'all network components at the funded maximum, excluding the bridge native value');
  assert.equal(formatRouteGasCost(estimate).totalCost, '0.000000052 Gwei (native value + max network fee including Base L1/operator fees)');
});

test('Base stays partial when L1/operator fee accounting is unavailable', async () => {
  const planned: PlannedRoute = {
    ...route(),
    chainId: 8453,
    operation: 'buildBridgeTx',
    transactions: [{ ...route().transactions[0], chainId: 8453, operation: 'buildBridgeTx' }],
    quote: { nativeFee: 7n, lzTokenFee: 3n },
  };
  const estimate = await estimatePlannedRouteCost(planned, { client: clientFor(async () => 10n, 8453) });
  assert.equal(estimate.status, 'partial');
  assert.equal(estimate.executionGasFeeWei, 30n);
  assert.equal(estimate.totalNativeCostWei, undefined);
  assert.equal(formatRouteGasCost(estimate).gasFee, undefined, 'execution alone must not appear as the complete Base network fee');
});

test('cache follows the current browser clock after initialization', async (t) => {
  const cache = new RouteGasCostCache({ ttlMs: 1000 });
  const planned = route();
  let now = Date.now() + 31_000;
  t.mock.method(Date, 'now', () => now);
  const estimate = await cache.refresh(planned, { client: clientFor(async () => 21_000n) });
  assert.equal(estimate.fetchedAt, now);
  assert.equal(estimate.validUntil, now + 1000);
  assert.equal(cache.view(planned).current, estimate);
  now += 1001;
  assert.equal(cache.view(planned).current, undefined);
  const refreshed = await cache.refresh(planned, { client: clientFor(async () => 21_000n) });
  assert.equal(refreshed.fetchedAt, now);
  assert.equal(cache.view(planned).current, refreshed);
});

test('cache never exposes an expired estimate as current while refreshing', async () => {
  let now = 1000;
  let release: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const cache = new RouteGasCostCache({ now: () => now, ttlMs: 1000 });
  const planned = route();
  const client = clientFor(async () => {
    await delayed;
    return 21_000n;
  });
  const first = cache.refresh(planned, { client });
  assert.equal(cache.view(planned).status, 'refreshing');
  release?.();
  await first;
  assert.equal(cache.view(planned).status, 'current');
  now = 2501;
  const second = cache.refresh(planned, { client });
  const whileRefreshing = cache.view(planned);
  assert.equal(whileRefreshing.status, 'refreshing');
  assert.equal(whileRefreshing.current, undefined);
  assert.ok(whileRefreshing.previous);
  release?.();
  await second;
});

test('aborted estimates fail closed without returning a fabricated result', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    estimatePlannedRouteCost(route(), { client: clientFor(async () => 1n), signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
});

test('zero RPC gas or fee values are unavailable rather than treated as a default', async () => {
  const planned = route();
  const zeroClient = {
    ...clientFor(async () => 0n),
    estimateFeesPerGas: async () => ({ maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }),
  } as FxPublicClient;
  const estimate = await estimatePlannedRouteCost(planned, { client: zeroClient });
  assert.equal(estimate.status, 'unavailable');
  assert.equal(estimate.steps[0].status, 'unavailable');
  assert.equal(estimate.estimatedGasUnits, undefined);
  assert.equal(estimate.executionGasFeeWei, undefined);
});

test('RPC fee and gas values are bounded before cost arithmetic', async () => {
  const planned: PlannedRoute = {
    ...route(),
    chainId: 8453,
    transactions: [{ ...route().transactions[0], chainId: 8453 }],
  };
  const client = {
    ...clientFor(async () => 1_000_000_001n, 8453),
    estimateFeesPerGas: async () => ({ maxFeePerGas: MAX_FEE_PER_GAS_WEI + 1n, maxPriorityFeePerGas: 1n }),
    getGasPrice: async () => MAX_FEE_PER_GAS_WEI + 1n,
  } as FxPublicClient;
  const estimate = await estimatePlannedRouteCost(planned, { client });
  assert.equal(estimate.status, 'unavailable');
  assert.equal(estimate.steps[0].status, 'unavailable');
  assert.equal(estimate.executionGasFeeWei, undefined);
});

test('formats tiny gas costs in Gwei and labels legacy fees without max wording', () => {
  const formatted = formatRouteGasCost({
    routeKey: 'test',
    walletAddress: wallet,
    chainId: 1,
    operation: 'depositAndMint',
    status: 'current',
    fetchedAt: 1,
    validUntil: 2,
    fee: { mode: 'legacy', feePerGasWei: 1n },
    steps: [{ index: 0, kind: 'action', status: 'estimated', gas: 21_000n }],
    estimatedGasUnits: 21_000n,
    executionGasFeeWei: 21_000n,
    nativeValueWei: 0n,
    totalNativeCostWei: 21_000n,
    totalNativeCostScope: 'execution-plus-value',
  });
  assert.equal(formatted.gasFee, '0.000021 Gwei');
  assert.equal(formatted.totalCost, '0.000021 Gwei (native value + execution fee)');
});

test('clear invalidates an in-flight estimate so it cannot repopulate the cache', async () => {
  let release: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const cache = new RouteGasCostCache();
  const planned = route();
  const request = cache.refresh(planned, {
    client: clientFor(async () => {
      await delayed;
      return 21_000n;
    }),
  });
  cache.clear();
  release?.();
  await request;
  assert.equal(cache.view(planned).status, 'unavailable');
  assert.equal(cache.view(planned).current, undefined);
});

test('clear does not let an old request cleanup delete a newer request', async () => {
  let firstRelease: (() => void) | undefined;
  let secondRelease: (() => void) | undefined;
  let calls = 0;
  const cache = new RouteGasCostCache();
  const planned = route();
  const client = clientFor(async () => {
    calls += 1;
    await new Promise<void>((resolve) => {
      if (calls === 1) firstRelease = resolve;
      else secondRelease = resolve;
    });
    return 21_000n;
  });
  const old = cache.refresh(planned, { client });
  cache.clear(planned);
  const current = cache.refresh(planned, { client });
  assert.equal(cache.view(planned).status, 'refreshing');
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  firstRelease?.();
  await old;
  assert.equal(cache.view(planned).status, 'refreshing');
  secondRelease?.();
  await current;
  assert.equal(cache.view(planned).status, 'current');
});

test('clearing one route does not strand another route in-flight entry', async () => {
  const secondTarget = '0x5555555555555555555555555555555555555555' as Address;
  let releaseA: (() => void) | undefined;
  let releaseB: (() => void) | undefined;
  let bCalls = 0;
  const delayedA = new Promise<void>((resolve) => { releaseA = resolve; });
  const delayedB = new Promise<void>((resolve) => { releaseB = resolve; });
  const plannedA = route();
  const plannedB: PlannedRoute = {
    ...plannedA,
    transactions: [{ ...plannedA.transactions[0], to: secondTarget }],
  };
  const client = clientFor(async (to) => {
    if (to.toLowerCase() === actionTarget.toLowerCase()) await delayedA;
    if (to.toLowerCase() === secondTarget.toLowerCase() && bCalls++ === 0) await delayedB;
    return 21_000n;
  });
  const cache = new RouteGasCostCache();
  const requestA = cache.refresh(plannedA, { client });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const requestB = cache.refresh(plannedB, { client });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  cache.clear(plannedA);
  releaseB?.();
  await requestB;
  const secondB = cache.refresh(plannedB, { client });
  assert.notEqual(secondB, requestB);
  releaseA?.();
  await Promise.all([requestA, secondB]);
});

test('a partial estimate still flags a wallet that cannot pay the 21,000-gas floor', async () => {
  // The Telegram report: a dust wallet whose action estimate failed, leaving
  // the review on a partial fee while the wallet could never pay it.
  const client = {
    ...clientFor(async (to) => {
      if (to.toLowerCase() === actionTarget.toLowerCase()) throw new Error('execution reverted');
      return 46_000n;
    }),
    getBalance: async () => 100_000n,
  } as FxPublicClient;
  const estimate = await estimatePlannedRouteCost(route(true), { client });
  assert.equal(estimate.status, 'partial');
  assert.equal(estimate.requiredNativeCostWei, undefined);
  assert.equal(estimate.nativeBalanceWei, 100_000n);
  // 12 wei of value + 2 steps × 21,000 gas × 3 wei = 126,012 wei, above the balance.
  assert.equal(estimate.insufficientNativeBalance, true);
});

test('fundability compares the balance with the buffered route cost', async () => {
  const funded = { ...clientFor(async () => 21_000n), getBalance: async () => 75_612n } as FxPublicClient;
  const estimate = await estimatePlannedRouteCost(route(), { client: funded });
  assert.equal(estimate.requiredNativeCostWei, 75_612n);
  assert.equal(estimate.insufficientNativeBalance, false);
  const short = { ...clientFor(async () => 21_000n), getBalance: async () => 75_611n } as FxPublicClient;
  assert.equal((await estimatePlannedRouteCost(route(), { client: short })).insufficientNativeBalance, true);
});

test('the shortfall uses the same buffered basis that blocks signing, and adding it exactly unblocks', async () => {
  // 12 wei value + 21,000 gas with 20% headroom (25,200) × 3 wei max fee = 75,612 wei required.
  const balanceFor = (balance: bigint) => ({ ...clientFor(async () => 21_000n), getBalance: async () => balance } as FxPublicClient);
  const short = await estimatePlannedRouteCost(route(), { client: balanceFor(75_000n) });
  assert.equal(short.insufficientNativeBalance, true);
  assert.equal(nativeShortfallWei(short), 612n);
  const toppedUp = await estimatePlannedRouteCost(route(), { client: balanceFor(75_000n + nativeShortfallWei(short)!) });
  assert.equal(toppedUp.insufficientNativeBalance, false);
  assert.equal(nativeShortfallWei(toppedUp), undefined);
});

test('a two-step route and Base fee components are all part of the shortfall', async () => {
  // Ordered simulation gives both steps 21,000 gas: 2 × 25,200 × 3 + 12 wei value.
  const approvalRoute = {
    ...clientFor(async () => 21_000n),
    simulateCalls: async () => ({ results: [{ status: 'success', gasUsed: 21_000n }, { status: 'success', gasUsed: 21_000n }] }),
    getBalance: async () => 100_000n,
  } as unknown as FxPublicClient;
  const twoSteps = await estimatePlannedRouteCost(route(true), { client: approvalRoute });
  assert.equal(twoSteps.requiredNativeCostWei, 151_212n);
  assert.equal(nativeShortfallWei(twoSteps), 51_212n);

  // Base: 7 wei value + 12 gas limit × 3 wei + 4 wei L1 data fee + 5 wei operator fee = 52 wei.
  const planned: PlannedRoute = {
    ...route(),
    chainId: 8453,
    operation: 'buildBridgeTx',
    transactions: [{ ...route().transactions[0], chainId: 8453, operation: 'buildBridgeTx', value: 7n }],
    quote: { nativeFee: 7n, lzTokenFee: 3n },
  };
  const base = clientFor(async () => 10n, 8453) as FxPublicClient & {
    estimateL1Fee: NonNullable<FxPublicClient['estimateL1Fee']>;
    estimateOperatorFee: NonNullable<FxPublicClient['estimateOperatorFee']>;
  };
  base.estimateL1Fee = async () => 4n;
  base.estimateOperatorFee = async () => 5n;
  base.getBalance = async () => 40n;
  const baseEstimate = await estimatePlannedRouteCost(planned, { client: base });
  assert.equal(baseEstimate.requiredNativeCostWei, 52n);
  assert.equal(nativeShortfallWei(baseEstimate), 12n);
});

test('a partial estimate proves a shortfall without inventing its size', async () => {
  const client = {
    ...clientFor(async (to) => {
      if (to.toLowerCase() === actionTarget.toLowerCase()) throw new Error('execution reverted');
      return 46_000n;
    }),
    getBalance: async () => 100_000n,
  } as FxPublicClient;
  const estimate = await estimatePlannedRouteCost(route(true), { client });
  assert.equal(estimate.insufficientNativeBalance, true);
  assert.equal(nativeShortfallWei(estimate), undefined);
  assert.equal(nativeShortfallWei({ insufficientNativeBalance: false, requiredNativeCostWei: 10n, nativeBalanceWei: 1n }), undefined);
});

test('the ETH to add is rounded up, never down, to the 0.000001 ETH step reviews show', () => {
  // Tiny shortfalls name the smallest useful top-up instead of 18 decimals.
  assert.equal(formatNativeShortfall(1n), '0.000001');
  assert.equal(formatNativeShortfall(999_999_999_999n), '0.000001');
  // An exact boundary is not bumped.
  assert.equal(formatNativeShortfall(620_000_000_000_000n), '0.00062');
  assert.equal(formatNativeShortfall(1_000_000_000_000n), '0.000001');
  assert.equal(formatNativeShortfall(1_008_000_000_000_000n), '0.001008');
  // One wei over a boundary rounds up to the next shown step.
  assert.equal(formatNativeShortfall(620_000_000_000_001n), '0.000621');
  assert.equal(formatNativeShortfall(618_123_456_789_012n), '0.000619');
  assert.equal(formatNativeShortfall(999_999_999_999_999_999n), '1');
  // Large shortfalls keep the same step and group thousands.
  assert.equal(formatNativeShortfall(12_345_678_900_000_000_000n), '12.345679');
  assert.equal(formatNativeShortfall(1_234_500_000_000_000_000_000n), '1,234.5');
  for (const wei of [1n, 7n, 999_999n, 618_123_456_789_012n, 620_000_000_000_001n, 12_345_678_900_000_000_000n, 1_234_500_000_000_000_000_001n]) {
    const [whole, fraction = ''] = formatNativeShortfall(wei).replace(/,/g, '').split('.');
    const shown = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
    assert.ok(shown >= wei, `${wei} wei must never be understated`);
  }
});

/** Reads a review figure such as "≈ 0.001008 ETH max" back into wei. */
function displayedWei(text: string): bigint {
  const match = /^(?:≈ )?([\d,]+(?:\.\d+)?) (ETH|Gwei)\b/.exec(text);
  assert.ok(match, `unreadable figure: ${text}`);
  const [whole, fraction = ''] = match[1].replace(/,/g, '').split('.');
  const decimals = match[2] === 'ETH' ? 18 : 9;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
}

test('the max network fee shown is what the wallet funds, so an empty wallet is asked for exactly it', async () => {
  const gwei = 1_000_000_000n;
  const mainnetFees = { estimateFeesPerGas: async () => ({ maxFeePerGas: 30n * gwei, maxPriorityFeePerGas: gwei }) };
  const withValue = (planned: PlannedRoute, value: bigint): PlannedRoute => ({ ...planned, transactions: planned.transactions.map((transaction) => ({ ...transaction, value: transaction.kind === 'action' ? value : 0n })) });
  const base: PlannedRoute = {
    ...route(),
    chainId: 8453,
    operation: 'buildBridgeTx',
    transactions: [{ ...route().transactions[0], chainId: 8453, operation: 'buildBridgeTx', value: 0n }],
  };
  const cases: Array<{ name: string; planned: PlannedRoute; client: Record<string, unknown> }> = [
    { name: 'one Ethereum step', planned: withValue(route(), 0n), client: { ...clientFor(async () => 210_000n), ...mainnetFees } },
    {
      name: 'approval, then action',
      planned: withValue(route(true), 0n),
      client: {
        ...clientFor(async () => { throw new Error('ordered simulation supplies route gas'); }),
        ...mainnetFees,
        simulateCalls: async () => ({ results: [{ status: 'success', gasUsed: 46_123n }, { status: 'success', gasUsed: 180_457n }] }),
      },
    },
    {
      name: 'Base with L1 and operator fees',
      planned: base,
      client: {
        ...clientFor(async () => 210_000n, 8453),
        estimateFeesPerGas: async () => ({ maxFeePerGas: 10_000_000n, maxPriorityFeePerGas: 1_000_000n }),
        estimateL1Fee: async () => 123_456_789_012n,
        estimateOperatorFee: async () => 7n,
      },
    },
  ];
  for (const { name, planned, client } of cases) {
    const estimate = await estimatePlannedRouteCost(planned, { client: { ...client, getBalance: async () => 0n } as unknown as FxPublicClient });
    const feePart = estimate.requiredNativeCostWei! - estimate.nativeValueWei;
    const shown = routeFacts(planned, { estimate, estimateIsCurrent: true }).find((fact) => fact.label === 'Gas fee')!.value;
    assert.match(shown, / max$/, name);
    assert.ok(displayedWei(shown) >= feePart, `${name}: the max shown (${shown}) covers the ${feePart} wei the wallet must fund`);
    // Nothing else to send and nothing in the wallet: add exactly the max shown.
    const asked = /^Add ([\d,.]+) ETH on /.exec(nativeFundsNotice(estimate, planned.chainId === 8453 ? 'Base' : 'Ethereum'))?.[1];
    assert.equal(`${asked} ETH max`, shown.replace(/^≈ /, ''), name);
  }

  // In general the ETH to add is the value plus the max shown, less the balance, rounded up.
  const value = 300_000_000_000_000n;
  const step = 1_000_000_000_000n;
  for (const balance of [500_000_000_000_000n, 512_345_678_901_234n]) {
    const planned = withValue(route(), value);
    const estimate = await estimatePlannedRouteCost(planned, { client: { ...clientFor(async () => 210_000n), ...mainnetFees, getBalance: async () => balance } as unknown as FxPublicClient });
    const facts = routeFacts(planned, { estimate, estimateIsCurrent: true });
    const shownMax = displayedWei(facts.find((fact) => fact.label === 'Gas fee')!.value);
    const shownTotal = displayedWei(facts.find((fact) => fact.label === 'Total cost')!.value);
    assert.equal(shownTotal, value + shownMax, 'the total is the value plus the max shown');
    const asked = displayedWei(`${/^Add ([\d,.]+) ETH on /.exec(nativeFundsNotice(estimate, 'Ethereum'))![1]} ETH`);
    const expected = value + shownMax - balance;
    assert.equal(asked, ((expected + step - 1n) / step) * step);
  }
});

test('an unreadable balance never blocks the review', async () => {
  const client = {
    ...clientFor(async () => 21_000n),
    getBalance: async () => { throw new Error('balance read failed'); },
  } as FxPublicClient;
  const estimate = await estimatePlannedRouteCost(route(), { client });
  assert.equal(estimate.status, 'current');
  assert.equal(estimate.nativeBalanceWei, undefined);
  assert.equal(estimate.insufficientNativeBalance, false);
});

test('an estimate rejected for insufficient funds names the shortfall', async () => {
  const client = clientFor(async () => {
    throw new Error('insufficient funds for gas * price + value: have 790000000000 want 21000000000000');
  });
  const estimate = await estimatePlannedRouteCost(route(), { client });
  assert.equal(estimate.steps[0]?.error, 'Not enough ETH for network fees');
  assert.equal(estimate.insufficientNativeBalance, true);
});

test('cache exposes a shared in-flight refresh separately from its fresh estimate', async () => {
  const cache = new RouteGasCostCache({ now: () => 1000, ttlMs: 1000 });
  const planned = route();
  const first = await cache.refresh(planned, { client: clientFor(async () => 21_000n) });
  let release: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const pending = cache.refresh(planned, { client: clientFor(async () => { await delayed; return 22_000n; }) });
  assert.equal(cache.view(planned).current, first);
  assert.equal(cache.view(planned).status, 'current');
  assert.equal(cache.isRefreshing(planned), true);
  const joined = cache.refresh(planned, { client: clientFor(async () => { throw new Error('must share the active request'); }) });
  release?.();
  assert.equal(await joined, await pending);
  assert.equal(cache.isRefreshing(planned), false);
  assert.equal(cache.view(planned).current?.estimatedGasUnits, 22_000n);
});
