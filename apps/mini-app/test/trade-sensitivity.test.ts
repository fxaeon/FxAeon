import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeSensitivity, tradeScenarioPrice, tradeMarketReference } from '../src/lib/tradeSensitivity';
import { USD_PRICE_MAX_AGE_MS, type UsdPriceSnapshot } from '../src/lib/prices';

test('scenario HTTP fallback selects the market and rejects stale or invalid observations', () => {
  const now = 10_000_000;
  const snapshot: UsdPriceSnapshot = { status: 'partial', prices: { ETH: 2400, WBTC: 90_000 }, updatedAt: now - USD_PRICE_MAX_AGE_MS, updatedAts: { ETH: now - 1000, WBTC: now - 2000 } };
  assert.equal(tradeMarketReference(snapshot, 'ETH', now), 2400);
  assert.equal(tradeMarketReference(snapshot, 'BTC', now), 90_000);
  assert.equal(tradeMarketReference({ ...snapshot, updatedAts: undefined }, 'ETH', now), null);
  assert.equal(tradeMarketReference({ ...snapshot, updatedAts: { ETH: now + 1 } }, 'ETH', now), null);
  for (const status of ['stale', 'unavailable'] as const) assert.equal(tradeMarketReference({ ...snapshot, status }, 'ETH', now), null);
  for (const price of [undefined, NaN, Infinity, 0, -1]) assert.equal(tradeMarketReference({ ...snapshot, prices: { ETH: price } }, 'ETH', now), null);
});

test('initial sensitivity follows economic leverage and reverses for shorts', () => {
  assert.equal(tradeSensitivity(-10, 2, 'long'), -20);
  assert.equal(tradeSensitivity(-10, 2, 'short'), 20);
  assert.equal(tradeSensitivity(10, .5, 'short'), -5);
  assert.equal(tradeSensitivity(0, 3, 'short'), 0);
  // Values beyond total equity are sensitivity arithmetic, not realizable PnL.
  assert.equal(tradeSensitivity(-30, 6, 'long'), -180);
});

test('scenario price requires a positive valid reference and bounded shock', () => {
  assert.equal(tradeScenarioPrice(2000, -30), 1400);
  assert.equal(tradeScenarioPrice(2000, 30), 2600);
  for (const price of [undefined, null, NaN, Infinity, -1, 0]) assert.equal(tradeScenarioPrice(price, 10), null);
  for (const change of [NaN, Infinity, -31, 31]) {
    assert.equal(tradeScenarioPrice(2000, change), null);
    assert.equal(tradeSensitivity(change, 2, 'long'), null);
  }
  for (const leverage of [NaN, Infinity, 0, -1]) assert.equal(tradeSensitivity(10, leverage, 'long'), null);
});
