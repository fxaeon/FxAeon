import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const app = resolve(__dirname, '../..');
const src = resolve(app, 'src');
const appRequire = createRequire(resolve(app, 'package.json'));
const esbuild = createRequire(appRequire.resolve('tsx/package.json'))('esbuild') as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
const outdir = resolve(app, 'e2e/.price-runtime-memory');
let files: Map<string, string>;
let runtimePaths: Set<string>;

// Real wrapper, runtime, context, demand registry and freshness merger. Only
// public feed/cache parsing and socket I/O are controlled; no wallet is created.
const mocks: Record<string, string> = {
  '@/lib/prices': `
    export const USD_PRICE_CACHE_KEY = 'price-boundary-cache';
    export const USD_PRICE_CACHE_MAX_AGE_MS = 3600000;
    export const USD_PRICE_ASSET_COUNT = 2;
    export const parseUsdPriceCache = value => value;
    export function fetchUsdPrices(_fetch, signal) {
      const h = globalThis.__priceBoundary;
      h.reads++; h.activeReads++;
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (value, error) => {
          if (done) return; done = true; h.activeReads--;
          signal?.removeEventListener('abort', abort);
          error ? reject(error) : resolve(value);
        };
        const abort = () => finish(null, new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        h.finishRead = () => { const now = Date.now(); finish({prices:{ETH:100,WBTC:200}, updatedAt:now, updatedAts:{ETH:now,WBTC:now}}); };
      });
    }
  `,
  '@/lib/liveMarket': `
    export const LIVE_QUOTE_MAX_AGE_MS = 20000;
    export const isLiveQuoteFresh = () => false;
    export function createCoinbaseTickerController() {
      const h = globalThis.__priceBoundary; h.controllers++;
      let active = false;
      return {setActive(next) { if (next !== active) { h.activeSockets += next ? 1 : -1; active = next; h.maxSockets = Math.max(h.maxSockets,h.activeSockets); } },
        stop() { if(active) { h.activeSockets--; active = false; } }};
    }
  `,
};

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const result = await esbuild.build({
    stdin: { contents: `
      import React, {useEffect,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import RoutePriceProvider from '@/components/RoutePriceProvider';
      import {useUsdPrices} from '@/components/PriceContext';
      import {priceDemandRegistry} from '@/lib/priceDemand';
      const h = globalThis.__priceBoundary = {mounts:0,unmounts:0,reads:0,activeReads:0,controllers:0,activeSockets:0,maxSockets:0,refreshes:0};
      function Child() {
        const snapshot = useUsdPrices();
        const [draft,setDraft] = useState('');
        useEffect(() => { h.mounts++; h.childReadyAt = performance.now(); return () => { h.unmounts++; }; },[]);
        useEffect(() => {
          let release;
          h.setDemand = active => { release?.(); release = active ? priceDemandRegistry.acquire() : undefined; };
          if(new URLSearchParams(location.search).get('demand') !== 'off') h.setDemand(true);
          return () => release?.();
        },[]);
        useEffect(() => { h.snapshot = {prices:snapshot.prices,status:snapshot.status,updatedAt:snapshot.updatedAt,updatedAts:snapshot.updatedAts,refreshing:snapshot.refreshing};
          h.refresh = () => snapshot.refresh().then(() => { h.refreshes++; }); },[snapshot]);
        return <main><input aria-label="Draft" value={draft} onChange={e=>setDraft(e.target.value)}/><output data-status>{snapshot.status}</output></main>;
      }
      const root = createRoot(document.getElementById('root'));
      h.unmount = () => root.unmount();
      root.render(<RoutePriceProvider><Child/></RoutePriceProvider>);
    `, resolveDir: app, sourcefile: 'price-boundary-entry.tsx', loader: 'tsx' },
    outdir, entryNames: 'entry', chunkNames: '[name]-[hash]', splitting: true,
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2020', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, absWorkingDir: app, logLevel: 'error',
    plugins: [{ name: 'price-boundary-feeds', setup(build: {
      onResolve(options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown): void;
      onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => unknown): void;
    }) {
      build.onResolve({ filter: /^@\// }, ({ path }) => {
        if (mocks[path]) return { path, namespace: 'price-feed' };
        const candidate = resolve(src, path.slice(2));
        for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) if (existsSync(candidate + suffix)) return { path: candidate + suffix };
        return { path: candidate };
      });
      build.onResolve({ filter: /^\.\.?\// }, ({ path, resolveDir }) => {
        const target = resolve(resolveDir ?? app, path).replace(/\.(ts|tsx)$/, '');
        const mocked = Object.keys(mocks).find(id => resolve(src, id.slice(2)) === target);
        return mocked ? { path: mocked, namespace: 'price-feed' } : undefined;
      });
      build.onLoad({ filter: /.*/, namespace: 'price-feed' }, ({ path }) => ({ contents: mocks[path], loader: 'js', resolveDir: app }));
    } }],
  });
  files = new Map(result.outputFiles.map(file => [`/${relative(outdir, file.path).replaceAll('\\', '/')}`, file.text]));
  runtimePaths = new Set([...files.keys()].filter(path => /\/PriceProvider-/.test(path)));
  expect(runtimePaths.size).toBe(1);
});

async function open(page: Page, { demand = true, cached = false, fail = false } = {}) {
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  let requested = false;
  await page.route('http://price-boundary.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') {
      const cache = cached ? `localStorage.setItem('price-boundary-cache', JSON.stringify({prices:{ETH:90,WBTC:180},status:'ready',updatedAt:Date.now()-1000,updatedAts:{ETH:Date.now()-1000,WBTC:Date.now()-1000}}));` : '';
      return route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${cache}</script><script type="module" src="/entry.js"></script>` });
    }
    if (runtimePaths.has(path)) { requested = true; await gate; if (fail) { fail = false; return route.fulfill({ status: 503, body: 'Runtime unavailable' }); } }
    return route.fulfill({ contentType: 'text/javascript', body: files.get(path) ?? '' });
  });
  await page.goto(`http://price-boundary.test/?demand=${demand ? 'on' : 'off'}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('textbox', { name: 'Draft' })).toBeVisible();
  await expect.poll(() => requested).toBe(true);
  return release;
}

async function state(page: Page) {
  return page.evaluate(() => (globalThis as unknown as { __priceBoundary: {
    mounts: number; unmounts: number; reads: number; activeReads: number; activeSockets: number; maxSockets: number;
    refreshes: number; snapshot: { status: string; prices: Record<string, number>; updatedAt: number | null };
  } }).__priceBoundary);
}

test('wallet children mount before price loading and retain their DOM, draft and focus after arrival', async ({ page }) => {
  const release = await open(page);
  await page.getByRole('textbox', { name: 'Draft' }).fill('keep this amount');
  await page.evaluate(`window.__originalDraft = document.querySelector('input'); void window.__priceBoundary.refresh();`);
  expect((await state(page)).snapshot.status).toBe('loading');
  expect((await state(page)).refreshes).toBe(0);
  expect((await state(page)).reads).toBe(0);
  release();
  await expect.poll(async () => (await state(page)).reads).toBe(1);
  await page.evaluate(`window.__priceBoundary.finishRead()`);
  await expect.poll(async () => (await state(page)).snapshot.status).toBe('ready');
  await expect.poll(async () => (await state(page)).refreshes).toBe(1);
  await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('keep this amount');
  expect(await page.evaluate(`document.querySelector('input') === window.__originalDraft`)).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Draft' })).toBeFocused();
  expect((await state(page)).mounts).toBe(1);
  expect((await state(page)).unmounts).toBe(0);
  expect((await state(page)).maxSockets).toBe(1);
});

test('late demand restores cache as stale, keeps timestamps, then publishes verified quote progress', async ({ page }) => {
  const release = await open(page, { demand: false, cached: true });
  release();
  await expect.poll(async () => (await state(page)).activeSockets).toBe(0);
  // Wait for runtime publication, not just for the initial context default.
  await expect.poll(() => page.evaluate(`window.__priceBoundary.controllers`)).toBeGreaterThan(0);
  expect((await state(page)).reads).toBe(0);
  await page.evaluate(`window.__priceBoundary.setDemand(true)`);
  await expect.poll(async () => (await state(page)).snapshot.status).toBe('stale');
  const cached = (await state(page)).snapshot;
  expect(cached.prices.ETH).toBe(90);
  expect(cached.updatedAt).not.toBeNull();
  expect((await state(page)).reads).toBe(1);
  await page.evaluate(`window.__priceBoundary.finishRead()`);
  await expect.poll(async () => (await state(page)).snapshot.status).toBe('ready');
  expect((await state(page)).snapshot.prices.ETH).toBe(100);
  expect((await state(page)).snapshot.updatedAt!).toBeGreaterThan(cached.updatedAt!);
  await page.evaluate(`window.__priceBoundary.setDemand(false)`);
  await expect.poll(async () => (await state(page)).activeSockets).toBe(0);
  expect((await state(page)).maxSockets).toBe(1);
});

test('unmount before the runtime arrives releases refresh waiters and starts no price reads', async ({ page }) => {
  const release = await open(page);
  await page.evaluate(`void window.__priceBoundary.refresh(); window.__priceBoundary.unmount();`);
  await expect.poll(async () => (await state(page)).refreshes).toBe(1);
  release();
  await expect.poll(() => page.evaluate(`document.querySelector('main') === null`)).toBe(true);
  expect((await state(page)).unmounts).toBe(1);
  expect((await state(page)).reads).toBe(0);
});

test('a failed runtime import leaves children usable and retries on the next refresh', async ({ page }) => {
  const release = await open(page, { fail: true });
  await page.getByRole('textbox', { name: 'Draft' }).fill('preserve after failure');
  await page.evaluate(`void window.__priceBoundary.refresh()`);
  release();
  await expect.poll(async () => (await state(page)).snapshot.status).toBe('unavailable');
  await expect.poll(async () => (await state(page)).refreshes).toBe(1);
  await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('preserve after failure');
  expect((await state(page)).mounts).toBe(1);
  expect((await state(page)).reads).toBe(0);
  await page.evaluate(`void window.__priceBoundary.refresh()`);
  await expect.poll(async () => (await state(page)).reads).toBe(1);
  await page.evaluate(`window.__priceBoundary.finishRead()`);
  await expect.poll(async () => (await state(page)).snapshot.status).toBe('ready');
  await expect.poll(async () => (await state(page)).refreshes).toBe(2);
  expect((await state(page)).mounts).toBe(1);
  expect((await state(page)).unmounts).toBe(0);
});
