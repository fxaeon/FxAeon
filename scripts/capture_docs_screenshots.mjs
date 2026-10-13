import playwright from '../apps/mini-app/node_modules/@playwright/test/index.js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { configuredBrowserChannel } = require('./e2e_browser_channel.cjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.FX_SCREENSHOT_OUTPUT_DIR || path.join(root, 'docs', 'assets'));
const baseUrl = validateBaseUrl(process.env.FX_SCREENSHOT_BASE_URL ?? 'http://localhost:4321');
const captureProfile = process.env.FX_SCREENSHOT_CAPTURE_PROFILE?.trim() || 'standard';
const marketDataMode = process.env.FX_SCREENSHOT_MARKET_DATA?.trim() || 'live';
if (!['standard', 'positions', 'audit'].includes(captureProfile)) throw new Error('FX_SCREENSHOT_CAPTURE_PROFILE must be standard, positions, or audit');
if (!['live', 'fixture'].includes(marketDataMode)) throw new Error('FX_SCREENSHOT_MARKET_DATA must be live or fixture');
const captures = [];
const discoveryErrors = [];
const interceptedGroups = new Set();
const interceptedHistoryGroups = new Set();
const pageErrors = [];
const consoleErrors = [];
const externalRequestFailures = [];
const pageIds = new WeakMap();
let nextPageId = 0;
const graphPrefix = '/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/';
const expectedPools = {
  'ETH:long': ['0x6ecfa38fee8a5277b91efda204c235814f0122e8', 'fx-v2-wsteth/3.0.0'],
  'ETH:short': ['0x25707b9e6690b52c60ae6744d711cf9c1dfc1876', 'fx-v2-wsteth-short/v0.1.0'],
  'BTC:long': ['0xab709e26fa6b0a30c119d8c55b887ded24952473', 'fx-v2-wbtc/3.0.0'],
  'BTC:short': ['0xa0cc8162c523998856d59065faa254f87d20a5b0', 'fx-v2-wbtc-short/v2.0.0'],
};
const positionManifest = loadPositionManifest(process.env.FX_SCREENSHOT_POSITION_MANIFEST);
if (captureProfile === 'positions' && !positionManifest) throw new Error('the positions capture profile requires FX_SCREENSHOT_POSITION_MANIFEST');

function validateBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !url.port || Number(url.port) < 1024) throw new Error('capture base URL must be a credential-free localhost HTTP origin with an unprivileged port');
  return url.origin;
}

function loadPositionManifest(configuredPath) {
  if (!configuredPath) return undefined;
  const manifest = JSON.parse(readFileSync(path.resolve(configuredPath), 'utf8'));
  if (
    manifest?.proof !== 'fxaeon-position-screenshot-fixture'
    || manifest?.schemaVersion !== 1
    || manifest?.chainId !== 1
    || !Number.isSafeInteger(manifest?.forkBlock) || manifest.forkBlock <= 0
    || (manifest.executionSurface !== undefined && !['browser', 'node-runner'].includes(manifest.executionSurface))
    || !/^0x[0-9a-f]{40}$/i.test(manifest?.wallet ?? '')
    || !Array.isArray(manifest?.positions)
    || manifest.positions.length !== 4
  ) throw new Error('FX_SCREENSHOT_POSITION_MANIFEST is not a complete four-position fixture');
  const seenGroups = new Set();
  for (const position of manifest.positions) {
    // These URLs and pool mappings come from the pinned SDK, not arbitrary
    // manifest input. A swapped or duplicate group must fail the capture.
    const group = `${position?.market}:${position?.side}`;
    const expected = expectedPools[group];
    if (
      !expected
      || seenGroups.has(group)
      || !Number.isSafeInteger(position?.positionId)
      || position.positionId <= 0
      || position?.pool?.toLowerCase() !== expected[0]
      || position?.graphSubgraph !== expected[1]
      || !/^\d+$/.test(position?.rawCollateral ?? '') || BigInt(position.rawCollateral) <= 0n
      || !/^\d+$/.test(position?.rawDebt ?? '') || BigInt(position.rawDebt) <= 0n
    ) throw new Error('FX_SCREENSHOT_POSITION_MANIFEST contains an invalid position row');
    seenGroups.add(group);
  }
  if (!Array.isArray(manifest.historyRows) || manifest.historyRows.length < 4) {
    throw new Error('FX_SCREENSHOT_POSITION_MANIFEST requires receipt-derived history rows for all four positions');
  }
  const historyGroups = new Set();
  for (const row of manifest.historyRows) {
    const group = `${row?.market}:${row?.side}`;
    const position = manifest.positions.find((candidate) => `${candidate.market}:${candidate.side}` === group
      && candidate.positionId === row?.positionId && candidate.pool?.toLowerCase() === row?.pool?.toLowerCase());
    if (!position || !['Open', 'Close'].includes(row?.type)
      || row?.id !== `${row.positionId}_${row.hash}`
      || !/^0x[0-9a-f]{64}$/i.test(row?.hash ?? '')
      || !/^\d+$/.test(row?.blockNumber ?? '') || BigInt(row.blockNumber) <= 0n
      || !/^\d+$/.test(row?.timestamp ?? '') || BigInt(row.timestamp) <= 0n
      || !position.transactions?.some((transaction) => transaction.hash?.toLowerCase() === row.hash.toLowerCase())) {
      throw new Error('FX_SCREENSHOT_POSITION_MANIFEST contains an invalid receipt-derived history row');
    }
    historyGroups.add(group);
  }
  if (historyGroups.size !== 4 || manifest.positions.some((position) =>
    !manifest.historyRows.some((row) => row.market === position.market && row.side === position.side
      && row.positionId === position.positionId && row.type === 'Open'))) {
    throw new Error('FX_SCREENSHOT_POSITION_MANIFEST history does not prove all four open positions');
  }
  return manifest;
}

mkdirSync(output, { recursive: true });
const browserChannel = configuredBrowserChannel();
const browser = await playwright.chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(browserChannel ? { channel: browserChannel } : {}),
});

async function createCaptureContext({ viewport, theme }) {
  const colorScheme = theme === 'light' ? 'light' : 'dark';
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  context.on('page', (page) => {
    const pageId = `page-${++nextPageId}`;
    pageIds.set(page, pageId);
    page.on('pageerror', (error) => pageErrors.push({ pageId, url: page.url(), message: error.message }));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push({ pageId, url: page.url(), message: message.text(), location: message.location() });
    });
    page.on('requestfailed', (request) => {
      const url = new URL(request.url());
      if (url.hostname === 'api.coingecko.com' && url.pathname === '/api/v3/simple/token_price/ethereum') {
        externalRequestFailures.push({ pageId, url: request.url(), method: request.method(), error: request.failure()?.errorText ?? 'unknown' });
      }
    });
  });

  if (positionManifest) {
    // Reuse either a screenshot build or the browser acceptance build while
    // its fork is still alive. Reads use the application's configured client;
    // this injected identity has no RPC forwarding or signing capability.
    // Raw content avoids transpiler helpers in serialized browser functions.
    await context.addInitScript({ content: `
      Object.defineProperty(window, 'ethereum', {
        configurable: true,
        value: Object.freeze({
          async request(request) {
            if (request.method === 'eth_accounts' || request.method === 'eth_requestAccounts') {
              return [${JSON.stringify(positionManifest.wallet)}];
            }
            if (request.method === 'eth_chainId') return '0x1';
            throw new Error('Documentation fork wallet is read-only.');
          },
          on() {},
          removeListener() {}
        })
      });
    ` });
  }

  await context.addInitScript(({ themeId, origin }) => {
    // Playwright also installs this on initial about:blank and child frames.
    // Only this application's origin has storage relevant to its theme.
    if (window.location.origin !== origin) return;
    window.localStorage.setItem('fxaeon_theme_id_v2', themeId);
    window.localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ theme: themeId }));
  }, { themeId: theme, origin: baseUrl });

  await context.route('**/telegram-web-app.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: '/* documentation capture: plain browser */',
  }));

  if (marketDataMode === 'fixture') {
    // Deliberately synthetic, opt-in design data. Every captured frame is
    // visibly labelled and its report records this mode. Never use as proof
    // of prices, returns, oracle values, execution quotes, or protocol state.
    await context.route('https://coins.llama.fi/**', async (route) => {
    const encodedIds = new URL(route.request().url()).pathname.split('/prices/current/')[1] ?? '';
    const ids = decodeURIComponent(encodedIds).split(',').filter(Boolean);
    const timestamp = Math.floor(Date.now() / 1000);
    const coins = Object.fromEntries(ids.map((id) => {
      const normalised = id.toLowerCase();
      const price = normalised.includes('2260fac5e5542a773aa44fbcfedf7c193bc2c599')
        ? 104_240
        : normalised.includes('c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')
          ? 2_485.42
          : normalised.includes('ae7ab96520de3a18e5e111b5eaab095312d7fe84')
            ? 2_485.42
            : normalised.includes('7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0')
              ? 2_944.19
              : 1;
      return [id, { price, timestamp, confidence: 0.99 }];
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ coins }) });
  });

  await context.route('https://api.coingecko.com/**', async (route) => {
    const url = new URL(route.request().url());
    const marketId = url.pathname.match(/\/coins\/([^/]+)\/market_chart$/)?.[1];
    if (marketId !== 'ethereum' && marketId !== 'bitcoin') return route.abort('blockedbyclient');
    const days = Math.max(1, Math.min(30, Number(url.searchParams.get('days')) || 1));
    const count = 120;
    const end = Date.now();
    const start = end - days * 24 * 60 * 60 * 1_000;
    const basePrice = marketId === 'bitcoin' ? 104_240 : 2_485.42;
    const prices = Array.from({ length: count }, (_, index) => {
      const progress = index / (count - 1);
      const timestamp = Math.round(start + progress * (end - start));
      const trend = 0.972 + progress * 0.028;
      const wave = Math.sin(index / 7) * 0.0035;
      return [timestamp, Number((basePrice * (trend + wave)).toFixed(6))];
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prices }) });
  });
  }

  if (positionManifest) {
    // The local fork creates valid position NFTs, but a fork-local block can
    // never be indexed by Goldsky. Intercept only this discovery query; the
    // official SDK still resolves collateral, debt, leverage, and pool state
    // against the contracts on Anvil. The fixture verifies NFT ownership.
    await context.route('https://api.goldsky.com/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const position = positionManifest.positions.find((candidate) => url.pathname === `${graphPrefix}${candidate.graphSubgraph}/gn`);
      let matchesDiscovery = false;
      try {
        const payload = request.postDataJSON();
        const normalise = (query) => query.replace(/\s/g, '');
        const expectedQuery = `query MyQuery { positions(first: 1000 where: {owner: "${positionManifest.wallet.toLowerCase()}"} orderBy: blockNumber orderDirection: desc) { id } }`;
        matchesDiscovery = request.method() === 'POST' && !url.search && !url.hash
          && typeof payload?.query === 'string' && Object.keys(payload).length === 1
          && normalise(payload.query) === normalise(expectedQuery);
      } catch {
        // Malformed or expanded queries must never become silent empty data.
      }
      if (!position) {
        discoveryErrors.push('Unexpected Goldsky endpoint; only the four pinned position-history indexes may be intercepted');
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'Unexpected screenshot discovery request' }] }) });
      }
      const group = `${position.market}:${position.side}`;
      if (matchesDiscovery) {
        interceptedGroups.add(group);
        await route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ data: { positions: [{ id: String(position.positionId) }] } }) });
        return;
      }
      let payload;
      try {
        payload = request.postDataJSON();
      } catch { /* The exact-query checks below reject malformed payloads. */ }
      const normalise = (query) => query.replace(/\s/g, '');
      const query = typeof payload?.query === 'string' ? normalise(payload.query) : '';
      const wallet = positionManifest.wallet.toLowerCase();
      const walletFilter = position.market === 'ETH' && position.side === 'short'
        ? `owner:"${wallet}"`
        : `or:[{owner:"${wallet}"},{realOwner:"${wallet}"}]`;
      const historyMatch = query.match(/^queryWalletPositionHistory\{positions\(first:25,skip:(0|[1-9][0-9]*),where:\{(.+)\},orderBy:blockNumber,orderDirection:desc\)\{idisClosedblockNumber\}\}$/);
      const ordersMatch = query.match(/^queryWalletPositionOrders\{orders\(first:5,skip:(0|[1-9][0-9]*),where:\{positionId_in:\[([0-9,"]*)\],type_in:\["Open","Close"\]\},orderBy:blockNumber,orderDirection:desc\)\{idtypehashblockNumbertimestamp\}\}$/);
      const exactEnvelope = request.method() === 'POST' && !url.search && !url.hash
        && Object.keys(payload ?? {}).length === 1 && typeof payload?.query === 'string';
      if (exactEnvelope && historyMatch && historyMatch[2] === walletFilter) {
        const positionRows = positionManifest.historyRows.filter((row) => row.market === position.market
          && row.side === position.side && row.positionId === position.positionId)
          .sort((a, b) => BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : BigInt(a.blockNumber) < BigInt(b.blockNumber) ? 1 : 0);
        if (positionRows.length === 0) {
          discoveryErrors.push(`No receipt-proven history rows exist for ${group}`);
          return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'Missing receipt-proven history' }] }) });
        }
        const offset = Number(historyMatch[1]);
        const latest = positionRows[0];
        const closed = latest.type === 'Close';
        interceptedHistoryGroups.add(group);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { positions:
          offset === 0 ? [{ id: String(position.positionId), isClosed: closed, blockNumber: latest.blockNumber }] : [] } }) });
        return;
      }
      if (exactEnvelope && ordersMatch) {
        const ids = [...ordersMatch[2].matchAll(/"([1-9][0-9]{0,15})"/g)].map((match) => Number(match[1]));
        const groupPosition = positionManifest.positions.find((candidate) => candidate.market === position.market
          && candidate.side === position.side && candidate.positionId === position.positionId);
        if (ids.length === 0 || ids.some((id) => id !== groupPosition?.positionId)) {
          discoveryErrors.push(`History order query for ${group} requested an unproved pool position`);
          return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'Unproved history position' }] }) });
        }
        const offset = Number(ordersMatch[1]);
        const orders = positionManifest.historyRows.filter((row) => row.market === position.market
          && row.side === position.side && ids.includes(row.positionId))
          .sort((a, b) => BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : BigInt(a.blockNumber) < BigInt(b.blockNumber) ? 1 : 0)
          .slice(offset, offset + 5)
          .map(({ id, type, hash, blockNumber, timestamp }) => ({ id, type, hash, blockNumber, timestamp }));
        interceptedHistoryGroups.add(group);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { orders } }) });
        return;
      }
      discoveryErrors.push('Unexpected Goldsky request; only exact owner-ID, position-history, and receipt-order queries are allowed');
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'Unexpected screenshot discovery request' }] }) });
    });
  }

  return context;
}

async function readCaptureViewport(page, session) {
  const dom = await page.evaluate(() => {
    const offset = (element) => ({ x: element?.scrollLeft ?? 0, y: element?.scrollTop ?? 0 });
    const rect = (selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box && box.width > 0 && box.height > 0
        ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left }
        : null;
    };
    return {
      window: { x: window.scrollX, y: window.scrollY },
      document: offset(document.scrollingElement),
      body: offset(document.body),
      containers: ['.app-shell', '.app-workspace', '.app-content'].map((selector) => ({ selector, ...offset(document.querySelector(selector)) })),
      visual: { x: window.visualViewport?.pageLeft ?? window.scrollX, y: window.visualViewport?.pageTop ?? window.scrollY },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      topbar: rect('.app-topbar'),
      rail: rect('.desktop-rail'),
    };
  });
  // Chromium's screenshot clip uses this viewport, so document.scrollTop alone
  // is not enough to prove that the exported frame starts at the page origin.
  const metrics = await session.send('Page.getLayoutMetrics');
  return {
    ...dom,
    browserLayout: { x: metrics.cssLayoutViewport.pageX, y: metrics.cssLayoutViewport.pageY },
    browserVisual: { x: metrics.visualViewport.pageX, y: metrics.visualViewport.pageY },
  };
}

function assertCaptureViewport(state, stage) {
  const offsets = [state.window, state.document, state.body, state.visual, state.browserLayout, state.browserVisual, ...state.containers];
  const atOrigin = offsets.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5);
  const chromeVisible = [state.topbar, state.rail].filter(Boolean).every((box) => (
    box.top >= -0.5 && box.left >= -0.5
    && box.bottom <= state.viewport.height + 0.5 && box.right <= state.viewport.width + 0.5
  ));
  if (!atOrigin || !chromeVisible) throw new Error(`capture viewport moved ${stage}: ${JSON.stringify(state)}`);
}

async function waitForStandardLogin(page) {
  // The configured Privy flow and the unconfigured browser-wallet fallback
  // have different semantic headings and controls. Wait for a usable login
  // screen in either mode; never treat the dynamic loading <main> as ready.
  await page.locator('main').last().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => {
    const main = [...document.querySelectorAll('main')].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(candidate).visibility !== 'hidden';
    });
    if (!main || main.querySelector('[role="alert"]')) return false;
    const heading = main.querySelector('h1')?.textContent?.trim();
    const usableButton = (name) => [...main.querySelectorAll('button')].some((button) => {
      const rect = button.getBoundingClientRect();
      return button.textContent?.trim() === name && !button.disabled
        && rect.width > 0 && rect.height > 0 && getComputedStyle(button).visibility !== 'hidden';
    });
    if (heading === 'Sign in to FxAeon') {
      return usableButton('Connect an existing wallet') && usableButton('Continue with email');
    }
    return heading === 'Connect your wallet' && usableButton('Connect browser wallet');
  }, null, { timeout: 30_000 });
  const privyHeading = page.getByRole('heading', { name: 'Sign in to FxAeon', exact: true });
  if (await privyHeading.isVisible()) {
    await playwright.expect(page.getByRole('button', { name: 'Connect an existing wallet', exact: true })).toBeEnabled();
    await playwright.expect(page.getByRole('button', { name: 'Continue with email', exact: true })).toBeEnabled();
  } else {
    await playwright.expect(page.getByRole('heading', { name: 'Connect your wallet', exact: true })).toBeVisible();
    const connect = page.getByRole('button', { name: 'Connect browser wallet', exact: true });
    await playwright.expect(connect).toBeVisible();
    await playwright.expect(connect).toBeEnabled();
  }
  await page.locator('.loading-line').waitFor({ state: 'hidden', timeout: 30_000 });
}

function classifyConsoleErrors() {
  const blockedFallbacks = consoleErrors.filter(({ message }) => {
    const requestedUrl = message.match(/https?:\/\/[^\s'"<>]+/)?.[0];
    if (!requestedUrl || !message.includes('blocked by CORS policy')) return false;
    try {
      const url = new URL(requestedUrl);
      return url.protocol === 'https:'
        && url.hostname === 'api.coingecko.com'
        && url.pathname === '/api/v3/simple/token_price/ethereum';
    } catch {
      return false;
    }
  });
  const externalFailuresByPage = new Map();
  for (const failure of externalRequestFailures) {
    externalFailuresByPage.set(failure.pageId, (externalFailuresByPage.get(failure.pageId) ?? 0) + 1);
  }
  const known = new Set(blockedFallbacks);
  for (const error of consoleErrors) {
    if (!error.message.includes('Failed to load resource: net::ERR_FAILED')) continue;
    const count = externalFailuresByPage.get(error.pageId) ?? 0;
    const alreadyMatched = consoleErrors.filter((candidate) => (
      candidate.pageId === error.pageId
      && known.has(candidate)
      && candidate.message.includes('Failed to load resource: net::ERR_FAILED')
    )).length;
    if (count > alreadyMatched) known.add(error);
  }
  return {
    knownExternalFallbackErrors: consoleErrors.filter((error) => known.has(error)),
    unclassifiedErrors: consoleErrors.filter((error) => !known.has(error)),
  };
}

function assertNoCaptureErrors() {
  const { unclassifiedErrors } = classifyConsoleErrors();
  if (discoveryErrors.length || pageErrors.length || unclassifiedErrors.length) {
    throw new Error(`capture rejected: ${JSON.stringify({ discoveryErrors, pageErrors, unclassifiedConsoleErrors: unclassifiedErrors })}`);
  }
}

async function hideNextDevIndicatorAfterCleanCheck(page) {
  // The dev-only Next toolbar is not product UI. Hide its portal only after
  // all observed routes pass pageerror and unclassified-console-error gates.
  assertNoCaptureErrors();
  if (!await page.locator('nextjs-portal').count()) return;
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForFunction(() => {
    const portal = document.querySelector('nextjs-portal');
    return !portal || getComputedStyle(portal).display === 'none';
  });
}

async function capture(page, file, route, prepare) {
  // A source Next dev server can keep DOMContentLoaded pending while compiling
  // route chunks. We validate the rendered main, wallet state, data, images,
  // and fonts below, so commit is the safe navigation boundary here.
  const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'commit' });
  if (!response?.ok()) throw new Error(`capture route ${route} did not return a successful response`);
  await page.locator('main').last().waitFor({ state: 'visible' });
  await prepare?.(page);
  // Lazy wallet/settings modules can still be hydrating after the page
  // landmark appears. Do not publish an empty placeholder as a finished UI.
  await playwright.expect(page.locator('.loading-line')).toHaveCount(0, { timeout: 30_000 });
  if (route !== '/login') {
    // AppShell can paint before the shared wallet provider settles. Require
    // the actual header control so a blank wallet skeleton never enters docs.
    await playwright.expect(page.locator('.app-topbar [aria-label="Connect wallet"], .app-topbar [aria-label="Open wallet profile"]')).toHaveCount(1, { timeout: 30_000 });
  }
  if (route === '/' || route === '/portfolio') {
    // The wallet provider can settle after the page landmark and loading line;
    // never publish the transient portfolio shell as the standard frame.
    await playwright.expect(page.locator('[aria-label="Loading portfolio"]')).toHaveCount(0, { timeout: 30_000 });
  }
  if (route === '/settings') {
    await playwright.expect(page.getByText('Wallet', { exact: true })).toBeVisible();
    await playwright.expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 30_000 });
  }
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Loading market chart"]')].every((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0;
  }), null, { timeout: 60_000 });
  if (route === '/' || route === '/portfolio') {
    // Portfolio trend cards can expose their settled prices before the live
    // chart request paints. Wait for both SVG polylines before publishing a
    // standard frame so a transient dash is not mistaken for chart data.
    await page.waitForFunction(() => {
      const trends = [...document.querySelectorAll('svg[aria-label$="24 hour trend"] polyline')];
      return trends.length >= 2 && trends.every((trend) => Boolean(trend.getAttribute('points')?.trim()));
    }, null, { timeout: 60_000 });
  }
  await page.waitForFunction(() => [...document.images]
    .filter((image) => {
      const rect = image.getBoundingClientRect();
      const style = window.getComputedStyle(image);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth;
    })
    .every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  assertNoCaptureErrors();
  if (route === '/trade' && (page.viewportSize()?.width ?? 0) > 839) {
    // Do not publish the grid-only first paint. Require actual colored candle
    // strokes in the plot canvas, not just a loaded chart shell or axes.
    await page.waitForFunction(() => {
      const chart = document.querySelector('.market-chart-panel[data-mobile-expanded="true"]');
      const canvas = chart?.querySelector('.market-chart-graphic canvas');
      const context = canvas?.getContext('2d');
      if (!canvas || !context || canvas.width < 100 || canvas.height < 60) return false;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let coloredCandlePixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index]; const green = pixels[index + 1]; const blue = pixels[index + 2];
        if ((red > green * 1.3 && red > blue * 1.2 && red > 80)
          || (green > red * 1.3 && green > blue * 1.1 && green > 80)) coloredCandlePixels += 1;
        if (coloredCandlePixels >= 20) return true;
      }
      return false;
    }, null, { timeout: 60_000 });
  }
  if (positionManifest && interceptedGroups.size !== 4) throw new Error('all four exact SDK discovery requests must be observed before capture');
  if (positionManifest && interceptedHistoryGroups.size !== 4) throw new Error('all four exact receipt-backed history groups must be observed before capture');
  if (marketDataMode === 'fixture' || positionManifest) {
    await page.evaluate(({ illustrative, fork }) => {
      const caption = document.createElement('aside');
      caption.textContent = [fork ? 'Local Ethereum fork' : 'Documentation preview', illustrative ? 'Illustrative prices & charts' : 'Display prices observed at capture'].join(' · ');
      caption.setAttribute('data-capture-provenance', 'true');
      Object.assign(caption.style, { position: 'fixed', top: '4px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647', whiteSpace: 'nowrap', maxWidth: '98vw', padding: '3px 8px', borderRadius: '4px', background: '#111827', color: '#f9fafb', font: '9px/1.4 system-ui', pointerEvents: 'none' });
      document.body.appendChild(caption);
    }, { illustrative: marketDataMode === 'fixture', fork: Boolean(positionManifest) });
  }
  const renderedPositionKeys = await page.locator('[data-position-key]').evaluateAll((cards) => [...new Set(cards.map((card) => card.getAttribute('data-position-key')))].sort());
  const session = await page.context().newCDPSession(page);
  try {
    if (captureProfile === 'standard' && route === '/login') await waitForStandardLogin(page);
    await hideNextDevIndicatorAfterCleanCheck(page);
    await page.evaluate(async () => {
      // Preparation can leave an offscreen editable focused. Remove that
      // selection/focus anchor before the screenshot changes caret styling.
      // Do not reset nested token-list scroll or otherwise change the layout.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    });
    const before = await readCaptureViewport(page, session);
    assertCaptureViewport(before, 'before screenshot');
    const buffer = await page.screenshot({ fullPage: false, animations: 'disabled', caret: 'hide' });
    const after = await readCaptureViewport(page, session);
    assertCaptureViewport(after, 'after screenshot');
    if (captureProfile === 'standard' && route === '/login') {
      await waitForStandardLogin(page);
      await playwright.expect(page.locator('.loading-line')).toHaveCount(0);
    }
    assertNoCaptureErrors();
    for (const key of ['topbar', 'rail']) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error(`capture chrome shifted during screenshot: ${key}`);
    }
    // Publish the frame only after both DOM and Chromium offsets are checked.
    writeFileSync(path.join(output, file), buffer);
    captures.push({ file, route, viewport: page.viewportSize(), renderedPositionKeys, scrollEvidence: { before, after }, capturedAt: new Date().toISOString(), sha256: createHash('sha256').update(buffer).digest('hex') });
  } finally {
    await session.detach();
  }
}

async function waitForPositionKeys(page, expectedPositions) {
  const expectedKeys = expectedPositions.map((position) => `${position.market}:${position.side}:${position.positionId}`).sort();
  await page.waitForFunction((keys) => {
    const rendered = [...new Set([...document.querySelectorAll('[data-position-key]')].map((card) => card.getAttribute('data-position-key')))].sort();
    return JSON.stringify(rendered) === JSON.stringify(keys)
      && !document.querySelector('[aria-label="Loading positions"]')
      && !document.body.textContent.includes('Last verified')
      && !document.body.textContent.includes('Live verification failed');
  }, expectedKeys, { timeout: 120_000 });
}

async function waitForPopulatedPositions(page) {
  await waitForPositionKeys(page, positionManifest.positions);
}

async function openPortfolioPositions(page) {
  const disclosure = page.locator('section[aria-label="Positions"] details');
  await disclosure.locator('summary').waitFor({ state: 'visible', timeout: 30_000 });
  if (!await disclosure.evaluate((element) => element.open)) await disclosure.locator('summary').click();
  await page.waitForFunction(() => document.querySelector('section[aria-label="Positions"] details')?.open === true, null, { timeout: 30_000 });
}

async function waitForPopulatedPortfolio(page) {
  // The loading outline also contains this disclosure. Wait for canonical
  // rows before clicking so hydration cannot replace the opened skeleton.
  await waitForPositionKeys(page, positionManifest.positions.filter((position) => position.market === 'ETH'));
  await openPortfolioPositions(page);
  await page.waitForFunction(() => {
    const positionSection = document.querySelector('section[aria-label="Positions"]');
    const valueCard = document.querySelector('[data-portfolio-value]');
    const loadingValue = document.querySelector('[aria-label="Loading portfolio value"], [aria-label="Loading wallet asset count"]');
    return Boolean(positionSection && valueCard) && !loadingValue;
  }, null, { timeout: 120_000 });
}

async function waitForPopulatedWalletProfile(page) {
  await waitForPopulatedPortfolio(page);
  await page.getByRole('button', { name: 'Open wallet profile', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const assets = document.querySelector('[aria-labelledby="wallet-profile-balances-title"]');
    const rows = assets?.querySelectorAll('ul > li button[aria-label^="View "]') ?? [];
    const loading = assets?.querySelector('[aria-label="Loading assets"], [aria-label="Loading wallet value"], [aria-label="Loading wallet asset count"]');
    return Boolean(assets && rows.length > 0 && !loading);
  }, null, { timeout: 120_000 });
}

async function waitForPopulatedWalletAssetDetail(page) {
  await waitForPopulatedWalletProfile(page);
  const assetRow = page.locator('[aria-labelledby="wallet-profile-balances-title"] ul > li button[aria-label^="View "]').first();
  const assetLabel = await assetRow.getAttribute('aria-label');
  if (!assetLabel) throw new Error('receipt-backed wallet asset row has no accessible label');
  await assetRow.click();
  const detail = page.getByRole('dialog').last();
  await detail.waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: / on (Ethereum|Base)$/ }).waitFor({ state: 'visible' });
}

async function waitForPopulatedTrade(page) {
  await waitForPositionKeys(page, positionManifest.positions.filter((position) => position.market === 'ETH'));
}

async function captureInFreshContext({ file, route, viewport, theme, prepare }) {
  const context = await createCaptureContext({ viewport, theme });
  try {
    await capture(await context.newPage(), file, route, prepare);
  } finally {
    await context.close();
  }
}

async function main() {
  if (captureProfile === 'audit') {
    // A local-only visual contact set. No fixture wallet or market values are
    // necessary: disconnected and unavailable states must be designed too.
    const routes = ['/', '/login', '/portfolio', '/trade', '/positions', '/earn', '/borrow', '/move', '/more', '/settings', '/history', '/qr', '/docs'];
    for (const theme of ['official', 'dark', 'light']) {
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
        const context = await createCaptureContext({ viewport, theme });
        const page = await context.newPage();
        for (const route of routes) {
          const name = route === '/' ? 'home' : route.slice(1);
          await capture(page, `audit-${name}-${theme}-${viewport.width}.png`, route, route === '/login' ? waitForStandardLogin : undefined);
        }
        await context.close();
      }
    }
    return;
  }
  if (captureProfile === 'positions') {
    const desktopContext = await createCaptureContext({ viewport: { width: 1180, height: 900 }, theme: 'official' });
    const desktopPage = await desktopContext.newPage();
    await capture(desktopPage, 'fxaeon-portfolio-positions.png', '/', waitForPopulatedPortfolio);
    await capture(desktopPage, 'fxaeon-positions.png', '/positions', waitForPopulatedPositions);
    await capture(desktopPage, 'fxaeon-trade-connected.png', '/trade', async (current) => {
      await waitForPopulatedTrade(current);
      await current.getByLabel('Amount in ETH').fill('1.25');
    });
    await desktopContext.close();

    const mobileContext = await createCaptureContext({ viewport: { width: 390, height: 844 }, theme: 'official' });
    const mobilePage = await mobileContext.newPage();
    await capture(mobilePage, 'fxaeon-positions-mobile.png', '/positions', waitForPopulatedPositions);
    await mobilePage.setViewportSize({ width: 393, height: 852 });
    await capture(mobilePage, 'fxaeon-portfolio-populated-mobile.png', '/', waitForPopulatedPortfolio);
    await capture(mobilePage, 'fxaeon-wallet-profile-populated-mobile.png', '/', waitForPopulatedWalletProfile);
    await capture(mobilePage, 'fxaeon-wallet-asset-detail-mobile.png', '/', waitForPopulatedWalletAssetDetail);
    await mobileContext.close();
    return;
  }

  const desktopViewport = { width: 1440, height: 900 };
  const desktopScreens = [
    { file: 'fxaeon-web.png', route: '/' },
    { file: 'fxaeon-trade.png', route: '/trade', prepare: async (current) => {
      await current.getByLabel('Amount in ETH').fill('1.25');
    } },
    { file: 'fxaeon-token-picker.png', route: '/trade', prepare: async (current) => {
      await current.getByLabel('Amount in ETH').fill('1.25');
      await current.getByLabel('Input asset').click();
      const picker = current.getByRole('dialog', { name: 'Input asset' });
      await picker.waitFor({ state: 'visible' });
      await current.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] img')].every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 15_000 });
    } },
    { file: 'fxaeon-bridge.png', route: '/move' },
    { file: 'fxaeon-login.png', route: '/login', prepare: waitForStandardLogin },
    { file: 'fxaeon-portfolio.png', route: '/portfolio' },
    { file: 'fxaeon-docs.png', route: '/docs' },
  ];
  for (const screen of desktopScreens) {
    await captureInFreshContext({ ...screen, viewport: desktopViewport, theme: 'official' });
  }
  await captureInFreshContext({
    file: 'fxaeon-trade-mobile.png', route: '/trade',
    viewport: { width: 390, height: 844 }, theme: 'official',
    prepare: async (current) => { await current.getByLabel('Amount in ETH').fill('1.25'); },
  });
  await captureInFreshContext({
    file: 'fxaeon-portfolio-mobile.png', route: '/portfolio',
    viewport: { width: 390, height: 844 }, theme: 'light',
  });

}

try {
  await main();
  const report = {
    schemaVersion: 1,
    profile: captureProfile,
    capturedAt: new Date().toISOString(),
    marketData: marketDataMode === 'fixture' ? 'illustrative-display-fixture-visibly-labelled' : 'external-display-data-unmodified',
    pageErrors,
    consoleErrors,
    knownExternalFallbackErrors: classifyConsoleErrors().knownExternalFallbackErrors,
    externalRequestFailures,
    unclassifiedConsoleErrors: classifyConsoleErrors().unclassifiedErrors,
    devIndicator: 'nextjs-portal-hidden-after-zero-page-and-unclassified-console-errors',
    routeIsolation: captureProfile === 'standard' ? 'fresh-page-and-browser-context-per-capture' : 'profile-default',
    positionDiscovery: positionManifest ? 'exact-four-sdk-owner-id-queries-only' : 'not-intercepted',
    positionFixtureExecutionSurface: positionManifest?.executionSurface ?? 'unspecified',
    observedDiscoveryGroups: [...interceptedGroups].sort(),
    observedHistoryGroups: [...interceptedHistoryGroups].sort(),
    discoveryErrors,
    captures,
    scope: 'Rendered documentation states, not browser transaction-execution proof.',
  };
  if (process.env.FX_SCREENSHOT_CAPTURE_REPORT) writeFileSync(path.resolve(process.env.FX_SCREENSHOT_CAPTURE_REPORT), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`Captured ${captures.length} documentation screens (${marketDataMode} display data)\n`);
} finally {
  await browser.close();
}
