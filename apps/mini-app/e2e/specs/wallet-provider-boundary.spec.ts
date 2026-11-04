import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const app = resolve(__dirname, '../..');
const appRequire = createRequire(resolve(app, 'package.json'));
const esbuild = createRequire(appRequire.resolve('tsx/package.json'))('esbuild') as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ path: string; text: string }>; metafile: { inputs: Record<string, unknown> } }>;
};
const variants = {
  browser: { appId: '', mode: 'off' },
  disabled: { appId: 'synthetic-configured-app-id', mode: 'off' },
  passkey: { appId: 'synthetic-configured-app-id', mode: 'passkey' },
  missing: { appId: '', mode: 'passkey' },
} as const;
type Variant = keyof typeof variants;
const bundles = new Map<Variant, Map<string, string>>();

// Keep real route/product/provider selection, launch detection and login UI.
// Wallet service leaves are isolated here; the real passkey provider is tested
// independently by telegram-passkey-client and emitted startup verification.
const mocks: Record<string, string> = {
  'next/dynamic': `import {lazy,Suspense} from 'react';export default (load,o={})=>{const C=lazy(load);return p=><Suspense fallback={o.loading?<o.loading/>:null}><C {...p}/></Suspense>}`,
  'next/link': `export default ({children,...p})=><a {...p}>{children}</a>`,
  'next/navigation': `export const usePathname=()=>globalThis.__boundary.path;export const useRouter=()=>({push:p=>globalThis.__boundary.navigate(p),replace:p=>globalThis.__boundary.navigate(p)})`,
  '@/components/RoutePriceProvider': `export default ({children})=>children`,
  '@/components/ProviderLoadingState': `export const ProviderLoadingState=()=> <p role="status">Loading providers</p>`,
  '@/components/FxLogo': `export default ()=> <span/>`,
  '@/components/WalletAvatar': `export const WalletAvatar=()=> <span/>`,
  '@/components/GroupedAddress': `export const GroupedAddress=({address})=> <span>{address}</span>`,
  '@/components/ui': `export const Button=({children,loading,variant,...p})=><button {...p}>{children}</button>;export const FullScreenSpinner=()=> <p role="status">Loading wallet</p>`,
  '@/components/WalletRouteProviders': `export default ({children})=>children`,
  '@/lib/wallet': `
    import {useEffect,useState} from 'react';import {FxWalletContext,usePrivyWallet} from '@/lib/wallet/context';
    export {usePrivyWallet};export const isWalletConnectCancellation=()=>false;
    export function HarnessWallet({children,kind}) {
      const [connected,setConnected]=useState(kind==='passkey');
      useEffect(()=>{const h=globalThis.__boundary;h[kind+'Mounts']++;return()=>{h[kind+'Unmounts']++;};},[]);
      const address=connected?'0x00000000000000000000000000000000000000aa':undefined;
      const wallet={ready:true,authenticated:connected,address,isEmbedded:kind==='passkey',connectionVersion:0,
        selectedWallet:connected?{address,walletClientType:kind==='passkey'?'telegram-passkey':'browser'}:undefined,
        connect:async()=>{globalThis.__boundary.connectCalls++;setConnected(true);}};
      return <FxWalletContext.Provider value={wallet}>{children}</FxWalletContext.Provider>;
    }
    export const BrowserWalletProvider=({children})=><HarnessWallet kind="browser">{children}</HarnessWallet>;
  `,
  '@/components/admission/TelegramPasskeyProvider': `
    import {HarnessWallet} from '@/lib/wallet';globalThis.__boundary.passkeyEvaluations++;
    export default ({children})=><HarnessWallet kind="passkey">{children}</HarnessWallet>;
  `,
};

test.beforeAll(async () => {
  for (const [variant, config] of Object.entries(variants) as Array<[Variant, typeof variants[Variant]]>) {
    const outdir = resolve(app, 'e2e/.provider-boundary-memory', variant);
    const result = await esbuild.build({
      stdin: { contents: `
        import {useState} from 'react';import {createRoot} from 'react-dom/client';
        import RouteProviders from '@/components/RouteProviders';import LoginPage from '@/app/login/page';
        import WalletSection from '@/components/WalletSection';import {useWalletProviderMode} from '@/lib/wallet/providerMode';
        const h=globalThis.__boundary={path:new URLSearchParams(location.search).get('path')||'/login',browserMounts:0,browserUnmounts:0,passkeyMounts:0,passkeyUnmounts:0,passkeyEvaluations:0,connectCalls:0};
        function Content(){const mode=useWalletProviderMode();return <section data-provider-mode={mode}>{h.path==='/settings'?<WalletSection/>:<LoginPage/>}</section>}
        function App(){const[,update]=useState(0);h.navigate=p=>{h.path=p;update(n=>n+1)};const privatePage=['/invite','/wallet-approval'].includes(h.path);return <><nav><button onClick={()=>h.navigate('/settings')}>Open settings</button><button onClick={()=>h.navigate('/login')}>Open login</button></nav><RouteProviders>{privatePage?<p>Private capability page</p>:<Content/>}</RouteProviders></>}
        createRoot(document.getElementById('root')).render(<App/>);
      `, resolveDir: app, sourcefile: 'provider-boundary-entry.tsx', loader: 'tsx' },
      outdir, entryNames: 'entry', chunkNames: '[name]-[hash]', bundle: true, splitting: true,
      write: false, metafile: true, format: 'esm', platform: 'browser', target: 'es2020', jsx: 'automatic',
      absWorkingDir: app, logLevel: 'error', define: {
        'process.env.NODE_ENV': '"production"',
        'process.env.NEXT_PUBLIC_PRIVY_APP_ID': JSON.stringify(config.appId),
        'process.env.NEXT_PUBLIC_TELEGRAM_WALLET_MODE': JSON.stringify(config.mode),
      },
      plugins: [{ name: 'boundary-service-leaves', setup(build: {
        onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => unknown): void;
        onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => unknown): void;
      }) {
        build.onResolve({ filter: /.*/ }, ({ path }) => {
          if (path.startsWith('@privy-io/')) throw new Error('Native Privy SDK must not return');
          if (mocks[path]) return { path, namespace: 'leaf' };
          if (path.endsWith('.css')) return { path, namespace: 'css' };
          if (!path.startsWith('@/')) return undefined;
          const candidate = resolve(app, 'src', path.slice(2));
          for (const extension of ['.tsx', '.ts', '/index.ts', '/index.tsx']) if (existsSync(candidate + extension)) return { path: candidate + extension };
          return { path: candidate };
        });
        build.onLoad({ filter: /.*/, namespace: 'leaf' }, ({ path }) => ({ contents: mocks[path], loader: 'tsx', resolveDir: app }));
        build.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: 'export default {}', loader: 'js' }));
      } }],
    });
    expect(Object.keys(result.metafile.inputs).join('\n')).not.toMatch(/@privy-io|PrivyClientProvider|PrivyFlow/);
    bundles.set(variant, new Map(result.outputFiles.map(f => [`/${relative(outdir, f.path).replaceAll('\\', '/')}`, f.text])));
  }
});

async function open(page: Page, variant: Variant, { launch = false, host = false, path = '/login' } = {}) {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ host }) => {
    if (host) Object.defineProperty(window, 'TelegramWebviewProxy', { configurable: true, value: { postEvent() {} } });
  }, { host });
  const files = bundles.get(variant)!;
  await page.route('http://provider-boundary.test/**', route => {
    const p = new URL(route.request().url()).pathname;
    requests.push(p);
    return route.fulfill(p.endsWith('.js') ? { contentType: 'text/javascript', body: files.get(p) ?? '' }
      : { contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/entry.js"></script>' });
  });
  const hash = launch ? '#tgWebAppData=' + encodeURIComponent('auth_date=1&user={"id":123}&signature=synthetic') : '';
  await page.goto(`http://provider-boundary.test/?path=${encodeURIComponent(path)}${hash}`, { waitUntil: 'domcontentloaded' });
  return { errors, requests };
}
const state = (page: Page) => page.evaluate(() => (globalThis as unknown as { __boundary: Record<string, number> }).__boundary);

for (const variant of Object.keys(variants) as Variant[]) {
  test(`${variant}: ordinary web retains browser wallet connect and Settings without native auth`, async ({ page }) => {
    const result = await open(page, variant);
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Wallet connected' })).toBeVisible();
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByText('Browser wallet connected', { exact: true })).toBeVisible();
    expect(await state(page)).toMatchObject({ browserMounts: 1, browserUnmounts: 0, passkeyMounts: 0, passkeyEvaluations: 0, connectCalls: 1 });
    expect(result.errors).toEqual([]);
  });
}

for (const variant of ['browser', 'disabled', 'missing'] as Variant[]) {
  for (const signal of ['launch', 'host'] as const) {
    test(`${variant}: Telegram ${signal} fails closed without a configured passkey path`, async ({ page }) => {
      const result = await open(page, variant, { [signal]: true });
      await expect(page.getByRole('heading', { name: 'Open FxAeon in your browser' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Continue in browser' })).toHaveAttribute('href', 'https://fxaeon.com/');
      await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toHaveCount(0);
      expect(await state(page)).toMatchObject({ browserMounts: 0, passkeyMounts: 0, passkeyEvaluations: 0, connectCalls: 0 });
      expect(result.errors).toEqual([]);
    });
  }
}

test('configured Telegram passkey path mounts only that service and survives route navigation', async ({ page }) => {
  const result = await open(page, 'passkey', { launch: true, path: '/settings' });
  await expect(page.getByText('Telegram wallet connected', { exact: true })).toBeVisible();
  await expect(page.locator('[data-provider-mode]')).toHaveAttribute('data-provider-mode', 'telegram');
  await page.getByRole('button', { name: 'Open login' }).click();
  await expect(page.getByRole('heading', { name: 'Wallet connected' })).toBeVisible();
  expect(await state(page)).toMatchObject({ browserMounts: 0, passkeyMounts: 1, passkeyUnmounts: 0, passkeyEvaluations: 1 });
  expect(result.errors).toEqual([]);
});

test('a delayed native bridge cannot initialize a browser signer before passkey selection', async ({ page }) => {
  const result = await open(page, 'passkey', { host: true, path: '/settings' });
  await expect(page.getByRole('status')).toBeVisible();
  expect(await state(page)).toMatchObject({ browserMounts: 0, passkeyMounts: 0 });
  await page.evaluate(() => { Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: { initData: 'auth_date=1&user={"id":123}&signature=synthetic' } } }); });
  await expect(page.getByText('Telegram wallet connected', { exact: true })).toBeVisible();
  expect(await state(page)).toMatchObject({ browserMounts: 0, passkeyMounts: 1 });
  expect(result.errors).toEqual([]);
});

for (const path of ['/invite', '/wallet-approval']) test(`${path} stays independent from wallet configuration`, async ({ page }) => {
  const result = await open(page, 'disabled', { launch: true, path });
  await expect(page.getByText('Private capability page')).toBeVisible();
  expect(await state(page)).toMatchObject({ browserMounts: 0, passkeyMounts: 0, passkeyEvaluations: 0 });
  expect(result.errors).toEqual([]);
});
