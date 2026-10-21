import { freshDisplayPrices } from './displayPrices';
import type { UsdPriceSnapshot } from './prices';

/** Display-only USD value of one fxSAVE share. Use only the canonical fxSAVE
 * quote already validated by the price provider and the display freshness
 * policy. Wallet value, fxSP assets, APY and TVL are not share-price oracles.
 * A failed/stale provider is not a current quote, even if it retained a value. */
export function fxSaveShareUsdValue(snapshot: UsdPriceSnapshot, now = Date.now()): number | null {
  if (snapshot.status === 'stale' || snapshot.status === 'unavailable') return null;
  return freshDisplayPrices(snapshot, now).fxSAVE ?? null;
}
