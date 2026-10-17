import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const src = resolve(root, 'apps/mini-app/src');
const entry = resolve(root, 'apps/mini-app/e2e/harness/borrow-selection-entry.tsx');

const mocks: Record<string, string> = {
  // The settings gear links to Settings and closes with the router; the harness has neither Next's
  // build-time env nor a mounted app router.
  'next/link': `import React from 'react'; export default ({ href, children, prefetch, scroll, replace, ...props }) => <a href={typeof href === 'string' ? href : '#'} {...props}>{children}</a>;`,
  'next/navigation': `export const useRouter = () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }); export const usePathname = () => '/borrow'; export const useSearchParams = () => new URLSearchParams();`,
  '@/components/ui': `import React from 'react'; export const AppShell = ({children}) => <main>{children}</main>;`,
  '@/components/TokenIcon': `import React from 'react'; export default () => <span />; export const ChainIcon = () => <span aria-hidden="true" />;`,
  '@/components/ConnectWalletButton': `import React from 'react'; export default ({children}) => <button>{children}</button>;`,
  '@/components/ProductUI': `import React from 'react'; export const MetricRows = ({rows}) => <div>{rows.map((row) => <div key={row.label}>{row.label}: {row.value}</div>)}</div>; export const PageHeading = ({title}) => <h1>{title}</h1>; export const ProductNav = ({current}) => <nav aria-label="Borrow product navigation"><button type="button" aria-current={current === 'save' ? 'page' : undefined}>fxSAVE</button><button type="button" aria-current={current === 'borrow' ? 'page' : undefined}>Borrow fxUSD</button></nav>; export const ProductSurface = ({children, ...props}) => <section {...props}>{children}</section>; export const StatusNotice = ({title, children}) => <div role="status">{title} {children}</div>;`,
  '@/lib/displayPrices': `export const freshDisplayPrices = () => globalThis.__borrowHarness.prices ?? {};`,
  '@/lib/fx/nativeMax': `export const calculateNativeMax = async () => 0n; export const nativeMaxErrorMessage = () => 'Could not calculate Max. Try again.';`,
  '@/lib/fx': `export const estimatePlannedRouteCost = async () => ({}); export async function planDepositAndMint(input){ globalThis.__borrowHarness.lastPlan = input; globalThis.__borrowHarness.plannerCount += 1; return {}; } export async function planRepayAndWithdraw(){ globalThis.__borrowHarness.plannerCount += 1; return {}; } export const restoreSignatureRequiredDraftFromSearch = () => undefined; export const signatureDraftIdFromSearch = () => undefined; export const assertConfiguredPublicClientChain = () => {}; export const assertWalletAddress = () => {}; export const assertPublicClientChain = () => {}; export const getEthereumClient = () => ({}); export const getFxReadFacade = () => ({}); export const fallbackDebtRatioRange = () => ({ min: 25600000000000000n, max: 855000000000000000n, source: 'fallback' }); export const readDebtRatioRange = async () => ({ min: 25600000000000000n, max: 855000000000000000n, source: 'live' });`,
  '@/lib/fx/readFacade': `export const FX_READ_DEADLINE_MS = 1; export const withReadDeadline = (promise) => promise;`,
  '@/lib/fx/policy': `export const positionPoolAddress = () => '0x0000000000000000000000000000000000000001';`,
  '@/components/ActionReview': `import React from 'react'; import { usePrivyWallet } from '@/lib/wallet'; export const ActionReview = ({planBuilder, label, editor, operationLabel, onStageChange, blocker, decisionBefore}) => { const wallet = usePrivyWallet(); const [reviewing,setReviewing] = React.useState(false); if (reviewing) return <section aria-label="Existing position borrow review"><h2>{operationLabel}</h2><p>ETH long · existing position #17</p><button type="button" onClick={() => onStageChange?.('result')}>Complete borrowing</button><button type="button" onClick={() => { setReviewing(false); onStageChange?.('input'); }}>Edit</button><button type="button">Confirm borrowing</button></section>; return <>{editor}<ul data-decision-before>{(decisionBefore ?? []).map((fact) => <li key={fact.label}>{fact.label}: {fact.value}</li>)}</ul><button type="button" disabled={Boolean(blocker)} aria-label={label} data-blocker={blocker ?? undefined} onClick={async () => { globalThis.__borrowHarness.reviewAttemptCount += 1; if (globalThis.__borrowHarness.exerciseReviewStage && label === 'Review borrowing') { setReviewing(true); onStageChange?.('executing'); return; } if (planBuilder) { const route = await planBuilder(); if (route) await wallet.sendTransaction({}); } }}>{label}</button></>; };`,
  '@/components/ProtocolPositionProvider': `export const useProtocolPositions = () => globalThis.__borrowHarness.shared;`,
  '@/components/ProtocolPositionCard': `import React from 'react'; export const ProtocolPositionNotice = ({status}) => status === 'unavailable' ? <div role="status">Positions are temporarily unavailable</div> : null;`,
  '@/components/ConfirmedPositionCards': `export const ConfirmedPositionCards = () => null;`,
  '@/components/ProtocolForm': `import React from 'react'; export const AmountField = ({label, value, onChange, tokenSelector, hint}) => <div><label>{label}<input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} /></label>{hint && <p data-hint={label}>{hint}</p>}{tokenSelector}</div>; export const Segmented = ({options, value, onChange, ariaLabel}) => <div role="group" aria-label={ariaLabel}>{options.map((option) => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>; export const TokenSelect = ({label, options, value, onChange}) => <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((item) => <option key={item} value={item}>{item}</option>)}</select>; export const useWalletTokenBalances = () => ({ balances: globalThis.__borrowHarness.balances ?? {}, status: 'ready', refresh: async () => {} });`,
  '@/components/PriceProvider': `export const useUsdPrices = () => ({ status: 'unavailable', prices: {} }); export const useLiveMarketQuote = () => ({ quote: null, status: 'unavailable', isFresh: false });`,
  '@/lib/wallet': `export const usePrivyWallet = () => ({ ...globalThis.__borrowHarness.wallet, isEmbedded: false, wallets: [], sendTransaction: async () => { globalThis.__borrowHarness.walletRequestCount += 1; } });`,
  '@/lib/positionValuation': `export const calculatePositionUsdValuation = () => ({collateralUsdCents: null, debtUsdCents: null, netEquityUsdCents: null}); export const formatUsdCents = () => '—';`,
  '@/lib/prices': `export const priceKeyForSymbol = (symbol) => ({ eth: 'ETH', weth: 'WETH', steth: 'stETH', wsteth: 'wstETH', wbtc: 'WBTC', fxusd: 'fxUSD' })[String(symbol).toLowerCase()] ?? null; export const formatUsdPrice = () => '—';`,
  '@/lib/transactionState': `export const resetTransactionAmounts = () => ({deposit:'',mint:'',repay:'',withdraw:''});`,
  '@/components/MissingValue': `import React from 'react'; export const ValueOrSkeleton = ({value}) => <span>{value}</span>;`,
  '@aladdindao/fx-sdk': `export const tokens = { eth: '0x0000000000000000000000000000000000000001', weth: '0x0000000000000000000000000000000000000002', stETH: '0x0000000000000000000000000000000000000003', wstETH: '0x0000000000000000000000000000000000000004', WBTC: '0x0000000000000000000000000000000000000005', usdc: '0x0000000000000000000000000000000000000006', usdt: '0x0000000000000000000000000000000000000007', fxUSD: '0x0000000000000000000000000000000000000008', fxUSDBasePool: '0x0000000000000000000000000000000000000009' };`,
};

async function buildHarness(): Promise<string> {
  type BuildApi = { onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void; onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void };
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: root,
    plugins: [{ name: 'borrow-browser-harness', setup(build: BuildApi) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, (args: { path: string }) => ({ path: args.path, namespace: 'mock' }));
      build.onResolve({ filter: /^@\// }, (args: { path: string }) => {
        if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
        const candidate = resolve(src, args.path.slice(2));
        if (args.path.endsWith('.module.css')) return { path: candidate, namespace: 'empty-css' };
        if (existsSync(candidate)) return { path: candidate };
        for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
        return { path: candidate };
      });
      build.onResolve({ filter: /^@aladdindao\/fx-sdk$/ }, () => ({ path: '@aladdindao/fx-sdk', namespace: 'mock' }));
      build.onResolve({ filter: /^\.\/(directPositionDiscovery|canonicalPositionReader)$/ }, (args: { path: string }) => ({ path: args.path, namespace: 'position-read-mock' }));
      build.onLoad({ filter: /.*/, namespace: 'position-read-mock' }, (args: { path: string }) => ({ contents: args.path === './directPositionDiscovery' ? 'export const discoverDirectWalletPositionIds = async () => []; export const readDirectWalletPositionCount = async () => 0n; export const readDirectWalletPositionCounts = ({ groups }) => groups.map(() => Promise.resolve(0n));' : 'export const readCanonicalPositionContext = async () => ({}); export const readCanonicalPositionInfo = async () => ({});', loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, (args: { path: string }) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
      build.onResolve({ filter: /\.module\.css$/ }, (args: { path: string; resolveDir?: string }) => ({ path: resolve(args.resolveDir ?? root, args.path), namespace: 'empty-css' }));
      build.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: 'export default {};', loader: 'js' }));
    } }],
  });
  return result.outputFiles[0].text;
}

let bundle = '';
test.beforeAll(async () => { bundle = await buildHarness(); });

type BorrowHarnessControl = {
  wallet: { ready: boolean; authenticated: boolean; address?: string; chainId: number; connectionVersion: number };
  shared: { walletAddress: string | null; positions: object[]; status: string; failedGroups: Array<{ market: string; side: string; reason: unknown }>; lastVerifiedAt: number | null; [key: string]: unknown };
  balances?: Record<string, { status: string; amount: string }>;
  prices?: Record<string, number>;
  plannerCount: number;
  walletRequestCount: number;
  reviewAttemptCount: number;
  exerciseReviewStage: boolean;
  rerender?: () => void;
};

async function mount(page: import('@playwright/test').Page) {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Borrow', exact: true })).toBeVisible();
}

async function changeSnapshot(page: import('@playwright/test').Page, update: (harness: BorrowHarnessControl) => void) {
  await page.evaluate((callbackSource) => {
    const harness = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    (0, eval)(`(${callbackSource})(globalThis.__borrowHarness)`);
    harness.rerender?.();
  }, update.toString());
}

test('same-wallet disappearance removes the selected position and review action', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
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
  await expect(workspace.getByRole('status')).toContainText('Positions are temporarily unavailable');
});

test('mounted Borrow page prevents review planning and wallet requests when selection becomes stale', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
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

test('existing ETH-long Borrow review hides the input overview and restores the form on Edit', async ({ page }) => {
  await mount(page);
  await page.setViewportSize({ width: 393, height: 852 });
  const borrowOverview = page.getByRole('region', { name: 'fxUSD borrowing overview', exact: true });
  await page.getByRole('button', { name: 'Your positions' }).click();
  await expect(page.getByText('ETH position #17')).toBeVisible();
  await expect(borrowOverview).toBeVisible();
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
  await expect(borrowOverview).toBeVisible();
  await expect(page.getByRole('group', { name: 'Manage collateral position', exact: true })).toBeVisible();
  await expect(page.getByLabel('Additional fxUSD to borrow')).toHaveValue('1');
});

test('account changes preserve the active parent-page review until Edit', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
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
  await expect(page.locator('[data-hint="fxUSD to borrow"]')).toHaveText('Enter collateral above to see your limit');
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
  // 800 of 1,200 is 66.67%: shown as 66.7%; the 83.79% limit is shown as 83.7%.
  await borrow.fill('800');
  await expect(page.getByRole('meter', { name: 'Loan-to-value against the borrowing limit' })).toHaveAttribute('aria-valuetext', '66.7% of a 83.7% limit');
  await expect(page.getByRole('region', { name: 'Estimated borrowing outcome' })).toContainText('0.0% → 66.7%');
});

test('the withdrawal field names how much collateral can leave before review', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => { harness.prices = { ETH: 2400, fxUSD: 1 }; });
  await page.getByRole('button', { name: 'Your positions' }).click();
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
  // Without a price the field says so instead of guessing.
  await changeSnapshot(page, (harness) => { harness.prices = {}; });
  await expect(hint).toHaveText('Your limit shows once prices are available');
});

test('an existing position hands the review its loan-to-value against the live limit, rounded toward safety', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => { harness.prices = { ETH: 2400, fxUSD: 1 }; });
  await page.getByRole('button', { name: 'Your positions' }).click();
  await page.getByRole('button', { name: 'Borrow more' }).click();
  const before = page.locator('[data-decision-before]');
  // 100 fxUSD against 2 ETH at $2,400 is 2.083…%, shown as 2.1%; the 83.79% limit is shown as 83.7%.
  await expect(before).toContainText('Loan-to-value: 2.1% of 83.7% limit');
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
  const outcome = page.getByRole('region', { name: 'Estimated borrowing outcome' });
  await expect(outcome).toContainText('Total debt0 → 800 fxUSD');
  await expect(outcome).toContainText('Before conversion and fees');
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
  await page.getByRole('group', { name: 'Manage collateral position' }).getByRole('button', { name: 'Repay debt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repay debt', exact: true })).toBeVisible();
  const outcome = page.getByRole('region', { name: 'Estimated position changes' });
  await page.getByLabel('Repay amount', { exact: true }).fill('40');
  await expect(outcome).toContainText('Total debt100 → 60 fxUSD');
  await expect(outcome).toContainText('Before conversion and fees');
  await page.getByLabel('Repay amount', { exact: true }).fill('all');
  await expect(outcome).toContainText('Total debt100 → 0 fxUSD');
  await page.getByLabel('Repay amount', { exact: true }).fill('101');
  await expect(outcome).toHaveCount(0);
  await page.getByLabel('Repay amount', { exact: true }).fill('bad');
  await expect(outcome).toHaveCount(0);
});
