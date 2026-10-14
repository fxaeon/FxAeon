import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ExternalWalletDialog, type WalletDialogAttempt } from '../src/components/ExternalWalletDialog';
import type { DiscoveredEip6963Provider, Eip6963Provider } from '../src/lib/wallet/eip6963';
import { buildWalletChoices, WALLET_CATALOG } from '../src/lib/wallet/walletCatalog';

const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
after(() => {
  if (previousReact) globalReact.React = previousReact;
  else Reflect.deleteProperty(globalThis, 'React');
});

const unexpected = () => { throw new Error('Rendering a picker must not navigate, select or request accounts'); };
const router: AppRouterInstance = { bfcacheId: 'wallet-picker-test', back: unexpected, forward: unexpected, refresh: unexpected, push: unexpected, replace: unexpected, prefetch: unexpected };
const provider = (): Eip6963Provider => ({ request: async () => unexpected() });
function render(providers: readonly DiscoveredEip6963Provider[] = [], legacy?: Eip6963Provider, pending?: WalletDialogAttempt) {
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router },
    React.createElement(ExternalWalletDialog, {
      choices: buildWalletChoices(providers, legacy), pending,
      onChoose: unexpected, onBack: unexpected, onCancel: unexpected,
    })));
}

for (const state of ['none', 'all installed', 'secondary and unknown installed'] as const) {
  test(`initial picker promotes detected wallets with ${state}`, () => {
    const providers: DiscoveredEip6963Provider[] = state === 'none' ? []
      : state === 'all installed' ? WALLET_CATALOG.map((wallet) => ({ rdns: wallet.rdns, name: wallet.name, provider: provider() }))
        : [
          { rdns: 'com.trustwallet.app', name: 'Trust Wallet', provider: provider() },
          { rdns: 'app.phantom', name: 'Phantom', provider: provider() },
          { rdns: 'test.unknown', name: 'Coinbase Wallet', provider: provider() },
        ];
    const html = render(providers);
    const expectedIds = state === 'none' ? ['metamask', 'coinbase', 'okx', 'rabby']
      : state === 'all installed' ? WALLET_CATALOG.map(wallet => wallet.id)
      : ['trust', 'phantom', 'injected:test.unknown', 'metamask', 'coinbase', 'okx', 'rabby'];
    assert.deepEqual([...html.matchAll(/data-wallet-id="([^"]+)"/g)].map((match) => match[1]), expectedIds);
    assert.equal((html.match(/<img /g) ?? []).length, state === 'all installed' ? 8 : state === 'none' ? 4 : 6);
    assert.match(html, /src="\/wallets\/base\.svg"/);
    assert.doesNotMatch(html, /src="\/wallets\/coinbase\.svg"/);
    assert.match(html, /role="dialog"[^>]+aria-modal="true"/);
    assert.match(html, /aria-label="Close wallet selection"/);
    assert.doesNotMatch(html, /Coinbase Wallet/);
  });
}

test('the stable coinbase selection presents the requested Base Wallet label in its handoff', () => {
  const html = render([], undefined, { walletId: 'coinbase', name: 'Base Wallet', status: 'handoff', message: 'Opening Base Wallet’s official app page.' });
  assert.match(html, /<h2[^>]*>Base Wallet<\/h2>/);
  assert.match(html, /data-wallet-view="handoff"/);
  assert.match(html, /Open Base Wallet<\/button>/);
  assert.doesNotMatch(html, /Coinbase Wallet|Wallet connected|passkey/i);
});

test('Detected marks unique providers and ambiguity never earns a badge or promotion', () => {
  const unique = render([{ rdns: 'io.metamask', name: 'MetaMask', provider: provider() }]);
  assert.equal((unique.match(/class="wallet-provider-detected"/g) ?? []).length, 1);
  assert.match(unique, /aria-label="MetaMask"/);
  assert.match(unique, /Detected/);
  const ambiguous = render([
    { rdns: 'io.metamask', name: 'MetaMask', provider: provider() },
    { rdns: 'io.metamask', name: 'MetaMask', provider: provider() },
  ]);
  assert.doesNotMatch(ambiguous, /wallet-provider-detected/);
  assert.match(render([], provider()), /wallet-provider-detected/);
  const secondaryAmbiguous = render([
    { rdns: 'com.trustwallet.app', name: 'Trust Wallet', provider: provider() },
    { rdns: 'com.trustwallet.app', name: 'Trust Wallet', provider: provider() },
  ]);
  assert.doesNotMatch(secondaryAmbiguous, /data-wallet-id="trust"|wallet-provider-detected/);
});

test('unique unknown and legacy providers appear first without catalog branding', () => {
  const html = render([{ rdns: 'org.example.testwallet', name: 'Test wallet', provider: provider() }], provider());
  assert.deepEqual([...html.matchAll(/data-wallet-id="([^"]+)"/g)].map(match => match[1]),
    ['injected:org.example.testwallet', 'legacy:browser', 'metamask', 'coinbase', 'okx', 'rabby']);
  assert.equal((html.match(/class="wallet-provider-detected"/g) ?? []).length, 2);
  assert.equal((html.match(/<img /g) ?? []).length, 4, 'unknown identities keep the neutral mark');
});

test('handoff recovery is an optional disclosure and preserves retry, copy, install and guide controls', () => {
  const html = render([], undefined, { walletId: 'metamask', name: 'MetaMask', status: 'handoff',
    dappHref: 'https://fxaeon.xyz/move', fallbackHref: 'https://metamask.io/download', guideHref: 'https://metamask.io/help' });
  assert.match(html, /Open MetaMask<\/button>/);
  assert.match(html, /<details class="wallet-provider-recovery"><summary>Connection help<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.match(html, /Copy FxAeon link/);
  assert.match(html, /Install MetaMask/);
  assert.match(html, /Wallet guide/);
});
