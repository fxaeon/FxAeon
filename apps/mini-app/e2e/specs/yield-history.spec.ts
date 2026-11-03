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
          globalThis.__navReads = (globalThis.__navReads ?? 0) + 1;
          const mode = new URLSearchParams(location.search).get('mode');
          const count = mode === 'short' ? 20 : days + 31;
          const end = Math.floor(Date.now()/HISTORY_DAY_MS)*HISTORY_DAY_MS - (mode === 'stale' ? 4*HISTORY_DAY_MS : 0);
          return Array.from({length:count}, (_,i)=>({timestamp:end-(count-1-i)*HISTORY_DAY_MS, price:1.1*Math.pow(mode === 'negative' ? .92 : 1.08,i/365)}))
            .filter((_,i) => (mode !== 'gap' || i < 40 || i > 45) && (mode !== 'lagging-yield' || (i !== 29 && i !== 30)));
        }` }));
    } }],
  });
  script = built.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  css = (await buildLabGlobalCss()) + built.outputFiles.find(file => file.path.endsWith('.css'))!.text;
});

async function openChart(page: import('@playwright/test').Page, mode = '') {
  await page.route('http://nav.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: path === '/lab.js' ? 'text/javascript' : path === '/lab.css' ? 'text/css' : 'text/html',
      body: path === '/lab.js' ? script : path === '/lab.css' ? css : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/lab.css"><main id="root" style="max-width:520px;margin:auto;padding:16px"></main><script src="/lab.js"></script>' });
  });
  await page.goto(`http://nav.test/?mode=${mode}`);
}

for (const width of [320, 390, 1280]) {
  test(`Yield and NAV inspection fit ${width}px with touch, keyboard and reduced motion`, async ({ page, requests }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openChart(page);
    const chart = page.getByRole('slider');
    await expect(chart).toHaveAccessibleName('Explore fxSAVE annualized return');
    await expect(chart).toHaveAttribute('aria-valuemax', '30');
    await expect(chart).toHaveAttribute('aria-valuetext', /8.00% annualized return/);
    await page.getByRole('button', { name: 'About Annualized return', exact: true }).click();
    await expect(page.getByText('Based on 30 days of vault value; includes valuation changes. Not the current quoted APY.', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '90D', exact: true }).click();
    await expect(chart).toHaveAttribute('aria-valuemax', '90');
    await chart.focus();
    await chart.press('Home');
    await expect(chart).toHaveAttribute('aria-valuenow', '0');
    await chart.press('ArrowRight');
    await expect(chart).toHaveAttribute('aria-valuenow', '1');
    await chart.press('End');
    await expect(chart).toHaveAttribute('aria-valuenow', '90');
    const bounds = (await chart.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await chart.dispatchEvent('pointerdown', { clientX: bounds.x + 9, clientY: bounds.y + 50, pointerType: 'touch', pointerId: 1, button: 0, isPrimary: true });
    await chart.dispatchEvent('pointerleave', { pointerType: 'touch' });
    await expect(chart).toHaveAttribute('aria-valuenow', '0');
    await page.getByRole('button', { name: 'Share value', exact: true }).click();
    await expect(chart).toHaveAccessibleName('Explore fxSAVE share value');
    await chart.focus(); await chart.press('Home');
    await expect(chart).toHaveAttribute('aria-valuetext', /per fxSAVE/);
    await expect(page.getByText(/Period return/)).toBeVisible();
    await page.getByRole('button', { name: 'Yield', exact: true }).click();
    expect(await page.evaluate(() => (window as Window & { __navReads?: number }).__navReads), 'switching metric never refetches NAV').toBe(2);
    await expect(page.getByRole('button', { name: 'APY', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Performance source/ })).toHaveAttribute('href', /etherscan.io/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ['Yield', 'Share value', '30D', '90D']) {
      const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect(await page.locator('strong').first().evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    if (width === 320) await page.screenshot({ path: testInfo.outputPath('earn-yield-320.png'), fullPage: true });
    await page.addInitScript(() => { (window as Window & { __navFailure?: boolean }).__navFailure = true; });
    await page.reload();
    await expect(page.getByText('Yield history unavailable')).toBeVisible();
    await page.evaluate(() => { (window as Window & { __navFailure?: boolean }).__navFailure = false; });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(chart).toBeVisible();
    expect(requests.all.filter(url => /(?:llama\.fi|defillama\.com)/.test(url))).toEqual([]);
  });
}

test('negative annualized returns remain visible and gaps break the trace', async ({ page }) => {
  await openChart(page, 'negative');
  const chart = page.getByRole('slider');
  await expect(chart).toHaveAttribute('aria-valuetext', /-8.00% annualized return/);
  await expect(chart.locator('text').last()).toContainText('-');
  await openChart(page, 'gap');
  await expect(chart).toBeVisible();
  const path = await chart.locator('path').getAttribute('d');
  expect(path!.split('M').length - 1).toBeGreaterThan(1);
});

test('insufficient warmup leaves Yield unavailable while valid share values remain usable', async ({ page }) => {
  await openChart(page, 'short');
  await expect(page.getByText('Yield history unavailable')).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(0);
  await page.getByRole('button', { name: 'Share value', exact: true }).click();
  await expect(page.getByRole('slider')).toBeVisible();
  await expect(page.getByText(/Period return/)).toHaveCount(0);
});

test('stale archive history cannot masquerade as a current return', async ({ page }) => {
  await openChart(page, 'stale');
  await expect(page.getByText('Yield history unavailable')).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(0);
});

test('Yield expires on its own observation time even when newer NAV has no full return window', async ({ page }) => {
  await page.clock.install({ time: new Date(Date.UTC(2026, 10, 3)) });
  await openChart(page, 'lagging-yield');
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuetext', /Nov 1: 8.00%/);
  await expect(page.getByText(/Period return/)).toHaveCount(0);
  await page.clock.fastForward(86_400_001);
  await expect(page.getByText('Yield history unavailable')).toBeVisible();
  await page.getByRole('button', { name: 'Share value', exact: true }).click();
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuetext', /Nov 3:/);
  // The missing 30-day boundary also prevents a full-range period summary.
  await expect(page.getByText(/Period return/)).toHaveCount(0);
});

test('unconfigured archive reads leave the real Earn form usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/earn');
  const history = page.getByRole('region', { name: 'fxSAVE performance' });
  const amount = page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true });
  await expect(amount).toBeVisible();
  expect(await history.evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThan(await amount.evaluate(node => node.getBoundingClientRect().bottom));
  await history.scrollIntoViewIfNeeded();
  await expect(history.getByText('Yield history unavailable')).toBeVisible();
});
