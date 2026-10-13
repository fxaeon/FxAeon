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
  '@/components/ActionReview': `import React from 'react'; export const ActionReview = ({editor, onStageChange}) => { const [stage,setStage] = React.useState('input'); const move = (next) => { setStage(next); onStageChange?.(next); }; if (stage === 'input') return <>{editor}<button type="button" onClick={() => move('review')}>Review transfer</button></>; if (stage === 'review') return <section><h2>Reviewed bridge route</h2><button type="button" onClick={() => move('executing')}>Confirm transfer</button><button type="button" onClick={() => move('input')}>Edit</button></section>; return <section><h2>Bridge execution in progress</h2><button type="button" onClick={() => move('input')}>Edit</button></section>; };`,
  // Trade's illustration shares ProductSections with MoveSections; its unused
  // Segmented import must still be exported by this isolated module mock.
  '@/components/ProtocolForm': `import React from 'react'; export const Segmented = () => null; export const AmountField = ({label,value,onChange}) => <label>{label}<input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} /></label>; export const TokenSelect = ({label,value,options,onChange}) => <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((item) => <option key={item} value={item}>{item}</option>)}</select>;`,
  '@/components/WalletDataProvider': `export const useMoveBalances = () => ({ data: { balances: {} }, status: 'ready', refresh: async () => {} });`,
  '@/lib/fx': `export const asFxSdkRpcTransport = (value) => value; export const assertAddress = (value) => value; export const assertBridgeActionTarget = () => {}; export const advancedBridgePolicy = () => ({}); export const assertChecksummedAddress = (value) => value; export const assertPublicClientChain = () => {}; export const bridgeDeliveryLowerBound = () => 0n; export const getBridgeApprovalAllowance = async () => 0n; export const getFxReadFacade = () => ({}); export const withReadDeadline = (value) => value; export const getPublicClient = () => ({ readContract: async () => 0n }); export const planBridgeRoute = async () => ({}); export const resolveBridgeApprovalTokenAddress = () => '0x0000000000000000000000000000000000000001'; export const resolveBridgeTokenAddress = () => '0x0000000000000000000000000000000000000001'; export const requireRpcUrl = () => 'http://localhost'; export const restoreSignatureRequiredDraftFromSearch = () => undefined; export const validateAdvancedBridgeContracts = async () => ({});`,
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
  await page.getByRole('button', { name: 'Review transfer' }).click();
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
  await expect(page.getByRole('button', { name: 'Review transfer' })).toBeVisible();
});

test('the recipient row is a status, and the developer disclosure reads as expert mode', async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  const recipient = page.getByText('Recipient', { exact: true }).locator('xpath=../..');
  await expect(recipient.getByText('Your wallet', { exact: true })).toBeVisible();
  await expect(recipient.getByText('0xaaaa…aaaa', { exact: true })).toBeVisible();
  // Signed out, the row says so instead of looking like a second connect control.
  await page.evaluate(() => {
    const harness = (window as Window & { __moveSessionHarness: { wallet: { address?: string; authenticated: boolean }; rerender?: () => void } }).__moveSessionHarness;
    harness.wallet = { ...harness.wallet, address: undefined, authenticated: false };
    harness.rerender?.();
  });
  await expect(recipient.getByText('Not connected', { exact: true })).toBeVisible();
  await expect(recipient.getByText('Connect wallet', { exact: true })).toHaveCount(0);
  const disclosure = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Expert mode' }) });
  await expect(disclosure.locator('summary').first()).toHaveText('Expert mode · custom contracts');
  await expect(disclosure).not.toHaveAttribute('open');
});
