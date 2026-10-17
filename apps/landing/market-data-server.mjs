import {
  FX_SAVE_APY_ENDPOINT,
  PRICE_ENDPOINT,
  normalizeLandingMarketData,
} from './market-data.mjs';

export { FX_SAVE_APY_ENDPOINT, PRICE_ENDPOINT };

export const REQUEST_TIMEOUT_MS = 8_000;
export const MAX_RESPONSE_BYTES = 256 * 1024;
export const CACHE_TTL_MS = 60_000;

function timeoutError() {
  return new DOMException('Upstream request timed out', 'TimeoutError');
}

async function boundedJson(url, { fetchImpl, now, timeoutMs, maxResponseBytes }) {
  const controller = new AbortController();
  let reader;
  let timer;
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  timer = setTimeout(() => {
    const error = timeoutError();
    controller.abort(error);
    void reader?.cancel(error).catch(() => undefined);
    rejectDeadline(error);
  }, timeoutMs);

  const work = (async () => {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('upstream unavailable');
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('upstream response too large');
    }

    if (!response.body) throw new Error('upstream response has no body');
    reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('upstream response too large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { payload: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), fetchedAt: now() };
  })();

  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    reader = undefined;
  }
}

function failureCategory(error) {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error && error.message === 'upstream response too large') return 'oversized';
  return 'unavailable';
}

function fixedFailureLog(source, error) {
  console.warn(`[landing-market-data] ${source}_${failureCategory(error)}`);
}

function response(body, status = 200, cacheControl = 'public, max-age=0, s-maxage=30, stale-while-revalidate=30') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
    },
  });
}

function unavailableSnapshot(now) {
  return normalizeLandingMarketData({ now });
}

/**
 * Create a closed, fixed-source, read-only handler. Dependencies are injectable
 * only for deterministic contract tests; requests cannot choose upstream URLs.
 */
export function createLandingMarketDataHandler({
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  cacheTtlMs = CACHE_TTL_MS,
} = {}) {
  let cacheEntry;
  let inFlight;

  const fetchSource = async (url, source) => {
    try {
      return await boundedJson(url, { fetchImpl, now, timeoutMs, maxResponseBytes });
    } catch (error) {
      fixedFailureLog(source, error);
      return { payload: null, fetchedAt: null };
    }
  };

  const fetchSnapshot = async () => {
    const [prices, fxSave] = await Promise.all([
      fetchSource(PRICE_ENDPOINT, 'prices'),
      fetchSource(FX_SAVE_APY_ENDPOINT, 'fxsave'),
    ]);
    return { prices, fxSave };
  };

  const readSnapshot = async (timestamp) => {
    if (cacheEntry && cacheEntry.expiresAt > timestamp) return cacheEntry.raw;
    if (inFlight) return inFlight;
    const request = fetchSnapshot();
    inFlight = request;
    try {
      const raw = await request;
      cacheEntry = { raw, expiresAt: now() + cacheTtlMs };
      return raw;
    } finally {
      if (inFlight === request) inFlight = undefined;
    }
  };

  const get = async (request) => {
    if (new URL(request.url).search !== '') {
      return response({ error: 'unsupported query' }, 400, 'no-store');
    }
    try {
      const raw = await readSnapshot(now());
      return response(normalizeLandingMarketData({
        pricePayload: raw.prices.payload,
        priceFetchedAt: raw.prices.fetchedAt ?? undefined,
        fxSavePayload: raw.fxSave.payload,
        fxSaveFetchedAt: raw.fxSave.fetchedAt ?? undefined,
        now: now(),
      }));
    } catch {
      return response(unavailableSnapshot(now()));
    }
  };

  return async ({ request }) => {
    if (request.method !== 'GET') {
      return new Response(null, {
        status: 405,
        headers: { allow: 'GET', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      });
    }
    try {
      return await get(request);
    } catch {
      return response(unavailableSnapshot(now()));
    }
  };
}

export const handleMarketDataRequest = createLandingMarketDataHandler();
export const onRequest = handleMarketDataRequest;
