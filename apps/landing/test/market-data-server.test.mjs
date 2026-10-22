import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CACHE_TTL_MS,
  FX_SAVE_APY_ENDPOINT,
  MAX_RESPONSE_BYTES,
  PRICE_ENDPOINT,
  createLandingMarketDataHandler,
} from '../market-data-server.mjs';

const ETH = 'ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const BTC = 'ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const FX_SAVE = '0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39';
const now = 1_800_000_000_000;

function upstreamPayloads(timestamp = Math.floor((now - 20_000) / 1000)) {
  return {
    prices: { coins: {
      [ETH]: { price: 2_400, timestamp, confidence: 0.99 },
      [BTC]: { price: 80_000, timestamp, confidence: 0.99 },
    } },
    fxSave: { code: 200, data: { fxSave: { address: FX_SAVE, apy: '6.38', tvl: '85284837.6280' } } },
  };
}

function upstreamResponse(payload, options = {}) {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json', ...options.headers } });
}

test('GET endpoint is fixed-source, rejects methods and query parameters before fetching', async () => {
  let calls = 0;
  const handler = createLandingMarketDataHandler({ fetchImpl: async () => { calls += 1; throw new Error('unexpected'); }, now: () => now });
  const post = await handler({ request: new Request('https://landing.test/api/market-data', { method: 'POST' }) });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  const query = await handler({ request: new Request('https://landing.test/api/market-data?url=https://attacker.test') });
  assert.equal(query.status, 400);
  assert.equal(calls, 0);
});

test('fetches verified sources in parallel and keeps only fixed upstream URLs', async () => {
  const payloads = upstreamPayloads();
  const requests = [];
  const handler = createLandingMarketDataHandler({
    now: () => now,
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (url === PRICE_ENDPOINT) return upstreamResponse(payloads.prices);
      if (url === FX_SAVE_APY_ENDPOINT) return upstreamResponse(payloads.fxSave);
      throw new Error('unexpected upstream');
    },
  });
  const response = await handler({ request: new Request('https://landing.test/api/market-data') });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ready');
  assert.equal(body.ethUsd.value, 2_400);
  assert.equal(body.btcUsd.value, 80_000);
  assert.equal(body.fxSaveApy.value, 6.38);
  assert.equal(body.fxSaveTvlUsd.value, 85_284_837.628);
  assert.deepEqual(new Set(requests), new Set([PRICE_ENDPOINT, FX_SAVE_APY_ENDPOINT]));
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('partial upstream failure leaves the healthy source available', async () => {
  const payloads = upstreamPayloads();
  const handler = createLandingMarketDataHandler({
    now: () => now,
    fetchImpl: async (url) => {
      if (url === PRICE_ENDPOINT) return upstreamResponse(payloads.prices);
      throw new Error('secret or response text must not be logged');
    },
  });
  const response = await handler({ request: new Request('https://landing.test/api/market-data') });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'partial');
  assert.equal(body.ethUsd.status, 'fresh');
  assert.equal(body.fxSaveApy.status, 'unavailable');
  assert.equal(body.fxSaveTvlUsd.value, null);
  assert.equal(response.headers.get('x-fxaeon-market-prices'), 'ok');
  assert.equal(response.headers.get('x-fxaeon-market-fxsave'), 'fetch-error');
});

test('uses Worker global fetch with its receiver and exposes only fixed diagnostic categories', async () => {
  const payloads = upstreamPayloads();
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async function (url) {
    assert.equal(this, globalThis, 'runtime fetch receiver is preserved');
    if (url === PRICE_ENDPOINT) return upstreamResponse(payloads.prices);
    if (url === FX_SAVE_APY_ENDPOINT) return new Response(null, { status: 503 });
    throw new Error('unexpected upstream');
  };
  try {
    const handler = createLandingMarketDataHandler({ now: () => now });
    const response = await handler({ request: new Request('https://landing.test/api/market-data') });
    assert.equal(response.headers.get('x-fxaeon-market-prices'), 'ok');
    assert.equal(response.headers.get('x-fxaeon-market-fxsave'), 'http-503');
    const body = await response.json();
    assert.equal(body.status, 'partial');
    assert.equal(JSON.stringify(body).includes('503'), false, 'diagnostics stay out of response data');
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('does not follow upstream redirects and reports only their status category', async () => {
  let calls = 0;
  const handler = createLandingMarketDataHandler({
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: 'https://untrusted.test/' } });
    },
  });
  const response = await handler({ request: new Request('https://landing.test/api/market-data') });
  const body = await response.json();
  assert.equal(calls, 2, 'only each configured source is requested');
  assert.equal(response.headers.get('x-fxaeon-market-prices'), 'http-302');
  assert.equal(response.headers.get('x-fxaeon-market-fxsave'), 'http-302');
  assert.equal(body.status, 'unavailable');
  assert.equal(JSON.stringify(body).includes('untrusted.test'), false);
});

test('caches source reads for at most the configured interval and revalidates timestamps', async () => {
  const payloads = upstreamPayloads();
  let clock = now;
  let calls = 0;
  const handler = createLandingMarketDataHandler({
    now: () => clock,
    fetchImpl: async (url) => {
      calls += 1;
      return upstreamResponse(url === PRICE_ENDPOINT ? payloads.prices : payloads.fxSave);
    },
  });
  const request = () => handler({ request: new Request('https://landing.test/api/market-data') });
  const initial = await (await request()).json();
  assert.equal(initial.ethUsd.status, 'fresh');
  await request();
  assert.equal(calls, 2, 'second request is served from isolate cache');
  assert.equal(CACHE_TTL_MS, 60_000);

  clock += CACHE_TTL_MS + 1;
  const afterCache = await (await request()).json();
  assert.equal(calls, 4, 'expired cache refreshes both fixed sources');
  assert.equal(afterCache.ethUsd.status, 'fresh');

  clock += 5 * 60_000;
  const staleSource = await (await request()).json();
  assert.equal(calls, 6);
  assert.equal(staleSource.ethUsd.status, 'unavailable', 'old upstream timestamps are rejected after refresh');
});

test('a stalled earlier request cannot hold up a later visitor or replace its fresh cache', async () => {
  const payloads = upstreamPayloads();
  let calls = 0;
  const handler = createLandingMarketDataHandler({
    now: () => now,
    timeoutMs: 40,
    fetchImpl: async (url) => {
      calls += 1;
      // Model request-owned I/O that stops progressing after a caller leaves.
      if (calls <= 2) return new Promise(() => {});
      return upstreamResponse(url === PRICE_ENDPOINT ? payloads.prices : payloads.fxSave);
    },
  });
  const request = () => handler({ request: new Request('https://landing.test/api/market-data') });
  const abandoned = request();
  const nextVisitor = await (await request()).json();
  assert.equal(nextVisitor.status, 'ready', 'the new request owns its source reads');
  assert.equal(calls, 4);
  assert.equal((await (await abandoned).json()).status, 'unavailable');
  const cached = await (await request()).json();
  assert.equal(cached.status, 'ready', 'an older failed read cannot overwrite newer data');
  assert.equal(calls, 4, 'completed data is still cached across requests');
});

test('a later failed request does not discard an earlier completed healthy read', async () => {
  const payloads = upstreamPayloads();
  let calls = 0;
  let releaseEarlier;
  const earlierReady = new Promise((resolve) => { releaseEarlier = resolve; });
  const handler = createLandingMarketDataHandler({
    now: () => now,
    fetchImpl: async (url) => {
      calls += 1;
      if (calls > 2) return new Response(null, { status: 503 });
      await earlierReady;
      return upstreamResponse(url === PRICE_ENDPOINT ? payloads.prices : payloads.fxSave);
    },
  });
  const request = () => handler({ request: new Request('https://landing.test/api/market-data') });
  const earlier = request();
  assert.equal((await (await request()).json()).status, 'unavailable');
  releaseEarlier();
  assert.equal((await (await earlier).json()).status, 'ready');
  assert.equal((await (await request()).json()).status, 'ready');
  assert.equal(calls, 4, 'the healthy completed read serves the next visitor');
});

test('an earlier healthy read cannot replace a newer completed healthy snapshot', async () => {
  const earlierPayloads = upstreamPayloads();
  const newerPayloads = upstreamPayloads();
  newerPayloads.fxSave.data.fxSave.apy = '6.50';
  let calls = 0;
  let releaseEarlier;
  const earlierReady = new Promise((resolve) => { releaseEarlier = resolve; });
  const handler = createLandingMarketDataHandler({
    now: () => now,
    fetchImpl: async (url) => {
      const earlier = ++calls <= 2;
      if (earlier) await earlierReady;
      const payloads = earlier ? earlierPayloads : newerPayloads;
      return upstreamResponse(url === PRICE_ENDPOINT ? payloads.prices : payloads.fxSave);
    },
  });
  const request = () => handler({ request: new Request('https://landing.test/api/market-data') });
  const earlier = request();
  assert.equal((await (await request()).json()).fxSaveApy.value, 6.50);
  releaseEarlier();
  assert.equal((await (await earlier).json()).fxSaveApy.value, 6.38);
  assert.equal((await (await request()).json()).fxSaveApy.value, 6.50);
  assert.equal(calls, 4);
});

test('rejects an oversized Content-Length before reading the body and caps chunked reads', async () => {
  let lengthCanceled = 0;
  const overLength = () => new Response(new ReadableStream({ cancel() { lengthCanceled += 1; } }), {
    headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) },
  });
  const lengthHandler = createLandingMarketDataHandler({
    now: () => now,
    fetchImpl: async () => overLength(),
  });
  const lengthBody = await (await lengthHandler({ request: new Request('https://landing.test/api/market-data') })).json();
  assert.equal(lengthBody.status, 'unavailable');
  assert.equal(lengthCanceled, 2);

  let chunkCanceled = 0;
  const chunkHandler = createLandingMarketDataHandler({
    now: () => now,
    maxResponseBytes: 100,
    fetchImpl: async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(101)); },
      cancel() { chunkCanceled += 1; },
    })),
  });
  const chunkBody = await (await chunkHandler({ request: new Request('https://landing.test/api/market-data') })).json();
  assert.equal(chunkBody.status, 'unavailable');
  assert.equal(chunkCanceled, 2);
});

test('deadline covers stalled response bodies and cancels the stream', async () => {
  let cancelled = 0;
  const handler = createLandingMarketDataHandler({
    now: () => now,
    timeoutMs: 20,
    fetchImpl: async () => new Response(new ReadableStream({
      cancel() { cancelled += 1; },
    })),
  });
  const started = Date.now();
  const response = await handler({ request: new Request('https://landing.test/api/market-data') });
  const body = await response.json();
  assert.ok(Date.now() - started < 1_000, 'body deadline returns promptly');
  assert.equal(response.status, 200);
  assert.equal(body.status, 'unavailable');
  assert.equal(cancelled, 2);
});
