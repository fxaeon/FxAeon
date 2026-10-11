import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CallExecutionError,
  encodeFunctionData,
  parseAbi,
  RawContractError,
  type Address,
  type Hex,
} from "viem";
import { clearPendingHashJournalForTests, readPendingHashJournal, readPendingHashes } from "../src/lib/fx/journal";
import { runTransactionRoute, simulatePlannedRoute, waitForReceipt } from "../src/lib/fx/runner";
import { capabilityPolicy } from "../src/lib/fx/policy";
import { FX_TOKENS } from "../src/lib/fx/tokens";
import { classifyActivity } from "../src/lib/activityClassification";
import type { GasFeeSelection, GasTierQuotes } from "../src/lib/fx/gasFeePolicy";
import type { FxPublicClient, PlannedRoute, PlannedTransaction, TransactionPolicy } from "../src/lib/fx/types";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const DESTINATION = "0x2222222222222222222222222222222222222222" as Address;
const HASH_1 = `0x${"1".repeat(64)}` as Hex;
const HASH_2 = `0x${"2".repeat(64)}` as Hex;
const BLOCK_HASH_1 = `0x${"a".repeat(64)}` as Hex;
const BLOCK_HASH_2 = `0x${"b".repeat(64)}` as Hex;
const BRIDGE_ABI = parseAbi([
  "function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),(uint256 nativeFee,uint256 lzTokenFee),address refundAddress)",
]);
const TEST_POLICY: TransactionPolicy = {
  walletAddress: WALLET,
  chainId: 1,
  allowedDestinations: [DESTINATION],
  allowedSelectors: { [DESTINATION.toLowerCase()]: ["0x12345678"] },
};

test("receipt waiting always makes the immediate RPC probe at a zero deadline", async () => {
  let calls = 0;
  const receipt = await waitForReceipt({
    client: {
      getTransactionReceipt: async ({ hash }) => {
        calls += 1;
        return { transactionHash: hash, status: "success", blockNumber: 1n } as never;
      },
    },
    hash: HASH_1,
    timeoutMs: 0,
    pollMs: 0,
  });

  assert.equal(calls, 1);
  assert.equal(receipt.transactionHash, HASH_1);
});

function route(count = 2, operation: PlannedRoute["operation"] = "increasePosition"): PlannedRoute {
  return {
    operation,
    chainId: 1,
    walletAddress: WALLET,
    transactions: Array.from({ length: count }, (_, index): PlannedTransaction => ({
      chainId: 1,
      from: WALLET,
      to: DESTINATION,
      data: "0x12345678",
      value: 0n,
      nonce: 4 + index,
      kind: "action",
      operation,
    })),
  };
}

function bridgeData(): Hex {
  return encodeFunctionData({
    abi: BRIDGE_ABI,
    functionName: "send",
    args: [{
      dstEid: 30184,
      to: `0x${WALLET.slice(2).padStart(64, "0")}` as Hex,
      amountLD: 1_000_000_000_000_000_000n,
      minAmountLD: 1_000_000_000_000_000_000n,
      extraOptions: "0x",
      composeMsg: "0x",
      oftCmd: "0x",
    }, { nativeFee: 0n, lzTokenFee: 0n }, WALLET],
  }) as Hex;
}

function client(params: {
  pendingNonces: number[];
  receipts: Array<{ status: "success" | "reverted"; blockNumber: bigint; blockHash?: Hex }>;
  blocks: bigint[];
  remoteChainId?: number;
}): FxPublicClient {
  let nonceIndex = 0;
  let receiptIndex = 0;
  let blockIndex = 0;
  return {
    chain: { id: 1 },
    getChainId: async () => params.remoteChainId ?? 1,
    simulateCalls: async () => ({ results: [] }),
    getTransactionCount: async () => params.pendingNonces[Math.min(nonceIndex++, params.pendingNonces.length - 1)],
    getTransactionReceipt: async () => {
      const index = receiptIndex++;
      const transactionIndex = Math.min(Math.floor(index / 4), params.receipts.length - 1);
      const receipt = params.receipts[transactionIndex];
      return {
        ...receipt,
        blockHash: receipt.blockHash ?? (transactionIndex === 0 ? BLOCK_HASH_1 : BLOCK_HASH_2),
        transactionHash: transactionIndex === 0 ? HASH_1 : HASH_2,
        from: WALLET,
        to: DESTINATION,
      };
    },
    getTransaction: async ({ hash }: { hash: Hex }) => ({
      hash,
      from: WALLET,
      to: DESTINATION,
      input: "0x12345678",
      value: 0n,
      nonce: 4 + Math.min(Math.max(receiptIndex - 1, 0), 1),
    }),
    getBlockNumber: async () => params.blocks[Math.min(blockIndex++, params.blocks.length - 1)],
  } as unknown as FxPublicClient;
}

function callbacks(signatures: Hex[], onRequest?: (index: number) => Promise<Hex>) {
  const requested: Array<{ nonce: number; to: Address }> = [];
  let index = 0;
  return {
    requested,
    requestSignature: async (request: { nonce: number; to: Address }) => {
      requested.push(request);
      if (onRequest) return onRequest(index++);
      return signatures[index++];
    },
  };
}

function approvalActionFixture() {
  const token = '0x3333333333333333333333333333333333333333' as Address;
  const planned = route(2);
  const approvalData = encodeFunctionData({
    abi: parseAbi(['function approve(address spender,uint256 amount)']),
    functionName: 'approve',
    args: [DESTINATION, 100n],
  });
  planned.transactions[0] = { ...planned.transactions[0]!, to: token, data: approvalData, nonce: 4, kind: 'approval', type: 'approveToken' };
  planned.transactions[1] = { ...planned.transactions[1]!, nonce: 5 };
  const policy: TransactionPolicy = {
    walletAddress: WALLET,
    chainId: 1,
    allowedDestinations: [DESTINATION, token],
    allowedSelectors: { [DESTINATION.toLowerCase()]: ['0x12345678'], [token.toLowerCase()]: ['0x095ea7b3'] },
    allowedApprovalDestinations: [token],
    allowedApprovalSpenders: [DESTINATION],
    allowedTokenApprovalDestinations: [token],
    allowActionBoundTokenApproval: true,
  };
  const snapshot = (now: number, standard: GasTierQuotes['tiers']['standard']): GasTierQuotes => ({
    chainId: 1, fetchedAt: now, validUntil: now + 30_000, source: 'rpc', baseFeePerGasWei: 100n,
    tiers: {
      standard,
      fast: { tier: 'fast', gasPriceWei: 140n, maxFeePerGas: 240n, maxPriorityFeePerGas: 40n, source: 'rpc' },
      rapid: { tier: 'rapid', gasPriceWei: 180n, maxFeePerGas: 280n, maxPriorityFeePerGas: 80n, source: 'rpc' },
    },
  });
  const feeSelection = (now: number): GasFeeSelection => ({
    tier: 'standard',
    snapshot: snapshot(now, { tier: 'standard', gasPriceWei: 120n, maxFeePerGas: 220n, maxPriorityFeePerGas: 20n, source: 'rpc' }),
  });
  const fresh = (now: number, standard: GasTierQuotes['tiers']['standard']): GasTierQuotes => snapshot(now, standard);
  const hashes = [HASH_1, HASH_2];
  return { token, planned, policy, feeSelection, fresh, hashes };
}

function feeTestClient(params: {
  transactions: PlannedTransaction[];
  hashes: Hex[];
  estimateGas?: FxPublicClient['estimateGas'];
  onReceipt?: (hash: Hex) => void;
}): FxPublicClient {
  let nonceRead = 0;
  return {
    chain: { id: 1 },
    getChainId: async () => 1,
    simulateCalls: async () => ({ results: [] }),
    getTransactionCount: async () => 4 + nonceRead++,
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      params.onReceipt?.(hash);
      const index = params.hashes.indexOf(hash);
      const tx = params.transactions[index]!;
      return {
        transactionHash: hash, status: 'success', blockNumber: 10n + BigInt(index),
        blockHash: index === 0 ? BLOCK_HASH_1 : BLOCK_HASH_2,
        from: WALLET, to: tx.to,
      } as never;
    },
    getTransaction: async ({ hash }: { hash: Hex }) => {
      const index = params.hashes.indexOf(hash);
      const tx = params.transactions[index]!;
      return { hash, from: WALLET, to: tx.to, input: tx.data, value: tx.value, nonce: 4 + index } as never;
    },
    getBlockNumber: async () => 20n,
    estimateGas: params.estimateGas,
  } as unknown as FxPublicClient;
}

test.beforeEach(() => clearPendingHashJournalForTests());
test.afterEach(() => clearPendingHashJournalForTests());
// Node 24 exposes a native navigator.locks implementation that keeps the
// process alive after a test run. Browser tests cover Web Locks; unit tests
// exercise the deterministic in-tab fallback instead.
const nativeLocks = globalThis.navigator?.locks;
test.before(() => {
  if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "locks", { value: undefined, configurable: true });
});
test.after(() => {
  if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "locks", { value: nativeLocks, configurable: true });
});

for (const directBasePool of [true, false]) {
  test(`runner journals ${directBasePool ? 'direct' : 'queued'} fxSAVE redemption with the matching History action`, async () => {
    const vault = FX_TOKENS.fxSAVE.address;
    const amount = 7n;
    const abi = parseAbi(['function redeem(uint256 shares,address receiver,address owner)', 'function requestRedeem(uint256 shares)']);
    const data = directBasePool
      ? encodeFunctionData({ abi, functionName: 'redeem', args: [amount, WALLET, WALLET] })
      : encodeFunctionData({ abi, functionName: 'requestRedeem', args: [amount] });
    const planned = route(1, 'withdrawFxSave');
    planned.transactions[0] = { ...planned.transactions[0]!, to: vault, data };
    planned.policy = capabilityPolicy({
      walletAddress: WALLET, chainId: 1, operation: 'withdrawFxSave',
      reviewedAction: {
        kind: 'fxsave-withdraw', amount, receiver: WALLET, instant: false, directBasePool,
        tokenOutAddress: directBasePool ? FX_TOKENS.fxUSDBasePool.address : FX_TOKENS.fxUSD.address,
      },
    });
    const baseClient = client({ pendingNonces: [4], receipts: [{ status: 'success', blockNumber: 10n }], blocks: [10n] });
    const result = await runTransactionRoute({
      route: planned,
      publicClient: {
        ...baseClient,
        getTransactionReceipt: async (args) => ({ ...await baseClient.getTransactionReceipt(args), to: vault }),
        getTransaction: async (args) => ({ ...await baseClient.getTransaction(args), to: vault, input: data }),
      } as FxPublicClient,
      callbacks: { requestSignature: async () => HASH_1 },
      options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100, waitForNextBlock: false },
    });
    assert.equal(result.status, 'confirmed');
    const [record] = readPendingHashJournal();
    assert.equal(record?.intent, directBasePool ? 'Withdraw' : 'Queue withdrawal');
    assert.equal(record?.status, 'confirmed');
    // History prioritizes the journal's reviewed intent over matching calldata.
    // Exercise that real path: correct calldata alone cannot repair a bad label.
    const activity = classifyActivity({
      wallet: WALLET, chainId: 1, hash: HASH_1, timestamp: 1_000, status: 'confirmed',
      journal: record, call: { from: WALLET, to: vault, input: data }, transfers: [],
    });
    assert.equal(activity.kind, directBasePool ? 'withdraw' : 'queueWithdrawal');
    assert.equal(activity.title, directBasePool ? 'Withdrew from fxSAVE' : 'Queued fxSAVE withdrawal');
  });
}

test("runner signs SDK steps in order, waits every receipt, then performs post-read after an explicit extra block", async () => {
  const events: string[] = [];
  const seenBlocks: bigint[] = [];
  const cb = callbacks([HASH_1, HASH_2]);
  const result = await runTransactionRoute({
    route: route(2),
    policy: TEST_POLICY,
    publicClient: client({
      pendingNonces: [4, 5],
      receipts: [
        { status: "success", blockNumber: 10n },
        { status: "success", blockNumber: 12n },
      ],
      blocks: [10n, 11n, 12n, 12n, 13n, 14n],
    }),
    callbacks: {
      requestSignature: cb.requestSignature,
      ensureChain: async (chainId) => {
        events.push(`chain:${chainId}`);
      },
      onStatus: (status, detail) => events.push(`${status}:${detail ?? ""}`),
      postConfirmRead: async (_route, confirmed) => {
        events.push(`post-read:${confirmed.steps.length}`);
        seenBlocks.push(13n);
      },
    },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100, confirmations: 3, waitForNextBlock: true },
  });

  assert.equal(result.status, "confirmed");
  assert.deepEqual(cb.requested.map((request) => request.nonce), [4, 5]);
  assert.ok(events.some((event) => event.startsWith("confirmed:All route steps")));
  assert.deepEqual(seenBlocks, [13n]);
  assert.deepEqual(readPendingHashes(), []);
});

test('runner applies the frozen fee selection to both exact approval and action wallet requests', async () => {
  const token = '0x3333333333333333333333333333333333333333' as Address;
  const planned = route(2);
  const approvalData = encodeFunctionData({
    abi: parseAbi(['function approve(address spender,uint256 amount)']),
    functionName: 'approve',
    args: [DESTINATION, 100n],
  });
  planned.transactions[0] = {
    ...planned.transactions[0]!, to: token, data: approvalData,
    nonce: 4, kind: 'approval', type: 'approveToken',
  };
  planned.transactions[1] = { ...planned.transactions[1]!, nonce: 5 };
  const policy: TransactionPolicy = {
    walletAddress: WALLET,
    chainId: 1,
    allowedDestinations: [DESTINATION, token],
    allowedSelectors: { [DESTINATION.toLowerCase()]: ['0x12345678'], [token.toLowerCase()]: ['0x095ea7b3'] },
    allowedApprovalDestinations: [token],
    allowedApprovalSpenders: [DESTINATION],
    allowedTokenApprovalDestinations: [token],
    allowActionBoundTokenApproval: true,
  };
  const transactions = planned.transactions;
  const hashes = [HASH_1, HASH_2];
  let nonceRead = 0;
  const requests: Array<{ to: Address; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint }> = [];
  const rpcClient = {
    chain: { id: 1 },
    getChainId: async () => 1,
    simulateCalls: async () => ({ results: [] }),
    getTransactionCount: async () => 4 + nonceRead++,
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const index = hashes.indexOf(hash);
      const tx = transactions[index]!;
      return {
        transactionHash: hash, status: 'success', blockNumber: 10n + BigInt(index),
        blockHash: index === 0 ? BLOCK_HASH_1 : BLOCK_HASH_2,
        from: WALLET, to: tx.to,
      };
    },
    getTransaction: async ({ hash }: { hash: Hex }) => {
      const index = hashes.indexOf(hash);
      const tx = transactions[index]!;
      return { hash, from: WALLET, to: tx.to, input: tx.data, value: tx.value, nonce: 4 + index };
    },
    getBlockNumber: async () => 20n,
  } as unknown as FxPublicClient;
  const now = Date.now();
  const feeSelection: GasFeeSelection = {
    tier: 'standard',
    snapshot: {
      chainId: 1, fetchedAt: now, validUntil: now + 60_000, source: 'rpc', baseFeePerGasWei: 100n,
      tiers: {
        standard: { tier: 'standard', gasPriceWei: 120n, maxFeePerGas: 220n, maxPriorityFeePerGas: 20n, source: 'rpc' },
        fast: { tier: 'fast', gasPriceWei: 140n, maxFeePerGas: 240n, maxPriorityFeePerGas: 40n, source: 'rpc' },
        rapid: { tier: 'rapid', gasPriceWei: 180n, maxFeePerGas: 280n, maxPriorityFeePerGas: 80n, source: 'rpc' },
      },
    },
  };
  const result = await runTransactionRoute({
    route: planned, policy, publicClient: rpcClient, feeSelection,
    callbacks: {
      requestSignature: async (request) => {
        requests.push({ to: request.to, maxFeePerGas: request.maxFeePerGas, maxPriorityFeePerGas: request.maxPriorityFeePerGas, gasPrice: request.gasPrice });
        return hashes[requests.length - 1]!;
      },
    },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
  });

  assert.equal(result.status, 'confirmed');
  assert.deepEqual(requests, [
    { to: token, maxFeePerGas: 220n, maxPriorityFeePerGas: 20n, gasPrice: undefined },
    { to: DESTINATION, maxFeePerGas: 220n, maxPriorityFeePerGas: 20n, gasPrice: undefined },
  ]);
});

test('refreshes stale fees after a mined approval within reviewed caps and journals step kinds', async () => {
  const fixture = approvalActionFixture();
  const realNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  const signatureRequests: Array<{ maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasLimit?: bigint; kind?: PlannedTransaction['kind'] }> = [];
  const estimates: Address[] = [];
  let refreshes = 0;
  const rpcClient = feeTestClient({
    transactions: fixture.planned.transactions,
    hashes: fixture.hashes,
    onReceipt: (hash) => { if (hash === HASH_1) now = 1_800_000_030_001; },
    estimateGas: async ({ to }) => { estimates.push(to); return to === fixture.token ? 100_001n : 200_001n; },
  });
  try {
    const result = await runTransactionRoute({
      route: fixture.planned,
      policy: fixture.policy,
      publicClient: rpcClient,
      feeSelection: fixture.feeSelection(now),
      refreshFeeQuotes: async (chainId) => {
        refreshes += 1;
        assert.equal(chainId, 1);
        return fixture.fresh(now, { tier: 'standard', gasPriceWei: 110n, maxFeePerGas: 180n, maxPriorityFeePerGas: 10n, source: 'rpc' });
      },
      callbacks: { requestSignature: async (request, transaction) => {
        signatureRequests.push({ ...request, kind: transaction?.kind });
        return fixture.hashes[signatureRequests.length - 1]!;
      } },
      options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
    });

    assert.equal(result.status, 'confirmed');
    assert.equal(refreshes, 1, 'fees refresh once for the action submitted after approval expiry');
    assert.deepEqual(estimates, [fixture.token, DESTINATION]);
    assert.deepEqual(signatureRequests.map(({ maxFeePerGas, maxPriorityFeePerGas, gasLimit, kind }) => ({ maxFeePerGas, maxPriorityFeePerGas, gasLimit, kind })), [
      { maxFeePerGas: 220n, maxPriorityFeePerGas: 20n, gasLimit: 120_002n, kind: 'approval' },
      { maxFeePerGas: 180n, maxPriorityFeePerGas: 10n, gasLimit: 240_002n, kind: 'action' },
    ]);
    assert.deepEqual(readPendingHashJournal().map((record) => record.stepKind), ['approval', 'action']);
  } finally {
    Date.now = realNow;
  }
});

test('waits for the previous wallet screen before fresh simulation and fees; cancellation submits no next step', async () => {
  const fixture = approvalActionFixture();
  const realNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const events: string[] = [];
    const gate = new Promise<void>((resolve) => {
      (globalThis as any).__releaseNextStep = resolve;
    });
    const rpcClient = feeTestClient({
      transactions: fixture.planned.transactions,
      hashes: fixture.hashes,
      onReceipt: (hash) => { if (hash === HASH_1) now += 2; },
      estimateGas: async () => 100_000n,
    });
    const execution = runTransactionRoute({
      route: fixture.planned,
      policy: fixture.policy,
      publicClient: rpcClient,
      feeSelection: {
        ...fixture.feeSelection(now),
        snapshot: { ...fixture.feeSelection(now).snapshot, validUntil: now + 1 },
      },
      refreshFeeQuotes: async (chainId) => {
        events.push('fees');
        assert.equal(chainId, 1);
        return fixture.fresh(now, { tier: 'standard', gasPriceWei: 110n, maxFeePerGas: 180n, maxPriorityFeePerGas: 10n, source: 'rpc' });
      },
      callbacks: {
        beforeTransaction: async (index) => {
          if (index !== 1) return;
          events.push('wait-start');
          await gate;
          events.push('wait-end');
        },
        simulate: async (remaining) => {
          events.push(remaining.transactions.length === 2 ? 'initial-sim' : 'remaining-sim');
          return true;
        },
        requestSignature: async (_request, transaction) => {
          events.push(`sign-${transaction.kind}`);
          return fixture.hashes[events.filter((event) => event.startsWith('sign-')).length - 1]!;
        },
      },
      options: { pollMs: 0, receiptTimeoutMs: 100 },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(events.includes('wait-start'));
    assert.equal(events.includes('remaining-sim'), false);
    (globalThis as any).__releaseNextStep();
    const result = await execution;
    assert.equal(result.status, 'confirmed');
    assert.ok(events.indexOf('wait-end') < events.indexOf('remaining-sim'));
    assert.ok(events.indexOf('remaining-sim') < events.indexOf('fees'));
    assert.ok(events.indexOf('fees') < events.indexOf('sign-action'));

    const cancelled = await runTransactionRoute({
      route: fixture.planned,
      policy: fixture.policy,
      publicClient: feeTestClient({ transactions: fixture.planned.transactions, hashes: fixture.hashes, estimateGas: async () => 100_000n }),
      callbacks: {
        beforeTransaction: async (index) => { if (index === 1) throw new Error('Close the Privy transaction screen, then retry to continue.'); },
        requestSignature: async (_request, transaction) => {
          events.push(`cancel-sign-${transaction.kind}`);
          return fixture.hashes[events.filter((event) => event.startsWith('cancel-sign-')).length - 1]!;
        },
      },
      options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
    });
    assert.equal(cancelled.status, 'partial');
    assert.equal(cancelled.steps[0]?.status, 'confirmed');
    assert.equal(cancelled.steps[1]?.hash, undefined);
    assert.deepEqual(events.filter((event) => event.startsWith('cancel-sign-')), ['cancel-sign-approval']);
  } finally {
    delete (globalThis as any).__releaseNextStep;
    Date.now = realNow;
  }
});

test('rejects refreshed fees above reviewed caps before requesting the action signature', async () => {
  const fixture = approvalActionFixture();
  const realNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  const signatureKinds: Array<PlannedTransaction['kind'] | undefined> = [];
  let refreshes = 0;
  const rpcClient = feeTestClient({
    transactions: fixture.planned.transactions,
    hashes: fixture.hashes,
    onReceipt: (hash) => { if (hash === HASH_1) now = 1_800_000_030_001; },
    estimateGas: async () => 100_000n,
  });
  try {
    const result = await runTransactionRoute({
      route: fixture.planned,
      policy: fixture.policy,
      publicClient: rpcClient,
      feeSelection: fixture.feeSelection(now),
      refreshFeeQuotes: async () => {
        refreshes += 1;
        return fixture.fresh(now, { tier: 'standard', gasPriceWei: 110n, maxFeePerGas: 230n, maxPriorityFeePerGas: 21n, source: 'rpc' });
      },
      callbacks: { requestSignature: async (_request, transaction) => {
        signatureKinds.push(transaction?.kind);
        return fixture.hashes[signatureKinds.length - 1]!;
      } },
      options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
    });

    assert.equal(result.status, 'partial');
    assert.equal(refreshes, 1);
    assert.deepEqual(signatureKinds, ['approval']);
    assert.deepEqual(readPendingHashJournal().map((record) => [record.stepKind, record.status]), [['approval', 'confirmed']]);
  } finally {
    Date.now = realNow;
  }
});

test('an action signature rejection after approval preserves a confirmed approval and submits no action hash', async () => {
  const fixture = approvalActionFixture();
  const signatureKinds: PlannedTransaction['kind'][] = [];
  const rpcClient = feeTestClient({
    transactions: fixture.planned.transactions,
    hashes: fixture.hashes,
    estimateGas: async () => 100_000n,
  });
  const result = await runTransactionRoute({
    route: fixture.planned,
    policy: fixture.policy,
    publicClient: rpcClient,
    callbacks: { requestSignature: async (_request, transaction) => {
      signatureKinds.push(transaction!.kind);
      if (transaction!.kind === 'action') throw new Error('user rejected action');
      return HASH_1;
    } },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
  });

  assert.equal(result.status, 'partial');
  assert.deepEqual(signatureKinds, ['approval', 'action']);
  assert.equal(result.steps[0]?.status, 'confirmed');
  assert.equal(result.steps[1]?.hash, undefined);
  assert.deepEqual(readPendingHashJournal().map((record) => [record.stepKind, record.status]), [['approval', 'confirmed']]);
});

test('gas estimation failure stops before the wallet signature request', async () => {
  const planned = route(1);
  let signatures = 0;
  const rpcClient = feeTestClient({
    transactions: planned.transactions,
    hashes: [HASH_1],
    estimateGas: async () => { throw new Error('estimateGas unavailable'); },
  });
  const result = await runTransactionRoute({
    route: planned,
    policy: TEST_POLICY,
    publicClient: rpcClient,
    callbacks: { requestSignature: async () => { signatures += 1; return HASH_1; } },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
  });

  assert.equal(result.status, 'failed');
  assert.equal(signatures, 0);
  assert.deepEqual(readPendingHashJournal(), []);
});

test("runner performs the default post-confirm read at the receipt block", async () => {
  const events: string[] = [];
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: client({
      pendingNonces: [4],
      receipts: [{ status: "success", blockNumber: 10n }],
      blocks: [10n],
    }),
    callbacks: {
      requestSignature: async () => HASH_1,
      onStatus: (status) => events.push(status),
      postConfirmRead: async () => { events.push("post-read"); },
    },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
  });

  assert.equal(result.status, "confirmed");
  assert.ok(events.indexOf("confirmed") >= 0);
  assert.ok(events.indexOf("post-read") > events.indexOf("confirmed"));
});

test("runner journals bridge verification facts only on the submitted bridge action", async () => {
  const planned = route(1);
  planned.operation = "buildBridgeTx";
  planned.transactions[0] = { ...planned.transactions[0], operation: "buildBridgeTx", data: bridgeData() };
  planned.quote = {
    nativeFee: 0n,
    lzTokenFee: 0n,
    sourceOftAddress: DESTINATION,
    destinationOftAddress: "0x3333333333333333333333333333333333333333",
    destinationChainId: 8453,
    destinationEid: 30184,
    recipient: WALLET,
    recipientBytes32: `0x${"0".repeat(24)}${WALLET.slice(2)}`,
    amountLD: 1_000_000_000_000_000_000n,
    minAmountLD: 1_000_000_000_000_000_000n,
    refundAddress: WALLET,
    destinationBaselineBlock: 123n,
    bridgeToken: "fxUSD",
    extraOptions: "0x",
    composeMsg: "0x",
    oftCmd: "0x",
  };
  const bridgeClient = {
    ...client({ pendingNonces: [4], receipts: [{ status: "success", blockNumber: 10n }], blocks: [10n, 11n, 12n] }),
    getTransaction: async ({ hash }: { hash: Hex }) => ({
      hash,
      from: WALLET,
      to: DESTINATION,
      input: bridgeData(),
      value: 0n,
      nonce: 4,
    }),
  } as unknown as FxPublicClient;
  const result = await runTransactionRoute({
    route: planned,
    policy: {
      ...TEST_POLICY,
      allowedSelectors: { [DESTINATION.toLowerCase()]: ["0xc7c7f5b3"] },
    },
    publicClient: bridgeClient,
    callbacks: { requestSignature: async () => HASH_1 },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "confirmed");
  assert.deepEqual(readPendingHashJournal()[0]?.bridge, {
    destinationChainId: 8453,
    sourceOftAddress: DESTINATION,
    destinationOftAddress: "0x3333333333333333333333333333333333333333",
    recipient: WALLET,
    amountLD: "1000000000000000000",
    minAmountLD: "1000000000000000000",
    destinationBaselineBlock: "123",
    bridgeToken: "fxUSD",
  });
});

test("throwing UI observers cannot interrupt journaling or receipt confirmation", async () => {
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: client({
      pendingNonces: [4],
      receipts: [{ status: "success", blockNumber: 10n }],
      blocks: [10n, 11n, 12n],
    }),
    callbacks: {
      requestSignature: async () => HASH_1,
      onStatus: () => { throw new Error("render observer failed"); },
      onStep: () => { throw new Error("progress observer failed"); },
    },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "confirmed");
  assert.equal(readPendingHashJournal()[0]?.status, "confirmed");
});

test("signature rejection stops the route and never requests transaction N+1", async () => {
  const cb = callbacks([], async (index) => {
    if (index === 0) throw new Error("user rejected");
    return HASH_2;
  });
  const result = await runTransactionRoute({
    route: route(2),
    policy: TEST_POLICY,
    publicClient: client({ pendingNonces: [4], receipts: [], blocks: [] }),
    callbacks: { requestSignature: cb.requestSignature },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "failed");
  assert.equal(cb.requested.length, 1);
  assert.equal(result.steps[0]?.status, "failed");
  assert.equal(result.steps[1], undefined);
});

test("a reverted receipt stops the following SDK transaction", async () => {
  const cb = callbacks([HASH_1, HASH_2]);
  const result = await runTransactionRoute({
    route: route(2),
    policy: TEST_POLICY,
    publicClient: client({
      pendingNonces: [4],
      receipts: [{ status: "reverted", blockNumber: 10n }],
      blocks: [],
    }),
    callbacks: { requestSignature: cb.requestSignature },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "failed");
  assert.equal(cb.requested.length, 1);
  assert.match(result.error ?? "", /reverted/);
});

test("a partially completed route rereads state after the confirmed prerequisite block", async () => {
  let postReads = 0;
  const cb = callbacks([], async (index) => {
    if (index === 0) return HASH_1;
    throw new Error("user rejected protocol action");
  });
  const result = await runTransactionRoute({
    route: route(2),
    policy: TEST_POLICY,
    publicClient: client({
      pendingNonces: [4, 5],
      receipts: [{ status: "success", blockNumber: 10n }],
      blocks: [10n, 11n, 12n, 13n],
    }),
    callbacks: {
      requestSignature: cb.requestSignature,
      postConfirmRead: async (_route, partial) => {
        postReads += 1;
        assert.equal(partial.status, "partial");
        assert.equal(partial.steps[0]?.status, "confirmed");
      },
    },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
  });
  assert.equal(result.status, "partial");
  assert.equal(cb.requested.length, 2);
  assert.equal(postReads, 1);
});

test("nonce drift prevents signing before the wallet prompt", async () => {
  let signatures = 0;
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: client({ pendingNonces: [99], receipts: [], blocks: [] }),
    callbacks: {
      requestSignature: async () => {
        signatures += 1;
        return HASH_1;
      },
    },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "failed");
  assert.equal(signatures, 0);
  assert.match(result.error ?? "", /nonce drift/);
});

test("live chain and pending nonce probes run concurrently before signing", async () => {
  let chainCalls = 0;
  let stepChainStarted = false;
  let nonceStarted = false;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const base = client({
    pendingNonces: [4],
    receipts: [{ status: "success", blockNumber: 10n }],
    blocks: [10n, 11n, 12n],
  });
  const concurrentClient = {
    ...base,
    getChainId: async () => {
      chainCalls += 1;
      if (chainCalls > 1) {
        stepChainStarted = true;
        await gate;
      }
      return 1;
    },
    getTransactionCount: async () => {
      nonceStarted = true;
      await gate;
      return 4;
    },
  } as unknown as FxPublicClient;

  const pending = runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: concurrentClient,
    callbacks: { requestSignature: async () => HASH_1 },
    options: { simulate: false, waitForNextBlock: false },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(stepChainStarted, true);
  assert.equal(nonceStarted, true, "nonce read should not wait for the chain probe response");
  release?.();
  assert.equal((await pending).status, "confirmed");
});

test("a live RPC chain mismatch fails before opening a wallet prompt", async () => {
  let signatures = 0;
  await assert.rejects(
    runTransactionRoute({
      route: route(1),
      policy: TEST_POLICY,
      publicClient: client({ pendingNonces: [4], receipts: [], blocks: [], remoteChainId: 8453 }),
      callbacks: {
        requestSignature: async () => {
          signatures += 1;
          return HASH_1;
        },
      },
      options: { simulate: false, waitForNextBlock: false },
    }),
    /returned chain 8453; expected 1/,
  );
  assert.equal(signatures, 0);
  assert.deepEqual(readPendingHashJournal(), []);
});

test("runner rejects a mined transaction whose provider returns another hash", async () => {
  const base = client({
    pendingNonces: [4],
    receipts: [{ status: "success", blockNumber: 10n }],
    blocks: [],
  });
  const hostile = {
    ...base,
    getTransaction: async () => ({
      hash: HASH_2,
      from: WALLET,
      to: DESTINATION,
      input: "0x12345678",
      value: 0n,
      nonce: 4,
    }),
  } as unknown as FxPublicClient;
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: hostile,
    callbacks: { requestSignature: async () => HASH_1 },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /mined transaction hash/);
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("runner leaves a signed hash pending when the receipt block is malformed", async () => {
  const base = client({ pendingNonces: [4], receipts: [], blocks: [] });
  const malformed = {
    ...base,
    getTransactionReceipt: async () => ({
      transactionHash: HASH_1,
      from: WALLET,
      to: DESTINATION,
      status: "success",
      blockNumber: undefined,
      blockHash: BLOCK_HASH_1,
    }),
  } as unknown as FxPublicClient;
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: malformed,
    callbacks: { requestSignature: async () => HASH_1 },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /canonical block number/);
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("runner leaves a signed hash pending when the receipt status is non-terminal", async () => {
  const base = client({ pendingNonces: [4], receipts: [], blocks: [] });
  const malformed = {
    ...base,
    getTransactionReceipt: async () => ({
      transactionHash: HASH_1,
      from: WALLET,
      to: DESTINATION,
      status: "pending",
      blockNumber: 10n,
      blockHash: BLOCK_HASH_1,
    }),
  } as unknown as FxPublicClient;
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: malformed,
    callbacks: { requestSignature: async () => HASH_1 },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /terminal on-chain status/);
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("runner does not mark a receipt confirmed when mined calldata is mutated", async () => {
  let signatures = 0;
  let postReads = 0;
  const base = client({
    pendingNonces: [4],
    receipts: [{ status: "success", blockNumber: 10n }],
    blocks: [11n],
  });
  const hostile = {
    ...base,
    getTransaction: async ({ hash }: { hash: Hex }) => ({
      hash,
      from: WALLET,
      to: DESTINATION,
      input: "0xdeadbeef",
      value: 0n,
      nonce: 4,
    }),
  } as unknown as FxPublicClient;
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: hostile,
    callbacks: {
      requestSignature: async () => {
        signatures += 1;
        return HASH_1;
      },
      postConfirmRead: async (_route, failed) => {
        postReads += 1;
        assert.equal(failed.status, "failed");
        assert.equal(failed.steps[0]?.receipt?.blockNumber, 10n);
      },
    },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
  });
  assert.equal(signatures, 1);
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /calldata/);
  assert.equal(result.steps[0]?.status, "failed");
  assert.equal(postReads, 1);
});

test("simulation fails closed when the RPC omits an ordered route result", async () => {
  const partialClient = {
    chain: { id: 1 },
    getChainId: async () => 1,
    simulateCalls: async () => ({ results: [{ status: "success" }] }),
  } as unknown as FxPublicClient;
  const result = await simulatePlannedRoute(route(2), partialClient);
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /returned 1 results for 2 transactions/);
});

test("approval route preflight simulates the action and blocks signing when it reverts", async () => {
  const token = "0x3333333333333333333333333333333333333333" as Address;
  const planned = route(2);
  const approvalData = encodeFunctionData({
    abi: parseAbi(["function approve(address spender,uint256 amount)"]),
    functionName: "approve",
    args: [DESTINATION, 100n],
  });
  planned.transactions[0] = {
    ...planned.transactions[0]!, to: token, data: approvalData,
    nonce: 4, kind: "approval", type: "approveToken",
  };
  planned.transactions[1] = { ...planned.transactions[1]!, nonce: 5 };
  const policy: TransactionPolicy = {
    walletAddress: WALLET,
    chainId: 1,
    allowedDestinations: [DESTINATION, token],
    allowedSelectors: { [DESTINATION.toLowerCase()]: ["0x12345678"], [token.toLowerCase()]: ["0x095ea7b3"] },
    allowedApprovalDestinations: [token],
    allowedApprovalSpenders: [DESTINATION],
    allowedTokenApprovalDestinations: [token],
    allowActionBoundTokenApproval: true,
  };
  let simulatedCalls: Array<{ to: Address; data: Hex; value: bigint }> = [];
  let walletSends = 0;
  const result = await runTransactionRoute({
    route: planned,
    policy,
    publicClient: {
      chain: { id: 1 },
      getChainId: async () => 1,
      simulateCalls: async ({ calls }: { calls: typeof simulatedCalls }) => {
        simulatedCalls = calls;
        return { results: [{ status: "success" }, { status: "failure", error: new Error("action reverted") }] };
      },
    } as unknown as FxPublicClient,
    callbacks: { requestSignature: async () => { walletSends += 1; return HASH_1; } },
    options: { pollMs: 0, receiptTimeoutMs: 100 },
  });

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /action reverted/i);
  assert.deepEqual(simulatedCalls, planned.transactions.map(({ to, data, value }) => ({ to, data, value })));
  assert.equal(walletSends, 0);
  assert.equal(result.steps.length, 0);
});

test("simulation maps nested viem debt-ratio reverts with operation-specific guidance", async () => {
  const tooLittleDebt = new CallExecutionError(
    new RawContractError({ data: "0xe91ee887" }),
    { account: WALLET, to: DESTINATION },
  );
  const tooMuchDebt = new CallExecutionError(
    new RawContractError({ data: "0x9c89bf50" }),
    { account: WALLET, to: DESTINATION },
  );

  const thrownResult = await simulatePlannedRoute(route(1), {
    chain: { id: 1 },
    simulateCalls: async () => { throw tooLittleDebt; },
  } as unknown as FxPublicClient);
  assert.deepEqual(thrownResult, {
    success: false,
    error: "Increase leverage to meet the minimum debt ratio.",
  });

  const returnedResult = await simulatePlannedRoute(route(1), {
    chain: { id: 1 },
    simulateCalls: async () => ({ results: [{ status: "failure", error: tooMuchDebt }] }),
  } as unknown as FxPublicClient);
  assert.deepEqual(returnedResult, {
    success: false,
    error: "Lower leverage or add collateral.",
    failedTxIndex: 0,
  });

  const borrowTooLittle = await simulatePlannedRoute(route(1, "depositAndMint"), {
    chain: { id: 1 },
    simulateCalls: async () => { throw tooLittleDebt; },
  } as unknown as FxPublicClient);
  assert.equal(borrowTooLittle.success, false);
  if (!borrowTooLittle.success) assert.equal(borrowTooLittle.error, "Borrow amount is too low for this collateral.");

  const borrowTooMuch = await simulatePlannedRoute(route(1, "depositAndMint"), {
    chain: { id: 1 },
    simulateCalls: async () => ({ results: [{ status: "failure", error: tooMuchDebt }] }),
  } as unknown as FxPublicClient);
  assert.equal(borrowTooMuch.success, false);
  if (!borrowTooMuch.success) assert.equal(borrowTooMuch.error, "Reduce the borrow amount or add collateral.");

  const unrelatedOperation = await simulatePlannedRoute(route(1, "repayAndWithdraw"), {
    chain: { id: 1 },
    simulateCalls: async () => ({ results: [{ status: "failure", error: tooMuchDebt }] }),
  } as unknown as FxPublicClient);
  assert.equal(unrelatedOperation.success, false);
  if (!unrelatedOperation.success) assert.equal(unrelatedOperation.error, "Debt is above the allowed range for this collateral.");
});

test("simulation hides unknown provider diagnostics behind a safe fallback", async () => {
  const result = await simulatePlannedRoute(route(1), {
    chain: { id: 1 },
    simulateCalls: async () => { throw new Error("request failed at https://rpc.example/v2/private-key"); },
  } as unknown as FxPublicClient);
  assert.deepEqual(result, {
    success: false,
    error: "Simulation is unavailable. Check your connection and try again.",
  });
  assert.doesNotMatch(result.error ?? "", /rpc\.example|private-key/);
});

test("an explicitly requested post-confirm block wait can skip a read when unavailable", async () => {
  let postReads = 0;
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: client({
      pendingNonces: [4],
      receipts: [{ status: "success", blockNumber: 10n }],
      blocks: [10n],
    }),
    callbacks: {
      requestSignature: async () => HASH_1,
      postConfirmRead: async () => { postReads += 1; },
    },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 2, waitForNextBlock: true },
  });
  assert.equal(result.status, "confirmed");
  assert.equal(postReads, 0);
});

test('a wallet that cannot fund the step fails before any wallet prompt opens', async () => {
  // An embedded wallet sends an unfundable request into a funding screen that
  // never settles, so the runner checks value + gas limit × max fee first.
  const fixture = approvalActionFixture();
  let prompts = 0;
  let balanceTag: string | undefined;
  const rpcClient = {
    ...feeTestClient({ transactions: fixture.planned.transactions, hashes: fixture.hashes, estimateGas: async () => 100_000n }),
    // 100,000 gas × 1.2 headroom × 220 wei max fee needs 26,400,000 wei.
    getBalance: async ({ blockTag }: { blockTag?: string }) => { balanceTag = blockTag; return 26_399_999n; },
  } as unknown as FxPublicClient;
  const result = await runTransactionRoute({
    route: fixture.planned,
    policy: fixture.policy,
    publicClient: rpcClient,
    feeSelection: fixture.feeSelection(Date.now()),
    callbacks: { requestSignature: async () => { prompts += 1; return fixture.hashes[0]!; } },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
  });
  assert.equal(prompts, 0);
  assert.equal(balanceTag, 'pending');
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /^Not enough ETH for network fees\./);
  assert.equal(result.steps[0]?.hash, undefined);
});

test('a funded wallet, or an unreadable balance, still reaches the wallet prompt', async () => {
  for (const getBalance of [async () => 26_400_000n, async () => { throw new Error('balance read failed'); }]) {
    const fixture = approvalActionFixture();
    let prompts = 0;
    const rpcClient = {
      ...feeTestClient({ transactions: fixture.planned.transactions, hashes: fixture.hashes, estimateGas: async () => 100_000n }),
      getBalance,
    } as unknown as FxPublicClient;
    const result = await runTransactionRoute({
      route: fixture.planned,
      policy: fixture.policy,
      publicClient: rpcClient,
      feeSelection: fixture.feeSelection(Date.now()),
      callbacks: { requestSignature: async () => fixture.hashes[prompts++]! },
      options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
    });
    assert.equal(result.status, 'confirmed');
    assert.equal(prompts, 2);
  }
});
