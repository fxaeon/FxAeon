import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import type { Abi } from 'viem';
import { AppError } from '../src/domain/errors';
import type { Hash, LongIntent, ReviewedCall, WalletSession } from '../src/domain/ports';
import { ADDRESSES, CONVERTER_ABI, DEBT_ENCODING, DEBT_ROUTE, FEE_ABI, FEE_SCALE, FLASH_DATA, INPUT_ENCODING, INPUT_ROUTE, MANAGER_ABI, OPEN_ABI, ORACLE_ABI, POOL_ABI, WAD, WRAPPING_ABI } from '../src/protocol/contracts';
import { createProtocolWithDependencies } from '../src/protocol/index';
import { decodeLongCall, validateSdkLong } from '../src/protocol/policy';
import { executionProof, feeCap } from '../src/protocol/preflight';
import type { PoolSnapshot } from '../src/protocol/reads';
import { mintedPosition, verifyReceipt } from '../src/protocol/receipts';
import { createRpc, validatedUrls } from '../src/protocol/rpc';
import type { RpcPort } from '../src/protocol/rpc';
import { bounded, hex } from '../src/protocol/values';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TX_HASH: Hash = `0x${'12'.repeat(32)}`;
const BLOCK_HASH: Hash = `0x${'34'.repeat(32)}`;
const REORG_HASH: Hash = `0x${'56'.repeat(32)}`;
const signal = () => new AbortController().signal;
const session: WalletSession = { id: 'first-session', address: OWNER, chainId: 1, label: 'Selected wallet' };
const intent: LongIntent = { market: 'ETH', side: 'long', token: 'ETH', amountWei: WAD / 10n, leverageBps: 30_000, slippageBps: 100 };
const pool: PoolSnapshot = { blockNumber: 100n, readAt: 1_000, paused: false,
  minimumDebtRatio: WAD / 20n, maximumDebtRatio: WAD * 9n / 10n,
  collateralRoom: 1_000n * WAD, debtRoom: 1_000_000n * WAD,
  anchorPrice: 3_000n * WAD, minimumPrice: 2_999n * WAD, maximumPrice: 3_001n * WAD,
  wrappingRate: WAD * 5n / 4n, fees: [0n, 0n, 0n, 0n], nativeInputQuote: { amountWei: WAD / 10n, wstEthWei: 80_000_000_000_000_000n } };

// Independent exact-arithmetic fixture: 0.1 ETH at 3x; the quote includes 1%
// borrowing slippage and a distinct converter minimum in wstETH units.
function fixture(options: { debt?: bigint; borrowed?: bigint; input?: bigint; fee?: bigint } = {}) {
  const input = options.input ?? 80_000_000_000_000_000n;
  const borrowed = options.borrowed ?? 159_984_000_000_000_000n;
  const debt = options.debt ?? 606n * WAD;
  const fee = options.fee ?? 0n;
  const ratio = (price: bigint) => debt * WAD ** 3n * FEE_SCALE / ((input + borrowed) * pool.wrappingRate * (FEE_SCALE - fee) * price);
  const minimum = ratio(pool.anchorPrice * 101n / 100n);
  const maximum = ratio(pool.anchorPrice * 99n / 100n);
  const inputData = encodeFunctionData({ abi: CONVERTER_ABI, functionName: 'convert', args: [ADDRESSES.native, intent.amountWei, INPUT_ENCODING, INPUT_ROUTE] });
  const debtData = encodeFunctionData({ abi: CONVERTER_ABI, functionName: 'convert', args: [ADDRESSES.fxUsd, debt, DEBT_ENCODING, DEBT_ROUTE] });
  const payload = encodeAbiParameters(FLASH_DATA, [minimum | (maximum << 60n), debt, ADDRESSES.converter, debtData]);
  const data = encodeFunctionData({ abi: OPEN_ABI, functionName: 'openOrAddPositionFlashLoanV2', args: [
    { tokenIn: ADDRESSES.native, amount: intent.amountWei, target: ADDRESSES.converter, data: inputData,
      minOut: input * 99n / 100n, signature: '0x' }, ADDRESSES.pool, 0n, borrowed, payload,
  ] });
  return { positionId: 0, slippage: 1,
    protocolFeeQuote: { poolAddress: ADDRESSES.pool, routerAddress: ADDRESSES.router, ratios: [String(fee), '0', '0', '0'] },
    routes: [{ routeType: 'FxRoute', leverage: 3, executionPrice: '3000',
      colls: String((input + borrowed) * (FEE_SCALE - fee) / FEE_SCALE), debts: String(debt),
      positionEconomics: { version: 1, operation: 'increase', priceWad: String(pool.anchorPrice), rateRes: String(pool.wrappingRate),
        currentColls: '0', currentDebts: '0', inputCollateral: String(input), supplyFeeRatio: String(fee), withdrawFeeRatio: '0' },
      txs: [{ type: 'trade', chainId: 1, from: OWNER, to: ADDRESSES.router, data, value: intent.amountWei, nonce: 7 }],
    }],
  };
}
function reviewed(): ReviewedCall { return validateSdkLong(fixture(), intent, session, pool).call; }
function code(expected: string) { return (error: unknown) => error instanceof AppError && error.code === expected; }
function changeCall(change: (args: any[]) => void): ReviewedCall {
  const call = reviewed();
  const decoded = decodeFunctionData({ abi: OPEN_ABI, data: call.data });
  const args = structuredClone(decoded.args) as unknown as any[];
  change(args);
  return { ...call, data: encodeFunctionData({ abi: OPEN_ABI as Abi, functionName: decoded.functionName, args }) };
}
const feeHistory = () => ({ oldestBlock: '0x60', baseFeePerGas: Array(6).fill(hex(1_000_000_000n)),
  reward: Array.from({ length: 5 }, () => [hex(100_000_000n)]), gasUsedRatio: Array(5).fill(0.5) });
const READ_ABI: Abi = [...MANAGER_ABI, ...POOL_ABI, ...FEE_ABI, ...ORACLE_ABI, ...WRAPPING_ABI, ...CONVERTER_ABI];

function fakeRpc(override?: (method: string, params: readonly unknown[]) => unknown) {
  const calls: { method: string; params: readonly unknown[] }[] = [];
  let proofs = 0;
  const rpc: RpcPort = {
    prove: async (active) => { assert.equal(active.aborted, false); proofs++; },
    request: async (method, params, active) => {
      assert.equal(active.aborted, false);
      calls.push({ method, params });
      const custom = override?.(method, params);
      if (custom !== undefined) return custom;
      if (method === 'eth_blockNumber') return '0x64';
      if (method === 'eth_getBalance') return hex(2n * WAD);
      if (method === 'eth_getTransactionCount') return '0x7';
      if (method === 'eth_estimateGas') return hex(500_000n);
      if (method === 'eth_feeHistory') return feeHistory();
      if (method === 'eth_call') {
        const transaction = params[0] as { to: string; data: Hash };
        if (transaction.to.toLowerCase() === ADDRESSES.router) return '0x';
        const decoded = decodeFunctionData({ abi: READ_ABI, data: transaction.data });
        const outputs: Record<string, unknown> = {
          getPoolInfo: [1_000n * WAD, 0n, 0n, 1_000_000n * WAD, 0n], paused: false,
          getDebtRatioRange: [pool.minimumDebtRatio, pool.maximumDebtRatio], getPoolFeeRatio: pool.fees,
          getPrice: [pool.anchorPrice, pool.minimumPrice, pool.maximumPrice], stEthPerToken: pool.wrappingRate,
          ownerOf: OWNER, getPosition: [WAD * 3n / 10n, 606n * WAD], queryConvert: 80_000_000_000_000_000n,
        };
        assert.ok(decoded.functionName in outputs, decoded.functionName);
        return encodeFunctionResult({ abi: READ_ABI, functionName: decoded.functionName, result: outputs[decoded.functionName] });
      }
      throw new Error(`Unexpected method ${method}`);
    },
  };
  return { rpc, calls, proofCount: () => proofs };
}

test('native ETH quote is decoded and economics are recomputed in exact units', () => {
  const checked = validateSdkLong(fixture(), intent, session, pool);
  assert.equal(checked.call.value, intent.amountWei);
  assert.equal(checked.decoded.debt, 606n * WAD);
  assert.equal(checked.economics.collateralStEthWei, 299_980_000_000_000_000n);
  assert.equal(checked.economics.minimumWstEthWei, 79_200_000_000_000_000n);
  assert.equal(checked.economics.estimatedLeverageBps, 30_616);
  assert.equal(checked.economics.liquidationPriceUsdE18, undefined);
  assert.equal(checked.economics.rebalancePriceUsdE18, undefined);
  assert.ok(Object.isFrozen(checked.call));
});

for (const [label, modify] of [
  ['wrong sender', (value: ReturnType<typeof fixture>) => { value.routes[0]!.txs[0]!.from = OTHER; }],
  ['wrong chain', (value: ReturnType<typeof fixture>) => { value.routes[0]!.txs[0]!.chainId = 8453; }],
  ['wrong value', (value: ReturnType<typeof fixture>) => { value.routes[0]!.txs[0]!.value += 1n; }],
  ['negative nonce', (value: ReturnType<typeof fixture>) => { value.routes[0]!.txs[0]!.nonce = -1; }],
  ['fractional nonce', (value: ReturnType<typeof fixture>) => { value.routes[0]!.txs[0]!.nonce = 1.5; }],
  ['approval before action', (value: ReturnType<typeof fixture>) => { value.routes[0]!.txs.unshift({ ...value.routes[0]!.txs[0]!, type: 'approve' }); }],
  ['noncanonical calldata suffix', (value: ReturnType<typeof fixture>) => { value.routes[0]!.txs[0]!.data += '00'; }],
  ['wrong current position', (value: ReturnType<typeof fixture>) => { value.routes[0]!.positionEconomics.currentDebts = '1'; }],
  ['missing economic version', (value: ReturnType<typeof fixture>) => { value.routes[0]!.positionEconomics.version = 0; }],
  ['zero quote price', (value: ReturnType<typeof fixture>) => { value.routes[0]!.positionEconomics.priceWad = '0'; }],
  ['unmatched live rate', (value: ReturnType<typeof fixture>) => { value.routes[0]!.positionEconomics.rateRes = String(WAD); }],
  ['unmatched fee', (value: ReturnType<typeof fixture>) => { value.protocolFeeQuote.ratios[2] = '1'; }],
  ['quote collateral alteration', (value: ReturnType<typeof fixture>) => { value.routes[0]!.colls = '1'; }],
  ['debt display alteration', (value: ReturnType<typeof fixture>) => { value.routes[0]!.debts = '1'; }],
] as const) {
  test(`quote rejects ${label}`, () => {
    const value = fixture(); modify(value);
    assert.throws(() => validateSdkLong(value, intent, session, pool));
  });
}

for (const [label, change] of [
  ['input token', (args: any[]) => { args[0].tokenIn = OTHER; }],
  ['input converter', (args: any[]) => { args[0].target = OTHER; }],
  ['nonempty signature', (args: any[]) => { args[0].signature = '0x00'; }],
  ['zero converter minimum', (args: any[]) => { args[0].minOut = 0n; }],
  ['different pool', (args: any[]) => { args[1] = OTHER; }],
  ['existing position', (args: any[]) => { args[2] = 1n; }],
  ['zero borrowed minimum', (args: any[]) => { args[3] = 0n; }],
  ['unsigned inner flags', (args: any[]) => { args[4] = encodeAbiParameters(FLASH_DATA, [1n << 120n, 1n, ADDRESSES.converter, '0x']); }],
  ['changed nested input amount', (args: any[]) => { args[0].data = encodeFunctionData({ abi: CONVERTER_ABI, functionName: 'convert', args: [ADDRESSES.native, 1n, INPUT_ENCODING, INPUT_ROUTE] }); }],
  ['unapproved converter route', (args: any[]) => { args[0].data = encodeFunctionData({ abi: CONVERTER_ABI, functionName: 'convert', args: [ADDRESSES.native, intent.amountWei, INPUT_ENCODING, [1n, 2n]] }); }],
] as const) {
  test(`decoded policy rejects ${label}`, () => assert.throws(() => decodeLongCall(changeCall(change))));
}

test('self-consistent half-sized borrowing cannot borrow authority from the leverage echo', () => {
  const reduced = fixture({ debt: 303n * WAD, borrowed: 79_992_000_000_000_000n });
  assert.throws(() => validateSdkLong(reduced, intent, session, pool), code('economics'));
});
test('native conversion metadata must match independent evidence for the exact input', () => {
  assert.throws(() => validateSdkLong(fixture(), intent, session, { ...pool, nativeInputQuote: undefined }), code('policy'));
  assert.throws(() => validateSdkLong(fixture(), intent, session, { ...pool, nativeInputQuote: { amountWei: 1n, wstEthWei: 80_000_000_000_000_000n } }), code('policy'));
  const underquoted = fixture({ input: 40_000_000_000_000_000n, debt: 303n * WAD, borrowed: 79_992_000_000_000_000n });
  assert.throws(() => validateSdkLong(underquoted, intent, session, pool), code('economics'));
});
test('pool pause, capacity and debt-ratio boundaries are live authorization', () => {
  assert.throws(() => validateSdkLong(fixture(), intent, session, { ...pool, paused: true }), code('unavailable'));
  assert.throws(() => validateSdkLong(fixture(), intent, session, { ...pool, debtRoom: 1n }));
  assert.throws(() => validateSdkLong(fixture(), intent, session, { ...pool, collateralRoom: 1n }));
  assert.throws(() => validateSdkLong(fixture(), intent, session, { ...pool, maximumDebtRatio: WAD / 2n }));
});

test('prepare uses official method parameters, pins pool reads, and preflight never replans', async () => {
  const fake = fakeRpc(); let planned = 0; let clock = 1_000;
  const protocol = createProtocolWithDependencies({ rpc: fake.rpc, now: () => clock, sdk: async () => ({
    increasePosition: async (request) => { planned++; assert.deepEqual(request, { market: 'ETH', type: 'long', positionId: 0,
      userAddress: OWNER, inputTokenAddress: ADDRESSES.native, amount: intent.amountWei, leverage: 3, slippage: 1, targets: ['FxRoute'] }); return fixture(); },
    getPositions: async () => [],
  }) });
  const plan = await protocol.prepare(intent, session, signal());
  assert.equal(plan.simulation, 'passed');
  assert.equal(plan.gasLimit, 600_000n);
  assert.equal(plan.estimatedNetworkFeeWei, 1_260_000_000_000_000n);
  assert.equal(plan.requiredBalanceWei, intent.amountWei + plan.estimatedNetworkFeeWei);
  assert.equal(plan.expiresAt - plan.preparedAt, 30_000);
  await protocol.preflight(plan, session, signal());
  assert.equal(planned, 1);
  assert.equal(fake.proofCount(), 2);
  assert.ok(fake.calls.filter(({ method, params }) => method === 'eth_call' && (params[0] as { to: string }).to !== ADDRESSES.router).every(({ params }) => params[1] === '0x64'));
  await assert.rejects(protocol.preflight({ ...plan }, session, signal()), code('policy'));
  await assert.rejects(protocol.preflight(plan, { ...session, id: 'new-session' }, signal()), code('wallet-changed'));
  clock = plan.expiresAt;
  await assert.rejects(protocol.preflight(plan, session, signal()), code('expired'));
});
test('unavailable market balance stays absent; positive proof is required to fund a trade', async () => {
  const fake = fakeRpc((method) => { if (method === 'eth_getBalance') throw new Error('provider failure'); });
  const protocol = createProtocolWithDependencies({ rpc: fake.rpc, sdk: async () => ({ increasePosition: async () => fixture(), getPositions: async () => [] }) });
  const facts = await protocol.readMarket(OWNER, signal());
  assert.equal(facts.balanceWei, undefined);
  assert.ok(!Object.hasOwn(facts, 'balanceWei'));
  await assert.rejects(protocol.prepare(intent, session, signal()), code('unavailable'));
});
for (const [label, method, response, expected] of [
  ['changed pending nonce', 'eth_getTransactionCount', '0x8', 'nonce-changed'],
  ['unknown nonce', 'eth_getTransactionCount', null, 'policy'],
  ['insufficient gas funding', 'eth_getBalance', hex(intent.amountWei), 'insufficient-funds'],
  ['nonempty simulation return', 'eth_call', '0x00', 'simulation'],
  ['impossible gas estimate', 'eth_estimateGas', '0x0', 'policy'],
  ['missing fee proof', 'eth_feeHistory', {}, 'policy'],
] as const) {
  test(`preflight rejects ${label}`, async () => {
    const fake = fakeRpc((name) => name === method ? response : undefined);
    await assert.rejects(executionProof(fake.rpc, reviewed(), signal()), code(expected));
  });
}
test('fee-cap selection uses all five samples and refuses malformed reward history', () => {
  const history = feeHistory();
  history.reward = [100n, 5n, 7n, 6n, 3n].map((value) => [hex(value)]);
  assert.equal(feeCap(history), 2_000_000_006n);
  history.reward.pop();
  assert.throws(() => feeCap(history));
});
test('increased network requirements require a new review without replanning', async () => {
  let gas = 500_000n; let plans = 0;
  const fake = fakeRpc((method) => method === 'eth_estimateGas' ? hex(gas) : undefined);
  const protocol = createProtocolWithDependencies({ rpc: fake.rpc, sdk: async () => ({ increasePosition: async () => { plans++; return fixture(); }, getPositions: async () => [] }) });
  const plan = await protocol.prepare(intent, session, signal()); gas += 1n;
  await assert.rejects(protocol.preflight(plan, session, signal()), code('expired'));
  assert.equal(plans, 1);
});

function log(from = ADDRESSES.native as string, to = OWNER as string, id = 123n, index = 0n) {
  return { address: ADDRESSES.pool, topics: encodeEventTopics({ abi: POOL_ABI, eventName: 'Transfer', args: { from: from as `0x${string}`, to: to as `0x${string}`, tokenId: id } }),
    data: '0x', transactionHash: TX_HASH, blockHash: BLOCK_HASH, blockNumber: '0x64', logIndex: hex(index), removed: false };
}
function receiptSet(call = reviewed()) {
  return { receipt: { transactionHash: TX_HASH, from: OWNER, to: ADDRESSES.router, blockHash: BLOCK_HASH,
    blockNumber: '0x64', status: '0x1', gasUsed: hex(500_000n), effectiveGasPrice: hex(1_000_000_000n), logs: [log()] },
  transaction: { hash: TX_HASH, from: OWNER, to: ADDRESSES.router, input: call.data, value: hex(call.value), nonce: '0x7', chainId: '0x1', blockHash: BLOCK_HASH, blockNumber: '0x64' },
  block: { hash: BLOCK_HASH, number: '0x64' } };
}
test('receipt proves exact call, actual network fee and one unambiguous mint', () => {
  const call = reviewed(); const data = receiptSet(call);
  const proof = verifyReceipt(TX_HASH, call, data.receipt, data.transaction, data.block);
  assert.equal(proof.value.networkFeeWei, 500_000_000_000_000n);
  assert.equal(mintedPosition(proof, call), 123n);
  data.receipt.logs = [log(ADDRESSES.native, ADDRESSES.router), log(ADDRESSES.router, OWNER, 123n, 1n)];
  assert.equal(mintedPosition(verifyReceipt(TX_HASH, call, data.receipt, data.transaction, data.block), call), 123n);
});
for (const [label, mutate] of [
  ['wrong transaction hash', (data: ReturnType<typeof receiptSet>) => { data.transaction.hash = REORG_HASH; }],
  ['wrong sender', (data: ReturnType<typeof receiptSet>) => { data.transaction.from = OTHER; }],
  ['changed calldata', (data: ReturnType<typeof receiptSet>) => { data.transaction.input = '0x'; }],
  ['changed native value', (data: ReturnType<typeof receiptSet>) => { data.transaction.value = '0x0'; }],
  ['changed nonce', (data: ReturnType<typeof receiptSet>) => { data.transaction.nonce = '0x8'; }],
  ['wrong chain', (data: ReturnType<typeof receiptSet>) => { data.transaction.chainId = '0x2105'; }],
  ['noncanonical block', (data: ReturnType<typeof receiptSet>) => { data.block.hash = REORG_HASH; }],
  ['unknown terminal status', (data: ReturnType<typeof receiptSet>) => { data.receipt.status = '0x2'; }],
  ['unknown actual fee', (data: ReturnType<typeof receiptSet>) => { data.receipt.effectiveGasPrice = '0x0'; }],
] as const) {
  test(`receipt rejects ${label}`, () => { const data = receiptSet(); mutate(data); assert.throws(() => verifyReceipt(TX_HASH, reviewed(), data.receipt, data.transaction, data.block)); });
}
test('ambiguous, malformed, removed and third-party mints never prove a position', () => {
  const call = reviewed(); const data = receiptSet();
  const cases = [
    [log(), log(ADDRESSES.native, OWNER, 124n, 1n)],
    [log(ADDRESSES.native, OTHER)],
    [log(ADDRESSES.native, ADDRESSES.router)],
    [log(), { ...log(ADDRESSES.native, OWNER, 124n, 1n), topics: log().topics.slice(0, 2) }],
    [{ ...log(), removed: true }],
    [{ ...log(), blockHash: REORG_HASH }],
  ];
  for (const logs of cases) assert.equal(mintedPosition(verifyReceipt(TX_HASH, call, { ...data.receipt, logs }, data.transaction, data.block), call), undefined);
  const proof = verifyReceipt(TX_HASH, call, { ...data.receipt, status: '0x0' }, data.transaction, data.block);
  assert.equal(proof.value.status, 'reverted');
  assert.equal(mintedPosition(proof, call), undefined);
});
test('observer ignores stale SDK index, proves current ownership and fresh accounting', async () => {
  const call = reviewed(); const data = receiptSet(); let reads = 0;
  const fake = fakeRpc((method) => method === 'eth_getTransactionReceipt' ? data.receipt
    : method === 'eth_getTransactionByHash' ? data.transaction : method === 'eth_getBlockByNumber' ? data.block : undefined);
  const protocol = createProtocolWithDependencies({ rpc: fake.rpc, sdk: async () => ({ increasePosition: async () => { throw new Error('not permitted'); }, getPositions: async () => { reads++; return [{ positionId: 999 }]; } }) });
  const result = await protocol.observe(TX_HASH, call, signal());
  assert.equal(reads, 1); assert.equal(result?.positionId, 123n);
  assert.equal(result?.position?.collateralStEthWei, WAD * 3n / 10n);
  assert.equal(result?.position?.debtFxUsdWei, 606n * WAD);
});
test('confirmed ownership can precede accounting; missing facts are never zero', async () => {
  const call = reviewed(); const data = receiptSet();
  const fake = fakeRpc((method, params) => {
    if (method === 'eth_getTransactionReceipt') return data.receipt;
    if (method === 'eth_getTransactionByHash') return data.transaction;
    if (method === 'eth_getBlockByNumber') return data.block;
    if (method === 'eth_call') {
      const transaction = params[0] as { data: Hash };
      if (decodeFunctionData({ abi: READ_ABI, data: transaction.data }).functionName === 'getPosition') throw new Error('accounting unavailable');
    }
  });
  const protocol = createProtocolWithDependencies({ rpc: fake.rpc, sdk: async () => ({ increasePosition: async () => fixture(), getPositions: async () => [] }) });
  const result = await protocol.observe(TX_HASH, call, signal());
  assert.equal(result?.status, 'success'); assert.equal(result?.positionId, 123n);
  assert.equal(result?.position, undefined);
});
test('reorg during position refresh remains unresolved', async () => {
  const data = receiptSet(); let receipts = 0;
  const fake = fakeRpc((method) => {
    if (method === 'eth_getTransactionReceipt') return ++receipts === 1 ? data.receipt : { ...data.receipt, blockHash: REORG_HASH };
    if (method === 'eth_getTransactionByHash') return data.transaction;
    if (method === 'eth_getBlockByNumber') return data.block;
  });
  const protocol = createProtocolWithDependencies({ rpc: fake.rpc, sdk: async () => ({ increasePosition: async () => fixture(), getPositions: async () => [] }) });
  assert.equal(await protocol.observe(TX_HASH, reviewed(), signal()), null);
});
test('a transfer before publication removes position authority without denying the receipt', async () => {
  const data = receiptSet(); let owners = 0;
  const fake = fakeRpc((method, params) => {
    if (method === 'eth_getTransactionReceipt') return data.receipt;
    if (method === 'eth_getTransactionByHash') return data.transaction;
    if (method === 'eth_getBlockByNumber') return data.block;
    if (method === 'eth_call') {
      const transaction = params[0] as { data: Hash };
      if (decodeFunctionData({ abi: READ_ABI, data: transaction.data }).functionName === 'ownerOf' && ++owners >= 4) {
        return encodeFunctionResult({ abi: POOL_ABI, functionName: 'ownerOf', result: OTHER });
      }
    }
  });
  const protocol = createProtocolWithDependencies({ rpc: fake.rpc, sdk: async () => ({ increasePosition: async () => fixture(), getPositions: async () => [] }) });
  const result = await protocol.observe(TX_HASH, reviewed(), signal());
  assert.equal(result?.status, 'success'); assert.equal(result?.positionId, undefined); assert.equal(result?.position, undefined);
});

const URL_A = 'https://eth-mainnet.g.alchemy.com/v2/testing';
const URL_B = 'https://mainnet.infura.io/v3/testing';
type Envelope = { id: number; jsonrpc: string; method: string; params: unknown[] };
function fetchRpc(handler: (url: string, request: Envelope) => unknown | Promise<unknown>): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Envelope;
    const response = await handler(String(input), request);
    return response instanceof Response ? response : Response.json({ jsonrpc: '2.0', id: request.id, result: response });
  }) as typeof fetch;
}
test('RPC configuration restricts endpoints and explicit local fork mode', () => {
  assert.deepEqual(validatedUrls([URL_A, URL_A, URL_B]), [URL_A, URL_B]);
  for (const url of ['https://rpc.evil.test', `${URL_A}?key=other`, 'https://user:pass@mainnet.infura.io/v3/a', 'http://127.0.0.1:8545']) assert.throws(() => validatedUrls([url]));
  assert.throws(() => validatedUrls([]));
  assert.deepEqual(validatedUrls(['http://127.0.0.1:8545'], true), ['http://127.0.0.1:8545/']);
  assert.throws(() => validatedUrls([URL_A], true));
});
test('each endpoint proves its own chain before any financial read', async () => {
  const seen: string[] = [];
  const rpc = createRpc({ rpcUrls: [URL_A, URL_B], fetch: fetchRpc((url, request) => {
    seen.push(`${url}:${request.method}`);
    if (request.method === 'eth_chainId') return url === URL_A ? '0x2105' : '0x1';
    return '0x64';
  }) });
  assert.equal(await rpc.request('eth_blockNumber', [], signal()), '0x64');
  assert.deepEqual(seen, [`${URL_A}:eth_chainId`, `${URL_B}:eth_chainId`, `${URL_B}:eth_blockNumber`]);
});
test('proof expiry and backward clock movement force fresh chain identity', async () => {
  let clock = 1_000; let probes = 0;
  const rpc = createRpc({ rpcUrls: [URL_A], now: () => clock, fetch: fetchRpc((_url, request) => { if (request.method === 'eth_chainId') probes++; return '0x1'; }) });
  await rpc.request('eth_blockNumber', [], signal());
  await rpc.request('eth_blockNumber', [], signal()); assert.equal(probes, 1);
  clock += 60_000; await rpc.request('eth_blockNumber', [], signal()); assert.equal(probes, 2);
  clock = 0; await rpc.request('eth_blockNumber', [], signal()); assert.equal(probes, 3);
});
test('terminal chain rejection never falls through to another endpoint', async () => {
  const urls: string[] = [];
  const rpc = createRpc({ rpcUrls: [URL_A, URL_B], fetch: fetchRpc((url, request) => {
    urls.push(url); if (request.method === 'eth_chainId') return '0x1';
    return Response.json({ jsonrpc: '2.0', id: request.id, error: { code: 3, message: 'revert with untrusted details' } });
  }) });
  await assert.rejects(rpc.request('eth_call', [], signal()), code('simulation'));
  assert.ok(urls.every((url) => url === URL_A));
});
test('ambiguous envelopes and signing methods cannot cross the read transport', async () => {
  let requests = 0;
  const rpc = createRpc({ rpcUrls: [URL_A], fetch: fetchRpc((_url, request) => {
    requests++;
    return Response.json({ jsonrpc: '2.0', id: request.id, result: '0x1', error: { code: -1 } });
  }) });
  await assert.rejects(rpc.prove(signal()), code('unavailable'));
  const before = requests;
  await assert.rejects(rpc.request('eth_sendTransaction', [], signal()), code('policy'));
  await assert.rejects(rpc.request('personal_sign', [], signal()), code('policy'));
  assert.equal(requests, before);
});
test('local chain ID alone cannot prove an Anvil Ethereum fork', async () => {
  const options = { rpcUrls: ['http://localhost:8545'], allowLocalFork: true };
  const invalid = createRpc({ ...options, fetch: fetchRpc((_url, request) => request.method === 'eth_chainId' ? '0x1' : {}) });
  await assert.rejects(invalid.prove(signal()));
  const valid = createRpc({ ...options, fetch: fetchRpc((_url, request) => request.method === 'eth_chainId' ? '0x1'
    : { clientVersion: 'anvil/v1.4.4', chainId: 1, forkedNetwork: { chainId: 1, forkBlockHash: BLOCK_HASH } }) });
  await valid.prove(signal());
});
test('deadline covers an uncooperative dependency and late response body', async () => {
  await assert.rejects(bounded(signal(), 10, async () => new Promise<never>(() => undefined)), code('unavailable'));
  const rpc = createRpc({ rpcUrls: [URL_A], requestTimeoutMs: 10, fetch: fetchRpc(() => new Response(new ReadableStream({ start() { /* deliberately no body chunks */ } }))) });
  await assert.rejects(rpc.prove(signal()), code('unavailable'));
});
test('abort cancels promptly even if the SDK ignores its caller', async () => {
  const controller = new AbortController();
  const fake = fakeRpc();
  const protocol = createProtocolWithDependencies({ rpc: fake.rpc, sdk: async () => ({ increasePosition: async () => new Promise<never>(() => undefined), getPositions: async () => [] }) });
  const pending = protocol.prepare(intent, session, controller.signal);
  controller.abort(); await assert.rejects(pending, code('cancelled'));
});

// Keep an independent ABI declaration in the test as a selector cross-check.
test('pinned entry selector is the documented five-argument V2 entry', () => {
  const abi = parseAbi(['function openOrAddPositionFlashLoanV2((address,uint256,address,bytes,uint256,bytes),address,uint256,uint256,bytes) payable']);
  const call = reviewed();
  assert.equal(decodeFunctionData({ abi, data: call.data }).functionName, 'openOrAddPositionFlashLoanV2');
});
