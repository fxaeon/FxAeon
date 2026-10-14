import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test('legacy all-token snapshots only display supported holdings plus FXN', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Legacy all-token snapshot', exact: true }).click();
  await page.getByRole('combobox', { name: 'Portfolio network' }).selectOption('all');
  await expect(page.getByRole('button', { name: 'View ETH on Ethereum', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View FXN on Ethereum', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /View Unrelated/ })).toHaveCount(0);
});

const appRoot = resolve(__dirname, '../..');
const repoRoot = resolve(appRoot, '../..');
const tsxPackage = createRequire(resolve(appRoot, 'package.json')).resolve('tsx/package.json');
const esbuild = createRequire(tsxPackage)('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
const entry = resolve(appRoot, 'e2e/harness/portfolio-assets-entry.tsx');
let script = '';
let styles = '';

test.beforeAll(async () => {
  const src = resolve(appRoot, 'src');
  const result = await esbuild.build({
    entryPoints: [entry], outfile: resolve(appRoot, 'portfolio-assets-lab.js'), bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
    jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts', '.module.css': 'local-css' }, absWorkingDir: repoRoot,
    plugins: [{ name: 'portfolio-assets-fixtures', setup(build: {
      onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => unknown): void;
      onLoad(options: { filter: RegExp; namespace?: string }, callback: (args: { path: string }) => unknown): void;
    }) {
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next-link-fixture', namespace: 'portfolio-mock' }));
      build.onResolve({ filter: /^@\// }, (args) => {
        if (args.path === '@/components/WalletAssetDetails') return { path: 'wallet-asset-details-fixture', namespace: 'portfolio-mock' };
        const candidate = resolve(src, args.path.slice(2));
        if (existsSync(candidate) && statSync(candidate).isFile()) return { path: candidate };
        for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
        if (existsSync(candidate) && statSync(candidate).isDirectory()) {
          for (const extension of ['.tsx', '.ts']) if (existsSync(resolve(candidate, `index${extension}`))) return { path: resolve(candidate, `index${extension}`) };
        }
        return { path: candidate };
      });
      build.onLoad({ filter: /.*/, namespace: 'portfolio-mock' }, (args) => ({
        loader: 'tsx',
        resolveDir: appRoot,
        contents: args.path === 'next-link-fixture'
          ? "import React from 'react'; export default function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); }"
          : 'export function WalletAssetModal() { return null; }',
      }));
    } }],
  });
  script = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '';
  styles = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  if (!script) throw new Error('PortfolioAssets fixture bundle was not emitted.');
});

async function mount(page: Page) {
  await page.setContent('<html data-theme="official"><body><div id="root"></div></body></html>');
  if (styles) await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: script });
  await expect.poll(() => page.evaluate(() => (window as Window & { __portfolioAssetsHarnessReady?: boolean }).__portfolioAssetsHarnessReady)).toBe(true);
  await expect(page.getByRole('region', { name: 'Assets', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Portfolio network' }).selectOption('8453');
}

test('a pending filtered network keeps loading copy instead of reporting a balance failure', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Base pending', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Loading assets', exact: true })).toBeVisible();
  await expect(page.getByText('Couldn’t load balances', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No assets on Base yet', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Balances loading.', { exact: true })).toBeAttached();
});

test('a completed empty network is shown as empty only after its read is ready', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Base zero', exact: true }).click();
  await expect(page.getByText('No assets on Base yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Receive assets', exact: true })).toHaveAttribute('href', '/qr');
  await expect(page.getByRole('status', { name: 'Loading assets', exact: true })).toHaveCount(0);
  await expect(page.getByText('Couldn’t load balances', { exact: true })).toHaveCount(0);
});

test('a failed network exposes Retry and invokes the supplied refresh callback', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Base unavailable', exact: true }).click();
  await expect(page.getByText('Couldn’t load balances', { exact: true })).toBeVisible();
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await retry.click();
  await expect(page.getByTestId('retry-count')).toHaveText('1');
  const pending = page.getByRole('button', { name: 'Refreshing…', exact: true });
  await expect(pending).toBeDisabled();
  await expect(pending).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('button', { name: 'Resolve asset refresh', exact: true }).click();
  await expect(retry).toBeEnabled();
  await expect(page.getByTestId('retry-count')).toHaveText('1');
});

test('verified holdings remain visible while the same network is refreshing', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Base refreshing with holding', exact: true }).click();
  const holding = page.getByRole('button', { name: 'View fxUSD on Base', exact: true });
  await expect(holding).toBeVisible();
  await expect(holding).toContainText('fxUSD');
  await expect(holding).toContainText('42');
  await expect(page.getByRole('status', { name: 'Loading assets', exact: true })).toHaveCount(0);
});
