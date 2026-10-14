import { FX_TOKENS } from './fx/tokens';
import { usdValueForDecimal, usdValueForUnits, type UsdPriceMap } from './prices';

/**
 * SDK 1.0.5: convertToAssets/totalAssets are denominated in fxSAVE.asset(),
 * the fxUSD base-pool share token (fxSP, the f(x) Stability Pool share), not fxUSD. Pending redemptions come from
 * that base pool's redeemRequests, whereas balance/totalSupply are fxSAVE.
 */
export const FX_SAVE_UNITS = {
  balanceWei: { priceKey: 'fxSAVE', label: 'fxSAVE' },
  totalSupplyWei: { priceKey: 'fxSAVE', label: 'fxSAVE' },
  assetsWei: { priceKey: 'fxUSDBasePool', label: 'fxSP' },
  totalAssetsWei: { priceKey: 'fxUSDBasePool', label: 'fxSP' },
  pendingSharesWei: { priceKey: 'fxUSDBasePool', label: 'fxSP' },
} as const;

/**
 * The SDK deliberately skips convertToAssets when the wallet owns no fxSAVE
 * shares, so `assetsWei` is undefined for a successful zero-balance read.
 * Present that authoritative zero as zero; keep a missing conversion for a
 * non-zero balance unavailable instead of inventing a value.
 */
export function normalizedFxSaveAssetsWei(
  balanceWei: bigint,
  assetsWei: bigint | undefined,
): bigint | undefined {
  return assetsWei ?? (balanceWei === 0n ? 0n : undefined);
}

/** Display-only valuation; a missing matching quote never falls back to fxUSD. */
export function fxSaveUsdValue(
  field: keyof typeof FX_SAVE_UNITS,
  value: bigint | string | null | undefined,
  prices: UsdPriceMap,
): number | null {
  if (value === null || value === undefined) return null;
  if ((typeof value === 'bigint' && value === 0n) || (typeof value === 'string' && /^(?:0+(?:\.0*)?|\.0+)$/.test(value.trim()))) return 0;
  const { priceKey } = FX_SAVE_UNITS[field];
  return typeof value === 'bigint'
    ? usdValueForUnits(value, FX_TOKENS[priceKey].decimals, prices[priceKey])
    : usdValueForDecimal(value, prices[priceKey]);
}

/** Prefer valued onchain holdings; accept a recent address-verified official TVL when unavailable. */
export function fxSaveVaultUsdValue(totalAssetsWei: bigint | undefined, prices: UsdPriceMap,
  reported: { tvlUsd?: number; observedAt: number } | null, now = Date.now()): number | null {
  const valued = fxSaveUsdValue('totalAssetsWei', totalAssetsWei, prices);
  if (valued !== null) return valued;
  const tvl = reported?.tvlUsd;
  return typeof tvl === 'number' && Number.isFinite(tvl) && tvl >= 0
    && typeof reported?.observedAt === 'number' && reported.observedAt <= now && now - reported.observedAt < 300_000 ? tvl : null;
}
