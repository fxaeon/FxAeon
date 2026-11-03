import assert from "node:assert/strict";
import test from "node:test";
import { FX_TOKENS, type FxTokenKey } from "../src/lib/fx/tokens";
import { freshDisplayPrices } from "../src/lib/displayPrices";
import {
  formatUsd,
  coinGeckoTokenPriceEndpoint,
  createUsdPriceFetcher,
  parseCoinGeckoTokenPriceResponse,
  parseUsdPriceCache,
  parseUsdPriceResponse,
  priceKeyForSymbol,
  usdValueForDecimal,
  usdValueForUnits,
  USD_PRICE_MAX_AGE_MS,
} from "../src/lib/prices";
import { CHAINLINK_USD_FEEDS, FX_PRICE_SERVICE_ENDPOINT, parseFxPriceService, protocolPricesFromReads } from "../src/lib/fxProtocolPrices";

const keys = Object.keys(FX_TOKENS) as FxTokenKey[];
// The secondary paths below run as they would with no RPC: f(x)'s on-chain read unavailable.
const withoutProtocolRead = () => createUsdPriceFetcher({ readProtocolPrices: async () => { throw new Error('No protocol read in this test'); } });
const isCoinGeckoTokenPriceRequest = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'api.coingecko.com'
      && url.pathname === '/api/v3/simple/token_price/ethereum';
  } catch {
    return false;
  }
};

function validPayload(now: number) {
  const coins: Record<string, { price: number; timestamp: number; confidence: number }> = {};
  for (const key of keys) {
    const token = key === "ETH" ? FX_TOKENS.WETH : FX_TOKENS[key];
    const id = `ethereum:${token.address.toLowerCase()}`;
    const price = key === "WBTC" ? 104_000 : key === "ETH" || key === "WETH" ? 2_400 : 1;
    coins[id] = { price, timestamp: now - 12, confidence: 0.99 };
  }
  return { coins };
}

test("accepts recent, confident prices and maps ETH to WETH", () => {
  const now = 2_000_000_000;
  const snapshot = parseUsdPriceResponse(validPayload(now), now);
  assert.equal(snapshot.prices.ETH, 2_400);
  assert.equal(snapshot.prices.WETH, 2_400);
  assert.equal(snapshot.prices.WBTC, 104_000);
  assert.equal(snapshot.prices.fxUSD, 1);
  assert.equal(snapshot.prices.FXN, 1);
  assert.equal(snapshot.updatedAt, (now - 12) * 1_000);
  assert.equal(snapshot.updatedAts.ETH, (now - 12) * 1_000);
});

test("preserves each quote timestamp when another token is older", () => {
  const now = 2_000_000_000;
  const payload = validPayload(now);
  payload.coins[`ethereum:${FX_TOKENS.WETH.address.toLowerCase()}`].timestamp = now - 10;
  payload.coins[`ethereum:${FX_TOKENS.FXN.address.toLowerCase()}`].timestamp = now - 120;
  const snapshot = parseUsdPriceResponse(payload, now);
  assert.equal(snapshot.updatedAt, (now - 120) * 1_000);
  assert.equal(snapshot.updatedAts.ETH, (now - 10) * 1_000);
  assert.equal(snapshot.updatedAts.FXN, (now - 120) * 1_000);
});

test('accepts provider quotes inside one hour and isolates an older token', () => {
  const now = 2_000_000_000;
  const payload = validPayload(now);
  payload.coins[`ethereum:${FX_TOKENS.FXN.address.toLowerCase()}`].timestamp = now - (USD_PRICE_MAX_AGE_MS / 1_000 + 1);
  const snapshot = parseUsdPriceResponse(payload, now);
  assert.equal(snapshot.prices.ETH, 2_400);
  assert.equal(snapshot.updatedAts.ETH, (now - 12) * 1_000);
  assert.equal(snapshot.prices.FXN, undefined, 'a quote older than the provider freshness window is excluded independently');
  const sevenMinutesOld = validPayload(now);
  for (const coin of Object.values(sevenMinutesOld.coins)) coin.timestamp = now - 7 * 60;
  assert.equal(parseUsdPriceResponse(sevenMinutesOld, now).prices.ETH, 2_400);
});

test('display surfaces retain seven-minute quotes and filter each token at one hour', () => {
  const now = 2_000_000_000_000;
  const sevenMinutesAgo = now - 7 * 60_000;
  assert.deepEqual(freshDisplayPrices({
    prices: { ETH: 2_400, FXN: 1 }, status: 'stale', updatedAt: sevenMinutesAgo,
    updatedAts: { ETH: sevenMinutesAgo, FXN: now - USD_PRICE_MAX_AGE_MS - 1 },
  }, now), { ETH: 2_400 });
});

test('accepts the exact one-hour display boundary and rejects one millisecond older', () => {
  const now = 2_000_000_000_000;
  const boundary = now - USD_PRICE_MAX_AGE_MS;
  const snapshot = { prices: { ETH: 2_400 }, status: 'stale' as const, updatedAt: boundary, updatedAts: { ETH: boundary } };
  assert.deepEqual(freshDisplayPrices(snapshot, now), { ETH: 2_400 });
  assert.deepEqual(freshDisplayPrices({ ...snapshot, updatedAts: { ETH: boundary - 1 } }, now), {});
  const providerNow = Math.floor(now / 1_000);
  const providerPayload = validPayload(providerNow);
  providerPayload.coins[`ethereum:${FX_TOKENS.FXN.address.toLowerCase()}`].timestamp = providerNow - USD_PRICE_MAX_AGE_MS / 1_000;
  assert.equal(parseUsdPriceResponse(providerPayload, providerNow).prices.FXN, 1);
  providerPayload.coins[`ethereum:${FX_TOKENS.FXN.address.toLowerCase()}`].timestamp -= 1;
  assert.equal(parseUsdPriceResponse(providerPayload, providerNow).prices.FXN, undefined);
});

test("rejects stale and low-confidence prices without discarding independently valid tokens", () => {
  const now = 2_000_000_000;
  const stale = validPayload(now);
  for (const coin of Object.values(stale.coins)) coin.timestamp = now - (USD_PRICE_MAX_AGE_MS / 1_000 + 1);
  assert.throws(() => parseUsdPriceResponse(stale, now), /no validated prices/);

  const lowConfidence = validPayload(now);
  for (const coin of Object.values(lowConfidence.coins)) coin.confidence = 0.49;
  assert.throws(() => parseUsdPriceResponse(lowConfidence, now), /no validated prices/);

  const incomplete = validPayload(now);
  delete incomplete.coins[`ethereum:${FX_TOKENS.WBTC.address.toLowerCase()}`];
  incomplete.coins[`ethereum:${FX_TOKENS.fxUSD.address.toLowerCase()}`].timestamp = now - (USD_PRICE_MAX_AGE_MS / 1_000 + 1);
  const partial = parseUsdPriceResponse(incomplete, now);
  assert.equal(partial.prices.ETH, 2_400);
  assert.equal(partial.prices.WBTC, undefined);
  assert.equal(partial.prices.fxUSD, undefined);
});

test("calculates display-only USD values without changing token units", () => {
  assert.equal(priceKeyForSymbol("BTC"), "WBTC");
  assert.equal(priceKeyForSymbol("fxSP"), "fxUSDBasePool");
  assert.equal(priceKeyForSymbol("$FXN"), "FXN");
  assert.equal(usdValueForDecimal("2.5", 2_400), 6_000);
  assert.equal(usdValueForUnits(2_500_000n, 6, 1), 2.5);
  assert.equal(usdValueForDecimal("all", 1), null);
  assert.equal(formatUsd(6_000), "$6,000.00");
  assert.equal(formatUsd(0.001), "<$0.01");
});

test("restores validated USD snapshots through the quote freshness window", () => {
  const now = 2_000_000_000_000;
  const prices = parseUsdPriceResponse(validPayload(Math.floor(now / 1_000)), Math.floor(now / 1_000)).prices;
  assert.deepEqual(parseUsdPriceCache({ prices, updatedAt: now - 12_000 }, now), {
    prices,
    updatedAt: now - 12_000,
  });
  assert.deepEqual(parseUsdPriceCache({ prices, updatedAt: now - 7 * 60_000 }, now), {
    prices,
    updatedAt: now - 7 * 60_000,
  });
  assert.equal(parseUsdPriceCache({ prices, updatedAt: now - USD_PRICE_MAX_AGE_MS - 1 }, now), null);
  const perToken = parseUsdPriceCache({ prices, updatedAt: now - 7 * 60_000,
    updatedAts: { ETH: now - 7 * 60_000, FXN: now - USD_PRICE_MAX_AGE_MS - 1 } }, now);
  assert.equal(perToken?.prices.ETH, prices.ETH);
  assert.equal(perToken?.prices.FXN, undefined);
  assert.equal(parseUsdPriceCache({ prices: { ...prices, fxUSD: 0 }, updatedAt: now - 12_000 }, now)?.prices.fxUSD, undefined);
  assert.equal(parseUsdPriceCache({ prices: { fxUSD: 0 }, updatedAt: now - 12_000 }, now), null);
});

test("CoinGecko fallback validates the exact contract, numeric price, and timestamp", () => {
  const now = 2_000_000_000;
  const address = FX_TOKENS.fxUSD.address.toLowerCase();
  assert.deepEqual(parseCoinGeckoTokenPriceResponse({ [address]: { usd: 0.997, last_updated_at: now - 20 } }, 'fxUSD', now), { price: 0.997, timestamp: now - 20 });
  for (const entry of [
    { usd: 1, last_updated_at: now - (USD_PRICE_MAX_AGE_MS / 1_000 + 1) },
    { usd: 1, last_updated_at: now + 121 },
    { usd: 1 }, { usd: 0, last_updated_at: now },
    { usd: Infinity, last_updated_at: now }, { usd: '1', last_updated_at: now },
  ]) assert.equal(parseCoinGeckoTokenPriceResponse({ [address]: entry }, 'fxUSD', now), null);
  assert.equal(parseCoinGeckoTokenPriceResponse({ unrelated: { usd: 1, last_updated_at: now } }, 'fxUSD', now), null);
  assert.equal(new URL(coinGeckoTokenPriceEndpoint('fxUSD')).searchParams.get('contract_addresses'), address);
  assert.equal(new URL(coinGeckoTokenPriceEndpoint('ETH')).searchParams.get('contract_addresses'), FX_TOKENS.WETH.address.toLowerCase());
});

test("a delayed protocol price uses a fresh CoinGecko quote without replacing fresh primary tokens", async () => {
  const now = Math.floor(Date.now() / 1000);
  const payload = validPayload(now);
  const address = FX_TOKENS.fxUSD.address.toLowerCase();
  payload.coins[`ethereum:${address}`].timestamp = now - (USD_PRICE_MAX_AGE_MS / 1_000 + 1);
  const calls: string[] = [];
  const request = (async (input) => {
    const url = String(input); calls.push(url);
    return Response.json(url.includes('coins.llama.fi') ? payload : { [address]: { usd: 0.998, last_updated_at: now - 3 } });
  }) as typeof fetch;
  const fetchPrices = withoutProtocolRead();
  const first = await fetchPrices(request);
  assert.equal(first.prices.fxUSD, 0.998);
  assert.equal(first.prices.ETH, 2_400);
  assert.equal(first.updatedAt, (now - 12) * 1000, 'freshness uses the oldest included price');
  const second = await fetchPrices(request);
  assert.equal(second.prices.fxUSD, 0.998);
  assert.equal(calls.filter(isCoinGeckoTokenPriceRequest).length, 1, 'fallback cached for one minute');
});

test("publishes validated primary prices before a slow optional fallback completes", async () => {
  const now = Math.floor(Date.now() / 1000);
  const payload = validPayload(now);
  const address = FX_TOKENS.fxUSD.address.toLowerCase();
  delete payload.coins[`ethereum:${address}`];
  let releaseFallback: (() => void) | undefined;
  const fallback = new Promise<void>((resolve) => { releaseFallback = resolve; });
  const request = (async input => {
    const url = String(input);
    if (url === FX_PRICE_SERVICE_ENDPOINT) return Response.json({}, { status: 503 });
    if (url.includes('coins.llama.fi')) return Response.json(payload);
    await fallback;
    return Response.json({ [address]: { usd: 0.998, last_updated_at: now - 3 } });
  }) as typeof fetch;
  const updates: Array<{ prices: Record<string, number>; updatedAt: number | null }> = [];
  const resultPromise = withoutProtocolRead()(request, undefined, (snapshot) => {
    updates.push({ prices: { ...snapshot.prices }, updatedAt: snapshot.updatedAt });
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].prices.ETH, 2_400);
  assert.equal(updates[0].prices.fxUSD, undefined);
  releaseFallback?.();
  const result = await resultPromise;
  assert.equal(result.prices.fxUSD, 0.998);
  assert.equal(result.updatedAts.fxUSD, (now - 3) * 1000);
});

test("unavailable fallback prices stay absent instead of assuming the stablecoin peg", async () => {
  const payload = validPayload(Math.floor(Date.now() / 1000));
  delete payload.coins[`ethereum:${FX_TOKENS.fxUSD.address.toLowerCase()}`];
  const request = (async input => String(input).includes('coins.llama.fi') ? Response.json(payload) : Response.json({})) as typeof fetch;
  const result = await withoutProtocolRead()(request);
  assert.equal(result.prices.ETH, 2_400);
  assert.equal(result.prices.fxUSD, undefined);
});

test("fallback traffic is bounded and respects rate-limit backoff", async () => {
  let fallbackRequests = 0;
  const request = (async input => {
    if (!isCoinGeckoTokenPriceRequest(String(input))) return Response.json({}, { status: 503 });
    fallbackRequests += 1;
    return Response.json({}, { status: 429, headers: { 'retry-after': '300' } });
  }) as typeof fetch;
  const fetchPrices = withoutProtocolRead();
  await assert.rejects(fetchPrices(request), /no validated prices/);
  await assert.rejects(fetchPrices(request), /no validated prices/);
  assert.equal(fallbackRequests, 1);

  let boundedRequests = 0;
  const failing = (async input => {
    if (isCoinGeckoTokenPriceRequest(String(input))) boundedRequests += 1;
    return Response.json({}, { status: 503 });
  }) as typeof fetch;
  await assert.rejects(withoutProtocolRead()(failing), /no validated prices/);
  assert.equal(boundedRequests, 1, 'a provider failure stops further fallback requests');
});

test('keyless fallback requests one contract at a time, deduplicates aliases, and publishes recovered quotes', async () => {
  const now = Math.floor(Date.now() / 1000);
  const addresses: string[] = [];
  const updates: Array<Record<string, number>> = [];
  const request = (async input => {
    const url = new URL(String(input));
    if (!isCoinGeckoTokenPriceRequest(url.href)) return Response.json({}, { status: 503 });
    const address = url.searchParams.get('contract_addresses')!;
    assert.equal(address.split(',').length, 1, 'the unauthenticated API rejects multi-address requests');
    addresses.push(address);
    return Response.json({ [address]: { usd: 2.5, last_updated_at: now } });
  }) as typeof fetch;
  const fetchPrices = withoutProtocolRead();
  const first = await fetchPrices(request, undefined, snapshot => updates.push({ ...snapshot.prices }));
  assert.equal(first.prices.ETH, 2.5);
  assert.equal(first.prices.WETH, 2.5);
  assert.equal(first.prices.fxUSD, 2.5);
  assert.equal(addresses.length, new Set(Object.values(FX_TOKENS).map(token => token.address.toLowerCase()).filter(address => address !== FX_TOKENS.ETH.address.toLowerCase())).size);
  assert.equal(new Set(addresses).size, addresses.length, 'shared token identities consume one request');
  assert.equal(updates[0].fxUSD, 2.5, 'the first recovered quote is available before the remaining requests');
  await fetchPrices(request);
  assert.equal(new Set(addresses).size, addresses.length, 'fresh fallback values are cached');
});

test("aborting a price refresh does not request fallback data", async () => {
  const controller = new AbortController();
  let calls = 0;
  const request = (async () => { calls += 1; controller.abort(); throw new Error('aborted'); }) as typeof fetch;
  await assert.rejects(withoutProtocolRead()(request, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});


// f(x)'s own sources lead; DefiLlama and CoinGecko are reached only for what they leave out.
const blockAt = Math.floor(Date.now() / 1000) - 8;
const ok = (result: unknown) => ({ status: 'success' as const, result });
const reads = (overrides: Partial<Record<number, ReturnType<typeof ok> | { status: 'failure' }>> = {}) => {
  const base = [
    ok(BigInt(blockAt)),
    // stETH, wstETH (inverse: wstETH per USD) and WBTC pool oracles: anchor, min, max at 18 decimals.
    ok([2_318_29n * 10n ** 16n, 2_317n * 10n ** 18n, 2_319n * 10n ** 18n]),
    ok([345_799_862_030_572n, 345_676_985_359_197n, 345_907_335_475_634n]),
    ok([79_966n * 10n ** 18n, 79_868n * 10n ** 18n, 80_049n * 10n ** 18n]),
    // Chainlink ETH, USDC, USDT: roundId, answer (8 decimals), startedAt, updatedAt, answeredInRound.
    ok([1n, 231_850_173_849n, 0n, BigInt(blockAt - 1_700), 1n]),
    ok([1n, 99_971_556n, 0n, BigInt(blockAt - 57_000), 1n]),
    ok([1n, 99_860_065n, 0n, BigInt(blockAt - 71_000), 1n]),
    // fxSAVE and fxSP NAVs at 18 decimals.
    ok(1_126_944_563_725_761_708n),
    ok(1_010_334_197_790_295_770n),
  ];
  return base.map((read, index) => overrides[index] ?? read);
};
// The NAVs as a number: their 18 decimals are more than a double holds.
const FXSAVE_NAV = Number('1.126944563725761708');
const FXSP_NAV = Number('1.01033419779029577');

test('protocol reads price every on-chain token at the read block', () => {
  const update = protocolPricesFromReads(reads(), blockAt * 1000 + 8_000);
  assert.equal(update.prices.stETH, 2_318.29);
  assert.ok(Math.abs(update.prices.wstETH! - 2_891.85) < 0.01, 'the inverse oracle gives USD per wstETH');
  assert.equal(update.prices.WBTC, 79_966);
  assert.equal(update.prices.ETH, 2_318.50173849);
  assert.equal(update.prices.WETH, update.prices.ETH, 'WETH and ETH share one quote');
  assert.equal(update.prices.USDC, 0.99971556);
  assert.equal(update.prices.USDT, 0.99860065);
  assert.equal(update.prices.fxSAVE, FXSAVE_NAV);
  assert.equal(update.prices.fxUSDBasePool, FXSP_NAV);
  for (const at of Object.values(update.updatedAts)) assert.equal(at, blockAt * 1000, 'every value is stamped with the block it was read at');
  assert.equal(update.prices.fxUSD, undefined);
  assert.equal(update.prices.FXN, undefined);
});

test('protocol reads drop stale feeds, unordered oracles, implausible NAVs and lagging blocks', () => {
  const ethHeartbeat = CHAINLINK_USD_FEEDS.find(feed => feed.key === 'ETH')!.heartbeatSeconds;
  const update = protocolPricesFromReads(reads({
    1: ok([3n * 10n ** 18n, 4n * 10n ** 18n, 5n * 10n ** 18n]),
    4: ok([1n, 231_850_173_849n, 0n, BigInt(blockAt - ethHeartbeat - 3_600), 1n]),
    7: ok(20n * 10n ** 18n),
    8: { status: 'failure' },
  }), blockAt * 1000);
  assert.equal(update.prices.stETH, undefined, 'an anchor outside its own bounds is not a price');
  assert.equal(update.prices.ETH, undefined, 'a feed past its heartbeat is stale');
  assert.equal(update.prices.WETH, undefined);
  assert.equal(update.prices.fxSAVE, undefined, 'a share NAV far from a dollar is a broken read');
  assert.equal(update.prices.fxUSDBasePool, undefined);
  assert.equal(update.prices.WBTC, 79_966, 'one bad read leaves the others');
  assert.throws(() => protocolPricesFromReads(reads(), (blockAt + 3_600) * 1000), /not recent/);
  assert.throws(() => protocolPricesFromReads([{ status: 'failure' }]), /block unavailable/);
});

test("f(x)'s price service gives FXN and fxUSD, never a pegged stablecoin", () => {
  const update = parseFxPriceService({ code: 200, data: { FXN: { usd: 20.97 }, fxUSD: { usd: 1.0001, isPegged: true }, USDC: { usd: 1 }, USDT: { usd: 1 }, ETH: { usd: 2_317 } } }, 1_000);
  assert.deepEqual(update.prices, { FXN: 20.97, fxUSD: 1.0001 });
  assert.deepEqual(update.updatedAts, { FXN: 1_000, fxUSD: 1_000 });
  assert.throws(() => parseFxPriceService({ code: 500, data: {} }), /no data/);
  assert.throws(() => parseFxPriceService({ code: 200, data: { fxUSD: { usd: 3 } } }), /no validated prices/);
});

test("f(x)'s sources cover every token without DefiLlama or CoinGecko", async () => {
  const calls: string[] = [];
  const request = (async input => {
    calls.push(String(input));
    return Response.json(String(input) === FX_PRICE_SERVICE_ENDPOINT ? { code: 200, data: { FXN: { usd: 20.97 }, fxUSD: { usd: 1.0001 } } } : {}, { status: String(input) === FX_PRICE_SERVICE_ENDPOINT ? 200 : 503 });
  }) as typeof fetch;
  const fetchPrices = createUsdPriceFetcher({ readProtocolPrices: async () => protocolPricesFromReads(reads(), blockAt * 1000) });
  const updates: Array<Record<string, number>> = [];
  const result = await fetchPrices(request, undefined, snapshot => updates.push({ ...snapshot.prices }));
  for (const key of keys) assert.ok(result.prices[key]! > 0, `${key} is priced`);
  assert.equal(result.prices.fxSAVE, FXSAVE_NAV);
  assert.equal(result.prices.fxUSD, 1.0001);
  assert.deepEqual(calls, [FX_PRICE_SERVICE_ENDPOINT], 'no secondary provider is asked');
  assert.equal(updates.length, 2, 'each source publishes as soon as it lands');
});

test('DefiLlama fills only what f(x) leaves out and never replaces its quotes', async () => {
  const now = Math.floor(Date.now() / 1000);
  const request = (async input => {
    const url = String(input);
    if (url === FX_PRICE_SERVICE_ENDPOINT) return Response.json({}, { status: 503 });
    if (url.includes('coins.llama.fi')) return Response.json(validPayload(now));
    return Response.json({}, { status: 503 });
  }) as typeof fetch;
  const fetchPrices = createUsdPriceFetcher({ readProtocolPrices: async () => protocolPricesFromReads(reads(), blockAt * 1000) });
  const result = await fetchPrices(request);
  assert.equal(result.prices.ETH, 2_318.50173849, 'the on-chain quote stays');
  assert.equal(result.prices.fxSAVE, FXSAVE_NAV);
  assert.equal(result.prices.FXN, 1, 'a token f(x) did not price comes from DefiLlama');
  assert.equal(result.updatedAts.FXN, (now - 12) * 1000);
});
