import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { custom, decodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import type { Abi } from 'viem';
import type { Hash, LongIntent, WalletSession } from '../src/domain/ports';
import { ADDRESSES, CONVERTER_ABI, DEBT_ROUTE, FEE_ABI, INPUT_ROUTE, MANAGER_ABI, ORACLE_ABI, POOL_ABI, WAD } from '../src/protocol/contracts';
import { validateSdkLong } from '../src/protocol/policy';
import type { PoolSnapshot } from '../src/protocol/reads';

const require = createRequire(import.meta.url);
const entry = require.resolve('@aladdindao/fx-sdk');
const vendorRequire = createRequire(entry);
const Decimal = vendorRequire('decimal.js');
const variants = ['index.js', 'index.cjs'] as const;

function between(source: string, start: string, end: string): string {
  const first = source.indexOf(start); const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Installed vendor source anchors: ${start}`);
  return source.slice(first, last);
}
function executable(source: string, name: string, end: string, globals: Record<string, unknown> = {}): any {
  return runInNewContext(`${between(source, `var ${name} =`, end)}; ${name}`, globals, { timeout: 1_000 });
}
function searchFrom(source: string, evaluator: (amount: bigint, index: number) => unknown) {
  const queried: bigint[] = [];
  const search = executable(source, 'searchAmount', 'var selectBest =', {
    contracts: { TokenConverter_MultiPathConverter: ADDRESSES.converter }, MultiPathConverter_default: [], getClient: () => ({}),
    batchedMulticall: async (_client: unknown, calls: { args: string[] }[]) => calls.map((call, index) => {
      const amount = BigInt(call.args[0]!); queried.push(amount);
      return evaluator(amount, index);
    }),
  });
  return { search: (left: string, right: string, target: string, precision = 1) => search(left, right, target, { encoding: 1n, routes: [] }, precision) as Promise<[string, number, number]>, queried };
}

for (const variant of variants) {
  const source = await readFile(path.join(path.dirname(entry), variant), 'utf8');
  test(`${variant}: installed uint60 packing preserves both bounds and rejects overflow`, () => {
    const pack = executable(source, 'getEncodeMiscData', 'var getEncodeMiscDataWithSlippage =');
    const minimum = 123_456_789_012_345_678n; const maximum = 987_654_321_098_765_432n;
    const encoded = BigInt(pack(String(minimum), String(maximum)));
    assert.equal(encoded & ((1n << 60n) - 1n), minimum);
    assert.equal(encoded >> 60n, maximum);
    for (const [a, b] of [['1', String(1n << 60n)], ['4', '3'], ['-1', '2'], ['1.1', '2'], ['', '2'], ['1e2', '200']]) assert.throws(() => pack(a, b));
  });
  test(`${variant}: installed borrowing search rejects unquoted dust and accepts only exact zero debt`, async () => {
    const { search, queried } = searchFrom(source, (amount) => ({ status: 'success', result: amount }));
    await assert.rejects(search('0', '5', '4', 5), /too small to quote reliably/);
    assert.equal(queried.length, 0);
    assert.equal((await search('0', '0', '0'))[0], '0');
    assert.equal(queried.length, 0);
    await assert.rejects(search('1', '1', '0'), /Invalid converter search range/);
    await assert.rejects(search('0', '100', '1', 0), /Invalid converter search amounts/);
  });
  test(`${variant}: installed search returns an evaluated sufficient upper endpoint including remainders`, async () => {
    const { search, queried } = searchFrom(source, (amount) => ({ status: 'success', result: amount * 2n }));
    const [value] = await search('0', '103', '206');
    assert.equal(value, '103'); assert.ok(queried.includes(103n));
    const [refined] = await search('0', '10000', '11113', 3);
    assert.ok(BigInt(refined) * 2n >= 11113n); assert.ok(queried.includes(BigInt(refined)));
  });
  test(`${variant}: installed search rejects flat, decreasing, failed and unbracketed quotes`, async () => {
    for (const evaluate of [
      () => ({ status: 'success', result: 5n }),
      (amount: bigint) => ({ status: 'success', result: 1_000n - amount }),
      () => ({ status: 'failure', result: undefined }),
      () => ({ status: 'success', result: '100' }),
    ]) await assert.rejects(searchFrom(source, evaluate).search('0', '100', '50'));
    const increasing = searchFrom(source, (amount) => ({ status: 'success', result: amount }));
    await assert.rejects(increasing.search('0', '1000', '1'), /outside the quoted range/);
    await assert.rejects(increasing.search('0', '100', '101'), /outside the quoted range/);
  });
  test(`${variant}: installed multicall keeps cross-call pacing without sleeping after the last batch`, async () => {
    let clock = 0; const sleeps: number[] = []; const starts: number[] = [];
    const code = between(source, 'var MULTICALL_BATCH_SIZE =', '// Never return an unqueried positive borrowing amount.');
    const batch = runInNewContext(`${code}; batchedMulticall`, {
      Date: { now: () => clock }, setTimeout: (callback: () => void, delay: number) => { sleeps.push(delay); clock += delay; callback(); },
    });
    const client = { multicall: async ({ contracts }: { contracts: number[] }) => { starts.push(clock); return contracts; } };
    assert.equal((await batch(client, [1])).length, 1); assert.deepEqual(sleeps, []);
    clock = 200; await batch(client, [2]); assert.deepEqual(sleeps, [300]);
    await batch(client, Array.from({ length: 51 }, (_, i) => i));
    assert.deepEqual(starts, [0, 500, 1_000, 1_500]);
    assert.deepEqual(sleeps, [300, 500, 500]);
  });
  function poolClass(globals: Record<string, unknown> = {}) {
    return executable(source, 'Pool', '// Preserve the already-read fee tuple', {
      pools: { wstETH: { isShort: false, poolAddress: ADDRESSES.pool } }, Price: class {},
      cBN: (value: unknown) => new Decimal(value), ...globals,
    });
  }
  test(`${variant}: installed pool starts independent views concurrently and preserves converter order`, async () => {
    const Pool = poolClass(); const instance = new Pool({ poolName: 'wstETH' });
    const starts: string[] = [];
    let poolResolve: (value: unknown) => void = () => undefined;
    let rateResolve: (value: unknown) => void = () => undefined;
    let oracleResolve: (value: unknown) => void = () => undefined;
    instance.getPoolData = () => { starts.push('pool'); return new Promise((resolve) => { poolResolve = resolve; }); };
    instance.price = {
      getRateRes: () => { starts.push('rate'); return new Promise((resolve) => { rateResolve = resolve; }); },
      getOraclePrice: () => { starts.push('oracle'); return new Promise((resolve) => { oracleResolve = resolve; }); },
      getBuyPrice: async () => { starts.push('buy'); return '3750'; },
      getSellPrice: async () => { starts.push('sell'); return '3750'; },
    };
    const pending = instance.getPoolInfo(); assert.deepEqual(starts, ['pool', 'rate', 'oracle']);
    poolResolve({ collateralCapacity: 100n, collateralBalance: 1n, debtCapacity: 200n, debtBalance: 2n });
    rateResolve(WAD * 5n / 4n); oracleResolve({ anchorPrice: 3000n * WAD });
    const result = await pending;
    assert.deepEqual(starts, ['pool', 'rate', 'oracle', 'buy', 'sell']);
    assert.equal(result.collRest, 99n); assert.equal(result.debtRest, 198n);
  });
  test(`${variant}: installed pool fails at the first relevant view without waiting for hung siblings`, async () => {
    const Pool = poolClass(); const instance = new Pool({ poolName: 'wstETH' });
    const expected = new Error('pool failed');
    instance.getPoolData = async () => { throw expected; };
    instance.price = { getRateRes: () => new Promise(() => undefined), getOraclePrice: async () => { throw new Error('secondary'); } };
    await assert.rejects(instance.getPoolInfo(), (error: unknown) => error === expected);
  });
  test(`${variant}: installed short pool uses its four-field tuple without fabricating raw collateral`, async () => {
    const Pool = poolClass({
      pools: { wstETH: { isShort: true, poolAddress: ADDRESSES.pool } },
      contracts: { ShortPoolManager: ADDRESSES.manager, PoolConfiguration: ADDRESSES.configuration, Router_Diamond: ADDRESSES.router, FxMintRouter: ADDRESSES.router },
      ShortPoolManager_default: [], AFPool_default: [], PoolConfiguration_default: [], getClient: () => ({}),
      batchedMulticall: async () => [
        { result: [100n, 10n, 200n, 20n] }, { result: false }, { result: [1n, 2n] },
        { result: [3n, 4n, 5n, 6n] }, { result: [7n, 8n, 9n, 10n] },
      ],
    });
    const result = await new Pool({ poolName: 'wstETH' }).getPoolData();
    assert.equal(result.debtCapacity, 200n); assert.equal(result.debtBalance, 20n);
    assert.equal(result.rawCollateral, 0n); assert.equal(result.repayFeeRatio, 10n);
  });
}

const MULTICALL_ABI = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
const RATE_ABI = parseAbi(['function getRate() view returns (uint256)']);
const ALL_READS: Abi = [...MANAGER_ABI, ...POOL_ABI, ...FEE_ABI, ...ORACLE_ABI, ...CONVERTER_ABI, ...RATE_ABI];
const owner = '0x1111111111111111111111111111111111111111';
const oracle = 3_000n * WAD;
const rate = WAD * 5n / 4n;
const snapshot: PoolSnapshot = { blockNumber: 100n, readAt: 1, paused: false,
  minimumDebtRatio: WAD / 20n, maximumDebtRatio: WAD * 9n / 10n,
  collateralRoom: 1_000n * WAD, debtRoom: 1_000_000n * WAD,
  anchorPrice: oracle, minimumPrice: oracle, maximumPrice: oracle, wrappingRate: rate, fees: [0n, 0n, 0n, 0n],
  nativeInputQuote: { amountWei: WAD / 10n, wstEthWei: 80_000_000_000_000_000n } };
const intent: LongIntent = { market: 'ETH', side: 'long', token: 'ETH', amountWei: WAD / 10n, leverageBps: 30_000, slippageBps: 100 };
const wallet: WalletSession = { id: 'real-sdk', address: owner, chainId: 1, label: 'Test' };

for (const variant of variants) {
  test(`${variant}: real installed increasePosition produces a native quote accepted by independent decoding and accounting`, { timeout: 20_000 }, async () => {
    const methods: string[] = []; let quoteReads = 0;
    function read(transaction: { to: string; data: Hash }): Hash {
      if (transaction.to.toLowerCase() === '0xca11bde05977b3631167028862be2a173976ca11') {
        const decoded = decodeFunctionData({ abi: MULTICALL_ABI, data: transaction.data });
        const rows = decoded.args[0].map((item) => ({ success: true, returnData: read({ to: item.target, data: item.callData }) }));
        return encodeFunctionResult({ abi: MULTICALL_ABI, functionName: 'aggregate3', result: rows });
      }
      const decoded = decodeFunctionData({ abi: ALL_READS, data: transaction.data });
      let result: unknown;
      switch (decoded.functionName) {
        case 'getPoolInfo': result = [1_000n * WAD, 0n, 0n, 1_000_000n * WAD, 0n]; break;
        case 'paused': result = false; break;
        case 'getDebtRatioRange': result = [snapshot.minimumDebtRatio, snapshot.maximumDebtRatio]; break;
        case 'getPoolFeeRatio': result = [0n, 0n, 0n, 0n]; break;
        case 'getPrice': result = [oracle, oracle, oracle]; break;
        case 'getRate': result = rate; break;
        case 'queryConvert': {
          assert.equal(transaction.to.toLowerCase(), ADDRESSES.converter); quoteReads++;
          const [amount, , routes] = decoded.args as readonly [bigint, bigint, readonly bigint[]];
          if (routes.length === INPUT_ROUTE.length && routes.every((value, index) => value === INPUT_ROUTE[index])) result = amount * WAD / rate;
          else if (routes.length === DEBT_ROUTE.length && routes.every((value, index) => value === DEBT_ROUTE[index])) result = amount * WAD * WAD / (oracle * rate);
          else { assert.equal(amount, 10n ** 16n, 'Only the SDK sell-price sample uses a third route'); result = amount * oracle * rate / (WAD * WAD); }
          break;
        }
        default: throw new Error(`Unexpected real SDK view ${decoded.functionName}`);
      }
      return encodeFunctionResult({ abi: ALL_READS, functionName: decoded.functionName, result });
    }
    const transport = custom({ request: async ({ method, params }) => {
      methods.push(method);
      if (method === 'eth_call') return read((params as unknown[])[0] as { to: string; data: Hash });
      if (method === 'eth_getTransactionCount') return '0x7';
      if (method === 'eth_chainId') return '0x1';
      throw new Error(`Unexpected real SDK request ${method}`);
    } }, { retryCount: 0 });
    const module = variant === 'index.cjs' ? require(path.join(path.dirname(entry), variant))
      : await import(pathToFileURL(path.join(path.dirname(entry), variant)).href);
    const sdk = new module.FxSdk({ chainId: 1, rpcUrls: ['https://eth-mainnet.g.alchemy.com/v2/deterministic-test'], rpcTransport: transport });
    const result = await sdk.increasePosition({ market: 'ETH', type: 'long', positionId: 0, userAddress: owner,
      inputTokenAddress: ADDRESSES.native, amount: intent.amountWei, leverage: 3, slippage: 1, targets: ['FxRoute'] });
    const verified = validateSdkLong(result, intent, wallet, snapshot);
    assert.equal(verified.call.nonce, 7); assert.equal(verified.call.value, intent.amountWei);
    assert.equal(result.routes.length, 1); assert.equal(result.routes[0].txs.length, 1);
    assert.ok(verified.economics.collateralStEthWei > 29n * WAD / 100n);
    assert.ok(verified.economics.debtFxUsdWei >= 600n * WAD);
    assert.ok(quoteReads > 100, 'Installed borrowing solver was exercised');
    assert.ok(methods.every((method) => method === 'eth_call' || method === 'eth_getTransactionCount' || method === 'eth_chainId'));
  });
}
