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
const router: AppRouterInstance = { back: unexpected, forward: unexpected, refresh: unexpected, push: unexpected, replace: unexpected, prefetch: unexpected };
const provider = (): Eip6963Provider => ({ request: async () => unexpected() });
function render(providers: readonly DiscoveredEip6963Provider[] = [], legacy?: Eip6963Provider, pending?: WalletDialogAttempt) {
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router },
    React.createElement(ExternalWalletDialog, {
      choices: buildWalletChoices(providers, legacy), pending,
      onChoose: unexpected, onBack: unexpected, onCancel: unexpected,
    })));
}

for (const state of ['none', 'all installed', 'secondary and unknown installed'] as const) {
  test(`initial picker renders exactly the same four brands with ${state}`, () => {
    const providers: DiscoveredEip6963Provider[] = state === 'none' ? []
      : state === 'all installed' ? WALLET_CATALOG.map((wallet) => ({ rdns: wallet.rdns, name: wallet.name, provider: provider() }))
        : [
          { rdns: 'com.trustwallet.app', name: 'Trust Wallet', provider: provider() },
          { rdns: 'app.phantom', name: 'Phantom', provider: provider() },
          { rdns: 'test.unknown', name: 'Coinbase Wallet', provider: provider() },
        ];
    const html = render(providers, state === 'none' ? undefined : provider());
    assert.deepEqual([...html.matchAll(/data-wallet-id="([^"]+)"/g)].map((match) => match[1]), ['metamask', 'coinbase', 'okx', 'rabby']);
    assert.deepEqual([...html.matchAll(/class="wallet-provider-option-name">([^<]+)<\/span>/g)].map((match) => match[1]), ['MetaMask', 'Base Wallet', 'OKX', 'Rabby', 'Other wallets']);
    assert.equal((html.match(/<img /g) ?? []).length, 4);
    assert.match(html, /src="\/wallets\/base\.svg"/);
    assert.doesNotMatch(html, /src="\/wallets\/coinbase\.svg"/);
    assert.match(html, /role="dialog"[^>]+aria-modal="true"/);
    assert.match(html, /aria-label="Close wallet selection"/);
    assert.doesNotMatch(html, /Trust Wallet|Phantom|Coinbase Wallet|Wallet 1|Test wallet/);
  });
}

test('the stable coinbase selection presents the requested Base Wallet label in its handoff', () => {
  const html = render([], undefined, { walletId: 'coinbase', name: 'Base Wallet', status: 'handoff', message: 'Opening Base Wallet’s official app page.' });
  assert.match(html, /<h2[^>]*>Base Wallet<\/h2>/);
  assert.match(html, /data-wallet-view="handoff"/);
  assert.match(html, /Open Base Wallet<\/button>/);
  assert.doesNotMatch(html, /Coinbase Wallet|Wallet connected|passkey/i);
});
