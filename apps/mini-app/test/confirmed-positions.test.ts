import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PositionInfo } from '@aladdindao/fx-sdk';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex, type TransactionReceipt } from 'viem';
import {
  ConfirmedPositionNotReadyError,
  deriveConfirmedPositionHint,
  receiptMintedPositionIdentity,
  parseConfirmedPositionHint,
  POSITION_TRANSFER_EVENT,
  readConfirmedPosition,
  verifyConfirmedPositionHint,
  type ConfirmedPositionHint,
  type ConfirmedPositionReadDependencies,
} from '../src/lib/confirmedPositions';
import { capabilityPolicy, positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from '../src/lib/fx/policy';
import type { PlannedRoute, PlannedTransaction, ReviewedActionIntent, TransactionExecutionResult } from '../src/lib/fx/types';

const WALLET = '0x1111111111111111111111111111111111111111' as Address;
const OTHER = '0x2222222222222222222222222222222222222222' as Address;
const TX_HASH = `0x${'aa'.repeat(32)}` as Hex;
const BLOCK_HASH = `0x${'bb'.repeat(32)}` as Hex;
const OTHER_HASH = `0x${'cc'.repeat(32)}` as Hex;
const CONVERTER = '0x12AF4529129303D7FbD2563E242C4a2890525912' as Address;
const CONVERTER_ABI = parseAbi(['function convert(address tokenIn,uint256 amount,uint256 encoding,uint256[] routes)']);
const CONVERT_IN = '(address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature)';
const ACTION_ABI = parseAbi([
  `function openOrAddPositionFlashLoanV2(${CONVERT_IN} params,address pool,uint256 positionId,uint256 borrowAmount,bytes data) payable`,
  `function openOrAddShortPositionFlashLoan(${CONVERT_IN} params,address pool,uint256 positionId,uint256 debtTokenBorrowAmount,bytes data) payable`,
  `function borrowFromLong(${CONVERT_IN} convertInParams,(address pool,uint256 positionId,uint256 borrowAmount) borrowParams)`,
]);

function convertData(token: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: CONVERTER_ABI, functionName: 'convert', args: [token, amount, 0n, []] });
}

function transferLog(pool = positionPoolAddress('ETH', 'long'), overrides: {
  from?: Address; to?: Address; positionId?: bigint; address?: Address;
  removed?: boolean; data?: Hex; topics?: readonly Hex[]; transactionHash?: Hex; blockHash?: Hex; blockNumber?: bigint; logIndex?: number;
} = {}): TransactionReceipt['logs'][number] {
  return {
    address: overrides.address ?? pool,
    data: overrides.data ?? '0x',
    topics: overrides.topics ?? encodeEventTopics({
      abi: [POSITION_TRANSFER_EVENT], eventName: 'Transfer',
      args: { from: overrides.from ?? zeroAddress, to: overrides.to ?? WALLET, tokenId: overrides.positionId ?? 42n },
    }),
    removed: overrides.removed ?? false,
    transactionHash: overrides.transactionHash ?? TX_HASH,
    blockHash: overrides.blockHash ?? BLOCK_HASH,
    blockNumber: overrides.blockNumber ?? 100n,
    logIndex: overrides.logIndex ?? 0,
    transactionIndex: 0,
  } as TransactionReceipt['logs'][number];
}

function fixture(options: {
  market?: 'ETH' | 'BTC'; side?: 'long' | 'short'; operation?: 'increasePosition' | 'depositAndMint'; positionId?: number;
} = {}) {
  const market = options.market ?? 'ETH';
  const side = options.side ?? 'long';
  const operation = options.operation ?? 'increasePosition';
  const requestedId = options.positionId ?? 0;
  const pool = positionPoolAddress(market, side);
  const input = positionCollateralTokenAddress(market, side);
  const debt = positionDebtTokenAddress(market, side);
  const conversion = { tokenIn: input, amount: 10n, target: CONVERTER, data: convertData(input, 10n), minOut: 10n, signature: '0x' as Hex };
  const flash = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes' }],
    [1n, 3n, CONVERTER, convertData(debt, 3n)],
  );
  const intent: ReviewedActionIntent = operation === 'depositAndMint'
    ? { kind: 'deposit-and-mint', poolAddress: pool, positionId: requestedId, depositTokenAddress: input, depositAmount: 10n, nativeInput: false, mintAmount: 3n }
    : { kind: 'position-increase', poolAddress: pool, positionId: requestedId, inputTokenAddress: input, inputAmount: 10n, nativeInput: false, collateralTokenAddress: input, debtTokenAddress: debt, positionType: side };
  const policy = capabilityPolicy({ walletAddress: WALLET, chainId: 1, operation, reviewedAction: intent });
  const transaction: PlannedTransaction = {
    operation, chainId: 1, from: WALLET, to: policy.allowedActionDestinations![0], kind: 'action', type: 'action', value: 0n, nonce: 2,
    data: operation === 'depositAndMint'
      ? encodeFunctionData({ abi: ACTION_ABI, functionName: 'borrowFromLong', args: [conversion, { pool, positionId: BigInt(requestedId), borrowAmount: 3n }] })
      : encodeFunctionData({ abi: ACTION_ABI, functionName: side === 'long' ? 'openOrAddPositionFlashLoanV2' : 'openOrAddShortPositionFlashLoan', args: [conversion, pool, BigInt(requestedId), 3n, flash] }),
  };
  const route: PlannedRoute = { operation, chainId: 1, walletAddress: WALLET, policy, transactions: [transaction] };
  const receipt = {
    status: 'success', transactionHash: TX_HASH, blockNumber: 100n, blockHash: BLOCK_HASH,
    from: WALLET, to: transaction.to, logs: [transferLog(pool)],
  } as unknown as TransactionReceipt;
  const result: TransactionExecutionResult = {
    status: 'confirmed', operation, chainId: 1, walletAddress: WALLET,
    steps: [{ index: 0, transaction: { ...transaction }, hash: TX_HASH, status: 'confirmed', receipt }],
  };
  return { route, result, receipt, walletAddress: WALLET, pool };
}

function routedFixture(options: Parameters<typeof fixture>[0] = {}) {
  const source = fixture(options);
  const actionAddress = source.route.transactions[0].to;
  source.receipt.logs = [
    transferLog(source.pool, { to: actionAddress, logIndex: 21 }),
    transferLog(source.pool, { from: actionAddress, to: WALLET, logIndex: 25 }),
  ];
  return source;
}

function hintFrom(source = fixture()): ConfirmedPositionHint {
  const hint = deriveConfirmedPositionHint(source);
  assert.ok(hint, 'valid reviewed new-position action must derive a hint');
  return hint;
}

function position(hint: ConfirmedPositionHint, overrides: Partial<PositionInfo> = {}): PositionInfo {
  const base = hint.market === 'ETH' ? 'wstETH' : 'WBTC';
  return {
    positionId: hint.positionId, rawColls: 10n ** 18n, rawDebts: 5n * 10n ** 17n,
    currentLeverage: 2, lsdLeverage: hint.side === 'short' ? 1 : 2,
    rawCollsToken: hint.side === 'short' ? 'fxUSD' : hint.market === 'ETH' ? 'ETH' : 'WBTC',
    rawDebtsToken: hint.side === 'short' ? base : 'fxUSD',
    rawCollsDecimals: 18, rawDebtsDecimals: 18, ...overrides,
  };
}

function dependencies(source = fixture(), options: {
  head?: bigint; chainId?: number; owner?: Address; receipt?: TransactionReceipt; positions?: PositionInfo[];
  readPositions?: NonNullable<ConfirmedPositionReadDependencies['sdk']>['getPositions'];
  readOwner?: () => Promise<Address>;
} = {}) {
  const calls: { method: string; args?: unknown }[] = [];
  const deps: ConfirmedPositionReadDependencies = {
    client: {
      getChainId: async () => { calls.push({ method: 'chain' }); return options.chainId ?? 1; },
      getBlockNumber: async () => { calls.push({ method: 'head' }); return options.head ?? 101n; },
      getTransactionReceipt: async (args: unknown) => { calls.push({ method: 'receipt', args }); return options.receipt ?? source.receipt; },
      readContract: async (args: unknown) => { calls.push({ method: 'owner', args }); return options.readOwner ? options.readOwner() : options.owner ?? WALLET; },
    } as NonNullable<ConfirmedPositionReadDependencies['client']>,
    sdk: {
      getPositions: async (args) => {
        calls.push({ method: 'sdk', args });
        return options.readPositions ? options.readPositions(args) : options.positions ?? [position(hintFrom(source))];
      },
    },
  };
  return { deps, calls };
}

test('confirmed mint hints use only the exact reviewed action and canonical pool in all four markets', () => {
  for (const market of ['ETH', 'BTC'] as const) {
    for (const side of ['long', 'short'] as const) {
      const source = fixture({ market, side });
      const hint = hintFrom(source);
      assert.deepEqual(hint, {
        version: 1, chainId: 1, operation: 'increasePosition', walletAddress: WALLET,
        market, side, poolAddress: positionPoolAddress(market, side), positionId: 42,
        transactionHash: TX_HASH, blockNumber: '100', blockHash: BLOCK_HASH,
      });
      assert.deepEqual(JSON.parse(JSON.stringify(hint)), hint, 'hints contain no bigint or financial snapshot');
    }
    assert.equal(hintFrom(fixture({ market, operation: 'depositAndMint' })).operation, 'depositAndMint');
  }
});

test('canonical action-router mint then wallet delivery proves the same NFT within one receipt', async () => {
  const sources = [
    ...(['ETH', 'BTC'] as const).flatMap((market) => (['long', 'short'] as const).map((side) => routedFixture({ market, side }))),
    routedFixture({ operation: 'depositAndMint', market: 'ETH' }),
    routedFixture({ operation: 'depositAndMint', market: 'BTC' }),
  ];
  for (const source of sources) {
    const hint = hintFrom(source);
    assert.equal(hint.positionId, 42);
    assert.equal(await verifyConfirmedPositionHint(hint, WALLET, dependencies(source).deps), true);
    assert.deepEqual(await readConfirmedPosition(hint, WALLET, dependencies(source).deps), { market: hint.market, side: hint.side, info: position(hint) });
    assert.equal(await verifyConfirmedPositionHint(hint, WALLET, dependencies(source, { owner: OTHER }).deps), false, 'router delivery does not replace current-owner verification');
  }
});

test('router mint paths reject wrong intermediates, wallets, IDs, ordering, extra transfers, and malformed delivery logs', async () => {
  const mutations: Array<(source: ReturnType<typeof routedFixture>) => void> = [
    (source) => { source.receipt.logs = [transferLog(source.pool, { to: OTHER, logIndex: 21 }), transferLog(source.pool, { from: OTHER, logIndex: 25 })]; },
    (source) => { source.receipt.logs[0] = transferLog(source.pool, { to: OTHER, logIndex: 21 }); },
    (source) => { source.receipt.logs[1] = transferLog(source.pool, { from: OTHER, logIndex: 25 }); },
    (source) => { source.receipt.logs[1] = transferLog(source.pool, { from: source.route.transactions[0].to, to: OTHER, logIndex: 25 }); },
    (source) => { source.receipt.logs[1] = transferLog(source.pool, { from: source.route.transactions[0].to, positionId: 43n, logIndex: 25 }); },
    (source) => { source.receipt.logs.reverse(); },
    (source) => { source.receipt.logs[1].logIndex = 20; },
    (source) => { source.receipt.logs[1].logIndex = 21; },
    (source) => { source.receipt.logs[0].logIndex = -1; },
    (source) => { source.receipt.logs[1].logIndex = 25.5; },
    (source) => { source.receipt.logs[1].logIndex = null as unknown as number; },
    (source) => { source.receipt.logs[0].removed = true; },
    (source) => { source.receipt.logs[1].removed = true; },
    (source) => { source.receipt.logs[1].data = '0x00'; },
    (source) => { source.receipt.logs[1].topics = [source.receipt.logs[1].topics[0]!, '0x00', '0x00', '0x00']; },
    (source) => { source.receipt.logs[1].transactionHash = OTHER_HASH; },
    (source) => { source.receipt.logs[1].blockHash = OTHER_HASH; },
    (source) => { source.receipt.logs[1].address = positionPoolAddress('BTC', 'short'); },
    (source) => { source.receipt.logs = [source.receipt.logs[0]]; },
    (source) => { source.receipt.logs.push(transferLog(source.pool, { from: WALLET, to: OTHER, logIndex: 26 })); },
    (source) => { source.receipt.logs.push(transferLog(source.pool, { positionId: 43n, logIndex: 26 })); },
    (source) => { source.receipt.logs[1] = transferLog(source.pool, { logIndex: 25 }); },
  ];
  const expectedHint = hintFrom(routedFixture());
  for (const mutate of mutations) {
    const source = routedFixture();
    mutate(source);
    assert.equal(deriveConfirmedPositionHint(source), null);
    assert.equal(await verifyConfirmedPositionHint(expectedHint, WALLET, dependencies(source).deps), false, 'restoration applies the same strict complete-transfer proof');
  }
  const source = fixture();
  source.receipt.logs.push(transferLog(source.pool, { from: WALLET, to: OTHER, logIndex: 1 }));
  assert.equal(deriveConfirmedPositionHint(source), null, 'a direct mint followed by any transfer is not the allowed direct path');
});

test('wrong contract, recipient, event, non-mint transfers, removed logs, and malformed logs produce no hint', () => {
  const malformed: Array<Parameters<typeof transferLog>[1]> = [
    { address: OTHER }, { to: OTHER }, { from: OTHER }, { removed: true },
    { data: '0x00' }, { topics: [OTHER_HASH] }, { topics: [] },
    { positionId: 0n }, { positionId: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
    { transactionHash: OTHER_HASH }, { blockHash: OTHER_HASH }, { blockNumber: 99n },
    { topics: [encodeEventTopics({ abi: [POSITION_TRANSFER_EVENT], eventName: 'Transfer' })[0]!, '0x00', '0x00', '0x00'] },
  ];
  for (const override of malformed) {
    const source = fixture();
    source.receipt.logs = [transferLog(source.pool, override)];
    assert.equal(deriveConfirmedPositionHint(source), null, JSON.stringify(override, (_, value) => typeof value === 'bigint' ? value.toString() : value));
  }
});

test('duplicate or competing pool mints are ambiguous even with one matching wallet', () => {
  for (const second of [{}, { positionId: 43n }, { to: OTHER }, { removed: true }]) {
    const source = fixture();
    source.receipt.logs.push(transferLog(source.pool, second));
    assert.equal(deriveConfirmedPositionHint(source), null);
  }
  const source = fixture();
  source.receipt.logs.push(transferLog(OTHER, { positionId: 99n }));
  assert.equal(hintFrom(source).positionId, 42, 'unrelated contracts cannot change the reviewed pool ID');
});

test('receipt confirmation, original account, action binding, and new-position intent are mandatory', () => {
  const mutations: Array<(source: ReturnType<typeof fixture>) => void> = [
    (source) => { source.result.status = 'partial'; },
    (source) => { source.result.status = 'failed'; },
    (source) => { source.result.chainId = 8453; },
    (source) => { source.route.chainId = 8453; },
    (source) => { source.result.walletAddress = OTHER; },
    (source) => { source.route.walletAddress = OTHER; },
    (source) => { source.result.operation = 'depositAndMint'; },
    (source) => { source.route.policy = undefined; },
    (source) => { source.receipt.status = 'reverted'; },
    (source) => { source.receipt.from = OTHER; },
    (source) => { source.receipt.to = OTHER; },
    (source) => { source.result.steps[0].hash = OTHER_HASH; },
    (source) => { source.result.steps[0].index = 1; },
    (source) => { source.result.steps[0].status = 'submitted'; },
    (source) => { source.result.steps[0].transaction.data = '0x'; },
    (source) => { source.result.steps[0].transaction.kind = 'approval'; },
    (source) => { source.route.transactions[0].data = '0x'; },
    (source) => { source.route.transactions[0].kind = 'approval'; },
    (source) => { source.route.transactions.push({ ...source.route.transactions[0] }); },
    (source) => { source.result.steps = []; },
    (source) => { source.receipt.logs = []; },
  ];
  for (const mutate of mutations) {
    const source = fixture();
    mutate(source);
    assert.equal(deriveConfirmedPositionHint(source), null);
  }
  assert.equal(deriveConfirmedPositionHint({ ...fixture(), walletAddress: OTHER }), null);
  assert.equal(deriveConfirmedPositionHint(fixture({ positionId: 42 })), null, 'an existing ID is never called newly minted');
});

test('a mint in a different market or side cannot populate the reviewed market', () => {
  const source = fixture({ market: 'ETH', side: 'short' });
  for (const pool of [positionPoolAddress('ETH', 'long'), positionPoolAddress('BTC', 'long'), positionPoolAddress('BTC', 'short')]) {
    source.receipt.logs = [transferLog(pool)];
    assert.equal(deriveConfirmedPositionHint(source), null);
  }
});

test('approval receipts cannot supply the action mint and every confirmed step remains bound to its reviewed transaction', () => {
  function approvedFixture() {
    const source = fixture();
    const action = source.route.transactions[0];
    const approval: PlannedTransaction = {
      ...action, nonce: 1, kind: 'approval', type: 'approveToken',
      to: positionCollateralTokenAddress('ETH', 'long'),
      data: encodeFunctionData({ abi: parseAbi(['function approve(address spender,uint256 amount)']), functionName: 'approve', args: [action.to, 10n] }),
    };
    source.route.transactions.unshift(approval);
    source.result.steps[0].index = 1;
    source.result.steps.unshift({
      index: 0, transaction: { ...approval }, hash: OTHER_HASH, status: 'confirmed',
      receipt: { ...source.receipt, transactionHash: OTHER_HASH, blockNumber: 99n, to: approval.to, logs: [] },
    });
    return source;
  }
  assert.equal(hintFrom(approvedFixture()).positionId, 42);
  const approvalOnlyMint = approvedFixture();
  approvalOnlyMint.result.steps[0].receipt!.logs = approvalOnlyMint.receipt.logs;
  approvalOnlyMint.receipt.logs = [];
  assert.equal(deriveConfirmedPositionHint(approvalOnlyMint), null);
  const wrongApprovalSender = approvedFixture();
  wrongApprovalSender.result.steps[0].receipt!.from = OTHER;
  assert.equal(deriveConfirmedPositionHint(wrongApprovalSender), null);
  const laterApproval = approvedFixture();
  laterApproval.result.steps[0].receipt!.blockNumber = 101n;
  assert.equal(deriveConfirmedPositionHint(laterApproval), null);
});

test('restored hints enforce exact schema, safe integers, canonical pool pairing, and account boundaries', () => {
  const hint = hintFrom();
  assert.deepEqual(parseConfirmedPositionHint(JSON.parse(JSON.stringify(hint)), WALLET), hint);
  const invalid: unknown[] = [
    null, [], {}, { ...hint, version: 2 }, { ...hint, chainId: 8453 }, { ...hint, walletAddress: OTHER },
    { ...hint, market: 'BTC' }, { ...hint, side: 'short' }, { ...hint, poolAddress: OTHER },
    { ...hint, operation: 'reducePosition' }, { ...hint, blockNumber: 100 }, { ...hint, blockNumber: '0100' },
    { ...hint, blockNumber: '-1' }, { ...hint, blockNumber: '0' }, { ...hint, blockNumber: (1n << 256n).toString() },
    { ...hint, positionId: 0 }, { ...hint, positionId: 1.5 }, { ...hint, positionId: Number.MAX_SAFE_INTEGER + 1 },
    { ...hint, positionId: '42' }, { ...hint, transactionHash: '0x00' }, { ...hint, blockHash: '0x00' },
    { ...hint, rawColls: '1000' }, { ...hint, walletAddress: zeroAddress },
    { ...hint, operation: 'depositAndMint', side: 'short', poolAddress: positionPoolAddress('ETH', 'short') },
  ];
  for (const value of invalid) assert.equal(parseConfirmedPositionHint(value, WALLET), null);
  const { blockHash: _unused, ...missingField } = hint;
  assert.equal(parseConfirmedPositionHint(missingField, WALLET), null);
});

test('verification requires the canonical receipt, original successful receipt and current owner, never SDK data', async () => {
  const source = fixture();
  const hint = hintFrom(source);
  const good = dependencies(source);
  assert.equal(await verifyConfirmedPositionHint(hint, WALLET, good.deps), true);
  assert.equal(good.calls.filter(({ method }) => method === 'sdk').length, 0);
  const ownerCall = good.calls.find(({ method }) => method === 'owner')!.args as { address: Address; functionName: string; args: bigint[] };
  assert.equal(ownerCall.address, hint.poolAddress);
  assert.equal(ownerCall.functionName, 'ownerOf');
  assert.deepEqual(ownerCall.args, [42n]);
  for (const options of [
    { owner: OTHER },
    { receipt: { ...source.receipt, blockHash: OTHER_HASH } },
    { receipt: { ...source.receipt, status: 'reverted' as const } },
    { receipt: { ...source.receipt, from: OTHER } },
    { receipt: { ...source.receipt, to: OTHER } },
    { receipt: { ...source.receipt, logs: [transferLog(source.pool, { removed: true })] } },
    { receipt: { ...source.receipt, logs: [transferLog(source.pool, { positionId: 43n })] } },
  ]) {
    assert.equal(await verifyConfirmedPositionHint(hint, WALLET, dependencies(source, options).deps), false);
  }
  const otherWallet = dependencies(source);
  assert.equal(await verifyConfirmedPositionHint(hint, OTHER, otherWallet.deps), false);
  assert.deepEqual(otherWallet.calls, [], 'wallet changes are rejected before any read');
});

test('chain and RPC failures cannot become a verified discovery hint or SDK read', async () => {
  const source = fixture();
  const wrongChain = dependencies(source, { chainId: 8453 });
  await assert.rejects(readConfirmedPosition(hintFrom(source), WALLET, wrongChain.deps), /expected 1/);
  assert.deepEqual(wrongChain.calls.map(({ method }) => method), ['chain']);
  const failed = dependencies(source, { readOwner: async () => { throw new Error('RPC unavailable'); } });
  await assert.rejects(verifyConfirmedPositionHint(hintFrom(source), WALLET, failed.deps), /RPC unavailable/);
});

test('a not-yet-observable receipt block is retryable rather than disproving the confirmed hint', async () => {
  const source = fixture();
  const hint = hintFrom(source);
  for (const head of [99n]) {
    const pending = dependencies(source, { head });
    await assert.rejects(verifyConfirmedPositionHint(hint, WALLET, pending.deps), ConfirmedPositionNotReadyError);
    assert.equal(pending.calls.some(({ method }) => method === 'owner' || method === 'sdk'), false);
  }
  assert.equal(await verifyConfirmedPositionHint(hint, WALLET, dependencies(source, { head: 100n }).deps), true, 'the same retained hint becomes verifiable at the receipt block');
});

test('targeted hydration calls only the official affected group and returns only its receipt-proven ID', async () => {
  for (const market of ['ETH', 'BTC'] as const) {
    for (const side of ['long', 'short'] as const) {
      const source = fixture({ market, side });
      const hint = hintFrom(source);
      const info = position(hint);
      const { deps, calls } = dependencies(source, { positions: [position(hint, { positionId: 99 }), info] });
      assert.deepEqual(await readConfirmedPosition(hint, WALLET, deps), { market, side, info });
      assert.deepEqual(calls.filter(({ method }) => method === 'sdk').map(({ args }) => args), [{ userAddress: WALLET, market, type: side }]);
      assert.equal(calls.filter(({ method }) => method === 'owner').length, 2, 'ownership is rechecked after slow SDK reads');
    }
  }
});

test('ETH-long hydration accepts the SDK ETH accounting symbol, not its wstETH input-token symbol', async () => {
  const source = routedFixture({ market: 'ETH', side: 'long' });
  const hint = hintFrom(source);
  // fx-sdk@1.0.5's Position.getPositionInfo returns poolInfo.collSymbol,
  // and its wstETH long-pool config defines collSymbol:'ETH'. No units or
  // financial fields are reconstructed from the ERC-20 input token.
  const sdkInfo = position(hint, { rawCollsToken: 'ETH', rawDebtsToken: 'fxUSD', rawCollsDecimals: 18, rawDebtsDecimals: 18 });
  const hydrated = await readConfirmedPosition(hint, WALLET, dependencies(source, { positions: [sdkInfo] }).deps);
  assert.deepEqual(hydrated, { market: 'ETH', side: 'long', info: sdkInfo });
  assert.equal(hydrated?.info, sdkInfo, 'preserve the exact SDK accounting result');
  assert.equal(await readConfirmedPosition(hint, WALLET, dependencies(source, { positions: [position(hint, { rawCollsToken: 'wstETH' })] }).deps), null);
});

test('indexing-pending, duplicate, zeroed, negative, wrong-market, and malformed accounting never invent financials', async () => {
  const source = fixture();
  const hint = hintFrom(source);
  for (const positions of [
    [], [position(hint, { positionId: 99 })], [position(hint), position(hint)],
    [position(hint, { rawColls: 0n, rawDebts: 0n })], [position(hint, { rawColls: -1n })],
    [position(hint, { rawDebts: 1n << 256n })],
    [position(hint, { rawCollsToken: 'WBTC' })], [position(hint, { rawDebtsToken: 'wstETH' })],
    [position(hint, { rawCollsDecimals: -1 })], [position(hint, { rawDebtsDecimals: 1.5 })],
    [position(hint, { currentLeverage: Number.NaN })], [position(hint, { lsdLeverage: Number.POSITIVE_INFINITY })],
  ]) {
    assert.equal(await readConfirmedPosition(hint, WALLET, dependencies(source, { positions }).deps), null);
  }
  const noBlock = dependencies(source, { head: 99n });
  await assert.rejects(readConfirmedPosition(hint, WALLET, noBlock.deps), ConfirmedPositionNotReadyError);
  assert.equal(noBlock.calls.some(({ method }) => method === 'sdk'), false, 'no financial read before the receipt block');
});

test('an NFT transferred while the SDK is pending cannot hydrate the former owner portfolio', async () => {
  const source = fixture();
  let reads = 0;
  const { deps } = dependencies(source, { readOwner: async () => ++reads === 1 ? WALLET : OTHER });
  assert.equal(await readConfirmedPosition(hintFrom(source), WALLET, deps), null);
  assert.equal(reads, 2);
});

test('receipt presentation exposes only the exact newly minted Trade or Borrow identity', () => {
  const cases = [
    { source: fixture({ operation: 'increasePosition', market: 'ETH', side: 'long' }), market: 'ETH', side: 'long' },
    { source: fixture({ operation: 'increasePosition', market: 'BTC', side: 'short' }), market: 'BTC', side: 'short' },
    { source: fixture({ operation: 'depositAndMint', market: 'ETH' }), market: 'ETH', side: 'long' },
    { source: fixture({ operation: 'depositAndMint', market: 'BTC' }), market: 'BTC', side: 'long' },
    { source: routedFixture({ operation: 'increasePosition', market: 'ETH', side: 'short' }), market: 'ETH', side: 'short' },
    { source: routedFixture({ operation: 'increasePosition', market: 'BTC', side: 'long' }), market: 'BTC', side: 'long' },
    { source: routedFixture({ operation: 'depositAndMint', market: 'ETH' }), market: 'ETH', side: 'long' },
    { source: routedFixture({ operation: 'depositAndMint', market: 'BTC' }), market: 'BTC', side: 'long' },
  ] as const;
  for (const { source, market, side } of cases) {
    assert.deepEqual(receiptMintedPositionIdentity(source), {
      market, side, positionId: 42, transactionHash: TX_HASH,
    });
  }

  const ambiguous = fixture({ operation: 'depositAndMint', market: 'ETH' });
  ambiguous.receipt.logs = [transferLog(ambiguous.pool, { to: OTHER })];
  assert.equal(receiptMintedPositionIdentity(ambiguous), null);
  const unconfirmed = fixture({ operation: 'increasePosition', market: 'ETH' });
  unconfirmed.result.status = 'partial';
  assert.equal(receiptMintedPositionIdentity(unconfirmed), null);

  assert.equal(receiptMintedPositionIdentity(fixture({ operation: 'increasePosition', positionId: 42 })), null, 'an existing Trade position is not a new mint');
  assert.equal(receiptMintedPositionIdentity(fixture({ operation: 'depositAndMint', positionId: 42 })), null, 'an existing Borrow position is not a new mint');
});


// A new result uses minted identity, not a guessed ID from the quote.
test('new Trade readback requires receipt identity and a genuinely post-confirmation matching pool read', async () => {
  const { confirmedPositionReadback } = await import('../src/components/review/positionReview');
  const source = fixture();
  const fresh = { readStartedAt: 1001, readCompletedAt: 1002, status: 'ready', successfulGroups: [{market:'ETH',side:'long'}], failedGroups: [], positions: [{market:'ETH',side:'long',info:{positionId:42,rawColls:358481260986328125n,rawDebts:720891476593066406250n,rawCollsToken:'stETH',rawDebtsToken:'fxUSD',rawCollsDecimals:18,rawDebtsDecimals:18,currentLeverage:2,lsdLeverage:0}}] } as const;
  const readback = confirmedPositionReadback(source.result, source.route, fresh as any, 1000);
  assert.equal(readback?.key, 'ETH:long:42');
  assert.equal(readback?.facts.find(fact=>fact.label==='Collateral')?.value, '0.358481260986328125 stETH');
  assert.equal(readback?.facts.find(fact=>fact.label==='Debt')?.value, '720.89147659306640625 fxUSD');
  assert.equal(confirmedPositionReadback(source.result, source.route, {...fresh,readStartedAt:999} as any,1000),null);
  assert.equal(confirmedPositionReadback(source.result, source.route, {...fresh,successfulGroups:[]} as any,1000),null);
  assert.equal(confirmedPositionReadback(source.result, source.route, {...fresh,positions:[{...fresh.positions[0],info:{...fresh.positions[0].info,positionId:99}}]} as any,1000),null);
  source.receipt.logs=[];
  assert.equal(confirmedPositionReadback(source.result, source.route, fresh as any,1000),null);
});
