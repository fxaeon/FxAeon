import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { enlargeFormText, expectFormMetricRows } from '../harness/form-metric-geometry';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }> };
const src = resolve(root, 'apps/mini-app/src');
const entry = resolve(root, 'apps/mini-app/e2e/harness/borrow-selection-entry.tsx');
const sdkPackage = require.resolve('@aladdindao/fx-sdk', { paths: [resolve(root, 'apps/mini-app')] });

const mocks: Record<string, string> = {
  // Selection/funding/sensitivity are exercised here; public product explainers
  // have built-route coverage and must not start unrelated pool/oracle reads.
  '@/components/ProductSections': `export const BorrowSections = () => null;`,

  // The settings gear links to Settings and closes with the router; the harness has neither Next's
  // build-time env nor a mounted app router.
  'next/link': `import React from 'react'; export default ({ href, children, prefetch, scroll, replace, ...props }) => <a href={typeof href === 'string' ? href : '#'} {...props}>{children}</a>;`,
  'next/navigation': `export const useRouter = () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }); export const usePathname = () => '/borrow'; export const useSearchParams = () => new URLSearchParams();`,
  '@/components/ui': `import React from 'react'; export const AppShell = ({children}) => <main>{children}</main>;`,
  '@/components/TokenIcon': `import React from 'react'; export default () => <span />; export const ChainIcon = () => <span aria-hidden="true" />;`,
  '@/components/ConnectWalletButton': `import React from 'react'; export default ({children}) => <button>{children}</button>;`,
  '@/components/ProductUI': `import React from 'react'; export const MetricRows = ({rows}) => <div>{rows.map((row) => <div key={row.label}>{row.label}: {row.value}</div>)}</div>; export const PageHeading = ({title}) => <h1>{title}</h1>; export const ProductNav = ({current}) => <nav aria-label="Borrow product navigation"><button type="button" aria-current={current === 'save' ? 'page' : undefined}>fxSAVE</button><button type="button" aria-current={current === 'borrow' ? 'page' : undefined}>Borrow fxUSD</button></nav>; export const ProductSurface = ({children, ...props}) => <section {...props}>{children}</section>; export const StatusNotice = ({title, children}) => <div role="status">{title} {children}</div>;`,
  '@/lib/displayPrices': `export const freshDisplayPrices = () => globalThis.__borrowHarness.prices ?? {};`,
  '@/lib/fx/nativeMax': `export const calculateVerifiedNativeMax = (input) => globalThis.__borrowHarness.maxRequests ? new Promise((resolve,reject) => globalThis.__borrowHarness.maxRequests.push({balanceWei:input.balanceWei,resolve:(amountWei)=>resolve({amountWei,validUntil:Date.now()+15000}),reject})) : Promise.resolve({amountWei:1n,validUntil:Date.now()+15000});`,
  '@/lib/fx/gasCost': `export const routeGasCostCache = { getOrRefresh: async () => ({}) };`,
  '@/lib/fx': `export const estimatePlannedRouteCost = async () => ({}); export async function planDepositAndMint(input){ globalThis.__borrowHarness.lastPlan = input; globalThis.__borrowHarness.plannerCount += 1; return {}; } export async function planRepayAndWithdraw(){ globalThis.__borrowHarness.plannerCount += 1; return {}; } export const restoreSignatureRequiredDraftFromSearch = () => undefined; export const signatureDraftIdFromSearch = () => undefined; export const assertConfiguredPublicClientChain = () => {}; export const assertWalletAddress = () => {}; export const assertPublicClientChain = () => {}; export const getEthereumClient = () => ({}); export const getFxReadFacade = () => ({}); export const fallbackDebtRatioRange = () => ({ min: 25600000000000000n, max: 855000000000000000n, source: 'fallback' }); export const readDebtRatioRange = async () => { if (globalThis.__borrowLimitUnavailable) throw new Error('Pool read unavailable'); if (globalThis.__borrowLimitPending) return new Promise(resolve => { globalThis.__resolveBorrowLimit = resolve; }); return { min: 25600000000000000n, max: globalThis.__borrowLimitInvalid ? 1000000000000000000n : 855000000000000000n, source: 'live' }; };`,
  '@/lib/fx/readFacade': `export const FX_READ_DEADLINE_MS = 1; export const withReadDeadline = (promise) => promise;`,
  '@/lib/fx/policy': `export const positionPoolAddress = () => '0x0000000000000000000000000000000000000001';`,
  '@/components/ActionReview': `import React from 'react'; import { usePrivyWallet } from '@/lib/wallet'; export const ActionReview = ({planBuilder, label, editor, operationLabel, onStageChange, blocker, decisionBefore}) => { const wallet = usePrivyWallet(); const [reviewing,setReviewing] = React.useState(false); if (reviewing) return <section aria-label="Existing position borrow review"><h2>{operationLabel}</h2><p>ETH long · existing position #17</p><button type="button" onClick={() => onStageChange?.('result')}>Complete borrowing</button><button type="button" onClick={() => { setReviewing(false); onStageChange?.('input'); }}>Edit</button><button type="button">Confirm borrowing</button></section>; return <>{editor}<ul data-decision-before>{(decisionBefore ?? []).map((fact) => <li key={fact.label}>{fact.label}: {fact.value}</li>)}</ul><button type="button" disabled={Boolean(blocker)} aria-label={label} data-blocker={blocker ?? undefined} onClick={async () => { globalThis.__borrowHarness.reviewAttemptCount += 1; if (globalThis.__borrowHarness.exerciseReviewStage && label === 'Review borrowing') { setReviewing(true); onStageChange?.('executing'); return; } if (planBuilder) { const route = await planBuilder(); if (route) await wallet.sendTransaction({}); } }}>{label}</button></>; };`,
  '@/components/ProtocolPositionProvider': `export const useProtocolPositions = () => globalThis.__borrowHarness.shared;`,
  '@/components/ProtocolPositionCard': `import React from 'react'; export const ProtocolPositionNotice = ({status}) => status === 'unavailable' ? <div role="status">Positions are temporarily unavailable</div> : null;`,
  '@/components/ConfirmedPositionCards': `export const ConfirmedPositionCards = () => null;`,
  '@/components/ProtocolForm': `import React from 'react'; export const AmountField = ({label, value, onChange, tokenSelector, hint, showMax, maxAmount, maxLabel, onMax, maxPending, constraintError, showPercentages}) => <div>{onMax && <button type="button" aria-label="Calculate 100% after gas reserve" disabled={maxPending} onClick={onMax}>Max</button>}{onMax && showPercentages && <button type="button" onClick={() => onChange("0.00018032")}>25%</button>}{constraintError && <p role="alert">{constraintError}</p>}{showMax && maxAmount && <button type="button" aria-label={maxLabel} onClick={() => onChange(maxAmount)}>Max</button>}<label>{label}<input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} /></label>{hint && <p data-hint={label}>{hint}</p>}{tokenSelector}</div>; export const Segmented = ({options, value, onChange, ariaLabel}) => <div role="group" aria-label={ariaLabel}>{options.map((option) => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>; export const TokenSelect = ({label, options, value, onChange}) => <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((item) => <option key={item} value={item}>{item}</option>)}</select>; export const useWalletTokenBalances = () => ({ balances: globalThis.__borrowHarness.balances ?? {}, status: 'ready', refresh: async () => {} });`,
  '@/components/PriceProvider': `export const useUsdPrices = () => ({ status: 'unavailable', prices: {}, refreshing: globalThis.__borrowHarness.pricesPending ?? false }); export const useLiveMarketQuote = () => ({ quote: null, status: 'unavailable', isFresh: false });`,
  '@/lib/wallet': `export const usePrivyWallet = () => ({ ...globalThis.__borrowHarness.wallet, isEmbedded: false, wallets: [], sendTransaction: async () => { globalThis.__borrowHarness.walletRequestCount += 1; } });`,
  '@/lib/prices': `export const priceKeyForSymbol = (symbol) => ({ eth: 'ETH', weth: 'WETH', steth: 'stETH', wsteth: 'wstETH', wbtc: 'WBTC', fxusd: 'fxUSD' })[String(symbol).toLowerCase()] ?? null; export const formatUsdPrice = () => '—';`,
  '@/lib/transactionState': `export const resetTransactionAmounts = () => ({deposit:'',mint:'',repay:'',withdraw:''});`,
  '@aladdindao/fx-sdk': `export const tokens = { eth: '0x0000000000000000000000000000000000000001', weth: '0x0000000000000000000000000000000000000002', stETH: '0x0000000000000000000000000000000000000003', wstETH: '0x0000000000000000000000000000000000000004', WBTC: '0x0000000000000000000000000000000000000005', usdc: '0x0000000000000000000000000000000000000006', usdt: '0x0000000000000000000000000000000000000007', fxUSD: '0x0000000000000000000000000000000000000008', fxUSDBasePool: '0x0000000000000000000000000000000000000009' };`,
};
// Exercise the real foreground/freshness hook with deterministic public reads.
mocks['@/lib/fx/borrowFunding'] = `import { positionPoolAddress } from ${JSON.stringify(resolve(src, 'lib/fx/policy.ts'))}; export { borrowFundingDisplay, formatBorrowFundingApr, formatBorrowFundingEightHour, borrowFundingIsFresh, BORROW_FUNDING_MAX_AGE_MS } from ${JSON.stringify(resolve(src, 'lib/fx/borrowFunding.ts'))}; export async function readBorrowFundingRate(market) { globalThis.__borrowFundingReads = (globalThis.__borrowFundingReads ?? 0) + 1; if (globalThis.__borrowFundingUnavailable) throw new Error('Funding unavailable'); const ratio = globalThis.__borrowFundingRatio ?? 0n; const rate = { market, pool: positionPoolAddress(market, 'long'), ratio, netRatio: ratio, readAt: Date.now() }; if (globalThis.__borrowFundingPending) return new Promise(resolve => { globalThis.__resolveBorrowFunding = () => resolve(rate); }); return rate; }`;
// History is illustrative and independent of wallet/rate-read availability.
// This selection fixture must never contact the public funding index.
mocks['@/lib/fx/borrowFundingHistory'] = `export async function readBorrowFundingHistory(market, {range = '1Y'} = {}) { const endAt = Math.floor(Date.now() / 1000); const days = {'1M':30,'3M':90,'6M':180,'1Y':365,All:450}[range]; const startAt = endAt - days * 86400; const averageRatio = range === '1M' ? 35000000000000000n : 52500000000000000n; return { market, startAt, endAt, indexedAt: endAt, averageRatio, snapshots: [{timestamp:startAt,ratio:averageRatio},{timestamp:endAt,ratio:70000000000000000n}] }; }`;

// The real post-confirmation presentation imports receipt proof helpers. Keep
// their SDK metadata intact, but fail closed if this selection-only fixture
// accidentally starts an SDK read instead of using the supplied snapshots.
mocks['@aladdindao/fx-sdk'] += `
  export { BRIDGE_OFT_BY_TOKEN } from ${JSON.stringify(sdkPackage)};
  export class FxSdk { constructor() { throw new Error('Live SDK reads are outside the borrow selection fixture'); } }
`;

async function buildHarness(styled = false): Promise<{ script: string; css: string }> {
  type BuildApi = { onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void; onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void };
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts', ...(styled ? { '.module.css': 'local-css' } : {}) }, absWorkingDir: root,
    ...(styled ? { outdir: 'borrow-styled-fixture' } : {}),
    plugins: [{ name: 'borrow-browser-harness', setup(build: BuildApi) {
      build.onResolve({ filter: /^\.\/borrowFunding$/ }, () => ({ path: '@/lib/fx/borrowFunding', namespace: 'mock' }));
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, (args: { path: string }) => ({ path: args.path, namespace: 'mock' }));
      build.onResolve({ filter: /^@\// }, (args: { path: string }) => {
        if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
        const candidate = resolve(src, args.path.slice(2));
        if (args.path.endsWith('.module.css')) return { path: candidate, ...(styled ? {} : { namespace: 'empty-css' }) };
        if (existsSync(candidate)) return { path: candidate };
        for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
        return { path: candidate };
      });
      build.onResolve({ filter: /^@aladdindao\/fx-sdk$/ }, () => ({ path: '@aladdindao/fx-sdk', namespace: 'mock' }));
      build.onResolve({ filter: /^\.\/(directPositionDiscovery|canonicalPositionReader)$/ }, (args: { path: string }) => ({ path: args.path, namespace: 'position-read-mock' }));
      build.onLoad({ filter: /.*/, namespace: 'position-read-mock' }, (args: { path: string }) => ({ contents: args.path === './directPositionDiscovery' ? 'export const discoverDirectWalletPositionIds = async () => []; export const readDirectWalletPositionCount = async () => 0n; export const readDirectWalletPositionCounts = ({ groups }) => groups.map(() => Promise.resolve(0n));' : 'export const readCanonicalPositionContext = async () => ({}); export const readCanonicalPositionInfo = async () => ({});', loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, (args: { path: string }) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
      build.onResolve({ filter: /\.module\.css$/ }, (args: { path: string; resolveDir?: string }) => ({ path: resolve(args.resolveDir ?? root, args.path), ...(styled ? {} : { namespace: 'empty-css' }) }));
      build.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: 'export default {};', loader: 'js' }));
    } }],
  });
  let css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  if (styled) {
    const appRequire = createRequire(resolve(root, 'apps/mini-app/package.json'));
    const globals = await appRequire('postcss')([appRequire('tailwindcss')({ config: resolve(root, 'apps/mini-app/tailwind.config.js') }), appRequire('autoprefixer')()])
      .process(readFileSync(resolve(src, 'app/globals.css'), 'utf8'), { from: resolve(src, 'app/globals.css') });
    const font = readFileSync(resolve(root, 'apps/mini-app/e2e/harness/assets/inter-latin.woff2')).toString('base64');
    css = `${globals.css}\n${css}\n@font-face{font-family:BorrowFixtureInter;src:url(data:font/woff2;base64,${font});font-weight:100 900}:root{--font-sans:BorrowFixtureInter}body{font-family:BorrowFixtureInter,system-ui,sans-serif}`;
  }
  return { script: (result.outputFiles.find(file => file.path.endsWith('.js')) ?? result.outputFiles[0]).text, css };
}

let bundle = '';
test.beforeAll(async () => { bundle = (await buildHarness()).script; });

type BorrowHarnessControl = {
  wallet: { ready: boolean; authenticated: boolean; address?: string; chainId: number; connectionVersion: number };
  shared: { walletAddress: string | null; positions: object[]; status: string; failedGroups: Array<{ market: string; side: string; reason: unknown }>; lastVerifiedAt: number | null; [key: string]: unknown };
  balances?: Record<string, { status: string; amount: string }>;
  prices?: Record<string, number>;
  pricesPending?: boolean;
  plannerCount: number;
  walletRequestCount: number;
  reviewAttemptCount: number;
  exerciseReviewStage: boolean;
  rerender?: () => void;
};

async function mount(page: import('@playwright/test').Page, { limitUnavailable = false, limitPending = false, limitInvalid = false, fundingUnavailable = false, fundingPending = false, fundingRatio = 0n } = {}) {
  await page.setContent('<div id="root"></div>');
  await page.evaluate(options => Object.assign(window, { __borrowLimitUnavailable: options.limitUnavailable, __borrowLimitPending: options.limitPending, __borrowLimitInvalid: options.limitInvalid, __borrowFundingUnavailable: options.fundingUnavailable, __borrowFundingPending: options.fundingPending, __borrowFundingRatio: options.fundingRatio }), { limitUnavailable, limitPending, limitInvalid, fundingUnavailable, fundingPending, fundingRatio });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Borrow', exact: true })).toBeVisible();
}

test('Borrow native Max starts on demand, clears oversized cold input, and preserves later percentage edits', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    globalThis.__borrowHarness.balances = { ETH: { status: 'ready', amount: '0.00072128' } };
    globalThis.__borrowHarness.maxRequests = [];
    globalThis.__borrowHarness.rerender?.();
  });
  const collateral = page.getByRole('textbox', { name: 'Collateral', exact: true });
  const max = page.getByRole('button', { name: 'Calculate 100% after gas reserve' });
  await collateral.fill('1');
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => globalThis.__borrowHarness.maxRequests?.length)).toBe(0);
  await max.click();
  await expect.poll(() => page.evaluate(() => globalThis.__borrowHarness.maxRequests?.length)).toBe(1);
  await expect(collateral).toHaveValue('');
  await expect(max).toBeDisabled();
  await page.evaluate(() => globalThis.__borrowHarness.maxRequests?.[0].reject(new Error('current gas estimate is unavailable')));
  await expect(collateral).toHaveValue('');
  await expect(page.getByRole('alert')).toHaveText('Current gas fees are unavailable. Try again shortly.');
  await max.click();
  await expect.poll(() => page.evaluate(() => globalThis.__borrowHarness.maxRequests?.length)).toBe(2);
  await page.getByRole('button', { name: '25%', exact: true }).click();
  await page.evaluate(() => globalThis.__borrowHarness.maxRequests?.[1].resolve(600_000_000_000_000n));
  await expect(collateral).toHaveValue('0.00018032');
  await max.click();
  await expect(collateral).toHaveValue('0.0006');
  expect(await page.evaluate(() => globalThis.__borrowHarness.maxRequests?.length)).toBe(2);
});

async function changeSnapshot(page: import('@playwright/test').Page, update: (harness: BorrowHarnessControl) => void) {
  await page.evaluate((callbackSource) => {
    const harness = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    (0, eval)(`(${callbackSource})(globalThis.__borrowHarness)`);
    harness.rerender?.();
  }, update.toString());
}

test('collateral sensitivity illustrates entered amounts without changing borrowing intent', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, harness => { harness.prices = { ETH: 2400, fxUSD: 1 }; });
  const sensitivity = page.getByRole('region', { name: 'Collateral sensitivity', exact: true });
  await expect(sensitivity).toHaveCount(0);
  await expect(sensitivity.getByRole('slider')).toHaveCount(0);
  await page.getByLabel('Collateral', { exact: true }).fill('1');
  await page.getByLabel('fxUSD to borrow', { exact: true }).fill('1200');
  await expect(sensitivity.getByText('50.00%', { exact: true })).toBeVisible();
  const slider = sensitivity.getByRole('slider', { name: 'Illustrated collateral value change' });
  await slider.fill('-20');
  await expect(sensitivity.getByText('62.50%', { exact: true })).toBeVisible();
  await expect(slider).toHaveAttribute('aria-valuetext', /−20% collateral value, 62.50% loan-to-value/);
  await expect(page.getByLabel('Collateral', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('fxUSD to borrow', { exact: true })).toHaveValue('1200');
  await page.getByLabel('fxUSD to borrow', { exact: true }).fill('');
  await expect(sensitivity).toHaveCount(0);
  await expect(sensitivity.getByRole('slider')).toHaveCount(0);
});

test('same-wallet disappearance removes the selected position and review action', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: /^Manage (ETH|BTC) position #/ }).first().click();
  await expect(page.getByText('ETH position #17')).toBeVisible();
  await page.getByRole('button', { name: 'Borrow more' }).click();
  await expect(page.getByRole('button', { name: 'Review borrowing' })).toBeVisible();

  await changeSnapshot(page, (harness) => {
    harness.shared = { ...harness.shared, positions: [], status: 'ready', failedGroups: [], lastVerifiedAt: Date.now() };
  });
  await expect(page.getByText('ETH position #17')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review borrowing' })).toHaveCount(0);
  const counters = await page.evaluate(() => {
    const h = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    return { planners: h.plannerCount, walletRequests: h.walletRequestCount };
  });
  expect(counters).toEqual({ planners: 0, walletRequests: 0 });
});

test('positions return to the Borrow workspace without opening a manager or planning a transaction', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
  await expect(page.getByRole('heading', { name: 'Positions', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Manage ETH position #/ })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Borrow', exact: true }).click();
  await expect(page.getByLabel('Collateral', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Borrow fxUSD', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__borrowHarness.plannerCount)).toBe(0);
});

test('collateral and debt show dollar equivalents without guessing missing or stale values', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => { harness.prices = { ETH: 2400, fxUSD: 0.99 }; });
  await page.getByRole('button', { name: 'Your positions' }).click();
  const card = page.getByRole('button', { name: 'Manage ETH position #17', exact: true });
  await expect(card.getByText('100 fxUSD', { exact: true })).toBeVisible();
  await expect(card.locator('details, summary')).toHaveCount(0);
  await expect(card).toContainText('≈ $99.00');
  await expect(card).toContainText('2 stETH');
  await expect(card).toContainText('≈ $4,800.00');
  await card.click();
  const manager = page.getByRole('dialog', { name: 'ETH position #17', exact: true });
  await expect(manager.locator('summary')).toContainText('≈ $99.00');
  await manager.locator('summary').click();
  await expect(manager.locator('dl')).toContainText('2 stETH≈ $4,800.00');

  // Only the unavailable price is withheld; the token amounts remain readable.
  await changeSnapshot(page, (harness) => { harness.prices = { fxUSD: 0.99 }; });
  await expect(manager.getByLabel('Collateral value unavailable', { exact: true })).toHaveText('');
  await expect(manager.locator('summary')).toContainText('≈ $99.00');
  await expect(manager.locator('dl')).toContainText('2 stETH');

  // A failed position read cannot turn retained balances into a fresh valuation.
  await changeSnapshot(page, (harness) => {
    harness.prices = { ETH: 2400, fxUSD: 0.99 };
    harness.shared = { ...harness.shared, status: 'partial', failedGroups: [{ market: 'ETH', side: 'long', reason: 'read timeout' }] };
  });
  await expect(manager.locator('summary').getByLabel('Debt value unavailable', { exact: true })).toHaveText('');
  await expect(manager.locator('dl').getByLabel('Debt value unavailable', { exact: true })).toHaveText('');
  await expect(manager.getByLabel('Collateral value unavailable', { exact: true })).toHaveText('');
  await expect(manager.locator('summary')).not.toContainText('$0.00');
  expect(await page.evaluate(() => globalThis.__borrowHarness.walletRequestCount)).toBe(0);
});

test('borrowing cards reveal complete first prices together and keep cached information during refresh', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => { harness.pricesPending = true; harness.prices = { ETH: 2400 }; });
  await page.getByRole('button', { name: 'Your positions' }).click();
  const loading = page.getByRole('status', { name: 'Loading borrowing position', exact: true });
  const card = page.getByRole('button', { name: 'Manage ETH position #17', exact: true });
  await expect(loading).toHaveAttribute('aria-busy', 'true');
  await expect(card).toHaveCount(0);
  await expect(page.getByLabel('Debt value unavailable', { exact: true })).toHaveCount(0);
  await changeSnapshot(page, (harness) => { harness.prices = { ETH: 2400, fxUSD: 1 }; });
  await expect(card).toContainText('≈ $100.00');
  await expect(card).toContainText('≈ $4,800.00');
  await expect(loading).toHaveCount(0);
  // The in-flight refresh doesn't blank a complete, verified view.
  await changeSnapshot(page, (harness) => { harness.pricesPending = false; });
  await changeSnapshot(page, (harness) => { harness.pricesPending = true; });
  await expect(card).toBeVisible();
  await expect(loading).toHaveCount(0);
});

test('a failed first price read clears the skeleton and leaves unknown values blank', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => { harness.pricesPending = true; harness.prices = {}; });
  await page.getByRole('button', { name: 'Your positions' }).click();
  await expect(page.getByRole('status', { name: 'Loading borrowing position', exact: true })).toHaveAttribute('aria-busy', 'true');
  await changeSnapshot(page, (harness) => { harness.pricesPending = false; });
  const card = page.getByRole('button', { name: 'Manage ETH position #17', exact: true });
  await expect(card.getByText('100 fxUSD', { exact: true })).toBeVisible();
  await expect(card.locator('details, summary')).toHaveCount(0);
  await expect(card.getByLabel('Debt value unavailable', { exact: true })).toHaveText('');
  await expect(card).not.toContainText('$0.00');
});

test('new-position planning remains available while existing-position discovery is unavailable', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => {
    harness.shared = {
      ...harness.shared,
      positions: [],
      status: 'unavailable',
      failedGroups: [{ market: 'ETH', side: 'long', reason: 'read timeout' }],
      lastVerifiedAt: null,
    };
  });
  const workspace = page.getByTestId('borrow-workspace-card');
  await expect(workspace.getByText('Positions are temporarily unavailable')).toHaveCount(0);
  await workspace.getByLabel('Collateral', { exact: true }).fill('1');
  await workspace.getByLabel('fxUSD to borrow').fill('10');
  await workspace.getByRole('button', { name: 'Review borrowing' }).click();
  const counters = await page.evaluate(() => {
    const h = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    return { planners: h.plannerCount, walletRequests: h.walletRequestCount };
  });
  expect(counters).toEqual({ planners: 1, walletRequests: 1 });
  await workspace.getByRole('button', { name: 'Your positions' }).click();
  await expect(workspace.getByRole('status')).toContainText('Couldn’t load positions');
});

test('mounted Borrow page prevents review planning and wallet requests when selection becomes stale', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: /^Manage (ETH|BTC) position #/ }).first().click();
  await expect(page.getByText('ETH position #17')).toBeVisible();
  await page.getByRole('button', { name: 'Borrow more' }).click();
  await expect(page.getByRole('button', { name: 'Review borrowing' })).toBeVisible();
  await page.getByLabel('Additional fxUSD to borrow').fill('10');
  const review = page.getByRole('button', { name: 'Review borrowing' });
  await expect(review).toBeVisible();
  await review.click();
  const freshCounters = await page.evaluate(() => {
    const h = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    return { attempts: h.reviewAttemptCount, planners: h.plannerCount, walletRequests: h.walletRequestCount };
  });
  expect(freshCounters).toEqual({ attempts: 1, planners: 1, walletRequests: 1 });

  await changeSnapshot(page, (harness) => { harness.shared = { ...harness.shared, status: 'partial', failedGroups: [{ market: 'ETH', side: 'long', reason: 'read timeout' }] }; });
  await review.click();
  const counters = await page.evaluate(() => {
    const h = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    return { attempts: h.reviewAttemptCount, planners: h.plannerCount, walletRequests: h.walletRequestCount };
  });
  expect(counters).toEqual({ attempts: 2, planners: 1, walletRequests: 1 });
});

test('mounted Borrow page removes a selection when its provider snapshot changes accounts', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: /^Manage (ETH|BTC) position #/ }).first().click();
  await expect(page.getByText('ETH position #17')).toBeVisible();
  await changeSnapshot(page, (harness) => {
    harness.wallet = { ...harness.wallet, address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', connectionVersion: 2 };
  });
  await expect(page.getByText('ETH position #17')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'fxUSD to borrow', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Collateral', exact: true })).toBeVisible();
  const counters = await page.evaluate(() => {
    const h = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    return { planners: h.plannerCount, walletRequests: h.walletRequestCount };
  });
  expect(counters).toEqual({ planners: 0, walletRequests: 0 });
});


test('one collateral picker plans both ETH and BTC with collateral above borrowing', async ({ page }) => {
  await mount(page);
  await expect(page.getByRole('group', { name: 'Collateral market' })).toHaveCount(0);
  // The borrowing limit is computed from collateral, so collateral is asked for first.
  const fields = page.getByRole('textbox');
  await expect(fields.nth(0)).toHaveAttribute('aria-label', 'Collateral');
  await expect(fields.nth(1)).toHaveAttribute('aria-label', 'fxUSD to borrow');
  const picker = page.getByLabel('Collateral asset');
  await expect(picker.locator('option[value="WBTC"]')).toHaveCount(1);
  for (const [asset, market] of [['WBTC', 'BTC'], ['ETH', 'ETH']]) {
    await picker.selectOption(asset);
    await page.getByLabel('fxUSD to borrow').fill('10');
    await page.getByLabel('Collateral', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Review borrowing' }).click();
    const plan = await page.evaluate(() => (globalThis as typeof globalThis & { __borrowHarness: { lastPlan: { market: string; depositTokenAddress: string } } }).__borrowHarness.lastPlan);
    expect(plan.market).toBe(market);
    expect(plan.depositTokenAddress).toBe(asset === 'WBTC' ? '0x0000000000000000000000000000000000000005' : '0x0000000000000000000000000000000000000001');
  }
});

test('existing ETH-long management keeps review and Edit in the same dialog', async ({ page }) => {
  await mount(page);
  await page.setViewportSize({ width: 393, height: 852 });
  const borrowOverview = page.getByRole('region', { name: 'fxUSD borrowing overview', exact: true });
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: /^Manage (ETH|BTC) position #/ }).first().click();
  await expect(page.getByText('ETH position #17')).toBeVisible();
  await expect(borrowOverview).toHaveCount(0);
  await page.getByRole('button', { name: 'Borrow more' }).click();
  await page.getByLabel('Additional fxUSD to borrow').fill('1');
  await page.evaluate(() => {
    const harness = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    harness.exerciseReviewStage = true;
  });

  await page.getByRole('button', { name: 'Review borrowing' }).click();
  const review = page.getByRole('region', { name: 'Existing position borrow review' });
  await expect(review).toBeVisible();
  await expect(review).toContainText('Update collateral position');
  await expect(review).toContainText('ETH long · existing position #17');
  await expect(borrowOverview).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Manage collateral position', exact: true })).toHaveCount(0);
  await expect(review.getByRole('button', { name: 'Confirm borrowing', exact: true })).toBeVisible();

  await review.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(borrowOverview).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Manage collateral position', exact: true })).toBeVisible();
  await expect(page.getByLabel('Additional fxUSD to borrow')).toHaveValue('1');
});

test('account changes preserve the active parent-page review until Edit', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: /^Manage (ETH|BTC) position #/ }).first().click();
  await page.getByRole('button', { name: 'Borrow more' }).click();
  await page.getByLabel('Additional fxUSD to borrow').fill('80');
  await page.evaluate(() => {
    const harness = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    harness.exerciseReviewStage = true;
  });
  await page.getByRole('button', { name: 'Review borrowing' }).click();
  const review = page.getByRole('region', { name: 'Existing position borrow review' });
  await expect(review).toBeVisible();

  await changeSnapshot(page, (harness) => {
    const accountB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    harness.wallet = { ...harness.wallet, address: accountB, connectionVersion: harness.wallet.connectionVersion + 1 };
    harness.shared = { ...harness.shared, walletAddress: accountB, positions: [] };
  });
  await expect(review).toBeVisible();
  await expect(review.getByRole('button', { name: 'Confirm borrowing' })).toBeVisible();

  await review.getByRole('button', { name: 'Complete borrowing' }).click();
  await expect(review).toBeVisible();

  await review.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Collateral', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('fxUSD to borrow')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Review borrowing' })).toBeVisible();
});


test('optional collateral treats blank and exact zero equally without skipping positive amount checks', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: /^Manage (ETH|BTC) position #/ }).first().click();
  await page.getByRole('button', { name: 'Borrow more' }).click();
  await page.getByRole('button', { name: 'Add collateral and borrow together' }).click();
  await page.getByLabel('Additional fxUSD to borrow').fill('10');
  const deposit = page.getByLabel('Collateral to add');
  const review = page.getByRole('button', { name: 'Review borrowing' });
  for (const balance of ['0', '5']) {
    await changeSnapshot(page, (harness) => { harness.balances = { ETH: { status: 'ready', amount: '0' } }; });
    if (balance === '5') await changeSnapshot(page, (harness) => { harness.balances = { ETH: { status: 'ready', amount: '5' } }; });
    for (const amount of ['', '0', '0.000000000000000000']) {
      await deposit.fill(amount);
      await expect(review).toBeEnabled();
      await review.click();
      const planned = await page.evaluate(() => {
        const h = globalThis as typeof globalThis & { __borrowHarness: { lastPlan: { depositAmount: bigint; mintAmount: bigint } } };
        return { deposit: h.__borrowHarness.lastPlan.depositAmount.toString(), borrow: h.__borrowHarness.lastPlan.mintAmount.toString() };
      });
      expect(planned).toEqual({ deposit: '0', borrow: '10000000000000000000' });
    }
  }
  for (const [amount, reason] of [['-1', 'Enter a valid amount'], ['0.0000000000000000001', 'Enter a valid amount'], ['1.2.3', 'Enter a valid amount'], ['6', 'Insufficient ETH']]) {
    await deposit.fill(amount);
    await expect(review).toBeDisabled();
    await expect(review).toHaveAttribute('data-blocker', reason);
  }
  await deposit.fill('1');
  await expect(review).toBeEnabled();
  await changeSnapshot(page, (harness) => { harness.balances = { ETH: { status: 'ready', amount: '0' } }; });
  await expect(review).toBeDisabled();
  await expect(review).toHaveAttribute('data-blocker', 'No ETH available');
  await deposit.fill('0');
  await page.getByLabel('Additional fxUSD to borrow').fill('0');
  await expect(review).toBeDisabled();
  await expect(review).toHaveAttribute('data-blocker', 'Enter an amount');
});

test('adding collateral alone names an empty wallet instead of asking for an amount', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: /^Manage (ETH|BTC) position #/ }).first().click();
  await page.getByRole('group', { name: 'Manage collateral position' }).getByRole('button', { name: 'Add collateral', exact: true }).click();
  // Collateral is the only amount here, so it is never optional.
  await expect(page.getByLabel('Additional fxUSD to borrow')).toHaveCount(0);
  await changeSnapshot(page, (harness) => { harness.balances = { ETH: { status: 'ready', amount: '0' } }; });
  const review = page.getByRole('button', { name: 'Review borrowing' });
  await expect(review).toBeDisabled();
  await expect(review).toHaveAttribute('data-blocker', 'No ETH available');
});

test('borrowing limits round toward safety: room rounds down, minimums and loan-to-value round up', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => { harness.prices = { ETH: 2400, fxUSD: 1 }; });
  const borrow = page.getByLabel('fxUSD to borrow', { exact: true });
  const review = page.getByRole('button', { name: 'Review borrowing' });
  await expect(page.locator('[data-hint="fxUSD to borrow"]')).toHaveCount(0);
  await page.getByLabel('Collateral', { exact: true }).fill('0.5');
  // $1,200 of collateral under the fixture's 85.5% pool maximum, less FxAeon's 2% margin: exactly 1,005.48 fxUSD.
  await expect(page.locator('[data-hint="fxUSD to borrow"]')).toHaveText('Up to 1,005.48 fxUSD with this collateral');
  await borrow.fill('1005.49');
  await expect(review).toHaveAttribute('data-blocker', 'Borrow at most 1,005.48 fxUSD');
  // The pool minimum is 31.3344 fxUSD: a floor rounds up, so the figure shown is always enough.
  await borrow.fill('1');
  await expect(review).toHaveAttribute('data-blocker', 'Borrow at least 31.34 fxUSD');
  await borrow.fill('31.34');
  await expect(review).toBeEnabled();
  // 800 of 1,200 is 66.66…%: the display states an upper bound, while the limit keeps its exact basis points.
  await borrow.fill('800');
  const meter = page.getByRole('meter', { name: 'Loan-to-value against the borrowing limit' });
  await expect(meter).toHaveAttribute('aria-valuetext', '≤ 66.67% of a 83.79% limit');
  await expect(meter).toHaveAttribute('aria-valuemax', '83.79');
  // No starting collateral means no prior ratio, rather than a fabricated zero LTV.
  await expect(page.getByRole('region', { name: 'Borrowing outcome' })).toContainText('No position → ≤ 66.67%');
});

test('disconnected new borrow calculates live capacity and LTV without zero-balance warnings or execution', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => {
    harness.wallet = { ready: true, authenticated: false, chainId: 1, connectionVersion: 2 };
    harness.shared = { ...harness.shared, walletAddress: null, positions: [], status: 'idle', failedGroups: [] };
    harness.balances = undefined;
    harness.prices = { ETH: 2400, fxUSD: 1 };
  });

  await page.getByLabel('Collateral', { exact: true }).fill('0.5');
  await expect(page.locator('[data-hint="fxUSD to borrow"]')).toHaveText('Up to 1,005.48 fxUSD with this collateral');
  await page.getByLabel('fxUSD to borrow', { exact: true }).fill('800');
  const meter = page.getByRole('meter', { name: 'Loan-to-value against the borrowing limit' });
  await expect(meter).toHaveAttribute('aria-valuetext', '≤ 66.67% of a 83.79% limit');
  await expect(page.getByRole('region', { name: 'Borrowing outcome' })).toContainText('No position → ≤ 66.67%');
  await expect(page.getByText(/Add ETH to your wallet to supply collateral/)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => ({ planners: globalThis.__borrowHarness.plannerCount, walletRequests: globalThis.__borrowHarness.walletRequestCount })))
    .toEqual({ planners: 0, walletRequests: 0 });
});

test('failed pool reads publish no guessed maximum and retry recovers after workspace navigation', async ({ page }) => {
  await mount(page, { limitUnavailable: true });
  await changeSnapshot(page, harness => { harness.prices = { ETH: 2378.088360665706, fxUSD: 1 }; });
  await page.getByLabel('Collateral', { exact: true }).fill('1');
  const borrow = page.getByLabel('fxUSD to borrow', { exact: true });
  await borrow.fill('1');
  await expect(page.locator('[data-hint="fxUSD to borrow"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use borrowing maximum' })).toHaveCount(0);
  await expect(page.getByRole('meter')).toHaveCount(0);
  // Manual input can still reach the authoritative SDK review; an old pool
  // minimum must not reject it before that review runs.
  await expect(page.getByRole('button', { name: 'Review borrowing' })).toBeEnabled();
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: 'New position', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry borrowing limit' })).toBeEnabled();
  await page.evaluate(() => Object.assign(window, { __borrowLimitUnavailable: false }));
  await page.getByRole('button', { name: 'Retry borrowing limit' }).click();
  await expect(page.getByRole('button', { name: 'Retry borrowing limit' })).toHaveCount(0);
  await page.getByLabel('Collateral', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Use borrowing maximum' }).click();
  const preset = await borrow.inputValue();
  expect(preset).toMatch(/^\d+\.\d{1,6}$/);
  await page.getByRole('button', { name: 'Review borrowing' }).click();
  // The visible preset itself, without hidden extra precision, is planned.
  expect(await page.evaluate(() => {
    const harness = (window as unknown as { __borrowHarness: { lastPlan: { mintAmount: bigint } } }).__borrowHarness;
    return harness.lastPlan.mintAmount.toString();
  })).toBe(BigInt(preset.replace('.', '').padEnd(preset.split('.')[0].length + 18, '0')).toString());
});

test('a live range with a one-hundred-percent ceiling is rejected instead of becoming a maximum', async ({ page }) => {
  await mount(page, { limitInvalid: true });
  await changeSnapshot(page, harness => { harness.prices = { ETH: 2400, fxUSD: 1 }; });
  await page.getByLabel('Collateral', { exact: true }).fill('1');
  await expect(page.locator('[data-hint="fxUSD to borrow"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use borrowing maximum' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry borrowing limit' })).toBeEnabled();
});

test('an unavailable limit does not guess withdrawals or block repayment and collateral additions', async ({ page }) => {
  await mount(page, { limitUnavailable: true });
  await changeSnapshot(page, harness => { harness.prices = { ETH: 2400, fxUSD: 1 }; });
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: /^Manage (ETH|BTC) position #/ }).first().click();
  const actions = page.getByRole('group', { name: 'Manage collateral position' });
  await actions.getByRole('button', { name: 'Withdraw collateral', exact: true }).click();
  await page.getByLabel('Collateral to withdraw', { exact: true }).fill('1.96');
  await expect(page.locator('[data-hint="Collateral to withdraw"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review position changes' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Retry borrowing limit' })).toBeEnabled();
  await actions.getByRole('button', { name: 'Repay debt', exact: true }).click();
  await page.getByLabel('Repay amount', { exact: true }).fill('1');
  await expect(page.getByRole('button', { name: 'Review repayment' })).toBeEnabled();
  await actions.getByRole('button', { name: 'Add collateral', exact: true }).click();
  await page.getByLabel('Collateral to add', { exact: true }).fill('0.1');
  await expect(page.getByRole('button', { name: 'Review borrowing' })).toBeEnabled();
});

test('a late pool read cannot publish the previous market limit', async ({ page }) => {
  await mount(page, { limitPending: true });
  await changeSnapshot(page, harness => { harness.prices = { ETH: 2400, WBTC: 100000, fxUSD: 1 }; });
  const loadingLimit = page.getByRole('status', { name: 'Loading pool maximum LTV' });
  await expect(loadingLimit).toHaveCount(1);
  await expect(loadingLimit).toHaveAttribute('aria-label', 'Loading pool maximum LTV');
  await page.evaluate(() => Object.assign(window, { __borrowLimitPending: false, __borrowLimitUnavailable: true }));
  await page.getByLabel('Collateral asset', { exact: true }).selectOption('WBTC');
  await expect(page.getByRole('button', { name: 'Retry borrowing limit' })).toBeVisible();
  await page.evaluate(() => {
    const resolve = (window as unknown as { __resolveBorrowLimit: (range: object) => void }).__resolveBorrowLimit;
    resolve({ min: 25600000000000000n, max: 855000000000000000n, source: 'live' });
  });
  await page.getByLabel('Collateral', { exact: true }).fill('1');
  await expect(page.locator('[data-hint="fxUSD to borrow"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use borrowing maximum' })).toHaveCount(0);
  await expect(page.getByRole('meter')).toHaveCount(0);
});

test('funding status distinguishes verified zero, positive and tiny positive charges', async ({ page }) => {
  await mount(page);
  const overview = page.getByRole('region', { name: 'fxUSD borrowing overview' });
  const metric = overview.locator('dl > div').filter({ hasText: 'Funding status' });
  await expect(metric.locator('dt')).toContainText('Funding status: OFF');
  await expect(metric.locator('dd')).toHaveText('0% / 8h');
  await expect(metric.getByRole('status')).toHaveCount(0);
  await expect(metric).not.toContainText('APR');
  const history = page.getByRole('region', { name: 'ETH borrow funding history', exact: true });
  await expect(history).toContainText('Funding status: OFF');
  await expect(history.locator('strong').first()).toHaveText('0% / 8h');
  await expect(history.getByRole('button', { name: 'About Funding status: OFF', exact: true })).toBeVisible();
  await page.evaluate(() => { Object.assign(window, { __borrowFundingRatio: 35000000000000000n }); window.dispatchEvent(new Event('online')); });
  await expect(metric.locator('dd')).toHaveText('≈ 0.0031% / 8h');
  await expect(metric.locator('dt')).toContainText('Funding status: ON');
  await expect(metric.getByRole('status')).toHaveCount(0);
  await page.evaluate(() => { Object.assign(window, { __borrowFundingRatio: 1n }); window.dispatchEvent(new Event('online')); });
  await expect(metric.locator('dd')).toHaveText('<0.0001% / 8h');
  await expect(metric.locator('dt')).toContainText('Funding status: ON');
});

test('failed and expired funding quotes never retain a zero rate, and foreground recovery rereads', async ({ page }) => {
  await page.clock.install();
  await mount(page, { fundingUnavailable: true });
  const metric = page.getByRole('region', { name: 'fxUSD borrowing overview' }).locator('dl > div').filter({ hasText: 'Funding status' });
  await expect(metric.locator('dd').getByRole('status', { name: 'Funding rate unavailable', exact: true })).toHaveText('');
  await expect(metric.locator('small[role="status"]')).toHaveCount(0);
  await metric.getByRole('button', { name: 'About Funding status', exact: true }).click();
  const verification = page.getByRole('link', { name: /View funding on f\(x\)/ });
  await expect(verification).toHaveAttribute('href', 'https://fx.aladdin.club/v2/fxmint');
  await expect(verification).toHaveAttribute('rel', 'noopener noreferrer');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { Object.assign(window, { __borrowFundingUnavailable: false }); window.dispatchEvent(new Event('online')); });
  await expect(metric.locator('dd')).toHaveText('0% / 8h');
  await expect(metric.locator('dt')).toContainText('Funding status: OFF');
  await page.evaluate(() => Object.assign(window, { __borrowFundingUnavailable: true }));
  await page.clock.fastForward(60_001);
  await expect(metric.locator('dd').getByRole('status', { name: 'Funding rate unavailable', exact: true })).toHaveText('');
  await expect(metric.locator('small[role="status"]')).toHaveCount(0);
  await page.evaluate(() => { Object.assign(window, { __borrowFundingUnavailable: false, __borrowFundingRatio: 10000000000000000n }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(metric.locator('dd')).toHaveText('≈ 0.0009% / 8h');
  await expect(metric.locator('dt')).toContainText('Funding status: ON');
});

test('a late funding response from the previous market cannot replace the current pool quote', async ({ page }) => {
  await mount(page, { fundingPending: true });
  const metric = page.getByRole('region', { name: 'fxUSD borrowing overview' }).locator('dl > div').filter({ hasText: 'Funding status' });
  const loadingRate = metric.getByRole('status', { name: 'Loading funding rate' });
  await expect(loadingRate).toHaveCount(1);
  await expect(loadingRate).toHaveAttribute('aria-label', 'Loading funding rate');
  await page.evaluate(() => Object.assign(window, { __borrowFundingPending: false, __borrowFundingRatio: 35000000000000000n }));
  await page.getByLabel('Collateral asset', { exact: true }).selectOption('WBTC');
  await expect(metric.locator('dd')).toHaveText('≈ 0.0031% / 8h');
  await page.evaluate(() => {
    (window as unknown as { __resolveBorrowFunding: () => void }).__resolveBorrowFunding();
  });
  await expect(metric.locator('dd')).toHaveText('≈ 0.0031% / 8h');
  await expect(metric.locator('dt')).toContainText('Funding status: ON');
});

test('pointer-selected funding sample remains selected when the chart receives focus', async ({ page }) => {
  await mount(page);
  const history = page.getByRole('region', { name: 'ETH borrow funding history', exact: true });
  const chart = history.getByRole('slider', { name: 'Explore historical funding charge' });
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAttribute('aria-valuenow', '2');

  // A pointerdown selects the first observation before the SVG receives focus.
  // Focus must preserve that sample rather than replacing it with the latest.
  await chart.click({ position: { x: 8, y: 80 } });
  await expect(chart).toHaveAttribute('aria-valuenow', '1');
  await expect(chart).toHaveAttribute('aria-valuetext', /per eight hours/);
});

test('the withdrawal field names how much collateral can leave before review', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => { harness.prices = { ETH: 2400, fxUSD: 1 }; });
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: /^Manage (ETH|BTC) position #/ }).first().click();
  await page.getByRole('group', { name: 'Manage collateral position' }).getByRole('button', { name: 'Withdraw collateral', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Withdraw collateral', exact: true })).toBeVisible();
  // 2 ETH at $2,400 holding 100 fxUSD of debt under the 83.79% limit: 1.9502… ETH can leave, shown rounded down.
  const hint = page.locator('[data-hint="Collateral to withdraw"]');
  await expect(hint).toHaveText('Up to 1.95 ETH at current prices');
  const review = page.getByRole('button', { name: 'Review position changes' });
  await page.getByLabel('Collateral to withdraw', { exact: true }).fill('1.96');
  await expect(review).toHaveAttribute('data-blocker', 'Withdraw at most 1.95 ETH');
  await page.getByLabel('Collateral to withdraw', { exact: true }).fill('1.95');
  await expect(review).toBeEnabled();
  // Without a price, omit the capacity hint instead of guessing.
  await changeSnapshot(page, (harness) => { harness.prices = {}; });
  await expect(hint).toHaveCount(0);
});

test('an existing position hands the review its loan-to-value against the live limit, rounded toward safety', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => { harness.prices = { ETH: 2400, fxUSD: 1 }; });
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: /^Manage (ETH|BTC) position #/ }).first().click();
  await page.getByRole('button', { name: 'Borrow more' }).click();
  const before = page.locator('[data-decision-before]');
  // 100 fxUSD against 2 ETH at $2,400 is 2.083…%, bounded above by 2.09%; the limit remains exactly 83.79%.
  await expect(before).toContainText('Loan-to-value: ≤ 2.09% of 83.79% limit');
  await expect(before).toContainText('Debt: 100 fxUSD');
  // Without a fresh price there is no verified figure to hand over.
  await changeSnapshot(page, (harness) => { harness.prices = {}; });
  await expect(before).not.toContainText('Loan-to-value');
  await expect(before).toContainText('Debt: 100 fxUSD');
  // A new position has nothing before it.
  await page.getByRole('button', { name: 'New position' }).click();
  await expect(before).toBeEmpty();
});

test('a single collateral asset is named, not offered as a one-row picker', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => {
    const btc = { market: 'BTC', side: 'long', stale: false, info: { positionId: 23, rawColls: 10n ** 8n, rawCollsDecimals: 8, rawCollsToken: 'WBTC', rawDebts: 100n * 10n ** 18n, rawDebtsDecimals: 18, rawDebtsToken: 'fxUSD', currentLeverage: 1.5 } };
    harness.shared = { ...harness.shared, positions: [btc] };
  });
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: /^Manage (ETH|BTC) position #/ }).first().click();
  await expect(page.getByText('BTC position #23')).toBeVisible();
  await page.getByRole('group', { name: 'Manage collateral position' }).getByRole('button', { name: 'Add collateral', exact: true }).click();
  await expect(page.getByLabel('Collateral to add', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Collateral asset', { exact: true })).toHaveCount(0);
  // A new position still chooses among every collateral asset.
  await page.getByRole('button', { name: 'New position' }).click();
  await expect(page.getByLabel('Collateral asset', { exact: true }).locator('option')).toHaveCount(5);
});

test('a new position still requires positive starting collateral', async ({ page }) => {
  await mount(page);
  await page.getByLabel('fxUSD to borrow').fill('10');
  const review = page.getByRole('button', { name: 'Review borrowing' });
  await expect(review).toBeDisabled();
  await page.getByLabel('Collateral', { exact: true }).fill('0');
  await expect(review).toBeDisabled();
  await page.getByLabel('Collateral', { exact: true }).fill('1');
  await expect(review).toBeEnabled();
});

test('borrowing previews debt separately from net proceeds and clears invalid or unpriced risk estimates', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => { harness.prices = { ETH: 2400, fxUSD: 1 }; });
  await page.getByLabel('Collateral', { exact: true }).fill('0.5');
  await page.getByLabel('fxUSD to borrow', { exact: true }).fill('800');
  const outcome = page.getByRole('region', { name: 'Borrowing outcome' });
  await expect(outcome).toContainText('Total debt0 fxUSD → 800 fxUSD');
  await expect(outcome).not.toContainText('Before conversion and fees');
  await expect(page.getByText('The amount borrowed is added to your debt. You receive fxUSD after the f(x) fee.')).toHaveCount(0);
  await expect(page.getByText('Collateral can be liquidated. Keep room below the borrowing limit.')).toHaveCount(0);
  await changeSnapshot(page, (harness) => { harness.prices = {}; });
  await expect(outcome).toContainText('800 fxUSD');
  await expect(outcome.getByRole('meter')).toHaveCount(0);
  await page.getByLabel('fxUSD to borrow', { exact: true }).fill('1.2.3');
  await expect(outcome).toHaveCount(0);
});

test('empty collateral guidance leads to receiving funds only for a verified zero balance', async ({ page }) => {
  await mount(page);
  const receive = page.getByRole('link', { name: 'Receive ETH', exact: true });
  await changeSnapshot(page, (harness) => { harness.balances = { ETH: { status: 'ready', amount: '0' } }; });
  await expect(receive).toHaveAttribute('href', '/qr');
  await changeSnapshot(page, (harness) => { harness.balances = { ETH: { status: 'loading', amount: '0' } }; });
  await expect(receive).toHaveCount(0);
});

test('repayment outcomes use the selected position debt and clear invalid input', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: /^Manage (ETH|BTC) position #/ }).first().click();
  await page.getByRole('group', { name: 'Manage collateral position' }).getByRole('button', { name: 'Repay debt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repay debt', exact: true })).toBeVisible();
  const outcome = page.getByRole('region', { name: 'Position changes' });
  await page.getByLabel('Repay amount', { exact: true }).fill('40');
  await expect(outcome).toContainText('Total debt100 fxUSD → 60 fxUSD');
  await expect(outcome).not.toContainText('Before conversion and fees');
  await page.getByLabel('Repay amount', { exact: true }).fill('all');
  await expect(outcome).toContainText('Total debt100 fxUSD → 0 fxUSD');
  await page.getByLabel('Repay amount', { exact: true }).fill('101');
  await expect(outcome).toHaveCount(0);
  await page.getByLabel('Repay amount', { exact: true }).fill('bad');
  await expect(outcome).toHaveCount(0);
});

test('styled Borrow outcome rows stay compact and wrap at 320px with 200% text', async ({ page }, info) => {
  test.setTimeout(60_000);
  // Default selection tests intentionally omit CSS. Only this geometry case
  // lazily compiles the genuine page/module styles over the same inert reads.
  const styled = await buildHarness(true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('about:blank');
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
    await page.addStyleTag({ content: styled.css });
    await page.addScriptTag({ content: styled.script });
    await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
    await changeSnapshot(page, harness => { harness.prices = { ETH: 2400, fxUSD: 1 }; });
    await page.getByLabel('Collateral', { exact: true }).fill('0.5');
    await page.getByLabel('fxUSD to borrow', { exact: true }).fill('800.123456789012345678');
    const outcome = page.getByRole('region', { name: 'Borrowing outcome', exact: true });
    const debt = outcome.locator('dl > div').filter({ hasText: 'Total debt' }).locator('strong');
    await expect(debt).toBeVisible();
    await expect(debt.locator('details, summary')).toHaveCount(0);
    await expect(debt).toContainText(/800\.12 fxUSD/);
    await expect(page.getByLabel('fxUSD to borrow', { exact: true })).toHaveValue('800.123456789012345678');
    await page.evaluate(() => document.fonts.ready);
    const rows = outcome.locator(':scope > dl > div');
    const heights = await expectFormMetricRows(rows);
    if (width === 390) expect(heights[0], 'Single-line borrowing terms use the compact rhythm').toBeLessThanOrEqual(36);
    const funding = page.getByRole('region', { name: 'fxUSD borrowing overview' }).locator('dl > div').filter({ hasText: 'Funding status' });
    await expect(funding.locator('dt')).toContainText('Funding status: OFF');
    await expect(funding.locator('dt span[class*="fundingStatusOff"]')).toHaveCount(1);
    await expect(funding).not.toContainText('APR');
    await page.screenshot({ path: info.outputPath(`borrow-funding-status-${width}.png`), animations: 'disabled' });
    await enlargeFormText(page);
    await expectFormMetricRows(rows);
    const history = page.getByRole('region', { name: 'ETH borrow funding history', exact: true });
    await expect(history.getByRole('slider', { name: 'Explore historical funding charge' })).toBeVisible();
    const periods = history.getByRole('group', { name: 'Funding history period' });
    await expect(periods.getByRole('button', { name: '1Y', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(history).toContainText('5.25%');
    await periods.getByRole('button', { name: '1M', exact: true }).click();
    await expect(periods.getByRole('button', { name: '1M', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(history).toContainText('3.5%');
    await expect(history).not.toContainText('5.25%');
    await periods.getByRole('button', { name: '1Y', exact: true }).click();
    await expect(history).toContainText('5.25%');
    const definitions = history.locator('[data-info-help-trigger]');
    await expect(definitions).toHaveCount(3);
    expect(await definitions.evaluateAll(controls => controls.map(control => control.getAttribute('aria-label')))).toEqual([
      'About Funding & costs', 'About Funding status: OFF', 'About Average cost APR',
    ]);
    for (const control of await definitions.all()) {
      await control.scrollIntoViewIfNeeded();
      const geometry = await control.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const overlaps = [...element.closest('section')!.querySelectorAll('[data-info-help-trigger]')].some(other => {
          if (other === element) return false;
          const box = other.getBoundingClientRect();
          return Math.min(rect.right, box.right) - Math.max(rect.left, box.left) > 1
            && Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top) > 1;
        });
        return { width: rect.width, height: rect.height, reachable: Boolean(hit && element.contains(hit)), overlaps };
      });
      expect(geometry).toEqual({ width: 24, height: 24, reachable: true, overlaps: false });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => globalThis.__borrowHarness.plannerCount)).toBe(0);
    expect(await page.evaluate(() => globalThis.__borrowHarness.walletRequestCount)).toBe(0);
  }
});
