import assert from 'node:assert/strict';
import test from 'node:test';
import { isLowValuePortfolioAsset } from '../src/components/portfolioAssetGroups';
import { ASSET_BALANCE_MAX_AGE_MS, ASSET_PRICE_MAX_AGE_MS, type WalletAsset } from '../src/lib/walletAssets';

const now = 1_800_000_000_000;
function asset(overrides: Partial<WalletAsset> = {}): WalletAsset {
  return {
    id: '1:native', chainId: 1, network: 'ethereum', tokenAddress: null, canonicalKey: 'ETH',
    symbol: 'ETH', name: 'Ethereum', decimals: 18, balanceWei: 10n ** 14n, balance: '0.0001',
    balanceUpdatedAt: now, priceUsd: 2_500, priceUpdatedAt: now, priceStatus: 'fresh', usdValue: 0.25,
    source: 'canonical', logoUrl: null, ...overrides,
  };
}

test('groups positively held, freshly valued assets strictly below one dollar', () => {
  assert.equal(isLowValuePortfolioAsset(asset(), now), true);
  assert.equal(isLowValuePortfolioAsset(asset({ usdValue: 0.999 }), now), true);
  assert.equal(isLowValuePortfolioAsset(asset({ usdValue: 1 }), now), false);
  assert.equal(isLowValuePortfolioAsset(asset({ usdValue: 50 }), now), false);
  assert.equal(isLowValuePortfolioAsset(asset({ balanceWei: 0n }), now), false);
});

test('unknown or invalid values remain in the main asset list', () => {
  for (const change of [
    { usdValue: null }, { usdValue: NaN }, { usdValue: -1 }, { priceUsd: null },
    { priceStatus: 'unavailable' as const }, { priceStatus: 'stale' as const }, { priceUpdatedAt: null },
  ]) assert.equal(isLowValuePortfolioAsset(asset(change), now), false);
});

test('expired balances and quotes cannot be hidden in the low-value group', () => {
  assert.equal(isLowValuePortfolioAsset(asset({ balanceUpdatedAt: now - ASSET_BALANCE_MAX_AGE_MS - 1 }), now), false);
  assert.equal(isLowValuePortfolioAsset(asset({ priceUpdatedAt: now - ASSET_PRICE_MAX_AGE_MS - 1 }), now), false);
  assert.equal(isLowValuePortfolioAsset(asset({ balanceUpdatedAt: now + 1 }), now), false);
  assert.equal(isLowValuePortfolioAsset(asset({ priceUpdatedAt: now + 30_001 }), now), false);
});
