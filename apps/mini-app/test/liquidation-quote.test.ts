import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUnits } from 'viem';
import {
  LIQUIDATION_QUOTE_TTL_MS,
  projectedLiquidationPrice,
  projectedRebalancePrice,
  readLiquidationQuote,
} from '../src/lib/fx/liquidationQuote';
import { positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from '../src/lib/fx/policy';
import { ROUTE_PREFETCH_TTL_MS } from '../src/lib/fx/routePrefetch';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import type { FxPublicClient, PlannedRoute } from '../src/lib/fx/types';

const WAD = 10n ** 18n;
const READ_AT = 1_800_000_000_000;
const WALLET = '0x1111111111111111111111111111111111111111' as const;
const units = (amount: string) => parseUnits(amount, 18).toString();

function route(market: 'ETH' | 'BTC', side: 'long' | 'short', colls: string, debts: string): PlannedRoute {
  return {
    operation: 'increasePosition', chainId: 1, walletAddress: WALLET, transactions: [],
    policy: {
      chainId: 1, walletAddress: WALLET,
      reviewedAction: {
        kind: 'position-increase', positionId: 0, poolAddress: positionPoolAddress(market, side),
        positionType: side, collateralTokenAddress: positionCollateralTokenAddress(market, side),
        debtTokenAddress: positionDebtTokenAddress(market, side), inputTokenAddress: FX_TOKENS.USDC.address,
        inputAmount: 1_000_000n, nativeInput: false, requestedLeverage: 3,
      },
    },
    details: {
      colls: units(colls), debts: units(debts),
      liquidationQuote: {
        poolAddress: positionPoolAddress(market, side), liquidateRatio: units('0.95'), rebalanceRatio: units('0.88'), readAt: READ_AT,
        ...(market === 'ETH' ? { stEthPerWstEth: units('1.25') } : {}),
      },
    },
  };
}

test('all four new-position thresholds use actual quote units and the pool liquidation ratio', () => {
  const cases = [
    ['ETH', 'long', '1', '1900', '$1,600.00 / stETH'],
    ['ETH', 'short', '2500', '1', '$1,900.00 / stETH'],
    ['BTC', 'long', '0.1', '4750', '$50,000.00 / WBTC'],
    ['BTC', 'short', '10000', '0.1', '$95,000.00 / WBTC'],
  ] as const;
  for (const [market, side, colls, debts, expected] of cases) {
    const planned = route(market, side, colls, debts);
    const fact = projectedLiquidationPrice(planned, READ_AT + 1);
    assert.equal(fact?.value, expected, `${market} ${side}`);
    assert.match(fact!.title, /Earlier protocol rebalancing/);
    // The editable leverage and execution price are not accounting quantities.
    planned.details!.leverage = 7;
    planned.details!.executionPrice = '999999999';
    assert.equal(projectedLiquidationPrice(planned, READ_AT + 1)?.value, expected);
  }
});

test('ETH wrapping-rate conversion is required on both sides and the safe cent rounding follows each side', () => {
  const long = route('ETH', 'long', '1', '1900.000000000000000001');
  assert.equal(projectedLiquidationPrice(long, READ_AT)?.value, '$1,600.01 / stETH');
  const short = route('ETH', 'short', '2500', '1.000000000000000001');
  assert.equal(projectedLiquidationPrice(short, READ_AT)?.value, '$1,899.99 / stETH');
  for (const planned of [long, short]) {
    delete planned.details!.liquidationQuote!.stEthPerWstEth;
    assert.equal(projectedLiquidationPrice(planned, READ_AT), undefined);
    planned.details!.liquidationQuote!.stEthPerWstEth = units('1');
    assert.equal(projectedLiquidationPrice(planned, READ_AT), undefined);
  }
});

test('stale, future, malformed and unbound metadata cannot produce a price', () => {
  assert.equal(LIQUIDATION_QUOTE_TTL_MS, ROUTE_PREFETCH_TTL_MS);
  const planned = route('BTC', 'long', '0.1', '4750');
  assert.ok(projectedLiquidationPrice(planned, READ_AT + LIQUIDATION_QUOTE_TTL_MS - 1));
  for (const now of [READ_AT - 1, READ_AT + LIQUIDATION_QUOTE_TTL_MS, Number.NaN]) {
    assert.equal(projectedLiquidationPrice(planned, now), undefined);
  }
  for (const invalid of ['0', '-1', '1.5', '1e18', '9'.repeat(79)]) {
    assert.equal(projectedLiquidationPrice({ ...planned, details: { ...planned.details, debts: invalid } }, READ_AT), undefined);
    assert.equal(projectedLiquidationPrice({ ...planned, details: { ...planned.details, colls: invalid } }, READ_AT), undefined);
  }
  for (const invalid of ['0', '-1', (1n << 60n).toString(), 'oops']) {
    assert.equal(projectedLiquidationPrice({ ...planned, details: { ...planned.details,
      liquidationQuote: { ...planned.details!.liquidationQuote!, liquidateRatio: invalid } } }, READ_AT), undefined);
  }
  assert.equal(projectedLiquidationPrice({ ...planned, chainId: 8453 }, READ_AT), undefined);
  assert.equal(projectedLiquidationPrice({ ...planned, operation: 'adjustPositionLeverage' }, READ_AT), undefined);
  assert.equal(projectedLiquidationPrice({ ...planned, policy: undefined }, READ_AT), undefined);
  const intent = planned.policy!.reviewedAction!;
  assert.equal(intent.kind, 'position-increase');
  if (intent.kind !== 'position-increase') throw new Error('Fixture must open a position');
  assert.equal(projectedLiquidationPrice({ ...planned, policy: { ...planned.policy!, reviewedAction: { ...intent, positionId: 1 } } }, READ_AT), undefined);
  const mixedPool = structuredClone(planned);
  mixedPool.details!.liquidationQuote!.poolAddress = positionPoolAddress('BTC', 'short');
  assert.equal(projectedLiquidationPrice(mixedPool, READ_AT), undefined);
  const mixedToken = structuredClone(planned);
  if (mixedToken.policy!.reviewedAction!.kind === 'position-increase') mixedToken.policy!.reviewedAction!.debtTokenAddress = FX_TOKENS.WBTC.address;
  assert.equal(projectedLiquidationPrice(mixedToken, READ_AT), undefined);
});

test('ratio bounds follow the actual 60-bit pool encoding, rather than a presumed 100% ceiling', () => {
  const planned = route('BTC', 'short', '10000', '0.1');
  planned.details!.liquidationQuote!.liquidateRatio = units('1.01');
  assert.equal(projectedLiquidationPrice(planned, READ_AT)?.value, '$101,000.00 / WBTC');
});

type ReadClient = Pick<FxPublicClient, 'readContract'>;
function client(reply: (name: string, address: string) => unknown): ReadClient {
  return { readContract: async ({ functionName, address }) => reply(functionName, address ?? '') } as ReadClient;
}

test('the bounded read uses separate live liquidation and rebalance tuples and reuses the ETH long rate', async () => {
  const calls: string[] = [];
  const fake = client((name, address) => {
    calls.push(`${name}:${address}`);
    if (name === 'getLiquidateRatios') return [95n * WAD / 100n, 40_000_000n];
    if (name === 'getRebalanceRatios') return [88n * WAD / 100n, 25_000_000n];
    if (name === 'stEthPerToken') return 125n * WAD / 100n;
    throw new Error(`Unexpected read ${name}`);
  });
  const short = await readLiquidationQuote({ market: 'ETH', side: 'short', client: fake, now: () => READ_AT });
  assert.deepEqual(short, { poolAddress: positionPoolAddress('ETH', 'short'), liquidateRatio: units('0.95'), rebalanceRatio: units('0.88'), stEthPerWstEth: units('1.25'), readAt: READ_AT });
  assert.equal(calls.length, 3);
  assert.equal(calls.some((name) => name.startsWith('getRebalanceRatios')), true);
  calls.length = 0;
  await readLiquidationQuote({ market: 'ETH', side: 'long', client: fake, rate: Promise.resolve(units('1.25')), now: () => READ_AT });
  assert.deepEqual(calls, [`getLiquidateRatios:${positionPoolAddress('ETH', 'long')}`, `getRebalanceRatios:${positionPoolAddress('ETH', 'long')}`]);
  calls.length = 0;
  const btc = await readLiquidationQuote({ market: 'BTC', side: 'long', client: fake, now: () => READ_AT });
  assert.equal(btc?.stEthPerWstEth, undefined);
  assert.equal(calls.length, 2);
});

test('failed, incomplete, invalid and timed-out live reads leave the preview unavailable', async () => {
  const options = { market: 'BTC' as const, side: 'long' as const, now: () => READ_AT };
  for (const reply of [undefined, [0n, 0n], [1n << 60n, 0n], [WAD], ['95', 0n], [WAD, -1n], [WAD, 1n << 30n]]) {
    assert.equal(await readLiquidationQuote({ ...options, client: client(() => reply) }), undefined);
  }
  assert.equal(await readLiquidationQuote({ ...options, client: client(() => { throw new Error('RPC failed'); }) }), undefined);
  const hang = { readContract: () => new Promise(() => undefined) } as ReadClient;
  assert.equal(await readLiquidationQuote({ ...options, client: hang, deadlineMs: 5 }), undefined);
  assert.equal(await readLiquidationQuote({ market: 'ETH', side: 'short', client: client(() => [WAD, 0n]) }), undefined);
});


test('rebalance estimates use their own earlier threshold for all four pool directions', () => {
  const cases = [
    ['ETH', 'long', '1', '1900', '$1,727.28 / stETH'],
    ['ETH', 'short', '2500', '1', '$1,760.00 / stETH'],
    ['BTC', 'long', '0.1', '4750', '$53,977.28 / WBTC'],
    ['BTC', 'short', '10000', '0.1', '$88,000.00 / WBTC'],
  ] as const;
  for (const [market, side, colls, debts, expected] of cases) {
    const planned = route(market, side, colls, debts);
    assert.equal(projectedRebalancePrice(planned, READ_AT)?.value, expected);
    assert.match(projectedRebalancePrice(planned, READ_AT)!.title, /live pool rebalance ratio/);
    assert.equal(projectedRebalancePrice(planned, READ_AT + LIQUIDATION_QUOTE_TTL_MS), undefined);
    for (const invalid of [undefined, '0', units('0.95'), units('0.96'), 'bad']) {
      planned.details!.liquidationQuote!.rebalanceRatio = invalid;
      assert.equal(projectedRebalancePrice(planned, READ_AT), undefined);
      assert.ok(projectedLiquidationPrice(planned, READ_AT), 'a missing rebalance estimate must not replace liquidation');
    }
  }
});

test('missing or invalid rebalance reads preserve a valid liquidation quote without inventing a threshold', async () => {
  for (const rebalance of [undefined, [0n, 0n], [95n * WAD / 100n, 0n], [88n * WAD / 100n, 1n << 30n]]) {
    const quote = await readLiquidationQuote({ market: 'BTC', side: 'long', now: () => READ_AT,
      client: client(name => name === 'getLiquidateRatios' ? [95n * WAD / 100n, 0n] : rebalance) });
    assert.equal(quote?.liquidateRatio, units('0.95'));
    assert.equal(quote?.rebalanceRatio, undefined);
  }
});

test('new Borrow thresholds use pool-accounted collateral once, and require its validated fee schedule', () => {
  const planned = route('ETH', 'long', '1.25', '1900');
  const mintRouter = '0xB753366082466c4B5984312f0c4Bb97554be067E' as const;
  planned.operation = 'depositAndMint';
  planned.transactions = [{ kind: 'action', operation: 'depositAndMint', chainId: 1, from: WALLET, to: mintRouter, data: '0x216d5108', value: 0n }];
  planned.policy!.reviewedAction = { kind: 'deposit-and-mint', positionId: 0, poolAddress: positionPoolAddress('ETH', 'long'),
    depositTokenAddress: FX_TOKENS.wstETH.address, depositAmount: WAD, nativeInput: false, mintAmount: 1900n * WAD };
  planned.details!.protocolFeeQuote = { poolAddress: positionPoolAddress('ETH', 'long'), routerAddress: mintRouter, ratios: ['0', '0', '5000000', '0'] };
  assert.equal(projectedLiquidationPrice(planned, READ_AT)?.value, '$1,600.00 / stETH', 'Borrow collateral is already stETH');
  assert.equal(projectedRebalancePrice(planned, READ_AT)?.value, '$1,727.28 / stETH');
  planned.details!.protocolFeeQuote!.ratios = ['1000', '0', '5000000', '0'];
  assert.equal(projectedLiquidationPrice(planned, READ_AT), undefined, 'SDK collateral excludes a nonzero supply fee');
  planned.details!.protocolFeeQuote = undefined;
  assert.equal(projectedLiquidationPrice(planned, READ_AT), undefined);
});
