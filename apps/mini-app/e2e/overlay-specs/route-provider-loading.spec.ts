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
const outdir = resolve(app, 'e2e/.route-provider-memory');
let files: Map<string, string>;
let productPath: string;
let walletPath: string;

// Keep the real route/product/wallet boundaries and their asynchronous imports.
// Auth selection is covered by wallet-provider-boundary.spec.ts and the emitted
// configured startup checks; these leaves expose actual React mount counts.
const mocks: Record<string, string> = {
  'next/dynamic': `
    import {lazy,Suspense} from 'react';
    export default function dynamic(loader, options = {}) {
      const Component = lazy(loader);
      return props => <Suspense fallback={options.loading ? <options.loading/> : null}><Component {...props}/></Suspense>;
    }
  `,
  'next/navigation': `export const usePathname = () => globalThis.__routeLoading.path;`,
  '@/components/ProviderLoadingState': `export const ProviderLoadingState = () => <div role="status">Loading providers</div>;`,
  '@/components/RoutePriceProvider': `
    import {useEffect} from 'react';
    export default function Price({children}) {
      useEffect(() => { const h=globalThis.__routeLoading; h.priceMounts++; return () => {h.priceUnmounts++;}; },[]);
      return children;
    }
  `,
  '@/components/ClientWalletProvider': `
    import {useEffect} from 'react';
    globalThis.__routeLoading.walletEvaluations++;
    export default function Wallet({children}) {
      useEffect(() => { const h=globalThis.__routeLoading; h.walletMounts++; return () => {h.walletUnmounts++;}; },[]);
      return <section data-wallet-provider>{children}</section>;
    }
  `,
};

test.beforeAll(async () => {
  const result = await esbuild.build({
    stdin: { contents: `
      import {useEffect,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import RouteProviders from '@/components/RouteProviders';
      const h=globalThis.__routeLoading={path:location.pathname,mounts:0,unmounts:0,walletEvaluations:0,walletMounts:0,walletUnmounts:0,priceMounts:0,priceUnmounts:0};
      function Child(){
        const [draft,setDraft]=useState('');
        useEffect(()=>{h.mounts++;return ()=>{h.unmounts++;};},[]);
        return <input aria-label="Draft" value={draft} onChange={e=>setDraft(e.target.value)}/>;
      }
      function App(){
        const [,update]=useState(0);
        h.navigate=path=>{h.path=path;update(n=>n+1);};
        return <RouteProviders><Child/></RouteProviders>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `, resolveDir: app, sourcefile: 'route-provider-entry.tsx', loader: 'tsx' },
    outdir, entryNames: 'entry', chunkNames: '[name]-[hash]', splitting: true,
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2020', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_PRIVY_APP_ID': '"configured-fixture"' },
    absWorkingDir: app, logLevel: 'error',
    plugins: [{ name: 'route-provider-leaves', setup(build: {
      onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => unknown): void;
      onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => unknown): void;
    }) {
      build.onResolve({ filter: /.*/ }, ({ path }) => {
        if (mocks[path]) return { path, namespace: 'route-leaf' };
        if (!path.startsWith('@/')) return undefined;
        const candidate = resolve(src, path.slice(2));
        for (const suffix of ['.tsx', '.ts', '/index.tsx', '/index.ts']) if (existsSync(candidate + suffix)) return { path: candidate + suffix };
        return { path: candidate };
      });
      build.onLoad({ filter: /.*/, namespace: 'route-leaf' }, ({ path }) => ({ contents: mocks[path], loader: 'tsx', resolveDir: app }));
    } }],
  });
  files = new Map(result.outputFiles.map(file => [`/${relative(outdir, file.path).replaceAll('\\', '/')}`, file.text]));
  productPath = [...files.keys()].find(path => /\/ProductProviders-/.test(path))!;
  walletPath = [...files.keys()].find(path => /\/ClientWalletProvider-/.test(path))!;
  expect(productPath).toBeTruthy();
  expect(walletPath).toBeTruthy();
});

async function open(page: Page, path = '/') {
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://route-provider.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith('.js')) return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/entry.js"></script>' });
    requests.push(path);
    if (path === productPath) await gate;
    return route.fulfill({ contentType: 'text/javascript', body: files.get(path) ?? '' });
  });
  await page.goto(`http://route-provider.test${path}`, { waitUntil: 'domcontentloaded' });
  return { release, requests, errors };
}

const state = (page: Page) => page.evaluate(() => (globalThis as unknown as { __routeLoading: {
  mounts: number; unmounts: number; walletEvaluations: number; walletMounts: number; walletUnmounts: number;
  priceMounts: number; priceUnmounts: number;
} }).__routeLoading);

test('wallet code loads while product response is withheld, without mounting either provider early', async ({ page }) => {
  const run = await open(page);
  try {
    await expect.poll(() => run.requests.includes(productPath)).toBe(true);
    await expect.poll(() => run.requests.includes(walletPath)).toBe(true);
    await expect.poll(async () => (await state(page)).walletEvaluations).toBe(1);
    expect((await state(page)).walletMounts).toBe(0);
    expect((await state(page)).priceMounts).toBe(0);
    expect((await state(page)).mounts).toBe(0);
    await expect(page.getByRole('status')).toBeVisible();
    run.release();
    await expect(page.getByRole('textbox', { name: 'Draft' })).toBeVisible();
    await expect.poll(async () => (await state(page)).walletMounts).toBe(1);
    expect((await state(page)).priceMounts).toBe(1);
    expect(run.requests.filter(path => path === walletPath)).toHaveLength(1);
    expect(run.errors).toEqual([]);
  } finally { run.release(); }
});

test('a cold docs visit loads no wallet code; entering a product route starts both imports', async ({ page }) => {
  const run = await open(page, '/docs');
  try {
    await expect(page.getByRole('textbox', { name: 'Draft' })).toBeVisible();
    expect(run.requests).not.toContain(productPath);
    expect(run.requests).not.toContain(walletPath);
    await page.evaluate(`window.__routeLoading.navigate('/trade')`);
    await expect.poll(() => run.requests.includes(productPath)).toBe(true);
    await expect.poll(() => run.requests.includes(walletPath)).toBe(true);
    expect((await state(page)).walletMounts).toBe(0);
    run.release();
    await expect(page.locator('[data-wallet-provider] input')).toBeVisible();
    expect(run.errors).toEqual([]);
  } finally { run.release(); }
});

test('after arrival, product/docs navigation preserves provider mounts, child DOM and draft', async ({ page }) => {
  const run = await open(page);
  run.release();
  const draft = page.getByRole('textbox', { name: 'Draft' });
  await expect(draft).toBeVisible();
  await draft.fill('retain amount');
  await page.evaluate(`window.__savedInput=document.querySelector('input');window.__routeLoading.navigate('/docs')`);
  await expect(draft).toHaveValue('retain amount');
  await page.evaluate(`window.__routeLoading.navigate('/borrow')`);
  await expect(draft).toHaveValue('retain amount');
  expect(await page.evaluate(`document.querySelector('input')===window.__savedInput`)).toBe(true);
  await expect(draft).toBeFocused();
  const h = await state(page);
  expect([h.mounts, h.walletMounts, h.priceMounts]).toEqual([1, 1, 1]);
  expect([h.unmounts, h.walletUnmounts, h.priceUnmounts]).toEqual([0, 0, 0]);
  expect(run.errors).toEqual([]);
});
