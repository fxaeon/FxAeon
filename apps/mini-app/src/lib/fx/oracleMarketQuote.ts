import { coinGeckoTokenPriceEndpoint, parseCoinGeckoTokenPriceResponse, type UsdPriceSnapshot } from '../prices';
import { ORACLE_MARKET_MAX_SKEW_MS, type OracleObservation } from './oracleComparison';

type Token = OracleObservation['token'];
export const ORACLE_MARKET_REFRESH_MS = 60_000;

/** Separate comparison quote: never replaces the app's display price feed. */
export function createOracleMarketQuoteFetcher(request: typeof fetch = fetch) {
  let backoffUntil = 0;
  let active: { token: Token; signal?: AbortSignal; promise: Promise<UsdPriceSnapshot> } | null = null;
  const cache = new Map<Token, { checkedAt: number; value: UsdPriceSnapshot | null }>();
  return function read(token: Token, signal?: AbortSignal): Promise<UsdPriceSnapshot> {
    const now = Date.now();
    if (signal?.aborted) return Promise.reject(signal.reason);
    const cached = cache.get(token);
    if (cached && now - cached.checkedAt < ORACLE_MARKET_REFRESH_MS) {
      return cached.value ? Promise.resolve(cached.value) : Promise.reject(new Error('Comparison quote unavailable'));
    }
    if (active?.signal?.aborted) active = null;
    if (active?.token === token) return active.promise;
    if (active) return active.promise.catch(() => undefined).then(() => read(token, signal));
    if (now < backoffUntil) return Promise.reject(new Error('Comparison price provider cooling down'));
    const work = { token, signal, promise: Promise.resolve(null as unknown as UsdPriceSnapshot) };
    active = work;
    work.promise = (async () => {
      let value: UsdPriceSnapshot | null = null;
      try {
        const timeout = AbortSignal.timeout(5_000);
        const response = await request(coinGeckoTokenPriceEndpoint(token), {
          headers: { Accept: 'application/json' }, cache: 'no-store',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        signal?.throwIfAborted();
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const seconds = retryAfter ? Number(retryAfter) : NaN;
          const delay = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
          backoffUntil = Date.now() + Math.max(120_000, Number.isFinite(delay) ? delay : 0);
        }
        if (!response.ok) throw new Error('Comparison price provider unavailable');
        const quote = parseCoinGeckoTokenPriceResponse(await response.json(), token);
        signal?.throwIfAborted();
        const timestamp = quote ? quote.timestamp * 1000 : 0;
        if (!quote || timestamp > Date.now() || Date.now() - timestamp > ORACLE_MARKET_MAX_SKEW_MS) throw new Error('Recent comparison quote unavailable');
        value = { status: 'ready', prices: { [token]: quote.price }, updatedAt: timestamp, updatedAts: { [token]: timestamp } };
        return value;
      } finally {
        if (!signal?.aborted) cache.set(token, { checkedAt: Date.now(), value });
        if (active === work) active = null;
      }
    })();
    return work.promise;
  };
}

export const fetchOracleMarketQuote = createOracleMarketQuoteFetcher();
