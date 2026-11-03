import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test, expect } from '../fixtures/test';
import { buildLabGlobalCss } from '../harness/portfolio-states-build';

test.use({ telegram: false });
const appRoot = resolve(__dirname, '../..');
const appRequire = createRequire(resolve(appRoot, 'package.json'));
const esbuild = createRequire(appRequire.resolve('tsx/package.json'))('esbuild') as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
let script: string, css: string;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const built = await esbuild.build({
    stdin: { contents: `import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { FxSaveHistory } from './src/components/FxSaveHistory';
      import { BorrowFundingHistory } from './src/components/BorrowFundingHistory';
      const client = new QueryClient();
      globalThis.refreshCharts = () => { globalThis.chartShift = 1; return client.invalidateQueries(); };
      function Lab() { const [market, setMarket] = useState('ETH'); return <><button onClick={() => setMarket(market === 'ETH' ? 'BTC' : 'ETH')}>Switch market</button>
        {location.search.includes('borrow') ? <BorrowFundingHistory market={market} rate={null} status="unavailable"/> : <FxSaveHistory/>}</>; }
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Lab/></QueryClientProvider>);`, loader: 'tsx', resolveDir: appRoot },
    absWorkingDir: appRoot, tsconfig: resolve(appRoot, 'tsconfig.json'), bundle: true, write: false,
    outfile: 'chart-lab.js', format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.module.css': 'local-css', '.css': 'css' },
    plugins: [{ name: 'history-fixtures', setup(build: {
      onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => unknown): void;
      onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => unknown): void;
    }) {
      build.onResolve({ filter: /^@\/lib\/(?:fxSaveShareHistory|fx\/borrowFundingHistory)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path.endsWith('fxSaveShareHistory') ? `
        export const HISTORY_DAY_MS = 86400000;
        export const FX_SAVE_SHARE_HISTORY_SOURCE = 'https://etherscan.io/address/0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39#readContract';
        export async function fetchFxSaveShareHistory(signal, days) {
          const end = Math.floor(Date.now()/HISTORY_DAY_MS)*HISTORY_DAY_MS-HISTORY_DAY_MS;
          return Array.from({length:days+31}, (_,i)=>{ const day = i + (globalThis.chartShift || 0); return { timestamp:end-(days+30-day)*HISTORY_DAY_MS, price:1.1+day*.001 }; })
            .filter((_,i)=>!location.search.includes('gap') || i < 40 || i > 45);
        }` : `
        export async function readBorrowFundingHistory(market, {range}) {
          const endAt = Math.floor(Date.now()/86400000)*86400;
          const startAt = endAt - (range === '1M' ? 30 : 365)*86400;
          const span = endAt-startAt;
          const rows = [{timestamp:startAt-86400, ratio:100000000000000000n},
            {timestamp:startAt+span*.2, ratio:300000000000000000n},
            {timestamp:startAt+span*.9, ratio:0n}];
          if(globalThis.chartShift) rows.splice(1,0,{timestamp:startAt+span*.1,ratio:200000000000000000n});
          return {market,startAt,endAt,indexedAt:endAt,averageRatio:210000000000000000n,snapshots:rows};
        }` }));
    } }],
  });
  script = built.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  css = (await buildLabGlobalCss()) + built.outputFiles.find(file => file.path.endsWith('.css'))!.text;
});

async function open(page: import('@playwright/test').Page, chart = 'earn') {
  await page.route('http://charts.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: path === '/lab.js' ? 'text/javascript' : path === '/lab.css' ? 'text/css' : 'text/html',
      body: path === '/lab.js' ? script : path === '/lab.css' ? css : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/lab.css"><div id="scroll" style="height:100dvh;overflow-y:auto"><main id="root" style="max-width:520px;margin:auto;padding:16px"></main><div style="height:1600px"></div></div><script src="/lab.js"></script>' });
  });
  await page.goto(`http://charts.test/?${chart}`);
  await expect(page.getByRole('slider')).toBeVisible();
}
const marker = (page: import('@playwright/test').Page) => page.locator('[data-chart-indicator]');

for (const chart of ['earn', 'borrow']) {
  test(`${chart}: exact keyboard readouts, bounded motion, stable selection on refresh and context reset`, async ({ page, requests }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page, chart);
    if (chart === 'earn') await page.getByRole('button', { name: 'Share value', exact: true }).click();
    const slider = page.getByRole('slider');
    await slider.focus(); await slider.press('Home'); await slider.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuenow', '1');
    const selected = await slider.getAttribute('aria-valuetext');
    const reading = chart === 'earn' ? page.locator('strong').first() : page.locator('[data-active="true"] strong');
    await expect(reading).toHaveText(chart === 'earn' ? '$1.131' : '≈ 0.0273% / 8h');
    const readoutNode = await reading.elementHandle();
    await expect(marker(page)).toHaveCSS('transition-duration', '0.12s');
    expect(await reading.evaluate(node => node.getAnimations().length)).toBe(0);
    const bounds = (await slider.boundingBox())!;
    await page.mouse.move(bounds.x + 10, bounds.y + 75); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width + 6, bounds.y + 75);
    await expect(slider).toHaveAttribute('aria-valuenow', chart === 'earn' ? '30' : '2');
    await expect(marker(page)).toHaveCSS('transition-duration', '0s');
    await page.mouse.up();
    await expect(marker(page).locator('line')).toHaveCSS('opacity', '0');
    await slider.press('Home'); await slider.press('ArrowRight');
    await page.evaluate(() => (window as unknown as { refreshCharts: () => Promise<void> }).refreshCharts());
    await expect(slider).toHaveAttribute('aria-valuetext', selected!);
    expect(await readoutNode!.evaluate(node => node.isConnected)).toBe(true);
    await expect(slider).toHaveAttribute('aria-valuenow', chart === 'earn' ? '0' : '2');
    await slider.press('End');
    await expect(slider).toHaveAttribute('aria-valuenow', chart === 'earn' ? '30' : '3');
    await slider.press('ArrowLeft'); await slider.press('ArrowUp');
    await expect(slider).toHaveAttribute('aria-valuenow', chart === 'earn' ? '30' : '3');
    await slider.press('Escape');
    await expect(marker(page).locator('line')).toHaveCSS('opacity', '0');
    await slider.press('Home');
    if (chart === 'earn') await page.getByRole('button', { name: '90D', exact: true }).click();
    else await page.getByRole('button', { name: 'Switch market', exact: true }).click();
    await expect(marker(page).locator('line')).toHaveCSS('opacity', '0');
    await slider.focus(); await slider.press('Home');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(marker(page)).toHaveCSS('transition-duration', '0s');
    await slider.press('End');
    expect(await marker(page).evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
    expect(requests.all.filter(url => /llama\.fi|defillama\.com/.test(url))).toEqual([]);
  });

  test(`${chart}: native touch capture scrubs to edges, release persists, vertical swipe scrolls`, async ({ page }, testInfo) => {
    await open(page, chart);
    const slider = page.getByRole('slider');
    const bounds = (await slider.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 7 }] });
    const y = bounds.y + 70;
    await touch('touchStart', bounds.x + 10, y);
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await expect(marker(page)).toHaveAttribute('data-immediate', 'true');
    await expect(marker(page)).toHaveCSS('transition-duration', '0s');
    await touch('touchMove', bounds.x + bounds.width + 5, y);
    const last = await slider.getAttribute('aria-valuemax');
    await expect(slider).toHaveAttribute('aria-valuenow', last!);
    await touch('touchEnd', 0, 0);
    await expect(slider).toHaveAttribute('aria-valuenow', last!);
    await expect(marker(page)).not.toHaveAttribute('data-immediate');
    await page.screenshot({ path: testInfo.outputPath(`${chart}-scrub-390.png`), fullPage: false });
    // The browser's native pan-y cancels inspection; it must not trap page scrolling.
    await touch('touchStart', bounds.x + 40, y);
    for (const delta of [20, 50, 100, 150]) await touch('touchMove', bounds.x + 40, y - delta);
    await touch('touchEnd', 0, 0);
    await expect.poll(() => page.locator('#scroll').evaluate(node => node.scrollTop)).toBeGreaterThan(30);
    await expect(marker(page).locator('line')).toHaveCSS('opacity', '0');
    await cdp.detach();
  });
}

test('Earn gaps break both the trace and indicator motion; pointer cancellation resets inspection', async ({ page }) => {
  await open(page, 'earn-gap');
  await page.getByRole('button', { name: 'Share value', exact: true }).click();
  const slider = page.getByRole('slider');
  expect((await slider.locator('path').getAttribute('d'))!.split('M').length).toBeGreaterThan(2);
  await slider.focus(); await slider.press('Home');
  const old = await marker(page).elementHandle();
  await slider.press('End');
  expect(await old!.evaluate(node => node.isConnected)).toBe(false);
  const bounds = (await slider.boundingBox())!;
  await slider.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 9, button: 0, isPrimary: true, clientX: bounds.x + 8, clientY: bounds.y + 50 });
  await expect(marker(page)).toHaveAttribute('data-immediate', 'true');
  await slider.dispatchEvent('pointercancel', { pointerId: 9, pointerType: 'touch' });
  await expect(marker(page)).not.toHaveAttribute('data-immediate');
  await expect(marker(page).locator('line')).toHaveCSS('opacity', '0');
});

test('Borrow pointer holds the previous snapshot across an uneven interval and retains its real baseline date', async ({ page }) => {
  await open(page, 'borrow');
  const slider = page.getByRole('slider');
  const bounds = (await slider.boundingBox())!;
  await page.mouse.move(bounds.x + 8, bounds.y + 80);
  const baseline = await slider.getAttribute('aria-valuetext');
  const expectedDate = await page.evaluate(() => new Date(Math.floor(Date.now()/86400000)*86400000-366*86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
  expect(baseline).toContain(expectedDate);
  await page.mouse.move(bounds.x + 8 + (bounds.width - 16) * .85, bounds.y + 80);
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  await expect(slider).toHaveAttribute('aria-valuetext', /0.0273% per eight hours/);
  await page.mouse.move(bounds.x + 8 + (bounds.width - 16) * .95, bounds.y + 80);
  await expect(slider).toHaveAttribute('aria-valuetext', /0% per eight hours/);
});
