import assert from 'node:assert/strict';
import test from 'node:test';
import type { DiscoveredEip6963Provider, Eip6963Provider } from '../src/lib/wallet/eip6963';
import { buildWalletChoices, WALLET_CATALOG, type WalletChoice } from '../src/lib/wallet/walletCatalog';
import {
  resolveWalletConnectionRoute,
  resolveWalletEnvironment,
  type WalletConnectionRoute,
  type WalletEnvironment,
  type WalletEnvironmentHints,
  type WalletRouteUnavailableReason,
} from '../src/lib/wallet/walletConnectionRoutes';

const provider = (): Eip6963Provider => ({ request: async () => { throw new Error('Resolving must not call a provider'); } });
const announced = (rdns: string, instance = provider(), name = 'Wallet'): DiscoveredEip6963Provider => ({ rdns, provider: instance, name });
const choose = (id: string, providers: readonly DiscoveredEip6963Provider[] = [], legacy?: Eip6963Provider): WalletChoice => {
  const choice = buildWalletChoices(providers, legacy).find((item) => item.id === id);
  assert.ok(choice, `Missing ${id} choice`);
  return choice;
};
const unavailable = (route: WalletConnectionRoute, reason: WalletRouteUnavailableReason) => {
  assert.equal(route.kind, 'unavailable');
  if (route.kind !== 'unavailable') assert.fail('Expected unavailable route');
  assert.equal(route.reason, reason);
  assert.ok(route.message.length > 0 && route.message.length < 140);
  assert.equal('provider' in route, false);
  assert.equal('href' in route, false);
  assert.doesNotMatch(route.message, /https?:|install|download|extension/i);
};
const environments: readonly WalletEnvironment[] = ['desktop', 'mobile', 'unknown'];
const browserIds = ['metamask', 'trust', 'phantom', 'rabby', 'rainbow'] as const;
const officialAppDestinations = {
  metamask: 'https://metamask.io/download',
  trust: 'https://trustwallet.com/download',
  phantom: 'https://phantom.com/download',
  rabby: 'https://rabby.io/',
  coinbase: 'https://wallet.coinbase.com/download',
  rainbow: 'https://rainbow.me/download',
  zerion: 'https://zerion.io/download/',
  okx: 'https://web3.okx.com/download',
} as const;

for (const environment of environments) {
  test(`${environment}: a raw MetaMask Mobile object connects directly without relaunching or borrowing legacy authority`, () => {
    const exact = announced('io.metamask.mobile');
    const providers = [announced('io.rabby'), exact];
    const legacy = Object.assign(provider(), { isMetaMask: true });
    const route = resolveWalletConnectionRoute(choose('metamask', providers), { providers, legacyProvider: legacy, environment });
    assert.deepEqual(route, { kind: 'injected', provider: exact.provider, rdns: 'io.metamask' });
  });

  test(`${environment}: late mobile discovery resolves the already-visible canonical MetaMask row`, () => {
    const initial = choose('metamask');
    const late = announced('io.metamask.mobile');
    assert.deepEqual(resolveWalletConnectionRoute(initial, { providers: [late], environment }), {
      kind: 'injected', provider: late.provider, rdns: 'io.metamask',
    });
    for (const rdns of ['io.rabby', 'io.metamask.mobile.evil.test', 'IO.METAMASK.MOBILE']) {
      assert.deepEqual(resolveWalletConnectionRoute(initial, { providers: [announced(rdns)], environment }),
        resolveWalletConnectionRoute(initial, { providers: [], environment }));
    }
  });

  for (const identities of [['io.metamask', 'io.metamask.mobile'], ['io.metamask.mobile', 'io.metamask']]) {
    test(`${environment}: ${identities.join(' then ')} retains one exact object and rejects replacements`, () => {
      const exact = announced(identities[0]);
      const alias = announced(identities[1], exact.provider);
      const choice = choose('metamask', [exact]);
      for (const providers of [[alias], [exact, alias], [alias, exact]]) {
        assert.deepEqual(resolveWalletConnectionRoute(choice, { providers, environment }), {
          kind: 'injected', provider: exact.provider, rdns: 'io.metamask',
        });
      }
      for (const providers of [[], [announced(identities[1])]]) {
        unavailable(resolveWalletConnectionRoute(choice, { providers, legacyProvider: exact.provider, environment }), 'provider_changed');
      }
      unavailable(resolveWalletConnectionRoute(choice, { providers: [exact, announced(identities[1])], environment }), 'ambiguous_provider');
    });

    test(`${environment}: late legacy ${identities.join(' and ')} claims fail closed across aliases`, () => {
      const legacy = provider();
      const choice = choose('legacy:browser', [], legacy);
      const late = announced(identities[0], legacy);
      assert.deepEqual(resolveWalletConnectionRoute(choice, { providers: [late], legacyProvider: legacy, environment }), {
        kind: 'injected', provider: legacy, rdns: 'io.metamask',
      });
      const competitor = announced(identities[1]);
      for (const providers of [[late, competitor], [competitor, late]]) {
        unavailable(resolveWalletConnectionRoute(choice, { providers, legacyProvider: legacy, environment }), 'ambiguous_provider');
        unavailable(resolveWalletConnectionRoute(choose('metamask', providers), { providers, environment }), 'ambiguous_provider');
      }
    });
  }

  test(`${environment}: exact named provider wins over unrelated legacy and all navigation`, () => {
    const exact = announced('io.metamask');
    const unrelated = announced('io.rabby');
    const legacy = Object.assign(provider(), { isMetaMask: true });
    const providers = [unrelated, exact];
    const route = resolveWalletConnectionRoute(choose('metamask', providers), { providers, legacyProvider: legacy, environment });
    assert.deepEqual(route, { kind: 'injected', provider: exact.provider, rdns: exact.rdns });
  });

  test(`${environment}: absent named provider never borrows another brand or legacy isMetaMask object`, () => {
    const legacy = Object.assign(provider(), { isMetaMask: true });
    for (const wallet of WALLET_CATALOG) {
      const providers = [announced(wallet.rdns === 'io.rabby' ? 'io.metamask' : 'io.rabby')];
      const route = resolveWalletConnectionRoute(choose(wallet.id, providers), { providers, legacyProvider: legacy, environment });
      const expected = resolveWalletConnectionRoute(choose(wallet.id), { providers: [], environment });
      assert.deepEqual(route, expected);
      assert.equal(route.kind, environment === 'desktop' ? 'install'
        : environment === 'mobile' && browserIds.some((id) => id === wallet.id) ? 'browser' : 'download');
      assert.equal('provider' in route, false);
    }
  });

  test(`${environment}: every brand may connect through its exact announced provider`, () => {
    const providers = WALLET_CATALOG.map((wallet) => announced(wallet.rdns));
    for (const choice of buildWalletChoices(providers)) {
      const route = resolveWalletConnectionRoute(choice, { providers, environment });
      assert.deepEqual(route, { kind: 'injected', provider: choice.provider, rdns: choice.rdns });
    }
  });

  test(`${environment}: distinct same-rdns providers fail closed instead of using navigation`, () => {
    for (const rdns of ['io.metamask', 'test.unknown']) {
      const providers = [announced(rdns), announced(rdns)];
      const choice = buildWalletChoices(providers).find((item) => item.rdns === rdns)!;
      unavailable(resolveWalletConnectionRoute(choice, { providers, environment }), 'ambiguous_provider');
    }
  });

  test(`${environment}: a pinned provider cannot be replaced or disappear into a navigation fallback`, () => {
    const exact = announced('io.metamask');
    const choice = choose('metamask', [exact]);
    for (const providers of [[], [announced(exact.rdns)]]) {
      unavailable(resolveWalletConnectionRoute(choice, { providers, legacyProvider: exact.provider, environment }), 'provider_changed');
    }
  });
}

test('desktop absent wallets have only their reviewed official extension destinations', () => {
  const expected = {
    metamask: 'https://metamask.io/download',
    trust: 'https://trustwallet.com/browser-extension',
    phantom: 'https://phantom.com/download',
    rabby: 'https://rabby.io/',
    coinbase: 'https://www.coinbase.com/wallet/downloads',
    rainbow: 'https://rainbow.me/download',
    zerion: 'https://zerion.io/extension',
    okx: 'https://web3.okx.com/download',
  };
  for (const wallet of WALLET_CATALOG) {
    const route = resolveWalletConnectionRoute(choose(wallet.id), { providers: [], environment: 'desktop' });
    assert.equal(route.kind, 'install');
    if (route.kind !== 'install') assert.fail();
    assert.equal(route.href, expected[wallet.id]);
    assert.equal(route.message, `Opening ${wallet.name}’s official download page.`);
    assert.equal('provider' in route, false);
  }
});

test('mobile absent wallets expose verified browser links or official app pages without extension prompts', () => {
  for (const wallet of WALLET_CATALOG) {
    const route = resolveWalletConnectionRoute(choose(wallet.id), { providers: [], environment: 'mobile' });
    if (browserIds.some((id) => id === wallet.id)) {
      assert.equal(route.kind, 'browser');
      if (route.kind !== 'browser') assert.fail();
      assert.equal(route.message, `Opening ${wallet.name}…`);
    } else {
      assert.equal(route.kind, 'download');
      if (route.kind !== 'download') assert.fail();
      assert.equal(route.href, officialAppDestinations[wallet.id]);
      assert.equal(route.message, `Opening ${wallet.name}’s official app page.`);
    }
    assert.equal('provider' in route, false);
    assert.doesNotMatch(route.message, /extension|install|manually|reopen|copy|paste/i);
    assert.doesNotMatch(route.href, /browser-extension|\/extension(?:[/?#]|$)|chromewebstore|addons\.mozilla/i);
  }
});

test('unknown environment uses every brand’s official mobile-safe app page', () => {
  for (const wallet of WALLET_CATALOG) {
    const route = resolveWalletConnectionRoute(choose(wallet.id), { providers: [], environment: 'unknown' });
    assert.equal(route.kind, 'download');
    if (route.kind !== 'download') assert.fail();
    assert.equal(route.href, officialAppDestinations[wallet.id]);
    assert.equal(route.message, `Opening ${wallet.name}’s official app page.`);
    assert.equal('provider' in route, false);
    assert.doesNotMatch(route.href, /browser-extension|\/extension(?:[/?#]|$)|chromewebstore|addons\.mozilla/i);
  }
});

test('Base Wallet and OKX branding does not introduce an unverified mobile launch or SDK route', () => {
  for (const [id, name] of [['coinbase', 'Base Wallet'], ['okx', 'OKX']] as const) {
    const choice = choose(id);
    assert.equal(choice.name, name);
    for (const environment of ['mobile', 'unknown'] as const) {
      const route = resolveWalletConnectionRoute(choice, { providers: [], environment });
      assert.deepEqual(route, {
        kind: 'download',
        href: officialAppDestinations[id],
        message: `Opening ${name}’s official app page.`,
      });
    }
    const exact = announced(choice.rdns!);
    assert.deepEqual(resolveWalletConnectionRoute(choice, { providers: [exact], environment: 'mobile' }), {
      kind: 'injected', provider: exact.provider, rdns: choice.rdns,
    });
  }
});

for (const pathname of ['/', '/earn', '/trade', '/borrow', '/positions', '/move', '/send']) {
  test(`mobile wallet browsers preserve the fixed public ${pathname} path`, () => {
    const expected = {
      metamask: `https://link.metamask.io/dapp/fxaeon.com${pathname}`,
      trust: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(`https://fxaeon.com${pathname}`)}`,
      phantom: `https://phantom.com/ul/browse/${encodeURIComponent(`https://fxaeon.com${pathname}`)}?ref=${encodeURIComponent('https://fxaeon.com')}`,
      rabby: `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(`https://fxaeon.com${pathname}`)}`,
      rainbow: `https://rnbwapp.com/dapp?url=${encodeURIComponent(`https://fxaeon.com${pathname}`)}`,
    };
    for (const id of browserIds) {
      for (const input of [pathname, pathname === '/' ? pathname : `${pathname}/`]) {
        const route = resolveWalletConnectionRoute(choose(id), { providers: [], environment: 'mobile', pathname: input });
        assert.equal(route.kind, 'browser');
        if (route.kind !== 'browser') assert.fail();
        assert.equal(route.href, expected[id]);
      }
    }
  });
}

for (const pathname of ['/unsupported', '/earn?tgWebAppData=private-query', '/send#private-hash', '//evil.test', 'https://evil.test/earn', '/%2f%2fevil.test']) {
  test(`wallet navigation does not forward unallowlisted data: ${pathname}`, () => {
    for (const id of browserIds) {
      const choice = choose(id);
      const route = resolveWalletConnectionRoute(choice, { providers: [], environment: 'mobile', pathname });
      assert.deepEqual(route, resolveWalletConnectionRoute(choice, { providers: [], environment: 'mobile', pathname: '/' }));
      if (route.kind !== 'browser') assert.fail();
      assert.doesNotMatch(decodeURIComponent(route.href), /private-query|private-hash|evil\.test|tgWebAppData/);
    }
  });
}

test('late unique injection is resolved on the already-visible brand choice', () => {
  const initial = choose('metamask');
  const late = announced('io.metamask');
  const route = resolveWalletConnectionRoute(initial, { providers: [late], environment: 'mobile' });
  assert.deepEqual(route, { kind: 'injected', provider: late.provider, rdns: late.rdns });
});

test('late unrelated injection does not satisfy an already-visible brand choice', () => {
  const initial = choose('metamask');
  const route = resolveWalletConnectionRoute(initial, { providers: [announced('io.rabby')], environment: 'desktop' });
  assert.equal(route.kind, 'install');
  assert.equal('provider' in route, false);
});

test('a second claim arriving after selection invalidates the previously unique provider', () => {
  const exact = announced('io.metamask');
  const choice = choose('metamask', [exact]);
  unavailable(resolveWalletConnectionRoute(choice, { providers: [exact, announced(exact.rdns)], environment: 'desktop' }), 'ambiguous_provider');
});

test('reannouncement of the exact same object is safe and makes no requests', () => {
  const exact = announced('io.metamask');
  const route = resolveWalletConnectionRoute(choose('metamask', [exact]), { providers: [exact, exact, { ...exact }], environment: 'unknown' });
  assert.deepEqual(route, { kind: 'injected', provider: exact.provider, rdns: exact.rdns });
});

test('unknown wallet selection resolves its exact object and never borrows a brand or navigation route', () => {
  const unknown = announced('test.custom', provider(), 'MetaMask');
  const choice = choose('injected:test.custom', [unknown]);
  assert.equal(choice.name, 'Wallet 1');
  assert.deepEqual(resolveWalletConnectionRoute(choice, { providers: [unknown, announced('io.metamask')], environment: 'unknown' }), { kind: 'injected', provider: unknown.provider, rdns: unknown.rdns });
  const canonical = choose('metamask', [unknown]);
  assert.equal(canonical.name, 'MetaMask');
  assert.equal(resolveWalletConnectionRoute(canonical, { providers: [unknown], environment: 'desktop' }).kind, 'install');
  unavailable(resolveWalletConnectionRoute(choice, { providers: [], environment: 'mobile' }), 'provider_changed');
});

test('late name collisions may update labels but never redirect a pinned provider selection', () => {
  const exact = announced('test.first', provider(), 'Custom wallet');
  const choice = choose('injected:test.first', [exact]);
  const providers = [exact, announced('test.second', provider(), 'Custom wallet')];
  assert.equal(choose('injected:test.first', providers).name, 'Custom wallet 1');
  assert.deepEqual(resolveWalletConnectionRoute(choice, { providers, environment: 'desktop' }), { kind: 'injected', provider: exact.provider, rdns: exact.rdns });
});

test('a vanished ambiguous unknown wallet has no invented navigation route', () => {
  const choice = choose('injected:test.custom', [announced('test.custom'), announced('test.custom')]);
  unavailable(resolveWalletConnectionRoute(choice, { providers: [], environment: 'desktop' }), 'provider_unavailable');
});

test('neutral legacy selection connects only the exact current object', () => {
  const legacy = provider();
  const choice = choose('legacy:browser', [], legacy);
  assert.deepEqual(resolveWalletConnectionRoute(choice, { providers: [], legacyProvider: legacy, environment: 'mobile' }), { kind: 'injected', provider: legacy, rdns: null });
  for (const legacyProvider of [undefined, provider()]) {
    unavailable(resolveWalletConnectionRoute(choice, { providers: [], legacyProvider, environment: 'desktop' }), 'provider_changed');
  }
});

test('a legacy object announced late retains exact authority but duplicate identities fail closed', () => {
  const legacy = provider();
  const choice = choose('legacy:browser', [], legacy);
  const late = announced('io.metamask', legacy);
  assert.deepEqual(resolveWalletConnectionRoute(choice, { providers: [late], legacyProvider: legacy, environment: 'mobile' }), { kind: 'injected', provider: legacy, rdns: late.rdns });
  unavailable(resolveWalletConnectionRoute(choice, { providers: [late, announced(late.rdns)], legacyProvider: legacy, environment: 'mobile' }), 'ambiguous_provider');
});

// Published Android tablet desktop-mode UA:
// https://developer.chrome.com/blog/desktop-mode
const desktopModeTabletUserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
const environmentCases: readonly [string, WalletEnvironmentHints, WalletEnvironment][] = [
  ['Windows Chrome', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome Safari' }, 'desktop'],
  ['touchscreen Windows Chrome', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome Safari', maxTouchPoints: 5, userAgentData: { mobile: false } }, 'desktop'],
  ['macOS Safari', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Version/17.5 Safari' }, 'desktop'],
  ['Linux Firefox', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko Firefox' }, 'desktop'],
  ['Linux Chrome without touch', { userAgent: desktopModeTabletUserAgent, maxTouchPoints: 0, userAgentData: { mobile: false } }, 'desktop'],
  ['Android tablet desktop mode', { userAgent: desktopModeTabletUserAgent, platform: 'Linux x86_64', maxTouchPoints: 5, userAgentData: { mobile: false } }, 'unknown'],
  ['ambiguous single-touch X11 Linux', { userAgent: desktopModeTabletUserAgent, maxTouchPoints: 1 }, 'unknown'],
  ['ChromeOS', { userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit Chrome Safari' }, 'desktop'],
  ['iPhone', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari' }, 'mobile'],
  ['iPad', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari' }, 'mobile'],
  ['iPad desktop mode', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit Safari', platform: 'MacIntel', maxTouchPoints: 5 }, 'mobile'],
  ['Android phone', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit Chrome Mobile Safari' }, 'mobile'],
  ['Android tablet with nonmobile hint', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit Chrome Safari', userAgentData: { mobile: false } }, 'mobile'],
  ['Kindle tablet', { userAgent: 'Mozilla/5.0 (Linux; U; en-US) AppleWebKit Silk Safari' }, 'mobile'],
  ['explicit mobile hint', { userAgentData: { mobile: true } }, 'mobile'],
  ['touch Mac platform without UA', { platform: 'MacIntel', maxTouchPoints: 5 }, 'mobile'],
  ['iPad platform without UA', { platform: 'iPad' }, 'mobile'],
  ['missing UA', {}, 'unknown'],
  ['empty UA', { userAgent: '' }, 'unknown'],
  ['nonmobile hint alone', { userAgentData: { mobile: false } }, 'unknown'],
  ['touchscreen alone', { maxTouchPoints: 10 }, 'unknown'],
  ['unknown embedded client', { userAgent: 'SomeEmbeddedWebView/1.0' }, 'unknown'],
];
for (const [name, hints, expected] of environmentCases) {
  test(`environment routing: ${name}`, () => assert.equal(resolveWalletEnvironment(hints), expected));
}
test('missing environment inputs are safe', () => assert.equal(resolveWalletEnvironment(), 'unknown'));

test('desktop-mode tablet uses official mobile-safe app pages and can still use exact injection', () => {
  const environment = resolveWalletEnvironment({ userAgent: desktopModeTabletUserAgent, maxTouchPoints: 5, userAgentData: { mobile: false } });
  for (const wallet of WALLET_CATALOG) {
    const route = resolveWalletConnectionRoute(choose(wallet.id), { providers: [], environment });
    assert.equal(route.kind, 'download');
    if (route.kind !== 'download') assert.fail();
    assert.equal(route.href, officialAppDestinations[wallet.id]);
  }
  const exact = announced('io.metamask');
  const route = resolveWalletConnectionRoute(choose('metamask', [exact]), { providers: [exact], environment });
  assert.deepEqual(route, { kind: 'injected', provider: exact.provider, rdns: exact.rdns });
});
