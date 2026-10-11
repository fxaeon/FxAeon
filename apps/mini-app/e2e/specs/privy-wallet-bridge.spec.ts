import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const entry = resolve(root, 'apps/mini-app/e2e/harness/privy-wallet-entry.tsx');
const src = resolve(root, 'apps/mini-app/src');

const mocks: Record<string, string> = {
  '@privy-io/react-auth': `
    import { useEffect, useSyncExternalStore } from 'react';
    function useHarness() {
      const h = globalThis.__privyHarness;
      useSyncExternalStore((listener) => { h.listeners.add(listener); return () => h.listeners.delete(listener); }, () => h.version);
      return h;
    }
    export function usePrivy() { const h = useHarness(); return { ready: h.ready, authenticated: h.authenticated, user: h.authenticated ? { id: h.userId } : null }; }
    export function useWallets() { const h = useHarness(); return { ready: h.walletsReady, wallets: h.wallets }; }
    export function useModalStatus() { const h = useHarness(); return { isOpen: h.modalOpen }; }
    export function useSendTransaction() { return { sendTransaction: async () => ({ hash: '0x' + '1'.repeat(64) }) }; }
    export function useLogout() { const h = useHarness(); return { logout: async () => {
      h.logoutCalls += 1; h.authenticated = false; h.wallets = []; h.modalOpen = false; h.notify();
    } }; }
    // Privy's event bus invokes whichever hook handlers are CURRENTLY registered.
    // There is no association between a delayed completion and the earlier call.
    export function useLogin(callbacks) {
      const h = useHarness();
      useEffect(() => { h.loginCallbacks = callbacks; return () => { if (h.loginCallbacks === callbacks) h.loginCallbacks = undefined; }; }, [callbacks]);
      return { login: (options) => { h.loginCalls.push(options ?? null); h.modalOpen = true; h.notify(); } };
    }
    export function useConnectWallet(callbacks) {
      const h = useHarness();
      useEffect(() => { h.walletCallbacks = callbacks; return () => { if (h.walletCallbacks === callbacks) h.walletCallbacks = undefined; }; }, [callbacks]);
      return { connectWallet: () => { h.connectCalls += 1; h.modalOpen = true; h.notify(); } };
    }
    export function useCreateWallet() { return { createWallet: async () => {} }; }
    export function useExportWallet() { return { exportWallet: async () => {} }; }
  `,
  'next/link': `export default function Link({ children, ...props }) { return <a {...props}>{children}</a>; }`,
  '@/lib/fx/clients': `export const getPublicClient = () => { throw new Error('A disconnected browser fixture must not read RPC'); };`,
  '@/components/ui': `export function Button({ children, loading, variant, ...props }) { return <button {...props} disabled={props.disabled || loading}>{children}</button>; }`,
  '@/lib/telegram': `
    export const getInitData = () => globalThis.__privyHarness?.initData ?? '';
    export const isTelegramLaunchContext = () => Boolean(globalThis.__privyHarness?.telegram);
    export const restoreTelegramLaunchHash = () => {};
    export const haptic = () => {};
  `,
  '@/lib/wallet/telegramReconnect': `
    export function useTelegramReconnect() {
      const h = globalThis.__privyHarness;
      return () => {
        h.telegramReconnectCalls += 1;
        // Model the new PrivyProvider mount completing its native Telegram
        // seamless-auth startup; never route through Privy's login widget.
        if (h.initData) {
          h.authenticated = true;
          h.walletsReady = true;
          h.wallets = [{
            address: '0x00000000000000000000000000000000000000cc',
            type: 'ethereum', walletClientType: 'privy-v2', chainId: 'eip155:1',
            getEthereumProvider: async () => ({ request: async () => '0x1' }), switchChain: async () => {},
          }];
          h.notify();
        }
      };
    }
  `,
  '@/lib/fx/config': `export const assertLocalForkRpcUrl = (url) => url; export const configuredRpcUrls = () => ['https://eth-mainnet.g.alchemy.com/v2/harness'];`,
  './switchBrowserChain': `export const switchBrowserChain = async () => {};`,
  './eip6963': `
    export const eip6963FocusTrapDestination = () => null;
    export const getDiscoveredEip6963Providers = () => [];
    export const recordEip6963Announcement = () => false;
    export const selectEip6963Provider = () => undefined;
    export const shouldBindEip6963ProviderEvents = () => false;
    export const shouldPromptEip6963Provider = () => false;
    export const waitForWalletProvider = async () => undefined;
  `,
};

async function buildHarness(): Promise<string> {
  type Build = {
    onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void;
    onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void;
  };
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
    jsx: 'automatic', define: { 'process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE': '"0"' }, loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'empty' }, absWorkingDir: root,
    plugins: [{
      name: 'privy-wallet-bridge-mocks',
      setup(build: Build) {
        build.onResolve({ filter: /\.css$/ }, (args: { path: string }) => ({ path: args.path, namespace: 'style' }));
        build.onLoad({ filter: /.*/, namespace: 'style' }, () => ({ contents: 'export default {};', loader: 'js' }));
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next/link', namespace: 'mock' }));
        build.onResolve({ filter: /^@privy-io\/react-auth$/ }, () => ({ path: '@privy-io/react-auth', namespace: 'mock' }));
        build.onResolve({ filter: /^@\// }, (args: { path: string }) => {
          if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
          const candidate = resolve(src, args.path.slice(2));
          for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
          for (const index of ['index.tsx', 'index.ts']) if (existsSync(resolve(candidate, index))) return { path: resolve(candidate, index) };
          if (existsSync(candidate)) return { path: candidate };
          return { path: candidate };
        });
        build.onResolve({ filter: /^\.\// }, (args: { path: string; resolveDir?: string }) => {
          const key = args.path;
          if (mocks[key]) return { path: key, namespace: 'mock' };
          return undefined;
        });
        build.onLoad({ filter: /.*/, namespace: 'mock' }, (args: { path: string }) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

let bundle = '';

async function openHarness(page: import('@playwright/test').Page): Promise<void> {
  await page.setContent(`<div id="root"></div><script>${bundle}</script>`);
  await expect(page.locator('[data-harness-ready="true"]')).toHaveCount(1);
}

type WalletInput = {
  address: string;
  walletClientType?: string;
  type?: string;
  connectorType?: string;
  meta?: { id?: string };
  walletIndex?: number;
  imported?: boolean;
};
const first = '0x00000000000000000000000000000000000000aa';
const second = '0x00000000000000000000000000000000000000bb';
const embedded = '0x00000000000000000000000000000000000000cc';

async function setState(page: import('@playwright/test').Page, state: Record<string, unknown>): Promise<void> {
  await page.evaluate((next) => {
    const h = globalThis.__privyHarness;
    if (typeof next.walletClientType === 'string') {
      next.walletInputs = [{ address: next.walletAddress ?? '0x00000000000000000000000000000000000000bb', walletClientType: next.walletClientType }];
      delete next.walletClientType;
      delete next.walletAddress;
    }
    if (Array.isArray(next.walletInputs)) {
      next.wallets = next.walletInputs.map((wallet: WalletInput) => ({
        ...wallet, type: wallet.type ?? 'ethereum', walletClientType: wallet.walletClientType ?? 'browser', chainId: 'eip155:1',
        getEthereumProvider: async () => ({ request: async () => '0x1' }), switchChain: async () => {},
      }));
      delete next.walletInputs;
    }
    Object.assign(h, next);
    h.notify();
  }, state);
}

async function emitCurrent(page: import('@playwright/test').Page, event: 'loginComplete' | 'loginError' | 'walletSuccess' | 'walletError', address = first): Promise<void> {
  await page.evaluate(({ event: kind, address: nextAddress }) => {
    const h = globalThis.__privyHarness;
    const wallet = { address: nextAddress, type: 'ethereum', walletClientType: 'browser', chainId: 'eip155:1' };
    // This deliberately does not capture A's old callback. Like the SDK, an
    // old operation's payload reaches B's current registrations, if any.
    if (kind === 'loginComplete') h.loginCallbacks?.onComplete?.({ user: { wallet }, loginAccount: { ...wallet, type: 'wallet' } });
    else if (kind === 'loginError') h.loginCallbacks?.onError?.('exited_auth_flow');
    else if (kind === 'walletSuccess') h.walletCallbacks?.onSuccess?.({ wallet });
    else h.walletCallbacks?.onError?.('wallet_rejected');
    h.notify();
  }, { event, address });
}

async function result(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('[data-result]').getAttribute('data-result') as Promise<string>;
}
async function closeModal(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Close Privy modal', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-modal-open', 'false');
}
async function chooseWallet(page: import('@playwright/test').Page, address: string) {
  await page.getByRole('region', { name: 'Settings wallet controls', exact: true }).getByRole('button', { name: new RegExp(`^Switch to .* ${address}$`) }).click();
  await expect(page.locator('[data-address]')).toHaveAttribute('data-address', address);
}

async function remountBridge(page: import('@playwright/test').Page) {
  const previous = Number(await page.locator('[data-adapter-mount]').getAttribute('data-adapter-mount'));
  await page.evaluate(() => globalThis.__privyHarness.remount?.());
  await expect(page.locator('[data-adapter-mount]')).toHaveAttribute('data-adapter-mount', String(previous + 1));
}
async function expectNoSdkConnection(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => ({ login: globalThis.__privyHarness.loginCalls.length, external: globalThis.__privyHarness.connectCalls }))).toEqual({ login: 0, external: 0 });
}

test.describe('Privy wallet bridge current SDK event handlers', () => {
  test.beforeAll(async () => { bundle = await buildHarness(); });

  test('opens dashboard-driven login without a wallet-only override or result callback authority', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-modal-open', 'true');
    expect(await page.evaluate(() => ({ calls: globalThis.__privyHarness.loginCalls, login: Boolean(globalThis.__privyHarness.loginCallbacks), connect: Boolean(globalThis.__privyHarness.walletCallbacks) }))).toEqual({ calls: [null], login: false, connect: false });
  });

  test('observed modal close releases both single-flight callers and allows a new attempt', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-pending-count', '2');
    expect(await page.evaluate(() => globalThis.__privyHarness.loginCalls.length)).toBe(1);
    await emitCurrent(page, 'loginError');
    await expect(page.locator('main')).toHaveAttribute('data-pending-count', '2');
    await closeModal(page);
    await expect(page.locator('main')).toHaveAttribute('data-pending-count', '0');
    expect(await page.evaluate(() => globalThis.__privyHarness.results)).toEqual(['rejected:Wallet connection was cancelled.', 'rejected:Wallet connection was cancelled.']);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    expect(await page.evaluate(() => globalThis.__privyHarness.loginCalls.length)).toBe(2);
  });

  for (const mode of ['login', 'external'] as const) {
    test(`old A success/error delivered to current B handlers cannot accept a wallet or settle B (${mode})`, async ({ page }) => {
      await openHarness(page);
      if (mode === 'external') await setState(page, { authenticated: true, walletClientType: 'privy-v2', walletAddress: embedded });
      const connect = page.getByRole('button', { name: mode === 'login' ? 'Connect' : 'Connect another wallet', exact: true });
      await connect.click();
      await closeModal(page);
      await expect.poll(() => result(page)).toMatch(/^rejected:/);
      await connect.click();
      await expect.poll(() => result(page)).toBe('pending');
      const walletInputs: WalletInput[] = mode === 'external' ? [{ address: embedded, walletClientType: 'privy-v2' }, { address: first }] : [{ address: first }];
      await setState(page, { authenticated: true, walletInputs });
      for (const event of mode === 'login' ? ['loginComplete', 'loginError'] as const : ['walletSuccess', 'walletError'] as const) {
        await emitCurrent(page, event, first);
        await expect.poll(() => result(page)).toBe('pending');
        await expect(page.locator('[data-address]')).toHaveAttribute('data-address', mode === 'external' ? embedded : '');
      }
      await closeModal(page);
      await expect.poll(() => result(page)).toMatch(/^rejected:/);
      await setState(page, { walletInputs: [...walletInputs, { address: second }] });
      await chooseWallet(page, second);
      expect(await page.evaluate(() => ({ login: globalThis.__privyHarness.loginCalls.length, external: globalThis.__privyHarness.connectCalls }))).toEqual(mode === 'login' ? { login: 2, external: 0 } : { login: 0, external: 2 });
    });
  }

  test('Back and duplicate callbacks leave one visible external intent pending until observed close', async ({ page }) => {
    await openHarness(page);
    await setState(page, { authenticated: true, walletInputs: [{ address: first }] });
    await page.getByRole('button', { name: 'Connect another wallet', exact: true }).click();
    // SDK Back can emit an error without closing its shared modal.
    await emitCurrent(page, 'walletError');
    await emitCurrent(page, 'walletSuccess');
    await emitCurrent(page, 'walletSuccess');
    await page.getByRole('button', { name: 'Connect another wallet', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-pending-count', '2');
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    expect(await page.evaluate(() => globalThis.__privyHarness.connectCalls)).toBe(1);
    await closeModal(page);
    await expect(page.locator('main')).toHaveAttribute('data-pending-count', '0');
  });

  test('a remounted bridge rejects its old waiter and ignores old payloads delivered to new handlers', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.evaluate(() => globalThis.__privyHarness.remount?.());
    await expect(page.locator('[data-adapter-mount]')).toHaveAttribute('data-adapter-mount', '1');
    await expect.poll(() => result(page)).toMatch(/^rejected:/);
    await closeModal(page);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await setState(page, { authenticated: true, walletInputs: [{ address: first }] });
    await emitCurrent(page, 'loginComplete');
    await emitCurrent(page, 'loginError');
    await expect.poll(() => result(page)).toBe('pending');
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await closeModal(page);
    await expect.poll(() => result(page)).toMatch(/^rejected:/);
  });

  test('external-only hydration requires explicit selection from the current authenticated EVM list', async ({ page }) => {
    await openHarness(page);
    await setState(page, { authenticated: true, walletInputs: [{ address: first }, { address: second }, { address: 'solana-wallet-address', type: 'solana' }] });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await expect(page.getByRole('button', { name: /Switch to .* solana-wallet-address/ })).toHaveCount(0);
    await chooseWallet(page, second);
    await setState(page, { userId: 'user-b' });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await chooseWallet(page, first);
    await setState(page, { walletInputs: [{ address: second }] });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await setState(page, { authenticated: false });
    await expect(page.getByRole('button', { name: /^Switch to / })).toHaveCount(0);
  });

  test('external candidates expose a deliberate Settings link without SDK calls, automatic navigation, or action resumption', async ({ page }) => {
    await openHarness(page);
    const originalUrl = page.url();
    await setState(page, { authenticated: true, walletInputs: [{ address: first }, { address: second }] });
    const entry = page.getByRole('region', { name: 'Shared wallet entry', exact: true });
    const choice = entry.getByRole('link', { name: 'Choose wallet', exact: true });
    await expect(choice).toBeVisible();
    await expect(choice).toHaveAttribute('href', '/settings');
    await expect(entry.getByRole('button')).toHaveCount(0);
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await expect(page).toHaveURL(originalUrl);
    expect(await page.evaluate(() => ({ login: globalThis.__privyHarness.loginCalls.length, external: globalThis.__privyHarness.connectCalls, starts: globalThis.__privyHarness.connectStarts, resumed: globalThis.__privyHarness.connectedCallbacks }))).toEqual({ login: 0, external: 0, starts: 0, resumed: 0 });
    // Candidates are shown by the real Settings controls, but that availability
    // alone cannot accept one or complete the caller's pending action.
    await chooseWallet(page, second);
    await expect(choice).toHaveCount(0);
    await expect(entry.getByRole('button', { name: 'Route connect wallet', exact: true })).toBeVisible();
    await expect(page).toHaveURL(originalUrl);
    expect(await page.evaluate(() => ({ login: globalThis.__privyHarness.loginCalls.length, external: globalThis.__privyHarness.connectCalls, starts: globalThis.__privyHarness.connectStarts, resumed: globalThis.__privyHarness.connectedCallbacks }))).toEqual({ login: 0, external: 0, starts: 0, resumed: 0 });
  });

  test('accepted embedded hydration keeps the normal entry instead of a Settings selection link', async ({ page }) => {
    await openHarness(page);
    await setState(page, { authenticated: true, walletClientType: 'privy-v2', walletAddress: embedded });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', embedded);
    const entry = page.getByRole('region', { name: 'Shared wallet entry', exact: true });
    await expect(entry.getByRole('link', { name: 'Choose wallet', exact: true })).toHaveCount(0);
    await expect(entry.getByRole('button', { name: 'Route connect wallet', exact: true })).toBeVisible();
  });

  test('the actual disconnected browser provider never offers the Privy-only selection link', async ({ page }) => {
    await openHarness(page);
    await setState(page, { providerMode: 'browser' });
    await page.evaluate(() => globalThis.__privyHarness.remount?.());
    await expect(page.locator('[data-adapter-mount]')).toHaveAttribute('data-adapter-mount', '1');
    await expect(page.locator('main')).toHaveAttribute('data-wallet-ready', 'true');
    const entry = page.getByRole('region', { name: 'Shared wallet entry', exact: true });
    await expect(entry.getByRole('link', { name: 'Choose wallet', exact: true })).toHaveCount(0);
    await expect(entry.getByRole('button', { name: 'Route connect wallet', exact: true })).toBeVisible();
    expect(await page.evaluate(() => ({ login: globalThis.__privyHarness.loginCalls.length, external: globalThis.__privyHarness.connectCalls }))).toEqual({ login: 0, external: 0 });
  });

  test('embedded ee stays pinned when ff is appended and fresh wallet clones are reordered', async ({ page }) => {
    await openHarness(page);
    const ee = '0x00000000000000000000000000000000000000ee';
    const ff = '0x00000000000000000000000000000000000000ff';
    await setState(page, { authenticated: true, walletInputs: [{ address: ee, walletClientType: 'privy-v2' }] });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', ee);
    await setState(page, { walletInputs: [{ address: ee, walletClientType: 'privy-v2' }, { address: ff, walletClientType: 'privy-v2' }] });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', ee);
    // setState rebuilds both SDK objects, so this also tests fresh clones.
    await setState(page, { walletInputs: [{ address: ff, walletClientType: 'privy-v2' }, { address: ee, walletClientType: 'privy-v2' }] });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', ee);
    expect(await page.evaluate(() => ({ login: globalThis.__privyHarness.loginCalls.length, external: globalThis.__privyHarness.connectCalls }))).toEqual({ login: 0, external: 0 });
    await chooseWallet(page, ff);
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', ff);
  });

  test('explicit external aa remains accepted across provider remount with embedded ee still available', async ({ page }) => {
    await openHarness(page);
    const ee = '0x00000000000000000000000000000000000000ee';
    const candidates: WalletInput[] = [{ address: ee, walletClientType: 'privy-v2' }, { address: first, walletClientType: 'metamask', connectorType: 'injected', meta: { id: 'metamask' } }];
    await setState(page, { authenticated: true, walletInputs: candidates });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', ee);
    await chooseWallet(page, first);
    await expect(page.locator('[data-wallet-client]')).toHaveAttribute('data-wallet-client', 'metamask');
    await remountBridge(page);
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', first);
    // A further fresh SDK list and another provider mount cannot favor ee.
    await setState(page, { walletInputs: candidates });
    await remountBridge(page);
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', first);
    await expect(page.locator('[data-wallet-client]')).toHaveAttribute('data-wallet-client', 'metamask');
    await expect(page.getByRole('region', { name: 'Shared wallet entry', exact: true }).getByRole('link', { name: 'Choose wallet', exact: true })).toHaveCount(0);
    await expectNoSdkConnection(page);
  });

  for (const remaining of ['empty', 'embedded'] as const) {
    test(`a ready ${remaining} list retires disappeared acceptance and reappearance requires an explicit choice`, async ({ page }) => {
      await openHarness(page);
      const candidates: WalletInput[] = [{ address: embedded, walletClientType: 'privy-v2' }, { address: first, walletClientType: 'metamask' }];
      await setState(page, { authenticated: true, walletsReady: true, walletInputs: candidates });
      await chooseWallet(page, first);
      await setState(page, { walletsReady: true, walletInputs: remaining === 'empty' ? [] : [candidates[0]] });
      await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
      await remountBridge(page);
      await setState(page, { walletsReady: true, walletInputs: candidates });
      await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
      await expect(page.getByRole('region', { name: 'Shared wallet entry', exact: true }).getByRole('link', { name: 'Choose wallet', exact: true })).toBeVisible();
      await chooseWallet(page, first);
      await expect(page.locator('[data-wallet-client]')).toHaveAttribute('data-wallet-client', 'metamask');
      await expectNoSdkConnection(page);
    });
  }

  test('independent unready wallet hydration exposes no account but preserves acceptance through remount', async ({ page }) => {
    await openHarness(page);
    const candidates: WalletInput[] = [{ address: embedded, walletClientType: 'privy-v2' }, { address: first, walletClientType: 'metamask' }];
    await setState(page, { authenticated: true, ready: true, walletsReady: true, walletInputs: candidates });
    await chooseWallet(page, first);
    await setState(page, { ready: true, walletsReady: false, walletInputs: [] });
    await expect(page.locator('main')).toHaveAttribute('data-wallet-ready', 'true');
    await expect(page.locator('main')).toHaveAttribute('data-sdk-wallets-ready', 'false');
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await remountBridge(page);
    await setState(page, { walletsReady: false, walletInputs: [candidates[0]] });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    const entry = page.getByRole('region', { name: 'Shared wallet entry', exact: true });
    await expect(entry.getByRole('link', { name: 'Choose wallet', exact: true })).toHaveCount(0);
    await expect(entry.getByRole('button', { name: 'Route connect wallet', exact: true })).toBeEnabled();
    await setState(page, { walletsReady: true, walletInputs: candidates });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', first);
    await expect(page.locator('[data-wallet-client]')).toHaveAttribute('data-wallet-client', 'metamask');
    await expectNoSdkConnection(page);
  });

  test('logout clears accepted external identity and stale SDK state cannot restore it after remount', async ({ page }) => {
    await openHarness(page);
    const candidates: WalletInput[] = [{ address: embedded, walletClientType: 'privy-v2' }, { address: first, walletClientType: 'metamask' }];
    await setState(page, { authenticated: true, walletInputs: candidates });
    await chooseWallet(page, first);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-authenticated', 'false');
    await setState(page, { authenticated: true, walletsReady: true, walletInputs: candidates });
    await remountBridge(page);
    await expect(page.locator('main')).toHaveAttribute('data-authenticated', 'false');
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await expect(page.getByRole('button', { name: /^Switch to / })).toHaveCount(0);
    await expectNoSdkConnection(page);
  });

  test('observed user changes require explicit choice even for embedded candidates and A-to-B-to-A restoration', async ({ page }) => {
    await openHarness(page);
    const candidates: WalletInput[] = [{ address: embedded, walletClientType: 'privy-v2' }, { address: first, walletClientType: 'metamask' }];
    await setState(page, { authenticated: true, userId: 'user-a', walletsReady: true, walletInputs: candidates });
    await chooseWallet(page, first);
    // The SDK can publish user B before replacing A's ready wallet list.
    // Neither A's external choice nor its embedded candidate authorizes B.
    await setState(page, { userId: 'user-b' });
    await expect(page.locator('main')).toHaveAttribute('data-user-id', 'user-b');
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await remountBridge(page);
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await setState(page, { userId: 'user-a', walletInputs: candidates });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await remountBridge(page);
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await chooseWallet(page, embedded);
    await expect(page.locator('[data-wallet-client]')).toHaveAttribute('data-wallet-client', 'privy-v2');
    await expectNoSdkConnection(page);
  });

  test('same address from a different wallet client cannot inherit acceptance', async ({ page }) => {
    await openHarness(page);
    const metamask: WalletInput = { address: first, walletClientType: 'metamask', connectorType: 'injected', meta: { id: 'metamask' } };
    const coinbase: WalletInput = { address: first, walletClientType: 'coinbase_wallet', connectorType: 'coinbase_wallet', meta: { id: 'coinbase' } };
    await setState(page, { authenticated: true, walletInputs: [metamask] });
    await chooseWallet(page, first);
    await setState(page, { walletInputs: [coinbase] });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await remountBridge(page);
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await chooseWallet(page, first);
    await expect(page.locator('[data-wallet-client]')).toHaveAttribute('data-wallet-client', 'coinbase_wallet');
    await expectNoSdkConnection(page);
  });

  test('address-only Settings selection fails closed when distinct wallet clients expose the same address', async ({ page }) => {
    await openHarness(page);
    const candidates: WalletInput[] = [{ address: first, walletClientType: 'metamask', connectorType: 'injected' }, { address: first, walletClientType: 'coinbase_wallet', connectorType: 'coinbase_wallet' }];
    await setState(page, { authenticated: true, walletInputs: candidates });
    const controls = page.getByRole('region', { name: 'Settings wallet controls', exact: true });
    await controls.getByRole('button', { name: `Switch to metamask ${first}`, exact: true }).click();
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await controls.getByRole('button', { name: `Switch to coinbase_wallet ${first}`, exact: true }).click();
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await remountBridge(page);
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    await expectNoSdkConnection(page);
  });

  test('Settings remains busy through global callbacks, then modal close enables explicit wallet choice', async ({ page }) => {
    await openHarness(page);
    await setState(page, { authenticated: true, walletClientType: 'privy-v2', walletAddress: embedded });
    const controls = page.getByRole('region', { name: 'Settings wallet controls', exact: true });
    const connect = controls.getByRole('button', { name: 'Connect external wallet', exact: true });
    await connect.click();
    await expect(connect).toBeDisabled();
    await setState(page, { walletInputs: [{ address: embedded, walletClientType: 'privy-v2' }, { address: second }] });
    await emitCurrent(page, 'walletSuccess', second);
    await expect(connect).toBeDisabled();
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', embedded);
    await closeModal(page);
    await expect(connect).toBeEnabled();
    await expect(controls.getByRole('status')).toContainText('Choose a wallet below to use it.');
    await chooseWallet(page, second);
    await expect(controls.getByRole('status')).toHaveCount(0);
  });

  test('an ignored SDK open becomes unavailable instead of leaving the caller busy forever', async ({ page }) => {
    await page.clock.install();
    await openHarness(page);
    // Hold modal state closed even though login was invoked, as with an SDK no-op.
    await page.evaluate(() => {
      const h = globalThis.__privyHarness;
      Object.defineProperty(h, 'modalOpen', { configurable: true, get: () => false, set: () => {} });
    });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.clock.fastForward(5_001);
    await expect.poll(() => result(page)).toMatch(/^rejected:The wallet window did not open/);
  });

  test('Telegram missing launch data asks the user to reopen Telegram without starting OAuth', async ({ page }) => {
    await openHarness(page);
    await setState(page, { telegram: true, initData: '' });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(() => result(page)).toMatch(/^rejected:.*(?:Telegram|reopen|open)/i);
    expect(await page.evaluate(() => ({ login: globalThis.__privyHarness.loginCalls.length, external: globalThis.__privyHarness.connectCalls, reconnect: globalThis.__privyHarness.telegramReconnectCalls }))).toEqual({ login: 0, external: 0, reconnect: 0 });
    expect(page.url()).not.toMatch(/tgWebAppData=/i);
  });

  test('Telegram disconnect stays explicit and reconnect restarts native auth without OAuth or external selection', async ({ page }) => {
    await openHarness(page);
    await setState(page, { telegram: true, initData: 'synthetic-launch-data-marker-do-not-forward', authenticated: true, walletClientType: 'privy-v2', walletAddress: embedded });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', embedded);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-authenticated', 'false');
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '');
    expect(await page.evaluate(() => ({ logout: globalThis.__privyHarness.logoutCalls, login: globalThis.__privyHarness.loginCalls.length, external: globalThis.__privyHarness.connectCalls, reconnect: globalThis.__privyHarness.telegramReconnectCalls }))).toEqual({ logout: 1, login: 0, external: 0, reconnect: 0 });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(() => result(page)).toBe('resolved');
    await expect(page.locator('main')).toHaveAttribute('data-authenticated', 'true');
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', embedded);
    expect(await page.evaluate(() => ({ login: globalThis.__privyHarness.loginCalls.length, external: globalThis.__privyHarness.connectCalls, reconnect: globalThis.__privyHarness.telegramReconnectCalls }))).toEqual({ login: 0, external: 0, reconnect: 1 });
    expect(page.url()).not.toContain('synthetic-launch-data-marker-do-not-forward');
    expect(page.url()).not.toMatch(/tgWebAppData=/i);
  });

  test('seamless Telegram embedded hydration remains automatic and Connect opens no external selector', async ({ page }) => {
    await openHarness(page);
    await setState(page, { telegram: true, authenticated: true, walletInputs: [{ address: first }, { address: embedded, walletClientType: 'privy-v2' }] });
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', embedded);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(() => result(page)).toBe('resolved');
    expect(await page.evaluate(() => globalThis.__privyHarness.connectCalls)).toBe(0);
  });

  test('Telegram embedded auth still allows an explicit external wallet request', async ({ page }) => {
    await openHarness(page);
    await setState(page, { telegram: true, authenticated: true, walletClientType: 'privy-v2' });
    await page.getByRole('button', { name: 'Connect another wallet', exact: true }).click();
    expect(await page.evaluate(() => globalThis.__privyHarness.connectCalls)).toBe(1);
  });
});
