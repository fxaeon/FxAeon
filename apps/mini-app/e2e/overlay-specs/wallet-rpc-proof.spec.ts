import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { decodeFunctionData, encodeFunctionResult, erc20Abi, multicall3Abi, type Hex } from 'viem';

const root = resolve(__dirname, '../..');
const repo = resolve(root, '../..');
const esbuild = createRequire(createRequire(resolve(root, 'package.json')).resolve('tsx/package.json'))('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }>;
};
const baselineRef = process.env.RPC_CHAIN_PROOF_BASELINE_REF;
const baseline = Boolean(baselineRef);
const demandBaselineRef = process.env.RPC_DEMAND_BASELINE_REF;
const mocks: Record<string, string> = {
  '@/lib/wallet': `export const usePrivyWallet = () => window.__rpcHarness.wallet;`,
  '@/components/PriceProvider': `const value={prices:{},status:'unavailable',updatedAt:null}; export const useUsdPrices = () => value;`,
};
let script = '';
test.beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: [resolve(root, 'e2e/harness/wallet-rpc-proof-entry.tsx')], bundle: true, write: false,
    format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', absWorkingDir: root,
    banner: { js: 'globalThis.process = { env: {} };' },
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL': '"https://eth-mainnet.g.alchemy.com/v2/offline-fixture"',
      'process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL': '"https://base-mainnet.g.alchemy.com/v2/offline-fixture"',
      'process.env': '{}',
    },
    plugins: [{ name: 'wallet-rpc-fixtures', setup(build: {
      onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => unknown) => void;
      onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string }) => unknown) => void;
    }) {
      build.onResolve({ filter: /^@\// }, ({ path }) => {
        if (mocks[path]) return { path, namespace: 'fixture' };
        const base = resolve(root, 'src', path.slice(2));
        return { path: [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base].find(existsSync) ?? base };
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: mocks[path], loader: 'tsx', resolveDir: root }));
      if (baseline) build.onLoad({ filter: /clients\.ts$/ }, ({ path }) => path === resolve(root, 'src/lib/fx/clients.ts')
        ? { contents: execFileSync('git', ['show', `${baselineRef}:apps/mini-app/src/lib/fx/clients.ts`], { cwd: repo, encoding: 'utf8' }), loader: 'ts', resolveDir: resolve(root, 'src/lib/fx') }
        : undefined);
      if (demandBaselineRef) build.onLoad({ filter: /WalletDataProvider\.tsx$/ }, ({ path }) => path === resolve(root, 'src/components/WalletDataProvider.tsx')
        ? { contents: execFileSync('git', ['show', `${demandBaselineRef}:apps/mini-app/src/components/WalletDataProvider.tsx`], { cwd: repo, encoding: 'utf8' }), loader: 'tsx', resolveDir: resolve(root, 'src/components') }
        : undefined);
    } }],
  });
  script = result.outputFiles[0].text;
});

type Call = { chainId: number; method: string; params?: unknown[] };
async function mount(page: Page, delayMs = 0, realtime = false) {
  const calls: Call[] = [];
  const escaped: string[] = [];
  page.on('websocket', socket => escaped.push(socket.url()));
  let native = 4_660n;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'rpc.test') return route.fulfill({ body: '<!doctype html><div id="root"></div>', contentType: 'text/html' });
    if (!['eth-mainnet.g.alchemy.com', 'base-mainnet.g.alchemy.com'].includes(url.hostname)) {
      escaped.push(url.href); return route.abort();
    }
    const payload = route.request().postDataJSON() as { id: number; method: string; params?: [{ data?: Hex }] };
    const chainId = url.hostname.startsWith('eth-') ? 1 : 8453;
    calls.push({ chainId, method: payload.method, params: payload.params });
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    let result: unknown;
    if (payload.method === 'eth_chainId') result = `0x${chainId.toString(16)}`;
    else if (payload.method === 'eth_blockNumber') result = '0x12345';
    else if (payload.method === 'eth_getBalance') result = `0x${native.toString(16)}`;
    else if (payload.method === 'eth_call') {
      const decoded = decodeFunctionData({ abi: multicall3Abi, data: payload.params![0].data! });
      expect(decoded.functionName).toBe('aggregate3');
      result = encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: (decoded.args[0] as readonly unknown[]).map(() => ({ success: true, returnData: encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: 123456789012345678901n }) })) });
    } else throw new Error(`Unexpected RPC method: ${payload.method}`);
    return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { jsonrpc: '2.0', id: payload.id, result } });
  });
  await page.goto(`http://rpc.test/${realtime ? '?realtime=1' : ''}`);
  await page.addScriptTag({ content: script });
  await expect(page.getByTestId('form-status')).toHaveText(realtime ? 'ready/idle' : 'ready/ready');
  await expect(page.getByTestId('profile-status')).toHaveText(realtime ? 'ready/idle' : 'ready/ready');
  expect(escaped).toEqual([]);
  return { calls, escaped, setNative: (value: bigint) => { native = value; } };
}

// Real WalletDataProvider, wallet queries, Wagmi/Query observers and RPC transport.
// Only wallet identity, display prices and network responses are fixtures.
test('cold form and portfolio observers share one exact read and display it sooner', async ({ page }, testInfo) => {
  const timings: number[] = [];
  for (let sample = 0; sample < 7; sample++) {
    const { calls } = await mount(page, 40);
    await expect(page.getByTestId('form-balance')).toHaveText('4660');
    await expect(page.getByTestId('profile-balance')).toHaveText('4660');
    for (const chain of [1, 8453]) {
      expect(calls.filter(call => call.chainId === chain && call.method === 'eth_chainId')).toHaveLength(baseline ? 2 : 1);
      expect(calls.filter(call => call.chainId === chain && call.method === 'eth_getBalance')).toHaveLength(1);
      expect(calls.filter(call => call.chainId === chain && call.method === 'eth_call')).toHaveLength(1);
    }
    timings.push(await page.evaluate(() => {
      const state = (window as Window & { __rpcHarness: { readyAt: number; startedAt: number } }).__rpcHarness;
      return state.readyAt - state.startedAt;
    }));
    await page.unrouteAll({ behavior: 'wait' });
  }
  await testInfo.attach('rpc-proof-latency', { body: JSON.stringify({ baseline, fixtureRoundTripMs: 40, samples: timings, medianMs: [...timings].sort((a, b) => a - b)[3] }, null, 2), contentType: 'application/json' });
});

test('manual refresh, account changes and disconnect keep freshness and session isolation', async ({ page }) => {
  const { calls, setNative, escaped } = await mount(page);
  await page.getByLabel('Amount').fill('12.5');
  setNative(777n);
  const initial = calls.filter(call => call.method === 'eth_getBalance').length;
  await page.getByRole('button', { name: 'Refresh form', exact: true }).click();
  await expect(page.getByTestId('form-balance')).toHaveText('777');
  await expect(page.getByTestId('profile-balance')).toHaveText('777');
  expect(calls.filter(call => call.method === 'eth_getBalance')).toHaveLength(initial + 1);
  await expect(page.getByLabel('Amount')).toHaveValue('12.5');

  setNative(888n);
  await page.getByRole('button', { name: 'Switch account' }).click();
  await expect(page.getByTestId('form-balance')).toHaveText('888');
  expect(calls.filter(call => call.method === 'eth_getBalance').slice(-2).every(call => String(call.params?.[0]).endsWith('5678'))).toBe(true);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByTestId('form-status')).toHaveText('idle/idle');
  await expect(page.getByTestId('form-balance')).toHaveText('-');
  const disconnected = calls.length;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(100);
  expect(calls).toHaveLength(disconnected);
  setNative(999n);
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByTestId('form-balance')).toHaveText('999');
  expect(escaped).toEqual([]);
});

test('hidden and off-route observers stop periodic work and resume with fresh balances', async ({ page }) => {
  await page.clock.install();
  const { calls, setNative } = await mount(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(50);
  const hidden = calls.length;
  await page.clock.runFor(61_000);
  expect(calls).toHaveLength(hidden);
  setNative(777n);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('form-balance')).toHaveText('777');
  await page.getByRole('button', { name: 'Leave wallet route' }).click();
  await expect(page.getByTestId('form-status')).toHaveCount(0);
  await page.clock.runFor(100);
  const offRoute = calls.length;
  await page.clock.runFor(61_000);
  expect(calls).toHaveLength(offRoute);
  setNative(888n);
  await page.getByRole('button', { name: 'Return to wallet route' }).click();
  await expect(page.getByTestId('form-balance')).toHaveText('888');
});

test('Ethereum-only demand skips Base subscriptions and restores them for the portfolio profile', async ({ page }, testInfo) => {
  await page.clock.install();
  await page.addInitScript(() => {
    type Subscription = { id: number; method: string; params: unknown[] };
    class FixtureSocket {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      closed = false;
      sent: Subscription[] = [];
      notifications = 0;
      constructor(public url: string) {
        sockets.push(this);
        queueMicrotask(() => this.onopen?.());
      }
      send(data: string) {
        const request = JSON.parse(data) as Subscription;
        this.sent.push(request);
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, result: `fixture-${request.id}` }) }));
      }
      close() { this.closed = true; }
      head(block: number) {
        if (this.closed || !this.sent.some(request => request.params[0] === 'newHeads')) return;
        this.notifications += 1;
        this.onmessage?.({ data: JSON.stringify({ method: 'eth_subscription', params: { subscription: 'fixture-1', result: { number: `0x${block.toString(16)}` } } }) });
      }
    }
    const sockets: FixtureSocket[] = [];
    Object.assign(window, { WebSocket: FixtureSocket, __rpcSockets: sockets });
  });
  const { calls, escaped, setNative } = await mount(page, 0, true);
  const snapshot = () => page.evaluate(() => {
    const sockets = (window as unknown as { __rpcSockets: { url: string; closed: boolean; sent: unknown[]; notifications: number }[] }).__rpcSockets;
    return [1, 8453].map(chainId => {
      const matching = sockets.filter(socket => socket.url.includes(chainId === 1 ? 'eth-mainnet' : 'base-mainnet'));
      return { chainId, active: matching.filter(socket => !socket.closed).length,
        subscriptions: matching.filter(socket => !socket.closed).reduce((sum, socket) => sum + socket.sent.length, 0),
        notifications: matching.reduce((sum, socket) => sum + socket.notifications, 0) };
    });
  });
  await expect.poll(async () => (await snapshot()).map(chain => chain.subscriptions)).toEqual(demandBaselineRef ? [3, 3] : [3, 0]);
  const initial = await snapshot();
  setNative(777n);
  // Deliver one minute of Ethereum (12s) and Base (2s) heads. Only sockets the
  // real provider opened receive notifications; there is no external network.
  for (let tick = 1; tick <= 30; tick += 1) {
    await page.clock.runFor(2_000);
    await page.evaluate(tick => {
      const sockets = (window as unknown as { __rpcSockets: { url: string; head: (block: number) => void }[] }).__rpcSockets;
      for (const socket of sockets) {
        if (socket.url.includes('base-mainnet') || tick % 6 === 0) socket.head(tick);
      }
    }, tick);
    if (tick === 12) await expect(page.getByTestId('form-balance')).toHaveText('777');
  }
  const measured = await snapshot();
  expect(measured.map(chain => chain.notifications)).toEqual(demandBaselineRef ? [5, 30] : [5, 0]);
  expect(calls.filter(call => call.chainId === 8453)).toHaveLength(0);
  await expect(page.getByTestId('form-balance')).toHaveText('777');
  await testInfo.attach('demand-scoped-websocket-proof', { body: JSON.stringify({ baseline: Boolean(demandBaselineRef), simulatedSeconds: 60, initial, measured }, null, 2), contentType: 'application/json' });

  await page.getByRole('button', { name: 'Open portfolio profile' }).click();
  await expect(page.getByTestId('form-status')).toHaveText('ready/ready');
  await expect(page.getByTestId('form-base-balance')).toHaveText('777');
  await expect.poll(async () => (await snapshot()).map(chain => chain.subscriptions)).toEqual([3, 3]);
  expect(calls.filter(call => call.chainId === 8453 && call.method === 'eth_getBalance')).toHaveLength(1);
  await page.getByRole('button', { name: 'Close portfolio profile' }).click();
  await expect.poll(async () => (await snapshot()).map(chain => chain.active)).toEqual(demandBaselineRef ? [1, 1] : [1, 0]);
  setNative(888n);
  await page.clock.runFor(16_000);
  await page.getByRole('button', { name: 'Open portfolio profile' }).click();
  await expect(page.getByTestId('form-base-balance')).toHaveText('888');
  await expect.poll(async () => (await snapshot()).map(chain => chain.subscriptions)).toEqual([3, 3]);
  await page.getByRole('button', { name: 'Close portfolio profile' }).click();

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await snapshot()).map(chain => chain.active)).toEqual([0, 0]);
  // Settle any foreground work, then prove there is no hidden-tab polling.
  await page.clock.runFor(100);
  const hidden = calls.length;
  await page.clock.runFor(61_000);
  expect(calls).toHaveLength(hidden);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await snapshot()).map(chain => chain.subscriptions)).toEqual(demandBaselineRef ? [3, 3] : [3, 0]);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect.poll(async () => (await snapshot()).map(chain => chain.active)).toEqual([0, 0]);
  expect(escaped).toEqual([]);
});
