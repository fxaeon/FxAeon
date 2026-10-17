import { formatUnits } from 'viem';
import type { WalletBalancesResult } from './fx/balances';
import type { UsdPriceSnapshot } from './prices';
import { usdValueForUnits } from './prices';
import { ASSET_BALANCE_MAX_AGE_MS, ASSET_PRICE_MAX_AGE_MS, emptyWalletSnapshot, filterSupportedWalletAssets, summarizeWalletAssets, type WalletAssetSnapshot } from './walletAssets';

const freshTimestamp = (timestamp: number | null | undefined, now: number, maxAge: number) =>
  typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
    && now - timestamp <= maxAge && timestamp <= now + 30_000;

export type VerifiedPortfolioTotal = { walletAddress: string; totalUsd: number; verifiedAt: number };

/** Retain a recent complete total through transient read failures as well as
 * in-flight refreshes, without extending the original freshness window. */
export function portfolioHeadlineTotal(
  currentTotalUsd: number | null,
  previous: VerifiedPortfolioTotal | null,
  walletAddress: string,
  now = Date.now(),
): { displayTotalUsd: number | null; verified: VerifiedPortfolioTotal | null } {
  if (typeof currentTotalUsd === 'number' && Number.isFinite(currentTotalUsd) && currentTotalUsd >= 0) {
    const verified = { walletAddress: walletAddress.toLowerCase(), totalUsd: currentTotalUsd, verifiedAt: now };
    return { displayTotalUsd: currentTotalUsd, verified };
  }
  const keepPrevious = previous?.walletAddress === walletAddress.toLowerCase()
    && freshTimestamp(previous.verifiedAt, now, ASSET_BALANCE_MAX_AGE_MS);
  return { displayTotalUsd: keepPrevious ? previous.totalUsd : null, verified: keepPrevious ? previous : null };
}

/**
 * Returns the subtotal of independently fresh, priced rows available from
 * either portfolio source. The canonical Ethereum balance query fills holes
 * while expanded discovery is pending; an existing expanded row wins so the
 * same asset is never counted twice.
 */
export function knownFreshPortfolioSubtotal(
  snapshot: WalletAssetSnapshot | null,
  balances: WalletBalancesResult | null,
  balanceUpdatedAt: number | null,
  prices: UsdPriceSnapshot,
  now = Date.now(),
): { totalUsd: number | null; assetCount: number; hasKnownValue: boolean } {
  const values = new Map<string, { value: number; updatedAt: number }>();
  const positiveAssets = new Set<string>();
  const exactBalances = balanceUpdatedAt !== null && freshTimestamp(balanceUpdatedAt, now, ASSET_BALANCE_MAX_AGE_MS)
    ? new Map((balances?.balances ?? []).map((balance) => [`1:${balance.key}`, balance]))
    : new Map();
  const newestSnapshotAsset = new Map<string, number>();
  for (const asset of snapshot?.assets ?? []) {
    if (!asset.canonicalKey) continue;
    const key = `${asset.chainId}:${asset.canonicalKey}`;
    newestSnapshotAsset.set(key, Math.max(newestSnapshotAsset.get(key) ?? 0, asset.balanceUpdatedAt));
  }
  let hasKnownValue = false;
  let hasUnresolvedPositiveAsset = false;

  for (const asset of snapshot?.assets ?? []) {
    const exactBalance = asset.canonicalKey ? exactBalances.get(`${asset.chainId}:${asset.canonicalKey}`) : undefined;
    // At equal balance timestamps the merged row may carry a fresh quote
    // absent from the latest partial provider response. Do not discard it.
    if (exactBalance && balanceUpdatedAt !== null
      && (balanceUpdatedAt > asset.balanceUpdatedAt
        || (balanceUpdatedAt === asset.balanceUpdatedAt && exactBalance.amountWei !== asset.balanceWei))) continue;
    if (asset.balanceWei > 0n) hasUnresolvedPositiveAsset = true;
    // Canonical token keys repeat across networks (for example fxUSD on
    // Ethereum and Base), so retain chain identity when deduplicating rows.
    const assetKey = asset.canonicalKey ? `${asset.chainId}:${asset.canonicalKey}` : asset.id;
    if (asset.balanceWei > 0n && freshTimestamp(asset.balanceUpdatedAt, now, ASSET_BALANCE_MAX_AGE_MS)) positiveAssets.add(assetKey);
    if (asset.balanceWei <= 0n || asset.usdValue === null || !Number.isFinite(asset.usdValue) || asset.usdValue < 0
      || asset.priceStatus !== 'fresh' || !freshTimestamp(asset.priceUpdatedAt, now, ASSET_PRICE_MAX_AGE_MS)
      || !freshTimestamp(asset.balanceUpdatedAt, now, ASSET_BALANCE_MAX_AGE_MS)) continue;
    values.set(assetKey, { value: asset.usdValue, updatedAt: asset.balanceUpdatedAt });
    hasKnownValue = true;
  }

  if (balances && balanceUpdatedAt !== null && freshTimestamp(balanceUpdatedAt, now, ASSET_BALANCE_MAX_AGE_MS)) {
    for (const balance of balances.balances) {
      const key = `1:${balance.key}`;
      if ((newestSnapshotAsset.get(key) ?? 0) > balanceUpdatedAt) continue;
      const existing = values.get(key);
      if (existing && existing.updatedAt >= balanceUpdatedAt!) continue;
      if (balance.amountWei <= 0n) {
        positiveAssets.delete(key);
        values.delete(key);
        hasKnownValue = true;
        continue;
      } else positiveAssets.add(key);
      const priceUpdatedAt = prices.updatedAts?.[balance.key] ?? prices.updatedAt;
      const candidatePrice = prices.prices[balance.key];
      if (typeof candidatePrice !== 'number' || !Number.isFinite(candidatePrice) || candidatePrice <= 0
        || !freshTimestamp(priceUpdatedAt, now, ASSET_PRICE_MAX_AGE_MS)) continue;
      hasKnownValue = true;
      if (balance.amountWei <= 0n) continue;
      const value = usdValueForUnits(balance.amountWei, balance.decimals, candidatePrice);
      if (value !== null) values.set(key, { value, updatedAt: balanceUpdatedAt! });
    }
  }

  const completeKnownZeroSnapshot = Boolean(snapshot) && snapshot!.source !== 'alchemy'
    && snapshot!.unpricedAssetCount === 0
    && snapshot!.assets.every((asset) => asset.balanceWei <= 0n)
    && Object.values(snapshot!.networks).every((network) => network.status === 'ready')
    && freshTimestamp(snapshot!.updatedAt, now, ASSET_BALANCE_MAX_AGE_MS);
  if (completeKnownZeroSnapshot) hasKnownValue = true;
  // A zero balance for an unrelated token is not evidence that an unpriced
  // positive holding is worth zero. Keep unavailable distinct from empty.
  hasKnownValue = values.size > 0 || (hasKnownValue && positiveAssets.size === 0 && !hasUnresolvedPositiveAsset);

  return {
    totalUsd: values.size > 0 ? [...values.values()].reduce((sum, row) => sum + row.value, 0) : hasKnownValue ? 0 : null,
    assetCount: positiveAssets.size,
    hasKnownValue,
  };
}

/** Adds independently verified Ethereum balances for display while preserving
 * the expanded snapshot's network completeness flags. This lets Portfolio
 * show an exact balance immediately without claiming discovery is complete. */
export function mergeFreshCanonicalWalletBalances(
  snapshot: WalletAssetSnapshot,
  balances: WalletBalancesResult | null,
  balanceUpdatedAt: number | null,
  prices: UsdPriceSnapshot,
  now = Date.now(),
): WalletAssetSnapshot {
  const supportedSnapshot = filterSupportedWalletAssets(snapshot);
  if (!balances || balanceUpdatedAt === null || !freshTimestamp(balanceUpdatedAt, now, ASSET_BALANCE_MAX_AGE_MS)) return supportedSnapshot;
  const assets = new Map(supportedSnapshot.assets.map((asset) => [asset.id, asset]));
  let addedCanonicalRow = false;
  for (const balance of balances.balances) {
    addedCanonicalRow = true;
    const tokenAddress = balance.key === 'ETH' ? null : balance.address;
    const id = `1:${tokenAddress?.toLowerCase() ?? 'native'}`;
    const existing = assets.get(id);
    if (balance.amountWei <= 0n) {
      if (existing && existing.balanceUpdatedAt <= balanceUpdatedAt) assets.delete(id);
      continue;
    }
    if (existing?.source === 'canonical' && existing.balanceUpdatedAt >= balanceUpdatedAt) continue;
    if (existing?.source === 'alchemy' && existing.balanceUpdatedAt > balanceUpdatedAt) continue;
    const priceUpdatedAt = prices.updatedAts?.[balance.key] ?? prices.updatedAt;
    const candidatePrice = prices.prices[balance.key];
    const priceIsFresh = typeof candidatePrice === 'number' && Number.isFinite(candidatePrice) && candidatePrice > 0
      && freshTimestamp(priceUpdatedAt, now, ASSET_PRICE_MAX_AGE_MS);
    const retainedPriceIsFresh = typeof existing?.priceUsd === 'number' && Number.isFinite(existing.priceUsd) && existing.priceUsd > 0
      && freshTimestamp(existing.priceUpdatedAt, now, ASSET_PRICE_MAX_AGE_MS);
    const priceUsd = priceIsFresh ? candidatePrice : retainedPriceIsFresh ? existing.priceUsd : null;
    const validatedPriceUpdatedAt = (priceIsFresh && priceUsd !== null ? priceUpdatedAt : retainedPriceIsFresh ? existing?.priceUpdatedAt : null) ?? null;
    assets.set(id, {
      id, chainId: 1, network: 'ethereum', tokenAddress, canonicalKey: balance.key,
      symbol: balance.key, name: balance.key === 'ETH' ? 'Ethereum' : balance.key,
      decimals: balance.decimals, balanceWei: balance.amountWei,
      balance: formatUnits(balance.amountWei, balance.decimals), balanceUpdatedAt: balanceUpdatedAt!,
      priceUsd, priceUpdatedAt: priceUsd === null ? null : validatedPriceUpdatedAt,
      priceStatus: priceUsd === null ? 'unavailable' : 'fresh', usdValue: null,
      logoUrl: existing?.logoUrl ?? null, source: 'canonical',
    });
    addedCanonicalRow = true;
  }
  const source = addedCanonicalRow && supportedSnapshot.source === 'alchemy' ? 'mixed' : supportedSnapshot.source;
  return summarizeWalletAssets({ ...supportedSnapshot, assets: [...assets.values()], source,
    updatedAt: Math.max(supportedSnapshot.updatedAt, balanceUpdatedAt) }, now);
}

/** Builds a partial display snapshot when the expanded asset source has not
 * returned yet. Exact Ethereum reads can render immediately; Base remains
 * pending or unavailable until its independent read has verified it. */
export function canonicalWalletBalancesSnapshot(
  walletAddress: string,
  balances: WalletBalancesResult | null,
  balanceUpdatedAt: number | null,
  prices: UsdPriceSnapshot,
  otherChainStatus: 'pending' | 'unavailable' = 'pending',
  now = Date.now(),
): WalletAssetSnapshot | null {
  if (!balances || balanceUpdatedAt === null || !freshTimestamp(balanceUpdatedAt, now, ASSET_BALANCE_MAX_AGE_MS)) return null;
  const snapshot = emptyWalletSnapshot(walletAddress, balanceUpdatedAt);
  snapshot.networks[1] = balances.failedTokens.length
    ? { chainId: 1, status: 'partial', error: 'Some Ethereum balances could not be refreshed.' }
    : { chainId: 1, status: 'ready', error: '' };
  snapshot.networks[8453] = otherChainStatus === 'pending'
    ? { chainId: 8453, status: 'pending', error: 'Base assets are still being verified.' }
    : { chainId: 8453, status: 'unavailable', error: 'Base assets could not be refreshed.' };
  return mergeFreshCanonicalWalletBalances(snapshot, balances, balanceUpdatedAt, prices, now);
}
