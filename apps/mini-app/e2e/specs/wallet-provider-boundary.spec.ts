import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { relative, resolve } from 'node:path';
import { test, expect, type Frame, type Page } from '@playwright/test';
import type { ProviderBoundaryHarnessState } from '../harness/wallet-provider-boundary-entry';

const root = resolve(__dirname, '../../../..');
const miniApp = resolve(root, 'apps/mini-app');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [miniApp] });
const esbuild = createRequire(tsxPackage)('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
const src = resolve(miniApp, 'src');
const entry = resolve(miniApp, 'e2e/harness/wallet-provider-boundary-entry.tsx');

// Keep the production boundary, detector, mode context, login page and Settings
// wallet section. Replace external services and visual leaves only. In particular,
// real dynamic import expressions survive as separate HTTP-loaded ES modules.
const mocks: Record<string, string> = {
  'next/dynamic': `
    import { createContext, lazy, Suspense } from 'react';
    export const HarnessDynamicFallback = createContext(false);
    export default function dynamic(loader, options = {}) {
      const Component = lazy(loader);
      return function DynamicComponent(props) {
        const Loading = options.loading;
        const fallback = Loading ? <HarnessDynamicFallback.Provider value={true}><Loading /></HarnessDynamicFallback.Provider> : null;
        return <Suspense fallback={fallback}><Component {...props} /></Suspense>;
      };
    }
  `,
  'next/link': `export default function Link({ children, ...props }) { return <a {...props}>{children}</a>; }`,
  'next/navigation': `export const useRouter = () => ({ push: (path) => globalThis.__providerBoundaryHarness.navigate(path) });`,
  '@/lib/wallet': `
    import { createContext, useContext, useEffect, useState } from 'react';
    const Context = createContext(null);
    export function HarnessWalletProvider({ children, kind }) {
      const [connected, setConnected] = useState(() => new URLSearchParams(location.search).get('connected') === '1');
      useEffect(() => {
        const h = globalThis.__providerBoundaryHarness;
        h[kind + 'Mounts'] += 1;
        return () => { h[kind + 'Unmounts'] += 1; };
      }, []);
      const address = connected ? '0x00000000000000000000000000000000000000aa' : undefined;
      const wallet = { ready: true, authenticated: connected, address, isEmbedded: connected && kind === 'privy',
        selectedWallet: address ? { address, walletClientType: kind === 'privy' ? 'privy-v2' : 'browser' } : undefined,
        connect: async () => { globalThis.__providerBoundaryHarness.connectCalls += 1; setConnected(true); },
      };
      return <Context.Provider value={wallet}>{children}</Context.Provider>;
    }
    export function BrowserWalletProvider({ children, allowTelegramHost = false }) {
      globalThis.__providerBoundaryHarness.browserAllowsTelegramHost = allowTelegramHost;
      return <HarnessWalletProvider kind="browser">{children}</HarnessWalletProvider>;
    }
    export function usePrivyWallet() {
      const value = useContext(Context);
      if (!value) throw new Error('Wallet flow rendered outside its selected provider');
      return value;
    }
    export const useWalletReadyTimeout = () => false;
    export const isWalletConnectCancellation = () => false;
  `,
  '@/components/WalletRouteProviders': `
    import { useEffect } from 'react';
    export default function WalletRouteProviders({ children }) {
      useEffect(() => {
        const h = globalThis.__providerBoundaryHarness;
        h.routeMounts += 1;
        return () => { h.routeUnmounts += 1; };
      }, []);
      return <div data-route-providers="true">{children}</div>;
    }
  `,
  '@/components/PrivyClientProvider': `
    import { HarnessWalletProvider } from '@/lib/wallet';
    import WalletRouteProviders from '@/components/WalletRouteProviders';
    import { usePrivy } from '@privy-io/react-auth';
    globalThis.__providerBoundaryHarness.importMarkers.push('PRIVY_PROVIDER_MODULE');
    export default function PrivyClientProvider({ children }) {
      usePrivy();
      return <HarnessWalletProvider kind="privy"><WalletRouteProviders>{children}</WalletRouteProviders></HarnessWalletProvider>;
    }
  `,
  '@privy-io/react-auth': `
    globalThis.__providerBoundaryHarness.importMarkers.push('PRIVY_SDK_MODULE');
    const called = () => { globalThis.__providerBoundaryHarness.sdkHookCalls += 1; };
    export function usePrivy() { called(); return { ready: true, authenticated: false }; }
    export function useWallets() { called(); return { ready: true, wallets: [] }; }
    export function useLogin() { called(); return { login: () => {} }; }
    export function useCreateWallet() { called(); return { createWallet: async () => {} }; }
    export function useExportWallet() { called(); return { exportWallet: async () => {} }; }
  `,
  '@/components/ProviderLoadingState': `
    import { useContext } from 'react';
    import { HarnessDynamicFallback } from 'next/dynamic';
    // Distinguish the real client boundary's bridge wait from the outer lazy
    // import fallback, so tests cannot inject the bridge before selection runs.
    export const ProviderLoadingState = () => <p role="status" data-provider-wait={String(!useContext(HarnessDynamicFallback))}>Loading provider</p>;
  `,
  '@/components/ui': `
    export function Button({ children, loading, variant, ...props }) { return <button {...props} disabled={props.disabled || loading}>{children}</button>; }
    export const FullScreenSpinner = () => <p role="status">Loading wallet</p>;
    export const AddressChip = ({ address }) => <span>{address}</span>;
  `,
  '@/components/FxLogo': `export default function FxLogo() { return <span aria-hidden="true" />; }`,
  '@/components/GroupedAddress': `export const GroupedAddress = ({ address }) => <span>{address}</span>;`,
  '@/components/WalletAvatar': `export const WalletAvatar = () => <span aria-hidden="true" />;`,
  '@/lib/i18n': `export const useT = () => (key) => key;`,
  '@/lib/fx/gasFeePolicy': `
    export async function fetchGasTierQuotes(chainId) {
      globalThis.__providerBoundaryHarness.gasQuoteChains.push(chainId);
      return { tiers: {
        standard: { gasPriceWei: 1200000000n },
        fast: { gasPriceWei: 1500000000n },
        rapid: { gasPriceWei: 2100000000n },
      } };
    }
  `,
};

type Build = {
  onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => unknown) => void;
  onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => unknown) => void;
};
type Variant = 'configured' | 'unconfigured';
type Bundle = { files: Map<string, string>; privyPaths: Set<string> };

async function buildHarness(variant: Variant): Promise<Bundle> {
  const outdir = resolve(miniApp, 'e2e/.provider-boundary-memory', variant);
  const result = await esbuild.build({
    entryPoints: [entry], outdir, bundle: true, write: false, splitting: true,
    format: 'esm', platform: 'browser', target: 'es2020', jsx: 'automatic',
    absWorkingDir: root,
    define: { 'process.env.NEXT_PUBLIC_PRIVY_APP_ID': JSON.stringify(variant === 'configured' ? 'fake-configured-app-id' : '') },
    plugins: [{ name: 'wallet-provider-boundary-leaves', setup(build: Build) {
      build.onResolve({ filter: /.*/ }, ({ path }) => {
        if (mocks[path]) return { path, namespace: 'mock' };
        if (path.endsWith('.css')) return { path, namespace: 'styles' };
        if (!path.startsWith('@/')) return undefined;
        const candidate = resolve(src, path.slice(2));
        for (const extension of ['.tsx', '.ts']) if (existsSync(candidate + extension)) return { path: candidate + extension };
        for (const index of ['index.tsx', 'index.ts']) if (existsSync(resolve(candidate, index))) return { path: resolve(candidate, index) };
        return { path: candidate };
      });
      build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path], loader: 'tsx', resolveDir: miniApp }));
      build.onLoad({ filter: /.*/, namespace: 'styles' }, () => ({ contents: 'export default {};', loader: 'js' }));
    } }],
  });
  const files = new Map(result.outputFiles.map((file) => [`/${variant}/${relative(outdir, file.path).replaceAll('\\', '/')}`, file.text]));
  const privyPaths = new Set([...files].filter(([, source]) => /PRIVY_(?:PROVIDER|SDK)_MODULE/.test(source)).map(([path]) => path));
  // Guard the harness itself: the protected dependency must be a separately
  // fetched chunk, not an absent mock that makes the no-fetch assertion vacuous.
  expect(privyPaths.size).toBeGreaterThan(0);
  expect(privyPaths.has(`/${variant}/wallet-provider-boundary-entry.js`)).toBe(false);
  return { files, privyPaths };
}

let server: Server;
let origin: string;
let bundles: Record<Variant, Bundle>;
const emptyState: ProviderBoundaryHarnessState = {
  browserMounts: 0, browserUnmounts: 0, privyMounts: 0, privyUnmounts: 0,
  routeMounts: 0, routeUnmounts: 0, childMounts: 0, childUnmounts: 0,
  connectCalls: 0, sdkHookCalls: 0, importMarkers: [], gasQuoteChains: [],
};

test.beforeAll(async () => {
  bundles = { configured: await buildHarness('configured'), unconfigured: await buildHarness('unconfigured') };
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const variant: Variant = path.startsWith('/unconfigured/') ? 'unconfigured' : 'configured';
    response.setHeader('Cache-Control', 'no-store');
    const source = bundles[variant].files.get(path);
    if (source) {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(source);
    } else if (path.endsWith('.js')) {
      response.writeHead(404); response.end();
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<!doctype html><html><body><div id="root"></div><script>globalThis.__providerBoundaryHarness=${JSON.stringify(emptyState)}</script><script type="module" src="/${variant}/wallet-provider-boundary-entry.js"></script></body></html>`);
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Harness server has no port');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => { if (server) await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); });

async function openHarness(page: Page, { variant = 'configured', path = '/login', hash = '', bridge = 'absent', telegramUa = false, telegramProxy = false, waitUntilReady = true }: {
  variant?: Variant; path?: string; hash?: string; bridge?: 'absent' | 'unknown' | 'telegram' | 'telegram-data';
  telegramUa?: boolean; telegramProxy?: boolean; waitUntilReady?: boolean;
} = {}) {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ bridge, telegramUa, telegramProxy }) => {
    if (bridge !== 'absent') (window as any).Telegram = { WebApp: {
      platform: bridge === 'telegram' || bridge === 'telegram-data' ? 'android' : 'unknown',
      initData: bridge === 'telegram-data' ? 'auth_date=1&hash=synthetic' : '',
    } };
    if (telegramUa) Object.defineProperty(navigator, 'userAgent', { configurable: true, value: `${navigator.userAgent} Telegram/11.0` });
    if (telegramProxy) (window as any).TelegramWebviewProxy = { postEvent: () => {} };
  }, { bridge, telegramUa, telegramProxy });
  await page.goto(`${origin}/${variant}${path}${hash}`);
  if (waitUntilReady) await expect(page.locator('[data-harness-ready]')).toBeVisible();
  return { requests, errors, variant };
}

async function state(page: Page | Frame) {
  return page.evaluate(() => {
    const { navigate: _navigate, rerender: _rerender, ...snapshot } = globalThis.__providerBoundaryHarness;
    return snapshot;
  });
}

async function expectBrowserOnly(page: Page | Frame, observation: Awaited<ReturnType<typeof openHarness>>) {
  await expect(page.locator('[data-provider-mode]')).toHaveAttribute('data-provider-mode', 'browser');
  const current = await state(page);
  expect(current.browserMounts).toBe(1);
  expect(current.browserAllowsTelegramHost).toBe(observation.variant === 'configured');
  expect(current.privyMounts).toBe(0);
  expect(current.sdkHookCalls).toBe(0);
  expect(current.importMarkers).toEqual([]);
  expect(observation.requests.filter((path) => bundles[observation.variant].privyPaths.has(path))).toEqual([]);
  expect(observation.errors).toEqual([]);
}

async function openIframeHarness(page: Page, parentUrl: string, hash = '') {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', (error) => errors.push(error.message));
  // Use a real cross-origin iframe and browser-provided ancestor/referrer
  // metadata. Both HTTPS origins are intercepted; no live host or private
  // network permission is needed for the fixture.
  const frameOrigin = 'https://fxaeon-harness.test';
  await page.route(`${frameOrigin}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const source = bundles.configured.files.get(path);
    if (source) return route.fulfill({ contentType: 'text/javascript', body: source });
    if (path.endsWith('.js')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: 'text/html', body:
      `<!doctype html><html><body><div id="root"></div><script>globalThis.__providerBoundaryHarness=${JSON.stringify(emptyState)}</script><script type="module" src="/configured/wallet-provider-boundary-entry.js"></script></body></html>`,
    });
  });
  await page.route(parentUrl, (route) => route.fulfill({ contentType: 'text/html', body:
    `<!doctype html><html><body><iframe title="Mini App" src="${frameOrigin}/configured/login${hash}" style="width:100%;height:700px"></iframe></body></html>`,
  }));
  await page.goto(parentUrl);
  const element = await page.locator('iframe[title="Mini App"]').elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) throw new Error('Mini App iframe did not load');
  return { frame, requests, errors, variant: 'configured' as const };
}

async function openPendingTelegramHarness(page: Page, host: 'user-agent' | 'native-proxy') {
  // Control the real 100 ms polling timer and 8 s bound without slowing the
  // suite down or replacing the production wait helper with a test mock.
  await page.clock.install({ time: new Date('2026-10-09T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-09T00:00:01Z'));
  const observation = await openHarness(page, {
    telegramUa: host === 'user-agent', telegramProxy: host === 'native-proxy', waitUntilReady: false,
  });
  await expect.poll(async () => {
    // React's outer lazy boundary may also schedule its reveal; advancing the
    // clock lets that finish before checking the client's distinct wait state.
    await page.clock.runFor(100);
    return page.locator('[data-provider-wait="true"]').count();
  }).toBe(1);
  expect(await state(page)).toMatchObject({ browserMounts: 0, privyMounts: 0, childMounts: 0, importMarkers: [] });
  return observation;
}

test('configured ordinary web with the Telegram SDK stub uses browser login without fetching Privy', async ({ page }) => {
  const observation = await openHarness(page, { bridge: 'unknown' });
  await expect(page.getByRole('heading', { name: 'Connect your wallet' })).toBeVisible();
  await expect(page.getByRole('button', { name: /create|export|email/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect browser wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Wallet connected' })).toBeVisible();
  expect((await state(page)).connectCalls).toBe(1);
  await expectBrowserOnly(page, observation);
});

test('configured browser Settings connects externally without mounting Privy hooks', async ({ page }) => {
  const observation = await openHarness(page, { path: '/settings', bridge: 'unknown' });
  await expect(page.getByText('Connect a browser wallet', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /create|export/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByText('Browser wallet connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open login', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Wallet connected' })).toBeVisible();
  expect((await state(page)).connectCalls).toBe(1);
  await expectBrowserOnly(page, observation);
});

test('Telegram launch hash selects Privy before the bridge loads and keeps it across navigation', async ({ page }) => {
  // Synthetic launch-shaped data tests routing only, never authentication.
  const observation = await openHarness(page, { path: '/login?consumeLaunchHash=1', hash: '#tgWebAppData=auth_date%3D1%26hash%3Dsynthetic' });
  await expect(page.locator('[data-provider-mode]')).toHaveAttribute('data-provider-mode', 'privy');
  await expect(page.getByRole('heading', { name: 'loginCard.signIn' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  const identity = await page.locator('[data-identity]').getAttribute('data-identity');
  await page.evaluate(() => {
    history.replaceState(null, '', location.pathname);
    (window as any).Telegram = { WebApp: { platform: 'android', initData: 'synthetic-only' } };
    globalThis.__providerBoundaryHarness.rerender?.();
  });
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(page.getByText('No wallet connected', { exact: true })).toBeVisible();
  await expect(page.locator('[data-provider-mode]')).toHaveAttribute('data-provider-mode', 'privy');
  await expect(page.locator('[data-identity]')).toHaveAttribute('data-identity', identity!);
  const current = await state(page);
  expect(current).toMatchObject({ browserMounts: 0, privyMounts: 1, privyUnmounts: 0, routeMounts: 1, routeUnmounts: 0, childMounts: 1, childUnmounts: 0 });
  expect(current.importMarkers.filter((marker) => marker === 'PRIVY_PROVIDER_MODULE')).toHaveLength(1);
  expect(current.sdkHookCalls).toBeGreaterThan(0);
  expect(observation.requests.some((path) => bundles.configured.privyPaths.has(path))).toBe(true);
  expect(observation.errors).toEqual([]);
});

test('Telegram user agent with an empty SDK bridge keeps the configured browser connect flow', async ({ page }) => {
  const observation = await openHarness(page, { telegramUa: true, bridge: 'unknown' });
  await page.getByRole('button', { name: 'Connect browser wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Wallet connected' })).toBeVisible();
  await expectBrowserOnly(page, observation);
});

test('a Telegram Web iframe reload waits for the bridge after its launch hash was consumed', async ({ page }) => {
  const observation = await openIframeHarness(page, 'https://web.telegram.org/k/', '#tgWebAppData=auth_date%3D1%26hash%3Dsynthetic');
  const { frame } = observation;
  await expect(frame.locator('[data-provider-mode]')).toHaveAttribute('data-provider-mode', 'privy');
  await frame.evaluate(() => history.replaceState(null, '', location.pathname));
  await frame.goto(frame.url());
  await expect(frame.locator('[data-provider-wait="true"]')).toBeVisible();
  expect(await state(frame)).toMatchObject({ browserMounts: 0, privyMounts: 0, childMounts: 0, importMarkers: [] });
  expect(await frame.evaluate(() => navigator.userAgent)).not.toMatch(/Telegram/i);
  await frame.evaluate(() => {
    (window as any).Telegram = { WebApp: { platform: 'web', initData: 'auth_date=1&hash=synthetic-reload' } };
  });
  await expect(frame.getByRole('heading', { name: 'loginCard.signIn' })).toBeVisible();
  await expect(frame.locator('[data-provider-mode]')).toHaveAttribute('data-provider-mode', 'privy');
  const identity = await frame.locator('[data-identity]').getAttribute('data-identity');
  await frame.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(frame.getByText('No wallet connected', { exact: true })).toBeVisible();
  await expect(frame.locator('[data-identity]')).toHaveAttribute('data-identity', identity!);
  expect(await state(frame)).toMatchObject({ browserMounts: 0, privyMounts: 1, privyUnmounts: 0, childMounts: 1, childUnmounts: 0 });
  expect(observation.errors).toEqual([]);
});

test('Telegram Web parent alone cannot load Privy when the delayed bridge has no data', async ({ page }) => {
  const observation = await openIframeHarness(page, 'https://web.telegram.org/a/');
  await expect(observation.frame.locator('[data-provider-wait="true"]')).toBeVisible();
  await observation.frame.evaluate(() => {
    (window as any).Telegram = { WebApp: { platform: 'web', initData: '' } };
  });
  await expect(observation.frame.getByRole('button', { name: 'Connect browser wallet' })).toBeVisible();
  await expectBrowserOnly(observation.frame, observation);
});

test('an unrelated iframe does not wait for Telegram or request Privy', async ({ page }) => {
  const observation = await openIframeHarness(page, 'https://web.telegram.org.example.com/k/');
  await expect(observation.frame.getByRole('button', { name: 'Connect browser wallet' })).toBeVisible();
  await expect(observation.frame.locator('[data-provider-wait="true"]')).toHaveCount(0);
  await expectBrowserOnly(observation.frame, observation);
});

for (const host of ['user-agent', 'native-proxy'] as const) {
  test(`a Telegram reload with ${host} waits for delayed launch data before mounting Privy`, async ({ page }) => {
    const observation = await openPendingTelegramHarness(page, host);
    await page.clock.runFor(500);
    expect(await state(page)).toMatchObject({ browserMounts: 0, privyMounts: 0, importMarkers: [] });
    await page.evaluate(() => {
      (window as any).Telegram = { WebApp: { platform: 'android', initData: 'auth_date=1&hash=synthetic-delayed' } };
    });
    await page.clock.runFor(100);
    await page.clock.resume();
    await expect(page.getByRole('heading', { name: 'loginCard.signIn' })).toBeVisible();
    await expect(page.locator('[data-provider-mode]')).toHaveAttribute('data-provider-mode', 'privy');
    const identity = await page.locator('[data-identity]').getAttribute('data-identity');
    await page.evaluate(() => {
      delete (window as any).Telegram;
      globalThis.__providerBoundaryHarness.rerender?.();
    });
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await expect(page.getByText('No wallet connected', { exact: true })).toBeVisible();
    await expect(page.locator('[data-identity]')).toHaveAttribute('data-identity', identity!);
    const current = await state(page);
    expect(current).toMatchObject({ browserMounts: 0, privyMounts: 1, privyUnmounts: 0, routeMounts: 1, routeUnmounts: 0, childMounts: 1, childUnmounts: 0 });
    expect(current.importMarkers.filter((marker) => marker === 'PRIVY_PROVIDER_MODULE')).toHaveLength(1);
    expect(observation.errors).toEqual([]);
  });
}

test('an empty delayed Telegram bridge settles on the browser provider without loading Privy', async ({ page }) => {
  const observation = await openPendingTelegramHarness(page, 'native-proxy');
  await page.evaluate(() => {
    (window as any).Telegram = { WebApp: { platform: 'android', initData: '' } };
  });
  await page.clock.runFor(100);
  await page.clock.resume();
  await page.getByRole('button', { name: 'Connect browser wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Wallet connected' })).toBeVisible();
  await expectBrowserOnly(page, observation);
});

test('a missing Telegram bridge falls back after the bounded wait and never replaces the connected wallet', async ({ page }) => {
  const observation = await openPendingTelegramHarness(page, 'user-agent');
  await page.clock.runFor(7_000);
  await expect(page.locator('[data-provider-wait="true"]')).toBeVisible();
  expect(await state(page)).toMatchObject({ browserMounts: 0, privyMounts: 0, importMarkers: [] });
  await page.clock.runFor(1_100);
  // Keep time paused until fallback is visible. Resuming first would let a
  // regressed longer timeout pass through Playwright's real-time auto-wait.
  await expect(page.locator('[data-provider-mode]')).toHaveAttribute('data-provider-mode', 'browser');
  await expect(page.locator('[data-provider-wait="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect browser wallet' })).toBeVisible();
  await page.clock.resume();
  await page.getByRole('button', { name: 'Connect browser wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Wallet connected' })).toBeVisible();
  const identity = await page.locator('[data-identity]').getAttribute('data-identity');
  await page.evaluate(() => {
    (window as any).Telegram = { WebApp: { platform: 'android', initData: 'auth_date=1&hash=too-late-synthetic' } };
    globalThis.__providerBoundaryHarness.rerender?.();
  });
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(page.getByText('Browser wallet connected', { exact: true })).toBeVisible();
  await expect(page.locator('[data-identity]')).toHaveAttribute('data-identity', identity!);
  expect(await state(page)).toMatchObject({ browserUnmounts: 0, routeMounts: 1, routeUnmounts: 0, childMounts: 1, childUnmounts: 0 });
  await expectBrowserOnly(page, observation);
});

test('a Telegram platform hint alone keeps the configured browser connect flow', async ({ page }) => {
  const observation = await openHarness(page, { bridge: 'telegram' });
  await page.getByRole('button', { name: 'Connect browser wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Wallet connected' })).toBeVisible();
  await expectBrowserOnly(page, observation);
});

test('nonempty Telegram bridge launch data selects Privy without a URL hash', async ({ page }) => {
  const observation = await openHarness(page, { bridge: 'telegram-data' });
  await expect(page.locator('[data-provider-mode]')).toHaveAttribute('data-provider-mode', 'privy');
  await expect(page.getByRole('heading', { name: 'loginCard.signIn' })).toBeVisible();
  expect((await state(page)).privyMounts).toBe(1);
  expect(observation.errors).toEqual([]);
});

for (const hash of ['#tgWebAppData=', '#tgWebAppVersion=8.0&tgWebAppPlatform=android']) {
  test(`Telegram marker without launch data stays in browser mode: ${hash}`, async ({ page }) => {
    const observation = await openHarness(page, { hash });
    await expect(page.getByRole('heading', { name: 'Connect your wallet' })).toBeVisible();
    await expectBrowserOnly(page, observation);
  });
}

test('later Telegram hints do not replace an already connected browser provider', async ({ page }) => {
  const observation = await openHarness(page, { bridge: 'unknown' });
  await page.getByRole('button', { name: 'Connect browser wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Wallet connected' })).toBeVisible();
  const identity = await page.locator('[data-identity]').getAttribute('data-identity');
  await page.evaluate(() => {
    history.replaceState(null, '', `${location.pathname}#tgWebAppData=synthetic`);
    (window as any).Telegram = { WebApp: { platform: 'android', initData: 'synthetic-only' } };
    globalThis.__providerBoundaryHarness.rerender?.();
  });
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(page.getByText('Browser wallet connected', { exact: true })).toBeVisible();
  await expect(page.locator('[data-identity]')).toHaveAttribute('data-identity', identity!);
  expect(await state(page)).toMatchObject({ browserUnmounts: 0, routeMounts: 1, routeUnmounts: 0, childMounts: 1, childUnmounts: 0 });
  await expectBrowserOnly(page, observation);
});

test('a build without a Privy app ID keeps ordinary browser wallet access', async ({ page }) => {
  const observation = await openHarness(page, { variant: 'unconfigured' });
  await expect(page.getByRole('heading', { name: 'Connect your wallet' })).toBeVisible();
  await expectBrowserOnly(page, observation);
});

test('a build without a Privy app ID gives Telegram a browser handoff without loading Privy', async ({ page }) => {
  const observation = await openHarness(page, { variant: 'unconfigured', hash: '#tgWebAppData=auth_date%3D1%26hash%3Dsynthetic' });
  await expect(page.getByRole('heading', { name: 'Connect in your browser' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue in browser' })).toHaveAttribute('href', 'https://fxaeon.com/');
  await expect(page.getByRole('button', { name: 'Connect browser wallet' })).toHaveCount(0);
  await expectBrowserOnly(page, observation);
});

for (const connected of [false, true]) {
  test(`browser transaction settings preserve slippage without gas reads or speed choices (${connected ? 'connected' : 'disconnected'})`, async ({ page }) => {
    const observation = await openHarness(page, { path: `/transaction-settings?connected=${connected ? '1' : '0'}`, bridge: 'unknown' });
    await expect(page.locator('[data-connected]')).toHaveAttribute('data-connected', String(connected));
    expect((await state(page)).gasQuoteChains).toEqual([]);
    await page.getByRole('button', { name: /^Transaction settings,/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Transaction settings', exact: true });
    await expect(dialog.getByRole('radiogroup', { name: 'Max slippage' })).toBeVisible();
    await expect(dialog.getByRole('radiogroup', { name: 'Network speed' })).toHaveCount(0);
    await expect(dialog.getByRole('radio', { name: /Standard|Fast|Rapid/ })).toHaveCount(0);
    await dialog.getByRole('radio', { name: '1%', exact: true }).click();
    await expect(dialog.getByRole('radio', { name: '1%', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' })).toHaveValue('1');
    expect((await state(page)).gasQuoteChains).toEqual([]);
    await expectBrowserOnly(page, observation);
  });
}

test('embedded transaction settings retain gas quotes and speed choices alongside slippage', async ({ page }) => {
  const observation = await openHarness(page, { path: '/transaction-settings?connected=1', bridge: 'telegram-data' });
  await expect(page.locator('[data-provider-mode]')).toHaveAttribute('data-provider-mode', 'privy');
  expect((await state(page)).gasQuoteChains).toEqual([]);
  await page.getByRole('button', { name: /^Transaction settings,/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Transaction settings', exact: true });
  await expect(dialog.getByRole('radiogroup', { name: 'Network speed' })).toBeVisible();
  const fast = dialog.getByRole('radio', { name: /^Fast\s*1\.50 gwei$/ });
  await expect(fast).toBeVisible();
  expect((await state(page)).gasQuoteChains).toEqual([1]);
  await fast.click();
  await expect(fast).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('radio', { name: '1%', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' })).toHaveValue('1');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fxaeon.settings.v1') ?? '{}'))).toMatchObject({ gasTier: 'fast', slippageBps: 100 });
  expect((await state(page)).gasQuoteChains).toEqual([1]);
  expect(observation.errors).toEqual([]);
});
