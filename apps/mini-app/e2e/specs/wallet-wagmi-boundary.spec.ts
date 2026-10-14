import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { buildWalletWagmiBoundaryHarness, type WalletWagmiBoundaryBundle } from '../harness/wallet-wagmi-boundary-build';
import { BROWSER_ADDRESS, EMBEDDED_ADDRESS, EMBEDDED_BALANCE, type BoundaryMode } from '../harness/wallet-wagmi-boundary-state';
import { WALLET_CATALOG } from '../../src/lib/wallet/walletCatalog';

let bundle: WalletWagmiBoundaryBundle;
let server: Server;
let origin: string;
test.beforeAll(async () => {
  bundle = await buildWalletWagmiBoundaryHarness();
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const source = bundle.files.get(path === '/' ? '/index.html' : path);
    response.setHeader('Cache-Control', 'no-store');
    if (!source) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html' });
    response.end(source);
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Boundary fixture server has no port');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); });

async function open(page: Page, mode: BoundaryMode) {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/?mode=${mode}`);
  return { requests, errors };
}
const snapshot = (page: Page) => page.evaluate(() => globalThis.__wagmiBoundaryHarness.snapshot());
const owner = (page: Page) => page.getByTestId('wallet-owner');

async function expectFundedPrivyOwner(page: Page) {
  await expect(owner(page)).toHaveAttribute('data-provider-mode', 'privy');
  await expect(owner(page)).toHaveAttribute('data-authenticated', 'true');
  await expect(owner(page)).toHaveAttribute('data-embedded', 'true');
  await expect(owner(page)).toHaveAttribute('data-wallet-client', 'privy-v2');
  await expect(owner(page)).toHaveAttribute('data-address', EMBEDDED_ADDRESS);
  await expect(owner(page)).toHaveAttribute('data-balance-wei', EMBEDDED_BALANCE);
  expect(await snapshot(page)).toMatchObject({
    configCreates: 0, connectorCreates: 0, discoveryRequests: 0,
    wagmiConnections: [], browserCalls: [], decoyCalls: [], forbiddenCalls: [], errors: [],
  });
}
async function expectNoPrivy(page: Page, observation: Awaited<ReturnType<typeof open>>) {
  expect(await snapshot(page)).toMatchObject({ privyModuleLoads: 0, privyMounts: 0, privyHookCalls: 0, embeddedCalls: [], decoyCalls: [], forbiddenCalls: [], errors: [] });
  expect(observation.requests.filter((path) => bundle.privyPaths.has(path))).toEqual([]);
  expect(observation.errors).toEqual([]);
}
async function selectExactFake(page: Page) {
  await expect(owner(page)).toHaveAttribute('data-ready', 'true');
  await expect(owner(page)).toHaveAttribute('data-provider-mode', 'browser');
  expect(await snapshot(page)).toMatchObject({ configCreates: 0, connectorCreates: 0, browserCalls: [], decoyCalls: [] });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Connect your wallet', exact: true });
  await expect(picker).toBeVisible();
  // Opening the real picker performs discovery but never creates a connector.
  expect(await snapshot(page)).toMatchObject({ configCreates: 0, connectorCreates: 0, browserCalls: [], decoyCalls: [] });
  await picker.getByRole('button', { name: 'Rabby', exact: true }).click();
  await expect(owner(page)).toHaveAttribute('data-address', BROWSER_ADDRESS);
  await expect(owner(page)).toHaveAttribute('data-embedded', 'false');
  await expect(owner(page)).toHaveAttribute('data-wallet-client', 'browser');
  await expect(picker).toHaveCount(0);
  const state = await snapshot(page);
  expect(state.configCreates).toBe(1);
  expect(state.connectorCreates).toBe(1);
  expect(state.discoveryRequests).toBeGreaterThan(0);
  expect(state.wagmiConnections).toEqual([{ status: 'connected', accounts: [BROWSER_ADDRESS], connectorId: 'rabby' }]);
  expect(state.browserCalls.filter((call) => call.method === 'eth_requestAccounts')).toHaveLength(1);
  expect(state.browserCalls.some((call) => call.method === 'eth_accounts')).toBe(true);
  expect(state.decoyCalls).toEqual([]);
}

test('Telegram keeps its funded embedded owner and never instantiates real browser Wagmi after navigation, remount, or reload', async ({ page }) => {
  const observation = await open(page, 'telegram');
  await expectFundedPrivyOwner(page);
  expect((await snapshot(page)).privyModuleLoads).toBe(1);
  expect(observation.requests.some((path) => bundle.privyPaths.has(path))).toBe(true);
  const identity = await owner(page).getAttribute('data-identity');
  await page.getByRole('button', { name: 'Announce injected fake', exact: true }).click();
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  expect(new URL(page.url()).hash).toBe('');
  await expect(owner(page)).toHaveAttribute('data-route', 'settings');
  await expect(owner(page)).toHaveAttribute('data-identity', identity!);
  await expectFundedPrivyOwner(page);
  expect(await snapshot(page)).toMatchObject({ privyMounts: 1, privyUnmounts: 0, routeMounts: 1, routeUnmounts: 0 });
  await page.getByRole('button', { name: 'Remount provider', exact: true }).click();
  await expect(owner(page)).not.toHaveAttribute('data-identity', identity!);
  await expectFundedPrivyOwner(page);
  expect(await snapshot(page)).toMatchObject({ privyMounts: 2, privyUnmounts: 1, childMounts: 2, childUnmounts: 1 });
  await page.reload();
  await expectFundedPrivyOwner(page);
  await expect(owner(page)).toHaveAttribute('data-route', 'settings');
  expect(await snapshot(page)).toMatchObject({ privyMounts: 1, privyUnmounts: 0 });
  expect(observation.errors).toEqual([]);
});

test('OKX announcement takes precedence over its distinct namespace wrapper without preselection requests', async ({ page }) => {
  await page.goto(`${origin}/?mode=web&okxAlias=1`);
  await expect(owner(page)).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Connect your wallet', exact: true });
  await expect(picker).toBeVisible();
  expect(await snapshot(page)).toMatchObject({ configCreates: 0, connectorCreates: 0, browserCalls: [], decoyCalls: [] });
  await picker.getByRole('button', { name: 'OKX', exact: true }).click();
  await expect(owner(page)).toHaveAttribute('data-address', BROWSER_ADDRESS);
  await expect(picker).toHaveCount(0);
  const state = await snapshot(page);
  expect(state.browserCalls.filter(call => call.method === 'eth_requestAccounts')).toHaveLength(1);
  expect(state.decoyCalls).toEqual([]);
  expect(state.wagmiConnections).toEqual([{ status: 'connected', accounts: [BROWSER_ADDRESS], connectorId: 'okx' }]);
  expect(state.errors).toEqual([]);
});

for (const wallet of WALLET_CATALOG) {
  test(`${wallet.name}: distinct announced providers stay ambiguous before any account request`, async ({ page }) => {
    await page.goto(`${origin}/?mode=web&wallet=${wallet.id}`);
    await expect(owner(page)).toHaveAttribute('data-ready', 'true');
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    const picker = page.getByRole('dialog');
    await page.evaluate(({ rdns, name }) => {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
        info: { rdns, name, uuid: '00000000-0000-4000-8000-000000000002', icon: 'data:image/svg+xml,<svg/>' },
        provider: { request: async () => { throw new Error('An ambiguous competitor must never receive an RPC.'); } },
      } }));
    }, wallet);
    if (!wallet.primary) await picker.getByRole('button', { name: 'Other wallets', exact: true }).click();
    await picker.getByRole('button', { name: wallet.name, exact: true }).click();
    await expect(picker.getByRole('alert')).toContainText('Multiple wallets report the same identity.');
    expect(await snapshot(page)).toMatchObject({ configCreates: 0, connectorCreates: 0, browserCalls: [], decoyCalls: [] });
    await expect(owner(page)).toHaveAttribute('data-authenticated', 'false');
  });

  test(`${wallet.name}: explicit rejection can retry its exact announced provider without using another wallet`, async ({ page }) => {
    await page.goto(`${origin}/?mode=web&wallet=${wallet.id}&rejectFirst=1`);
    await expect(owner(page)).toHaveAttribute('data-ready', 'true');
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    const picker = page.getByRole('dialog');
    if (!wallet.primary) await picker.getByRole('button', { name: 'Other wallets', exact: true }).click();
    expect(await snapshot(page)).toMatchObject({ configCreates: 0, connectorCreates: 0, browserCalls: [], decoyCalls: [] });
    await picker.getByRole('button', { name: wallet.name, exact: true }).click();
    await expect(picker.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    await expect(owner(page)).toHaveAttribute('data-authenticated', 'false');
    expect((await snapshot(page)).browserCalls.filter(call => call.method === 'eth_requestAccounts')).toHaveLength(1);
    await picker.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(owner(page)).toHaveAttribute('data-address', BROWSER_ADDRESS);
    await expect(picker).toHaveCount(0);
    const state = await snapshot(page);
    expect(state.browserCalls.filter(call => call.method === 'eth_requestAccounts')).toHaveLength(2);
    expect(state.wagmiConnections.at(-1)).toEqual({ status: 'connected', accounts: [BROWSER_ADDRESS], connectorId: wallet.id });
    expect(state.decoyCalls).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test('ordinary web connects the exact injected object through the actual picker and Wagmi without loading Privy', async ({ page }) => {
  const observation = await open(page, 'web');
  await selectExactFake(page);
  const identity = await owner(page).getAttribute('data-identity');
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(owner(page)).toHaveAttribute('data-address', BROWSER_ADDRESS);
  await expect(owner(page)).toHaveAttribute('data-identity', identity!);
  await expectNoPrivy(page, observation);
});

test('late Telegram launch hints cannot replace a connected real Wagmi browser owner', async ({ page }) => {
  const observation = await open(page, 'late-host');
  await selectExactFake(page);
  const identity = await owner(page).getAttribute('data-identity');
  await page.getByRole('button', { name: 'Add Telegram launch hints', exact: true }).click();
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(owner(page)).toHaveAttribute('data-identity', identity!);
  await expect(owner(page)).toHaveAttribute('data-provider-mode', 'browser');
  await expect(owner(page)).toHaveAttribute('data-address', BROWSER_ADDRESS);
  expect(await snapshot(page)).toMatchObject({ configCreates: 1, connectorCreates: 1, childMounts: 1, childUnmounts: 0, routeMounts: 1, routeUnmounts: 0 });
  await expectNoPrivy(page, observation);
});

test('a pending Telegram host keeps browser discovery and Wagmi inert until the delayed launch bridge selects Privy', async ({ page }) => {
  const observation = await open(page, 'bridge-wait');
  await expect(page.locator('[data-provider-wait="true"]')).toBeVisible();
  expect(await snapshot(page)).toMatchObject({ configCreates: 0, connectorCreates: 0, discoveryRequests: 0, browserCalls: [], decoyCalls: [], privyModuleLoads: 0 });
  await page.getByRole('button', { name: 'Add Telegram launch hints', exact: true }).click();
  await expectFundedPrivyOwner(page);
  expect(observation.errors).toEqual([]);
});
