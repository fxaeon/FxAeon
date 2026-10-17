import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const appRoot = resolve(__dirname, '../..');
const repoRoot = resolve(appRoot, '../..');
const tsxPackage = createRequire(resolve(appRoot, 'package.json')).resolve('tsx/package.json');
const esbuild = createRequire(tsxPackage)('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
const entry = resolve(appRoot, 'e2e/harness/wallet-asset-details-entry.tsx');
const mocks: Record<string, string> = {
  'next/link': "import React from 'react'; export default function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); }",
  'next/navigation': 'export function useRouter() { return { push() {} }; } export function usePathname() { return \'/portfolio\'; }',
};
const walletAddress = '0x930f0000000000000000000000000000000098b9';
let script = '';
let styles = '';

test.beforeAll(async () => {
  const src = resolve(appRoot, 'src');
  const result = await esbuild.build({
    entryPoints: [entry], outfile: resolve(appRoot, 'wallet-asset-details-lab.js'), bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
    jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts', '.module.css': 'local-css', '.png': 'empty', '.svg': 'empty' }, absWorkingDir: repoRoot,
    plugins: [{ name: 'wallet-asset-details-fixtures', setup(build: {
      onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => unknown): void;
      onLoad(options: { filter: RegExp; namespace?: string }, callback: (args: { path: string }) => unknown): void;
    }) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({ path: args.path, namespace: 'asset-details-mock' }));
      build.onResolve({ filter: /^@\// }, (args) => {
        const candidate = resolve(src, args.path.slice(2));
        if (existsSync(candidate) && statSync(candidate).isFile()) return { path: candidate };
        for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
        return { path: candidate };
      });
      build.onLoad({ filter: /.*/, namespace: 'asset-details-mock' }, (args) => ({ loader: 'tsx', resolveDir: appRoot, contents: mocks[args.path] }));
    } }],
  });
  script = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '';
  styles = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  if (!script) throw new Error('WalletAssetDetails fixture bundle was not emitted.');
});

async function mount(page: Page, fixture: 'Fresh price' | 'Stale price' | 'Dust balance' = 'Fresh price') {
  await page.setContent('<html data-theme="dark"><body><div id="root"></div></body></html>');
  // The app's Tailwind mono stack; the grouped address measures its lines in it.
  await page.addStyleTag({ content: '.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }' });
  if (styles) await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: script });
  await expect.poll(() => page.evaluate(() => (window as Window & { __walletAssetDetailsHarnessReady?: boolean }).__walletAssetDetailsHarnessReady)).toBe(true);
  // The open sheet covers the fixture toolbar; switch fixtures without a pointer.
  if (fixture !== 'Fresh price') await page.getByRole('button', { name: fixture, exact: true }).dispatchEvent('click');
  const sheet = page.getByRole('dialog', { name: 'ETH on Ethereum', exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}

test('the asset sheet states the exact balance beside its value, never a rounded one', async ({ page }) => {
  const sheet = await mount(page);
  await expect(sheet.getByText('$2,961,600.00', { exact: true })).toBeVisible();
  await expect(sheet.getByText('1,234.000000000000000001 ETH', { exact: true })).toBeVisible();

  await mount(page, 'Dust balance');
  await expect(page.getByRole('dialog').getByText('0.000000000000000001 ETH', { exact: true })).toBeVisible();
});

test('the price is shown only while it is fresh', async ({ page }) => {
  let sheet = await mount(page);
  const price = sheet.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Price$/ }) });
  await expect(price.locator('dd')).toHaveText('$2,400.00');

  sheet = await mount(page, 'Stale price');
  const stalePrice = sheet.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Price$/ }) });
  await expect(stalePrice.getByRole('status', { name: 'Price unavailable', exact: true })).toBeVisible();
  await expect(stalePrice.locator('dd')).not.toContainText('$');
  await expect(sheet.getByRole('status', { name: 'Holding value unavailable', exact: true })).toBeVisible();
});

test('the wallet address reads in groups and still copies exactly', async ({ page }) => {
  const sheet = await mount(page);
  const address = sheet.getByRole('region', { name: 'Wallet address', exact: true }).locator('p').first();
  // Groups are spacing and <wbr> only, so the text is the address itself.
  await expect(address).toHaveText(walletAddress);
  await expect(address.locator('span[data-edge]')).toHaveCount(2);
  // Five groups per line: the emphasized first and last groups open and close the two lines.
  const lineTops = await address.locator('span > span').evaluateAll((groups) => groups.map((group) => group.getBoundingClientRect().top));
  const lines = lineTops.reduce<number[]>((tops, top) => (tops.some((seen) => Math.abs(seen - top) < 4) ? tops : [...tops, top]), []);
  expect(lineTops).toHaveLength(10);
  expect(lines).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('the sheet closes with a drawn icon, not a text glyph', async ({ page }) => {
  const sheet = await mount(page);
  const close = sheet.getByRole('button', { name: 'Close asset details', exact: true });
  await expect(close.locator('svg')).toHaveCount(1);
  await expect(close).toHaveText('');
  await close.click();
  await expect(page.getByTestId('sheet-state')).toHaveText('closed');
});
