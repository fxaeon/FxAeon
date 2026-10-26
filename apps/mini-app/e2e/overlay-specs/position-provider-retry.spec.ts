import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const src = resolve(root, 'apps/mini-app/src');
const entry = resolve(root, 'apps/mini-app/e2e/harness/position-provider-retry-entry.tsx');

const mocks: Record<string, string> = {
  '@/app/trade/fxUi': `
    export const createPositionReadGuard = () => { let active = true, generation = 0; return { begin: () => active ? ++generation : null, isCurrent: (id) => active && id === generation, activate: () => { active = true; }, invalidate: () => { active = false; generation++; } }; };
    export const mergeVerifiedPositions = (current, result) => {
      const successful = new Set(result.successfulGroups.map((group) => [group.market, group.side].join(':')));
      return [...current.filter((position) => !successful.has([position.market, position.side].join(':'))),
        ...result.positions.filter((position) => successful.has([position.market, position.side].join(':')))];
    };
    export const newlyVerifiedPositions = () => [];
    export const positionKey = (position) => [position.market, position.side, position.info.positionId].join(':');
    export async function readAllPositionsDetailed(address) {
      const state = globalThis.__positionRetryHarness;
      state.reads.push(address.toLowerCase());
      const count = state.reads.filter((item) => item === address.toLowerCase()).length;
      if (count <= (state.failAttempts[address.toLowerCase()] ?? 0)) throw new Error('transient position read failure');
      const positions = state.emptyWallets.includes(address.toLowerCase()) ? [] : [{ market: 'BTC', side: 'long', info: { positionId: 927, rawColls: 1n, rawDebts: 1n } }];
      if ((state.partialReads[address.toLowerCase()] ?? []).includes(count)) {
        return { positions: [], successfulGroups: [], failedGroups: [{ market: 'BTC', side: 'long', reason: new Error('transient group failure') }], status: 'unavailable' };
      }
      return { positions, successfulGroups: [{ market: 'BTC', side: 'long' }], failedGroups: [], status: 'ready' };
    }
    export const readCanonicalPositionState = async () => [0n, 0n];
    export const unavailablePositionResult = (reason) => ({ positions: [], successfulGroups: [], failedGroups: [{ market: 'BTC', side: 'long', reason }], status: 'unavailable' });
  `,
  '@/lib/wallet': `export const usePrivyWallet = () => globalThis.__positionRetryHarness.wallet;`,
  '@/lib/confirmedPositions': `export const deriveConfirmedPositionHint = () => null; export const readConfirmedPosition = async () => null; export const verifyConfirmedPositionHint = async () => false;`,
  '@/lib/confirmedPositionStorage': `export const confirmedPositionHintKey = () => ''; export const confirmedPositionStorageKey = () => ''; export const parseStoredPositionHints = () => []; export const savePositionHints = () => {};`,
  '@/lib/fx': `export const getEthereumClient = () => ({});`,
  '@/components/WalletDataProvider': `export const useRealtimeChainState = () => ({ status: 'live', latestBlockNumber: globalThis.__positionRetryHarness.block });`,
  '@/lib/foreground': `export const isForegroundOnline = () => globalThis.__positionRetryHarness.foreground; export const subscribeToForegroundResume = (callback) => { globalThis.__positionRetryHarness.resume = callback; return () => {}; };`,
};

async function buildHarness(): Promise<string> {
  type BuildApi = { onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void; onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void };
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: root,
    plugins: [{ name: 'position-provider-retry', setup(build: BuildApi) {
      build.onResolve({ filter: /^@\// }, (args: { path: string }) => {
        if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
        const candidate = resolve(src, args.path.slice(2));
        if (existsSync(candidate)) return { path: candidate };
        for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
        return { path: candidate };
      });
      build.onLoad({ filter: /.*/, namespace: 'mock' }, (args: { path: string }) => ({ contents: mocks[args.path], loader: 'js', resolveDir: root }));
    } }],
  });
  return result.outputFiles[0].text;
}

let bundle = '';
test.beforeAll(async () => { bundle = await buildHarness(); });

async function mount(page: import('@playwright/test').Page, failAttempts: Record<string, number> = {}, foreground = true,
  partialReads: Record<string, number[]> = {}, initialStatus = 'unavailable', emptyWallets: string[] = []) {
  await page.setContent('<div id="root"></div>');
  await page.evaluate(({ failures, foreground, partialReads, emptyWallets }) => {
    (window as typeof window & { __positionRetryConfig?: { failAttempts: Record<string, number>; partialReads: Record<string, number[]>; foreground: boolean; emptyWallets: string[] } }).__positionRetryConfig = {
      failAttempts: Object.fromEntries(Object.entries(failures).map(([address, count]) => [address.toLowerCase(), count])),
      partialReads: Object.fromEntries(Object.entries(partialReads).map(([address, calls]) => [address.toLowerCase(), calls])),
      emptyWallets,
      foreground,
    };
  }, { failures: failAttempts, foreground, partialReads, emptyWallets });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByTestId('status')).toHaveText(initialStatus);
}

const walletA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const walletB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('verified empty wallet avoids repeated block discovery while manual and new-wallet reads remain immediate', async ({ page }) => {
  await mount(page, {}, true, {}, 'ready', [walletA]);
  const block = async (number: number) => {
    await page.evaluate((next) => (window as typeof window & { __positionRetryHarness: { setActivity: (pauses: number, block: number) => void } }).__positionRetryHarness.setActivity(0, next), number);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
  await expect(page.getByTestId('reads')).toHaveText('1');
  await block(100);
  await block(101);
  await expect(page.getByTestId('reads')).toHaveText('1');
  await page.getByRole('button', { name: 'Manual refresh' }).click();
  await expect(page.getByTestId('reads')).toHaveText('2');
  await block(102);
  await expect(page.getByTestId('reads')).toHaveText('2');
  await page.evaluate((next) => (window as typeof window & { __positionRetryHarness: { setWallet: (address: string) => void } }).__positionRetryHarness.setWallet(next), walletB);
  await expect(page.getByTestId('reads')).toHaveText('3');
});

test('review pauses coalesce block refreshes while manual refresh and wallet changes remain available', async ({ page }) => {
  await mount(page, {}, true, {}, 'ready');
  const activity = async (pauses: number, block: number) => {
    await page.evaluate(({ pauses, block }) => {
      (window as typeof window & { __positionRetryHarness: { setActivity: (pauses: number, block: number) => void } }).__positionRetryHarness.setActivity(pauses, block);
    }, { pauses, block });
    // Flush effects, including the pause lease update, before the next block.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
  await activity(2, 100);
  const baseline = await page.getByTestId('reads').textContent();
  expect(baseline).toBe('1');
  await activity(2, 101);
  await activity(2, 102);
  await expect(page.getByTestId('reads')).toHaveText(baseline!);
  await expect(page.getByTestId('position')).toHaveText('BTC:long:927');
  await page.getByRole('button', { name: 'Manual refresh' }).click();
  await expect(page.getByTestId('reads')).toHaveText(String(Number(baseline) + 1));
  await activity(1, 103);
  await expect(page.getByTestId('reads')).toHaveText(String(Number(baseline) + 1));
  await page.evaluate((address) => (window as typeof window & { __positionRetryHarness: { setWallet: (address: string) => void } }).__positionRetryHarness.setWallet(address), walletB);
  await expect(page.getByTestId('reads')).toHaveText(String(Number(baseline) + 2));
  await activity(0, 104);
  await expect(page.getByTestId('reads')).toHaveText(String(Number(baseline) + 3));
  await activity(0, 104);
  await expect(page.getByTestId('reads')).toHaveText(String(Number(baseline) + 3));
});

test('a failed initial position read recovers automatically', async ({ page }) => {
  await mount(page, { [walletA]: 1 });
  await expect(page.getByTestId('position')).toHaveText('BTC:long:927', { timeout: 10_000 });
  await expect(page.getByTestId('reads')).toHaveText('2');
});

test('a failure while backgrounded retries when the wallet session resumes', async ({ page }) => {
  await mount(page, { [walletA]: 1 }, false);
  await expect(page.getByTestId('reads')).toHaveText('1');
  await page.evaluate(() => {
    const harness = (window as typeof window & { __positionRetryHarness: { foreground: boolean; resume?: () => void } }).__positionRetryHarness;
    harness.foreground = true;
    harness.resume?.();
  });
  await expect(page.getByTestId('position')).toHaveText('BTC:long:927');
  await expect(page.getByTestId('reads')).toHaveText('2');
});

test('partial failed groups retain verified rows and recover automatically', async ({ page }) => {
  await mount(page, {}, true, { [walletA]: [2] }, 'ready');
  await expect(page.getByTestId('position')).toHaveText('BTC:long:927');
  await page.getByRole('button', { name: 'Manual refresh' }).click();
  await expect(page.getByTestId('status')).toHaveText('unavailable');
  await expect(page.getByTestId('position')).toHaveText('BTC:long:927');
  await expect(page.getByTestId('position')).toHaveText('BTC:long:927', { timeout: 10_000 });
  await expect(page.getByTestId('status')).toHaveText('ready');
  await expect(page.getByTestId('reads')).toHaveText('3');
});

test('wallet switch cancels a pending retry for the previous session', async ({ page }) => {
  await mount(page, { [walletA]: 1, [walletB]: 0 });
  await page.evaluate((address) => (window as typeof window & { __positionRetryHarness: { setWallet: (next: string) => void } }).__positionRetryHarness.setWallet(address), walletB);
  await expect(page.getByTestId('position')).toHaveText('BTC:long:927');
  await page.waitForTimeout(2_500);
  const reads = await page.evaluate(() => (window as typeof window & { __positionRetryHarness: { reads: string[] } }).__positionRetryHarness.reads);
  expect(reads).toEqual([walletA, walletB]);
});

test('unmount cancels a pending retry', async ({ page }) => {
  await mount(page, { [walletA]: 99 });
  await page.evaluate(() => (window as typeof window & { __positionRetryHarness: { unmount: () => void } }).__positionRetryHarness.unmount());
  await page.waitForTimeout(2_500);
  const reads = await page.evaluate(() => (window as typeof window & { __positionRetryHarness: { reads: string[] } }).__positionRetryHarness.reads);
  expect(reads).toEqual([walletA]);
});

test('position retry budget stops after two retries', async ({ page }) => {
  await mount(page, { [walletA]: 99 });
  await page.waitForTimeout(7_500);
  let reads = await page.evaluate(() => (window as typeof window & { __positionRetryHarness: { reads: string[] } }).__positionRetryHarness.reads);
  expect(reads).toHaveLength(3);
  await page.waitForTimeout(1_000);
  reads = await page.evaluate(() => (window as typeof window & { __positionRetryHarness: { reads: string[] } }).__positionRetryHarness.reads);
  expect(reads).toHaveLength(3);
  await page.getByRole('button', { name: 'Manual refresh' }).click();
  await expect(page.getByTestId('reads')).toHaveText('4');
  await page.waitForTimeout(2_500);
  reads = await page.evaluate(() => (window as typeof window & { __positionRetryHarness: { reads: string[] } }).__positionRetryHarness.reads);
  expect(reads).toHaveLength(5);
});
