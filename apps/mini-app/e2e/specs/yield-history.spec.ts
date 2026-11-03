import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test, expect } from '../fixtures/test';
import { buildLabGlobalCss } from '../harness/portfolio-states-build';

test.use({ telegram: false });
const appRoot = resolve(__dirname, '../..');
const appRequire = createRequire(resolve(appRoot, 'package.json'));
const esbuild = createRequire(appRequire.resolve('tsx/package.json'))('esbuild') as { build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ path: string; text: string }> }> };
let script: string;
let css: string;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const built = await esbuild.build({
    stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { FxSaveHistory } from './src/components/FxSaveHistory';
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><FxSaveHistory /></QueryClientProvider>);`, loader: 'tsx', resolveDir: appRoot },
    absWorkingDir: appRoot, tsconfig: resolve(appRoot, 'tsconfig.json'), bundle: true, write: false,
    outfile: 'nav-lab.js', format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.module.css': 'local-css', '.css': 'css' },
    plugins: [{ name: 'nav-fixture', setup(build: {
      onResolve(options: { filter: RegExp }, callback: () => unknown): void;
      onLoad(options: { filter: RegExp; namespace: string }, callback: () => unknown): void;
    }) {
      build.onResolve({ filter: /^@\/lib\/fxSaveShareHistory$/ }, () => ({ path: 'nav', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
        export const HISTORY_DAY_MS = 86400000;
        export const FX_SAVE_SHARE_HISTORY_SOURCE = 'https://etherscan.io/address/0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39#readContract';
        export async function fetchFxSaveShareHistory(signal, days) {
          if (globalThis.__navFailure) throw Error('Archive unavailable');
          return Array.from({length:days}, (_,i)=>({timestamp:Date.now()-(days-1-i)*HISTORY_DAY_MS, price:1.1+i/10000}));
        }` }));
    } }],
  });
  script = built.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  css = (await buildLabGlobalCss()) + built.outputFiles.find(file => file.path.endsWith('.css'))!.text;
});

for (const width of [320, 390, 1280]) {
  test(`NAV inspection fits ${width}px with touch, keyboard and reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('http://nav.test/**', route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ contentType: path === '/lab.js' ? 'text/javascript' : path === '/lab.css' ? 'text/css' : 'text/html',
        body: path === '/lab.js' ? script : path === '/lab.css' ? css : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/lab.css"><main id="root" style="max-width:520px;margin:auto;padding:16px"></main><script src="/lab.js"></script>' });
    });
    await page.goto('http://nav.test/');
    const chart = page.getByRole('slider', { name: 'Explore fxSAVE share value' });
    await expect(chart).toHaveAttribute('aria-valuemax', '29');
    await page.getByRole('button', { name: '90D', exact: true }).click();
    await expect(chart).toHaveAttribute('aria-valuemax', '89');
    await chart.focus();
    await chart.press('Home');
    await expect(chart).toHaveAttribute('aria-valuetext', /\$1\.10 per fxSAVE/);
    await chart.press('ArrowRight');
    await expect(chart).toHaveAttribute('aria-valuetext', /\$1\.1001 per fxSAVE/);
    await chart.press('End');
    await expect(chart).toHaveAttribute('aria-valuetext', /\$1\.1089 per fxSAVE/);
    const bounds = (await chart.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await chart.dispatchEvent('pointerdown', { clientX: bounds.x + 9, clientY: bounds.y + 50, pointerType: 'touch' });
    await chart.dispatchEvent('pointerleave', { pointerType: 'touch' });
    await expect(chart).toHaveAttribute('aria-valuenow', '0');
    await expect(page.getByRole('button', { name: 'APY', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Share value source/ })).toHaveAttribute('href', /etherscan.io/);
    await page.getByRole('button', { name: 'About Share value', exact: true }).click();
    await expect(page.getByText(/not a market quote, realized APY or a forecast/)).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.locator('strong').first().evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    await page.evaluate(() => { (window as Window & { __navFailure?: boolean }).__navFailure = true; });
    await page.getByRole('button', { name: '30D', exact: true }).click();
    // Cached range remains readable; use a new page to exercise first-load failure.
    await page.addInitScript(() => { (window as Window & { __navFailure?: boolean }).__navFailure = true; });
    await page.reload();
    await expect(page.getByText('Share value history unavailable')).toBeVisible();
    await page.evaluate(() => { (window as Window & { __navFailure?: boolean }).__navFailure = false; });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(chart).toBeVisible();
  });
}

test('unconfigured archive reads leave the real Earn form usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/earn');
  const history = page.getByRole('region', { name: 'fxSAVE performance' });
  const amount = page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true });
  await expect(amount).toBeVisible();
  expect(await history.evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThan(await amount.evaluate(node => node.getBoundingClientRect().bottom));
  await history.scrollIntoViewIfNeeded();
  await expect(history.getByText('Share value history unavailable')).toBeVisible();
});
