import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FX_SAVE_SOURCE_URL,
  FX_SAVE_TOKEN_ADDRESS,
  PRICE_SOURCE_URL,
  normalizeLandingMarketData,
  validateLandingMarketData,
} from '../market-data.mjs';

const ETH = 'ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const BTC = 'ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';

function feeds(now = 1_800_000_000_000) {
  const sourceSeconds = Math.floor((now - 30_000) / 1000);
  return {
    now,
    pricePayload: { coins: {
      [ETH]: { price: 2_400, timestamp: sourceSeconds, confidence: 0.99 },
      [BTC]: { price: 80_000, timestamp: sourceSeconds, confidence: 0.95 },
    } },
    priceFetchedAt: now - 1_000,
    fxSavePayload: { code: 200, data: { fxSave: { address: FX_SAVE_TOKEN_ADDRESS, apy: '6.38', tvl: '85284837.6280' } } },
    fxSaveFetchedAt: now - 2_000,
  };
}

test('normalizes verified fxSAVE APY/TVL and timestamped ETH/WBTC USD prices', () => {
  const { now, ...input } = feeds();
  const snapshot = normalizeLandingMarketData({ ...input, now });
  assert.equal(snapshot.status, 'ready');
  assert.deepEqual(snapshot.fxSaveApy, {
    value: 6.38, status: 'fresh', fetchedAt: now - 2_000, source: 'aladdin', sourceUrl: FX_SAVE_SOURCE_URL,
  });
  assert.equal(snapshot.fxSaveTvlUsd.value, 85_284_837.628);
  assert.equal(snapshot.ethUsd.value, 2_400);
  assert.equal(snapshot.btcUsd.value, 80_000);
  assert.equal(snapshot.ethUsd.sourceAt, Math.floor((now - 30_000) / 1000) * 1000);
  assert.equal(snapshot.ethUsd.sourceUrl, PRICE_SOURCE_URL);
});

test('keeps independently validated metrics when one upstream is unavailable or invalid', () => {
  const input = feeds();
  input.fxSavePayload.data.fxSave.address = '0x0000000000000000000000000000000000000001';
  input.pricePayload.coins[BTC].confidence = 0.49;
  const snapshot = normalizeLandingMarketData(input);
  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.ethUsd.status, 'fresh');
  assert.equal(snapshot.btcUsd.status, 'unavailable');
  assert.equal(snapshot.fxSaveApy.status, 'unavailable');
  assert.equal(snapshot.fxSaveTvlUsd.status, 'unavailable');
});

test('rejects stale and future market prices without refreshing their source times', () => {
  const input = feeds();
  input.pricePayload.coins[ETH].timestamp = Math.floor((input.now - 5 * 60_000 - 1) / 1000);
  input.pricePayload.coins[BTC].timestamp = Math.floor((input.now + 121_000) / 1000);
  const snapshot = normalizeLandingMarketData(input);
  assert.equal(snapshot.ethUsd.value, null);
  assert.equal(snapshot.ethUsd.status, 'unavailable');
  assert.equal(snapshot.btcUsd.value, null);
  assert.equal(snapshot.btcUsd.status, 'unavailable');
  assert.equal(snapshot.fxSaveApy.status, 'fresh');
});

test('allows real zero APY or vault TVL and preserves percentage-point units', () => {
  const input = feeds();
  input.fxSavePayload.data.fxSave.apy = '0';
  input.fxSavePayload.data.fxSave.tvl = '0';
  const snapshot = normalizeLandingMarketData(input);
  assert.equal(snapshot.fxSaveApy.value, 0);
  assert.equal(snapshot.fxSaveTvlUsd.value, 0);
});

test('browser validation enforces source identity, values, and per-feed freshness', () => {
  const { now, ...input } = feeds();
  const payload = normalizeLandingMarketData({ ...input, now });
  const fresh = validateLandingMarketData(payload, now + 10_000);
  assert.equal(fresh.status, 'ready');
  assert.equal(fresh.btcUsd.value, 80_000);

  payload.ethUsd.sourceUrl = 'https://untrusted.example/price';
  payload.fxSaveApy.value = Number.POSITIVE_INFINITY;
  const rejected = validateLandingMarketData(payload, now + 10_000);
  assert.equal(rejected.ethUsd.status, 'unavailable');
  assert.equal(rejected.ethUsd.value, null);
  assert.equal(rejected.fxSaveApy.status, 'unavailable');
  assert.equal(rejected.btcUsd.status, 'fresh');

  const expired = validateLandingMarketData(payload, now + 6 * 60_000);
  assert.equal(expired.btcUsd.status, 'unavailable');
  assert.equal(expired.fxSaveTvlUsd.status, 'unavailable');
});
