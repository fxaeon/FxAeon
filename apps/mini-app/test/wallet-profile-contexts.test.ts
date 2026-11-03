import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useQueryClient } from '@tanstack/react-query';
import ts from 'typescript';
import { PriceContext, useUsdPrices, type PriceContextValue } from '../src/components/PriceContext';
import { ProtocolPositionContext, useProtocolPositions, type ProtocolPositionContextValue } from '../src/components/ProtocolPositionContext';
import { WalletAssetsContext, WalletDataSession, useWalletAssets, type WalletAssetsHookResult } from '../src/components/WalletDataContext';
import { FxWalletContext } from '../src/lib/wallet/context';
import type { FxPrivyWallet } from '../src/lib/wallet/types';

const require = createRequire(import.meta.url);
const walletAddress = `0x${'1'.repeat(40)}`;
const otherAddress = `0x${'2'.repeat(40)}`;

function observe<T>(hook: () => T, wrap: (child: React.ReactNode) => React.ReactNode = child => child): T {
  let observed!: T;
  function Probe() { observed = hook(); return null; }
  renderToStaticMarkup(wrap(React.createElement(Probe)));
  return observed;
}

test('price consumers retain the shared loading default and see the exact provided snapshot', async () => {
  const initial = observe(useUsdPrices);
  assert.strictEqual(observe(useUsdPrices), initial);
  assert.deepEqual(initial.prices, {});
  assert.equal(initial.status, 'loading');
  assert.equal(initial.updatedAt, null);
  assert.equal(initial.refreshing, false);
  assert.equal(await initial.refresh(), undefined);
  const snapshot: PriceContextValue = { prices: { ETH: 100 }, status: 'ready', updatedAt: 1,
    refreshing: true, refresh: async () => undefined };
  assert.strictEqual(observe(useUsdPrices, child => React.createElement(PriceContext.Provider, { value: snapshot }, child)), snapshot);
});

test('position consumers retain the missing-provider guard and share the provided refresh functions', () => {
  assert.throws(() => observe(useProtocolPositions), /useProtocolPositions must be used inside ProtocolPositionProvider/);
  const snapshot: ProtocolPositionContextValue = {
    walletAddress: null, positions: [], status: 'idle', failedGroups: [], lastVerifiedAt: null,
    refreshing: false, verifiedGroups: [], pendingPositions: [], checkingConfirmedPositions: false,
    refresh: async () => ({ positions: [], successfulGroups: [], failedGroups: [], status: 'unavailable', newPositions: [] }),
    refreshConfirmedPositions: async () => undefined, trackConfirmedPosition: async () => false,
    reconcileClosedPosition: async () => false,
  };
  assert.strictEqual(observe(useProtocolPositions, child => React.createElement(ProtocolPositionContext.Provider, { value: snapshot }, child)), snapshot);
});

test('asset consumers preserve disabled, disconnected and changed-account masking', async () => {
  const result: WalletAssetsHookResult = { data: null, status: 'unavailable', isFetching: false,
    error: 'unavailable', refresh: async () => undefined };
  const wrap = (session: string) => (child: React.ReactNode) => React.createElement(WalletDataSession.Provider,
    { value: session }, React.createElement(WalletAssetsContext.Provider, { value: result }, child));
  assert.strictEqual(observe(() => useWalletAssets({ address: walletAddress }), wrap(`${walletAddress}:1`)), result);
  for (const [session, address, enabled] of [
    ['disconnected', walletAddress, true], [`${otherAddress}:1`, walletAddress, true],
    [`${walletAddress}:1`, walletAddress, false], [`${walletAddress}:1`, undefined, true],
  ] as const) {
    const masked = observe(() => useWalletAssets({ address, enabled }), wrap(session));
    assert.deepEqual({ ...masked, refresh: undefined }, { data: null, status: 'idle', isFetching: false, error: '', refresh: undefined });
    assert.equal(await masked.refresh(), undefined);
  }
});

// The implementations still support old consumers. A single set of contexts
// must serve those consumers and the new lightweight WalletProfile imports.
function implementations() {
  const previousCss = require.extensions['.css'];
  require.extensions['.css'] = module => { module.exports = {}; };
  try {
    return {
      prices: require('../src/components/PriceProvider') as typeof import('../src/components/PriceProvider'),
      positions: require('../src/components/ProtocolPositionProvider') as typeof import('../src/components/ProtocolPositionProvider'),
      data: require('../src/components/WalletDataProvider') as typeof import('../src/components/WalletDataProvider'),
      queries: require('../src/components/WalletDataHooks') as typeof import('../src/components/WalletDataHooks'),
    };
  } finally {
    if (previousCss) require.extensions['.css'] = previousCss;
    else delete require.extensions['.css'];
  }
}

test('legacy provider exports are the same hook functions, with no duplicate context singleton', () => {
  const { prices, positions, data, queries } = implementations();
  assert.strictEqual(prices.useUsdPrices, useUsdPrices);
  assert.strictEqual(positions.useProtocolPositions, useProtocolPositions);
  assert.strictEqual(data.useWalletAssets, useWalletAssets);
  assert.strictEqual(data.useWalletBalances, queries.useWalletBalances);
  assert.strictEqual(data.useFxSaveClaimable, queries.useFxSaveClaimable);
});

test('the existing provider tree publishes to the extracted contexts without disconnected reads', () => {
  const { prices, positions, data } = implementations();
  const wallet: FxPrivyWallet = {
    ready: true, authenticated: false, connectionVersion: 0, wallets: [], isEmbedded: false,
    connect: async () => { throw new Error('Unexpected connection'); }, disconnect: async () => undefined,
    selectWallet: () => undefined, switchChain: async () => undefined,
    sendTransaction: async () => { throw new Error('Unexpected transaction'); },
  };
  const previousFetch = globalThis.fetch;
  const previousReact = (globalThis as { React?: typeof React }).React;
  let queryClient: ReturnType<typeof useQueryClient> | undefined;
  globalThis.fetch = async () => { throw new Error('Unexpected disconnected network read'); };
  (globalThis as { React?: typeof React }).React = React;
  try {
    const state = observe(() => {
      queryClient = useQueryClient();
      return { price: useUsdPrices(), position: useProtocolPositions(),
        assets: useWalletAssets(), balances: data.useWalletBalances({ enabled: false }),
        claimable: data.useFxSaveClaimable({ enabled: false }) };
    }, child =>
      React.createElement(FxWalletContext.Provider, { value: wallet,
        children: React.createElement(prices.default, {
          children: React.createElement(data.default, { enabled: false,
            children: React.createElement(positions.default, { enabled: false, children: child }),
          }),
        }),
      }));
    assert.equal(state.price.status, 'loading');
    assert.equal(state.position.status, 'idle');
    assert.equal(state.position.walletAddress, null);
    assert.equal(state.assets.status, 'idle');
    assert.equal(state.balances.status, 'idle');
    assert.equal(state.claimable.status, 'idle');
  } finally {
    queryClient?.clear();
    globalThis.fetch = previousFetch;
    (globalThis as { React?: typeof React }).React = previousReact;
  }
});

test('context entrypoints compile to React-only runtime imports', () => {
  for (const name of ['PriceContext', 'ProtocolPositionContext', 'WalletDataContext']) {
    const source = readFileSync(new URL(`../src/components/${name}.ts`, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
    const dependencies = [...outputText.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]);
    assert.deepEqual(dependencies, ['react'], `${name} must not import fetching, wallet or SDK implementations at runtime`);
  }
});
