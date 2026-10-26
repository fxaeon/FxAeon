import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const src = resolve(root, 'apps/mini-app/src');
const entry = resolve(root, 'apps/mini-app/e2e/harness/move-session-entry.tsx');

const mocks: Record<string, string> = {
  // The settings gear links to Settings and closes with the router; the harness has neither Next's
  // build-time env nor a mounted app router.
  'next/link': `import React from 'react'; export default ({ href, children, prefetch, scroll, replace, ...props }) => <a href={typeof href === 'string' ? href : '#'} {...props}>{children}</a>;`,
  'next/navigation': `export const useRouter = () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }); export const usePathname = () => '/move'; export const useSearchParams = () => new URLSearchParams();`,
  '@/components/ui': `import React from 'react'; export const AppShell = ({children}) => <main>{children}</main>; export const Card = ({children, ...props}) => <section {...props}>{children}</section>;`,
  '@/components/ProductUI': `import React from 'react'; export const PageHeading = ({title}) => <h1>{title}</h1>;`,
  '@/components/ProductLayout': `import React from 'react'; export const ActionWorkspace = ({children}) => <main>{children}</main>;`,
  '@/components/ActionReview': `import React from 'react'; export const ActionReview = ({editor, onStageChange, blocker, label='Review transfer'}) => { const [stage,setStage] = React.useState('input'); const move = (next) => { setStage(next); onStageChange?.(next); }; if (stage === 'input') return <>{editor}<button type="button" disabled={Boolean(blocker)} onClick={() => move('review')}>{blocker || label}</button></>; if (stage === 'review') return <section><h2>Reviewed bridge route</h2><button type="button" onClick={() => { globalThis.__moveSessionHarness.executionCount++; move('executing'); }}>Confirm transfer</button><button type="button" onClick={() => move('input')}>Edit</button></section>; return <section><h2>Bridge execution in progress</h2><button type="button" onClick={() => move('input')}>Edit</button></section>; };`,
  // Trade's illustration shares ProductSections with MoveSections; its unused
  // Segmented import must still be exported by this isolated module mock.
  '@/components/ProtocolForm': `import React from 'react'; export const Segmented = () => null; export const AmountField = ({label,value,onChange}) => <label>{label}<input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} /></label>; export const TokenSelect = ({label,value,options,onChange}) => <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((item) => <option key={item} value={item}>{item}</option>)}</select>;`,
  '@/components/WalletDataProvider': `export const useMoveBalances = () => ({ data: { balances: {} }, status: 'ready', refresh: async () => {} });`,
  '@/lib/fx': `export const asFxSdkRpcTransport = (value) => value; export const assertAddress = (value) => value; export const assertBridgeActionTarget = () => {}; export const advancedBridgePolicy = () => ({}); export const assertChecksummedAddress = (value) => value; export const assertPublicClientChain = () => {}; export const bridgeDeliveryLowerBound = () => 0n; export const getBridgeApprovalAllowance = async () => 0n; export const getFxReadFacade = () => ({}); export const withReadDeadline = (value) => value; export const getPublicClient = () => ({ readContract: async () => 0n }); export const planBridgeRoute = async () => ({}); export const resolveBridgeApprovalTokenAddress = () => '0x0000000000000000000000000000000000000001'; export const resolveBridgeTokenAddress = () => '0x0000000000000000000000000000000000000001'; export const requireRpcUrl = () => 'http://localhost'; export const restoreSignatureRequiredDraftFromSearch = () => undefined; export const validateAdvancedBridgeContracts = async () => ({});`,
  '@/lib/fx/bridgePreview': `export const BRIDGE_PREVIEW_TTL = 30000; export const fetchBridgePreview = (params,onUpdate) => { const h = globalThis.__moveSessionHarness; h.preview ??= { calls: [], pending: [], responses: [], defaultResponse: { readAt: Date.now(), nativeFee: 10n ** 15n, minimumReceived: 9n * 10n ** 17n, estimatedReceived: 95n * 10n ** 16n, nativeBalance: 10n ** 18n, sourceGas: 2n * 10n ** 15n } }; h.executionCount ??= 0; h.preview.calls.push(params); if (h.preview.fetch) return h.preview.fetch(params,onUpdate); return Promise.resolve(h.preview.responses.shift() ?? h.preview.defaultResponse); }; export const isFreshBridgePreview = (preview, now = Date.now()) => Boolean(preview && preview.readAt <= now && now - preview.readAt < BRIDGE_PREVIEW_TTL); export const readBridgeReceiptEstimate = async () => undefined;`,
  '@/lib/wallet': `export const usePrivyWallet = () => ({ ...globalThis.__moveSessionHarness.wallet, sendTransaction: async () => ({ hash: '0x' }) });`,
  '@/app/trade/fxUi': `export const parseAmount = (value) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? BigInt(Math.round(parsed * 1e18)) : null; };`,
  '@/lib/transactionState': `export const resetTransactionAmounts = () => ({amount:'',deposit:'',mint:'',repay:'',withdraw:'',shares:'',fraction:0.5,leverage:2});`,
  '@/components/TokenIcon': `export const ChainIcon = () => null; export default () => null;`,
};

async function buildHarness(): Promise<string> {
  type BuildApi = { onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void; onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void };
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: root,
    plugins: [{ name: 'move-session-harness', setup(build: BuildApi) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, (args: { path: string }) => ({ path: args.path, namespace: 'mock' }));
      build.onResolve({ filter: /^@\// }, (args: { path: string }) => {
        if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
        const candidate = resolve(src, args.path.slice(2));
        if (args.path.endsWith('.module.css')) return { path: candidate, namespace: 'empty-css' };
        if (existsSync(candidate)) return { path: candidate };
        for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
        return { path: candidate };
      });
      build.onLoad({ filter: /.*/, namespace: 'mock' }, (args: { path: string }) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
      build.onResolve({ filter: /\.module\.css$/ }, (args: { path: string; resolveDir?: string }) => ({ path: resolve(args.resolveDir ?? root, args.path), namespace: 'empty-css' }));
      build.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: 'export default {};', loader: 'js' }));
    } }],
  });
  return result.outputFiles[0].text;
}

let bundle = '';
test.beforeAll(async () => { bundle = await buildHarness(); });

test('the Move page preserves execution through its destination-chain switch and resets on Edit', async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  const amount = page.getByRole('textbox', { name: 'Amount', exact: true });
  await amount.fill('12');
  await page.getByRole('button', { name: 'Send fxUSD to Base' }).click();
  await page.getByRole('button', { name: 'Confirm transfer' }).click();
  const progress = page.getByRole('heading', { name: 'Bridge execution in progress' });
  await expect(progress).toBeVisible();

  await page.evaluate(() => {
    const harness = (window as Window & { __moveSessionHarness: { wallet: { chainId: number }; rerender?: () => void } }).__moveSessionHarness;
    harness.wallet.chainId = 8453;
    harness.rerender?.();
  });
  await expect(progress).toBeVisible();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(amount).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Enter an amount' })).toBeVisible();
});

test('the recipient row is a status, and the developer disclosure reads as expert mode', async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  const recipient = page.getByText('Your wallet', { exact: true }).locator('xpath=../../..');
  await expect(recipient.getByText('Your wallet', { exact: true })).toBeVisible();
  await expect(recipient.getByText('0xaaaa…aaaa', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Transaction settings/ })).toBeVisible();
  await page.getByRole('button', { name: /Transaction settings/ }).click();
  const settings = page.getByRole('dialog', { name: 'Transaction settings' });
  await expect(settings).toBeVisible();
  const expert = settings.getByRole('checkbox', { name: 'Expert mode · custom contracts' });
  await expert.check();
  await expect(settings).toBeVisible();
  await expect(expert).toBeChecked();
  const sourceOft = settings.getByRole('textbox', { name: 'Ethereum OFT' });
  const destinationOft = settings.getByRole('textbox', { name: 'Base OFT' });
  await expect(sourceOft).toBeVisible();
  await expect(destinationOft).toBeVisible();
  await sourceOft.fill('0x1111111111111111111111111111111111111111');
  await destinationOft.fill('0x2222222222222222222222222222222222222222');
  await expect(sourceOft).toHaveValue('0x1111111111111111111111111111111111111111');
  await expect(destinationOft).toHaveValue('0x2222222222222222222222222222222222222222');
  await settings.getByRole('button', { name: 'Close transaction settings' }).click();
  // Signed out, the row offers only the alternate-recipient control; wallet
  // connection has its own primary action above.
  await page.evaluate(() => {
    const harness = (window as Window & { __moveSessionHarness: { wallet: { address?: string; authenticated: boolean }; rerender?: () => void } }).__moveSessionHarness;
    harness.wallet = { ...harness.wallet, address: undefined, authenticated: false };
    harness.rerender?.();
  });
  await expect(page.getByText('Not connected', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Recipient', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Connect wallet', { exact: true })).toHaveCount(0);
  const setRecipient = page.getByRole('button', { name: 'Set recipient', exact: true });
  await expect(setRecipient).toBeVisible();
  await expect(setRecipient).toHaveAttribute('aria-expanded', 'false');
  await expect(setRecipient).toHaveAttribute('aria-controls', 'move-recipient-address');
  await setRecipient.click();
  await expect(page.getByText('Recipient', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Destination wallet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use your wallet', exact: true })).toHaveAttribute('aria-expanded', 'true');
});

test('Move keeps a late quote bound to the current amount and recipient', async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await page.evaluate(() => {
    const harness = (window as Window & { __moveSessionHarness: any }).__moveSessionHarness;
    harness.preview = { calls: [], pending: [], responses: [], defaultResponse: { readAt: Date.now(), nativeFee: 10n ** 15n, minimumReceived: 9n * 10n ** 17n, estimatedReceived: 95n * 10n ** 16n, nativeBalance: 10n ** 18n, sourceGas: 2n * 10n ** 15n } };
    harness.preview.fetch = (params: unknown, update: unknown) => new Promise((resolve) => harness.preview.pending.push({ params, resolve, update }));
  });
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('1');
  await expect.poll(() => page.evaluate(() => (window as Window & { __moveSessionHarness: any }).__moveSessionHarness.preview.pending.length)).toBe(1);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const destination = page.getByRole('textbox', { name: 'Destination wallet' });
  const nextRecipient = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  await destination.fill(nextRecipient);
  await expect.poll(() => page.evaluate(() => (window as Window & { __moveSessionHarness: any }).__moveSessionHarness.preview.pending.length)).toBe(2);
  await page.evaluate(() => {
    const h = (window as Window & { __moveSessionHarness: any }).__moveSessionHarness;
    h.preview.current = { readAt: Date.now(), nativeFee: 10n ** 16n, minimumReceived: 95n * 10n ** 16n, estimatedReceived: 99n * 10n ** 16n, nativeBalance: 11n * 10n ** 15n };
    h.preview.pending[1].resolve(h.preview.current);
  });
  await expect(page.locator('section[aria-label="Receive assets"] strong').first()).toHaveText('0.99');
  await page.evaluate(() => {
    const h = (window as Window & { __moveSessionHarness: any }).__moveSessionHarness;
    h.preview.pending[0].resolve({ readAt: Date.now(), nativeFee: 10n ** 16n, minimumReceived: 80n * 10n ** 16n, estimatedReceived: 81n * 10n ** 16n, nativeBalance: 1n, sourceGas: 2n * 10n ** 15n });
  });
  await expect(page.locator('section[aria-label="Receive assets"] strong').first()).toHaveText('0.99');
  await expect(page.locator('dt').filter({ hasText: /^Minimum received$/ }).locator('xpath=following-sibling::dd')).toContainText('0.95 fxUSD');
  await expect(page.locator('dt').filter({ hasText: /^Bridge fee$/ }).locator('xpath=following-sibling::dd')).toContainText('0.01 ETH');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => {
    const h = (window as Window & { __moveSessionHarness: any }).__moveSessionHarness;
    h.preview.pending[0].update({ ...h.preview.current, estimatedReceived: 81n * 10n ** 16n, nativeBalance: 1n, sourceGas: 2n * 10n ** 15n });
  });
  await expect(page.locator('section[aria-label="Receive assets"] strong').first()).toHaveText('0.99');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => {
    const h = (window as Window & { __moveSessionHarness: any }).__moveSessionHarness;
    h.preview.pending[1].update({ ...h.preview.current, sourceGas: 2n * 10n ** 15n });
  });
  await expect(page.getByRole('alert')).toContainText('Your balance does not cover the bridge fee and estimated transaction gas');
  const review = page.getByRole('button', { name: 'Add ETH on Ethereum for fees' });
  await expect(review).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as Window & { __moveSessionHarness: any }).__moveSessionHarness.executionCount)).toBe(0);
});

test('Move expires and refreshes its quote, and blocks zero or invalid recipients with field errors', async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  const fresh = () => ({ readAt: Date.now(), nativeFee: 10n ** 15n, minimumReceived: 9n * 10n ** 17n, estimatedReceived: 95n * 10n ** 16n, nativeBalance: 10n ** 18n, sourceGas: 2n * 10n ** 15n });
  await page.evaluate((expired) => {
    const h = (window as Window & { __moveSessionHarness: any }).__moveSessionHarness;
    h.preview = { calls: [], pending: [], responses: [], defaultResponse: { readAt: Date.now(), nativeFee: 10n ** 15n, minimumReceived: 9n * 10n ** 17n, estimatedReceived: 95n * 10n ** 16n, nativeBalance: 10n ** 18n, sourceGas: 2n * 10n ** 15n } };
    h.preview.responses.push(expired);
  }, { ...fresh(), readAt: Date.now() - 31_000 });
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('1');
  await expect(page.getByRole('status')).toContainText('Quote expired');
  await page.evaluate((response) => { (window as Window & { __moveSessionHarness: any }).__moveSessionHarness.preview.responses.push(response); }, fresh());
  await page.getByRole('button', { name: 'Refresh quote' }).click();
  await expect(page.locator('section[aria-label="Receive assets"] strong').first()).toHaveText('0.95');
  const quote = page.locator('section[aria-label="Bridge quote"]');
  const callCount = await page.evaluate(() => (window as Window & { __moveSessionHarness: any }).__moveSessionHarness.preview.calls.length);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const destination = page.getByRole('textbox', { name: 'Destination wallet' });
  for (const value of ['0x0000000000000000000000000000000000000000', 'not an address']) {
    await destination.fill(value);
    await expect(destination).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toContainText('Enter a valid, non-zero destination address.');
    await expect(quote.getByText('Unavailable').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter a valid address' })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => (window as Window & { __moveSessionHarness: any }).__moveSessionHarness.executionCount)).toBe(0);
  }
  await expect.poll(() => page.evaluate(() => (window as Window & { __moveSessionHarness: any }).__moveSessionHarness.preview.calls.length)).toBe(callCount);
});
