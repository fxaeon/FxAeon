import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const app = resolve(__dirname, '../..');
const root = resolve(app, '../..');
const src = resolve(app, 'src');
const appRequire = createRequire(resolve(app, 'package.json'));
const realWagmi = appRequire.resolve('wagmi');
const realWagmiActions = appRequire.resolve('wagmi/actions');
type BuildApi = {
  onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => unknown) => void;
  onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => unknown) => void;
};
type BuildResult = {
  outputFiles: Array<{ path: string; text: string }>;
  metafile: { inputs: Record<string, unknown>; outputs: Record<string, { inputs: Record<string, unknown> }> };
};
const esbuild = createRequire(appRequire.resolve('tsx/package.json'))('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<BuildResult>;
};

// These are external service/route-data leaves only. In particular, both real
// providers, both real wallet adapters, FxWalletContext, Telegram detection,
// discovery, the picker, the browser session owner, and Wagmi actions remain.
const mocks: Record<string, string> = {
  'next/dynamic': `
    import { lazy, Suspense } from 'react';
    export default function dynamic(loader, options = {}) {
      const Component = lazy(loader);
      return function DynamicComponent(props) {
        const Loading = options.loading;
        return <Suspense fallback={Loading ? <Loading /> : null}><Component {...props} /></Suspense>;
      };
    }
  `,
  'next/navigation': `export const useRouter = () => ({ push: (path) => globalThis.__wagmiBoundaryHarness.navigate?.(path) });`,
  '@/components/ProviderLoadingState': `export const ProviderLoadingState = () => <p role="status" data-provider-wait="true">Waiting for wallet provider</p>;`,
  '@/components/WalletRouteProviders': `
    import { useEffect } from 'react';
    export default function WalletRouteProviders({ children }) {
      useEffect(() => {
        const h = globalThis.__wagmiBoundaryHarness;
        h.routeMounts += 1;
        return () => { h.routeUnmounts += 1; };
      }, []);
      return children;
    }
  `,
  '@/lib/fx/clients': `export const getPublicClient = () => { throw Error('Public RPC is disabled in the synthetic ownership harness'); };`,
  '@privy-io/react-auth': `
    import { useEffect } from 'react';
    const h = globalThis.__wagmiBoundaryHarness;
    h.privyModuleLoads += 1;
    const address = '0x00000000000000000000000000000000000000ee';
    const wallets = [{ address, type: 'ethereum', walletClientType: 'privy-v2', chainId: 'eip155:1',
      getEthereumProvider: async () => h.embeddedProvider,
      switchChain: async () => { throw Error('Synthetic embedded network switching is disabled'); },
    }];
    const user = { id: 'synthetic-funded-telegram-user', isGuest: false, wallet: { address } };
    const called = () => { h.privyHookCalls += 1; };
    const forbidden = () => { h.forbiddenCalls.push('privy:mutation'); throw Error('Synthetic authentication/signing is disabled'); };
    export function PrivyProvider({ children }) {
      useEffect(() => { h.privyMounts += 1; return () => { h.privyUnmounts += 1; }; }, []);
      return children;
    }
    export const usePrivy = () => { called(); return { ready: true, authenticated: true, user }; };
    export const useWallets = () => { called(); return { ready: true, wallets }; };
    export const useModalStatus = () => { called(); return { isOpen: false }; };
    export const useLogout = () => { called(); return { logout: forbidden }; };
    export const useLogin = () => { called(); return { login: forbidden }; };
    export const useConnectWallet = () => { called(); return { connectWallet: forbidden }; };
    export const useSendTransaction = () => { called(); return { sendTransaction: forbidden }; };
  `,
};

// Forward to the installed public Wagmi exports without changing arguments,
// return values, actions, store, or connector behavior. Zero factory calls in
// Telegram is meaningful only if the web test proves these probes fire.
const wagmiProbe = `
  export * from ${JSON.stringify(realWagmi)};
  import { createConfig as actualCreateConfig, createConnector as actualCreateConnector } from ${JSON.stringify(realWagmi)};
  import { getConnection } from ${JSON.stringify(realWagmiActions)};
  export function createConnector(...args) {
    globalThis.__wagmiBoundaryHarness.connectorCreates += 1;
    return actualCreateConnector(...args);
  }
  export function createConfig(...args) {
    const h = globalThis.__wagmiBoundaryHarness;
    const index = h.configCreates++;
    const config = actualCreateConfig(...args);
    const observe = () => {
      const value = getConnection(config);
      h.wagmiConnections[index] = { status: value.status, accounts: value.addresses ?? [], connectorId: value.connector?.id };
    };
    observe();
    // Read-only observer scoped to this synthetic document's lifetime.
    config.subscribe((state) => state, observe);
    return config;
  }
`;

const styles = `
  :root{color-scheme:dark;font:16px/1.5 system-ui;background:#101018;color:#f0eef8}
  body{margin:0;padding:24px;max-width:1000px}a{color:#c4a7ff;margin-right:14px}
  button{font:inherit;color:inherit;background:#302c40;border:1px solid #625477;border-radius:8px;padding:9px 14px;min-height:44px;cursor:pointer}
  button:focus-visible,a:focus-visible{outline:3px solid #c4a7ff;outline-offset:3px}
  .fixture-controls{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}main{padding:18px;border:1px solid #625477;border-radius:12px}
  output{overflow-wrap:anywhere}pre{font:13px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere}
  .wallet-provider-chooser-backdrop{position:fixed;inset:0;z-index:100;background:#000a;display:flex;align-items:center;justify-content:center;padding:16px}
  .wallet-provider-chooser{background:#201c2c;border:1px solid #625477;border-radius:16px;width:min(420px,100%);max-height:85vh;overflow:auto;padding:18px}
  .wallet-provider-chooser-header{display:flex;align-items:center;gap:12px}.wallet-provider-chooser-header h2{flex:1;font-size:21px}
  .wallet-provider-options{display:grid;gap:8px}.wallet-provider-option{display:flex;align-items:center;gap:12px;width:100%;text-align:left;margin:8px 0}
  .wallet-provider-mark{display:inline-flex;width:32px;height:32px;align-items:center;justify-content:center}.wallet-provider-mark img{width:32px;height:32px}
`;

export type WalletWagmiBoundaryBundle = {
  files: Map<string, string>;
  privyPaths: Set<string>;
  realModules: string[];
};

/** Also used for build-only/static QA; it never starts a browser or server. */
export async function buildWalletWagmiBoundaryHarness(): Promise<WalletWagmiBoundaryBundle> {
  const outdir = resolve(app, 'e2e/.wagmi-boundary-memory');
  const common = { bundle: true, write: false, platform: 'browser', target: 'es2020', absWorkingDir: root,
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_PRIVY_APP_ID': '"synthetic-privy-app-id"', 'process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE': '"0"', 'process.env': '{}' } };
  const bootstrap = await esbuild.build({ ...common, entryPoints: [resolve(__dirname, 'wallet-wagmi-boundary-bootstrap.ts')], outfile: resolve(outdir, 'bootstrap.js'), format: 'iife' });
  const result = await esbuild.build({ ...common, entryPoints: [resolve(__dirname, 'wallet-wagmi-boundary-entry.tsx')], outdir,
    splitting: true, format: 'esm', jsx: 'automatic', metafile: true,
    plugins: [{ name: 'wallet-wagmi-boundary-services', setup(build: BuildApi) {
      build.onResolve({ filter: /.*/ }, ({ path }) => {
        if (path === 'wagmi') return { path, namespace: 'wagmi-probe' };
        if (mocks[path]) return { path, namespace: 'mock' };
        if (path.endsWith('.css')) return { path, namespace: 'styles' };
        if (!path.startsWith('@/')) return undefined;
        const candidate = resolve(src, path.slice(2));
        for (const extension of ['.tsx', '.ts', '/index.tsx', '/index.ts']) if (existsSync(candidate + extension)) return { path: candidate + extension };
        return { path: candidate };
      });
      build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path], loader: 'tsx', resolveDir: app }));
      build.onLoad({ filter: /.*/, namespace: 'wagmi-probe' }, () => ({ contents: wagmiProbe, loader: 'js', resolveDir: app }));
      build.onLoad({ filter: /.*/, namespace: 'styles' }, () => ({ contents: 'export default {};', loader: 'js' }));
    } }],
  });
  const urlPath = (file: string) => `/${relative(outdir, resolve(root, file)).replaceAll('\\', '/')}`;
  const files = new Map([...bootstrap.outputFiles, ...result.outputFiles].map((file) => [urlPath(file.path), file.text]));
  const privyPaths = new Set(Object.entries(result.metafile.outputs)
    .filter(([, output]) => Object.hasOwn(output.inputs, 'mock:@privy-io/react-auth')).map(([path]) => urlPath(path)));
  assert.ok(privyPaths.size > 0, 'Privy service must be present in a separately loaded chunk');
  assert.ok(!privyPaths.has('/wallet-wagmi-boundary-entry.js'), 'Ordinary web must not eagerly import Privy');
  const realModules = Object.keys(result.metafile.inputs).map((path) => path.replaceAll('\\', '/'));
  for (const path of [
    'src/components/ClientWalletProvider.tsx', 'src/components/PrivyClientProvider.tsx',
    'src/components/ExternalWalletDialog.tsx', 'src/lib/wallet/context.ts',
    'src/lib/wallet/usePrivyWallet.ts', 'src/lib/wallet/PrivyWalletBridge.ts',
    'src/lib/wallet/browserWagmiSessionOwner.ts', 'src/lib/telegram.ts',
    '/wagmi/dist/esm/exports/index.js', '/wagmi/dist/esm/exports/actions.js',
  ]) assert.ok(realModules.some((input) => input.endsWith(path)), `Harness must retain real ${path}`);
  files.set('/harness.css', styles);
  for (const name of ['metamask', 'base', 'coinbase', 'okx', 'rabby', 'trust-wallet', 'phantom', 'rainbow', 'zerion']) {
    files.set(`/wallets/${name}.svg`, readFileSync(resolve(app, `public/wallets/${name}.svg`), 'utf8'));
  }
  files.set('/index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self';connect-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';base-uri 'none';form-action 'none'"><link rel="stylesheet" href="/harness.css"><title>Real Wagmi / Privy boundary fixture</title></head><body><div id="root"></div><script src="/bootstrap.js"></script><script type="module" src="/wallet-wagmi-boundary-entry.js"></script></body></html>`);
  return { files, privyPaths, realModules };
}
