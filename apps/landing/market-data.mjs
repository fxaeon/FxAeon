/**
 * Validation and projection for the landing page's public market snapshot.
 *
 * This feed is display-only. Prices are accepted from DefiLlama only when
 * their source timestamps and confidence are recent enough; fxSAVE data is
 * accepted only for the verified vault address in Aladdin's official feed.
 */

export const FX_SAVE_APY_ENDPOINT = 'https://api.aladdin.club/api1/concentrator_aToken_tvl_apy';
export const FX_SAVE_TOKEN_ADDRESS = '0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39';
export const PRICE_ENDPOINT = 'https://coins.llama.fi/prices/current/ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2,ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
export const PRICE_SOURCE_URL = 'https://defillama.com/prices';
export const FX_SAVE_SOURCE_URL = 'https://fx.aladdin.club/earn';
export const PRICE_SOURCE_MAX_AGE_MS = 5 * 60_000;
export const VAULT_FETCH_MAX_AGE_MS = 5 * 60_000;

const ETH_KEY = 'ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const BTC_KEY = 'ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const MAX_FUTURE_SKEW_MS = 120_000;

function unavailable(source, sourceUrl, fetchedAt = null, sourceAt = null) {
  return { value: null, status: 'unavailable', fetchedAt, ...(sourceAt === null ? {} : { sourceAt }), source, sourceUrl };
}

function fresh(value, source, sourceUrl, fetchedAt, sourceAt = null) {
  return { value, status: 'fresh', fetchedAt, ...(sourceAt === null ? {} : { sourceAt }), source, sourceUrl };
}

function usableTimestamp(timestamp, now) {
  return Number.isFinite(timestamp) && timestamp > 0
    && timestamp <= now + MAX_FUTURE_SKEW_MS
    && now - timestamp <= PRICE_SOURCE_MAX_AGE_MS;
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

function parsePrice(coin, source, fetchedAt, now) {
  if (!coin || typeof coin !== 'object' || Array.isArray(coin)) return unavailable(source, PRICE_SOURCE_URL, fetchedAt);
  const value = positiveNumber(coin.price);
  const sourceAtSeconds = Number(coin.timestamp);
  const confidence = Number(coin.confidence);
  const sourceAt = sourceAtSeconds * 1000;
  if (value === null || !usableTimestamp(sourceAt, now)
    || !Number.isFinite(confidence) || confidence < 0.5 || confidence > 1) {
    return unavailable(source, PRICE_SOURCE_URL, fetchedAt,
      Number.isFinite(sourceAt) && sourceAt > 0 ? sourceAt : null);
  }
  return fresh(value, source, PRICE_SOURCE_URL, fetchedAt, sourceAt);
}

function parseFxSave(payload, fetchedAt, now) {
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0 || fetchedAt > now + MAX_FUTURE_SKEW_MS
    || now - fetchedAt > VAULT_FETCH_MAX_AGE_MS) {
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
  const coins = pricePayload && typeof pricePayload === 'object' && pricePayload.coins
    && typeof pricePayload.coins === 'object' ? pricePayload.coins : null;
  const ethUsd = coins
    ? parsePrice(coins[ETH_KEY], 'defillama', priceFetchedAt, now)
    : unavailable('defillama', PRICE_SOURCE_URL, priceFetchedAt);
  const btcUsd = coins
    ? parsePrice(coins[BTC_KEY], 'defillama', priceFetchedAt, now)
    : unavailable('defillama', PRICE_SOURCE_URL, priceFetchedAt);
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
  const sourceKeys = {
    fxSaveTvlUsd: ['aladdin', FX_SAVE_SOURCE_URL, VAULT_FETCH_MAX_AGE_MS, false, 1e13],
    fxSaveApy: ['aladdin', FX_SAVE_SOURCE_URL, VAULT_FETCH_MAX_AGE_MS, false, 1_000],
    ethUsd: ['defillama', PRICE_SOURCE_URL, PRICE_SOURCE_MAX_AGE_MS, true, null],
    btcUsd: ['defillama', PRICE_SOURCE_URL, PRICE_SOURCE_MAX_AGE_MS, true, null],
  };
  const normalized = {};
  for (const [key, [expectedSource, sourceUrl, maxAge, requiresSourceAt, maxValue]] of Object.entries(sourceKeys)) {
    const raw = payload[key];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.source !== expectedSource
      || raw.sourceUrl !== sourceUrl || raw.status !== 'fresh') {
      normalized[key] = unavailable(expectedSource, sourceUrl);
      continue;
    }
    const value = requiresSourceAt ? positiveNumber(raw.value) : nonNegativeNumber(raw.value, maxValue);
    const fetchedAt = Number(raw.fetchedAt);
    const sourceAt = requiresSourceAt ? Number(raw.sourceAt) : null;
    const validFreshness = Number.isFinite(fetchedAt) && fetchedAt > 0 && fetchedAt <= now + MAX_FUTURE_SKEW_MS
      && now - fetchedAt <= maxAge
      && (!requiresSourceAt || usableTimestamp(sourceAt, now));
    if (value === null || !validFreshness) normalized[key] = unavailable(expectedSource, sourceUrl,
      Number.isFinite(fetchedAt) ? fetchedAt : null, Number.isFinite(sourceAt) && sourceAt > 0 ? sourceAt : null);
    else normalized[key] = fresh(value, expectedSource, sourceUrl, fetchedAt, sourceAt);
  }
  const metrics = Object.values(normalized);
  const readyCount = metrics.filter((metric) => metric.status === 'fresh').length;
  return { status: readyCount === metrics.length ? 'ready' : readyCount > 0 ? 'partial' : 'unavailable', ...normalized };
}
