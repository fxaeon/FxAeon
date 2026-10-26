import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enlargeFormText, expectFormMetricRows } from '../harness/form-metric-geometry';

const app = resolve(__dirname, '../..');
const req = createRequire(resolve(app, 'package.json'));
const esbuild = createRequire(req.resolve('tsx/package.json'))('esbuild');
const postcss = req('postcss');
const tailwind = req('tailwindcss');
const autoprefixer = req('autoprefixer');
// Real Move form, amount entry, asset picker, settings, CSS and local marks.
// Wallet/market data and the review boundary are fixtures; nothing is sent.
const mocks: Record<string, string> = {
  'next/link': `export default ({href,children,prefetch,...props}) => <a href={href} {...props}>{children}</a>;`,
  'next/navigation': `export const useRouter = () => ({push:()=>{},replace:()=>{},back:()=>{}});export const usePathname=()=>'/move';export const useSearchParams=()=>new URLSearchParams();`,
  '@/components/ui': `export const AppShell=({children})=><main className="move-fixture-shell">{children}</main>;export const Card=({children,className,...props})=><section className={'ui-card '+className} {...props}>{children}</section>;`,
  '@/components/ProductSections': `export const MoveSections=()=>null;`,
  '@/components/PriceProvider': `export const useUsdPrices=()=>({status:'ready',prices:{fxUSD:1,fxUSDBasePool:1.04,ETH:2500},updatedAt:Date.now(),refresh:async()=>{}});`,
  '@/components/WalletDataProvider': `const refresh=async()=>{};export const useMoveBalances=()=>({status:'ready',data:{balances:{fxUSD:{status:'ready',amount:'1000'},fxSAVE:{status:'ready',amount:'200'}}},refresh});export const useWalletBalances=useMoveBalances;`,
  '@/lib/wallet': `export const usePrivyWallet=()=>({...globalThis.__moveForm.wallet,sendTransaction:()=>{throw new Error('No transactions in this fixture');}});`,
  '@/lib/telegram': `export const haptic=()=>{};export const openExternalLink=()=>false;`,
  '@/lib/fx/gasFeePolicy': `export const fetchGasTierQuotes=async()=>({tiers:{standard:{gasPriceWei:1n},fast:{gasPriceWei:2n},rapid:{gasPriceWei:3n}}});`,
  '@/components/ActionReview': `export const ActionReview=({editor,blocker,label})=><>{editor}<div className="reviewTrigger"><button className="button button-primary" disabled={Boolean(blocker)}>{globalThis.__moveForm.wallet.address?blocker||label:'Connect wallet'}</button></div></>;`,
  '@/lib/fx': `export const asFxSdkRpcTransport=v=>v;export const assertAddress=v=>v;export const assertBridgeActionTarget=()=>{};export const advancedBridgePolicy=()=>({});export const assertChecksummedAddress=v=>v;export const assertPublicClientChain=()=>{};export const bridgeDeliveryLowerBound=()=>0n;export const getBridgeApprovalAllowance=async()=>0n;export const getFxReadFacade=()=>({});export const withReadDeadline=v=>v;export const getPublicClient=()=>({readContract:async()=>0n});export const planBridgeRoute=async()=>({});export const resolveBridgeApprovalTokenAddress=()=> '0x0000000000000000000000000000000000000001';export const resolveBridgeTokenAddress=resolveBridgeApprovalTokenAddress;export const requireRpcUrl=()=> 'http://localhost';export const restoreSignatureRequiredDraftFromSearch=()=>undefined;export const validateAdvancedBridgeContracts=async()=>({});`,
  '@/lib/fx/bridgePreview': `export const BRIDGE_PREVIEW_TTL=30000;export const fetchBridgePreview=async({amount})=>{if(globalThis.__moveForm.failQuote)throw new Error('Quote unavailable');return {readAt:Date.now(),nativeFee:1234567890123456n,minimumReceived:amount-10000000000000000n,estimatedReceived:amount-123456789012345n,nativeBalance:10n**18n,sourceGas:2n*10n**15n};};export const fetchCanonicalBridgeEstimate=async({amount})=>{if(globalThis.__moveForm.canonicalFetch)return globalThis.__moveForm.canonicalFetch(amount);if(globalThis.__moveForm.failQuote)throw new Error('Quote unavailable');return {readAt:Date.now(),nativeFee:1234567890123456n,minimumReceived:amount-10000000000000000n,estimatedReceived:amount-123456789012345n};};export const isFreshBridgePreview=(p)=>Boolean(p&&Date.now()-p.readAt<30000);export const readBridgeReceiptEstimate=async()=>undefined;`,
  '@/app/trade/fxUi': `import {parseUnits} from 'viem';export const parseAmount=value=>{try{return Number(value)>0?parseUnits(value,18):null;}catch{return null;}};`,
};
let bundle: { script: string; css: string };
test.beforeAll(async () => {
  const result = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import MovePage from './src/app/move/page';const disconnected=new URLSearchParams(location.search).has('disconnected');globalThis.__moveForm={wallet:{ready:true,authenticated:!disconnected,address:disconnected?undefined:'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',chainId:1,connectionVersion:1}};createRoot(document.getElementById('root')).render(<MovePage/>);`, loader: 'tsx', resolveDir: app },
    bundle: true, write: false, outdir: 'move-form-fixture', format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', loader: { '.module.css': 'local-css' },
    plugins: [{ name: 'move-fixtures', setup(build: any) {
      build.onResolve({ filter: /^(@\/|next\/)/ }, ({ path }: { path: string }) => {
        if (mocks[path]) return { path, namespace: 'fixture' };
        const base = resolve(app, 'src', path.slice(2));
        return { path: [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find(file => existsSync(file) && statSync(file).isFile()) ?? base };
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }: { path: string }) => ({ contents: mocks[path], loader: 'tsx', resolveDir: app }));
    } }],
  });
  const globals = await postcss([tailwind({ config: resolve(app, 'tailwind.config.js') }), autoprefixer()]).process(readFileSync(resolve(app, 'src/app/globals.css'), 'utf8'), { from: resolve(app, 'src/app/globals.css') });
  bundle = { script: result.outputFiles.find((file: { path: string }) => file.path.endsWith('.js')).text,
    css: `${globals.css}\n${readFileSync(resolve(app, 'src/app/product-shell.css'), 'utf8')}\n${result.outputFiles.find((file: { path: string }) => file.path.endsWith('.css')).text}\n@font-face{font-family:MoveInter;src:url('/fixture-font.woff2');font-weight:100 900}:root{--font-sans:MoveInter}body{font-family:MoveInter,system-ui,sans-serif}.move-fixture-shell{padding:24px 16px 80px}.reviewTrigger{margin-top:12px}.reviewTrigger button{width:100%}` };
});
async function mount(page: Page, width: number, disconnected = false) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.route('http://move.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<html data-theme="dark"><head></head><body><div id="root"></div></body></html>' });
    if (path === '/fixture-font.woff2') {
      const font = process.env.FXAEON_REVIEW_INTER_FONT;
      return font && existsSync(font) ? route.fulfill({ path: font }) : route.abort();
    }
    const asset = resolve(app, 'public', `.${path}`);
    return /^\/(token-icons|chain-icons|fonts)\/[\w.-]+$/.test(path) && existsSync(asset) ? route.fulfill({ path: asset }) : route.abort();
  });
  await page.goto(`http://move.test/${disconnected ? '?disconnected' : ''}`);
  await page.addStyleTag({ content: bundle.css });
  await page.addScriptTag({ content: bundle.script });
  await expect(page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true })).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  expect(errors).toEqual([]);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
for (const width of [320, 390, 1280]) test(`Move form keeps amount, quote precision and route changes coherent at ${width}px`, async ({ page }, info) => {
  await mount(page, width);
  const received = page.getByRole('region', { name: 'Receive assets' });
  await expect(received.getByText('—', { exact: true })).toHaveCount(0);
  await expect(received.getByText('0.00', { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('empty.png') });
  await page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true }).fill('100');
  const exactEstimate = received.locator('[data-receive-amount]');
  await expect(exactEstimate).toBeVisible();
  await expect(received.locator('details')).toHaveCount(0);
  const figure = exactEstimate;
  await expect(figure).toHaveText('≈ 100');
  expect(await figure.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(28);
  expect(await figure.evaluate(element => element.getBoundingClientRect().width <= element.parentElement!.getBoundingClientRect().width + 1)).toBe(true);
  expect(await figure.evaluate(element => element.getBoundingClientRect().height < parseFloat(getComputedStyle(element).fontSize) * 1.5)).toBe(true);
  const balance = await page.getByRole('region', { name: 'Send assets' }).getByText('Available:', { exact: false }).boundingBox();
  const reverse = await page.getByRole('button', { name: /Reverse route to Ethereum/ }).boundingBox();
  expect(balance && reverse && balance.y + balance.height <= reverse.y).toBeTruthy();
  await page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true }).press('Tab');
  await page.screenshot({ path: info.outputPath('quoted.png') });
  if (width === 320) {
    await page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true }).fill('123456789012345678901234567890');
    await expect(exactEstimate).toBeVisible();
    await expect(received.locator('details')).toHaveCount(0);
    await expect(received).not.toContainText('123456789012345678901234567889.999876543210987655 fxUSD');
    expect(await figure.evaluate(element => element.getBoundingClientRect().width <= element.parentElement!.getBoundingClientRect().width + 1)).toBe(true);
    await noOverflow(page);
  }
  await page.getByRole('button', { name: /Reverse route to Ethereum/ }).click();
  await expect(page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true })).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Send assets' })).toContainText('Base');
  await page.getByRole('button', { name: 'Asset', exact: true }).click();
  await page.getByRole('option', { name: /fxSAVE/ }).click();
  await expect(page.getByRole('textbox', { name: 'Amount in fxSAVE', exact: true })).toBeVisible();
  await noOverflow(page);
});

test('Move keeps failed quotes and invalid recipients clear with enlarged text', async ({ page }, info) => {
  await mount(page, 320);
  await page.evaluate(() => { (globalThis as any).__moveForm.failQuote = true; document.documentElement.style.fontSize = '32px'; });
  await page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true }).fill('100');
  await expect(page.getByRole('status').filter({ hasText: 'Receipt estimate unavailable' })).toContainText('Receipt estimate unavailable');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByRole('textbox', { name: 'Destination wallet', exact: true }).fill('invalid');
  await expect(page.getByRole('alert')).toContainText('Enter a valid, non-zero destination address.');
  await expect(page.getByRole('button', { name: 'Enter a valid address', exact: true })).toBeDisabled();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('failed-quote-recipient-zoom.png'), fullPage: true });
});

test('Move quote rows stay compact and wrap at 320px with 200% text', async ({ page }) => {
  for (const width of [390, 320]) {
    await mount(page, width);
    await page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true }).fill('100');
    const quote = page.getByRole('region', { name: 'Bridge quote', exact: true });
    await expect(quote).toContainText('Minimum received');
    await expect(quote).toContainText('Bridge fee');
    await page.evaluate(() => document.fonts.ready);
    const rows = quote.locator('dl > div');
    const heights = await expectFormMetricRows(rows);
    if (width === 390) expect(heights[0], 'A single-line minimum row must use the compact rhythm').toBeLessThanOrEqual(32);
    await enlargeFormText(page);
    await expectFormMetricRows(rows);
    await noOverflow(page);
  }
});

test('Move canonical quote pending-to-ready preserves receive, quote and CTA geometry', async ({ page }) => {
  await mount(page, 390, true);
  await page.evaluate(() => {
    (globalThis as any).__moveForm.canonicalFetch = (amount: bigint) => new Promise((resolve) => {
      (globalThis as any).__moveForm.resolveCanonicalQuote = () => resolve({ readAt: Date.now(), nativeFee: 10n ** 15n, minimumReceived: amount - 10n ** 16n, estimatedReceived: amount - 123456789012345n });
    });
  });
  await page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true }).fill('100');
  await expect.poll(() => page.evaluate(() => typeof (globalThis as any).__moveForm.resolveCanonicalQuote)).toBe('function');
  const receive = page.getByRole('region', { name: 'Receive assets', exact: true });
  const quote = page.getByRole('region', { name: 'Bridge quote', exact: true });
  const cta = page.getByRole('button', { name: 'Connect wallet', exact: true });
  await expect(quote.getByRole('button', { name: 'Refresh quote', exact: true })).toBeDisabled();
  await expect(receive.getByRole('status', { name: 'Loading receive estimate' })).toHaveCount(1);
  await expect(quote.getByRole('status', { name: 'Loading minimum received' })).toHaveCount(1);
  await expect(quote.getByRole('status', { name: 'Loading bridge fee' })).toHaveCount(1);
  const measure = async () => ({
    receive: await receive.boundingBox(),
    quote: await quote.boundingBox(),
    cta: await cta.boundingBox(),
  });
  const pending = await measure();
  await expect(cta).toBeVisible();
  await page.evaluate(() => (globalThis as any).__moveForm.resolveCanonicalQuote());
  await expect(receive.locator('[data-receive-amount]')).toBeVisible();
  await expect(quote.locator('dt').filter({ hasText: /^Minimum received$/ }).locator('xpath=following-sibling::dd')).toContainText('99.99 fxUSD');
  await expect(quote.locator('dt').filter({ hasText: /^Bridge fee$/ }).locator('xpath=following-sibling::dd')).toContainText('0.001 ETH');
  const ready = await measure();
  for (const key of ['receive', 'quote', 'cta'] as const) {
    expect(pending[key] && ready[key]).toBeTruthy();
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(pending[key]![dimension] - ready[key]![dimension]), `${key} ${dimension} shifted while quote settled`).toBeLessThanOrEqual(1);
    }
  }
});

test('Move current asset is a no-op and real asset changes retain recipient while resetting input units', async ({ page }) => {
  await mount(page, 390);
  const recipient = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  await page.getByRole('textbox', {name: 'Amount in fxUSD', exact: true}).fill('100');
  await page.getByRole('button', {name: 'Change', exact: true}).click();
  await page.getByRole('textbox', {name: 'Destination wallet', exact: true}).fill(recipient);
  await page.getByRole('button', {name: 'Asset', exact: true}).click();
  await page.getByRole('option', {name: /fxUSD/}).click();
  await expect(page.getByRole('textbox', {name: 'Amount in fxUSD', exact: true})).toHaveValue('100');
  await expect(page.getByRole('textbox', {name: 'Destination wallet', exact: true})).toHaveValue(recipient);
  await expect(page.getByRole('button', {name: 'Asset', exact: true})).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', {name: 'Asset', exact: true}).click();
  await page.getByRole('option', {name: /fxSAVE/}).click();
  await expect(page.getByRole('textbox', {name: 'Amount in fxSAVE', exact: true})).toHaveValue('');
  await expect(page.getByRole('textbox', {name: 'Destination wallet', exact: true})).toHaveValue(recipient);
  await expect(page.getByRole('region', {name: 'Receive assets'}).getByText('0.00', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: /Reverse route to Ethereum/}).click();
  await expect(page.getByRole('textbox', {name: 'Destination wallet', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Change', exact: true})).toBeVisible();
});
