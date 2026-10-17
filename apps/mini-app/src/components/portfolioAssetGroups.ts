import { ASSET_BALANCE_MAX_AGE_MS, ASSET_PRICE_MAX_AGE_MS, type WalletAsset } from '../lib/walletAssets';

/** Only a fresh, positively held, verified dollar amount can be grouped as low value. */
export function isLowValuePortfolioAsset(asset: WalletAsset, now = Date.now()): boolean {
  return asset.balanceWei > 0n && asset.priceStatus === 'fresh'
    && asset.priceUsd !== null && Number.isFinite(asset.priceUsd) && asset.priceUsd > 0
    && asset.usdValue !== null && Number.isFinite(asset.usdValue) && asset.usdValue >= 0 && asset.usdValue < 1
    && asset.balanceUpdatedAt <= now && now - asset.balanceUpdatedAt <= ASSET_BALANCE_MAX_AGE_MS
    && asset.priceUpdatedAt !== null && asset.priceUpdatedAt <= now + 30_000 && now - asset.priceUpdatedAt <= ASSET_PRICE_MAX_AGE_MS;
}
