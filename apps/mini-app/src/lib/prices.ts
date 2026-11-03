import { formatUnits } from 'viem';
import { FX_TOKENS, type FxTokenKey } from '@/lib/fx/tokens';
import { FX_PRICE_SERVICE_ENDPOINT, parseFxPriceService, readFxProtocolPrices } from '@/lib/fxProtocolPrices';

export type PriceStatus = 'loading' | 'ready' | 'partial' | 'stale' | 'unavailable';
export type UsdPriceMap = Partial<Record<FxTokenKey, number>>;

export interface UsdPriceSnapshot {
  prices: UsdPriceMap;
  status: PriceStatus;
  updatedAt: number | null;
  /** Validation time for each quote; updatedAt remains the oldest quote for legacy consumers. */
  updatedAts?: Partial<Record<FxTokenKey, number>>;
}

export type UsdPriceUpdate = {
  prices: UsdPriceMap;
  updatedAt: number | null;
  updatedAts: Partial<Record<FxTokenKey, number>>;
};
export type UsdPriceProgressCallback = (snapshot: UsdPriceUpdate) => void;

type LlamaCoin = {
  price?: unknown;
  timestamp?: unknown;
  confidence?: unknown;
};

type LlamaResponse = {
  coins?: Record<string, LlamaCoin>;
};

const PRICE_KEYS = Object.keys(FX_TOKENS) as FxTokenKey[];
export const USD_PRICE_ASSET_COUNT = PRICE_KEYS.length;
const ETH_PRICE_ADDRESS = FX_TOKENS.WETH.address;
// Display-only provider snapshots may remain usable for up to one hour. The
// supported FX_TOKENS set is read first from f(x)'s own sources (its oracles,
// vault NAVs and price service); DefiLlama and CoinGecko only fill gaps, and
// their token quotes can publish asynchronously (wstETH/FXN were observed at
// roughly twenty-two minutes old). Keep each source timestamp unchanged; this
// window is never an execution price authority.
export const USD_PRICE_MAX_AGE_MS = 60 * 60 * 1_000;
const MAX_PRICE_AGE_SECONDS = USD_PRICE_MAX_AGE_MS / 1_000;
const MIN_CONFIDENCE = 0.5;
export const USD_PRICE_CACHE_KEY = 'fxaeon:usd-prices:v1';
// Cached and live quotes share the provider's display freshness window.
// Keep this export for the refresh merger's existing policy boundary.
export const USD_PRICE_CACHE_MAX_AGE_MS = USD_PRICE_MAX_AGE_MS;
const FALLBACK_CACHE_MS = 60_000;
const FALLBACK_PRIORITY: FxTokenKey[] = ['fxUSD', 'wstETH', 'ETH', 'WBTC', 'FXN', 'USDC', 'USDT', 'stETH', 'WETH', 'fxUSDBasePool', 'fxSAVE'];

function validTimestamp(value: unknown, nowSeconds: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    && nowSeconds - value <= MAX_PRICE_AGE_SECONDS && value - nowSeconds <= 120;
}

function coinId(key: FxTokenKey): string {
  const address = key === 'ETH' ? ETH_PRICE_ADDRESS : FX_TOKENS[key].address;
  return `ethereum:${address.toLowerCase()}`;
}

export const USD_PRICE_ENDPOINT = `https://coins.llama.fi/prices/current/${[
  ...new Set(PRICE_KEYS.map(coinId)),
].join(',')}`;

export function parseUsdPriceResponse(payload: unknown, nowSeconds = Math.floor(Date.now() / 1000)): {
  prices: UsdPriceMap;
  updatedAt: number | null;
  updatedAts: Partial<Record<FxTokenKey, number>>;
} {
  if (!payload || typeof payload !== 'object') throw new Error('Price response is not an object');
  const coins = (payload as LlamaResponse).coins;
  if (!coins || typeof coins !== 'object') throw new Error('Price response has no coins');

  const prices: UsdPriceMap = {};
  const updatedAts: Partial<Record<FxTokenKey, number>> = {};
  let oldestTimestamp = Infinity;
  for (const key of PRICE_KEYS) {
    const coin = coins[coinId(key)];
    const price = Number(coin?.price);
    const timestamp = Number(coin?.timestamp);
    const confidence = Number(coin?.confidence);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!validTimestamp(timestamp, nowSeconds)) continue;
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE || confidence > 1) continue;
    prices[key] = price;
    updatedAts[key] = timestamp * 1000;
    oldestTimestamp = Math.min(oldestTimestamp, timestamp);
  }

  // Each token is independently validated. An unavailable fxUSD quote must
  // not erase a fresh ETH price; consumers still require every held asset
  // needed for a total, and must never substitute a stablecoin's peg.
  if (Object.keys(prices).length === 0) throw new Error('Price response has no validated prices');
  return { prices, updatedAt: oldestTimestamp * 1000, updatedAts };
}

function priceAddress(key: FxTokenKey): string {
  return (key === 'ETH' ? ETH_PRICE_ADDRESS : FX_TOKENS[key].address).toLowerCase();
}

export function coinGeckoTokenPriceEndpoint(key: FxTokenKey): string {
  // The keyless endpoint permits one contract per request. Authenticated
  // plans support different limits; their batch allowance does not apply here.
  const query = new URLSearchParams({
    contract_addresses: priceAddress(key),
    vs_currencies: 'usd',
    include_last_updated_at: 'true',
  });
  return `https://api.coingecko.com/api/v3/simple/token_price/ethereum?${query}`;
}

export function parseCoinGeckoTokenPriceResponse(payload: unknown, key: FxTokenKey, nowSeconds = Math.floor(Date.now() / 1000)): { price: number; timestamp: number } | null {
  if (!payload || typeof payload !== 'object') return null;
  const address = priceAddress(key);
  const coin = (payload as Record<string, { usd?: unknown; last_updated_at?: unknown }>)[address];
  if (typeof coin?.usd !== 'number' || !Number.isFinite(coin.usd) || coin.usd <= 0 || !validTimestamp(coin.last_updated_at, nowSeconds)) return null;
  return { price: coin.usd, timestamp: coin.last_updated_at };
}

/**
 * Bounded, display-only prices. No price is used by transaction planning.
 * f(x)'s own sources lead: its oracles, vault NAVs and Chainlink feeds read
 * on-chain at one block, and its price service for FXN and fxUSD. DefiLlama
 * then CoinGecko fill only the tokens those leave out, each still validated
 * on its own and never replacing a fresher quote.
 */
export function createUsdPriceFetcher({ readProtocolPrices = () => readFxProtocolPrices() }: {
  readProtocolPrices?: () => Promise<UsdPriceUpdate>;
} = {}) {
  const fallbackCache = new Map<string, { checkedAt: number; value: { price: number; timestamp: number } | null }>();
  let providerBackoffUntil = 0;
  return async (request: typeof fetch = fetch, signal?: AbortSignal, onProgress?: UsdPriceProgressCallback): Promise<UsdPriceUpdate> => {
    const prices: UsdPriceMap = {};
    const updatedAts: Partial<Record<FxTokenKey, number>> = {};
    let oldestTimestamp = Infinity;
    const requestJson = async (url: string, timeoutMs = 8_000) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      return request(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    };
    // Adds a source's quotes for tokens not yet priced, then publishes them at once,
    // so a slower source below never hides useful values from the provider.
    const take = (update: UsdPriceUpdate) => {
      let added = false;
      for (const [key, price] of Object.entries(update.prices) as [FxTokenKey, number][]) {
        const at = update.updatedAts[key];
        if (prices[key] || at === undefined) continue;
        prices[key] = price;
        updatedAts[key] = at;
        oldestTimestamp = Math.min(oldestTimestamp, at / 1000);
        added = true;
      }
      if (!added) return;
      signal?.throwIfAborted();
      onProgress?.({ prices: { ...prices }, updatedAt: oldestTimestamp * 1000, updatedAts: { ...updatedAts } });
    };
    const [protocol, service] = await Promise.allSettled([
      readProtocolPrices(),
      requestJson(FX_PRICE_SERVICE_ENDPOINT).then(async response => {
        if (!response.ok) throw new Error('Price service unavailable');
        return parseFxPriceService(await response.json());
      }),
    ]);
    signal?.throwIfAborted();
    if (protocol.status === 'fulfilled') take(protocol.value);
    if (service.status === 'fulfilled') take(service.value);
    if (PRICE_KEYS.some(key => !prices[key])) {
      try {
        const response = await requestJson(USD_PRICE_ENDPOINT);
        if (response.ok) take(parseUsdPriceResponse(await response.json()));
      } catch {
        // A partial or failed secondary feed does not make a different token's
        // independently validated fallback price an execution authority.
      }
    }
    signal?.throwIfAborted();
    const missing = FALLBACK_PRIORITY.filter((key) => !prices[key]);
    const now = Date.now();
    const due = missing.filter((key) => {
      const cached = fallbackCache.get(coinId(key));
      return !cached || now - cached.checkedAt >= FALLBACK_CACHE_MS;
    });
    const fallbackDeadline = now + 8_000;
    const requestedAddresses = new Set<string>();
    for (const key of due) {
      if (Date.now() >= providerBackoffUntil && Date.now() < fallbackDeadline) {
        // ETH and WETH share one quote and one cache entry.
        const address = priceAddress(key);
        if (requestedAddresses.has(address)) continue;
        requestedAddresses.add(address);
      } else break;
      let value: { price: number; timestamp: number } | null = null;
      let stop = false;
      try {
        const response = await requestJson(coinGeckoTokenPriceEndpoint(key), Math.max(1, fallbackDeadline - Date.now()));
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const seconds = retryAfter ? Number(retryAfter) : NaN;
          const retryMs = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - now : 0;
          providerBackoffUntil = now + Math.max(120_000, Number.isFinite(retryMs) ? retryMs : 0);
          stop = true;
        } else if (!response.ok) {
          // A service/authentication failure applies to the provider, not
          // just this token. Do not fan out more failing requests.
          providerBackoffUntil = Date.now() + FALLBACK_CACHE_MS;
          stop = true;
        }
        if (response.ok) value = parseCoinGeckoTokenPriceResponse(await response.json(), key);
      } catch {
        providerBackoffUntil = Date.now() + FALLBACK_CACHE_MS;
        stop = true;
      }
      signal?.throwIfAborted();
      fallbackCache.set(coinId(key), { checkedAt: Date.now(), value });
      if (value) {
        prices[key] = value.price;
        updatedAts[key] = value.timestamp * 1000;
        oldestTimestamp = Math.min(oldestTimestamp, value.timestamp);
        onProgress?.({ prices: { ...prices }, updatedAt: oldestTimestamp * 1000, updatedAts: { ...updatedAts } });
      }
      if (stop) break;
    }
    for (const key of missing) {
      const cached = fallbackCache.get(coinId(key));
      if (cached?.value && validTimestamp(cached.value.timestamp, Math.floor(Date.now() / 1000))) {
        prices[key] = cached.value.price;
        updatedAts[key] = cached.value.timestamp * 1000;
        oldestTimestamp = Math.min(oldestTimestamp, cached.value.timestamp);
      }
    }
    signal?.throwIfAborted();
    if (Object.keys(prices).length === 0) throw new Error('Price services have no validated prices');
    return { prices: { ...prices }, updatedAt: oldestTimestamp * 1000, updatedAts: { ...updatedAts } };
  };
}

export const fetchUsdPrices = createUsdPriceFetcher();

/**
 * Local storage is an availability aid, not a second price oracle. Only a
 * recently validated snapshot is accepted, and every value is re-checked
 * before it can reach the UI. The provider always refreshes it immediately.
 */
export function parseUsdPriceCache(
  payload: unknown,
  nowMs = Date.now(),
): { prices: UsdPriceMap; updatedAt: number; updatedAts?: Partial<Record<FxTokenKey, number>> } | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as { prices?: unknown; updatedAt?: unknown; updatedAts?: unknown };
  const updatedAt = Number(candidate.updatedAt);
  const rawUpdatedAts = candidate.updatedAts;
  const hasPerQuoteTimes = Boolean(rawUpdatedAts && typeof rawUpdatedAts === 'object' && !Array.isArray(rawUpdatedAts));
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  if (!hasPerQuoteTimes && (updatedAt - nowMs > 120_000 || nowMs - updatedAt > USD_PRICE_CACHE_MAX_AGE_MS)) return null;
  if (!candidate.prices || typeof candidate.prices !== 'object') return null;

  const prices: UsdPriceMap = {};
  const updatedAts: Partial<Record<FxTokenKey, number>> = {};
  for (const key of PRICE_KEYS) {
    const value = Number((candidate.prices as Partial<Record<FxTokenKey, unknown>>)[key]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const perQuote = hasPerQuoteTimes ? Number((rawUpdatedAts as Partial<Record<FxTokenKey, unknown>>)[key]) : updatedAt;
    if (!Number.isFinite(perQuote) || perQuote <= 0 || perQuote - nowMs > 120_000 || nowMs - perQuote > USD_PRICE_CACHE_MAX_AGE_MS) continue;
    prices[key] = value;
    updatedAts[key] = perQuote;
  }
  if (Object.keys(prices).length === 0) return null;
  const oldestUpdatedAt = Math.min(...Object.values(updatedAts));
  return { prices, updatedAt: Number.isFinite(oldestUpdatedAt) ? oldestUpdatedAt : updatedAt, ...(hasPerQuoteTimes ? { updatedAts } : {}) };
}

export function priceKeyForSymbol(symbol: string): FxTokenKey | null {
  const normalised = symbol.replace(/\s+/g, '').toLowerCase();
  if (normalised === 'eth') return 'ETH';
  if (normalised === 'weth') return 'WETH';
  if (normalised === 'steth') return 'stETH';
  if (normalised === 'wsteth') return 'wstETH';
  if (normalised === 'btc' || normalised === 'wbtc') return 'WBTC';
  if (normalised === 'usdc') return 'USDC';
  if (normalised === 'usdt') return 'USDT';
  if (normalised === 'fxusd') return 'fxUSD';
  if (normalised === 'fxsave') return 'fxSAVE';
  if (normalised === 'fxn' || normalised === '$fxn') return 'FXN';
  if (normalised === 'fxusdbasepool' || normalised === 'basepool' || normalised === 'fxsp') return 'fxUSDBasePool';
  return null;
}

export function usdValueForDecimal(value: string, price: number | undefined): number | null {
  if (!price || !Number.isFinite(price) || price <= 0 || value.toLowerCase() === 'all') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const usd = amount * price;
  return Number.isFinite(usd) ? usd : null;
}

export function usdValueForUnits(value: bigint, decimals: number, price: number | undefined): number | null {
  return usdValueForDecimal(formatUnits(value, decimals), price);
}

export function formatUsd(value: number | null | undefined, maximumFractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.01) return '<$0.01';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);
}

export function formatUsdPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const digits = value >= 1000 ? 2 : value >= 1 ? 2 : 4;
  return formatUsd(value, digits);
}
