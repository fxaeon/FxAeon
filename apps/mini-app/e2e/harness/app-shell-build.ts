import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { SHELL_INITIALIZER } from '../../src/app/shellInitializer';

/** Bundles the real shell (AppShell, header controls, dock, page headings)
 * with Tailwind-compiled globals.css, product-shell.css and the Inter font,
 * against small in-memory wallet and router mocks. No Next build needed. */
const appRoot = resolve(__dirname, '../..');
const repoRoot = resolve(appRoot, '../..');
const src = resolve(appRoot, 'src');
const appRequire = createRequire(resolve(appRoot, 'package.json'));
const tsxPackage = createRequire(resolve(repoRoot, 'package.json')).resolve('tsx/package.json', { paths: [appRoot] });
const esbuild = createRequire(tsxPackage)('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
const postcss = appRequire('postcss') as (plugins: unknown[]) => { process: (css: string, options: Record<string, unknown>) => Promise<{ css: string }> };
const tailwindcss = appRequire('tailwindcss') as (config: unknown) => unknown;
const autoprefixer = appRequire('autoprefixer') as () => unknown;

export const LAB_ORIGIN = 'http://shell.lab';

const store = `
  const lab = globalThis.__shellLab ??= (() => {
    const listeners = new Set();
    const state = {
      path: '/portfolio', overlay: 'none',
      wallet: { ready: false, authenticated: false, address: undefined, chainId: undefined, connectionVersion: 0, ensName: undefined },
    };
    let snapshot = { path: state.path, overlay: state.overlay, outline: false };
    return {
      state,
      get path() { return state.path; },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      snapshot() { return snapshot; },
      set(patch) {
        if (patch.wallet) state.wallet = { ...state.wallet, ...patch.wallet, connectionVersion: state.wallet.connectionVersion + 1 };
        if (patch.path) state.path = patch.path;
        if (patch.overlay) state.overlay = patch.overlay;
        if (patch.readyTimeoutMs) state.readyTimeoutMs = patch.readyTimeoutMs;
        if ('outline' in patch) state.outline = Boolean(patch.outline);
        snapshot = { path: state.path, overlay: state.overlay, outline: Boolean(state.outline) };
        for (const listener of [...listeners]) listener();
      },
    };
  })();
`;

const mocks: Record<string, string> = {
  'next/navigation': `import { useSyncExternalStore } from 'react'; ${store}
    export function usePathname() { return useSyncExternalStore(lab.subscribe, () => lab.state.path); }
    export function useRouter() { return { push(href) { lab.set({ path: href }); } }; }`,
  'next/link': `import React from 'react'; ${store}
    export default function Link({ href, children, onClick, prefetch, ...props }) {
      return React.createElement('a', { href, ...props, onClick(event) {
        onClick?.(event);
        if (event.defaultPrevented || /^https?:/.test(href)) return;
        event.preventDefault();
        lab.set({ path: href.split('#')[0] || '/' });
      } }, children);
    }`,
  '@/lib/wallet': `import { useEffect, useState, useSyncExternalStore } from 'react'; ${store}
    export function usePrivyWallet() {
      const wallet = useSyncExternalStore(lab.subscribe, () => lab.state.wallet);
      return { ...wallet, switchChain: async (chainId) => lab.set({ wallet: { chainId } }) };
    }
    export function useWalletReadyTimeout(ready) {
      const [timedOut, setTimedOut] = useState(false);
      useEffect(() => {
        if (ready) { setTimedOut(false); return; }
        const timer = setTimeout(() => setTimedOut(true), lab.state.readyTimeoutMs ?? 12000);
        return () => clearTimeout(timer);
      }, [ready]);
      return !ready && timedOut;
    }`,
  '@/lib/telegram': 'export const haptic = () => {}; export const openExternalLink = () => false; export const applyTelegramChromeColors = () => {}; export const isTelegramLaunchContext = () => false; export const hasTelegramMiniAppLaunchData = () => false;',
  '@/lib/privyConfig': "export const PRIVY_APP_ID = ''; export const privyConfigured = () => false;",
  './PrivyFlow': 'export default function PrivyFlow() { return null; }',
  // History's feed module: only its skeleton renders before a wallet exists.
  '@tanstack/react-query': 'export const useQuery = () => ({});',
  './BridgeTracker': 'export const BridgeTracker = () => null;',
  '@/components/PriceProvider': "export const useUsdPrices = () => ({ prices: {}, status: 'unavailable', refresh() {} });",
  '@/lib/useWalletActivity': 'export const useWalletActivity = () => ({ isPending: true, isFetching: true, hasMore: false, data: undefined, refetch: async () => {}, loadMore: async () => {} });',
  '@/lib/fx/drafts': "export const cancelSignatureRequiredDraft = () => {}; export const signatureDraftResumePath = () => '/trade';",
  '@/lib/activityReceipt': 'export const loadActivityReceipt = async () => ({});',
  // Settings and More dependencies that would reach a chain or a provider.
  'next/dynamic': "export default function dynamic(load, options) { return function Dynamic() { return options && options.loading ? options.loading() : null; }; }",
  wagmi: 'export const useEnsName = () => ({ data: undefined }); export const useEnsAddress = () => ({ data: undefined });',
  '@/components/WalletDemandProvider': 'export const useWalletProfileSession = () => ({ walletProfileAddress: null, setWalletProfileAddress() {} });',
  '@/components/WalletSection': 'export default function WalletSection() { return null; }',
  '@/lib/fx/gasFeePolicy': "export async function fetchGasTierQuotes() { return { tiers: { standard: { gasPriceWei: 1200000000n }, fast: { gasPriceWei: 1500000000n }, rapid: { gasPriceWei: 2100000000n } } }; }",
  '@/components/ConnectWalletButton': `import React from 'react';
    export default function ConnectWalletButton({ children, loadingLabel, onConnectStart, onConnected, onConnectError, resumeIfConnected, ...props }) {
      return <button type="button" {...props}>{children}</button>;
    }`,
  // The header trigger of WalletProfile, with its real classes; the sheet is out of scope here.
  '@/components/WalletProfile': `import React from 'react';
    import accountStyles from '@/app/AccountWorkspace.module.css';
    import headerWalletControl from '@/components/HeaderWalletControl.module.css';
    import { WalletAvatar } from '@/components/WalletAvatar';
    import { compactAddress } from '@/lib/addressPresentation';
    import { usePrivyWallet } from '@/lib/wallet';
    export default function WalletProfile() {
      const wallet = usePrivyWallet();
      if (!wallet.ready) return <span role="status" className="h-11 w-11 animate-pulse rounded-xl bg-[var(--surface)]"><span className="sr-only">Loading wallet</span></span>;
      if (!wallet.address) return <button type="button" aria-label="Connect wallet" className={accountStyles.walletConnect + ' ' + headerWalletControl.trigger + ' glass-press'}>Connect</button>;
      return <button type="button" aria-label="Open wallet profile" className={accountStyles.walletTrigger + ' ' + headerWalletControl.trigger + ' ' + headerWalletControl.identityTrigger + ' glass-press'}>
        <span className={headerWalletControl.identityAvatar}><WalletAvatar address={wallet.address} size={22} /></span>
        <span className={headerWalletControl.identityName} data-wallet-identity-name>{wallet.ensName ?? compactAddress(wallet.address)}</span>
      </button>;
    }`,
};

function resolveSource(path: string): string {
  const candidate = resolve(src, path.slice(2));
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return `${candidate}${extension}`;
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    for (const extension of ['.tsx', '.ts']) if (existsSync(resolve(candidate, `index${extension}`))) return resolve(candidate, `index${extension}`);
  }
  return candidate;
}

export async function buildAppShellLab(): Promise<{ script: string; css: string; html: string }> {
  const result = await esbuild.build({
    entryPoints: [resolve(appRoot, 'e2e/harness/app-shell-entry.tsx')], outdir: resolve(appRoot, 'app-shell-lab'), entryNames: 'index',
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.module.css': 'local-css' }, absWorkingDir: repoRoot,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'app-shell-lab', setup(build: {
      onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => unknown): void;
      onLoad(options: { filter: RegExp; namespace?: string }, callback: (args: { path: string }) => unknown): void;
    }) {
      build.onResolve({ filter: /^(next\/(link|navigation|dynamic)|wagmi|@tanstack\/react-query|\.\/(PrivyFlow|BridgeTracker))$/ }, (args) => ({ path: args.path, namespace: 'shell-mock' }));
      build.onResolve({ filter: /^@\// }, (args) => mocks[args.path] ? { path: args.path, namespace: 'shell-mock' } : { path: resolveSource(args.path) });
      build.onLoad({ filter: /.*/, namespace: 'shell-mock' }, (args) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: appRoot }));
    } }],
  });
  const script = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
  const modules = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  if (!script) throw new Error('The app shell lab bundle was not emitted.');
  const tailwindConfig = appRequire(resolve(appRoot, 'tailwind.config.js'));
  const globals = await postcss([tailwindcss({ ...tailwindConfig, content: [resolve(src, '**/*.{ts,tsx}'), resolve(appRoot, 'e2e/harness/app-shell-*.{ts,tsx}')] }), autoprefixer()])
    .process(`${readFileSync(resolve(src, 'app/globals.css'), 'utf8')}\n${readFileSync(resolve(src, 'app/product-shell.css'), 'utf8')}`, { from: resolve(src, 'app/globals.css') });
  const font = "@font-face{font-family:Inter;src:url('/inter.woff2') format('woff2');font-weight:100 900;font-display:block}:root{--font-sans:Inter}body{font-family:Inter,sans-serif}";
  // As in layout.tsx: the shell initializer runs in <head> before the first paint.
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    + `<script>window.__labInit&&window.__labInit()</script><script>${SHELL_INITIALIZER}</script>`
    + '<link rel="stylesheet" href="/lab.css"></head><body><div id="root"></div><script src="/lab.js"></script></body></html>';
  return { script, css: `${font}\n${globals.css}\n${modules}`, html };
}

/** Serves the lab and the app's public assets from one fake origin. */
export async function serveAppShellLab(page: Page, lab: { script: string; css: string; html: string }, initScript = ''): Promise<void> {
  await page.route(`${LAB_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/lab.js') return route.fulfill({ contentType: 'text/javascript', body: lab.script });
    if (url.pathname === '/lab.css') return route.fulfill({ contentType: 'text/css', body: lab.css });
    if (url.pathname === '/inter.woff2') return route.fulfill({ contentType: 'font/woff2', body: readFileSync(resolve(appRoot, 'e2e/harness/assets/inter-latin.woff2')) });
    const asset = resolve(appRoot, 'public', `.${url.pathname}`);
    if (url.pathname !== '/' && existsSync(asset) && statSync(asset).isFile()) return route.fulfill({ path: asset });
    return route.fulfill({ contentType: 'text/html', body: lab.html.replace('window.__labInit&&window.__labInit()', initScript) });
  });
}
