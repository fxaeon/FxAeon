import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Bundles the real Portfolio and History pages (and the provider fallback)
 * against inline mock providers, with the app's real global and module CSS.
 * Every mock reads `globalThis.__portfolioStates.stage`, set before the bundle
 * runs, so one page load shows exactly one first-load state.
 */
const appRoot = resolve(__dirname, '../..');
const root = resolve(appRoot, '../..');
const src = resolve(appRoot, 'src');
const appRequire = createRequire(resolve(appRoot, 'package.json'));
const tsxPackage = appRequire.resolve('tsx/package.json');
type BuildApi = {
  onResolve: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void;
  onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string }) => unknown) => void;
};
const esbuild = createRequire(tsxPackage)('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};

const WALLET = '0x930f0000000000000000000000000000000098b9';

const shared = `
const harness = () => globalThis.__portfolioStates;
const stage = () => harness().stage;
const settled = () => !['wallet', 'timeout', 'reads'].includes(stage());
const never = () => new Promise(() => {});
`;

const mocks: Record<string, string> = {
  'next/link': `import React from 'react'; export default React.forwardRef(function Link({ href, children, prefetch, scroll, replace, ...props }, ref) { return <a ref={ref} href={typeof href === 'string' ? href : '#'} {...props} onClick={(event) => { event.preventDefault(); props.onClick?.(event); }}>{children}</a>; });`,
  'next/navigation': `export const useRouter = () => ({ push() {}, replace() {}, back() {}, prefetch() {} }); export const usePathname = () => globalThis.__portfolioStates.route; export const useSearchParams = () => new URLSearchParams();`,
  '@/lib/wallet': `${shared}
const ready = () => !['wallet', 'timeout'].includes(stage());
export const isWalletConnectCancellation = () => false;
export function useWalletReadyTimeout(isReady) { return !isReady && stage() === 'timeout'; }
export function usePrivyWallet() {
  const address = ready() ? '${WALLET}' : undefined;
  return { ready: ready(), authenticated: ready(), address, chainId: 1, isEmbedded: true, wallets: [], connectionVersion: 1,
    selectedWallet: address ? { address } : null, connect: async () => {}, disconnect: async () => {}, switchChain: async () => {}, sendTransaction: async () => {} };
}`,
  '@/lib/wallet/activeWalletAddress': `export const activeWalletAddress = (wallet) => wallet.ready && wallet.authenticated ? wallet.address ?? null : null;`,
  '@/components/ConnectWalletButton': `import React from 'react'; export default function ConnectWalletButton({ children, loadingLabel, ...props }) { return <button type="button" {...props}>{children}</button>; }`,
  '@/components/AccountControls': `export const useVerifiedWalletName = () => null;`,
  '@/components/WalletExportAction': `export const WalletExportAction = () => null;`,
  '@/lib/privyConfig': `export const privyConfigured = () => false; export const PRIVY_APP_ID = '';`,
  '@/lib/pendingActivity': `export const usePendingActivity = () => ({ pendingCount: 0, notices: [], dismiss() {} });`,
  '@/components/WalletDemandProvider': `import { useSyncExternalStore } from 'react';
let profile = null; const listeners = new Set();
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export function useWalletDemand() {}
export function useWalletProfileSession() {
  const walletProfileAddress = useSyncExternalStore(subscribe, () => profile, () => profile);
  return { walletProfileAddress, setWalletProfileAddress(next) { profile = next; listeners.forEach((listener) => listener()); } };
}`,
  '@/components/PriceProvider': `${shared}
const now = Date.now();
const PRICES = { ETH: 2400, WETH: 2400, stETH: 2400, wstETH: 2900, WBTC: 104000, fxUSD: 1, USDC: 1, USDT: 1, FXN: 26, fxSAVE: 1.05, fxUSDBasePool: 1 };
export function useUsdPrices() {
  const loading = stage() === 'reads' || stage() === 'wallet' || stage() === 'timeout';
  const prices = loading || stage() === 'unavailable' ? {} : PRICES;
  return { prices, status: loading ? 'loading' : stage() === 'unavailable' ? 'unavailable' : 'live', updatedAt: loading ? null : now,
    updatedAts: Object.fromEntries(Object.keys(prices).map((key) => [key, now])), refreshing: false, refresh: async () => {} };
}
export const useUsdPrice = (key) => useUsdPrices().prices[key];
export function useLiveMarketQuote() {
  return { quote: null, status: settled() ? 'unavailable' : 'connecting', isFresh: false };
}`,
  '@/components/WalletDataProvider': `${shared}
import { FX_TOKENS } from '@/lib/fx/tokens';
const fixtures = () => globalThis.__portfolioFixtures;
export function useWalletBalances({ address, enabled = true }) {
  if (!enabled || !address) return { data: null, status: 'idle', isFetching: false, updatedAt: null, error: '', refresh: async () => undefined };
  if (!settled()) return { data: null, status: 'loading', isFetching: true, updatedAt: null, error: '', refresh: async () => undefined };
  if (stage() === 'unavailable') return { data: null, status: 'unavailable', isFetching: false, updatedAt: null, error: '', refresh: async () => undefined };
  return { data: fixtures().balances(stage()), status: 'ready', isFetching: false, updatedAt: fixtures().now, error: '', refresh: async () => undefined };
}
export function useFxSaveClaimable({ address, enabled = true }) {
  if (!enabled || !address) return { data: null, status: 'idle', isFetching: false, updatedAt: null, refresh: async () => undefined };
  return settled() ? { data: null, status: 'ready', isFetching: false, updatedAt: fixtures().now, refresh: async () => undefined }
    : { data: null, status: 'loading', isFetching: true, updatedAt: null, refresh: async () => undefined };
}
export function useWalletAssets({ address, enabled = true } = {}) {
  if (!enabled || !address) return { data: null, status: 'idle', isFetching: false, error: '', refresh: async () => undefined };
  if (!settled()) return { data: null, status: 'loading', isFetching: true, error: '', refresh: async () => undefined };
  if (stage() === 'unavailable') return { data: null, status: 'unavailable', isFetching: false, error: 'Assets unavailable.', refresh: async () => undefined };
  return { data: fixtures().assets(stage()), status: 'ready', isFetching: false, error: '', refresh: async () => undefined };
}
const chain = (chainId) => ({ chainId, status: 'idle', transport: null, latestBlockNumber: null, lastEventAt: null, lastTransferAt: null, reconnectAttempt: 0, revision: 0 });
export function useRealtimeChainState(chainId) { return chainId ? chain(chainId) : { 1: chain(1), 8453: chain(8453) }; }
export const useInvalidateWalletData = () => async () => {};
export { FX_TOKENS as __tokens };`,
  '@/components/ProtocolPositionProvider': `${shared}
export function useProtocolPositions() {
  const status = !settled() ? 'loading' : stage() === 'unavailable' ? 'unavailable' : 'ready';
  const positions = stage() === 'positions' ? globalThis.__portfolioFixtures.positions : [];
  return { walletAddress: '${WALLET}', positions, pendingPositions: [], failedGroups: status === 'unavailable' ? [{ market: 'ETH', side: 'long', reason: new Error('read failed') }] : [],
    status, refreshing: false, lastVerifiedAt: status === 'ready' ? Date.now() : null, refresh: async () => {}, checkingConfirmedPositions: false };
}`,
  // The brake provider reads the chain above this page; here each fixture
  // position answers with a current read so the real card draws its brake.
  '@/components/PositionBrakeContext': `export function usePositionBrake(position) {
  if (position.info.rawDebts <= 0n) return { status: 'none' };
  const reading = globalThis.__portfolioFixtures.brakes[position.market + ':' + position.side + ':' + position.info.positionId];
  return reading ? { status: 'ready', reading, readAt: Date.now() } : { status: 'unavailable' };
}`,
  '@/components/ConfirmedPositionCards': `export const ConfirmedPositionCards = () => null;`,
  // CommonJS behind a Proxy: the read facade is the only live export; every
  // other name the page graph imports resolves to an inert stub.
  '@/lib/fx': `${shared}
const known = {
  assertConfiguredPublicClientChain: async () => {},
  withReadDeadline: (promise) => promise,
  getFxReadFacade: () => ({ getFxSaveBalance: () => !settled() ? never()
    : stage() === 'unavailable' ? Promise.reject(new Error('fxSAVE read failed'))
      : Promise.resolve(globalThis.__portfolioFixtures.fxSave(stage())) }),
};
module.exports = new Proxy(known, { get: (target, key) => key in target ? target[key] : key === '__esModule' ? false : () => undefined });`,
  '@/app/trade/fxUi': `import { formatUnits } from 'viem';
export function formatAmount(value, decimals = 18, digits = 5) { if (value === undefined) return '—'; const [integer, fraction = ''] = formatUnits(value, decimals).split('.'); const trimmed = fraction.slice(0, digits).replace(/0+$/, ''); return trimmed ? integer + '.' + trimmed : integer; }
export const positionDisplayLeverage = (position) => ({ value: position.side === 'short' ? position.info.lsdLeverage : position.info.currentLeverage, label: 'leverage' });
export const positionKey = (position) => position.market + ':' + position.side + ':' + position.info.positionId;
export const positionTokenDecimals = (position, field) => field === 'collateral' ? position.info.rawCollsDecimals : position.info.rawDebtsDecimals;
export const positionIsStale = (position, failedGroups) => failedGroups.some((group) => group.market === position.market && group.side === position.side);`,
  '@/lib/useWalletActivity': `${shared}
const EMPTY = { views: [], protocol: { items: [], hasMore: false }, transfers: [], positionTransfers: [], calls: {}, drafts: [], partial: false };
export function useWalletActivity() {
  const pending = !settled();
  const unavailable = stage() === 'unavailable';
  return { data: { ...EMPTY, partial: unavailable }, isPending: pending, isFetching: pending, hasMore: false, loadMore: async () => {}, refetch: async () => [] };
}`,
  '@/lib/activityReceipt': `export const loadActivityReceipt = async () => null;`,
  '@/components/BridgeTracker': `export const BridgeTracker = () => null;`,
  '@/lib/fx/drafts': `export const cancelSignatureRequiredDraft = () => {}; export const signatureDraftResumePath = () => '/';`,
  '@/lib/liveMarket': `${shared}
export const liveQuotePending = (status) => status === 'paused' || status === 'connecting';
export const isLiveQuoteFresh = () => false;
export const LIVE_QUOTE_MAX_AGE_MS = 20000;
export const liveQuoteCandle = () => null;
export function fetchMarketHistoryWithCoinbaseFallback(market, range) {
  if (!settled()) return never();
  if (stage() === 'unavailable') return Promise.reject(new Error('market history failed'));
  return Promise.resolve(globalThis.__portfolioFixtures.history(market, range));
}
export function fetchMarketCandles() { return settled() && stage() !== 'unavailable' ? never() : stage() === 'unavailable' ? Promise.reject(new Error('candles failed')) : never(); }`,
};

// Relative imports of mocked modules ("./BridgeTracker") are intercepted too.
const relativeMocks = new Map(Object.keys(mocks).filter((id) => id.startsWith('@/')).map((id) => [resolveSource(id).replace(/\.(tsx|ts)$/, '').toLowerCase(), id]));

const fixtures = `
(() => {
  const now = Date.now();
  const WALLET = '${WALLET}';
  const unit = (amount, decimals = 18) => BigInt(Math.round(amount * 1e6)) * 10n ** BigInt(decimals - 6);
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const FXUSD = '0x085780639CC2cACd35E474e71f4d000e2405d8f6';
  // Ids follow the canonical merge ('chain:address' or 'chain:native'), so the
  // Ethereum balance read refreshes these rows instead of adding duplicates.
  const asset = (chainId, key, symbol, amount, price, decimals = 18, tokenAddress = null) => ({
    id: chainId + ':' + (tokenAddress ? tokenAddress.toLowerCase() : 'native'), chainId, network: chainId === 1 ? 'ethereum' : 'base', tokenAddress, canonicalKey: key, symbol, name: symbol,
    decimals, balanceWei: unit(amount, decimals), balance: String(amount), balanceUpdatedAt: now, priceUsd: price, priceUpdatedAt: now,
    priceStatus: 'fresh', usdValue: amount * price, logoUrl: null, source: 'canonical',
  });
  const holdings = [asset(1, 'USDC', 'USDC', 4500, 1, 6, USDC), asset(1, 'ETH', 'ETH', 1.25, 2400), asset(8453, 'ETH', 'ETH', 0.5, 2400), asset(1, 'fxUSD', 'fxUSD', 1200, 1, 18, FXUSD)];
  const dustHolding = asset(1, 'USDC', 'USDC', 0.01, 1, 6, USDC);
  const networks = { 1: { chainId: 1, status: 'ready', error: '' }, 8453: { chainId: 8453, status: 'ready', error: '' } };
  const E18 = 10n ** 18n;
  const position = (market, side, positionId, colls, debts, collsToken, debtsToken, leverage) => ({ market, side, info: {
    positionId, rawColls: BigInt(Math.round(colls * 1e6)) * 10n ** 12n, rawDebts: BigInt(Math.round(debts * 1e6)) * 10n ** 12n,
    currentLeverage: leverage, lsdLeverage: side === 'short' ? leverage - 1 : leverage, rawCollsToken: collsToken, rawDebtsToken: debtsToken, rawCollsDecimals: 18, rawDebtsDecimals: 18,
  } });
  globalThis.__portfolioFixtures = {
    now,
    positions: [position('ETH', 'long', 2033, 2.5, 3100, 'ETH', 'fxUSD', 2.07), position('BTC', 'short', 109, 15000, 0.11, 'fxUSD', 'WBTC', 3.24)],
    brakes: {
      'ETH:long:2033': { side: 'long', debtRatio: 507n * E18 / 1000n, rebalanceRatio: 880n * E18 / 1000n, liquidateRatio: 950n * E18 / 1000n, priceAtRead: 2400 },
      'BTC:short:109': { side: 'short', debtRatio: 700n * E18 / 1000n, rebalanceRatio: 900n * E18 / 1000n, liquidateRatio: 950n * E18 / 1000n, priceAtRead: 104000 },
    },
      assets: (stage) => {
      const assets = stage === 'empty' ? [] : stage === 'dust' ? [dustHolding] : holdings;
      return { walletAddress: WALLET, assets, networks, totalUsdValue: assets.reduce((sum, item) => sum + item.usdValue, 0), unpricedAssetCount: 0, updatedAt: now, source: 'canonical' };
    },
    balances: (stage) => ({ balances: stage === 'empty' ? [] : stage === 'dust' ? [{ key: 'USDC', address: USDC, decimals: 6, amountWei: unit(0.01, 6) }] : [{ key: 'USDC', address: USDC, decimals: 6, amountWei: unit(4500, 6) }, { key: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, amountWei: unit(1.25) }, { key: 'fxUSD', address: FXUSD, decimals: 18, amountWei: unit(1200) }], failedTokens: [] }),
    fxSave: (stage) => stage === 'empty' || stage === 'dust' ? { balanceWei: 0n, assetsWei: 0n } : { balanceWei: unit(571.4286), assetsWei: unit(600) },
    history: (market, range) => {
      const base = market === 'ETH' ? 2400 : 104000;
      const points = Array.from({ length: 48 }, (_, index) => ({ timestamp: now - (47 - index) * 1_800_000, price: base * (0.97 + 0.03 * Math.sin(index / 6) + index * 0.0009) }));
      const first = points[0].price; const last = points[points.length - 1].price;
      return { market, range, points, currentPrice: last, percentChange: ((last - first) / first) * 100, updatedAt: now, source: 'coingecko' };
    },
  };
})();
`;

function resolveSource(path: string): string {
  const candidate = resolve(src, path.slice(2));
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return `${candidate}${extension}`;
  for (const extension of ['.tsx', '.ts']) if (existsSync(resolve(candidate, `index${extension}`))) return resolve(candidate, `index${extension}`);
  return candidate;
}

export type PortfolioStatesLab = { script: string; css: string };

export async function buildPortfolioStatesLab(): Promise<PortfolioStatesLab> {
  const result = await esbuild.build({
    entryPoints: [resolve(__dirname, 'portfolio-states-entry.tsx')], outfile: resolve(appRoot, 'portfolio-states-lab.js'),
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.module.css': 'local-css', '.css': 'empty' }, absWorkingDir: root, logLevel: 'error',
    banner: { js: `var process = { env: { NODE_ENV: 'production' } };${fixtures}` },
    plugins: [{ name: 'portfolio-states', setup(build: BuildApi) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({ path: args.path, namespace: 'mock' }));
      build.onResolve({ filter: /^@\// }, (args) => mocks[args.path] ? { path: args.path, namespace: 'mock' } : { path: resolveSource(args.path) });
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        const mocked = args.resolveDir ? relativeMocks.get(resolve(args.resolveDir, args.path).replace(/\.(tsx|ts)$/, '').toLowerCase()) : undefined;
        return mocked ? { path: mocked, namespace: 'mock' } : undefined;
      });
      build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: appRoot }));
    } }],
  });
  const script = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
  const modules = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  if (!script) throw new Error('The Portfolio states bundle was not emitted.');
  return { script, css: `${await buildLabGlobalCss()}\n${modules}` };
}

/** The app's real global and shell CSS (with Tailwind) and its Inter face, for harness pages. */
export async function buildLabGlobalCss(): Promise<string> {
  const postcss = appRequire('postcss');
  const tailwindcss = appRequire('tailwindcss');
  const tailwindConfig = appRequire(resolve(appRoot, 'tailwind.config.js'));
  tailwindConfig.content = [resolve(src, '**/*.{js,ts,jsx,tsx,mdx}')];
  const [globalSource, productSource] = await Promise.all([
    readFile(resolve(src, 'app/globals.css'), 'utf8'),
    readFile(resolve(src, 'app/product-shell.css'), 'utf8'),
  ]);
  const globals = await postcss([tailwindcss(tailwindConfig)]).process(`${globalSource}\n${productSource}`, { from: resolve(appRoot, 'e2e/portfolio-states-global.css') });
  const font = await readFile(resolve(__dirname, 'assets/inter-latin.woff2'));
  const fontCss = `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-style:normal;font-weight:100 900;font-display:block}:root{--font-sans:Inter}`;
  return `${fontCss}\n${globals.css}`;
}
