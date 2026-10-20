import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const installedDist = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/@aladdindao/fx-sdk/dist');
// An explicit override also runs these regressions against a saved pre-fix bundle.
const sdkDist = process.env.FX_SDK_BUNDLE_DIR ?? installedDist;
const sdkRequire = createRequire(realpathSync(resolve(installedDist, 'index.cjs')));
const Decimal = sdkRequire('decimal.js');
const CONVERT = { encoding: 0n, routes: [] };
const SMALL_AMOUNT = /Amount is too small to quote reliably\. Increase the position amount\./;
const UNIT = 10n ** 18n;
type Call = { address: string; functionName: string; args: [string, bigint, string[]] };
type Request = Record<string, unknown>;
type Search = (left: string, right: string, expect: string, convert: typeof CONVERT, precision: number) => Promise<[string, number, number]>;
type Result = { best: string; amounts: Record<string, { src: bigint; dst: bigint }> };
type SdkSeam = {
  searchAmount: Search;
  getFxUSDByBorrowAmount: (request: Request) => Promise<Result>;
  getBorrowByFxUSDAmount: (request: Request) => Promise<Result>;
  openOrAddFlashLoanQuote: (request: Request) => Promise<unknown>;
  closeOrRemoveFlashLoanQuote: (request: Request) => Promise<unknown>;
  closeOrRemoveShortFlashLoanQuote: (request: Request) => Promise<unknown>;
  tokens: Record<string, string>;
  cBN: (value: unknown) => { toString: () => string };
};

function fixture(bundle: 'index.js' | 'index.cjs', convert: (amount: bigint) => bigint = (amount) => amount,
  fault?: (rows: unknown[], batch: number) => unknown) {
  let source = readFileSync(resolve(sdkDist, bundle), 'utf8');
  if (bundle === 'index.js') {
    source = source
      .replace(/^import \{ (.+) \} from 'viem';$/m, "const { $1 } = require('viem');")
      .replace(/^import \{ (.+) \} from 'es-toolkit';$/m, "const { $1 } = require('es-toolkit');")
      .replace(/^import Decimal2, \{ Decimal \} from 'decimal.js';$/m, "const Decimal2 = require('decimal.js'); const { Decimal } = Decimal2;")
      .replace(/^import axios from 'axios';$/m, "const axios = require('axios');")
      .replace(/\nexport \{[\s\S]*\};?\s*$/, '');
  }
  const batches: bigint[][] = [];
  const routeRequests: Request[] = [];
  const routeStop = new Error('Stop after the actual caller has applied slippage');
  const query = async (calls: Call[]) => {
    for (const call of calls) {
      assert.equal(call.functionName, 'queryConvert');
      assert.ok(/^0x[0-9a-f]{40}$/i.test(call.address));
    }
    const amounts = calls.map((call) => BigInt(call.args[0]));
    batches.push(amounts);
    const rows = amounts.map((amount) => ({ status: 'success', result: convert(amount) }));
    return fault ? fault(rows, batches.length) : rows;
  };
  const route = async (request: Request) => { routeRequests.push(request); throw routeStop; };
  const module = { exports: {} };
  // Execute the whole installed ESM/CJS bundle with its actual Decimal library.
  // Only provider and downstream route I/O are replaced; the search, wrappers,
  // caller arithmetic, routing configuration, and input checks remain installed code.
  const hook = `
    getClient = () => ({});
    batchedMulticall = (_client, calls) => query(calls);
    getRoute = route;
    return { searchAmount, getFxUSDByBorrowAmount, getBorrowByFxUSDAmount,
      openOrAddFlashLoanQuote, closeOrRemoveFlashLoanQuote, closeOrRemoveShortFlashLoanQuote, tokens, cBN };
  `;
  const sdk = new Function('require', 'module', 'exports', 'query', 'route', source + hook)(sdkRequire, module, module.exports, query, route) as SdkSeam;
  assert.ok(Decimal.isDecimal(sdk.cBN('0.1')), 'use the SDK real Decimal implementation');
  return { sdk, batches, routeRequests, routeStop,
    search: (left: bigint, right: bigint, target: bigint, precision = 1e16) => sdk.searchAmount(String(left), String(right), String(target), CONVERT, precision),
  };
}

for (const bundle of ['index.js', 'index.cjs'] as const) {
  test(`${bundle}: unsearchable dust fails before converter calls at both absolute precision boundaries`, async () => {
    for (const precision of [1e16, 1e13, 1e3, 1]) {
      const tolerance = BigInt(precision);
      for (const width of [1n, tolerance - 1n, tolerance].filter((value) => value > 0n)) {
        const value = fixture(bundle);
        await assert.rejects(value.search(0n, width, 1n, precision), SMALL_AMOUNT);
        assert.deepEqual(value.batches, [], 'unsupported dust must not add a quote roundtrip');
      }
      const above = fixture(bundle);
      const target = tolerance / 2n + 1n;
      const [amount] = await above.search(0n, tolerance + 1n, target, precision);
      assert.ok(BigInt(amount) >= target);
      assert.equal(above.batches.length, 1);
    }
  });

  test(`${bundle}: fxUSD hint threshold is explicit and its error survives both wrappers and WBTC routes`, async () => {
    for (const token of ['wstETH', 'WBTC']) {
      const value = fixture(bundle);
      const baseTokenAddress = value.sdk.tokens[token];
      for (const hint of [1n, 6_666_666_666_666_666n]) {
        await assert.rejects(value.sdk.getFxUSDByBorrowAmount({ hintFxUSDAmount: String(hint), borrowAmount: String(hint), baseTokenAddress }), SMALL_AMOUNT);
      }
      await assert.rejects(value.sdk.getBorrowByFxUSDAmount({ hintToBorrow: '100', fxUSDAmount: '100', baseTokenAddress, precision: 1e18 }), SMALL_AMOUNT);
      assert.equal(value.batches.length, 0);
      const hint = 6_666_666_666_666_667n;
      const result = await value.sdk.getFxUSDByBorrowAmount({ hintFxUSDAmount: String(hint), borrowAmount: String(hint), baseTokenAddress });
      assert.ok(result.amounts[result.best].src >= hint);
      assert.equal(value.batches.length, token === 'WBTC' ? 2 : 1, 'do not introduce a dust preflight RPC');
    }
  });

  test(`${bundle}: accepted searches return a positively queried sufficient upper bound, never the initial half hint`, async () => {
    for (const hint of [10n ** 16n, 10n ** 18n, 100n * UNIT, 1000n * UNIT]) {
      const value = fixture(bundle);
      const [amount, duration, passes] = await value.search(hint / 2n, hint * 2n, hint);
      const found = BigInt(amount);
      assert.ok(found >= hint, `quoted input must cover target for ${hint}`);
      assert.ok(found - hint <= 10n ** 16n, 'existing absolute tolerance is still the cap');
      assert.ok(value.batches.flat().includes(found), 'returned amount was actually evaluated');
      assert.ok(value.batches.flat().every((candidate) => candidate > 0n));
      assert.equal(passes, value.batches.length);
      assert.ok(duration >= 0);
    }
  });

  test(`${bundle}: normal-size 100-point grids and converter batch counts stay unchanged`, async () => {
    const cases = [
      { hint: 10n ** 16n, passes: 1 },
      { hint: UNIT, passes: 2 },
      { hint: 100n * UNIT, passes: 3 },
      { hint: 1000n * UNIT, passes: 3 },
    ];
    for (const { hint, passes } of cases) {
      const value = fixture(bundle);
      await value.search(hint / 2n, hint * 2n, hint);
      assert.equal(value.batches.length, passes);
      assert.ok(value.batches.every((batch) => batch.length === 100));
      assert.equal(value.batches.reduce((total, batch) => total + Math.ceil(batch.length / 50), 0), passes * 2, 'same existing 50-contract RPC batches');
      const step = (hint * 2n - hint / 2n) / 100n;
      assert.deepEqual(value.batches[0], Array.from({ length: 100 }, (_, index) => hint / 2n + step * BigInt(index + 1)));
    }
  });

  test(`${bundle}: integer-division remainders cannot discard a known sufficient upper endpoint`, async () => {
    const convert = (amount: bigint) => amount * 962n / 1000n;
    const value = fixture(bundle, convert);
    const [amount, , passes] = await value.search(50891n, 203564n, 101782n, 1000);
    assert.equal(amount, '105827');
    assert.ok(convert(BigInt(amount)) >= 101782n);
    assert.equal(passes, 2);
    assert.deepEqual(value.batches.map((batch) => batch.length), [100, 100]);
    assert.equal(value.batches[0].at(-1), 203564n, 'initial range includes its upper endpoint');
    assert.equal(value.batches[1].at(-1), 105827n, 'refinement retains the previously sufficient endpoint');
    assert.ok(convert(105801n) < 101782n, 'the old rounded-down final sample misses the target');
  });

  test(`${bundle}: targets in the final integer remainder remain searchable without extra samples`, async () => {
    const value = fixture(bundle);
    const [amount, , passes] = await value.search(500n, 2035n, 2030n, 1);
    assert.equal(amount, '2030');
    assert.equal(passes, 2);
    assert.deepEqual(value.batches.map((batch) => batch.length), [100, 50]);
    assert.equal(value.batches[0].at(-1), 2035n);
    assert.ok(value.batches.every((batch) => new Set(batch).size === batch.length));
  });

  test(`${bundle}: one-wei integer refinement makes progress without duplicate or zero queries`, async () => {
    for (const [left, right, target] of [[0n, 2n, 1n], [0n, 2n, 2n], [1n, 10n, 7n], [0n, 101n, 99n]]) {
      const value = fixture(bundle);
      const [amount, , passes] = await value.search(left, right, target, 1);
      assert.equal(BigInt(amount), target);
      assert.equal(passes, 1);
      for (const batch of value.batches) {
        assert.equal(new Set(batch).size, batch.length);
        assert.ok(batch.every((candidate) => candidate > 0n));
      }
    }
  });

  test(`${bundle}: a genuinely zero-sized debt-free borrowing leg needs no converter`, async () => {
    const value = fixture(bundle);
    assert.deepEqual(await value.search(0n, 0n, 0n), ['0', 0, 0]);
    assert.equal(value.batches.length, 0);
  });

  test(`${bundle}: invalid amounts, targets, ranges, and precision fail with no converter work`, async () => {
    const value = fixture(bundle);
    for (const bad of ['-1', 'NaN', 'Infinity', '1.5', '', ' 1', '1e18']) {
      await assert.rejects(value.sdk.searchAmount(bad, '1000', '500', CONVERT, 1), /Invalid converter search/);
      await assert.rejects(value.sdk.searchAmount('0', '1000', bad, CONVERT, 1), /Invalid converter search/);
    }
    for (const [left, right, target] of [[0n, 0n, 1n], [10n, 1n, 5n], [0n, 1000n, 0n]]) {
      await assert.rejects(value.search(left, right, target, 1), /Invalid converter search/);
    }
    for (const precision of [0, -1, Number.NaN, Infinity, 0.5]) {
      await assert.rejects(value.search(0n, 1000n, 500n, precision), /Invalid converter search/);
    }
    assert.equal(value.batches.length, 0);
  });

  test(`${bundle}: missing, failed, malformed, and partially successful converter results fail closed`, async () => {
    const mutations: Array<(rows: unknown[]) => unknown> = [
      () => undefined, () => [], (rows) => rows.slice(1),
      (rows) => [undefined, ...rows.slice(1)],
      (rows) => [{ status: 'failure', error: new Error('reverted') }, ...rows.slice(1)],
      (rows) => [{ status: 'success', result: '1' }, ...rows.slice(1)],
      (rows) => [{ status: 'success', result: -1n }, ...rows.slice(1)],
      (rows) => [{ status: 'failure', result: 1000n }, ...rows.slice(1)],
    ];
    for (const mutate of mutations) {
      const value = fixture(bundle, undefined, mutate);
      await assert.rejects(value.search(500n, 2000n, 1000n, 10), /Converter search evaluation failed/);
      assert.equal(value.batches.length, 1, 'do not retry an invalid converter evaluation');
    }
    const failure = new Error('RPC unavailable');
    const value = fixture(bundle, undefined, () => { throw failure; });
    await assert.rejects(value.search(500n, 2000n, 1000n, 10), (error: unknown) => error === failure);
  });

  test(`${bundle}: flat, decreasing, and unbracketed conversions cannot fabricate a quote`, async () => {
    for (const convert of [() => 0n, () => 1000n, () => 5000n, (amount: bigint) => 5000n - amount]) {
      const value = fixture(bundle, convert);
      await assert.rejects(value.search(500n, 2000n, 1000n, 10), /increasing quote range/);
      assert.equal(value.batches.length, 1);
    }
    for (const target of [1n, 3000n]) {
      const value = fixture(bundle);
      await assert.rejects(value.search(500n, 2000n, target, 10), /outside the quoted range/);
      assert.equal(value.batches.length, 1);
    }
  });

  test(`${bundle}: discontinuous conversions refine to an actually sufficient integer boundary`, async () => {
    const convert = (amount: bigint) => amount < 997n ? 0n : 2000n;
    const value = fixture(bundle, convert);
    const [amount, , passes] = await value.search(500n, 2000n, 1000n, 1);
    assert.equal(BigInt(amount), 997n);
    assert.ok(convert(BigInt(amount)) >= 1000n);
    assert.equal(passes, 2);
    assert.deepEqual(value.batches.map((batch) => batch.length), [100, 15]);
  });

  test(`${bundle}: an established discontinuous bracket survives a flat sufficient refinement`, async () => {
    const convert = (amount: bigint) => amount < 996n ? 0n : 2000n;
    const value = fixture(bundle, convert);
    const [amount, , passes] = await value.search(500n, 2000n, 1000n, 1);
    assert.equal(amount, '996');
    assert.equal(passes, 2);
    assert.deepEqual(value.batches.map((batch) => batch.length), [100, 15]);
    assert.ok(value.batches[0].includes(995n), 'the prior pass evaluated the insufficient lower bound');
    assert.equal(convert(995n), 0n);
    assert.ok(value.batches[1].every((candidate) => convert(candidate) === 2000n), 'all refinement samples are sufficient despite being flat');
  });

  test(`${bundle}: search exhaustion throws instead of returning an unchecked amount`, async () => {
    const value = fixture(bundle);
    await assert.rejects(value.search(0n, 10n ** 70n, 10n ** 70n / 3n, 1), /Exceeds the maximum trading range/);
    assert.equal(value.batches.length, 10);
    assert.equal(value.batches.flat().length, 1000);
  });

  test(`${bundle}: WBTC keeps v3 fallback when the first evaluated route fails`, async () => {
    const value = fixture(bundle, undefined, (rows, batch) => batch === 1 ? rows.map(() => ({ status: 'failure' })) : rows);
    const result = await value.sdk.getFxUSDByBorrowAmount({ hintFxUSDAmount: String(UNIT), borrowAmount: String(UNIT), baseTokenAddress: value.sdk.tokens.WBTC });
    assert.equal(result.best, 'FxRoute 2');
    assert.ok(result.amounts[result.best].src >= UNIT);
    assert.equal(value.batches.length, 3, 'one failed first-route pass and two fallback passes');
  });

  test(`${bundle}: real long increase/reduce and short reduce callers apply slippage to sufficient funding`, async () => {
    for (const kind of ['long-increase', 'long-reduce', 'short-reduce'] as const) {
      const value = fixture(bundle);
      const poolInfo = {
        poolAddress: '0x1111111111111111111111111111111111111111',
        deltaCollAddress: kind === 'short-reduce' ? value.sdk.tokens.fxUSD : value.sdk.tokens.wstETH,
        deltaDebtAddress: value.sdk.tokens.wstETH,
        deltaCollSymbol: 'wstETH', deltaDebtSymbol: 'wstETH',
        minPrice: UNIT, anchorPrice: UNIT, averagePrice: '1', openPrice: '1', closePrice: '1',
        precision: 1e18, rateRes: UNIT, collRest: 1000n * UNIT, debtRest: 1000n * UNIT,
        openFeeRatio: 0, closeFeeRatio: 0, poolMinDebtRatio: 0n, poolMaxDebtRatio: UNIT - 1n,
      };
      const shared = { positionId: 1, leverage: 2, slippage: 50,
        tokenAddress: poolInfo.deltaCollAddress, convertInRoute: CONVERT, convertOutRoute: CONVERT,
        currentColls: 4n * UNIT, currentDebts: 2n * UNIT, poolInfo };
      const operation = kind === 'long-increase'
        ? value.sdk.openOrAddFlashLoanQuote({ ...shared, amountIn: UNIT, currentColls: 0n, currentDebts: 0n })
        : kind === 'long-reduce'
          ? value.sdk.closeOrRemoveFlashLoanQuote({ ...shared, withdrawDeltaCollAmount: String(2n * UNIT) })
          : value.sdk.closeOrRemoveShortFlashLoanQuote({ ...shared, withdrawDeltaCollAmount: String(2n * UNIT) });
      await assert.rejects(operation, (error: unknown) => error === value.routeStop);
      assert.equal(value.routeRequests.length, 1);
      const amount = value.routeRequests[0].amount as bigint;
      const enoughQuoted = value.batches.at(-1)!.find((candidate) => candidate >= UNIT)!;
      assert.ok(enoughQuoted >= UNIT);
      assert.equal(amount, enoughQuoted * 10050n / 10000n, 'the installed caller adds its 0.5% allowance to the evaluated upper bound');
      assert.ok(amount >= UNIT, 'downstream converter receives sufficient positive input');
    }
  });
}
