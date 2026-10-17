import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const src = resolve(root, 'apps/mini-app/src');
const entry = resolve(root, 'apps/mini-app/e2e/harness/trade-native-max-entry.tsx');

const mocks: Record<string, string> = {
  'next/link': `import React from 'react'; export default ({children,...props}) => <a {...props}>{children}</a>;`,
  'next/navigation': `export const useRouter = () => ({ push: () => {}, prefetch: () => {} });`,
  '@/components/ui': `import React from 'react'; export const AppShell = ({children}) => <main>{children}</main>; export const Card = ({children,...props}) => <section {...props}>{children}</section>;`,
  '@/components/ProductUI': `import React from 'react'; export const Disclosure = ({children}) => <>{children}</>;`,
  '@/components/ProductLayout': `import React from 'react'; export const ActionWorkspace = ({children,...props}) => <section {...props}>{children}</section>;`,
  // The real trigger wraps its primary action in .reviewTrigger; Enter in the amount looks for it there.
  '@/components/ActionReview': `import React from 'react'; export const ActionReview = ({editor, label, blocker}) => <>{editor}<div className="reviewTrigger"><button type="button" disabled={Boolean(blocker)} onClick={() => { globalThis.__tradeMaxHarness.reviews = (globalThis.__tradeMaxHarness.reviews ?? 0) + 1; }}>{label}</button></div></>;`,
  '@/components/MarketChart': `import React from 'react'; export const TradeMarketChart = ({market,onMarketChange}) => <select aria-label="Market" value={market} onChange={e=>onMarketChange(e.target.value)}><option>ETH</option><option>BTC</option></select>;`,
  '@/components/PriceProvider': `export const useUsdPrices = () => ({status:'unavailable',prices:{}}); export const useLiveMarketQuote = () => ({ quote: null, status: 'unavailable', isFresh: false });`,
  '@/components/TokenIcon': `import React from 'react'; export const ChainIcon = () => <span />; export default () => <span />;`,
  '@/components/MissingValue': `import React from 'react'; export const ValueOrSkeleton = ({value}) => <span>{value}</span>;`,
  '@/components/ProtocolPositionCard': `export const ProtocolPositionCard = () => null; export const ProtocolPositionList = () => null; export const ProtocolPositionNotice = () => null;`,
  '@/components/ProtocolPositionProvider': `export const useProtocolPositions = () => ({positions:[],pendingPositions:[],status:'ready',failedGroups:[],refresh:async()=>({positions:[],failedGroups:[],successfulGroups:[],status:'ready',newPositions:[]})});`,
  '@/components/ConfirmedPositionCards': `export const ConfirmedPositionCards = () => null;`,
  // The ticket's outcome preview reads the warmed route, which this harness never plans.
  '@/components/TradeOutcomePreview': `export const TradeOutcomePreview = () => null;`,
  '@/lib/confirmedPositions': `export const deriveConfirmedPositionHint = () => null;`,
  '@/lib/confirmedPositionStorage': `export const confirmedPositionHintKey = () => '';`,
  '@/components/WalletDataProvider': `export const useWalletBalances = () => ({status:'ready',data:null});`,
  '@/components/ProtocolForm': `import React from 'react'; export { AmountFieldView as AmountField } from '@/components/AmountField'; export { Segmented, LeverageField } from '${src.replaceAll('\\', '/')}/components/ProtocolForm.tsx'; export const SlippageField = () => null; export const TokenSelect = ({label,value,options,onChange}) => <select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>; export const tokenBalanceFor = (balances,token) => balances[token]; export const useWalletTokenBalances = () => ({balances:{ETH:{status:'ready',amount:globalThis.__tradeMaxHarness.balance}},status:'ready',refresh:async()=>{}});`,
  '@/lib/fx': `export const MAX_FX_SLIPPAGE_PERCENT=5; export const clampLeverage=(v)=>v; export const estimatePlannedRouteCost=async()=>({}); export const getEthereumClient=()=>({getBlockNumber:async()=>1n}); export const leverageBoundsFor=(market,side)=>({min:side==='long'?1.1:0.1,max:market==='ETH'?(side==='long'?10:6):(side==='long'?8:5)}); export const planIncreasePosition=async(input)=>({input}); export const prepareLeverageReview=async()=>({}); export const readLeverageBounds=async(market,side)=>globalThis.__tradeMaxHarness.nextBounds??leverageBoundsFor(market,side); export const readSignatureRequiredDraft=()=>null; export const restoreSignatureRequiredDraft=()=>null; export const signatureDraftIdFromSearch=()=>null;`,
  '@/lib/fx/nativeMax': `export const nativeMaxErrorMessage=()=> 'Current gas fees are unavailable. Try again shortly.'; export const calculateNativeMax = (input) => new Promise((resolve,reject) => globalThis.__tradeMaxHarness.requests.push({balanceWei:input.balanceWei,resolve,reject}));`,
  '@/lib/fx/routePrefetch': `export class RoutePrefetchStore { invalidate(){} prime(){return Promise.resolve();} get(){return null;} }`,
  '@/lib/wallet': `export const usePrivyWallet = () => ({ready:true,authenticated:true,address:globalThis.__tradeMaxHarness.address,chainId:globalThis.__tradeMaxHarness.chainId,connectionVersion:1,isEmbedded:true,wallets:[],sendTransaction:async()=>({})});`,
  '@/lib/amount': `export const positiveDecimal = (value) => /^\\d+(\\.\\d*)?$/.test(value); export const calculateFractionDecimal=(value,fraction)=>value; export const compareExactDecimals=(left,right)=>Number(left)-Number(right); export const decimalInputError=()=>null; export const formatExactDecimal=(value)=>String(value); export const formatBalanceDecimal=(value)=>String(value); export const groupDigits=(value)=>String(value); export const normalizeAmountInput=(value)=>value;`,
  '@/lib/prices': `export const formatUsd=()=> '$0.00'; export const formatUsdPrice=()=> '$0.00'; export const priceKeyForSymbol=()=> null; export const usdValueForDecimal=()=> null;`,
  '@/lib/fx/tokenPresentation': `export const tokenSymbol=(value)=>value; export const tokenName=(value)=>value; export const tokenPresentation=(value)=>({symbol:value});`,
  '@/lib/telegram': `export const haptic=()=>{}; export const openExternalLink=()=>false;`,
  '@/lib/walletAssets': `export const ASSET_PRICE_MAX_AGE_MS=60000;`,
  '@/lib/settings': `export const DEFAULT_SLIPPAGE_PERCENT=0.5; export const readSlippagePercent=()=>globalThis.__tradeMaxHarness.slippage??0.5; export const readGasTier=()=> 'standard'; export const SETTINGS_KEY='settings'; export const SETTINGS_UPDATED_EVENT='settings-updated'; export const GAS_TIERS=['standard','fast','rapid']; export const DEFAULT_GAS_TIER='standard'; export const MIN_SLIPPAGE_BPS=10; export const MAX_SLIPPAGE_BPS=200; export const SLIPPAGE_PRESETS_BPS=[10,50,100,200]; export const isSlippageBps=(v)=>Number.isInteger(v)&&v>=10&&v<=200; export const writeTransactionSettings=()=>true;`,
  '@/lib/transactionState': `export const readTradeDeepLinkContext=()=>null; export const resetTransactionAmounts=()=>({amount:'',leverage:2});`,
  '@/app/trade/fxUi': `export const parseAmount=(value)=>value ? BigInt(Math.round(Number(value)*1e18)) : null; export const positionInputTokenOptions=(market)=>market==='ETH'?['ETH','WETH','stETH','wstETH']:['WBTC']; export const positionKey=()=>''; export const tokenAddress=()=> '0x0000000000000000000000000000000000000001'; export const tokenDecimals=()=>18;`,
};

async function buildHarness(): Promise<string> {
  type BuildApi = { onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void; onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void };
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: root,
    plugins: [{ name: 'trade-native-max-harness', setup(build: BuildApi) {
      build.onResolve({ filter: /^@\// }, (args) => {
        if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
        const candidate = resolve(src, args.path.slice(2));
        if (args.path.endsWith('.module.css')) return { path: candidate, namespace: 'empty-css' };
        if (existsSync(candidate)) return { path: candidate };
        for (const ext of ['.tsx', '.ts']) if (existsSync(`${candidate}${ext}`)) return { path: `${candidate}${ext}` };
        return { path: candidate };
      });
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next/link', namespace: 'mock' }));
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'next/navigation', namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
      build.onResolve({ filter: /\.module\.css$/ }, (args) => ({ path: resolve(args.resolveDir ?? root, args.path), namespace: 'empty-css' }));
      build.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: 'export default {};', loader: 'js' }));
    } }],
  });
  return result.outputFiles[0].text;
}

let bundle = '';
test.beforeAll(async () => { bundle = await buildHarness(); });
type Control = { balance: string; requests: Array<{ balanceWei: bigint; resolve: (value: bigint) => void; reject: (error: Error) => void }>; rerender?: () => void };

async function mount(page: import('@playwright/test').Page) {
  page.on('pageerror', (error) => console.error('[trade harness pageerror]', error));
  page.on('console', (message) => { if (message.type() === 'error') console.error('[trade harness console]', message.text()); });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toBeVisible();
}
async function resolveRequest(page: import('@playwright/test').Page, index: number, amount: string) {
  await page.evaluate(({ index, amount }) => {
    const h = (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness;
    h.requests[index].resolve(BigInt(Math.round(Number(amount) * 1e18)));
  }, { index, amount });
}
async function rejectRequest(page: import('@playwright/test').Page, index: number) {
  await page.evaluate((index) => {
    const h = (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness;
    h.requests[index].reject(new Error('gas estimate unavailable'));
  }, index);
}

test('StrictMode Max calculation resolves into the amount field', async ({ page }) => {
  await mount(page);
  const max = page.getByRole('button', { name: 'Calculate 100% after gas reserve' });
  await max.click();
  await expect(max).toBeDisabled();
  await expect.poll(async () => page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests.length)).toBe(1);
  await resolveRequest(page, 0, '0.9');
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.9');
  await expect(max).toBeEnabled();
});

test('Enter in the amount asks for the review, as a form submit would, only once it is ready', async ({ page }) => {
  await mount(page);
  const amount = page.getByRole('textbox', { name: 'Amount in ETH' });
  const review = page.getByRole('button', { name: 'Open ETH Long' });
  const reviews = () => page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: { reviews?: number } }).__tradeMaxHarness.reviews ?? 0);
  // Nothing to review yet: the action names what is missing, and Enter does nothing.
  await expect(review).toBeDisabled();
  await amount.press('Enter');
  expect(await reviews()).toBe(0);
  // Leaving the empty field (to pick an asset, say) never paints it red: the action already asks for an amount.
  await amount.blur();
  await expect(amount).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await amount.fill('0.5');
  await expect(review).toBeEnabled();
  await amount.press('Enter');
  await expect.poll(reviews).toBe(1);
  // A modified Enter is not a submit.
  await amount.press('Shift+Enter');
  await amount.press('Control+Enter');
  expect(await reviews()).toBe(1);
});

test('balance changes discard an in-flight Max result and restore the button', async ({ page }) => {
  await mount(page);
  const max = page.getByRole('button', { name: 'Calculate 100% after gas reserve' });
  await max.click();
  await expect(max).toBeDisabled();
  await page.evaluate(() => {
    const h = (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness;
    h.balance = '2'; h.rerender?.();
  });
  await expect(max).toBeEnabled();
  await resolveRequest(page, 0, '0.9');
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('');
  await max.click();
  await expect.poll(async () => page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests.length)).toBe(2);
  const balanceWei = await page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests[1].balanceWei.toString());
  expect(balanceWei).toBe('2000000000000000000');
});

test('changing Long/Short cancels the pending Max result', async ({ page }) => {
  await mount(page);
  const max = page.getByRole('button', { name: 'Calculate 100% after gas reserve' });
  await max.click();
  await expect(max).toBeDisabled();
  await page.getByRole('radiogroup', { name: 'Position side' }).getByRole('radio', { name: 'Short' }).click();
  await expect(max).toBeEnabled();
  await resolveRequest(page, 0, '0.8');
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('');
});

test('a failed Max request can be retried and each click recalculates', async ({ page }) => {
  await mount(page);
  const max = page.getByRole('button', { name: 'Calculate 100% after gas reserve' });
  await max.click();
  await expect.poll(async () => page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests.length)).toBe(1);
  await rejectRequest(page, 0);
  await expect(page.getByText(/current gas fees are unavailable/i)).toBeVisible();
  await expect(max).toBeEnabled();
  await max.click();
  await expect.poll(async () => page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests.length)).toBe(2);
  await resolveRequest(page, 1, '0.7');
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.7');
  await max.click();
  await expect.poll(async () => page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests.length)).toBe(3);
  const balances = await page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests.map((request) => request.balanceWei.toString()));
  expect(balances).toEqual(['1000000000000000000','1000000000000000000','1000000000000000000']);
});

for (const market of ['ETH', 'BTC']) {
  test(`${market} leverage examples follow the ticket side, keep their layout, and leave the live limit to the ticket`, async ({ page }) => {
    await mount(page);
    await page.getByRole('combobox', { name: 'Market', exact: true }).selectOption(market);
    const amount = page.getByRole('textbox', { name: `Amount in ${market === 'ETH' ? 'ETH' : 'WBTC'}` });
    const leverage = page.getByRole('textbox', { name: 'Target leverage' });
    const ticket = page.getByRole('radiogroup', { name: 'Position side' });
    await page.getByText('How leverage works', { exact: true }).click();
    await page.getByText('Market details', { exact: true }).click();
    const explanation = page.getByRole('region', { name: 'How leverage works' });
    const glance = page.getByRole('region', { name: 'Market details', exact: true });
    const split = explanation.getByRole('list', { name: /Debt and equity share of a position/ });
    const rows = split.getByRole('listitem');
    const splitHeight = async () => (await split.boundingBox())!.height;
    await amount.fill('0.125');
    await leverage.fill('3');
    // The ticket's slider states the chosen leverage live, so the examples offer
    // no side switch of their own: the only control is the link into Docs.
    await expect(explanation.getByRole('radiogroup')).toHaveCount(0);
    await expect(explanation.getByRole('radio')).toHaveCount(0);
    await expect(explanation.getByRole('button')).toHaveCount(0);
    await expect(explanation.getByRole('link', { name: 'How it works', exact: true })).toHaveAttribute('href', '/docs/guide/trade');
    await expect(rows).toHaveCount(2);
    await expect(explanation).toContainText('a 3× long carries 67% debt and 33% equity');
    await expect(rows.nth(1)).toContainText('67% debt · 33% equity');
    await expect(explanation).not.toContainText('pool maximum');
    await expect(glance).toContainText(`–${market === 'ETH' ? '10.0' : '8.0'}×`);
    const longHeight = await splitHeight();

    // Choosing Short in the ticket moves the examples, the debt asset and the live limit with it.
    await ticket.getByRole('radio', { name: 'Short' }).click();
    await expect(page.getByRole('button', { name: `Open ${market} Short` })).toBeVisible();
    await expect(explanation).toContainText('a 3× short carries 75% debt and 25% equity');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('75% debt · 25% equity');
    expect(await rows.nth(1).evaluate((row) => (row as HTMLElement).style.getPropertyValue('--borrowed'))).toBe('0.75');
    expect(await splitHeight(), 'switching sides must not move the content below').toBe(longHeight);
    await expect(glance).toContainText(`–${market === 'ETH' ? '6.0' : '5.0'}×`);

    await ticket.getByRole('radio', { name: 'Long' }).click();
    await expect(rows.nth(1)).toContainText('67% debt · 33% equity');
    expect(await rows.nth(1).evaluate((row) => (row as HTMLElement).style.getPropertyValue('--borrowed'))).toBe(String(2 / 3));

    // A new market keeps the selected trade side, with its own debt asset and live limit.
    await ticket.getByRole('radio', { name: 'Short' }).click();
    const nextMarket = market === 'ETH' ? 'BTC' : 'ETH';
    await page.getByRole('combobox', { name: 'Market', exact: true }).selectOption(nextMarket);
    await expect(ticket.getByRole('radio', { name: 'Short' })).toBeChecked();
    await expect(page.getByRole('region', { name: 'Market details', exact: true })).toContainText(`–${nextMarket === 'ETH' ? '6.0' : '5.0'}×`);
    await expect(rows.nth(1)).toContainText('75% debt · 25% equity');
  });
}

test('a focused target becomes invalid when a later slippage-bound read lowers its live maximum', async ({ page }) => {
  await mount(page);
  const leverage = page.getByRole('textbox', { name: 'Target leverage' });
  const slider = page.getByRole('slider', { name: 'Target leverage slider' });
  const review = page.getByRole('button', { name: 'Open ETH Long', exact: true });
  await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('0.1');
  await leverage.fill('5');
  await expect(review).toBeEnabled();
  await page.evaluate(() => {
    const h = (globalThis as typeof globalThis & { __tradeMaxHarness: Control & { nextBounds: { min: number; max: number; source: string }; slippage: number } }).__tradeMaxHarness;
    h.nextBounds = { min: 1.1, max: 3, source: 'onchain' };
    h.slippage = 1;
    window.dispatchEvent(new CustomEvent('settings-updated', { detail: { slippageBps: 100 } }));
  });
  await expect(slider).toHaveAttribute('max', '3');
  await expect(leverage).toHaveValue('5');
  await expect(leverage).toHaveAttribute('aria-invalid', 'true');
  await expect(review).toBeDisabled();
  await leverage.blur();
  await expect(leverage).toHaveValue('3');
  await expect(review).toBeEnabled();
});

test('out-of-range leverage blocks review while typing and clamps only when committed', async ({ page }) => {
  await mount(page);
  const amount = page.getByRole('textbox', { name: 'Amount in ETH' });
  const leverage = page.getByRole('textbox', { name: 'Target leverage' });
  const slider = page.getByRole('slider', { name: 'Target leverage slider' });
  const review = page.getByRole('button', { name: 'Open ETH Long', exact: true });
  await amount.fill('0.1');
  await leverage.fill('10000');
  await expect(leverage).toHaveAttribute('aria-invalid', 'true');
  await expect(review).toBeDisabled();
  await leverage.press('Enter');
  await expect(leverage).toHaveValue((await slider.getAttribute('max'))!);
  await expect(review).toBeEnabled();
  await leverage.fill('0.5');
  await expect(review).toBeDisabled();
  await leverage.blur();
  await expect(leverage).toHaveValue((await slider.getAttribute('min'))!);
  await expect(review).toBeEnabled();
});

test('empty leverage cannot review a valid amount before or after blur', async ({ page }) => {
  await mount(page);
  const amount = page.getByRole('textbox', { name: 'Amount in ETH' });
  const leverage = page.getByRole('textbox', { name: 'Target leverage' });
  const review = page.getByRole('button', { name: 'Open ETH Long', exact: true });

  await amount.fill('0.1');
  await expect(leverage).toHaveValue('2');
  await expect(review).toBeEnabled();

  await leverage.fill('');
  await expect(leverage).toHaveValue('');
  await expect(leverage).toHaveAttribute('aria-invalid', 'true');
  await expect(review, 'an empty leverage draft must block review').toBeDisabled();

  await leverage.blur();
  await expect(leverage).toHaveValue('');
  await expect(leverage).toHaveAttribute('aria-invalid', 'true');
  await expect(review, 'blur must not turn an empty leverage draft into a reviewable value').toBeDisabled();
});
