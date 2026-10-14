import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { normalizeRouteResult, normalizeTxResult } from '../src/lib/fx/normalize';
import { positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from '../src/lib/fx/policy';
import { routeFinancialReviewFacts } from '../src/lib/fx/reviewFormatting';
import type { PlannedRoute } from '../src/lib/fx/types';
import { calculateProtocolFee } from '../src/lib/fx/protocolFee';

const WALLET = '0x1111111111111111111111111111111111111111';
const ROUTER = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';
const MINT = '0xB753366082466c4B5984312f0c4Bb97554be067E';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/@aladdindao/fx-sdk/dist');

for (const bundle of ['index.js', 'index.cjs']) {
  test(`installed ${bundle} preserves fee data without altering transactions or making another read`, async () => {
    const source = readFileSync(resolve(dist, bundle), 'utf8');
    const start = source.indexOf('async function withProtocolFeeQuote(');
    const end = source.indexOf('// src/configs/layerzero.ts', start);
    assert.ok(start > 0 && end > start, 'SDK must contain the installed fee metadata patch');
    const preserve = new Function('contracts', `${source.slice(start, end)}\nreturn withProtocolFeeQuote;`)({ Router_Diamond: ROUTER, FxMintRouter: MINT });
    const result = { txs: [{ to: ROUTER, data: '0x1234', value: 123n }], colls: '987' };
    const pool = { poolAddress: positionPoolAddress('ETH', 'long'), routerFeeRatios: [3_000_000n, 1_000_000n, 0n, 0n], mintFeeRatios: [0n, 0n, 5_000_000n, 2_000_000n] };
    for (const mint of [false, true]) {
      const actual = await preserve(Promise.resolve(result), pool, mint);
      assert.equal(actual.txs, result.txs);
      assert.equal(actual.colls, result.colls);
      assert.equal(actual.protocolFeeQuote.routerAddress, mint ? MINT : ROUTER);
      assert.deepEqual(actual.protocolFeeQuote.ratios, (mint ? pool.mintFeeRatios : pool.routerFeeRatios).map(String));
    }
    assert.equal(await preserve(result, { ...pool, routerFeeRatios: [0n] }, false), result);
    assert.equal(await preserve(result, { ...pool, routerFeeRatios: [0, 0, 0, 0] }, false), result);
    await assert.rejects(preserve(Promise.reject(new Error('quote failed')), pool, false), /quote failed/);
    assert.equal((source.match(/return withProtocolFeeQuote\(position\./g) ?? []).length, 5);
  });
}

function positionRoute(direction: 'increase' | 'reduce', side: 'long' | 'short' = 'long', ratios = ['3000000', '1000000', '0', '0']): PlannedRoute {
  const operation = direction === 'increase' ? 'increasePosition' : 'reducePosition';
  const pool = positionPoolAddress('ETH', side);
  const selector = direction === 'increase' ? (side === 'long' ? '0xef9e1aa7' : '0x99414c10') : (side === 'long' ? '0xe8e9fc2a' : '0xad0acfdc');
  const [route] = normalizeRouteResult(operation, {
    protocolFeeQuote: { poolAddress: pool, routerAddress: ROUTER, ratios },
    routes: [{ txs: [{ to: ROUTER, data: selector, type: 'action' }] }],
  }, WALLET);
  const common = { poolAddress: pool, positionId: 1, positionType: side, collateralTokenAddress: positionCollateralTokenAddress('ETH', side), debtTokenAddress: positionDebtTokenAddress('ETH', side) };
  route.policy = { walletAddress: WALLET, chainId: 1, reviewedAction: direction === 'increase'
    ? { ...common, kind: 'position-increase', inputTokenAddress: common.collateralTokenAddress, inputAmount: 10n, nativeInput: false }
    : { ...common, kind: 'position-reduce', outputTokenAddress: common.collateralTokenAddress, isClosePosition: true } };
  return route;
}
const fee = (route: PlannedRoute) => routeFinancialReviewFacts(route).find((fact) => fact.label.startsWith('f(x) fee'));

test('long/short open and close select only applicable live rates, preserving sub-basis-point precision', () => {
  for (const side of ['long', 'short'] as const) {
    assert.equal(fee(positionRoute('increase', side))?.value, '0.3%');
    assert.match(fee(positionRoute('increase', side))!.title!, /supplied collateral/);
    assert.equal(fee(positionRoute('reduce', side))?.value, '0.1%');
    assert.match(fee(positionRoute('reduce', side))!.title!, /withdrawn collateral/);
  }
  assert.equal(fee(positionRoute('increase', 'long', ['1', '0', '0', '0']))?.value, '0.0000001%');
  assert.equal(fee(positionRoute('increase', 'long', ['0', '3000000', '0', '5000000']))?.value, '0%');
  assert.equal(fee(positionRoute('increase', 'long', ['3000000', '0', '1000000', '0']))?.value, '0.3% of supplied collateral + 0.1% of borrowed debt');
});

test('leverage adjustments follow the actual increase/reduce route, not a guessed direction', () => {
  for (const direction of ['increase', 'reduce'] as const) {
    const route = positionRoute(direction);
    route.operation = 'adjustPositionLeverage';
    route.policy!.reviewedAction = { kind: 'position-adjust', poolAddress: positionPoolAddress('ETH', 'long'), positionId: 1, positionType: 'long', collateralTokenAddress: positionCollateralTokenAddress('ETH', 'long'), debtTokenAddress: positionDebtTokenAddress('ETH', 'long') };
    assert.equal(fee(route)?.value, direction === 'increase' ? '0.3%' : '0.1%');
  }
});

test('borrow uses the mint-router fee schedule and excludes an absent deposit leg', () => {
  const poolAddress = positionPoolAddress('BTC', 'long');
  const route = normalizeTxResult('depositAndMint', {
    txs: [{ to: MINT, data: '0x216d5108', type: 'action' }],
    protocolFeeQuote: { poolAddress, routerAddress: MINT, ratios: ['9000000', '0', '5000000', '2000000'] },
  }, WALLET);
  route.policy = { walletAddress: WALLET, chainId: 1, reviewedAction: { kind: 'deposit-and-mint', poolAddress, positionId: 1, depositTokenAddress: positionCollateralTokenAddress('BTC', 'long'), depositAmount: 0n, nativeInput: false, mintAmount: 100n * 10n ** 18n } };
  assert.equal(fee(route)?.value, '0.5 fxUSD (0.5%)');
  assert.match(fee(route)!.title!, /borrowed debt/);
  assert.equal(fee(route)?.label, 'f(x) fee');
  assert.equal(routeFinancialReviewFacts(route).find(fact => fact.label === 'Estimated fxUSD received')?.value, '99.5 fxUSD');
  route.details!.protocolFeeQuote!.ratios = ['0', '0', '0', '0'];
  assert.equal(routeFinancialReviewFacts(route).find(fact => fact.label === 'Estimated fxUSD received')?.value, '100 fxUSD');
  route.details!.protocolFeeQuote = undefined;
  assert.equal(routeFinancialReviewFacts(route).find(fact => fact.label === 'Estimated fxUSD received')?.value, 'Unavailable');
});

test('protocol fee math floors in token units and does not lose large-integer precision', () => {
  assert.equal(calculateProtocolFee(100n * 10n ** 18n, 5_000_000n), 5n * 10n ** 17n);
  assert.equal(calculateProtocolFee(199n, 5_000_000n), 0n);
  assert.equal(calculateProtocolFee(200n, 5_000_000n), 1n);
  const large = 123456789012345678901234567890n;
  assert.equal(calculateProtocolFee(large, 1_000_000_000n), large);
  assert.equal(calculateProtocolFee(large, 0n), 0n);
  assert.throws(() => calculateProtocolFee(-1n, 0n), RangeError);
  assert.throws(() => calculateProtocolFee(1n, -1n), RangeError);
  assert.throws(() => calculateProtocolFee(1n, 1_000_000_001n), RangeError);
});

test('Borrow collateral requires a validated zero supply fee before claiming post-fee holdings', () => {
  const poolAddress = positionPoolAddress('BTC', 'long');
  const route = normalizeTxResult('depositAndMint', {
    txs: [{ to: MINT, data: '0x216d5108', type: 'action' }], colls: '100000000000000000', debts: '100000000000000000000',
    protocolFeeQuote: { poolAddress, routerAddress: MINT, ratios: ['0', '0', '5000000', '0'] },
  }, WALLET);
  route.policy = { walletAddress: WALLET, chainId: 1, reviewedAction: { kind: 'deposit-and-mint', poolAddress, positionId: 0,
    depositTokenAddress: positionCollateralTokenAddress('BTC', 'long'), depositAmount: 10_000_000n, nativeInput: false, mintAmount: 100n * 10n ** 18n } };
  const collateral = () => routeFinancialReviewFacts(route).find(f => f.label === 'Estimated collateral');
  assert.equal(collateral()?.value, '0.1 WBTC');
  assert.match(collateral()!.title!, /supply fee is 0%/);
  route.details!.protocolFeeQuote!.ratios = ['3000000', '0', '5000000', '0'];
  assert.equal(collateral()?.value, 'Unavailable');
  assert.equal(routeFinancialReviewFacts(route).find(f => f.label === 'Estimated fxUSD received')?.value, '99.5 fxUSD', 'net mint proceeds are independently known');
  route.details!.protocolFeeQuote = undefined;
  assert.equal(collateral()?.value, 'Unavailable');
});

test('unbound, malformed or missing fee data never becomes a zero-fee claim', () => {
  for (const ratios of [['0'], ['-1', '0', '0', '0'], ['1000000001', '0', '0', '0'], ['1e6', '0', '0', '0']]) {
    assert.equal(fee(positionRoute('increase', 'long', ratios)), undefined);
  }
  const route = positionRoute('increase');
  route.details!.protocolFeeQuote!.poolAddress = positionPoolAddress('BTC', 'long');
  assert.equal(fee(route), undefined);
  route.details!.protocolFeeQuote!.poolAddress = positionPoolAddress('ETH', 'long');
  route.details!.protocolFeeQuote!.routerAddress = MINT;
  assert.equal(fee(route), undefined);
  route.details!.protocolFeeQuote!.routerAddress = ROUTER;
  route.transactions[0].data = '0x12345678';
  assert.equal(fee(route), undefined);
  route.details!.protocolFeeQuote = undefined;
  assert.equal(fee(route), undefined);
});
