/**
 * Validation and projection for the landing page's public market snapshot.
 *
 * This feed is display-only. ETH and WBTC prices come from f(x)'s own price
 * service, which publishes no source time, so each is as current as its fetch;
 * fxSAVE data is accepted only for the verified vault address in Aladdin's
 * official feed.
 */

export const FX_SAVE_APY_ENDPOINT = 'https://api.aladdin.club/api1/concentrator_aToken_tvl_apy';
export const FX_SAVE_TOKEN_ADDRESS = '0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39';
export const PRICE_ENDPOINT = 'https://api.aladdin.club/api/coingecko/price';
export const PRICE_SOURCE_URL = 'https://fx.aladdin.club';
export const FX_SAVE_SOURCE_URL = 'https://fx.aladdin.club/earn';
export const PRICE_SOURCE_MAX_AGE_MS = 5 * 60_000;
export const VAULT_FETCH_MAX_AGE_MS = 5 * 60_000;

const MAX_FUTURE_SKEW_MS = 120_000;

function unavailable(source, sourceUrl, fetchedAt = null, sourceAt = null) {
  return { value: null, status: 'unavailable', fetchedAt, ...(sourceAt === null ? {} : { sourceAt }), source, sourceUrl };
}

function fresh(value, source, sourceUrl, fetchedAt, sourceAt = null) {
  return { value, status: 'fresh', fetchedAt, ...(sourceAt === null ? {} : { sourceAt }), source, sourceUrl };
}

function recentFetch(fetchedAt, now, maxAge) {
  return Number.isFinite(fetchedAt) && fetchedAt > 0 && fetchedAt <= now + MAX_FUTURE_SKEW_MS && now - fetchedAt <= maxAge;
}

function positiveNumber(value) {
  const number = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value)
      : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeNumber(value, max) {
  const number = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value)
      : Number.NaN;
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
}

function boundedNonNegativeNumber(value, max) {
  const number = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value)
      : Number.NaN;
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
}

/** One quote from f(x)'s price service: `{ usd }`, current as of its fetch. */
function parsePrice(quote, fetchedAt, now) {
  const value = quote && typeof quote === 'object' && !Array.isArray(quote) ? positiveNumber(quote.usd) : null;
  if (value === null || !recentFetch(fetchedAt, now, PRICE_SOURCE_MAX_AGE_MS)) return unavailable('aladdin', PRICE_SOURCE_URL, fetchedAt);
  return fresh(value, 'aladdin', PRICE_SOURCE_URL, fetchedAt);
}

function parseFxSave(payload, fetchedAt, now) {
  if (!recentFetch(fetchedAt, now, VAULT_FETCH_MAX_AGE_MS)) {
    return { fxSaveApy: unavailable('aladdin', FX_SAVE_SOURCE_URL, fetchedAt), fxSaveTvlUsd: unavailable('aladdin', FX_SAVE_SOURCE_URL, fetchedAt) };
  }
  if (!payload || typeof payload !== 'object' || payload.code !== 200
    || !payload.data || typeof payload.data !== 'object'
    || !payload.data.fxSave || typeof payload.data.fxSave !== 'object'
    || typeof payload.data.fxSave.address !== 'string'
    || payload.data.fxSave.address.toLowerCase() !== FX_SAVE_TOKEN_ADDRESS.toLowerCase()) {
    return { fxSaveApy: unavailable('aladdin', FX_SAVE_SOURCE_URL, fetchedAt), fxSaveTvlUsd: unavailable('aladdin', FX_SAVE_SOURCE_URL, fetchedAt) };
  }
  const record = payload.data.fxSave;
  // The official feed reports APY in percentage points (e.g. "6.38" means
  // 6.38%), and its TVL field is USD. It does not expose a source update time.
  const apy = boundedNonNegativeNumber(record.apy, 1_000);
  const tvlUsd = boundedNonNegativeNumber(record.tvl, 1e13);
  return {
    fxSaveApy: apy === null ? unavailable('aladdin', FX_SAVE_SOURCE_URL, fetchedAt)
      : fresh(apy, 'aladdin', FX_SAVE_SOURCE_URL, fetchedAt),
    fxSaveTvlUsd: tvlUsd === null ? unavailable('aladdin', FX_SAVE_SOURCE_URL, fetchedAt)
      : fresh(tvlUsd, 'aladdin', FX_SAVE_SOURCE_URL, fetchedAt),
  };
}

/** Normalize raw upstream payloads to the stable per-metric browser contract. */
export function normalizeLandingMarketData({ pricePayload, priceFetchedAt, fxSavePayload, fxSaveFetchedAt, now = Date.now() }) {
  const quotes = pricePayload && typeof pricePayload === 'object' && pricePayload.code === 200
    && pricePayload.data && typeof pricePayload.data === 'object' ? pricePayload.data : null;
  const ethUsd = quotes ? parsePrice(quotes.ETH, priceFetchedAt, now) : unavailable('aladdin', PRICE_SOURCE_URL, priceFetchedAt);
  const btcUsd = quotes ? parsePrice(quotes.WBTC, priceFetchedAt, now) : unavailable('aladdin', PRICE_SOURCE_URL, priceFetchedAt);
  const vault = parseFxSave(fxSavePayload, fxSaveFetchedAt, now);
  const metrics = [vault.fxSaveTvlUsd, vault.fxSaveApy, ethUsd, btcUsd];
  const readyCount = metrics.filter((metric) => metric.status === 'fresh').length;
  const status = readyCount === metrics.length ? 'ready' : readyCount > 0 ? 'partial' : 'unavailable';
  return { status, fxSaveTvlUsd: vault.fxSaveTvlUsd, fxSaveApy: vault.fxSaveApy, ethUsd, btcUsd };
}

/** Revalidate already-normalized feed data in a browser before display. */
export function validateLandingMarketData(payload, now = Date.now()) {
  const initial = normalizeLandingMarketData({ now });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return initial;
  // Prices must be positive; APY and TVL may be a real zero.
  const sourceKeys = {
    fxSaveTvlUsd: [FX_SAVE_SOURCE_URL, VAULT_FETCH_MAX_AGE_MS, false, 1e13],
    fxSaveApy: [FX_SAVE_SOURCE_URL, VAULT_FETCH_MAX_AGE_MS, false, 1_000],
    ethUsd: [PRICE_SOURCE_URL, PRICE_SOURCE_MAX_AGE_MS, true, null],
    btcUsd: [PRICE_SOURCE_URL, PRICE_SOURCE_MAX_AGE_MS, true, null],
  };
  const normalized = {};
  for (const [key, [sourceUrl, maxAge, positive, maxValue]] of Object.entries(sourceKeys)) {
    const raw = payload[key];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.source !== 'aladdin'
      || raw.sourceUrl !== sourceUrl || raw.status !== 'fresh') {
      normalized[key] = unavailable('aladdin', sourceUrl);
      continue;
    }
    const value = positive ? positiveNumber(raw.value) : nonNegativeNumber(raw.value, maxValue);
    const fetchedAt = Number(raw.fetchedAt);
    if (value === null || !recentFetch(fetchedAt, now, maxAge)) normalized[key] = unavailable('aladdin', sourceUrl, Number.isFinite(fetchedAt) ? fetchedAt : null);
    else normalized[key] = fresh(value, 'aladdin', sourceUrl, fetchedAt);
  }
  const metrics = Object.values(normalized);
  const readyCount = metrics.filter((metric) => metric.status === 'fresh').length;
  return { status: readyCount === metrics.length ? 'ready' : readyCount > 0 ? 'partial' : 'unavailable', ...normalized };
}
