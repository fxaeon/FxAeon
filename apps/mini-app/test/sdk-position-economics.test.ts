import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Address } from 'viem';
import { normalizeRouteResult } from '../src/lib/fx/normalize';
import { assertPositionEconomics } from '../src/lib/fx/positionEconomics';
import { positionInputTokenOptions, TOKEN_META } from '../src/app/trade/fxUi';
import { positionOutcomeFacts } from '../src/lib/fx/reviewFormatting';
import { capabilityPolicy, positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from '../src/lib/fx/policy';
import { validateReviewedAction } from '../src/lib/fx/actionValidation';
import { validateRoute } from '../src/lib/fx/validation';
import type { PlannedRoute, ReviewedActionIntent } from '../src/lib/fx/types';

const sdkDist = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/@aladdindao/fx-sdk/dist');
const sdkRequire = createRequire(realpathSync(resolve(sdkDist, 'index.cjs')));
const WAD = 10n ** 18n;
const WALLET = '0x1111111111111111111111111111111111111111' as Address;
const ROUTER = '0x33636D49FbefBE798e15e7F356E8DBef543CC708' as Address;
type Market = 'ETH' | 'BTC';
type Side = 'long' | 'short';
type Operation = 'new' | 'add' | 'adjust-up' | 'adjust-down';
type ContractCall = { functionName: string; args?: readonly any[]; address?: string };
type Options = {
  market: Market; side: Side; fee?: bigint; withdrawFee?: bigint;
  capacity?: bigint; minDebtRatio?: bigint; maxDebtRatio?: bigint;
  currentDebts?: bigint;
  converter?: 'normal' | 'failed' | 'decreasing' | 'unbracketed';
};

/** Execute the installed distribution, with only its external I/O replaced.
 * Pool, Price, Position, FxRoute, searchAmount and ABI encoding stay untouched.
 * Converter responses are an integer, fixed-price market fixture, never a
 * replacement quote/search implementation. Unknown I/O fails immediately. */
function installedPlannerFixture(bundle: 'index.js' | 'index.cjs', options: Options) {
  let source = readFileSync(resolve(sdkDist, bundle), 'utf8');
  if (bundle === 'index.js') {
    source = source
      .replace(/^import \{ (.+) \} from 'viem';$/m, "const { $1 } = require('viem');")
      .replace(/^import \{ (.+) \} from 'es-toolkit';$/m, "const { $1 } = require('es-toolkit');")
      .replace(/^import Decimal2, \{ Decimal \} from 'decimal.js';$/m, "const Decimal2 = require('decimal.js'); const { Decimal } = Decimal2;")
      .replace(/^import axios from 'axios';$/m, "const axios = require('axios');")
      .replace(/\nexport \{[\s\S]*\};?\s*$/, '');
  }
  const rate = options.market === 'ETH' ? 125n * WAD / 100n : WAD;
  const price = options.market === 'ETH' ? 2000n : 100000n;
  const nativePrecision = options.market === 'ETH' ? WAD : 10n ** 8n;
  const wrappedPrice = price * rate;
  const currentColls = options.side === 'long' ? 3000n * WAD / price : 4000n * WAD;
  const currentDebts = options.currentDebts ?? (options.side === 'long' ? 2000n * WAD : 3000n * WAD * WAD / wrappedPrice);
  const stats = { reads: [] as string[], searchQueries: 0, converterReads: 0, batches: 0, searchBatches: 0, sleepMs: 0, rpcMs: 0 };
  let time = 0;
  const fee = options.fee ?? 3_000_000n;
  const withdrawFee = options.withdrawFee ?? 1_000_000n;
  const capacity = options.capacity ?? 10n ** 40n;
  const paths = new Map<string, { src: string; dst: string }>();
  let tokens: Record<string, string>;
  const key = (encoding: bigint, routes: bigint[]) => `${encoding}:${routes.join(',')}`;
  const configure = (sdk: any) => {
    tokens = sdk.tokens;
    const asset = options.market === 'ETH' ? tokens.wstETH : tokens.WBTC;
    for (const src of Object.values(TOKEN_META).map(token => token.address.toLowerCase())) for (const dst of [asset, tokens.fxUSD]) {
      for (const isV3 of options.market === 'BTC' ? [false, true] : [false]) {
        try {
          const route = sdk.getZapRoutes({ fromTokenAddress: src === tokens.eth ? tokens.weth : src, toTokenAddress: dst, isV3 });
          paths.set(key(route.encoding, route.routes), { src: src === tokens.eth ? tokens.weth : src, dst });
        } catch { /* Unsupported catalogue paths remain unavailable. */ }
      }
    }
  };
  const respond = (call: ContractCall, searching = false): unknown => {
    const { functionName, args = [] } = call;
    switch (functionName) {
      case 'getPoolInfo': return options.side === 'short' ? [capacity, 0n, capacity, 0n] : [capacity, 0n, 0n, capacity, 0n];
      case 'paused': return false;
      case 'getDebtRatioRange': return [options.minDebtRatio ?? 1n, options.maxDebtRatio ?? 99n * WAD / 100n];
      case 'getPoolFeeRatio': return [fee, withdrawFee, 0n, 0n];
      case 'getRate': return rate;
      case 'getPrice': {
        const oracle = options.side === 'long' ? price * WAD : WAD * WAD / wrappedPrice;
        return [oracle, oracle, oracle];
      }
      case 'getPosition': return [currentColls, currentDebts];
      case 'ownerOf': return WALLET;
      case 'allowance': return 0n;
      case 'getApproved': return '0x0000000000000000000000000000000000000000';
      case 'queryConvert': {
        if (searching) stats.searchQueries += 1; else stats.converterReads += 1;
        const path = paths.get(key(args[1], args[2]));
        assert.ok(path, 'every converter route must be an installed, recognized path');
        const amount = BigInt(args[0]);
        const tokenPrice = (address: string) => address === tokens.wstETH ? wrappedPrice : address === tokens.WBTC ? price * WAD
          : [tokens.weth, tokens.stETH].includes(address) ? price * WAD : WAD;
        const tokenScale = (address: string) => address === tokens.WBTC ? 10n ** 8n : [tokens.usdc, tokens.usdt].includes(address) ? 10n ** 6n : WAD;
        const output = amount * tokenPrice(path.src) * tokenScale(path.dst) / tokenScale(path.src) / tokenPrice(path.dst);
        if (searching && options.converter === 'failed') throw new Error('fixture converter unavailable');
        if (searching && options.converter === 'decreasing') return (1n << 240n) - output;
        if (searching && options.converter === 'unbracketed') return output / 100n;
        return output;
      }
      default: throw new Error(`Unexpected fixture RPC: ${functionName}`);
    }
  };
  const tick = () => { time += 10; stats.rpcMs += 10; };
  const client = {
    chain: { id: 1 },
    readContract: async (call: ContractCall) => { stats.reads.push(call.functionName); tick(); return respond(call); },
    multicall: async ({ contracts }: { contracts: ContractCall[] }) => {
      tick(); stats.batches += 1;
      const searching = contracts.some(call => call.functionName === 'queryConvert');
      if (searching) stats.searchBatches += 1;
      return contracts.map(call => {
        stats.reads.push(call.functionName);
        try { return { status: 'success', result: respond(call, searching) }; }
        catch (error) { return { status: 'failure', error }; }
      });
    },
    getTransactionCount: async () => { stats.reads.push('getTransactionCount'); tick(); return 7; },
  };
  const localRequire = (name: string) => {
    if (name === 'axios') return { create: () => ({ get: () => { throw new Error('Unexpected HTTP'); }, post: () => { throw new Error('Unexpected HTTP'); } }) };
    return sdkRequire(name);
  };
  const module = { exports: {} };
  const exports = new Function('require', 'module', 'exports', 'client', 'configure', 'Date', 'setTimeout', 'fetch', source + `
    getClient = () => client;
    configure({ tokens, getZapRoutes });
    return { FxSdk, tokens };
  `)(localRequire, module, module.exports, client, configure,
    class extends Date { static now() { return time; } },
    (callback: () => void, delay: number) => { stats.sleepMs += delay; time += delay; queueMicrotask(callback); },
    () => { throw new Error('Unexpected network fetch'); }) as {
      FxSdk: new () => { increasePosition(request: any): Promise<any>; adjustPositionLeverage(request: any): Promise<any> };
      tokens: Record<string, Address>;
    };
  return { ...exports, stats, rate, price, currentColls, currentDebts, nativePrecision, elapsedMs: () => time };
}

function requestFor(fixture: ReturnType<typeof installedPlannerFixture>, market: Market, side: Side, operation: Operation, slippage = 0.5) {
  return {
    market, type: side, positionId: operation === 'new' ? 0 : 1,
    userAddress: WALLET, targets: ['FxRoute'], slippage,
    leverage: operation === 'adjust-up' ? 4 : 2,
    inputTokenAddress: side === 'short' ? fixture.tokens.fxUSD : market === 'ETH' ? fixture.tokens.wstETH : fixture.tokens.WBTC,
    amount: side === 'short' ? 100n * WAD : 100n * WAD * fixture.nativePrecision / (fixture.price * fixture.rate),
  };
}

type PositionIntent = Extract<ReviewedActionIntent, { kind: 'position-increase' | 'position-adjust' }>;

function reviewedIntent(request: ReturnType<typeof requestFor>, operation: Operation): PositionIntent {
  const common = {
    poolAddress: positionPoolAddress(request.market, request.type), positionId: request.positionId,
    collateralTokenAddress: positionCollateralTokenAddress(request.market, request.type),
    debtTokenAddress: positionDebtTokenAddress(request.market, request.type), positionType: request.type,
    requestedLeverage: request.leverage, slippagePercent: request.slippage,
  };
  return operation === 'new' || operation === 'add'
    ? { ...common, kind: 'position-increase', inputTokenAddress: request.inputTokenAddress, inputAmount: request.amount, nativeInput: false }
    : { ...common, kind: 'position-adjust' };
}

function verifyPolicy(route: PlannedRoute, request: ReturnType<typeof requestFor>, operation: Operation) {
  const intent = reviewedIntent(request, operation);
  const policy = capabilityPolicy({
    walletAddress: WALLET, chainId: 1, operation: route.operation, maxValueWei: 0n,
    expectedTokenApprovalAmount: request.amount, expectedPositionApprovalId: request.positionId,
    reviewedAction: intent, approvalDestinations: [request.inputTokenAddress, intent.poolAddress],
    tokenApprovalDestinations: [request.inputTokenAddress], positionApprovalDestinations: [intent.poolAddress],
  });
  validateRoute(route, policy);
  const trade = route.transactions.find(tx => tx.kind === 'action')!;
  assert.equal(trade.to.toLowerCase(), ROUTER.toLowerCase());
  const binding = validateReviewedAction(trade, intent);
  assert.ok(binding.actionDataFingerprint);
  assert.ok(binding.economicLimits?.length);
  assert.throws(() => validateReviewedAction(trade, { ...intent, positionId: request.positionId + 1 }), /position ID.*reviewed action/i);
  assert.throws(() => validateReviewedAction(trade, { ...intent, poolAddress: WALLET }), /pool.*reviewed action/i);
  assert.throws(() => validateReviewedAction(trade, { ...intent, expectedActionDataFingerprint: `0x${'00'.repeat(32)}` }), /calldata changed after review/);
  assert.throws(() => validateRoute({ ...route, transactions: route.transactions.map(tx => tx === trade ? { ...tx, to: WALLET } : tx) }, policy), /destination/i);
}

for (const bundle of ['index.js', 'index.cjs'] as const) {
  test(`${bundle}: every offered market, side and input token produces validated public outcome amounts`, async () => {
    for (const market of ['ETH', 'BTC'] as const) for (const side of ['long', 'short'] as const) {
      for (const token of positionInputTokenOptions(market, side)) {
        const f = installedPlannerFixture(bundle, { market, side });
        const request = requestFor(f, market, side, 'new');
        request.inputTokenAddress = TOKEN_META[token].address;
        request.amount = (['USDC', 'USDT', 'fxUSD'].includes(token) ? 100n : token === 'WBTC' ? 1n : 1n) * 10n ** BigInt(TOKEN_META[token].decimals)
          / (token === 'WBTC' ? 1000n : 1n);
        const result = await new f.FxSdk().increasePosition(request);
        const routes = normalizeRouteResult('increasePosition', result, WALLET);
        assert.ok(routes.length, `${market} ${side} ${token}`);
        for (const route of routes) {
          assertPositionEconomics(route, request);
          route.policy = capabilityPolicy({walletAddress: WALLET, chainId: 1, operation: 'increasePosition', reviewedAction: reviewedIntent(request, 'new')});
          const facts = positionOutcomeFacts(route);
          assert.ok(facts?.collateral && facts.debt && facts.executionPrice, `${market} ${side} ${token}`);
        }
      }
    }
  });
  test(`${bundle}: an upstream unblended debt-free add cannot borrow against old capital unnoticed`, async () => {
    for (const market of ['ETH', 'BTC'] as const) {
      const f = installedPlannerFixture(bundle, { market, side: 'long', currentDebts: 0n });
      const request = requestFor(f, market, 'long', 'add');
      const result = await new f.FxSdk().increasePosition(request);
      for (const route of normalizeRouteResult('increasePosition', result, WALLET)) {
        assert.equal(route.details!.leverage, request.leverage, 'the old echoed-leverage guard accepted this');
        assert.throws(() => assertPositionEconomics(route, request), /borrowed exposure misses requested target/);
      }
    }
  });

  test(`${bundle}: debt-free 1x stays a zero borrow when the pool permits it`, async () => {
    for (const market of ['ETH', 'BTC'] as const) {
      const f = installedPlannerFixture(bundle, { market, side: 'long', minDebtRatio: 0n, fee: 0n });
      const request = requestFor(f, market, 'long', 'new');
      request.leverage = 1;
      const result = await new f.FxSdk().increasePosition(request);
      for (const route of normalizeRouteResult('increasePosition', result, WALLET)) {
        assert.equal(route.details!.debts, '0');
        assert.equal(assertPositionEconomics(route, request).effectiveLeverage, 1);
        verifyPolicy(route, request, 'new');
      }
      assert.equal(f.stats.searchQueries, 0);
    }
  });

  test(`${bundle}: real new/add/up/down plans pass accounting and calldata checks for ETH/BTC long/short`, async t => {
    const failures: string[] = [];
    for (const market of ['ETH', 'BTC'] as const) for (const side of ['long', 'short'] as const) {
      for (const operation of ['new', 'add', 'adjust-up', 'adjust-down'] as const) {
        for (const slippage of [0.1, 0.5, 2]) for (const fee of [0n, 3_000_000n]) {
          const f = installedPlannerFixture(bundle, { market, side, fee, withdrawFee: fee ? 1_000_000n : 0n });
          const request = requestFor(f, market, side, operation, slippage);
          const method = operation === 'new' || operation === 'add' ? 'increasePosition' : 'adjustPositionLeverage';
          const result = await new f.FxSdk()[method](request);
          const routes = normalizeRouteResult(method, result, WALLET);
          assert.ok(routes.length > 0);
          for (const route of routes) {
            const label = `${market} ${side} ${operation} slippage=${slippage} fee=${fee}`;
            const before = f.stats.reads.length;
            let economic;
            try { economic = assertPositionEconomics(route, request); }
            catch (cause) { failures.push(`${label}: ${String(cause)}; balances=${route.details!.colls}/${route.details!.debts}; snapshot=${JSON.stringify(route.details!.positionEconomics)}`); continue; }
            assert.equal(f.stats.reads.length, before, 'economic validation adds no RPC');
            assert.ok(economic.effectiveLeverage > 0, label);
            assert.equal(route.details!.positionEconomics!.operation, method === 'increasePosition' ? 'increase' : operation);
            assert.equal(route.details!.positionEconomics!.rateRes, f.rate.toString());
            assert.equal(route.details!.positionEconomics!.currentColls, request.positionId ? f.currentColls.toString() : '0');
            assert.equal(route.details!.positionEconomics!.supplyFeeRatio, fee.toString());
            verifyPolicy(route, request, operation);
            // A target echoed by the SDK cannot hide a material debt error.
            const poisoned = structuredClone(route);
            poisoned.details!.debts = (BigInt(poisoned.details!.debts!) * 2n).toString();
            assert.throws(() => assertPositionEconomics(poisoned, request), /economics could not be verified/);
          }
          assert.equal(f.stats.reads.filter(name => name === 'getRate').length, 1);
          assert.equal(f.stats.reads.filter(name => name === 'getPrice').length, 1);
          assert.equal(f.stats.reads.filter(name => name === 'getPoolInfo').length, 1);
          const expectedQueries = side === 'short' && operation !== 'adjust-down' ? 0
            : market === 'ETH' ? 300 : side === 'long' && operation === 'adjust-down' ? 400 : 600;
          assert.equal(f.stats.searchQueries, expectedQueries, 'normal plans retain the existing hundred-point search budget');
          assert.equal(f.stats.searchBatches, expectedQueries / 50, 'no extra validation RPC batch');
          assert.equal(f.stats.batches, 1 + expectedQueries / 50, 'pool data is the only non-search multicall');
          assert.equal(f.stats.converterReads, market === 'BTC' ? 5 : 3, 'two spot samples plus the route quote, including BTC alternatives');
          if (slippage === 0.5 && fee === 3_000_000n) t.diagnostic(`${market} ${side} ${operation}: ${f.stats.searchQueries} search queries, ${f.stats.searchBatches} search RPC batches, ${f.elapsedMs()}ms deterministic RPC+spacing`);
        }
      }
    }
    assert.deepEqual(failures, [], 'every normal plan must pass economics');
  });

  test(`${bundle}: $0.01 long input at 1.1x is rejected before search or transaction preparation`, async () => {
    for (const market of ['ETH', 'BTC'] as const) for (const operation of ['new', 'add'] as const) for (const convertedInput of [false, true]) {
      const f = installedPlannerFixture(bundle, { market, side: 'long' });
      const request = requestFor(f, market, 'long', operation);
      request.amount = WAD * f.nativePrecision / (100n * f.price * f.rate);
      if (convertedInput) { request.inputTokenAddress = f.tokens.fxUSD; request.amount = WAD / 100n; }
      request.leverage = 1.1;
      await assert.rejects(new f.FxSdk().increasePosition(request), /Amount is too small to quote reliably.*Increase the position amount/);
      assert.equal(f.stats.searchQueries, 0);
      assert.equal(f.stats.searchBatches, 0);
      assert.equal(f.stats.reads.includes('allowance'), false);
      assert.equal(f.stats.reads.includes('getTransactionCount'), false);
    }
  });

  test(`${bundle}: normal amounts at 1.1x and 5x and converted inputs retain usable economic quotes`, async () => {
    for (const market of ['ETH', 'BTC'] as const) for (const side of ['long', 'short'] as const) {
      for (const leverage of [1.1, 5]) for (const convertedInput of [false, true]) {
        const f = installedPlannerFixture(bundle, { market, side });
        const request = requestFor(f, market, side, 'new');
        request.leverage = leverage;
        if (convertedInput) {
          request.inputTokenAddress = side === 'long' ? f.tokens.fxUSD : market === 'ETH' ? f.tokens.wstETH : f.tokens.WBTC;
          request.amount = side === 'long' ? 100n * WAD : 100n * WAD * f.nativePrecision / (f.price * f.rate);
        }
        const result = await new f.FxSdk().increasePosition(request);
        for (const route of normalizeRouteResult('increasePosition', result, WALLET)) {
          assertPositionEconomics(route, request);
          verifyPolicy(route, request, 'new');
          const converted = side === 'long' ? 100n * WAD * f.nativePrecision / (f.price * f.rate) : 100n * WAD;
          assert.equal(route.details!.positionEconomics!.inputCollateral, converted.toString());
        }
      }
    }
  });

  test(`${bundle}: short dust follows actual native precision, with no converter search`, async () => {
    for (const market of ['ETH', 'BTC'] as const) {
      const f = installedPlannerFixture(bundle, { market, side: 'short' });
      const request = requestFor(f, market, 'short', 'new');
      request.amount = WAD / 100n;
      request.leverage = 1.1;
      const result = await new f.FxSdk().increasePosition(request);
      for (const route of normalizeRouteResult('increasePosition', result, WALLET)) {
        if (market === 'BTC') assert.throws(() => assertPositionEconomics(route, request), /amount is too small to validate safely/);
        else { assertPositionEconomics(route, request); verifyPolicy(route, request, 'new'); }
      }
      assert.equal(f.stats.searchQueries, 0);
    }
  });

  test(`${bundle}: failed, nonmonotone and unbracketed converter searches never produce a plan`, async () => {
    for (const market of ['ETH', 'BTC'] as const) for (const converter of ['failed', 'decreasing', 'unbracketed'] as const) {
      const f = installedPlannerFixture(bundle, { market, side: 'long', converter });
      await assert.rejects(new f.FxSdk().increasePosition(requestFor(f, market, 'long', 'new')), /maximum trading range/);
      assert.ok(f.stats.searchQueries > 0);
      assert.equal(f.stats.reads.includes('allowance'), false);
      assert.equal(f.stats.reads.includes('getTransactionCount'), false);
    }
  });

  test(`${bundle}: pool capacity and debt-ratio guards still reject otherwise valid normal amounts`, async () => {
    for (const market of ['ETH', 'BTC'] as const) for (const side of ['long', 'short'] as const) {
      for (const bounds of [{ capacity: 1n }, { minDebtRatio: 95n * WAD / 100n }, { maxDebtRatio: WAD / 10n }]) {
        const f = installedPlannerFixture(bundle, { market, side, ...bounds });
        await assert.rejects(new f.FxSdk().increasePosition(requestFor(f, market, side, 'new')), /cap|minimum leverage|maximum leverage/);
        assert.equal(f.stats.reads.includes('getTransactionCount'), false);
      }
    }
  });
}
