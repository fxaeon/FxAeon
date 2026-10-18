import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { debtShare } from '../../src/lib/leverageShare';

/*
 * The position is born: Trade's confirmed result for a newly opened ETH Long
 * draws the split chosen on the ticket, and "View position" carries that bar
 * into the position's own split on /positions with a view transition. A closed
 * position result also verifies its in-app return to Positions. The real Trade
 * and Positions pages, result view, rows and transition helper run
 * against mocked wallet, chain, prices and brake reads, behind a stand-in for
 * Next's asynchronous router (see e2e/harness/position-born-entry.tsx). Set
 * BORN_SHOTS_DIR to keep a filmstrip of the transition and the final states.
 */
const appRoot = resolve(__dirname, '../..');
const root = resolve(appRoot, '../..');
const src = resolve(appRoot, 'src');
const publicRoot = resolve(appRoot, 'public');
const appRequire = createRequire(resolve(appRoot, 'package.json'));
const tsxPackage = appRequire.resolve('tsx/package.json');
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }> };
const shotsDir = process.env.BORN_SHOTS_DIR;
const entry = resolve(appRoot, 'e2e/harness/position-born-entry.tsx');

const KEY = 'ETH:long:4242';
const NAME = 'position-born-eth-long-4242';
const CHOSEN_SHARE = debtShare('long', 2.8);
const CONFIRMED_SHARE = 0.62892;

const mocks: Record<string, string> = {
  'next/link': `import React from 'react'; export default React.forwardRef(function Link({ href, children, prefetch, scroll, replace, ...props }, ref) { return <a ref={ref} href={typeof href === 'string' ? href : '#'} {...props} onClick={(event) => { event.preventDefault(); props.onClick?.(event); }}>{children}</a>; });`,
  'next/navigation': `export const useRouter = () => ({ push: (href) => globalThis.__positionBorn.navigate(href), replace: () => {}, back: () => {}, prefetch: () => { globalThis.__positionBorn.prefetches += 1; } });
export const usePathname = () => globalThis.__positionBorn.path; export const useSearchParams = () => new URLSearchParams(window.location.search);`,
  '@/components/ThemeToggle': `import React from 'react'; export default function ThemeToggle() { return <button type="button" aria-label="Appearance" className="theme-toggle glass-press" style={{ width: 44, height: 44 }} />; }`,
  '@/components/WalletProfile': `import React from 'react'; export default function WalletProfile() { return <button type="button" aria-label="Open wallet profile" className="glass-press" style={{ minHeight: 44, padding: '0 12px', fontSize: 13, fontWeight: 600 }}>0x930f…98b9</button>; }`,
  '@/components/NetworkSelector': `import React from 'react'; export default function NetworkSelector() { return <button type="button" aria-label="Network: Ethereum" className="glass-press" style={{ width: 44, height: 44 }} />; }`,
  '@/components/WalletConnectCTA': `import React from 'react'; export default ({body}) => <section>{body}</section>;`,
  '@/components/MarketChart': `import React from 'react'; export const TradeMarketChart = ({ market }) => <div aria-label="Market chart">{market}</div>;`,
  '@/components/BridgeTracker': `export const BridgeTracker = () => null;`,
  '@/components/ProtocolPositionProvider': `export const useProtocolPositions = () => globalThis.__positionBorn.shared;`,
  '@/components/PositionBrakeContext': `export function usePositionBrake(position) {
  if (position.info.rawDebts <= 0n) return { status: 'none' };
  const reading = globalThis.__positionBorn.brakes[position.market + ':' + position.side + ':' + position.info.positionId];
  return reading ? { status: 'ready', reading, readAt: Date.now() } : { status: 'unavailable' };
}`,
  '@/components/PriceProvider': `import { useSyncExternalStore } from 'react';
import { liveMarketStore } from '@/lib/liveMarketStore';
import { isLiveQuoteFresh } from '@/lib/liveMarket';
const now = Date.now();
const EMPTY = { quote: null, status: 'paused', now: 0 };
export function useUsdPrices() {
  const prices = globalThis.__positionBorn.prices;
  return { prices, status: 'ready', updatedAt: now, updatedAts: Object.fromEntries(Object.keys(prices).map((key) => [key, now])), refreshing: false, refresh: async () => {} };
}
export const useUsdPrice = (key) => useUsdPrices().prices[key];
export function useLiveMarketQuote(market) {
  const live = useSyncExternalStore(liveMarketStore.subscribe, () => liveMarketStore.getSnapshot(market), () => EMPTY);
  return { quote: live.quote, status: live.status, isFresh: live.status === 'live' && isLiveQuoteFresh(live.quote, live.now) };
}`,
  '@/components/WalletDataProvider': `const data = { balances: [
  { key: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, amountWei: 1250000000000000000n },
  { key: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, amountWei: 4500000000n },
], failedTokens: [] };
const ready = { data, status: 'ready', isFetching: false, updatedAt: Date.now(), error: '', refresh: async () => data };
export function useWalletBalances({ address, enabled = true }) { return enabled && address ? ready : { data: null, status: 'idle', isFetching: false, updatedAt: null, error: '', refresh: async () => undefined }; }
const chain = (chainId) => ({ chainId, status: 'idle', transport: null, latestBlockNumber: null, lastEventAt: null, lastTransferAt: null, reconnectAttempt: 0, revision: 0 });
export function useRealtimeChainState(chainId) { return chainId ? chain(chainId) : { 1: chain(1), 8453: chain(8453) }; }
export const useInvalidateWalletData = () => async () => {};
export const useWalletAssets = () => ({ data: null, status: 'idle', isFetching: false, error: '', refresh: async () => undefined });
export const useFxSaveClaimable = () => ({ data: null, status: 'idle', isFetching: false, updatedAt: null, refresh: async () => undefined });`,
  // Trade opens on its confirmed result; Positions starts at its editor. Trade
  // also reports the confirmation once, as the real lifecycle does.
  '@/components/review/useActionReviewLifecycle': `import React from 'react';
export function useActionReviewLifecycle(props) {
  const harness = globalThis.__positionBorn;
  const trade = Boolean(props.onViewNewPosition);
  const showResult = trade || harness.closedPosition;
  const [stage, setStage] = React.useState(showResult ? 'result' : 'input');
  React.useEffect(() => { props.onStageChange?.(stage); }, [stage, props.onStageChange]);
  React.useEffect(() => { if (showResult && !harness.completed) { harness.completed = true; void props.onComplete?.(harness.result, harness.route); } }, []);
  const reset = () => setStage('input');
  return { canSelectReviewedRoute: false, endConnectFlow: () => {}, error: null, execute: async () => {}, feeSelection: null,
    gasCost: { checking: false, estimate: null, estimateIsCurrent: false, status: 'idle' }, headingRef: { current: null }, loading: false,
    networkSwitching: false, quoteChanges: [], quoteExpired: false, refreshReviewedQuote: async () => {}, refreshing: false, reset,
    result: stage === 'result' ? harness.result : null, review: async () => {}, reviewTitle: trade ? 'Open ETH Long' : harness.closedPosition ? 'Close ETH Long' : null,
    route: showResult ? harness.route : null, routeSummaries: [], routes: showResult ? [harness.route] : [], selectedRoute: 0, selectReviewedRoute: () => {},
    selectGasTier: async () => {}, startConnectFlow: () => {}, stage, status: stage === 'result' ? 'confirmed' : 'planning', statusDetail: '',
    stepResults: stage === 'result' ? harness.result.steps : [], triggerRef: { current: null }, wallet: { ...harness.wallet } };
}`,
  '@/lib/confirmedPositions': `export const receiptMintedPositionIdentity = () => globalThis.__positionBorn.identity; export const deriveConfirmedPositionHint = () => globalThis.__positionBorn.hint;`,
  '@/lib/confirmedPositionStorage': `export const confirmedPositionHintKey = (hint) => hint.market + ':' + hint.side + ':' + hint.positionId;`,
  '@/lib/taskState': `export const selectExecutionTask = () => null;`,
  // CommonJS behind a Proxy: the names the pages call are live; every other
  // name the graph imports resolves to an inert stub.
  '@/lib/fx': `const { tokens: t } = require('@aladdindao/fx-sdk');
const FX_TOKENS = {ETH:{address:t.eth,decimals:18,key:'ETH'},WETH:{address:t.weth,decimals:18,key:'WETH'},wstETH:{address:t.wstETH,decimals:18,key:'wstETH'},stETH:{address:t.stETH,decimals:18,key:'stETH'},WBTC:{address:t.WBTC,decimals:8,key:'WBTC'},USDC:{address:t.usdc,decimals:6,key:'USDC'},USDT:{address:t.usdt,decimals:6,key:'USDT'},fxUSD:{address:t.fxUSD,decimals:18,key:'fxUSD'},fxUSDBasePool:{address:t.fxUSDBasePool,decimals:18,key:'fxUSDBasePool'},fxSAVE:{address:'0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39',decimals:18,key:'fxSAVE'}};
const bounds = { min: 1.1, max: 6.1, source: 'fixture' };
const known = { FX_TOKENS, MAX_FX_SLIPPAGE_PERCENT: 2, clampLeverage: (v) => Math.min(bounds.max, Math.max(bounds.min, v)), leverageBoundsFor: () => bounds,
  formatRouteGasCost: () => ({ gasFee: '0.0024 ETH', totalCost: '0.0024 ETH' }), planAdjustPositionLeverage: async () => null, planIncreasePosition: async () => null, planReducePosition: async () => null,
  prepareLeverageReview: async ({ leverage }) => ({ leverage, bounds, plan: null, adjusted: false }), readLeverageBounds: async () => bounds,
  readSignatureRequiredDraft: () => null, restoreSignatureRequiredDraft: () => null, restoreSignatureRequiredDraftFromSearch: () => null, signatureDraftIdFromSearch: () => null };
module.exports = new Proxy(known, { get: (target, key) => key in target ? target[key] : key === '__esModule' ? false : () => undefined });`,
  '@/lib/fx/policy': `import {FX_TOKENS} from '@/lib/fx'; const pools={long:['0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8','0xAB709e26Fa6B0A30c119D8c55B887DeD24952473'],short:['0x25707b9e6690B52C60aE6744d711cf9C1dFC1876','0xA0cC8162c523998856D59065fAa254F87D20A5b0']}; export const positionPoolAddress=(market,type)=>pools[type][market==='ETH'?0:1]; export const positionCollateralTokenAddress=(market,type)=>type==='short'?FX_TOKENS.fxUSD.address:market==='ETH'?FX_TOKENS.wstETH.address:FX_TOKENS.WBTC.address; export const positionDebtTokenAddress=(market,type)=>type==='long'?FX_TOKENS.fxUSD.address:market==='ETH'?FX_TOKENS.wstETH.address:FX_TOKENS.WBTC.address;`,
  '@/lib/fx/gasFeePolicy': `export const formatGasPriceGwei=value=>Number(value)/1000000000+' Gwei'; export const formatGasTierQuote=quote=>quote.tier+' · '+Number(quote.gasPriceWei)/1000000000+' Gwei'; export const fetchGasTierQuotes=async()=>{ throw new Error('Gas quotes are unavailable in the harness'); }; export const selectedGasTierQuote=()=>{ throw new Error('Gas quotes are unavailable in the harness'); };`,
  '@/lib/wallet': `export const usePrivyWallet=()=>({...globalThis.__positionBorn.wallet,sendTransaction:async()=>{ throw new Error('No signing in the harness'); }}); export const isWalletConnectCancellation=()=>false; export const useWalletReadyTimeout=()=>false;`,
  '@/lib/settings': `export const DEFAULT_SLIPPAGE_PERCENT=1; export const GAS_TIERS=['standard','fast','rapid']; export const readSlippagePercent=()=>1; export const SETTINGS_KEY='settings'; export const SETTINGS_UPDATED_EVENT='settings-updated'; export const readGasTier=()=>'standard'; export const DEFAULT_GAS_TIER='standard'; export const MIN_SLIPPAGE_BPS=10; export const MAX_SLIPPAGE_BPS=200; export const SLIPPAGE_PRESETS_BPS=[10,50,100,200]; export const isSlippageBps=(v)=>Number.isInteger(v)&&v>=10&&v<=200; export const writeTransactionSettings=()=>true;`,
  '@/lib/telegram': `export const haptic=()=>{}; export const openExternalLink=()=>false; export const telegramExplorerUrl=()=>null;`,
  '@/app/trade/fxUi': `import { formatUnits } from 'viem';
export function formatAmount(value, decimals = 18, digits = 5) { if (value === undefined) return '—'; const [integer, fraction = ''] = formatUnits(value, decimals).split('.'); const trimmed = fraction.slice(0, digits).replace(/0+$/, ''); return trimmed ? integer + '.' + trimmed : integer; }
export const positionDisplayLeverage = (position) => ({ value: position.side === 'short' ? position.info.lsdLeverage : position.info.currentLeverage, label: 'leverage' });
export const positionKey = (position) => position.market + ':' + position.side + ':' + position.info.positionId;
export const positionTokenDecimals = (position, field) => field === 'collateral' ? position.info.rawCollsDecimals : position.info.rawDebtsDecimals;
export const positionIsStale = (position, failedGroups) => failedGroups.some((group) => group.market === position.market && group.side === position.side);
export const getSdkReductionAmountWei = async () => 1n; export const parseAmount = () => 1n;
export const positionCollateralDecimals = () => 18; export const positionDebtDecimals = () => 18;
export const positionInputTokenOptions = (market) => market === 'BTC' ? ['WBTC', 'USDC', 'USDT', 'fxUSD'] : ['ETH', 'WETH', 'stETH', 'wstETH', 'USDC', 'USDT', 'fxUSD'];
export const positionOutputTokenOptions = (market) => market === 'BTC' ? ['WBTC', 'USDC', 'USDT', 'fxUSD'] : ['ETH', 'WETH', 'wstETH', 'USDC', 'USDT', 'fxUSD'];
export const positionTargetLeverage = (position) => Number(Math.max(0.1, position.side === 'short' ? position.info.lsdLeverage : position.info.currentLeverage).toFixed(2));
export const tokenAddress = () => '0x0000000000000000000000000000000000000001';
export const tokenDecimals = (token) => token === 'USDC' || token === 'USDT' ? 6 : token === 'WBTC' ? 8 : 18;`,
};

function resolveSource(path: string): string {
  const candidate = resolve(src, path.slice(2));
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return `${candidate}${extension}`;
  for (const extension of ['.tsx', '.ts']) if (existsSync(resolve(candidate, `index${extension}`))) return resolve(candidate, `index${extension}`);
  return candidate;
}
let lab: { script: string; css: string };

test.beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, outdir: 'position-born-bundle', entryNames: 'index', format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.module.css': 'local-css', '.css': 'empty' }, absWorkingDir: root, logLevel: 'error',
    banner: { js: "var process = { env: { NODE_ENV: 'production' } };" },
    plugins: [{ name: 'position-born', setup(build: { onResolve: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string }) => unknown) => void; onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string }) => unknown) => void }) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({ path: args.path, namespace: 'mock' }));
      // ConfirmedPositionCards reaches the provider by a relative path.
      build.onResolve({ filter: /^\.\/ProtocolPositionProvider$/ }, () => ({ path: '@/components/ProtocolPositionProvider', namespace: 'mock' }));
      build.onResolve({ filter: /^@\// }, (args) => mocks[args.path] ? { path: args.path, namespace: 'mock' } : { path: resolveSource(args.path) });
      build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: appRoot }));
    } }],
  });
  const script = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
  const modules = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  if (!script) throw new Error('The position-born bundle was not emitted.');
  const { buildLabGlobalCss } = await import('../harness/portfolio-states-build');
  lab = { script, css: `${await buildLabGlobalCss()}\n${modules}` };
});

type Probe = {
  calls: Array<{
    sourceName: string | null;
    sourceShare: string | null;
    atResolve: null | { url: string; targetKey: string | null; targetName: string | null; targetVisible: boolean; born: boolean; targetShare: string | null; sourceInDocument: boolean };
  }>;
  finished: number;
  ready: number;
};

/**
 * Watches every view transition the page starts: what was named when it began,
 * and what the page held at the moment its update resolved, which is the state
 * the browser then captures as the new view.
 */
const PROBE = `(() => {
  const native = Document.prototype.startViewTransition;
  if (!native) return;
  const probe = window.__bornProbe = { calls: [], finished: 0, ready: 0 };
  Document.prototype.startViewTransition = function (update) {
    const source = document.querySelector('[data-position-born-source]');
    const record = { sourceName: source ? source.style.viewTransitionName || null : null, sourceShare: source ? source.style.getPropertyValue('--debt-share') : null, atResolve: null };
    probe.calls.push(record);
    const transition = native.call(this, async () => {
      await update();
      const target = document.querySelector('[data-position-details] [data-position-split]');
      const details = target ? target.closest('[data-position-details]') : null;
      record.atResolve = {
        url: location.pathname + location.search,
        targetKey: details ? details.getAttribute('data-position-details') : null,
        targetName: target ? target.style.viewTransitionName || null : null,
        targetVisible: Boolean(target && target.getClientRects().length),
        born: Boolean(target && target.hasAttribute('data-born')),
        targetShare: target ? target.style.getPropertyValue('--debt-share') : null,
        sourceInDocument: Boolean(document.querySelector('[data-position-born-source]')),
      };
    });
    window.__bornTransition = transition;
    transition.ready.then(() => { probe.ready += 1; if (window.__bornPause) document.getAnimations().forEach((animation) => animation.pause()); }, () => {});
    transition.finished.then(() => { probe.finished += 1; }, () => { probe.finished += 1; });
    return transition;
  };
})();`;

async function open(page: Page, { theme = 'dark', readable = true, api = true, closedPosition = false }: { theme?: 'official' | 'dark' | 'light'; readable?: boolean; api?: boolean; closedPosition?: boolean } = {}) {
  const html = `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/lab.css"></head>`
    + `<body><div id="root"></div><script>${api ? PROBE : 'delete Document.prototype.startViewTransition;'}window.__positionBornConfig = ${JSON.stringify({ theme, readable, closedPosition })};</script><script src="/lab.js"></script></body></html>`;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('http://lab.test/**', async (request) => {
    const url = new URL(request.request().url());
    if (url.pathname === '/trade' || url.pathname === '/positions') return request.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/lab.css') return request.fulfill({ contentType: 'text/css', body: lab.css });
    if (url.pathname === '/lab.js') return request.fulfill({ contentType: 'text/javascript', body: lab.script });
    const file = resolve(publicRoot, `.${decodeURIComponent(url.pathname)}`);
    if (!existsSync(file)) return request.fulfill({ status: 404, body: '' });
    return request.fulfill({ contentType: extname(file) === '.svg' ? 'image/svg+xml' : 'image/png', body: readFileSync(file) });
  });
  await page.goto('http://lab.test/trade');
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
}

const probe = (page: Page) => page.evaluate(() => (window as unknown as { __bornProbe?: Probe }).__bornProbe ?? null);
const source = (page: Page) => page.locator(`[data-position-born-source="${KEY}"]`);
const details = (page: Page) => page.locator(`[data-position-details="${KEY}"]`);
const viewPosition = (page: Page) => page.getByRole('button', { name: 'View position', exact: true });
const share = (value: string | null | undefined) => Number.parseFloat(value ?? '');

test.describe('a position opened on Trade', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); });

  test('its result names it as History will and draws the split chosen on the ticket', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [320, 390, 480]) {
      await page.setViewportSize({ width, height: 844 });
      await open(page);
      await expect(page.getByRole('heading', { name: 'Opened ETH Long', exact: true })).toBeVisible();
      const row = source(page).locator('..');
      await expect(row).toContainText('ETH Long · #4242');
      await expect(row).toContainText('2.8× target');
      // The bar is the ticket's split at the reviewed target, in the row's colours.
      expect(share(await source(page).evaluate((node) => (node as HTMLElement).style.getPropertyValue('--debt-share')))).toBeCloseTo(CHOSEN_SHARE, 6);
      const card = (await page.locator('.trade-ticket').boundingBox())!;
      const bar = (await source(page).boundingBox())!;
      expect(bar.width, `${width}px`).toBeGreaterThan(card.width * 0.8);
      expect(bar.x).toBeGreaterThanOrEqual(card.x);
      expect(bar.x + bar.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${width}px`).toBeLessThanOrEqual(0);
      // The identity and target share one line.
      expect((await page.locator('[data-position-born-source]').locator('xpath=preceding-sibling::p').boundingBox())!.height, `${width}px`).toBeLessThan(30);
    }
  });

  for (const width of [390, 1280]) test(`View position opens compact management without animating an invisible split at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 800 ? 900 : 844 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page);
    await expect(source(page)).toBeVisible();
    await viewPosition(page).click();
    await expect(page).toHaveURL(/\/positions\?position=ETH%3Along%3A4242$/);
    await expect(details(page)).toBeVisible();
    await expect.poll(async () => (await probe(page))?.finished ?? 0).toBe(1);
    const { calls, ready } = (await probe(page))!;
    // One transition, requested with the chosen split named after its position.
    expect(calls).toHaveLength(1);
    expect(ready).toBe(0);
    expect(calls[0].sourceName).toBe(NAME);
    expect(share(calls[0].sourceShare)).toBeCloseTo(CHOSEN_SHARE, 6);
    // The compact destination has no visible split; the transition skips while
    // navigation and the confirmed figures still reach the selected position.
    expect(calls[0].atResolve).toMatchObject({ url: '/positions?position=ETH%3Along%3A4242', targetKey: KEY, targetName: null, targetVisible: false, born: false, sourceInDocument: false });
    expect(share(calls[0].atResolve!.targetShare)).toBeCloseTo(CONFIRMED_SHARE, 5);
    // No transition name is left on the hidden target.
    const split = details(page).locator('[data-position-split]');
    await expect.poll(() => split.evaluate((node) => (node as HTMLElement).style.viewTransitionName)).toBe('');
    await expect(page.getByRole('heading', { name: 'ETH Long · #4242', exact: true })).toBeVisible();
  });

  test('reduced motion opens the position without a transition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await viewPosition(page).click();
    await expect(details(page)).toBeVisible();
    await expect(page).toHaveURL(/\/positions\?position=ETH%3Along%3A4242/);
    expect((await probe(page))!.calls).toHaveLength(0);
  });

  test('without the View Transitions API the pages simply swap', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page, { api: false });
    expect(await page.evaluate(() => typeof (document as Document & { startViewTransition?: unknown }).startViewTransition)).toBe('undefined');
    await viewPosition(page).click();
    await expect(details(page)).toBeVisible();
    await expect(details(page).locator('[data-position-split]')).not.toHaveAttribute('data-born', '');
    expect(errors).toEqual([]);
  });

  test('a position the chain has not returned yet opens from its receipt, then in full', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page, { readable: false });
    // The result still names it and draws the choice; the page has no read to land on.
    await expect(page.getByRole('heading', { name: 'Opened ETH Long', exact: true })).toBeVisible();
    await viewPosition(page).click();
    await expect(page).toHaveURL(/\/positions\?position=ETH%3Along%3A4242/);
    // The receipt's row, without invented figures.
    const syncing = page.locator(`[data-confirmed-position-key="${KEY}"]`);
    await expect(syncing).toContainText('Checking confirmed position details…');
    await expect(syncing.locator('[data-position-split]')).toHaveCount(0);
    expect((await probe(page))!.calls).toHaveLength(0);
    // Once the chain returns it, the link opens the position with its confirmed split.
    await page.evaluate(() => (window as unknown as { __positionBorn: { makeReadable: () => void } }).__positionBorn.makeReadable());
    await expect(details(page)).toBeVisible();
    expect(share(await details(page).locator('[data-position-split]').evaluate((node) => (node as HTMLElement).style.getPropertyValue('--debt-share')))).toBeCloseTo(CONFIRMED_SHARE, 5);
  });

  test('closing a position offers View positions and keeps the authenticated wallet in-app', async ({ page }) => {
    const documentRequests: string[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.resourceType() === 'document') documentRequests.push(new URL(request.url()).pathname);
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, { closedPosition: true });
    await expect(page.getByRole('heading', { name: 'Position closed', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View positions', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View positions', exact: true }).click();
    await expect(page).toHaveURL('http://lab.test/positions');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __positionBorn: { path: string } }).__positionBorn.path)).toBe('/positions');
    expect(await page.evaluate(() => {
      const wallet = (window as unknown as { __positionBorn: { wallet: { authenticated: boolean; address: string } } }).__positionBorn.wallet;
      return { authenticated: wallet.authenticated, address: wallet.address };
    })).toEqual({ authenticated: true, address: '0x930f0000000000000000000000000000000098b9' });
    expect(await page.evaluate(() => (window as unknown as { __positionBorn: { navigations: string[] } }).__positionBorn.navigations)).toEqual(['/positions']);
    expect(documentRequests).toEqual(['/trade']);
  });
});

test('screenshots: the transition as a filmstrip, and the result and the landed position in dark appearance', async ({ page }) => {
  test.skip(!shotsDir, 'set BORN_SHOTS_DIR to keep the filmstrip and screenshots');
  mkdirSync(shotsDir!, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // The filmstrip: the transition's animations held at each frame's time.
  await open(page, { theme: 'dark' });
  await page.waitForTimeout(1_400);
  await page.evaluate(() => { (window as unknown as { __bornPause: boolean }).__bornPause = true; });
  await viewPosition(page).click();
  await expect.poll(async () => (await probe(page))?.ready ?? 0).toBe(1);
  for (const time of [0, 120, 240, 400]) {
    await page.evaluate((at) => document.getAnimations().forEach((animation) => { animation.currentTime = at; }), time);
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await page.screenshot({ path: resolve(shotsDir!, `born-dark-390-${String(time).padStart(3, '0')}ms.png`) });
  }
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
  await expect.poll(async () => (await probe(page))?.finished ?? 0).toBe(1);

  for (const [theme, width] of [['dark', 390], ['dark', 320]] as const) {
    await page.setViewportSize({ width, height: 844 });
    await open(page, { theme });
    await page.waitForTimeout(1_400);
    await page.screenshot({ path: resolve(shotsDir!, `born-${theme}-${width}-result.png`) });
    await viewPosition(page).click();
    await expect(details(page)).toBeVisible();
    await expect.poll(async () => (await probe(page))?.finished ?? 0).toBe(1);
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(shotsDir!, `born-${theme}-${width}-position.png`) });
  }
});
