import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const sdkDist = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/@aladdindao/fx-sdk/dist');
const sdkRequire = createRequire(realpathSync(resolve(sdkDist, 'index.cjs')));
const Decimal = sdkRequire('decimal.js');
const { createFixture, viem } = createRequire(import.meta.url)('../e2e/trade-harness/long-review-rpc.cjs');
const cBN = (value: unknown) => new Decimal(value);
const READS = ['pool', 'rate', 'oracle', 'buy', 'sell'] as const;
type ReadName = typeof READS[number];
type PoolContext = { config: Record<string, unknown>; getPoolData: () => Promise<unknown>; price: Record<string, () => Promise<unknown>> };
type PoolMethod = (this: PoolContext) => Promise<Record<string, any>>;

test('concurrent spot quotes retain separate converter RPC execution contexts', async () => {
  const fixture = createFixture();
  fixture.sdk.setClient(viem.createPublicClient({
    chain: viem.mainnet,
    transport: viem.custom({ request: fixture.request }),
    batch: { multicall: true },
  }));
  const pool = new fixture.sdk.Pool({ poolName: 'wstETH' });
  await Promise.all([pool.price.getBuyPrice(), pool.price.getSellPrice()]);
  const spotCalls = fixture.events.filter((event: any) => event.reads.some((read: any) => read.name === 'queryConvert'));
  assert.equal(spotCalls.length, 2, 'each spot quote uses its own eth_call');
  assert.deepEqual(spotCalls.map((event: any) => event.reads.map((read: any) => read.name)), [
    ['queryConvert'], ['queryConvert'],
  ]);
});

function installedPoolMethod(bundle: string): PoolMethod {
  const source = readFileSync(resolve(sdkDist, bundle), 'utf8');
  const start = source.indexOf('  async getPoolInfo() {');
  const end = source.indexOf('\n  }\n};', start) + 4;
  assert.ok(start > 0 && end > start, `cannot locate installed ${bundle} Pool.getPoolInfo`);
  // Execute the installed implementation, not a separately reimplemented
  // scheduler. Nothing here imports or initializes a network client.
  return new Function('cBN', `return ({${source.slice(start, end)}}).getPoolInfo;`)(cBN) as PoolMethod;
}

function fixture(isShort = false, seed = 1) {
  return {
    config: { isShort, poolName: isShort ? 'wstETH_short' : 'wstETH', retainedMetadata: 'unchanged' },
    pool: {
      collateralCapacity: 10n ** 30n, collateralBalance: BigInt(seed),
      debtCapacity: 10n ** 29n, debtBalance: BigInt(seed) * 100n,
      isPaused: seed % 2 === 0, poolMinDebtRatio: 1n, poolMaxDebtRatio: 999999999999999999n,
      supplyFeeRatio: BigInt(seed) * 100001n, withdrawFeeRatio: BigInt(seed) * 99999n,
      repayFeeRatio: BigInt(seed) * 234567n,
      routerFeeRatios: [1n, 2n, 3n, 4n], mintFeeRatios: [4n, 3n, 2n, 1n],
    },
    rate: 10n ** 18n + BigInt(seed) * 987654321123n,
    oracle: { anchorPrice: BigInt(seed), minPrice: 1n, maxPrice: 10n ** 30n },
    buy: `${2000 + seed}.123456789123456789`,
    sell: `${1999 + seed}.987654321987654321`,
  };
}

function expectedPoolInfo(value: ReturnType<typeof fixture>) {
  const buy = cBN(value.buy).times(1e18).div(value.rate).toString();
  const sell = cBN(value.sell).times(1e18).div(value.rate).toString();
  return {
    ...value.config, ...value.pool, ...value.oracle,
    collRest: value.pool.collateralCapacity - value.pool.collateralBalance,
    debtRest: value.pool.debtCapacity - value.pool.debtBalance,
    rateRes: value.rate, averagePrice: cBN(buy).add(cBN(sell)).div(2).toString(),
    openPrice: value.config.isShort ? sell : buy,
    closePrice: value.config.isShort ? buy : sell,
    openFeeRatio: cBN(value.pool.supplyFeeRatio).div(1e9).toNumber(),
    closeFeeRatio: cBN(value.pool.withdrawFeeRatio).div(1e9).toNumber(),
    repayFeeRatio: cBN(value.pool.repayFeeRatio).div(1e9).toNumber(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((done) => setImmediate(done));

function context(read: (name: ReadName) => Promise<unknown>, config = fixture().config): PoolContext {
  return { config, getPoolData: () => read('pool'), price: {
    getRateRes: () => read('rate'), getOraclePrice: () => read('oracle'),
    getBuyPrice: () => read('buy'), getSellPrice: () => read('sell'),
  } };
}

for (const bundle of ['index.js', 'index.cjs']) {
  test(`${bundle}: view reads start together, map out-of-order results, and keep converter calls separate`, async () => {
    const method = installedPoolMethod(bundle);
    const value = fixture();
    const gates = Object.fromEntries(READS.map((name) => [name, deferred<unknown>()])) as Record<ReadName, ReturnType<typeof deferred<unknown>>>;
    const started: ReadName[] = [];
    const pending = method.call(context((name) => { started.push(name); return gates[name].promise; }));
    // Baseline fails here: it starts only the pool read.
    assert.deepEqual(started, ['pool', 'rate', 'oracle']);
    gates.oracle.resolve(value.oracle);
    gates.rate.resolve(value.rate);
    await flush();
    assert.deepEqual(started, ['pool', 'rate', 'oracle'], 'no quote until all view reads settle');
    gates.pool.resolve(value.pool);
    await flush();
    assert.deepEqual(started, [...READS], 'both independent spot quotes start together');
    gates.sell.resolve(value.sell);
    await flush();
    gates.buy.resolve(value.buy);
    assert.deepEqual(await pending, expectedPoolInfo(value));
    assert.equal(new Set(started).size, 5, 'each read invoked exactly once');
  });

  test(`${bundle}: pool metadata and Decimal results are identical over both sides and boundary-sized values`, async () => {
    const method = installedPoolMethod(bundle);
    const precision = Decimal.precision;
    for (const isShort of [false, true]) for (let seed = 0; seed < 64; seed += 1) {
      const value = fixture(isShort, seed);
      const calls: ReadName[] = [];
      const result = await method.call(context(async (name) => { calls.push(name); return value[name]; }, value.config));
      assert.deepEqual(result, expectedPoolInfo(value));
      assert.deepEqual(calls, [...READS]);
    }
    assert.equal(Decimal.precision, precision, 'never mutate global Decimal precision');
  });

  test(`${bundle}: every individual read failure blocks output and all started rejections are observed`, async () => {
    const method = installedPoolMethod(bundle);
    for (const failed of READS) {
      const failure = failed === 'rate' ? new DOMException('aborted', 'AbortError') : new Error(`${failed} unavailable`);
      const value = fixture();
      const calls: ReadName[] = [];
      await assert.rejects(method.call(context(async (name) => {
        calls.push(name);
        if (name === failed) throw failure;
        return value[name];
      })), (cause: unknown) => cause === failure);
      assert.deepEqual(calls, failed === 'buy' || failed === 'sell' ? [...READS] : ['pool', 'rate', 'oracle']);
    }
    // The node:test runner treats unhandled rejections as test failures.
    await flush();
  });

  test(`${bundle}: concurrent failures preserve pool-before-rate-before-oracle error priority`, async () => {
    const method = installedPoolMethod(bundle);
    for (const earliest of ['pool', 'rate', 'oracle'] as const) {
      const gates = Object.fromEntries(READS.map((name) => [name, deferred<unknown>()])) as Record<ReadName, ReturnType<typeof deferred<unknown>>>;
      const errors = { pool: new Error('pool failed'), rate: new Error('rate failed'), oracle: new Error('oracle failed') };
      const calls: ReadName[] = [];
      const pending = method.call(context((name) => { calls.push(name); return gates[name].promise; }));
      const rejection = assert.rejects(pending, (cause: unknown) => cause === errors[earliest]);
      // Reject later reads before the pool settles; none may leak unhandled.
      gates.oracle.reject(errors.oracle);
      await flush();
      if (earliest === 'oracle') gates.rate.resolve(fixture().rate); else gates.rate.reject(errors.rate);
      await flush();
      if (earliest === 'pool') gates.pool.reject(errors.pool); else gates.pool.resolve(fixture().pool);
      await rejection;
      assert.deepEqual(calls, ['pool', 'rate', 'oracle']);
    }
    await flush();
  });

  test(`${bundle}: an early pool failure returns without waiting for slow siblings`, async () => {
    const method = installedPoolMethod(bundle);
    const gates = Object.fromEntries(READS.map((name) => [name, deferred<unknown>()])) as Record<ReadName, ReturnType<typeof deferred<unknown>>>;
    const failure = new Error('pool failed immediately');
    const calls: ReadName[] = [];
    const pending = method.call(context((name) => { calls.push(name); return gates[name].promise; }));
    let observed: unknown;
    void pending.catch((cause: unknown) => { observed = cause; });
    gates.pool.reject(failure);
    await flush();
    assert.equal(observed, failure, 'slow siblings must not delay the relevant failure');
    assert.deepEqual(calls, ['pool', 'rate', 'oracle']);
    gates.oracle.reject(new Error('later oracle failure'));
    gates.rate.reject(new DOMException('later cancellation', 'AbortError'));
    await assert.rejects(pending, (cause: unknown) => cause === failure);
    await flush();
  });

  test(`${bundle}: spot failures retain buy-first error priority without leaking a sibling rejection`, async () => {
    const method = installedPoolMethod(bundle);
    const value = fixture();
    const gates = Object.fromEntries(READS.map((name) => [name, deferred<unknown>()])) as Record<ReadName, ReturnType<typeof deferred<unknown>>>;
    const pending = method.call(context((name) => gates[name].promise));
    gates.pool.resolve(value.pool);
    gates.rate.resolve(value.rate);
    gates.oracle.resolve(value.oracle);
    await flush();
    const sellError = new Error('sell failed');
    gates.sell.reject(sellError);
    await flush();
    const buyError = new Error('buy failed');
    gates.buy.reject(buyError);
    await assert.rejects(pending, (cause: unknown) => cause === buyError);
    await flush();
  });

  test(`${bundle}: advancing chain fixtures stay uncached and converter reads remain later ordered snapshots`, async () => {
    const method = installedPoolMethod(bundle);
    let block = 100;
    const snapshots: Array<{ name: ReadName; block: number }> = [];
    const read = async (name: ReadName) => {
      snapshots.push({ name, block });
      const value = fixture(false, block);
      await Promise.resolve();
      if (name === 'oracle' || name === 'buy' || name === 'sell') block += 1;
      return value[name];
    };
    await method.call(context(read));
    assert.deepEqual(snapshots, [
      { name: 'pool', block: 100 }, { name: 'rate', block: 100 }, { name: 'oracle', block: 100 },
      { name: 'buy', block: 101 }, { name: 'sell', block: 101 },
    ]);
    snapshots.length = 0;
    await method.call(context(read));
    assert.equal(snapshots[0].block, 103, 'a second plan must issue fresh reads');
    assert.equal(snapshots.length, 5);
    // This deliberately does not claim an atomic block snapshot. Review and
    // pre-sign simulation are still responsible for current executability.
  });
}

/** Load each actual installed SDK bundle behind a strictly local client seam. */
function installedPlannerFixture(bundle: 'index.js' | 'index.cjs', read: (name: ReadName) => Promise<unknown>) {
  let source = readFileSync(resolve(sdkDist, bundle), 'utf8');
  if (bundle === 'index.js') {
    source = source
      .replace(/^import \{ (.+) \} from 'viem';$/m, "const { $1 } = require('viem');")
      .replace(/^import \{ (.+) \} from 'es-toolkit';$/m, "const { $1 } = require('es-toolkit');")
      .replace(/^import Decimal2, \{ Decimal \} from 'decimal.js';$/m, "const Decimal2 = require('decimal.js'); const { Decimal } = Decimal2;")
      .replace(/^import axios from 'axios';$/m, "const axios = require('axios');")
      .replace(/\nexport \{[\s\S]*\};?\s*$/, '');
  }
  const module = { exports: {} };
  // No provider requests: existing-position owner checks are answered locally.
  // Stop at failed real Pool.getPoolInfo before any transaction can be built.
  const hook = `
    getClient = () => ({ readContract: async ({ functionName }) => {
      if (functionName !== 'ownerOf') throw new Error('Unexpected fixture RPC');
      return '0x1111111111111111111111111111111111111111';
    } });
    Pool.prototype.getPoolData = () => read('pool');
    Price.prototype.getRateRes = () => read('rate');
    Price.prototype.getOraclePrice = () => read('oracle');
    Price.prototype.getBuyPrice = () => read('buy');
    Price.prototype.getSellPrice = () => read('sell');
    return { FxSdk, tokens };
  `;
  return new Function('require', 'module', 'exports', 'read', source + hook)(sdkRequire, module, module.exports, read) as {
    FxSdk: new () => Record<string, (request: Record<string, unknown>) => Promise<unknown>>;
    tokens: Record<string, string>;
  };
}

for (const bundle of ['index.js', 'index.cjs'] as const) {
  test(`${bundle}: all five public position planners fail closed for every applicable market and side`, async () => {
    for (const market of ['ETH', 'BTC']) for (const side of ['long', 'short']) {
      const methods = side === 'long'
        ? ['increasePosition', 'reducePosition', 'adjustPositionLeverage', 'depositAndMint', 'repayAndWithdraw']
        : ['increasePosition', 'reducePosition', 'adjustPositionLeverage'];
      for (const method of methods) for (const failed of ['pool', 'rate', 'oracle'] as const) {
        const failure = new Error(`${method}:${market}:${side}:${failed}`);
        const calls: ReadName[] = [];
        const value = fixture(side === 'short');
        const { FxSdk, tokens } = installedPlannerFixture(bundle, async (name) => {
          calls.push(name);
          if (name === failed) throw failure;
          return value[name];
        });
        const token = market === 'ETH' ? tokens.wstETH : tokens.WBTC;
        await assert.rejects(new FxSdk()[method]({
          market, type: side, positionId: 1,
          userAddress: '0x1111111111111111111111111111111111111111',
          leverage: 2, slippage: 0.5, amount: 10n ** 18n,
          inputTokenAddress: token, outputTokenAddress: token,
          depositTokenAddress: token, withdrawTokenAddress: token,
          depositAmount: 10n ** 18n, mintAmount: 100n * 10n ** 18n,
          repayAmount: 100n * 10n ** 18n, withdrawAmount: 10n ** 16n,
        }), (cause: unknown) => cause === failure);
        assert.deepEqual(calls, ['pool', 'rate', 'oracle']);
      }
    }
    await flush();
  });
}
