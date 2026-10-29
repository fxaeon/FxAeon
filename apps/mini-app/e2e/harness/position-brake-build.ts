import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLabGlobalCss } from './portfolio-states-build';

/**
 * Bundles the real position card, its brake context and the real brake
 * provider and reader against inline mocks: positions come from
 * `globalThis.__brakeHarness`, and its fake Ethereum client answers the pool
 * and oracle multicalls from per-test fixtures while logging every request.
 * The real cost-basis provider reads its index records and mid prices from
 * the same harness.
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

const mocks: Record<string, string> = {
  'next/link': `import React from 'react'; export default React.forwardRef(function Link({ href, children, prefetch, scroll, replace, ...props }, ref) { return <a ref={ref} href={typeof href === 'string' ? href : '#'} {...props} onClick={(event) => { event.preventDefault(); props.onClick?.(event); }}>{children}</a>; });`,
  '@/components/ProtocolPositionProvider': `import { useSyncExternalStore } from 'react';
const harness = () => globalThis.__brakeHarness;
export function useProtocolPositions() { return useSyncExternalStore(harness().subscribe, harness().snapshot, harness().snapshot); }`,
  // CommonJS behind a Proxy: the client is the only live export; every other
  // name the card's helpers import resolves to an inert stub.
  '@/lib/fx': `const known = { getEthereumClient: () => globalThis.__brakeHarness.client };
module.exports = new Proxy(known, { get: (target, key) => key in target ? target[key] : key === '__esModule' ? false : () => undefined });`,
  '@/lib/fx/policy': `const POOLS = {
  'ETH:long': '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8', 'BTC:long': '0xAB709e26Fa6B0A30c119D8c55B887DeD24952473',
  'ETH:short': '0x25707b9e6690B52C60aE6744d711cf9C1dFC1876', 'BTC:short': '0xA0cC8162c523998856D59065fAa254F87D20A5b0',
};
export const positionPoolAddress = (market, side) => POOLS[market + ':' + side];`,
  // The cost-basis provider's two reads: the index's order record and the SDK mid price.
  '@/lib/protocolPositionHistory': `export const loadIndexedPositionHistory = (params) => globalThis.__brakeHarness.loadHistory(params);`,
  '@/app/trade/canonicalPositionReader': `export const readCanonicalPositionContext = (params) => globalThis.__brakeHarness.readPriceContext(params);`,
  '@/lib/fx/readFacade': `export const FX_READ_DEADLINE_MS = 12000;
export function withReadDeadline(task, timeoutMs = FX_READ_DEADLINE_MS) {
  let timer;
  return new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('read deadline exceeded')), timeoutMs); task.then(resolve, reject); }).finally(() => clearTimeout(timer));
}`,
  '@/app/trade/fxUi': `import { formatUnits } from 'viem';
export function formatAmount(value, decimals = 18, digits = 5) { if (value === undefined) return '—'; const [integer, fraction = ''] = formatUnits(value, decimals).split('.'); const trimmed = fraction.slice(0, digits).replace(/0+$/, ''); return trimmed ? integer + '.' + trimmed : integer; }
export const positionDisplayLeverage = (position) => ({ value: position.side === 'short' ? position.info.lsdLeverage : position.info.currentLeverage, label: 'leverage' });
export const positionKey = (position) => position.market + ':' + position.side + ':' + position.info.positionId;
export const positionTokenDecimals = (position, field) => field === 'collateral' ? position.info.rawCollsDecimals : position.info.rawDebtsDecimals;
export const positionIsStale = (position, failedGroups) => failedGroups.some((group) => group.market === position.market && group.side === position.side);`,
  '@/components/PriceProvider': `import { useSyncExternalStore } from 'react';
import { liveMarketStore } from '@/lib/liveMarketStore';
import { isLiveQuoteFresh } from '@/lib/liveMarket';
const now = Date.now();
const EMPTY = { quote: null, status: 'paused', now: 0 };
export function useUsdPrices() {
  const prices = globalThis.__brakeHarness.prices;
  return { prices, status: 'ready', updatedAt: now, updatedAts: Object.fromEntries(Object.keys(prices).map((key) => [key, now])), refreshing: false, refresh: async () => {} };
}
export const useUsdPrice = (key) => useUsdPrices().prices[key];
export function useLiveMarketQuote(market) {
  const live = useSyncExternalStore(liveMarketStore.subscribe, () => liveMarketStore.getSnapshot(market), () => EMPTY);
  return { quote: live.quote, status: live.status, isFresh: live.status === 'live' && isLiveQuoteFresh(live.quote, live.now) };
}`,
};

function resolveSource(path: string): string {
  const candidate = resolve(src, path.slice(2));
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return `${candidate}${extension}`;
  for (const extension of ['.tsx', '.ts']) if (existsSync(resolve(candidate, `index${extension}`))) return resolve(candidate, `index${extension}`);
  return candidate;
}

// Relative imports of mocked modules ("./ProtocolPositionProvider") are intercepted too.
const relativeMocks = new Map(Object.keys(mocks).filter((id) => id.startsWith('@/')).map((id) => [resolveSource(id).replace(/\.(tsx|ts)$/, '').toLowerCase(), id]));

export type PositionBrakeLab = { script: string; css: string };

export async function buildPositionBrakeLab(): Promise<PositionBrakeLab> {
  const result = await esbuild.build({
    entryPoints: [resolve(__dirname, 'position-brake-entry.tsx')], outfile: resolve(appRoot, 'position-brake-lab.js'),
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.module.css': 'local-css', '.css': 'empty' }, absWorkingDir: root, logLevel: 'error',
    banner: { js: "var process = { env: { NODE_ENV: 'production' } };" },
    plugins: [{ name: 'position-brake', setup(build: BuildApi) {
      build.onResolve({ filter: /^next\/link$/ }, (args) => ({ path: args.path, namespace: 'mock' }));
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
  if (!script) throw new Error('The position brake bundle was not emitted.');
  return { script, css: `${await buildLabGlobalCss()}\n${modules}` };
}
