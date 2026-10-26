import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { positionPoolAddress } from '../src/lib/fx/policy';

const require = createRequire(import.meta.url);
const previousCss = require.extensions['.css'];
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
require.extensions['.css'] = (module, path) => { module.exports = Object.fromEntries([...readFileSync(path, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => [match[1], match[1]])); };
after(() => { if (previousCss) require.extensions['.css'] = previousCss; else delete require.extensions['.css']; if (previousReact) globalReact.React = previousReact; else Reflect.deleteProperty(globalThis, 'React'); });

test('Borrow history labels live and historical annualized figures as costs and exposes a keyboard-readable eight-hour chart', async () => {
  const { BorrowFundingHistory } = await import('../src/components/BorrowFundingHistory');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const now = Math.floor(Date.now() / 1000);
  const ratio = 45318576060452136n;
  client.setQueryData(['borrow-funding-history', 'ETH'], { market: 'ETH', startAt: now - 30 * 86_400, endAt: now, indexedAt: now,
    averageRatio: ratio / 2n, snapshots: [{ timestamp: now - 30 * 86_400, ratio: 0n }, { timestamp: now - 15 * 86_400, ratio }] });
  const rate = { market: 'ETH' as const, pool: positionPoolAddress('ETH', 'long'), ratio, netRatio: ratio, readAt: Date.now() };
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(BorrowFundingHistory, { market: 'ETH', rate, status: 'ready' })));
  assert.match(html, /Funding &amp; costs/);
  assert.match(html, /class="primaryReading"[^]*?Current charge[^]*?0\.0041% \/ 8h/);
  assert.match(html, /class="secondaryReading"[^]*?Current cost APR/);
  assert.match(html, /Average cost APR/);
  assert.match(html, /4\.5318%/);
  assert.match(html, /0\.0041%/);
  assert.match(html, /role="slider"/);
  assert.match(html, /aria-valuetext="[^"]*per eight hours"/);
  assert.match(html, /https:\/\/fx\.aladdin\.club\/v2\/fxmint/);
  assert.doesNotMatch(html, /APY|Earned|Yield history/);
  client.clear();
});

test('aged cached history shows unavailable with retry rather than an endless loading state', async () => {
  const { BorrowFundingHistory } = await import('../src/components/BorrowFundingHistory');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const now = Math.floor(Date.now() / 1000);
  client.setQueryData(['borrow-funding-history', 'ETH'], { market: 'ETH', startAt: now - 30 * 86_400, endAt: now - 86_401, indexedAt: now - 86_401,
    averageRatio: 0n, snapshots: [{ timestamp: now - 30 * 86_400, ratio: 0n }] });
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(BorrowFundingHistory, { market: 'ETH', rate: null, status: 'unavailable' })));
  assert.match(html, /Funding history unavailable/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /Loading funding history|role="slider"/);
  client.clear();
});

test('no-cache offline history is explicit, then foreground connectivity enables bounded refreshes', async () => {
  const { transformSync } = createRequire(require.resolve('tsx/package.json'))('esbuild') as { transformSync: (source: string, options: Record<string, string>) => { code: string } };
  const funding = await import('../src/lib/fx/borrowFunding');
  const hooks: unknown[] = [];
  let index = 0;
  let effects: Array<() => void> = [];
  let queryOptions: Record<string, unknown> = {};
  const listeners = new Map<string, () => void>();
  const events = { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) };
  const document = { ...events, visibilityState: 'visible' };
  const navigator = { onLine: false };
  const queryClient = { cancelQueries: async () => undefined };
  const module = { exports: {} as { BorrowFundingHistory: (props: unknown) => React.ReactNode } };
  const source = readFileSync(new URL('../src/components/BorrowFundingHistory.tsx', import.meta.url), 'utf8');
  runInNewContext(transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code, {
    module, exports: module.exports, document, window: events, navigator, Date,
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react') return {
        useId: () => 'history-test',
        useState: (initial: unknown) => { const slot = index++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], (next: unknown) => { hooks[slot] = next; }]; },
        useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
          const slot = index++; const previous = hooks[slot] as { deps: unknown[]; cleanup?: () => void } | undefined;
          if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => { previous?.cleanup?.(); hooks[slot] = { deps, cleanup: effect() }; });
        },
      };
      if (name === '@tanstack/react-query') return { useQueryClient: () => queryClient, useQuery: (options: Record<string, unknown>) => { queryOptions = options; return { data: undefined, isError: false, isFetching: false, refetch: async () => undefined }; } };
      if (name === 'lucide-react') return { ExternalLink: () => null };
      if (name === './InfoHelp') return { MetricLabel: ({ label }: { label: string }) => React.createElement('span', null, label) };
      if (name === './useChartWidth') return { useChartWidth: () => ({ ref: null, width: 480 }) };
      if (name.endsWith('.css')) return { __esModule: true, default: {} };
      return funding;
    },
  });
  const render = () => {
    index = 0; effects = [];
    const tree = module.exports.BorrowFundingHistory({ market: 'ETH', rate: null, status: 'unavailable' });
    effects.forEach(effect => effect());
    return renderToStaticMarkup(tree);
  };
  render();
  const offline = render();
  assert.match(offline, /Offline · funding history unavailable/);
  assert.doesNotMatch(offline, /Loading funding history/);
  assert.equal(queryOptions.enabled, false);
  assert.equal(queryOptions.refetchInterval, false);
  navigator.onLine = true; listeners.get('online')!(); render();
  assert.equal(queryOptions.enabled, true);
  assert.equal(queryOptions.refetchInterval, 300_000);
  document.visibilityState = 'hidden'; listeners.get('visibilitychange')!(); render();
  assert.equal(queryOptions.enabled, false);
  assert.equal(queryOptions.refetchInterval, false);
  hooks.forEach(hook => (hook as { cleanup?: () => void } | null)?.cleanup?.());
});
