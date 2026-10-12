import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const entry = resolve(root, 'apps/mini-app/e2e/harness/privy-send-adapter-entry.tsx');
const src = resolve(root, 'apps/mini-app/src');

const mockModules: Record<string, string> = {
  '@privy-io/react-auth': `
    import { useState } from 'react';
    export function usePrivy() { const [, redraw] = useState(0); const h = globalThis.__privySendHarness; h.adapterRerender = () => redraw((n) => n + 1); return { ready: h.ready, authenticated: h.authenticated, user: h.authenticated ? { id: h.userId } : null }; }
    export function useWallets() { const [, redraw] = useState(0); const h = globalThis.__privySendHarness; h.adapterRerender = () => redraw((n) => n + 1); return { ready: true, wallets: h.wallets }; }
    export function useModalStatus() { const [, redraw] = useState(0); const h = globalThis.__privySendHarness; h.modalRerender = () => redraw((n) => n + 1); return { isOpen: h.modalOpen }; }
    export function useSendTransaction() { const h = globalThis.__privySendHarness; return { sendTransaction: async (request, options) => {
      h.requests.push({ request, options });
      await h.gate('dispatch');
      if (h.sendError) throw new Error(h.sendError);
      h.modalOpen = true;
      h.modalRerender?.();
      h.rerender?.();
      return { hash: '0x' + 'a'.repeat(64) };
    } }; }
    export function useLogout() { const h = globalThis.__privySendHarness; return { logout: async () => { h.authenticated = false; h.wallets = []; h.adapterRerender?.(); h.rerender?.(); } }; }
    export function useLogin() { return { login: () => {} }; }
    export function useConnectWallet() { return { connectWallet: () => {} }; }
  `,
  '@/lib/telegram': `export const getInitData = () => ''; export const isTelegramLaunchContext = () => false;`,
  '@/lib/wallet/telegramReconnect': `export const useTelegramReconnect = () => () => {};`,
  '@/lib/fx/config': `export const assertLocalForkRpcUrl = (url) => url; export const configuredRpcUrls = () => ['https://eth-mainnet.g.alchemy.com/v2/harness'];`,
  './switchBrowserChain': `export const switchBrowserChain = async () => {};`,
  './eip6963': `
    export const eip6963FocusTrapDestination = () => null;
    export const getDiscoveredEip6963Providers = () => [];
    export const recordEip6963Announcement = () => false;
    export const selectEip6963Provider = () => undefined;
    export const shouldBindEip6963ProviderEvents = () => false;
    export const shouldPromptEip6963Provider = () => false;
    export const waitForWalletProvider = async () => undefined;
  `,
};

async function buildHarness(): Promise<string> {
  type Build = {
    onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void;
    onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void;
  };
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
    jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: root,
    plugins: [{
      name: 'privy-send-adapter-mocks',
      setup(build: Build) {
        build.onResolve({ filter: /^@privy-io\/react-auth$/ }, () => ({ path: '@privy-io/react-auth', namespace: 'mock' }));
        build.onResolve({ filter: /^@\// }, (args: { path: string }) => {
          if (mockModules[args.path]) return { path: args.path, namespace: 'mock' };
          const candidate = resolve(src, args.path.slice(2));
          for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
          for (const index of ['index.tsx', 'index.ts']) if (existsSync(resolve(candidate, index))) return { path: resolve(candidate, index) };
          return { path: candidate };
        });
        build.onResolve({ filter: /^\.\// }, (args: { path: string }) => mockModules[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
        build.onLoad({ filter: /.*/, namespace: 'mock' }, (args: { path: string }) => ({ contents: mockModules[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

let bundle = '';
const first = '0x00000000000000000000000000000000000000aa';
const second = '0x00000000000000000000000000000000000000bb';
const hash = `0x${'a'.repeat(64)}`;

async function openHarness(page: import('@playwright/test').Page, embedded = true) {
  await page.setContent('<div id="root"></div>');
  await page.evaluate((embedded) => {
    (globalThis as any).__privySendHarness = {
      ready: true,
      authenticated: true,
      userId: 'user-a',
      wallets: [],
      requests: [],
      providerChain: undefined,
      externalChain: '0x1',
      targetChain: 1,
      switchRequests: [],
      providerReads: [],
      providerAcquisitions: [],
      providerCounter: 0,
      blockedAt: null,
      holdUsed: false,
      providerAccounts: [],
      requestFrom: undefined,
      embedded,
      providerRequests: [],
      fees: undefined,
      modalOpen: false,
      result: 'idle',
      sendError: undefined,
    };
  }, embedded);
  await page.evaluate((code) => (0, eval)(code), bundle);
  await expect(page.locator('[data-ready="true"]')).toHaveCount(1);
  await page.evaluate(({ firstAddress, secondAddress }) => {
    const h = (globalThis as any).__privySendHarness;
    h.gate = async (stage: string) => {
      if (h.holdAt !== stage || h.holdUsed) return;
      h.holdUsed = true;
      h.blockedAt = stage;
      h.rerender?.();
      await new Promise<void>((resolve) => { h.releaseHold = () => { h.blockedAt = null; resolve(); }; });
    };
    const makeWallet = (address: string, chainId = 1): any => {
      const providerId = ++h.providerCounter;
      const boundChain = `0x${chainId.toString(16)}`;
      const listeners = new Map<string, Set<(...values: unknown[]) => void>>();
      const provider = {
        request: async (args: { method: string; params?: unknown[] }) => {
          if (args.method === 'eth_sendTransaction') {
            h.providerRequests.push(args);
            await h.gate('dispatch');
            if (h.sendError) throw new Error(h.sendError);
            return '0x' + 'a'.repeat(64);
          }
          h.providerReads.push({ id: providerId, method: args.method, address, boundChain: h.embedded ? boundChain : h.externalChain });
          await h.gate(args.method);
          if (args.method === 'eth_chainId') return h.providerChain ?? (h.embedded ? boundChain : h.externalChain);
          if (args.method === 'eth_accounts') return h.providerAccounts;
          throw new Error(`Unexpected provider call: ${args.method}`);
        },
        on(event: string, listener: (...values: unknown[]) => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
        removeListener(event: string, listener: (...values: unknown[]) => void) { listeners.get(event)?.delete(listener); },
      };
      return {
        address, type: 'ethereum', walletClientType: h.embedded ? 'privy-v2' : 'metamask', chainId: `eip155:${chainId}`,
        getEthereumProvider: async () => {
          h.providerAcquisitions.push(providerId);
          await h.gate('getEthereumProvider');
          return provider;
        },
        switchChain: async (next: number) => {
          h.switchRequests.push(next);
          await h.gate('switchChain');
          h.externalChain = `0x${next.toString(16)}`;
          // Privy's old embedded object is bound to its old chain. The SDK
          // publishes a replacement object before a fresh provider is valid.
          h.wallets = h.wallets.map((wallet: { address: string }) => wallet.address !== address ? wallet
            : h.embedded ? makeWallet(address, next) : { ...wallet, chainId: `eip155:${next}` });
          h.adapterRerender?.();
          h.rerender?.();
        },
      };
    };
    h.wallets = [makeWallet(firstAddress), makeWallet(secondAddress)];
    h.providerAccounts = [firstAddress];
    h.adapterRerender?.();
    h.rerender?.();
  }, { firstAddress: first, secondAddress: second });
  if (!embedded) {
    await expect(page.locator('main')).toHaveAttribute('data-address', '');
    await page.getByRole('button', { name: 'Select first wallet', exact: true }).click();
  }
  await expect(page.locator('main')).toHaveAttribute('data-address', first);
}

async function send(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await expect.poll(() => page.locator('main').getAttribute('data-result')).not.toBe('pending');
}

async function closeModal(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Close Privy success screen' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-modal-open', 'false');
}

type HoldStage = 'getEthereumProvider' | 'eth_chainId' | 'eth_accounts' | 'switchChain' | 'dispatch';
type Retirement = 'logout' | 'user replacement' | 'unmount' | 'same-account reselection';

async function hold(page: import('@playwright/test').Page, stage: HoldStage) {
  await page.evaluate((next) => {
    const h = globalThis.__privySendHarness;
    h.holdAt = next; h.holdUsed = false; h.blockedAt = null;
    if (next === 'switchChain') h.targetChain = 8453;
  }, stage);
}
async function waitHeld(page: import('@playwright/test').Page, stage: HoldStage) {
  await expect.poll(() => page.evaluate(() => globalThis.__privySendHarness.blockedAt)).toBe(stage);
}
async function retire(page: import('@playwright/test').Page, how: Retirement) {
  if (how === 'logout') {
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-authenticated', 'false');
  } else if (how === 'same-account reselection') {
    const previous = await page.locator('main').getAttribute('data-connection-version');
    await page.getByRole('button', { name: 'Select first wallet', exact: true }).click();
    await expect(page.locator('main')).not.toHaveAttribute('data-connection-version', previous!);
  } else if (how === 'user replacement') {
    await page.evaluate(() => {
      const h = globalThis.__privySendHarness;
      h.userId = 'user-b'; h.adapterRerender?.(); h.rerender?.();
    });
    await expect(page.locator('main')).toHaveAttribute('data-user-id', 'user-b');
  } else {
    await page.evaluate(() => globalThis.__privySendHarness.unmount());
    await expect(page.locator('main')).toHaveCount(0);
  }
}
async function release(page: import('@playwright/test').Page) {
  await page.evaluate(() => globalThis.__privySendHarness.releaseHold?.());
}
async function dispatchCounts(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({ embedded: globalThis.__privySendHarness.requests.length, external: globalThis.__privySendHarness.providerRequests.length }));
}

test.describe('real FxAeon Privy send adapter with mocked Privy hooks', () => {
  test.beforeAll(async () => { bundle = await buildHarness(); });

  test('routes a fully populated request to the selected embedded wallet and preserves each step prompt', async ({ page }) => {
    await openHarness(page);
    await page.evaluate((from) => { (globalThis as any).__privySendHarness.requestFrom = from; }, first.toUpperCase().replace('0X', '0x'));
    await page.getByRole('button', { name: 'Select second wallet' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-address', second);
    await page.evaluate((from) => {
      const h = (globalThis as any).__privySendHarness;
      h.requestFrom = from;
      h.providerAccounts = [from];
    }, second);

    await send(page, 'Send approval');
    await expect(page.locator('main')).toHaveAttribute('data-result', hash);
    await closeModal(page);
    await send(page, 'Send action');

    const requests = await page.evaluate(() => (globalThis as any).__privySendHarness.requests);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual({
      request: {
        from: second,
        to: '0x00000000000000000000000000000000000000dd',
        data: '0x12345678', value: 7n, nonce: 8n, gasLimit: 21000n,
        gasPrice: 9n, maxFeePerGas: 10n, maxPriorityFeePerGas: 2n, chainId: 1,
      },
      options: {
        address: second,
        uiOptions: {
          showWalletUIs: true,
          description: 'Review this f(x) transaction in your wallet.',
          buttonText: 'Approve token',
          successHeader: 'Transaction submitted',
          successDescription: 'Your transaction is now being confirmed on-chain.',
          isCancellable: true,
          transactionInfo: { action: 'Token approval' },
        },
      },
    });
    expect(requests[1].options.uiOptions.showWalletUIs).toBe(true);
    expect(requests[1].options.uiOptions.buttonText).toBe('Confirm transaction');
    expect(requests[1].options.uiOptions.transactionInfo).toEqual({ action: 'Protocol action' });
    expect(await page.locator('main').getAttribute('data-result')).toBe(hash);
  });

  test('forwards the selected Standard, Fast, and Rapid fee caps on every embedded approval and action', async ({ page }) => {
    await openHarness(page);
    const tiers = [
      { gasPrice: 9n, maxFeePerGas: 10n, maxPriorityFeePerGas: 2n },
      { gasPrice: 11n, maxFeePerGas: 14n, maxPriorityFeePerGas: 3n },
      { gasPrice: 15n, maxFeePerGas: 20n, maxPriorityFeePerGas: 5n },
    ];
    for (const tier of tiers) {
      await page.evaluate((fees) => { (globalThis as any).__privySendHarness.fees = fees; }, tier);
      await send(page, 'Send approval');
      await closeModal(page);
      await send(page, 'Send action');
      await closeModal(page);
    }
    const requests = await page.evaluate(() => (globalThis as any).__privySendHarness.requests);
    expect(requests).toHaveLength(6);
    for (let index = 0; index < tiers.length; index += 1) {
      for (const request of requests.slice(index * 2, index * 2 + 2)) {
        expect(request.request).toMatchObject(tiers[index]);
        expect(request.options.uiOptions.showWalletUIs).toBe(true);
      }
    }
  });

  test('returns the approval hash immediately but waits for its open Privy screen before the action prompt', async ({ page }) => {
    await openHarness(page);
    await send(page, 'Send approval');
    await expect(page.locator('main')).toHaveAttribute('data-result', hash);
    await expect(page.locator('main')).toHaveAttribute('data-modal-open', 'true');

    await page.getByRole('button', { name: 'Send action', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', 'pending');
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(1);

    await closeModal(page);
    await expect.poll(async () => page.evaluate(() => (globalThis as any).__privySendHarness.requests.length)).toBe(2);
    await expect(page.locator('main')).toHaveAttribute('data-result', hash);
  });

  test('aborts the queued action if the selected wallet changes while waiting for modal close', async ({ page }) => {
    await openHarness(page);
    await send(page, 'Send approval');
    await page.getByRole('button', { name: 'Send action', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', 'pending');
    await page.getByRole('button', { name: 'Select second wallet' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', /wallet or session changed/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(1);
  });

  test('fails closed when an embedded send bypasses the runner preflight', async ({ page }) => {
    await openHarness(page);
    await send(page, 'Send approval');
    await page.getByRole('button', { name: 'Send action without preflight' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', /close the Privy transaction screen and retry/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(1);
  });

  test('aborts the queued action if the authenticated Privy session changes while waiting', async ({ page }) => {
    await openHarness(page);
    await send(page, 'Send approval');
    await page.getByRole('button', { name: 'Send action', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', 'pending');
    await page.evaluate(() => {
      const h = (globalThis as any).__privySendHarness;
      h.authenticated = false;
      h.userId = 'user-b';
      h.adapterRerender?.();
    });
    await expect(page.locator('main')).toHaveAttribute('data-result', /wallet or session changed/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(1);
  });

  test('aborts the queued action on unmount while preserving the prior approval hash', async ({ page }) => {
    await openHarness(page);
    await send(page, 'Send approval');
    await page.getByRole('button', { name: 'Send action', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', 'pending');
    await page.evaluate(() => (globalThis as any).__privySendHarness.unmount());
    await expect.poll(async () => page.evaluate(() => (globalThis as any).__privySendHarness.result)).toMatch(/wallet session ended/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(1);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.previousResult)).toBe(hash);
  });

  test('times out with recovery guidance, then allows a fresh send after closing the screen', async ({ page }) => {
    await page.clock.install();
    await openHarness(page);
    await send(page, 'Send approval');
    await page.getByRole('button', { name: 'Send action', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', 'pending');
    await page.clock.fastForward(60_001);
    await expect(page.locator('main')).toHaveAttribute('data-result', /close the Privy transaction screen/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(1);

    await closeModal(page);
    await send(page, 'Send action');
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(2);
  });

  test('lets an external wallet price the transaction and preserves its other fields', async ({ page }) => {
    await openHarness(page, false);
    await page.evaluate((from) => { (globalThis as any).__privySendHarness.requestFrom = from; }, first);
    await send(page, 'Send approval');
    const captured = await page.evaluate(() => (globalThis as any).__privySendHarness.providerRequests);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      method: 'eth_sendTransaction',
      params: [{
        from: first,
        to: '0x00000000000000000000000000000000000000dd',
        data: '0x12345678',
        value: '0x7',
        nonce: '0x8',
        gas: '0x5208',
      }],
    });
    expect(captured[0].params[0]).not.toHaveProperty('gasPrice');
    expect(captured[0].params[0]).not.toHaveProperty('maxFeePerGas');
    expect(captured[0].params[0]).not.toHaveProperty('maxPriorityFeePerGas');
  });

  test('refuses to prompt if the provider chain changes before signing', async ({ page }) => {
    await openHarness(page);
    await page.evaluate((chain) => { (globalThis as any).__privySendHarness.providerChain = chain; }, '0x2105');
    await send(page, 'Send approval');
    await expect(page.locator('main')).toHaveAttribute('data-result', /wrong network/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(0);
  });

  test('refuses to prompt if the provider account changes before signing', async ({ page }) => {
    await openHarness(page);
    await page.evaluate((account) => { (globalThis as any).__privySendHarness.providerAccounts = [account]; }, second);
    await page.evaluate((from) => { (globalThis as any).__privySendHarness.requestFrom = from; }, first);
    await send(page, 'Send approval');
    await expect(page.locator('main')).toHaveAttribute('data-result', /account does not match/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(0);
  });

  test('rejects a request authored for an account other than the selected wallet', async ({ page }) => {
    await openHarness(page);
    await page.evaluate((from) => { (globalThis as any).__privySendHarness.requestFrom = from; }, second);
    await send(page, 'Send approval');
    await expect(page.locator('main')).toHaveAttribute('data-result', /sender does not match/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(0);
  });

  for (const embeddedMode of [true, false]) {
    const kind = embeddedMode ? 'embedded' : 'external';
    for (const stage of ['getEthereumProvider', 'eth_chainId', 'eth_accounts', 'switchChain'] as const) {
      for (const retirement of ['logout', 'user replacement', 'unmount'] as const) {
        test(`held ${stage} cannot dispatch after ${retirement} (${kind})`, async ({ page }) => {
          await openHarness(page, embeddedMode);
          await hold(page, stage);
          await page.getByRole('button', { name: 'Send approval', exact: true }).click();
          await waitHeld(page, stage);
          expect(await dispatchCounts(page)).toEqual({ embedded: 0, external: 0 });
          await retire(page, retirement);
          await release(page);
          await expect.poll(() => page.evaluate(() => globalThis.__privySendHarness.result)).toMatch(/^error:.*(?:wallet|session).*changed/i);
          expect(await dispatchCounts(page)).toEqual({ embedded: 0, external: 0 });
        });
      }
    }

    test(`a cached send cannot start synchronously after same-account reselection (${kind})`, async ({ page }) => {
      await openHarness(page, embeddedMode);
      await send(page, 'Send retained callback after reselection');
      await expect(page.locator('main')).toHaveAttribute('data-result', /wallet or session changed/i);
      expect(await dispatchCounts(page)).toEqual({ embedded: 0, external: 0 });
    });

    test(`same-account reselection retires held signing intent (${kind})`, async ({ page }) => {
      await openHarness(page, embeddedMode);
      await hold(page, 'eth_accounts');
      await page.getByRole('button', { name: 'Send approval', exact: true }).click();
      await waitHeld(page, 'eth_accounts');
      await retire(page, 'same-account reselection');
      await release(page);
      await expect.poll(() => page.evaluate(() => globalThis.__privySendHarness.result)).toMatch(/^error:.*(?:wallet|session).*changed/i);
      expect(await dispatchCounts(page)).toEqual({ embedded: 0, external: 0 });
    });

    test(`a harmless SDK object refresh preserves the accepted signing intent (${kind})`, async ({ page }) => {
      await openHarness(page, embeddedMode);
      await hold(page, 'eth_accounts');
      await page.getByRole('button', { name: 'Send approval', exact: true }).click();
      await waitHeld(page, 'eth_accounts');
      await page.evaluate(() => {
        const h = globalThis.__privySendHarness;
        h.wallets = h.wallets.map((wallet: object) => ({ ...wallet }));
        h.adapterRerender?.(); h.rerender?.();
      });
      await release(page);
      await expect(page.locator('main')).toHaveAttribute('data-result', hash);
      expect(await dispatchCounts(page)).toEqual(embeddedMode ? { embedded: 1, external: 0 } : { embedded: 0, external: 1 });
    });

    test(`eventless chain drift during held accounts is caught before dispatch (${kind})`, async ({ page }) => {
      await openHarness(page, embeddedMode);
      await hold(page, 'eth_accounts');
      await page.getByRole('button', { name: 'Send approval', exact: true }).click();
      await waitHeld(page, 'eth_accounts');
      await page.evaluate(() => { globalThis.__privySendHarness.providerChain = '0x2105'; });
      await release(page);
      await expect(page.locator('main')).toHaveAttribute('data-result', /wrong network/i);
      expect(await dispatchCounts(page)).toEqual({ embedded: 0, external: 0 });
    });

    test(`its intended chain switch reacquires the current provider and dispatches once (${kind})`, async ({ page }) => {
      await openHarness(page, embeddedMode);
      await page.evaluate(() => { globalThis.__privySendHarness.targetChain = 8453; });
      await send(page, 'Send action');
      await expect(page.locator('main')).toHaveAttribute('data-result', hash);
      const observed = await page.evaluate(() => {
        const h = globalThis.__privySendHarness;
        return { switches: h.switchRequests, acquisitions: h.providerAcquisitions, reads: h.providerReads };
      });
      expect(observed.switches).toEqual([8453]);
      expect(observed.acquisitions.length).toBeGreaterThanOrEqual(2);
      expect(new Set(observed.acquisitions).size).toBe(embeddedMode ? 2 : 1);
      expect(observed.reads.filter((read: { method: string }) => read.method === 'eth_chainId')).toHaveLength(2);
      expect(observed.reads.every((read: { boundChain: string }) => read.boundChain === '0x2105')).toBe(true);
      expect(await dispatchCounts(page)).toEqual(embeddedMode ? { embedded: 1, external: 0 } : { embedded: 0, external: 1 });
    });

    for (const retirement of ['logout', 'user replacement', 'unmount'] as const) {
      test(`an already-issued hash survives ${retirement} (${kind})`, async ({ page }) => {
        await openHarness(page, embeddedMode);
        await hold(page, 'dispatch');
        await page.getByRole('button', { name: 'Send approval', exact: true }).click();
        await waitHeld(page, 'dispatch');
        const issued = embeddedMode ? { embedded: 1, external: 0 } : { embedded: 0, external: 1 };
        expect(await dispatchCounts(page)).toEqual(issued);
        await retire(page, retirement);
        await release(page);
        await expect.poll(() => page.evaluate(() => globalThis.__privySendHarness.result)).toBe(hash);
        expect(await page.evaluate(() => globalThis.__privySendHarness.previousResult)).toBe(hash);
        expect(await dispatchCounts(page)).toEqual(issued);
      });
    }

    test(`an already-issued provider error survives retirement without redispatch (${kind})`, async ({ page }) => {
      await openHarness(page, embeddedMode);
      await hold(page, 'dispatch');
      await page.evaluate(() => { globalThis.__privySendHarness.sendError = 'Original wallet request rejected'; });
      await page.getByRole('button', { name: 'Send approval', exact: true }).click();
      await waitHeld(page, 'dispatch');
      await retire(page, 'unmount');
      await release(page);
      await expect.poll(() => page.evaluate(() => globalThis.__privySendHarness.result)).toBe('error:Original wallet request rejected');
      expect(await dispatchCounts(page)).toEqual(embeddedMode ? { embedded: 1, external: 0 } : { embedded: 0, external: 1 });
    });
  }

});
