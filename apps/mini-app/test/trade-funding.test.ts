import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readTradeFundingRate, tradeFundingIsFresh, tradeFundingDisplay, tradeFundingNetRatio, createTradeFundingCache, TRADE_FUNDING_MAX_AGE_MS } from '../src/lib/fx/tradeFunding';
import { tradeFundingReviewFact } from '../src/lib/fx/reviewFormatting';
import { positionPoolAddress } from '../src/lib/fx/policy';
import type { FxPublicClient, PlannedRoute } from '../src/lib/fx/types';
const configuration = '0x16b334f2644cc00b85DB1A1efF0C2C395e00C28d';
const client = (readContract: (input: { address: string; functionName: string; args?: readonly unknown[] }) => Promise<unknown>, chainId = 1) => ({ chain: { id: chainId }, getChainId: async () => chainId, getBlockNumber: async () => 100n, readContract }) as unknown as FxPublicClient;

test('each market and side reads its own configuration and corresponding gross ratio', async () => {
  for (const market of ['ETH', 'BTC'] as const) for (const side of ['long', 'short'] as const) {
    const calls: Array<{ address: string; functionName: string; args?: readonly unknown[] }> = [];
    const started = Date.now();
    const ratio = side === 'long' ? 45318576060452136n : 0n;
    const rate = await readTradeFundingRate(market, side, client(async input => { calls.push(input); return input.functionName === 'configuration' ? configuration : ratio; }));
    assert.equal(calls.length, 7);
    assert.ok(calls.every(input => (input as { blockNumber?: bigint }).blockNumber === 100n));
    const own = calls.find(input => input.functionName === (side === 'long' ? 'getLongPoolFundingRatio' : 'getShortPoolFundingRatio'));
    assert.equal(own?.address, configuration);
    assert.deepEqual(own?.args, [positionPoolAddress(market, side)]);
    assert.deepEqual({ market: rate.market, side: rate.side, pool: rate.pool, ratio: rate.ratio }, { market, side, pool: positionPoolAddress(market, side), ratio });
    assert.ok(rate.readAt >= started && rate.readAt <= Date.now());
    assert.equal(tradeFundingDisplay(rate).value, side === 'long' ? '≈ 0.0041% / 8h' : '0% / 8h');
    assert.match(tradeFundingDisplay(rate).title, /Gross.*all pool collateral/);
  }
});

test('wrong chain, malformed configuration and invalid ratios never become zero', async () => {
  let called = false;
  await assert.rejects(readTradeFundingRate('ETH', 'short', client(async () => { called = true; return 0n; }, 8453)), /expected 1/);
  assert.equal(called, false);
  for (const value of [undefined, '0x0000000000000000000000000000000000000000', 'broken']) await assert.rejects(readTradeFundingRate('ETH', 'short', client(async () => value)), /configuration unavailable/);
  for (const value of [undefined, '0', -1n, 2n ** 256n]) await assert.rejects(readTradeFundingRate('BTC', 'short', client(async input => input.functionName === 'configuration' ? configuration : value)), /ratio unavailable/);
});

test('a stalled optional read expires without extending its original read timestamp', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = assert.rejects(readTradeFundingRate('ETH', 'short', client(async () => new Promise(() => {}))), /read deadline exceeded after 4000ms/);
  context.mock.timers.tick(4_000); await pending;
});

function route(market: 'ETH' | 'BTC' = 'ETH', side: 'long' | 'short' = 'long', now = Date.now()): PlannedRoute {
  const poolAddress = positionPoolAddress(market, side);
  return { operation: 'increasePosition', chainId: 1, walletAddress: '0x1111111111111111111111111111111111111111', transactions: [],
    policy: { reviewedAction: { kind: 'position-increase', poolAddress, positionId: 0, positionType: side } } as PlannedRoute['policy'],
    details: { tradeFundingQuote: { market, side, poolAddress, ratio: '45318576060452136', readAt: now, offset: { oppositeRatio: '0', longCollateral: '1', shortCollateral: '1', shortDebt: '1', blockNumber: '100' } } } };
}
test('funding facts require exact reviewed market, side, pool, operation and original freshness', () => {
  const now = Date.now();
  for (const market of ['ETH', 'BTC'] as const) for (const side of ['long', 'short'] as const) {
    const planned = route(market, side, now);
    assert.equal(tradeFundingReviewFact(planned, now)?.value, '≈ 0.0041% / 8h');
    assert.equal(tradeFundingReviewFact(planned, now + TRADE_FUNDING_MAX_AGE_MS), undefined);
    const quote = planned.details!.tradeFundingQuote!;
    assert.equal(tradeFundingIsFresh({ market, side, pool: quote.poolAddress, ratio: 1n, readAt: now }, market, side, now - 1), false);
    for (const edit of [
      () => { quote.side = side === 'long' ? 'short' : 'long'; },
      () => { quote.poolAddress = positionPoolAddress(market, side === 'long' ? 'short' : 'long'); },
      () => { quote.market = market === 'ETH' ? 'BTC' : 'ETH'; },
      () => { quote.readAt = now + 1; },
      () => { quote.ratio = '-1'; },
      () => { quote.ratio = (2n ** 256n).toString(); },
    ]) { const original = { ...quote }; edit(); assert.equal(tradeFundingReviewFact(planned, now), undefined); Object.assign(quote, original); }
    planned.details!.borrowFundingQuote = { poolAddress: positionPoolAddress(market, 'long'), ratio: '0', netRatio: '0', readAt: now };
    planned.details!.tradeFundingQuote = undefined;
    assert.equal(tradeFundingReviewFact(planned, now), undefined, 'Borrow net quote cannot provide Trade funding');
  }
  const adjust = route('BTC', 'short', now); adjust.operation = 'adjustPositionLeverage';
  adjust.policy!.reviewedAction = { ...adjust.policy!.reviewedAction!, kind: 'position-adjust' } as NonNullable<PlannedRoute['policy']>['reviewedAction'];
  assert.equal(tradeFundingReviewFact(adjust, now)?.label, 'Funding rate');
  adjust.operation = 'reducePosition'; assert.equal(tradeFundingReviewFact(adjust, now), undefined);
});

const WAD = 10n ** 18n;
function offsetRate(side: 'long' | 'short' = 'long') {
  return { market: 'ETH' as const, side, pool: positionPoolAddress('ETH', side), ratio: side === 'long' ? WAD / 20n : WAD / 100n, readAt: Date.now(),
    offset: { oppositeRatio: side === 'long' ? WAD / 100n : WAD / 20n, longCollateral: 100n * WAD, shortCollateral: 10_000n * WAD, shortDebt: 2n * WAD, blockNumber: 100n } };
}
test('official long and short offsets use SDK price units and preserve negative net earnings', () => {
  const long = offsetRate();
  assert.equal(tradeFundingNetRatio(long, 2000n * WAD, WAD * 5n / 4n), 49_500_000_000_000_000n);
  const short = offsetRate('short');
  const net = tradeFundingNetRatio(short, 2000n * WAD, WAD * 5n / 4n);
  assert.equal(net, -15_000_000_000_000_000n);
  assert.equal(tradeFundingDisplay(short, net).label, 'Funding rate');
  assert.match(tradeFundingDisplay(short, net).value, /^≈ -/);
  assert.match(tradeFundingDisplay(short, -1n).value, /^\(-0.0001%, 0%\)/);
  assert.equal(tradeFundingNetRatio(short), undefined);
  assert.equal(tradeFundingDisplay(short).label, 'Gross funding charge');
  short.offset.oppositeRatio = 0n;
  assert.equal(tradeFundingNetRatio(short), short.ratio, 'proven zero offset needs no price');
  short.offset.oppositeRatio = 1n; short.offset.shortCollateral = 0n;
  assert.equal(tradeFundingNetRatio(short, WAD, WAD), undefined);
});

test('review omits funding when net cannot be verified, including missing economics or malformed offsets', () => {
  const now = Date.now(); const planned = route('ETH', 'short', now);
  const snapshot = offsetRate('short');
  planned.details!.tradeFundingQuote!.ratio = snapshot.ratio.toString();
  planned.details!.tradeFundingQuote!.offset = Object.fromEntries(Object.entries(snapshot.offset).map(([key, value]) => [key, value.toString()])) as NonNullable<NonNullable<PlannedRoute['details']>['tradeFundingQuote']>['offset'];
  planned.details!.positionEconomics = { version: 1, operation: 'increase', priceWad: (2000n * WAD).toString(), rateRes: (WAD * 5n / 4n).toString(), currentColls: '0', currentDebts: '0', inputCollateral: '1', supplyFeeRatio: '0', withdrawFeeRatio: '0' };
  assert.equal(tradeFundingReviewFact(planned, now)?.label, 'Funding rate');
  assert.match(tradeFundingReviewFact(planned, now)!.value, /^≈ -/);
  planned.details!.positionEconomics.operation = 'adjust-down';
  assert.equal(tradeFundingReviewFact(planned, now), undefined);
  planned.details!.positionEconomics.operation = 'increase';
  const validOffset = planned.details!.tradeFundingQuote!.offset!;
  planned.details!.tradeFundingQuote!.offset = undefined;
  assert.equal(tradeFundingReviewFact(planned, now), undefined);
  planned.details!.tradeFundingQuote!.offset = validOffset;
  planned.details!.tradeFundingQuote!.offset!.shortDebt = '-1';
  assert.doesNotThrow(() => tradeFundingReviewFact(planned, now));
  assert.equal(tradeFundingReviewFact(planned, now), undefined);
});

test('shared cache coalesces exact pools without renewing expiry, caching errors or crossing sides', async context => {
  let now = Date.now(); context.mock.method(Date, 'now', () => now);
  let calls = 0; let settle!: (value: ReturnType<typeof offsetRate>) => void;
  const cache = createTradeFundingCache(async () => { calls++; return new Promise(resolve => { settle = resolve; }); });
  const first = cache('ETH', 'long'), second = cache('ETH', 'long');
  assert.equal(first, second); await Promise.resolve(); assert.equal(calls, 1);
  const original = offsetRate(); settle(original); await first;
  now += 59_999; assert.equal((await cache('ETH', 'long')).readAt, original.readAt); assert.equal(calls, 1);
  now++; const expired = cache('ETH', 'long'); await Promise.resolve(); assert.equal(calls, 2); settle(offsetRate()); await expired;
  const other = cache('ETH', 'short'); await Promise.resolve(); assert.equal(calls, 3); settle(offsetRate('short')); await other;
  let attempts = 0;
  const failed = createTradeFundingCache(async () => { attempts++; if (attempts === 1) throw new Error('wrong chain'); return offsetRate(); });
  await assert.rejects(failed('ETH', 'long'), /wrong chain/);
  await failed('ETH', 'long'); assert.equal(attempts, 2);
  let mismatchReads = 0;
  const mismatch = createTradeFundingCache(async () => { mismatchReads++; return offsetRate('short'); });
  await mismatch('ETH', 'long'); await mismatch('ETH', 'long'); assert.equal(mismatchReads, 2);
});

test('unavailable opposite pool does not discard the independently verified gross charge', async () => {
  const rate = await readTradeFundingRate('ETH', 'long', client(async input => {
    if (input.functionName === 'configuration') return configuration;
    if (input.functionName === 'getLongPoolFundingRatio') return WAD / 20n;
    throw new Error('offset unavailable');
  }));
  assert.equal(rate.ratio, WAD / 20n); assert.equal(rate.offset, undefined);
  assert.equal(tradeFundingDisplay(rate).label, 'Gross funding charge');
});


test('gross-only and malformed offset snapshots are returned publicly but never retained in shared cache', async () => {
 for (const malformed of [false, true]) {
  let reads = 0;
  const cached = createTradeFundingCache(async () => { reads++; const rate = offsetRate(); if (malformed) rate.offset.shortDebt = -1n; else delete (rate as { offset?: unknown }).offset; return rate; });
  assert.equal((await cached('ETH', 'long')).ratio, WAD / 20n);
  await cached('ETH', 'long'); assert.equal(reads, 2);
 }
});
