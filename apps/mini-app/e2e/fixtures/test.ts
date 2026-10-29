/**
 * Minimal browser fixture for the client-first Mini App.
 *
 * The app has no FxAeon HTTP API. Telegram is the only host integration we
 * shim here; RPC/Privy are deliberately left unconfigured in the test build.
 * The external USD feed is unavailable by default so screens must report an
 * honest unavailable state instead of fabricating balances or confirmations.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { telegramInitScript, type TelegramShimOptions } from "./telegram";
import { browserWalletInitScript, type BrowserWalletShimOptions } from "./wallet";

export interface ObservedRequests {
  all: string[];
  backend: string[];
}

async function installTelegram(page: Page, telegram: boolean | TelegramShimOptions): Promise<void> {
  await page.route("**/telegram-web-app.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: "/* deterministic test shim */",
    }),
  );
  if (telegram !== false) {
    const options = telegram === true ? {} : telegram;
    await page.addInitScript(telegramInitScript(options), options);
  }
}

export async function installMarketPrices(page: Page, enabled: boolean): Promise<void> {
  // Historical yields are tested with explicit daily samples in their own suite.
  await page.route('https://yields.llama.fi/**', route => route.abort('blockedbyclient'));
  await page.route('https://api.llama.fi/chart/**', route => route.abort('blockedbyclient'));
  if (enabled) {
    // Keep price-context E2E assertions deterministic. The production app
    // still owns the Coinbase socket; this fixture only prevents a live
    // internet tick from replacing the mocked HTTP anchor halfway through a
    // longer chart interaction.
    await page.addInitScript(() => {
      const CoinbaseSocketUrl = "wss://ws-feed.exchange.coinbase.com";
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          if (String(url) === CoinbaseSocketUrl) {
            const fake = {
              url: String(url),
              protocol: "",
              readyState: 0,
              bufferedAmount: 0,
              extensions: "",
              binaryType: "blob" as BinaryType,
              onopen: null as (() => void) | null,
              onmessage: null as ((event: MessageEvent) => void) | null,
              onerror: null as ((event: Event) => void) | null,
              onclose: null as ((event: CloseEvent) => void) | null,
              send: () => undefined,
              close: () => undefined,
              addEventListener: () => undefined,
              removeEventListener: () => undefined,
              dispatchEvent: () => false,
            };
            queueMicrotask(() => {
              fake.readyState = 1;
              fake.onopen?.();
            });
            return fake as unknown as WebSocket;
          }
          super(url, protocols);
        }
      };
    });
  }
  await page.route("https://coins.llama.fi/**", async (route) => {
    if (!enabled) return route.abort("blockedbyclient");
    const encodedIds = new URL(route.request().url()).pathname.split("/prices/current/")[1] ?? "";
    const ids = decodeURIComponent(encodedIds).split(",").filter(Boolean);
    const timestamp = Math.floor(Date.now() / 1000);
    const coins = Object.fromEntries(ids.map((id) => {
      const normalised = id.toLowerCase();
      const price = normalised.includes("2260fac5e5542a773aa44fbcfedf7c193bc2c599")
        ? 104_000
        : normalised.includes("c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")
          ? 2_400
          : normalised.includes("ae7ab96520de3a18e5e111b5eaab095312d7fe84")
            ? 2_400
          : normalised.includes("7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0")
              ? 2_850
              : normalised.includes("365accfca291e7d3914637abf1f7635db165bb09")
                ? 26
              : 1;
      return [id, { price, timestamp, confidence: 0.99 }];
    }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ coins }) });
  });

  // f(x)'s price service supplies FXN and fxUSD; the same fixed quotes as the DefiLlama mock above.
  await page.route("https://api.aladdin.club/api/coingecko/price", async (route) => {
    if (!enabled) return route.abort("blockedbyclient");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 200, data: { FXN: { usd: 26 }, fxUSD: { usd: 1 } } }) });
  });

  await page.route("https://api.coingecko.com/**", async (route) => {
    if (!enabled) return route.abort("blockedbyclient");
    const url = new URL(route.request().url());
    const marketId = url.pathname.match(/\/coins\/([^/]+)\/market_chart$/)?.[1];
    if (marketId !== "ethereum" && marketId !== "bitcoin") return route.abort("blockedbyclient");
    const days = Math.max(1, Math.min(30, Number(url.searchParams.get("days")) || 1));
    const count = 120;
    const end = Date.now();
    const start = end - days * 24 * 60 * 60 * 1_000;
    const basePrice = marketId === "bitcoin" ? 104_000 : 2_400;
    const prices = Array.from({ length: count }, (_, index) => {
      const progress = index / (count - 1);
      const timestamp = Math.round(start + progress * (end - start));
      const trend = 0.975 + progress * 0.025;
      const wave = Math.sin(index / 7) * 0.003;
      return [timestamp, Number((basePrice * (trend + wave)).toFixed(6))];
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prices }) });
  });

  await page.route("https://api.exchange.coinbase.com/products/*/candles**", async (route) => {
    if (!enabled) return route.abort("blockedbyclient");
    const url = new URL(route.request().url());
    const market = url.pathname.includes("BTC-USD") ? "BTC" : url.pathname.includes("ETH-USD") ? "ETH" : null;
    if (!market) return route.abort("blockedbyclient");
    const end = Math.floor(Date.now() / 1000);
    const granularity = Math.max(60, Number(url.searchParams.get("granularity")) || 300);
    const basePrice = market === "BTC" ? 104_000 : 2_400;
    const candles = Array.from({ length: 48 }, (_, index) => {
      const time = end - (47 - index) * granularity;
      const close = basePrice * (0.985 + (index / 47) * 0.015);
      const open = close * 0.999;
      return [time, close * 0.997, close * 1.003, open, close, 10_000];
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(candles) });
  });
}

/** Enriched, deterministic quote used by the gas-tier settings E2E. */
export async function installGasTierFixture(page: Page): Promise<void> {
  // Replace the legacy-only default installed by the general browser fixture.
  await page.unroute('**/api/gas');
  await page.route('**/api/gas', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      source: 'etherscan', chainId: 1, gasPriceWei: '25000000000',
      baseFeePerGasWei: '20000000000',
      tiers: { standard: '25000000000', fast: '30000000000', rapid: '40000000000' },
      blockNumber: '21000000', fetchedAt: Date.now(), stale: false,
    }),
  }));
}

/** Install the same deterministic browser-only fixtures for standalone visual captures. */
export async function installBrowserAppFixtures(page: Page, options: {
  telegram?: boolean | TelegramShimOptions;
  browserWallet?: false | BrowserWalletShimOptions;
  marketPrices?: boolean;
} = {}): Promise<void> {
  const telegram = options.telegram ?? false;
  const browserWallet = options.browserWallet ?? false;
  const marketPrices = options.marketPrices ?? true;
  await installTelegram(page, telegram);
  await installMarketPrices(page, marketPrices);
  await page.route('https://api.goldsky.com/api/public/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: { positions: [], orders: [] } }),
  }));
  // The deployed app's optional read-only gas fallback is a public endpoint;
  // keep its schema deterministic while all other same-origin API requests
  // remain blocked by the client-first request assertion below.
  await page.route('**/api/gas', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ source: 'etherscan', chainId: 1, gasPriceWei: '25000000000', blockNumber: '21000000', fetchedAt: Date.now(), stale: false }),
  }));
  if (browserWallet !== false) await page.addInitScript(browserWalletInitScript(browserWallet), browserWallet);
}

export const test = base.extend<{
  telegram: boolean | TelegramShimOptions;
  browserWallet: false | BrowserWalletShimOptions;
  marketPrices: boolean;
  requests: ObservedRequests;
}>({
  telegram: [true, { option: true }],
  browserWallet: [false, { option: true }],
  marketPrices: [false, { option: true }],
  requests: async ({ page }, use) => {
    const observed: ObservedRequests = { all: [], backend: [] };
    page.on("request", (request) => {
      const url = request.url();
      observed.all.push(url);
      try {
        const pathname = new URL(url).pathname;
        // The maintained token-assets CDN exposes image files under `/api`.
        // That is an asset host, not an FxAeon application backend; keep the
        // client-first assertion focused on same-origin/unknown API routes.
        const host = new URL(url).hostname;
        const publicDataHosts = new Set(["assets.smold.app", "api.coingecko.com", "api.g.alchemy.com", "api.exchange.coinbase.com", "api.goldsky.com", "api.aladdin.club"]);
        const explicitPublicGasRead = pathname === "/api/gas"
          && new URL(url).origin === new URL(page.url()).origin
          && request.method() === "GET";
        if (/\/api(?:\/|$)/i.test(pathname) && !publicDataHosts.has(host) && !explicitPublicGasRead) observed.backend.push(url);
      } catch {
        // Ignore malformed URLs; Playwright normally supplies absolute URLs.
      }
    });
    await use(observed);
  },
  page: async ({ page, telegram, browserWallet, marketPrices }, use) => {
    await installBrowserAppFixtures(page, { telegram, browserWallet, marketPrices });
    await use(page);
  },
});

export { expect };

export function assertNoBackendRequests(requests: ObservedRequests): void {
  expect(requests.backend, "client-first app must not call an FxAeon backend").toEqual([]);
}
