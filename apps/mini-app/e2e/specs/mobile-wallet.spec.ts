import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { test, expect, devices, type Page, type TestInfo } from '@playwright/test';
import type { MobileWalletHarnessState } from '../harness/mobile-wallet-entry';
import { buildLabGlobalCss } from '../harness/portfolio-states-build';

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

// Exercise the real provider, discovery, capability routing and overlay
// lifecycle. No remote wallet SDK, navigation or relay participates.
const mocks: Record<string, string> = {
  '@/lib/fx/clients': `export const getPublicClient = () => { throw new Error('Public RPC is disabled in the wallet lifecycle harness'); };`,
  'next/navigation': `export const useRouter = () => ({ push: (href) => { location.href = href; } });`,
  '@/lib/fx/config': `
    export const configuredRpcUrls = (chainId) => ['https://rpc.test/' + chainId];
    export const assertLocalForkRpcUrl = (url) => url;
    export const assertAlchemyRpcUrl = (url) => url;
    export const assertInfuraRpcUrl = (url) => url;
    export const assertSupportedChainId = (chainId) => { if (chainId !== 1 && chainId !== 8453) throw new Error('Unsupported chain'); };
  `,
  '@/lib/telegram': `export const isTelegramLaunchContext = () => false; export const openExternalLink = () => false;`,
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
  const css = await buildLabGlobalCss();
  const walletAssets = new Map(['metamask.svg', 'trust-wallet.svg', 'phantom.svg', 'rabby.svg', 'base.svg', 'coinbase.svg', 'rainbow.svg', 'zerion.svg', 'okx.svg'].map((name) => [`/wallets/${name}`, readFileSync(resolve(miniApp, 'public/wallets', name))]));
  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/harness.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(result.outputFiles[0].text); }
    else if (request.url === '/harness.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(css); }
    else if (walletAssets.has(request.url ?? '')) { response.writeHead(200, { 'Content-Type': 'image/svg+xml' }); response.end(walletAssets.get(request.url ?? '')); }
    else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Harness server has no port');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); });

async function openHarness(page: Page, wallets: 'none' | 'single' | 'multiple' | 'legacy' = 'none', path = '/', extra = '', environment: 'desktop' | 'mobile' | 'unknown' | 'native' = 'desktop') {
  const requests: string[] = []; const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  // Routing fixtures are explicit. A narrow viewport alone never means mobile.
  await page.addInitScript((device) => {
    if (device === 'native') return; // Preserve the configured phone profile's actual browser hints.
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: device === 'mobile'
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
      : device === 'desktop' ? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36' : 'UnknownHost/1.0' });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: device === 'mobile' ? 'iPhone' : device === 'desktop' ? 'Linux x86_64' : '' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: device === 'mobile' ? 5 : 0 });
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: device === 'unknown' ? undefined : { mobile: device === 'mobile' } });
  }, environment);
  await page.goto(`${origin}${path}?wallets=${wallets}${extra}`);
  await expect(page.locator('[data-harness-ready="true"]')).toBeVisible();
  return { requests, errors };
}
async function showOtherWallets(page: Page) {
  const other = page.getByRole('button', { name: 'Other wallets', exact: true });
  if (await other.isVisible()) await other.click();
  await expect(page.getByRole('dialog')).toHaveAttribute('data-wallet-view', 'all');
}

async function capturePicker(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('wallet picker uses a bottom sheet on phones and a centered flat list on desktop', async ({ page }) => {
  await openHarness(page);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await expect(dialog.locator('[data-wallet-id]')).toHaveCount(4);
      await expect(dialog.locator('.wallet-provider-detected')).toHaveCount(0);
      // Read settled sheet geometry after its finite entrance motion instead
      // of sampling a transitional position or weakening the viewport bounds.
      await dialog.evaluate(async element => {
        const finiteAnimations = element.getAnimations({ subtree: true }).filter((animation) =>
          animation.effect?.getComputedTiming().iterations !== Infinity);
        await Promise.all(finiteAnimations.map((animation) => animation.finished.catch(() => undefined)));
      });
      const geometry = await dialog.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, center: rect.left + rect.width / 2,
          width: rect.width, bottom: rect.bottom,
          overflow: element.scrollWidth - element.clientWidth,
          rows: [...element.querySelectorAll('.wallet-provider-option')].map(row => row.getBoundingClientRect().height),
          imagesLoaded: [...element.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0),
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(width <= 600 ? 8 : 20);
      expect(geometry.right).toBeLessThanOrEqual(width - (width <= 600 ? 8 : 20));
      expect(Math.abs(geometry.center - width / 2)).toBeLessThanOrEqual(1);
      expect(geometry.width).toBe(Math.min(400, width - (width <= 600 ? 16 : 40)));
      expect(geometry.bottom).toBeLessThanOrEqual(844 - (width <= 600 ? 8 : 20));
      if (width <= 600) expect(geometry.bottom).toBe(844 - 8);
      await expect(dialog.locator('.wallet-provider-options')).toHaveCSS('border-top-width', '0px');
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.imagesLoaded).toBe(true);
      for (const height of geometry.rows) expect(height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeFocused();
});

async function connect(page: Page, choice = 0, legacy = false) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await showOtherWallets(page);
  await page.getByRole('button', { name: legacy ? 'Wallet' : `Test wallet ${choice + 1}`, exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-connected', 'true');
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const h: MobileWalletHarnessState = globalThis.__mobileWalletHarness;
    return { calls: h.wallets.map((wallet) => wallet.calls), cancellations: h.cancellations, errors: h.errors, connectionOutcomes: h.connectionOutcomes };
  });
}

test('delayed legacy array discovery deduplicates namespaces and preserves exact-provider retry after EIP promotion', async ({ page }) => {
  const observation = await openHarness(page, 'none');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.evaluate(() => {
    const h = globalThis.__mobileWalletHarness;
    h.wallets[1].holdPrompt = true;
    Object.assign(window, { bitkeep: { ethereum: h.wallets[1].provider } });
    window.ethereum = Object.assign({}, h.wallets[0].provider, { providers: [h.wallets[1].provider, h.wallets[2].provider, h.wallets[1].provider] });
  });
  await expect(page.getByRole('button', { name: 'Bitget Wallet', exact: true })).toBeVisible();
  await showOtherWallets(page);
  await expect(page.getByRole('button', { name: /^Wallet \d+$/, exact: true })).toHaveCount(1);
  expect((await snapshot(page)).calls.flat()).toEqual([]);
  await page.getByRole('button', { name: 'Bitget Wallet', exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].promptsWaiting)).toBe(1);
  await page.evaluate(() => {
    const h = globalThis.__mobileWalletHarness;
    h.announceAs(1, 'Independent EVM wallet', 'org.independent.wallet');
    h.wallets[1].rejectPrompt();
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAttribute('data-wallet-view', 'error');
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].promptsWaiting)).toBe(2);
  await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].settlePrompt());
  await expect(page.locator('main')).toHaveAttribute('data-address', accountB);
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].listenerCount('accountsChanged'))).toBe(1);
  await page.evaluate((address) => globalThis.__mobileWalletHarness.wallets[1].emit('accountsChanged', [address]), accountA);
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'b'.repeat(64)}`);
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-connected', 'false');
  await page.evaluate((address) => globalThis.__mobileWalletHarness.wallets[1].emit('accountsChanged', [address]), accountB);
  await expect(page.locator('main')).toHaveAttribute('data-connected', 'false');
  const result = await snapshot(page);
  expect(result.calls[0]).toEqual([]);
  expect(result.calls[2]).toEqual([]);
  expect(result.calls[1].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(2);
  expect(observation.errors).toEqual([]);
});

test('remembered neutral legacy account never restores through an aggregate or replacement wallet', async ({ page }) => {
  await page.addInitScript((address) => {
    localStorage.setItem('fxaeon:browser-wallet-address', address);
    localStorage.removeItem('fxaeon:wallet-provider-rdns');
    window.addEventListener('eip6963:requestProvider', () => {
      const h = globalThis.__mobileWalletHarness;
      if (!h) return;
      h.wallets.forEach(wallet => wallet.setAccountsSilently([address]));
      window.ethereum = Object.assign({}, h.wallets[0].provider, { providers: [h.wallets[1].provider, h.wallets[2].provider] });
    });
  }, accountA);
  await openHarness(page, 'none');
  await expect(page.locator('main')).toHaveAttribute('data-harness-ready', 'true');
  await expect(page.locator('main')).toHaveAttribute('data-connected', 'false');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await showOtherWallets(page);
  await expect(page.getByRole('button', { name: /^Wallet \d+$/, exact: true })).toHaveCount(2);
  expect((await snapshot(page)).calls.flat()).toEqual([]);
});

for (const wallet of [
  { name: 'Base Wallet', rdns: 'com.coinbase.wallet', namespace: 'coinbaseWalletExtension' },
  { name: 'OKX', rdns: 'com.okex.wallet', namespace: 'okxwallet' },
  { name: 'Phantom', rdns: 'app.phantom', namespace: 'phantom' },
  { name: 'Trust Wallet', rdns: 'com.trustwallet.app', namespace: 'trustwallet' },
] as const) {
  test(`${wallet.name}: delayed compatibility injection silently restores the remembered account without focus or announcement`, async ({ page }) => {
    await page.addInitScript(({ rdns, address }) => {
      localStorage.setItem('fxaeon:wallet-provider-rdns', rdns);
      localStorage.setItem('fxaeon:browser-wallet-address', address);
    }, { rdns: wallet.rdns, address: accountA });
    const observation = await openHarness(page, 'none', '/', '&authorized=1');
    await expect(page.locator('main')).toHaveAttribute('data-harness-ready', 'true');
    // Deliberately arrive after the existing 200ms initialization pass.
    await page.waitForTimeout(300);
    await page.evaluate((namespace) => {
      const provider = globalThis.__mobileWalletHarness.wallets[0].provider;
      Object.assign(window, { [namespace]: namespace === 'phantom' || namespace === 'trustwallet' ? { ethereum: provider } : provider });
    }, wallet.namespace);
    await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
    await expect(page.getByTestId('second-wallet-consumer')).toHaveAttribute('data-address', accountA);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await snapshot(page)).calls.flat().filter(call => call.method === 'eth_requestAccounts')).toEqual([]);
    expect((await snapshot(page)).calls[1]).toEqual([]);
    expect(observation.errors).toEqual([]);
  });
}

test('focus retires a replaced passive namespace and restores only the newly validated exact remembered account', async ({ page }) => {
  await page.addInitScript((address) => {
    localStorage.setItem('fxaeon:wallet-provider-rdns', 'com.okex.wallet');
    localStorage.setItem('fxaeon:browser-wallet-address', address);
    window.addEventListener('eip6963:requestProvider', () => {
      Object.assign(window, { okxwallet: globalThis.__mobileWalletHarness.wallets[0].provider });
    });
  }, accountA);
  const observation = await openHarness(page, 'none', '/', '&authorized=1');
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(1);
  await page.evaluate((address) => {
    const h = globalThis.__mobileWalletHarness;
    h.wallets[1].setAccountsSilently([address]);
    Object.assign(window, { okxwallet: h.wallets[1].provider });
    window.dispatchEvent(new Event('focus'));
  }, accountA);
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(0);
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].listenerCount('accountsChanged'))).toBe(1);
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  expect((await snapshot(page)).calls.flat().filter(call => call.method === 'eth_requestAccounts')).toEqual([]);
  expect(observation.errors).toEqual([]);
});

test('a namespace replacement cancels a held passive restore and validates the new object without waiting for old RPC', async ({ page }) => {
  await page.addInitScript((address) => {
    localStorage.setItem('fxaeon:wallet-provider-rdns', 'com.okex.wallet');
    localStorage.setItem('fxaeon:browser-wallet-address', address);
    window.addEventListener('eip6963:requestProvider', () => {
      const h = globalThis.__mobileWalletHarness;
      h.wallets[0].holdAccounts = true;
      Object.assign(window, { okxwallet: h.wallets[0].provider });
    });
  }, accountA);
  const observation = await openHarness(page, 'none', '/', '&authorized=1');
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].accountReadsWaiting)).toBeGreaterThan(0);
  await page.evaluate((address) => {
    const h = globalThis.__mobileWalletHarness;
    h.wallets[1].setAccountsSilently([address]);
    Object.assign(window, { okxwallet: h.wallets[1].provider });
    window.dispatchEvent(new Event('ethereum#initialized'));
  }, accountA);
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(0);
  await page.evaluate(async () => {
    const wallet = globalThis.__mobileWalletHarness.wallets[0];
    wallet.holdAccounts = false; wallet.settleAccounts();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].listenerCount('accountsChanged'))).toBe(1);
  expect((await snapshot(page)).calls.flat().filter(call => call.method === 'eth_requestAccounts')).toEqual([]);
  expect(observation.errors).toEqual([]);
});

test('initialization after startup observation still restores silently, while manual disconnect blocks later initialization', async ({ page }) => {
  await page.addInitScript((address) => {
    localStorage.setItem('fxaeon:wallet-provider-rdns', 'com.okex.wallet');
    localStorage.setItem('fxaeon:browser-wallet-address', address);
  }, accountA);
  const observation = await openHarness(page, 'none', '/', '&authorized=1');
  await expect(page.locator('main')).toHaveAttribute('data-harness-ready', 'true');
  await page.waitForTimeout(5_100);
  await page.evaluate(() => {
    Object.assign(window, { okxwallet: globalThis.__mobileWalletHarness.wallets[0].provider });
    window.dispatchEvent(new Event('ethereum#initialized'));
  });
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-connected', 'false');
  const before = (await snapshot(page)).calls.flat();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('ethereum#initialized'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('main')).toHaveAttribute('data-address', '');
  expect((await snapshot(page)).calls.flat()).toEqual(before);
  expect(before.filter(call => call.method === 'eth_requestAccounts')).toEqual([]);
  expect(observation.errors).toEqual([]);
});

test('selected legacy provider stays pinned after window.ethereum replacement and late discovery', async ({ page }) => {
  const observation = await openHarness(page, 'legacy');
  await connect(page, 0, true);
  await page.evaluate(() => { globalThis.__mobileWalletHarness.inject(1); globalThis.__mobileWalletHarness.announce(1); });
  // Wait for the selected provider's event subscription before replacing it.
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(1);
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'a'.repeat(64)}`);
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  expect((await snapshot(page)).calls[1]).toEqual([]);
  expect(observation.errors).toEqual([]);
});

test('an exact remembered announced wallet restores and stays pinned after provider replacement', async ({ page }) => {
  const observation = await openHarness(page, 'single', '/', '&authorized=1&remembered=1');
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
  await page.evaluate(() => { globalThis.__mobileWalletHarness.inject(1); globalThis.__mobileWalletHarness.announce(1); });
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(1);
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'a'.repeat(64)}`);
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  expect((await snapshot(page)).calls[1]).toEqual([]);
  expect(observation.errors).toEqual([]);
});

for (const preferredRdns of ['io.metamask', 'io.metamask.mobile']) {
  for (const announcedRdns of ['io.metamask', 'io.metamask.mobile']) {
    test(`remembered ${preferredRdns} restores ${announcedRdns} exactly and clears on a late mixed-alias conflict`, async ({ page }) => {
      await page.addInitScript(({ preferredRdns, announcedRdns, address }) => {
        localStorage.setItem('fxaeon:wallet-provider-rdns', preferredRdns);
        localStorage.setItem('fxaeon:browser-wallet-address', address);
        window.addEventListener('eip6963:requestProvider', () => {
          const wallet = globalThis.__mobileWalletHarness?.wallets[0];
          if (wallet) window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
            detail: { info: { name: 'MetaMask', rdns: announcedRdns }, provider: wallet.provider },
          }));
        });
      }, { preferredRdns, announcedRdns, address: accountA });
      const observation = await openHarness(page, 'none', '/', '&authorized=1');
      for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
        await expect(consumer).toHaveAttribute('data-connected', 'true');
        await expect(consumer).toHaveAttribute('data-address', accountA);
      }
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
      await page.evaluate(() => globalThis.__mobileWalletHarness.inject(1));
      await page.getByRole('button', { name: 'Send test transaction' }).click();
      await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'a'.repeat(64)}`);
      expect((await snapshot(page)).calls[1]).toEqual([]);

      await page.evaluate((rdns) => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { info: { name: 'Second MetaMask claim', rdns }, provider: globalThis.__mobileWalletHarness.wallets[1].provider },
      })), announcedRdns === 'io.metamask' ? 'io.metamask.mobile' : 'io.metamask');
      for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
        await expect(consumer).toHaveAttribute('data-connected', 'false');
        await expect(consumer).toHaveAttribute('data-address', '');
        await expect(consumer).toHaveAttribute('data-prompt', 'false');
      }
      await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(0);
      await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
      const metamask = page.getByRole('button', { name: 'MetaMask', exact: true });
      await expect(metamask).toHaveCount(1);
      await metamask.click();
      await expect(page.getByRole('dialog', { name: 'MetaMask', exact: true })).toHaveAttribute('data-wallet-view', 'error');
      await expect(page.getByRole('alert')).toContainText('Multiple wallets');
      expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
      expect((await snapshot(page)).calls[1]).toEqual([]);
      expect(observation.errors).toEqual([]);
    });
  }
}

for (const duplicateIdentity of [false, true]) {
  test(`a fully restored passive session ${duplicateIdentity ? 'clears on a late duplicate identity' : 'survives a late unrelated wallet'}`, async ({ page }) => {
    const observation = await openHarness(page, 'single', '/', '&authorized=1&remembered=1');
    for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
      await expect(consumer).toHaveAttribute('data-connected', 'true');
      await expect(consumer).toHaveAttribute('data-address', accountA);
    }
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(1);
    await page.evaluate((duplicate) => {
      const harness = globalThis.__mobileWalletHarness;
      if (duplicate) window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { info: { name: 'Late duplicate identity', rdns: 'test.wallet.1' }, provider: harness.wallets[1].provider },
      }));
      else harness.announce(1);
    }, duplicateIdentity);
    for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
      await expect(consumer).toHaveAttribute('data-connected', String(!duplicateIdentity));
      await expect(consumer).toHaveAttribute('data-address', duplicateIdentity ? '' : accountA);
      await expect(consumer).toHaveAttribute('data-prompt', 'false');
    }
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(duplicateIdentity ? 0 : 1);
    expect((await snapshot(page)).calls[1]).toEqual([]);
    expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
    expect(observation.errors).toEqual([]);
  });
}

test('an explicitly selected provider stays pinned after a duplicate identity but future selection fails closed', async ({ page }) => {
  const observation = await openHarness(page, 'single');
  await connect(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { info: { name: 'Late duplicate identity', rdns: 'test.wallet.1' }, provider: globalThis.__mobileWalletHarness.wallets[1].provider },
  })));
  for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
    await expect(consumer).toHaveAttribute('data-connected', 'true');
    await expect(consumer).toHaveAttribute('data-address', accountA);
  }
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'a'.repeat(64)}`);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await showOtherWallets(page);
  const choice = page.getByRole('button', { name: 'Test wallet 1', exact: true });
  await expect(choice).toHaveCount(1);
  await choice.click();
  const dialog = page.getByRole('dialog', { name: 'Test wallet 1', exact: true });
  await expect(dialog).toHaveAttribute('data-wallet-view', 'error');
  await expect(dialog.getByRole('alert')).toContainText('Multiple wallets');
  expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
  expect((await snapshot(page)).calls[1]).toEqual([]);
  await dialog.getByRole('button', { name: 'Close wallet selection', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  await expect(page.getByTestId('second-wallet-consumer')).toHaveAttribute('data-address', accountA);
  expect(observation.errors).toEqual([]);
});

for (const savedAddress of ['missing', 'invalid', 'zero'] as const) {
  test(`a saved rdns with a ${savedAddress} address never silently restores but explicit selection still works`, async ({ page }) => {
    const observation = await openHarness(page, 'single', '/', `&authorized=1&remembered=1&savedAddress=${savedAddress}`);
    for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
      await expect(consumer).toHaveAttribute('data-connected', 'false');
      await expect(consumer).toHaveAttribute('data-address', '');
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The fixture authorizes eth_accounts, but an incomplete preference grants
    // no restore authority and should not even start a passive account read.
    expect((await snapshot(page)).calls.flat()).toEqual([]);
    await connect(page);
    await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
    await expect(page.getByTestId('second-wallet-consumer')).toHaveAttribute('data-address', accountA);
    expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
    expect(await page.evaluate(() => localStorage.getItem('fxaeon:browser-wallet-address'))).toBe(accountA);
    expect(observation.errors).toEqual([]);
  });
}

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
      wallet.holdAccounts = false; wallet.settleAccounts();
    }, { event, account: accountB });
    await expect(page.getByRole('alert')).toBeVisible();
    expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_sendTransaction')).toEqual([]);
    await expect(page.getByTestId('transaction-hash')).toHaveText('');
    expect(observation.errors).toEqual([]);
  });
}

for (const event of ['accountsChanged', 'disconnect']) {
  test(`a delayed automatic restore cannot overwrite a newer ${event} event`, async ({ page }) => {
    await page.goto(`${origin}/?wallets=single&authorized=1&remembered=1&holdAuto=1`);
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].accountReadsWaiting)).toBe(1);
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(1);
    await page.evaluate(({ event, account }) => {
      const wallet = globalThis.__mobileWalletHarness.wallets[0];
      wallet.emit(event, event === 'accountsChanged' ? [account] : undefined);
      wallet.holdAccounts = false; wallet.settleAccounts();
    }, { event, account: accountB });
    await expect(page.locator('[data-harness-ready="true"]')).toBeVisible();
    await expect(page.locator('main')).toHaveAttribute('data-address', '');
    expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_sendTransaction')).toEqual([]);
  });
}

test('chainChanged during a held chain read rejects its stale snapshot before signing', async ({ page }) => {
  const observation = await openHarness(page, 'single');
  await connect(page);
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(1);
  await page.evaluate(() => { globalThis.__mobileWalletHarness.wallets[0].holdChain = true; });
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].chainReadsWaiting)).toBe(1);
  await page.evaluate(() => {
    const wallet = globalThis.__mobileWalletHarness.wallets[0];
    wallet.emit('chainChanged', '0x2105');
    wallet.holdChain = false; wallet.settleChain();
  });
  await expect(page.getByRole('alert')).toHaveText('The wallet network changed before signing. Review the transaction and try again.');
  await expect(page.locator('main')).toHaveAttribute('data-chain', '8453');
  expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_sendTransaction')).toEqual([]);
  await expect(page.getByTestId('transaction-hash')).toHaveText('');
  expect(observation.errors).toEqual([]);
});

for (const duplicateIdentity of [false, true]) {
  test(`a ${duplicateIdentity ? 'duplicate identity invalidates' : 'distinct wallet preserves'} an exact remembered restore`, async ({ page }) => {
    await page.goto(`${origin}/?wallets=single&authorized=1&remembered=1&holdAuto=1`);
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].accountReadsWaiting)).toBe(1);
    await page.evaluate((duplicate) => {
      const harness = globalThis.__mobileWalletHarness;
      if (duplicate) window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { info: { name: 'Duplicate identity', rdns: 'test.wallet.1' }, provider: harness.wallets[1].provider },
      }));
      else harness.announce(1);
      harness.wallets[0].holdAccounts = false;
      harness.wallets[0].settleAccounts();
    }, duplicateIdentity);
    await expect(page.locator('[data-harness-ready="true"]')).toBeVisible();
    await expect(page.locator('main')).toHaveAttribute('data-address', duplicateIdentity ? '' : accountA);
    expect((await snapshot(page)).calls[1]).toEqual([]);
    expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
  });
}

for (const mode of ['single', 'legacy'] as const) {
  test(`an authorized ${mode} provider without a saved choice does not auto-connect`, async ({ page }) => {
    await openHarness(page, mode, '/', '&authorized=1');
    await expect(page.locator('main')).toHaveAttribute('data-connected', 'false');
    expect((await snapshot(page)).calls.flat()).toEqual([]);
  });
}

const primaryNames = ['MetaMask', 'Base Wallet', 'OKX', 'Rabby'];

for (const mode of ['single', 'legacy'] as const) {
  test(`one ${mode} wallet still uses the same explicit wallet picker`, async ({ page }) => {
    const observation = await openHarness(page, mode);
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Connect your wallet', exact: true })).toBeVisible();
    expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
    await showOtherWallets(page);
    await page.getByRole('button', { name: mode === 'legacy' ? 'Wallet' : 'Test wallet 1', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
    expect(observation.requests.every((url) => new URL(url).origin === origin)).toBe(true);
    expect(observation.errors).toEqual([]);
  });
}

test('the picker has one logo-and-name row per wallet with no route categories or manual choices', async ({ page }) => {
  await openHarness(page);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect your wallet', exact: true });
  await expect(dialog.locator('[data-wallet-id]')).toHaveCount(4);
  await expect(dialog.locator('.wallet-provider-option-name').filter({ hasNotText: 'Other wallets' })).toHaveText(primaryNames);
  await expect(dialog.locator('h3, details, a')).toHaveCount(0);
  for (const name of primaryNames) {
    const row = dialog.getByRole('button', { name, exact: true });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveText(name);
    await expect(row.locator('img')).toHaveCount(1);
    await expect(row.locator('.wallet-provider-option-hint, .wallet-provider-detected, .wallet-provider-arrow')).toHaveCount(0);
  }
  await expect(dialog.getByText(/popular|installed|wallet browser|desktop extension|mobile app|detected/i)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Other wallets', exact: true })).toHaveText('Other wallets');
  expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
});

for (const [name, rdns] of [['Trust Wallet', 'com.trustwallet.app'], ['Phantom', 'app.phantom']] as const) {
  test(`detected ${name} and unknown wallets appear first and stay deduplicated under Other`, async ({ page }) => {
    const observation = await openHarness(page);
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    const primary = page.getByRole('dialog', { name: 'Connect your wallet', exact: true });
    await page.getByRole('button', { name: 'Base Wallet', exact: true }).focus();
    await page.evaluate(({ name, rdns }) => {
      for (const [index, identity, label] of [[0, rdns, name], [0, rdns, name], [1, 'test.compatibility-brand', 'Coinbase Wallet']] as const) {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
          detail: { info: { name: label, rdns: identity }, provider: globalThis.__mobileWalletHarness.wallets[index].provider },
        }));
      }
    }, { name, rdns });
    await expect(primary.locator('[data-wallet-id]')).toHaveCount(6);
    await expect(primary.locator('.wallet-provider-option-name').filter({ hasNotText: 'Other wallets' })).toHaveText([name, 'Wallet 1', ...primaryNames]);
    await expect(primary.locator('.wallet-provider-detected')).toHaveCount(2);
    await expect(primary.getByRole('button', { name: 'Base Wallet', exact: true })).toBeFocused();
    await expect(primary.getByRole('button', { name, exact: true })).toHaveCount(1);
    await showOtherWallets(page);
    const all = page.getByRole('dialog', { name: 'Other wallets', exact: true });
    await expect(all.locator('[data-wallet-id]').first()).toHaveAttribute('data-wallet-id', name === 'Trust Wallet' ? 'trust' : 'phantom');
    await expect(all.locator('[data-wallet-id]')).toHaveCount(9);
    for (const brand of [...primaryNames, 'Trust Wallet', 'Phantom', 'Rainbow', 'Zerion']) {
      await expect(all.getByRole('button', { name: brand, exact: true })).toHaveCount(1);
    }
    await expect(all.getByRole('button', { name: 'Coinbase Wallet', exact: true })).toHaveCount(0);
    await expect(all.getByRole('button', { name: 'Wallet 1', exact: true })).toHaveCount(1);
    await all.getByRole('searchbox', { name: 'Search wallets' }).fill(name);
    await expect(all.locator('[data-wallet-id]')).toHaveCount(1);
    expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
    await all.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
    expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
    expect((await snapshot(page)).calls[1]).toEqual([]);
    expect(observation.errors).toEqual([]);
  });
}

for (const environment of ['desktop', 'mobile', 'unknown'] as const) {
  for (const rdns of ['io.metamask', 'io.metamask.mobile']) {
    test(`${environment}: ${rdns} updates its one existing MetaMask row without changing focus or auto-connecting`, async ({ page }) => {
      const navigation = await interceptExternalNavigation(page);
      const observation = await openHarness(page, 'none', '/', '', environment);
      await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
      const metamask = page.getByRole('button', { name: 'MetaMask', exact: true });
      await metamask.focus();
      await page.evaluate((identity) => {
        // Both names for the same exact object must continue to be one choice.
        const identities = [identity, identity === 'io.metamask' ? 'io.metamask.mobile' : 'io.metamask'];
        for (const rdns of identities) window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
          detail: { info: { name: 'Announced MetaMask name', rdns, icon: 'https://untrusted-icon.invalid/tracker.svg' }, provider: globalThis.__mobileWalletHarness.wallets[0].provider },
        }));
      }, rdns);
      await expect(metamask).toHaveCount(1);
      await expect(metamask).toBeFocused();
      await expect(page.getByRole('dialog').locator('[data-wallet-id]')).toHaveCount(4);
      expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
      await metamask.click();
      await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
      expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
      expect((await snapshot(page)).calls[1]).toEqual([]);
      expect(navigation.attempts).toEqual([]);
      expect(navigation.popups).toEqual([]);
      expect(observation.requests.every((url) => new URL(url).origin === origin)).toBe(true);
      expect(observation.errors).toEqual([]);
    });
  }
}

test('multiple extensions send only through the selected provider and update both consumers', async ({ page }) => {
  const observation = await openHarness(page, 'multiple');
  await connect(page, 1);
  for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
    await expect(consumer).toHaveAttribute('data-address', accountB);
    await expect(consumer).toHaveAttribute('data-connected', 'true');
    await expect(consumer).toHaveAttribute('data-prompt', 'false');
  }
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'b'.repeat(64)}`);
  expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts' || call.method === 'eth_sendTransaction')).toEqual([]);
  await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].emit('chainChanged', '0x2105'));
  await expect(page.locator('main')).toHaveAttribute('data-chain', '8453');
  await expect(page.getByTestId('second-wallet-consumer')).toHaveAttribute('data-chain', '8453');
  await page.evaluate((account) => globalThis.__mobileWalletHarness.wallets[1].emit('accountsChanged', [account]), accountA);
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  await expect(page.getByTestId('second-wallet-consumer')).toHaveAttribute('data-address', accountA);
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-connected', 'false');
  await expect(page.getByTestId('second-wallet-consumer')).toHaveAttribute('data-connected', 'false');
  expect(observation.errors).toEqual([]);
});

const appDestinations = [
  ['MetaMask', 'https://metamask.io/download'],
  ['Trust Wallet', 'https://trustwallet.com/download'],
  ['Phantom', 'https://phantom.com/download'],
  ['Rabby', 'https://rabby.io/'],
  ['Base Wallet', 'https://wallet.coinbase.com/download'],
  ['Rainbow', 'https://rainbow.me/download'],
  ['Zerion', 'https://zerion.io/download/'],
  ['OKX', 'https://web3.okx.com/download'],
] as const;
const browserNames = ['MetaMask', 'Base Wallet', 'OKX', 'Trust Wallet', 'Phantom', 'Rabby', 'Rainbow', 'Zerion'] as const;
function browserDestinations(path: string): Record<(typeof browserNames)[number], string> {
  const appUrl = new URL(path, origin).href;
  const target = new URL(appUrl);
  return {
    MetaMask: `https://link.metamask.io/dapp/${target.host}${target.pathname}${target.search}${target.hash}`,
    'Base Wallet': `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(appUrl)}`,
    OKX: `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(appUrl)}`,
    'Trust Wallet': `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(appUrl)}`,
    Phantom: `https://phantom.com/ul/browse/${encodeURIComponent(appUrl)}?ref=${encodeURIComponent(target.origin)}`,
    Rabby: `rabbygo://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(appUrl)}`,
    Rainbow: `https://rnbwapp.com/dapp?url=${encodeURIComponent(appUrl)}`,
    Zerion: `https://link.zerion.io/?url=${encodeURIComponent(appUrl)}`,
  };
}

async function interceptExternalNavigation(page: Page) {
  const attempts: Array<{ href: string; sameTab: boolean; userActivated: boolean; connected: boolean }> = [];
  const popups: Page[] = [];
  page.on('popup', (popup) => popups.push(popup));
  await page.exposeBinding('__captureWalletNavigation', (source, state: {
    href: string; userActivated: boolean; connected: boolean;
  }) => {
    attempts.push({ ...state, sameTab: source.frame === page.mainFrame() });
  });
  await page.addInitScript(() => {
    // Observe activation during the real navigation event. Reading it through
    // page.evaluate would itself run with Playwright's synthetic user gesture.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    navigation?.addEventListener('navigate', (event) => {
      const destination = (event as Event & { destination?: { url?: string } }).destination?.url;
      if (!destination || new URL(destination).origin === location.origin) return;
      const capture = (window as Window & { __captureWalletNavigation?: (state: {
        href: string; userActivated: boolean; connected: boolean;
      }) => Promise<void> }).__captureWalletNavigation;
      if (capture) void capture({
        href: destination,
        userActivated: navigator.userActivation.isActive,
        connected: document.querySelector('main')?.getAttribute('data-connected') === 'true',
      });
      // Cancel both native schemes and HTTPS universal links at the actual
      // navigation boundary. A routed 204 can leave newer Playwright versions
      // waiting for a document navigation that never commits.
      event.preventDefault();
    });
  });
  // Safety net for regressed popups/resources or a non-cancelable navigation.
  // Expected same-tab handoffs above must produce no external HTTP request.
  await page.context().route('**/*', async (route) => {
    const request = route.request();
    if (new URL(request.url()).origin === origin) { await route.continue(); return; }
    let sameTab = false;
    try { sameTab = request.isNavigationRequest() && request.frame() === page.mainFrame(); }
    catch { /* A regressed popup may request before its frame exists; still intercept it. */ }
    attempts.push({ href: request.url(), sameTab, userActivated: false, connected: false });
    await route.fulfill({ status: 204 });
  });
  return { attempts, popups };
}

async function expectNoNavigationSession(page: Page) {
  for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
    await expect(consumer).toHaveAttribute('data-connected', 'false');
    await expect(consumer).toHaveAttribute('data-address', '');
    await expect(consumer).toHaveAttribute('data-chain', '');
    await expect(consumer).toHaveAttribute('data-version', '0');
  }
  const state = await snapshot(page);
  expect(state.calls.flat()).toEqual([]);
  expect(state.connectionOutcomes).toEqual([]);
  expect(state.errors).toEqual([]);
  expect(await page.evaluate(() => [
    localStorage.getItem('fxaeon:browser-wallet-address'), localStorage.getItem('fxaeon:wallet-provider-rdns'),
  ])).toEqual([null, null]);
}

for (const environment of ['mobile', 'unknown'] as const) {
  test(`${environment} absent wallets navigate safely in the same tab and retry without borrowing an unrelated provider`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const navigation = await interceptExternalNavigation(page);
    const observation = await openHarness(page, 'multiple', '/earn', '&tgWebAppData=private-query#private-hash', environment);
    // Even a legacy provider advertising isMetaMask cannot authorize a named row.
    await page.evaluate(() => Object.assign(window.ethereum!, { isMetaMask: true }));
    const originalUrl = page.url();
    const trigger = page.getByRole('button', { name: 'Connect wallet', exact: true });
    await trigger.click();
    await page.getByRole('button', { name: 'Other wallets', exact: true }).click();
    for (const [name, appHref] of appDestinations) {
      const safeDappUrl = new URL(originalUrl); safeDappUrl.searchParams.delete('tgWebAppData');
      const browserHref = environment === 'mobile' && browserNames.some((candidate) => candidate === name)
        ? browserDestinations(safeDappUrl.href)[name as (typeof browserNames)[number]] : undefined;
      const href = browserHref ?? appHref;
      const before = navigation.attempts.length;
      await page.getByRole('button', { name, exact: true }).click({ noWaitAfter: true });
      if (browserHref) await expect.poll(() => navigation.attempts.length).toBe(before + 1);
      else expect(navigation.attempts).toHaveLength(before);
      const dialog = page.getByRole('dialog', { name, exact: true });
      await expect(dialog).toHaveAttribute('data-wallet-view', 'handoff');
      await expect(dialog.getByRole('status')).toHaveText(browserHref ? `Opening ${name}…` : `Open FxAeon in ${name}’s browser to connect. Use the app guide or install the wallet below.`);
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      const back = dialog.getByRole('button', { name: 'Back to Other wallets', exact: true });
      await expect(back).toBeFocused();
      if (environment === 'mobile' && name === 'MetaMask') await capturePicker(page, testInfo, 'wallet-handoff-dark-390');
      await dialog.getByText('Connection help', { exact: true }).click();
      await expect(dialog.getByRole('link', { name: `Install ${name}`, exact: true })).toHaveAttribute('href', name === 'Rabby' ? 'https://rabby.io/?platform=mobile' : appHref);
      await expect(dialog.getByRole('link', { name: 'Wallet guide', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Copy FxAeon link', exact: true })).toBeVisible();
      if (environment === 'mobile' && name === 'MetaMask') await capturePicker(page, testInfo, 'wallet-recovery-dark-390');
      if (browserHref) {
        const retry = dialog.getByRole('button', { name: `Open ${name}`, exact: true });
        await retry.click({ noWaitAfter: true });
        await expect.poll(() => navigation.attempts.length).toBe(before + 2);
        await expect(retry).toBeFocused();
        expect(navigation.attempts.slice(before)).toEqual([
          { href, sameTab: true, userActivated: true, connected: false },
          { href, sameTab: true, userActivated: true, connected: false },
        ]);
      } else {
        await expect(dialog.getByRole('button', { name: `Open ${name}`, exact: true })).toHaveCount(0);
      }
      expect(decodeURIComponent(href)).not.toMatch(/private-query|tgWebAppData|browser-extension|\/extension(?:[/?#]|$)/);
      await expectNoNavigationSession(page);
      await page.evaluate(async () => {
        globalThis.__mobileWalletHarness.rerender?.();
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      });
      expect(navigation.attempts).toHaveLength(before + (browserHref ? 2 : 0));
      await back.click();
      await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
      expect(page.url()).toBe(originalUrl);
    }
    await expectNoNavigationSession(page);
    expect(navigation.popups).toHaveLength(0);
    expect(observation.requests.filter((url) => new URL(url).origin !== origin)).toEqual([]);
    expect(observation.errors).toEqual([]);
    await page.getByRole('button', { name: 'Close wallet selection', exact: true }).click();
    await expect(trigger).toBeFocused();
    await expect(page.getByTestId('second-wallet-consumer')).toHaveAttribute('data-prompt', 'false');
    expect((await snapshot(page)).connectionOutcomes).toEqual(['cancelled']);
  });
}

const installationDestinations = [
  ['MetaMask', 'https://metamask.io/download'],
  ['Trust Wallet', 'https://trustwallet.com/browser-extension'],
  ['Phantom', 'https://phantom.com/download'],
  ['Rabby', 'https://rabby.io/'],
  ['Base Wallet', 'https://www.coinbase.com/wallet/downloads'],
  ['Rainbow', 'https://rainbow.me/download'],
  ['Zerion', 'https://zerion.io/extension'],
  ['OKX', 'https://web3.okx.com/download'],
] as const;

test('desktop absent-wallet selection opens only its official installation page and remains disconnected', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const attemptedUrls: string[] = [];
  await page.context().route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === origin) { await route.continue(); return; }
    attemptedUrls.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><link rel="icon" href="data:,"><p>Official installation destination fixture</p>' });
  });
  const observation = await openHarness(page, 'multiple');
  const route = page.url();
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Other wallets', exact: true }).click();
  for (const [name, href] of installationDestinations) {
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name, exact: true }).click();
    const installationPage = await popup;
    await expect(installationPage).toHaveURL(href);
    expect(await installationPage.evaluate(() => window.opener === null)).toBe(true);
    await installationPage.close();
    const dialog = page.getByRole('dialog', { name, exact: true });
    await expect(dialog).toHaveAttribute('data-wallet-view', 'handoff');
    await expect(dialog.getByRole('status')).toHaveText(`Opening ${name}’s official download page.`);
    if (name === 'MetaMask') await capturePicker(page, testInfo, 'wallet-not-detected-dark-1280');
    await dialog.getByText('Connection help', { exact: true }).click();
    const install = dialog.getByRole('link', { name: `Install ${name}`, exact: true });
    await expect(install).toHaveAttribute('href', href);
    await expect(dialog.getByRole('link', { name: 'Wallet guide', exact: true })).toBeVisible();
    if (name === 'MetaMask') await capturePicker(page, testInfo, 'wallet-recovery-dark-1280');
    await expect(dialog.getByRole('button', { name: `Open ${name}`, exact: true })).toHaveCount(0);
    const retryPopup = page.waitForEvent('popup');
    await install.click();
    const retryPage = await retryPopup;
    await expect(retryPage).toHaveURL(href);
    expect(await retryPage.evaluate(() => window.opener === null)).toBe(true);
    await retryPage.close();
    await expect(install).toBeFocused();
    await expectNoNavigationSession(page);
    expect(page.url()).toBe(route);
    await dialog.getByRole('button', { name: 'Back to Other wallets', exact: true }).click();
    await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
  }
  expect(attemptedUrls).toEqual(installationDestinations.flatMap(([, href]) => [href, href]));
  expect(observation.errors).toEqual([]);
});

for (const path of ['/', '/earn', '/unsupported']) {
  for (const name of browserNames) {
    test(`${name} mobile handoff selects one verified safe destination from ${path} without claiming a connection`, async ({ page }) => {
      const navigation = await interceptExternalNavigation(page);
      const observation = await openHarness(page, 'multiple', path, '&tgWebAppData=private-query#private-hash', 'mobile');
      const currentUrl = page.url();
      const safeDappUrl = new URL(currentUrl); safeDappUrl.searchParams.delete('tgWebAppData');
      const href = browserDestinations(safeDappUrl.href)[name];
      await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
      if (!primaryNames.includes(name)) await page.getByRole('button', { name: 'Other wallets', exact: true }).click();
      await page.getByRole('button', { name, exact: true }).click({ noWaitAfter: true });
      await expect.poll(() => navigation.attempts.length).toBe(1);
      expect(navigation.attempts).toEqual([{ href, sameTab: true, userActivated: true, connected: false }]);
      await expect(page.getByRole('dialog', { name, exact: true })).toHaveAttribute('data-wallet-view', 'handoff');
      await expectNoNavigationSession(page);
      expect(navigation.popups).toHaveLength(0);
      expect(decodeURIComponent(navigation.attempts[0].href)).not.toMatch(/tgWebAppData|private-query/);
      if (name === 'Rabby') expect(new URL(navigation.attempts[0].href).searchParams.get('dapp')).toBe(safeDappUrl.href);
      expect(observation.errors).toEqual([]);
    });
  }
}

for (const profile of ['Pixel 7', 'iPhone 13'] as const) {
  test.describe(`${profile} browser defaults`, () => {
    const { userAgent, viewport } = devices[profile];
    test.use({ userAgent, viewport, isMobile: true, hasTouch: true });
    test('actual phone-like UA selects mobile handoff and app-download routes', async ({ page }) => {
      const navigation = await interceptExternalNavigation(page);
      const observation = await openHarness(page, 'multiple', '/trade', '', 'native');
      expect(await page.evaluate(() => navigator.userAgent)).toBe(userAgent);
      expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
      await page.getByRole('button', { name: 'Rabby', exact: true }).click({ noWaitAfter: true });
      await expect.poll(() => navigation.attempts.length).toBe(1);
      expect(navigation.attempts[0]).toEqual({ href: browserDestinations(page.url()).Rabby, sameTab: true, userActivated: true, connected: false });
      await page.getByRole('button', { name: 'Back to wallets', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Rabby', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Base Wallet', exact: true }).click({ noWaitAfter: true });
      await expect.poll(() => navigation.attempts.length).toBe(2);
      expect(navigation.attempts[1]).toEqual({ href: browserDestinations(page.url())['Base Wallet'], sameTab: true, userActivated: true, connected: false });
      await expectNoNavigationSession(page);
      expect(navigation.popups).toHaveLength(0);
      expect(observation.errors).toEqual([]);
    });
  });
}

for (const name of ['Base Wallet', 'OKX', 'Zerion']) {
  test(`${name} mobile tap opens the current FxAeon route in its wallet browser without claiming a connection`, async ({ page }) => {
    const navigation = await interceptExternalNavigation(page);
    await openHarness(page, 'none', '/positions', '&position=ETH%3Along%3A2033#review', 'mobile');
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    if (!primaryNames.includes(name)) await showOtherWallets(page);
    await page.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog', { name, exact: true });
    await expect(dialog).toHaveAttribute('data-wallet-view', 'handoff');
    await expect(dialog).toContainText(`Opening ${name}…`);
    await expect.poll(() => navigation.attempts.length).toBe(1);
    expect(navigation.attempts[0]).toEqual({ href: browserDestinations(page.url())[name as (typeof browserNames)[number]], sameTab: true, userActivated: true, connected: false });
    expect(navigation.popups).toHaveLength(0);
    await expectNoNavigationSession(page);
  });
}

test('wallet guidance copies the safe current FxAeon route and shows a selectable URL when clipboard access fails', async ({ page }) => {
  await openHarness(page, 'none', '/positions', '&position=ETH%3Along%3A2033&tgWebAppData=launch-proof&access_token=auth-secret#review?tgWebAppVersion=8&tab=details', 'unknown');
  const expected = `${origin}/positions?wallets=none&position=ETH%3Along%3A2033#review?tab=details`;
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { (window as Window & { __copiedDapp?: string }).__copiedDapp = value; },
    } });
  });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'OKX', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'OKX', exact: true });
  await dialog.getByText('Connection help', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Copy FxAeon link', exact: true }).click();
  await expect(dialog.getByText('FxAeon link copied.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __copiedDapp?: string }).__copiedDapp)).toBe(expected);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Permission denied'); } } });
    document.execCommand = () => false;
  });
  await dialog.getByRole('button', { name: 'Copy FxAeon link', exact: true }).click();
  await expect(dialog.getByText('Copy was blocked. Select the link below to copy it.', { exact: true })).toBeVisible();
  await expect(dialog.locator('code')).toHaveText(expected);
  expect(await dialog.locator('code').evaluate(element => getComputedStyle(element).userSelect)).not.toBe('none');
  await expectNoNavigationSession(page);
});

for (const rdns of ['io.metamask', 'io.metamask.mobile']) {
  test(`handoff retry resolves fresh ${rdns} injection without automatically connecting or reopening a link`, async ({ page }) => {
    const navigation = await interceptExternalNavigation(page);
    await openHarness(page, 'none', '/', '', 'mobile');
    await page.evaluate(() => { globalThis.__mobileWalletHarness.inject(1); globalThis.__mobileWalletHarness.announce(1); });
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await page.getByRole('button', { name: 'MetaMask', exact: true }).click({ noWaitAfter: true });
    await expect.poll(() => navigation.attempts.length).toBe(1);
    await page.evaluate((rdns) => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { name: 'MetaMask', rdns }, provider: globalThis.__mobileWalletHarness.wallets[0].provider },
    })), rdns);
    await expectNoNavigationSession(page);
    await page.getByRole('button', { name: 'Open MetaMask', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
    await expect(page.getByTestId('second-wallet-consumer')).toHaveAttribute('data-address', accountA);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(navigation.attempts).toHaveLength(1);
    expect(navigation.popups).toHaveLength(0);
    expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
    expect((await snapshot(page)).calls[1]).toEqual([]);
    expect((await snapshot(page)).connectionOutcomes).toEqual(['connected']);
  });
}

for (const identities of [['io.metamask', 'io.metamask'], ['io.metamask', 'io.metamask.mobile'], ['io.metamask.mobile', 'io.metamask']]) {
  test(`ambiguous ${identities.join(' and ')} providers keep one wallet row and cannot silently choose either provider`, async ({ page }) => {
    const observation = await openHarness(page);
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await page.evaluate((identities) => {
      for (const [index, wallet] of globalThis.__mobileWalletHarness.wallets.entries()) window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { info: { name: `Duplicate brand ${index + 1}`, rdns: identities[index], icon: 'https://untrusted-icon.invalid/tracker.svg' }, provider: wallet.provider },
      }));
    }, identities);
    await expect(page.getByRole('button', { name: 'MetaMask', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'MetaMask', exact: true }).locator('.wallet-provider-detected')).toHaveCount(0);
    await expect(page.getByRole('dialog').locator('[data-wallet-id]')).toHaveCount(5);
    await page.getByRole('button', { name: 'MetaMask', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveAttribute('data-wallet-view', 'error');
    await expect(page.getByRole('alert')).toBeVisible();
    expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
    await expect(page.locator('main')).toHaveAttribute('data-connected', 'false');
    expect(observation.requests.every((url) => new URL(url).origin === origin)).toBe(true);
  });
}

test('pending approval stays visible through rerender and repeated consumer connects are single-flight', async ({ page }) => {
  const observation = await openHarness(page, 'multiple');
  await page.evaluate(() => { globalThis.__mobileWalletHarness.wallets[1].holdPrompt = true; });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.evaluate(() => { void globalThis.__mobileWalletHarness.connectAgain?.(); });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await showOtherWallets(page);
  await page.getByRole('button', { name: 'Test wallet 2', exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].promptsWaiting)).toBe(1);
  await page.evaluate(() => { globalThis.__mobileWalletHarness.rerender?.(); void globalThis.__mobileWalletHarness.connectFromSecondConsumer?.(); });
  const dialog = page.getByRole('dialog', { name: 'Test wallet 2', exact: true });
  await expect(dialog).toHaveAttribute('data-wallet-view', 'pending');
  await expect(dialog.getByRole('heading', { name: 'Waiting for approval', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Back to Other wallets', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close wallet selection', exact: true })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('data-prompt', 'true');
  await expect(page.getByTestId('second-wallet-consumer')).toHaveAttribute('data-prompt', 'true');
  expect((await snapshot(page)).calls[1].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
  await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].settlePrompt());
  await expect(page.locator('main')).toHaveAttribute('data-address', accountB);
  await expect(page.getByTestId('second-wallet-consumer')).toHaveAttribute('data-address', accountB);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).connectionOutcomes).toEqual(['connected', 'connected', 'connected']);
  expect(observation.errors).toEqual([]);
});

test('Back stops waiting, keeps the picker open, and ignores a late approval before another choice', async ({ page }) => {
  await openHarness(page, 'multiple');
  await page.evaluate(() => { globalThis.__mobileWalletHarness.wallets[0].holdPrompt = true; });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await showOtherWallets(page);
  await page.getByRole('button', { name: 'Test wallet 1', exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].promptsWaiting)).toBe(1);
  await page.getByRole('button', { name: 'Back to Other wallets', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Other wallets', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test wallet 1', exact: true })).toBeFocused();
  await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].settlePrompt());
  await expect(page.locator('main')).toHaveAttribute('data-connected', 'false');
  expect((await snapshot(page)).connectionOutcomes).toEqual([]);
  await showOtherWallets(page);
  await page.getByRole('button', { name: 'Test wallet 2', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-address', accountB);
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'b'.repeat(64)}`);
});

for (const dismissal of ['Escape', 'browser Back', 'Close', 'backdrop'] as const) {
  test(`${dismissal} cancels pending approval and a late result cannot replace a reopened connection`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const observation = await openHarness(page, 'multiple', '/earn');
    const route = page.url();
    await page.evaluate(() => { globalThis.__mobileWalletHarness.wallets[0].holdPrompt = true; });
    const trigger = page.getByRole('button', { name: 'Connect wallet', exact: true });
    await trigger.click();
    await showOtherWallets(page);
    await page.getByRole('button', { name: 'Test wallet 1', exact: true }).click();
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].promptsWaiting)).toBe(1);
    if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else if (dismissal === 'browser Back') await page.goBack();
    else if (dismissal === 'backdrop') await page.locator('.wallet-provider-chooser-backdrop').click({ position: { x: 8, y: 8 } });
    else await page.getByRole('button', { name: 'Close wallet selection', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeEnabled();
    await expect(trigger).toBeFocused();
    await expect(page.locator('main')).toHaveAttribute('data-connected', 'false');
    await expect(page.getByTestId('second-wallet-consumer')).toHaveAttribute('data-prompt', 'false');
    expect(page.url()).toBe(route);
    await expect.poll(() => page.locator('body').evaluate((body) => body.style.overflow)).toBe('');
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Connect your wallet', exact: true })).toBeVisible();
    await showOtherWallets(page);
    await page.getByRole('button', { name: 'Test wallet 2', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-address', accountB);
    await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].settlePrompt());
    await expect(page.locator('main')).toHaveAttribute('data-address', accountB);
    await page.getByRole('button', { name: 'Send test transaction' }).click();
    await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'b'.repeat(64)}`);
    expect((await snapshot(page)).cancellations).toBe(1);
    expect((await snapshot(page)).connectionOutcomes).toEqual(['cancelled', 'connected']);
    expect(observation.errors).toEqual([]);
  });
}

test('a rejected approval leaves an in-modal error and Retry prompts only the same wallet', async ({ page }) => {
  await openHarness(page, 'multiple');
  await page.evaluate(() => { globalThis.__mobileWalletHarness.wallets[1].holdPrompt = true; });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await showOtherWallets(page);
  await page.getByRole('button', { name: 'Test wallet 2', exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].promptsWaiting)).toBe(1);
  await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].rejectPrompt());
  const dialog = page.getByRole('dialog', { name: 'Test wallet 2', exact: true });
  await expect(dialog).toHaveAttribute('data-wallet-view', 'error');
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect((await snapshot(page)).connectionOutcomes).toEqual([]);
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].promptsWaiting)).toBe(2);
  await expect(dialog).toHaveAttribute('data-wallet-view', 'pending');
  await expect(dialog.getByRole('button', { name: 'Back to Other wallets', exact: true })).toBeFocused();
  await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[1].settlePrompt());
  await expect(page.locator('main')).toHaveAttribute('data-address', accountB);
  expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
  expect((await snapshot(page)).calls[1].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(2);
  expect((await snapshot(page)).connectionOutcomes).toEqual(['connected']);
});

test('cancelling a reconnect preserves the existing selected wallet and signing provider', async ({ page }) => {
  await openHarness(page, 'multiple', '/', '', 'unknown');
  await connect(page, 1);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await showOtherWallets(page);
  await page.evaluate(() => {
    globalThis.__mobileWalletHarness.wallets[2].holdPrompt = true;
    globalThis.__mobileWalletHarness.announceAs(2, 'Trust Wallet', 'com.trustwallet.app');
  });
  await expect(page.getByRole('button', { name: 'Trust Wallet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Trust Wallet', exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[2].promptsWaiting)).toBe(1);
  await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[2].rejectPrompt());
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Close wallet selection', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-address', accountB);
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:browser-wallet-disconnected'))).toBeNull();
  await page.getByRole('button', { name: 'Send test transaction' }).click();
  await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'b'.repeat(64)}`);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Other wallets searches all choices and Back preserves focus, search and route across an error', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 360 });
  const observation = await openHarness(page, 'none', '/', '', 'unknown');
  await page.evaluate(() => {
    globalThis.__mobileWalletHarness.wallets[0].holdPrompt = true;
    globalThis.__mobileWalletHarness.announceAs(0, 'Rainbow', 'me.rainbow');
  });
  const route = page.url();
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Other wallets', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Other wallets', exact: true });
  await expect(dialog.locator('[data-wallet-id]')).toHaveCount(8);
  await expect(dialog.getByRole('button', { name: 'Back to wallets', exact: true })).toBeFocused();
  const search = dialog.getByRole('searchbox', { name: 'Search wallets' });
  await search.fill('rain');
  await expect(dialog.locator('[data-wallet-id]')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Rainbow', exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].promptsWaiting)).toBe(1);
  await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].rejectPrompt());
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Other wallets', exact: true }).click();
  await expect(search).toHaveValue('rain');
  await expect(dialog.getByRole('button', { name: 'Rainbow', exact: true })).toBeFocused();
  await search.fill('not a wallet');
  await expect(dialog.getByRole('status')).toHaveText('No wallets match your search.');
  await search.fill('');
  await expect(dialog.locator('[data-wallet-id]')).toHaveCount(8);
  await dialog.getByRole('button', { name: 'Back to wallets', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Other wallets', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Other wallets', exact: true })).toBeInViewport();
  expect(page.url()).toBe(route);
  expect(observation.requests.every((url) => new URL(url).origin === origin)).toBe(true);
});

test('late discovery in Other wallets requires an explicit selection', async ({ page }) => {
  await openHarness(page);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Other wallets', exact: true }).click();
  await page.evaluate(() => globalThis.__mobileWalletHarness.announce(1));
  await expect(page.getByRole('button', { name: 'Test wallet 2', exact: true })).toBeVisible();
  expect((await snapshot(page)).calls.flat().filter((call) => call.method === 'eth_requestAccounts')).toEqual([]);
  await expect(page.locator('main')).toHaveAttribute('data-connected', 'false');
  await showOtherWallets(page);
  await page.getByRole('button', { name: 'Test wallet 2', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-address', accountB);
});

test('recovery focus trap excludes closed help controls and follows the disclosure when opened', async ({ page }) => {
  const observation = await openHarness(page, 'none', '/', '', 'unknown');
  const trigger = page.getByRole('button', { name: 'Connect wallet', exact: true });
  await trigger.click();
  await page.getByRole('button', { name: 'MetaMask', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'MetaMask', exact: true });
  const back = dialog.getByRole('button', { name: 'Back to wallets', exact: true });
  const summary = dialog.locator('.wallet-provider-recovery > summary');
  await expect(dialog.locator('details')).not.toHaveAttribute('open');
  await back.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  await summary.click();
  const guide = dialog.getByRole('link', { name: 'Wallet guide', exact: true });
  await back.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(guide).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  await summary.click();
  await back.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(observation.errors).toEqual([]);
});

test('wallet help stays inside the picker and returns focus without starting a connection', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const observation = await openHarness(page, 'multiple', '/earn');
  const originalUrl = page.url();
  const trigger = page.getByRole('button', { name: 'Connect wallet', exact: true });
  await trigger.click();
  const help = page.getByRole('button', { name: 'What is a wallet?', exact: true });
  await capturePicker(page, testInfo, 'wallet-detected-list-dark-390');
  await page.setViewportSize({ width: 1280, height: 800 });
  await capturePicker(page, testInfo, 'wallet-detected-list-dark-1280');
  await page.setViewportSize({ width: 390, height: 844 });
  await help.click();
  const dialog = page.getByRole('dialog', { name: 'What is a wallet?', exact: true });
  await expect(dialog).toHaveAttribute('data-wallet-view', 'help');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveText(['Your connection to FxAeon', 'A home for your assets', 'You approve every action']);
  await expect(dialog.getByRole('button', { name: 'Back to wallets', exact: true })).toBeFocused();
  await capturePicker(page, testInfo, 'wallet-help-dark-390');
  await page.setViewportSize({ width: 1280, height: 800 });
  await capturePicker(page, testInfo, 'wallet-help-dark-1280');
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: 'Back to wallets', exact: true }).click();
  await expect(help).toBeFocused();
  await help.click();
  await dialog.getByRole('button', { name: 'Explore wallets', exact: true }).click();
  const all = page.getByRole('dialog', { name: 'Other wallets', exact: true });
  await expect(all.getByRole('searchbox', { name: 'Search wallets' })).toBeVisible();
  await expect(all.getByRole('button', { name: 'Back to wallets', exact: true })).toBeFocused();
  await all.getByRole('searchbox', { name: 'Search wallets' }).fill('MetaMask');
  await expect(all.locator('[data-wallet-id]')).toHaveCount(1);
  await capturePicker(page, testInfo, 'wallet-search-dark-390');
  await page.setViewportSize({ width: 1280, height: 800 });
  await capturePicker(page, testInfo, 'wallet-search-dark-1280');
  expect((await snapshot(page)).calls.flat().filter(call => call.method === 'eth_requestAccounts')).toEqual([]);
  expect(page.url()).toBe(originalUrl);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(observation.errors).toEqual([]);
});

test('keyboard focus wraps and Escape quietly cancels the whole picker', async ({ page }) => {
  await openHarness(page, 'multiple');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  const close = page.getByRole('button', { name: 'Close wallet selection', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'What is a wallet?', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Other wallets', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'What is a wallet?', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeFocused();
  expect((await snapshot(page)).cancellations).toBe(1);
});

for (const theme of ['dark'] as const) {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    test(`minimal wallet rows fit ${theme} at ${viewport.width}px with real local marks`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const observation = await openHarness(page);
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Connect your wallet', exact: true });
      await expect.poll(() => dialog.locator('img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
      await expect.poll(() => dialog.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
      const geometry = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width,
          overflows: element.scrollWidth > element.clientWidth + 1,
          controls: [...element.querySelectorAll('button, input')].map((control) => {
            const box = control.getBoundingClientRect(); return { width: box.width, height: box.height };
          }) };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(viewport.width);
      expect(geometry.bottom).toBeLessThanOrEqual(viewport.height);
      expect(geometry.overflows).toBe(false);
      expect(geometry.width).toBe(Math.min(400, viewport.width - (viewport.width <= 600 ? 16 : 40)));
      expect(Math.abs((geometry.left + geometry.right) / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
      for (const control of geometry.controls) { expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44); }
      expect(observation.requests.every((url) => new URL(url).origin === origin)).toBe(true);
      expect(observation.errors).toEqual([]);
      await capturePicker(page, testInfo, `wallet-selection-${theme}-${viewport.width}`);
    });
  }
}

for (const enlarged of [false, true]) {
  for (const view of ['wallets', 'all', 'pending', 'error'] as const) {
    test(`${view} keeps every control reachable with ${enlarged ? '200% text' : 'a short viewport'}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 320, height: enlarged ? 568 : 360 });
      await openHarness(page, 'multiple', '/', '&longName=1', 'unknown');
      await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
      if (view === 'all') await page.getByRole('button', { name: 'Other wallets', exact: true }).click();
      if (view === 'pending') {
        await page.evaluate(() => { globalThis.__mobileWalletHarness.wallets[1].holdPrompt = true; });
        await showOtherWallets(page);
        await page.getByRole('button', { name: 'A very long wallet extension name for narrow screen testing 2', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveAttribute('data-wallet-view', 'pending');
      }
      if (view === 'error') {
        await page.evaluate(() => {
          globalThis.__mobileWalletHarness.wallets[2].holdPrompt = true;
          globalThis.__mobileWalletHarness.announceAs(2, 'MetaMask', 'io.metamask');
        });
        await expect(page.getByRole('button', { name: 'MetaMask', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'MetaMask', exact: true }).click();
        await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[2].promptsWaiting)).toBe(1);
        await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[2].rejectPrompt());
        await expect(page.getByRole('dialog')).toHaveAttribute('data-wallet-view', 'error');
        await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
      }
      const dialog = page.getByRole('dialog');
      if (enlarged) await dialog.evaluate((element) => {
        const sizes = [...element.querySelectorAll<HTMLElement>('*')].map((node) => ({ node, size: parseFloat(getComputedStyle(node).fontSize) }));
        for (const { node, size } of sizes) node.style.fontSize = `${size * 2}px`;
      });
      if (view === 'pending') await capturePicker(page, testInfo, `wallet-pending-${enlarged ? 'enlarged' : 'short'}-320`);
      const titleGeometry = await dialog.locator('h2').evaluate((heading) => {
        const title = heading.getBoundingClientRect();
        const close = heading.parentElement!.querySelector('button[aria-label="Close wallet selection"]')!.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(heading);
        const text = range.getBoundingClientRect();
        return { fits: heading.scrollWidth <= heading.clientWidth && text.left >= title.left - 1 && text.right <= title.right + 1 && title.right <= close.left,
          clientWidth: heading.clientWidth, scrollWidth: heading.scrollWidth, titleLeft: title.left, titleRight: title.right, textLeft: text.left, textRight: text.right, closeLeft: close.left };
      });
      expect(titleGeometry, JSON.stringify(titleGeometry)).toMatchObject({ fits: true });
      for (const control of await dialog.locator('button, input').all()) {
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport();
        const measurement = await control.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 22));
          return { name: element.getAttribute('aria-label') || element.textContent?.trim(),
            width: rect.width, height: rect.height, top: rect.top,
            touchTarget: rect.width >= 44 && rect.height >= 44,
            hittable: Boolean(hit && element.contains(hit)), hitTag: hit?.tagName };
        });
        expect(measurement, JSON.stringify(measurement)).toMatchObject({ touchTarget: true, hittable: true });
      }
      expect(await dialog.evaluate((element) => {
        const content = element.querySelector('.wallet-provider-chooser-content')!;
        return element.scrollWidth <= element.clientWidth && content.scrollWidth <= content.clientWidth;
      })).toBe(true);
      await dialog.getByRole('button', { name: 'Close wallet selection', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeFocused();
      await expect.poll(() => page.locator('body').evaluate((body) => body.style.overflow)).toBe('');
    });
  }
}

test('reduced motion holds the sheet and pending indicator still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openHarness(page, 'multiple');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCSS('animation-name', 'none');
  await expect(dialog).toHaveCSS('transform', 'none');
  await expect(page.getByRole('button', { name: 'Close wallet selection', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.locator('[data-wallet-id]').first()).toBeFocused();
  await page.evaluate(() => { globalThis.__mobileWalletHarness.wallets[0].holdPrompt = true; });
  await showOtherWallets(page);
  await page.getByRole('button', { name: 'Test wallet 1', exact: true }).click();
  await expect(dialog.locator('.wallet-provider-pending-icon')).toHaveCSS('animation-name', 'none');
  await expect(dialog.getByRole('button', { name: 'Back to Other wallets', exact: true })).toBeFocused();
});

test('closing and reselecting the same wallet reuses its still-open approval without a duplicate request', async ({ page }) => {
  await openHarness(page, 'single');
  await page.evaluate(() => { globalThis.__mobileWalletHarness.wallets[0].holdPrompt = true; });
  const trigger = page.getByRole('button', { name: 'Connect wallet', exact: true });
  await trigger.click();
  await showOtherWallets(page);
  await page.getByRole('button', { name: 'Test wallet 1', exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].promptsWaiting)).toBe(1);
  await page.getByRole('button', { name: 'Close wallet selection', exact: true }).click();
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await showOtherWallets(page);
  await page.getByRole('button', { name: 'Test wallet 1', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveAttribute('data-wallet-view', 'pending');
  expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
  await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].settlePrompt());
  await expect(page.locator('main')).toHaveAttribute('data-address', accountA);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await snapshot(page)).connectionOutcomes).toEqual(['cancelled', 'connected']);
});

for (const event of ['accountsChanged', 'connect'] as const) {
  test(`${event} after a provider disconnect silently restores the pinned account and validated chain without window focus`, async ({ page }) => {
    const observation = await openHarness(page, 'single');
    await connect(page);
    await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].emit('disconnect'));
    for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
      await expect(consumer).toHaveAttribute('data-connected', 'false');
      await expect(consumer).toHaveAttribute('data-address', '');
      await expect(consumer).toHaveAttribute('data-chain', '');
    }
    const before = (await snapshot(page)).calls[0];
    await page.evaluate(({ event, account, otherAccount }) => {
      const wallet = globalThis.__mobileWalletHarness.wallets[0];
      wallet.setAccountsSilently(event === 'connect' ? [otherAccount, account] : [account]);
      // No window focus, visibilitychange, or unrelated wallet announcement:
      // the provider's own reconnect event must trigger validated recovery.
      wallet.emit(event, event === 'accountsChanged' ? [account] : { chainId: '0x1' });
    }, { event, account: accountA, otherAccount: accountB });
    for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
      await expect(consumer).toHaveAttribute('data-connected', 'true');
      await expect(consumer).toHaveAttribute('data-address', accountA);
      await expect(consumer).toHaveAttribute('data-chain', '1');
      await expect(consumer).toHaveAttribute('data-prompt', 'false');
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const after = (await snapshot(page)).calls[0];
    for (const method of ['eth_accounts', 'eth_chainId']) {
      expect(after.filter((call) => call.method === method).length).toBeGreaterThan(before.filter((call) => call.method === method).length);
    }
    expect(after.filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
    expect((await snapshot(page)).calls[1]).toEqual([]);
    expect(observation.errors).toEqual([]);
  });

  for (const interruption of ['manual disconnect', 'new wallet selection'] as const) {
    test(`${event} reconnect validation cannot publish a stale held read after ${interruption}`, async ({ page }) => {
      const observation = await openHarness(page, 'multiple');
      await connect(page);
      await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].emit('disconnect'));
      await expect(page.locator('main')).toHaveAttribute('data-address', '');
      await expect(page.locator('main')).toHaveAttribute('data-chain', '');
      const heldReadsBefore = await page.evaluate((event) => {
        const wallet = globalThis.__mobileWalletHarness.wallets[0];
        return event === 'accountsChanged' ? wallet.chainReadsWaiting : wallet.accountReadsWaiting;
      }, event);
      await page.evaluate(({ event, account }) => {
        const wallet = globalThis.__mobileWalletHarness.wallets[0];
        wallet.setAccountsSilently([account]);
        if (event === 'accountsChanged') wallet.holdChain = true;
        else wallet.holdAccounts = true;
        wallet.emit(event, event === 'accountsChanged' ? [account] : { chainId: '0x1' });
      }, { event, account: accountA });
      await expect.poll(() => page.evaluate((event) => {
        const wallet = globalThis.__mobileWalletHarness.wallets[0];
        return event === 'accountsChanged' ? wallet.chainReadsWaiting : wallet.accountReadsWaiting;
      }, event)).toBeGreaterThan(heldReadsBefore);

      if (interruption === 'manual disconnect') await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
      else await connect(page, 1);
      const expectedAddress = interruption === 'manual disconnect' ? '' : accountB;
      await expect(page.locator('main')).toHaveAttribute('data-address', expectedAddress);
      await page.evaluate(async () => {
        const wallet = globalThis.__mobileWalletHarness.wallets[0];
        wallet.holdAccounts = false; wallet.holdChain = false;
        wallet.settleAccounts(); wallet.settleChain();
        // Let the released validation's promise chain settle before checking
        // that it did not overwrite the newer user choice.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
        await expect(consumer).toHaveAttribute('data-connected', String(interruption !== 'manual disconnect'));
        await expect(consumer).toHaveAttribute('data-address', expectedAddress);
        await expect(consumer).toHaveAttribute('data-chain', interruption === 'manual disconnect' ? '' : '1');
        await expect(consumer).toHaveAttribute('data-prompt', 'false');
      }
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
      expect((await snapshot(page)).calls[1].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(interruption === 'manual disconnect' ? 0 : 1);
      if (interruption === 'new wallet selection') {
        await page.getByRole('button', { name: 'Send test transaction', exact: true }).click();
        await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'b'.repeat(64)}`);
        expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_sendTransaction')).toEqual([]);
      }
      expect(observation.errors).toEqual([]);
    });
  }
}

for (const outcome of ['recover on Base', 'manual disconnect', 'new wallet selection'] as const) {
  test(`chainChanged during a held reconnect read reschedules validation safely: ${outcome}`, async ({ page }) => {
    const observation = await openHarness(page, 'multiple');
    await connect(page);
    await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].emit('disconnect'));
    await expect(page.locator('main')).toHaveAttribute('data-address', '');
    await expect(page.locator('main')).toHaveAttribute('data-chain', '');
    const heldAccountReadsBefore = await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].accountReadsWaiting);
    await page.evaluate((account) => {
      const wallet = globalThis.__mobileWalletHarness.wallets[0];
      wallet.setAccountsSilently([account]);
      wallet.holdAccounts = true;
      wallet.emit('connect', { chainId: '0x1' });
    }, accountA);
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].accountReadsWaiting)).toBeGreaterThan(heldAccountReadsBefore);

    const heldChainReadsBefore = await page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].chainReadsWaiting);
    await page.evaluate(() => {
      const wallet = globalThis.__mobileWalletHarness.wallets[0];
      // Keep the original account read pending, but let the new validation
      // reach a separately held chain read. The fixture's settle methods
      // release every provider request held at each stage.
      wallet.holdAccounts = false;
      wallet.holdChain = true;
      wallet.emit('chainChanged', '0x2105');
    });
    // The pre-fix implementation only invalidates the first read and never
    // starts this replacement pass, leaving the account absent indefinitely.
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].chainReadsWaiting)).toBeGreaterThan(heldChainReadsBefore);
    await expect(page.locator('main')).toHaveAttribute('data-address', '');

    if (outcome === 'manual disconnect') await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
    else if (outcome === 'new wallet selection') await connect(page, 1);
    await page.evaluate(async () => {
      const wallet = globalThis.__mobileWalletHarness.wallets[0];
      wallet.holdChain = false;
      wallet.settleAccounts();
      wallet.settleChain();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    const expectedAddress = outcome === 'manual disconnect' ? '' : outcome === 'new wallet selection' ? accountB : accountA;
    const expectedChain = outcome === 'manual disconnect' ? '' : outcome === 'new wallet selection' ? '1' : '8453';
    for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
      await expect(consumer).toHaveAttribute('data-connected', String(outcome !== 'manual disconnect'));
      await expect(consumer).toHaveAttribute('data-address', expectedAddress);
      await expect(consumer).toHaveAttribute('data-chain', expectedChain);
      await expect(consumer).toHaveAttribute('data-prompt', 'false');
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
    expect((await snapshot(page)).calls[1].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(outcome === 'new wallet selection' ? 1 : 0);
    if (outcome === 'new wallet selection') {
      await page.getByRole('button', { name: 'Send test transaction', exact: true }).click();
      await expect(page.getByTestId('transaction-hash')).toHaveText(`0x${'b'.repeat(64)}`);
      expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_sendTransaction')).toEqual([]);
    }
    expect(observation.errors).toEqual([]);
  });
}

test('manual local disconnect blocks late connect and accountsChanged from silently restoring a wallet', async ({ page }) => {
  const observation = await openHarness(page, 'single');
  await connect(page);
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-connected', 'false');
  for (const event of ['accountsChanged', 'connect']) {
    await expect.poll(() => page.evaluate((event) => globalThis.__mobileWalletHarness.wallets[0].listenerCount(event), event)).toBe(0);
  }
  await page.evaluate(async (account) => {
    const wallet = globalThis.__mobileWalletHarness.wallets[0];
    wallet.setAccountsSilently([account]);
    wallet.emit('connect', { chainId: '0x1' });
    wallet.emit('accountsChanged', [account]);
    globalThis.__mobileWalletHarness.announce(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }, accountA);
  for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
    await expect(consumer).toHaveAttribute('data-connected', 'false');
    await expect(consumer).toHaveAttribute('data-address', '');
    await expect(consumer).toHaveAttribute('data-chain', '');
    await expect(consumer).toHaveAttribute('data-prompt', 'false');
  }
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:browser-wallet-disconnected'))).toBe('1');
  expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(observation.errors).toEqual([]);
});

for (const event of ['accountsChanged', 'disconnect'] as const) {
  test(`cancelling after ${event} leaves the inactive provider detached and ignores a late old account`, async ({ page }) => {
    const observation = await openHarness(page, 'single');
    await connect(page);
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(1);
    await page.evaluate((name) => globalThis.__mobileWalletHarness.wallets[0].emit(name, name === 'accountsChanged' ? [] : undefined), event);
    for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
      await expect(consumer).toHaveAttribute('data-connected', 'false');
      await expect(consumer).toHaveAttribute('data-address', '');
    }
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Connect your wallet', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close wallet selection', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].listenerCount('accountsChanged'))).toBe(0);
    await page.evaluate((oldAccount) => globalThis.__mobileWalletHarness.wallets[0].emit('accountsChanged', [oldAccount]), accountA);
    for (const consumer of [page.locator('main'), page.getByTestId('second-wallet-consumer')]) {
      await expect(consumer).toHaveAttribute('data-connected', 'false');
      await expect(consumer).toHaveAttribute('data-address', '');
      await expect(consumer).toHaveAttribute('data-prompt', 'false');
    }
    expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
    expect((await snapshot(page)).cancellations).toBe(1);
    expect(observation.errors).toEqual([]);
  });
}


test('a delayed network-switch read cannot overwrite a newer chainChanged event', async ({ page }) => {
  const observation = await openHarness(page, 'single');
  await connect(page);
  await page.evaluate(() => { globalThis.__mobileWalletHarness.wallets[0].holdChain = true; });
  await page.getByRole('button', { name: 'Switch to Base', exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__mobileWalletHarness.wallets[0].chainReadsWaiting)).toBe(1);
  await page.evaluate(() => {
    const fixture = globalThis.__mobileWalletHarness.wallets[0];
    fixture.emit('chainChanged', '0x1'); fixture.holdChain = false; fixture.settleChain();
  });
  await expect(page.locator('main')).toHaveAttribute('data-chain', '1');
  await expect(page.getByRole('alert')).toHaveText('Wallet network could not be verified.');
  expect((await snapshot(page)).calls[0].filter((call) => call.method === 'eth_sendTransaction')).toEqual([]);
  expect(observation.errors).toEqual([]);
});
