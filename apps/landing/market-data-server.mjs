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
      // Workerd's fetch implementation rejects `redirect: 'error'` in some
      // Pages runtimes. `manual` keeps redirects from being followed, so the
      // existing non-2xx check safely rejects 3xx responses without allowing
      // a fixed upstream to redirect the request elsewhere.
      redirect: 'manual',
      signal: controller.signal,
    });
    if (!response.ok) throw Object.assign(new Error('upstream unavailable'), {
      diagnostic: `http-${response.status}`,
    });
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw Object.assign(new Error('upstream response too large'), { diagnostic: 'oversize' });
    }

    if (!response.body) throw Object.assign(new Error('upstream response has no body'), { diagnostic: 'parse-error' });
    reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw Object.assign(new Error('upstream response too large'), { diagnostic: 'oversize' });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return { payload: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), fetchedAt: now() };
    } catch {
      throw Object.assign(new Error('invalid upstream JSON'), { diagnostic: 'parse-error' });
    }
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
  if (error && typeof error === 'object' && typeof error.diagnostic === 'string') return error.diagnostic;
  return 'fetch-error';
}

function fixedFailureLog(source, error) {
  console.warn(`[landing-market-data] ${source}_${failureCategory(error)}`);
}

function response(body, status = 200, cacheControl = 'public, max-age=0, s-maxage=30, stale-while-revalidate=30', diagnostics) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
      ...(diagnostics ? {
        'x-fxaeon-market-prices': diagnostics.prices,
        'x-fxaeon-market-fxsave': diagnostics.fxsave,
      } : {}),
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
  // Keep the Worker runtime's fetch receiver intact. Some Workers runtimes
  // reject a captured global fetch called as an unbound function.
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  cacheTtlMs = CACHE_TTL_MS,
} = {}) {
  let cacheEntry;
  let inFlight;

  const fetchSource = async (url, source) => {
    try {
      return { ...await boundedJson(url, { fetchImpl, now, timeoutMs, maxResponseBytes }), diagnostic: 'ok' };
    } catch (error) {
      const diagnostic = failureCategory(error);
      fixedFailureLog(source, error);
      return { payload: null, fetchedAt: null, diagnostic };
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
      }), 200, undefined, { prices: raw.prices.diagnostic, fxsave: raw.fxSave.diagnostic });
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
