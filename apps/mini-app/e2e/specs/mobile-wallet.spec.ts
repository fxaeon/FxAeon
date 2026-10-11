import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { MobileWalletHarnessState } from '../harness/mobile-wallet-entry';

const root = resolve(__dirname, '../../../..');
const miniApp = resolve(root, 'apps/mini-app');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [miniApp] });
const esbuild = createRequire(tsxPackage)('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }>;
};
const src = resolve(miniApp, 'src');
const entry = resolve(miniApp, 'e2e/harness/mobile-wallet-entry.tsx');
const accountA = '0x00000000000000000000000000000000000000aa';
const accountB = '0x00000000000000000000000000000000000000bb';

// Exercise the real provider, discovery, chooser, wallet-browser links and
// overlay lifecycle. No remote wallet SDK or relay participates.
const mocks: Record<string, string> = {
  'next/navigation': `export const useRouter = () => ({ push: (href) => { location.href = href; } });`,
  '@/lib/fx/config': `
    export const configuredRpcUrls = (chainId) => ['https://rpc.test/' + chainId];
    export const assertLocalForkRpcUrl = (url) => url;
    export const assertAlchemyRpcUrl = (url) => url;
    export const assertInfuraRpcUrl = (url) => url;
    export const assertSupportedChainId = (chainId) => { if (chainId !== 1 && chainId !== 8453) throw new Error('Unsupported chain'); };
  `,
  '@/lib/telegram': `export const isTelegramLaunchContext = () => false;`,
};
type Build = {
  onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => unknown) => void;
  onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => unknown) => void;
};
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic', absWorkingDir: root,
    define: { 'process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE': '"0"' },
    plugins: [{ name: 'mobile-wallet-services', setup(build: Build) {
      build.onResolve({ filter: /.*/ }, ({ path }) => {
        if (path === '../fx/config') return { path: '@/lib/fx/config', namespace: 'mock' };
        if (mocks[path]) return { path, namespace: 'mock' };
        if (!path.startsWith('@/')) return undefined;
        const candidate = resolve(src, path.slice(2));
        for (const extension of ['.tsx', '.ts']) if (existsSync(candidate + extension)) return { path: candidate + extension };
        for (const index of ['index.tsx', 'index.ts']) if (existsSync(resolve(candidate, index))) return { path: resolve(candidate, index) };
        return { path: candidate };
      });
      build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path], loader: 'tsx', resolveDir: miniApp }));
    } }],
  });
  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/harness.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(result.outputFiles[0].text); }
    else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Harness server has no port');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); });

async function openHarness(page: Page, wallets: 'none' | 'single' | 'multiple' | 'legacy' = 'none', path = '/', extra = '') {
  const requests: string[] = []; const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}${path}?wallets=${wallets}${extra}`);
  await expect(page.locator('[data-harness-ready="true"]')).toBeVisible();
  return { requests, errors };
}
async function connect(page: Page, choice?: number) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  if (choice !== undefined) await page.getByRole('button', { name: `Test wallet ${choice + 1}` }).click();
  await expect(page.locator('main')).toHaveAttribute('data-connected', 'true');
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const h: MobileWalletHarnessState = globalThis.__mobileWalletHarness;
    return { calls: h.wallets.map((wallet) => wallet.calls), cancellations: h.cancellations, errors: h.errors };
  });
}

for (const mode of ['single', 'legacy'] as const) {
  test(`one ${mode} wallet retains one-click connection without an extra chooser`, async ({ page }) => {
    const observation = await openHarness(page, mode);
    expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
    await connect(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
    expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
    expect(observation.requests.every((url) => new URL(url).origin === origin)).toBe(true);
    expect(observation.errors).toEqual([]);
  });
}

test('multiple extensions require an explicit choice and send only through the chosen provider', async ({ page }) => {
  const observation = await openHarness(page, 'multiple');
  await connect(page, 1);
  await expect(page.locator('main')).toHaveAttribute('data-address', accountB);
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'b'.repeat(64)}`);
  const current = await snapshot(page);
  expect(current.calls[0].some((call) => call.method === 'eth_requestAccounts' || call.method === 'eth_sendTransaction')).toBe(false);
  expect(current.calls[1].filter((call) => call.method === 'eth_sendTransaction')).toHaveLength(1);
  expect(observation.errors).toEqual([]);
});

test('a wallet injected during discovery connects without opening the wallet-browser handoff', async ({ page }) => {
  const observation = await openHarness(page);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.evaluate(() => { globalThis.__mobileWalletHarness.inject(0); globalThis.__mobileWalletHarness.announce(0); });
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(observation.errors).toEqual([]);
});

test('an explicit second-wallet choice survives a rerender while account approval is pending', async ({ page }) => {
  const observation = await openHarness(page, 'multiple');
  await page.evaluate(() => { globalThis.__mobileWalletHarness.wallets[1].holdPrompt = true; });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Test wallet 2' }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].promptsWaiting)).toBe(1);
  await page.evaluate(() => globalThis.__mobileWalletHarness.rerender?.());
  await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].settlePrompt());
  await expect(page.locator('main')).toHaveAttribute('data-address', accountB);
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'b'.repeat(64)}`);
  expect(observation.errors).toEqual([]);
});

for (const path of ['/', '/earn', '/unsupported']) {
  test(`wallet-browser links retain only supported routes and never forward query/hash data (${path})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const observation = await openHarness(page, 'none', path, '&tgWebAppData=private-query#private-hash');
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect your wallet' });
    await expect(dialog).toBeVisible();
    const target = path === '/earn' ? '/earn' : '/';
    await expect(dialog.getByRole('link', { name: 'Open in MetaMask', exact: true })).toHaveAttribute('href', `https://link.metamask.io/dapp/fxaeon.com${target}`);
    await expect(dialog.getByRole('link', { name: 'Open in Trust Wallet', exact: true })).toHaveAttribute('href', `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(`https://fxaeon.com${target}`)}`);
    await expect(dialog.getByText('Connect again in the wallet’s browser.', { exact: false })).toBeVisible();
    await expect(dialog.getByRole('button')).toHaveCount(1);
    expect(page.url()).toContain('tgWebAppData=private-query');
    expect(observation.requests.every((url) => new URL(url).origin === origin)).toBe(true);
    expect(observation.errors).toEqual([]);
  });
}

test('a wallet-browser link navigates only after a deliberate tap', async ({ page }) => {
  const observation = await openHarness(page);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  const destination = 'https://link.metamask.io/dapp/fxaeon.com/';
  const link = page.getByRole('link', { name: 'Open in MetaMask', exact: true });
  await expect(link).toBeVisible();
  expect(page.url()).toBe(`${origin}/?wallets=none`);
  await page.route(destination, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Wallet browser handoff</p>' }));
  await link.click();
  await expect(page).toHaveURL(destination);
  await expect(page.getByText('Wallet browser handoff')).toBeVisible();
  expect(observation.errors).toEqual([]);
});

test('chooser keyboard focus wraps through links and Escape quietly cancels', async ({ page }) => {
  const observation = await openHarness(page, 'multiple');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  const first = page.getByRole('button', { name: 'Test wallet 1' });
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(first).toBeFocused();
  await page.getByRole('link', { name: 'Open in Trust Wallet', exact: true }).focus();
  await expect(page.getByRole('link', { name: 'Open in Trust Wallet', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeEnabled();
  expect((await snapshot(page)).cancellations).toBe(1);
  expect(observation.errors).toEqual([]);
});

test('browser Back dismisses the chooser and keeps the current app page', async ({ page }) => {
  const observation = await openHarness(page, 'multiple'); const start = page.url();
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(page.url()).toBe(start);
  expect((await snapshot(page)).cancellations).toBe(1);
  expect(observation.errors).toEqual([]);
});

test('cancelling reconnect preserves the selected wallet and its ability to sign', async ({ page }) => {
  const observation = await openHarness(page, 'multiple');
  await connect(page, 1);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-address', accountB);
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:browser-wallet-disconnected'))).toBeNull();
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'b'.repeat(64)}`);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(observation.errors).toEqual([]);
});

test('selected legacy provider stays pinned after window.ethereum replacement and late discovery', async ({ page }) => {
  const observation = await openHarness(page, 'legacy');
  await connect(page);
  await page.evaluate(() => { globalThis.__mobileWalletHarness.inject(1); globalThis.__mobileWalletHarness.announce(1); });
  // Wait for the provider effect's 200 ms automatic sync after selection,
  // rather than finishing before it can accidentally read window.ethereum.
  await expect.poll(async () => (await snapshot(page)).calls[0].filter((call) => call.method === 'eth_accounts').length).toBeGreaterThanOrEqual(2);
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'a'.repeat(64)}`);
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  expect((await snapshot(page)).calls[1]).toEqual([]);
  expect(observation.errors).toEqual([]);
});

test('an automatically restored legacy wallet stays pinned after provider replacement', async ({ page }) => {
  const observation = await openHarness(page, 'legacy', '/', '&authorized=1');
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
  await page.evaluate(() => { globalThis.__mobileWalletHarness.inject(1); globalThis.__mobileWalletHarness.announce(1); });
  await expect.poll(async () => (await snapshot(page)).calls[0].filter((call) => call.method === 'eth_accounts').length).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'a'.repeat(64)}`);
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  expect((await snapshot(page)).calls[1]).toEqual([]);
  expect(observation.errors).toEqual([]);
});

for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
  test(`${event} during account preflight prevents a transaction in the same turn`, async ({ page }) => {
    const observation = await openHarness(page, 'single');
    await connect(page);
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(1);
    await page.evaluate(() => { globalThis.__mobileWalletHarness.wallets[0].holdAccounts = true; });
    await page.getByRole('button', { name: 'Send test transaction' }).click();
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].accountReadsWaiting)).toBe(1);
    await page.evaluate(({ event, account }) => {
      const wallet = globalThis.__mobileWalletHarness.wallets[0];
      wallet.emit(event, event === 'accountsChanged' ? [account] : event === 'chainChanged' ? '0x2105' : undefined);
      wallet.settleAccounts();
    }, { event, account: accountB });
    await expect(page.getByRole('alert')).toBeVisible();
    expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_sendTransaction')).toEqual([]);
    await expect(page.getByTestId('transaction-hash')).toHaveText('');
    expect(observation.errors).toEqual([]);
  });
}

for (const event of ['accountsChanged', 'disconnect']) {
  test(`a delayed automatic restore cannot overwrite a newer ${event} event`, async ({ page }) => {
    await page.goto(`${origin}/?wallets=single&authorized=1&holdAuto=1`);
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].accountReadsWaiting)).toBe(1);
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(1);
    await page.evaluate(({ event, account }) => {
      const wallet = globalThis.__mobileWalletHarness.wallets[0];
      wallet.emit(event, event === 'accountsChanged' ? [account] : undefined);
      wallet.settleAccounts();
    }, { event, account: accountB });
    await expect(page.locator('[data-harness-ready="true"]')).toBeVisible();
    await expect(page.locator('main')).toHaveAttribute('data-address', event === 'accountsChanged' ? accountB : '');
    expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_sendTransaction')).toEqual([]);
  });
}

test('chainChanged during a held chain read rejects its stale snapshot before signing', async ({ page }) => {
  const observation = await openHarness(page, 'single');
  await connect(page);
  await expect.poll(async () => (await snapshot(page)).calls[0].filter((call) => call.method === 'eth_accounts').length).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => { globalThis.__mobileWalletHarness.wallets[0].holdChain = true; });
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].chainReadsWaiting)).toBe(1);
  await page.evaluate(() => {
    const wallet = globalThis.__mobileWalletHarness.wallets[0];
    wallet.emit('chainChanged', '0x2105');
    wallet.settleChain();
  });
  await expect(page.getByRole('alert')).toHaveText('The wallet network changed before signing. Review the transaction and try again.');
  await expect(page.locator('main')).toHaveAttribute('data-chain', '8453');
  expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_sendTransaction')).toEqual([]);
  await expect(page.getByTestId('transaction-hash')).toHaveText('');
  expect(observation.errors).toEqual([]);
});

test('a second wallet announcement invalidates an in-flight ambiguous automatic restore', async ({ page }) => {
  await page.goto(`${origin}/?wallets=single&authorized=1&holdAuto=1`);
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].accountReadsWaiting)).toBe(1);
  await page.evaluate(() => {
    globalThis.__mobileWalletHarness.announce(1);
    globalThis.__mobileWalletHarness.wallets[0].settleAccounts();
  });
  await expect(page.locator('[data-harness-ready="true"]')).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('data-address', '');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Test wallet 2' })).toBeVisible();
  expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_sendTransaction')).toEqual([]);
});
