import { USD_PRICE_MAX_AGE_MS, type UsdPriceSnapshot } from './prices';

/** Display-only HTTP fallback while the live market stream reconnects. */
export function tradeMarketReference(snapshot: UsdPriceSnapshot, market: 'ETH' | 'BTC', now = Date.now()): number | null {
  const token = market === 'BTC' ? 'WBTC' : 'ETH';
  const observed = snapshot.updatedAts?.[token] ?? snapshot.updatedAt;
  const price = snapshot.prices[token];
  if (snapshot.status === 'stale' || snapshot.status === 'unavailable' || !observed || observed > now || now - observed >= USD_PRICE_MAX_AGE_MS || typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  return price;
}

/** First-order equity sensitivity at the selected initial economic leverage.
 * No position, price-path, funding, or liquidation model is implied. */
export function tradeSensitivity(change: number, leverage: number, side: 'long' | 'short'): number | null {
  if (!Number.isFinite(change) || change < -30 || change > 30 || !Number.isFinite(leverage) || leverage <= 0) return null;
  const result = change * leverage * (side === 'long' ? 1 : -1);
  return result === 0 ? 0 : result;
}

export function tradeScenarioPrice(price: number | null | undefined, change: number): number | null {
  if (!Number.isFinite(price) || !price || price <= 0 || !Number.isFinite(change) || change < -30 || change > 30) return null;
  return price * (1 + change / 100);
}
