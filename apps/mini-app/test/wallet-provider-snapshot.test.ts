import assert from 'node:assert/strict';
import test from 'node:test';
import { readWalletProviderSnapshot, groupWalletProviderClaims } from '../src/lib/wallet/walletProviderSnapshot';
import { buildWalletChoices } from '../src/lib/wallet/walletCatalog';
import { resolveWalletConnectionRoute } from '../src/lib/wallet/walletConnectionRoutes';
import { clearEip6963AnnouncementsForTest, recordEip6963Announcement, getDiscoveredEip6963Providers, selectEip6963Provider, type DiscoveredEip6963Provider, type Eip6963Provider } from '../src/lib/wallet/eip6963';

const provider = (): Eip6963Provider => ({ request: async () => { throw new Error('Discovery cannot make requests'); } });
const announcement = (rdns: string, raw = provider()): DiscoveredEip6963Provider => ({ rdns, provider: raw, name: 'Untrusted label' });
const hosts = [
  { id: 'coinbase', rdns: 'com.coinbase.wallet', host: (raw: Eip6963Provider) => ({ coinbaseWalletExtension: raw }) },
  { id: 'okx', rdns: 'com.okex.wallet', host: (raw: Eip6963Provider) => ({ okxwallet: raw }) },
  { id: 'phantom', rdns: 'app.phantom', host: (raw: Eip6963Provider) => ({ phantom: { ethereum: raw } }) },
  { id: 'trust', rdns: 'com.trustwallet.app', host: (raw: Eip6963Provider) => ({ trustwallet: { ethereum: raw } }) },
];
for (const { id, rdns, host } of hosts) {
  test(`${id} documented namespace routes its exact object without an announcement`, () => {
    const raw = provider();
    const snapshot = readWalletProviderSnapshot([], host(raw));
    const choice = buildWalletChoices(snapshot).find((item) => item.id === id)!;
    assert.equal(choice.provider, raw);
    assert.equal(choice.injected, 'available');
    for (const environment of ['desktop', 'mobile', 'unknown'] as const) {
      const route = resolveWalletConnectionRoute(choice, { providers: snapshot, environment });
      assert.equal(route.kind, 'injected');
      assert.equal(route.kind === 'injected' && route.provider, raw);
    }
    assert.equal(snapshot[0].rdns, rdns);
  });
  test(`${id} announcement owns discovery even when its namespace exposes another wrapper`, () => {
    const raw = provider();
    const same = readWalletProviderSnapshot([announcement(rdns, raw)], host(raw));
    assert.equal(same.length, 1);
    assert.equal(buildWalletChoices(same).find((item) => item.id === id)?.provider, raw);
    const announcedProvider = provider();
    const distinct = readWalletProviderSnapshot([announcement(rdns, announcedProvider)], host(raw));
    assert.equal(distinct.length, 1);
    const choice = buildWalletChoices(distinct).find((item) => item.id === id)!;
    assert.equal(choice.injected, 'available');
    assert.equal(choice.provider, announcedProvider);
    assert.deepEqual(resolveWalletConnectionRoute(choice, { providers: distinct, environment: 'mobile' }), { kind: 'injected', provider: announcedProvider, rdns });
  });
  test(`${id} two distinct announcements stay ambiguous despite its namespace fallback`, () => {
    const raw = provider();
    const distinct = readWalletProviderSnapshot([announcement(rdns, raw), announcement(rdns, provider())], host(raw));
    assert.equal(distinct.length, 2);
    const choice = buildWalletChoices(distinct).find((item) => item.id === id)!;
    assert.equal(choice.injected, 'ambiguous');
    assert.equal(choice.provider, undefined);
    assert.equal(resolveWalletConnectionRoute(choice, { providers: distinct, environment: 'mobile' }).kind, 'unavailable');
  });
  test(`${id} replacement/disappearance invalidates a previously selected namespace`, () => {
    const raw = provider();
    const initial = readWalletProviderSnapshot([], host(raw));
    const choice = buildWalletChoices(initial).find((item) => item.id === id)!;
    for (const next of [host(provider()), {}]) {
      const route = resolveWalletConnectionRoute(choice, { providers: readWalletProviderSnapshot([], next), environment: 'mobile' });
      assert.equal(route.kind, 'unavailable');
      assert.equal(route.kind === 'unavailable' && route.reason, 'provider_changed');
    }
  });
}

test('namespace reads are fresh, nonmutating and tolerate hostile getters', () => {
  const raw = provider();
  const announced = Object.freeze([Object.freeze(announcement('io.rabby', raw))]);
  const hostile = Object.defineProperty({}, 'okxwallet', { get() { throw new Error('unloading'); } });
  const nested = { phantom: Object.defineProperty({}, 'ethereum', { get() { throw new Error('unloading'); } }) };
  const badRequest = { trustwallet: { ethereum: Object.defineProperty({}, 'request', { get() { throw new Error('unloading'); } }) } };
  for (const host of [undefined, null, hostile, nested, badRequest, { ethereum: raw }, { okxwallet: { isMetaMask: true } }]) {
    assert.deepEqual(readWalletProviderSnapshot(announced, host), announced);
  }
  assert.equal(announced.length, 1);
  const host = { okxwallet: raw };
  assert.equal(readWalletProviderSnapshot([], host)[0].provider, raw);
  host.okxwallet = provider();
  assert.equal(readWalletProviderSnapshot([], host)[0].provider, host.okxwallet);
});

test('one raw object claiming conflicting wallet identities fails closed before deduplication', () => {
  const raw = provider();
  for (const claims of [
    [announcement('io.metamask', raw), announcement('com.okex.wallet', raw)],
    readWalletProviderSnapshot([announcement('io.rabby', raw)], { okxwallet: raw }),
    readWalletProviderSnapshot([], { coinbaseWalletExtension: raw, phantom: { ethereum: raw } }),
    readWalletProviderSnapshot([announcement('unrecognized.wallet', raw)], { trustwallet: { ethereum: raw } }),
  ]) {
    const { byRdns, conflictingProviders } = groupWalletProviderClaims(claims);
    assert.equal(byRdns.size, 2);
    assert.ok(conflictingProviders.has(raw));
    const choices = buildWalletChoices(claims, raw);
    for (const rdns of byRdns.keys()) {
      const choice = choices.find((item) => item.rdns === rdns)!;
      assert.equal(choice.injected, 'ambiguous');
      assert.equal(choice.provider, undefined);
      assert.equal(resolveWalletConnectionRoute(choice, { providers: claims, legacyProvider: raw, environment: 'mobile' }).kind, 'unavailable');
    }
    assert.equal(choices.some((choice) => choice.source === 'legacy'), false);
  }
});

test('known aliases on one object are not conflicting identities', () => {
  const raw = provider();
  const claims = [announcement('io.metamask', raw), announcement('io.metamask.mobile', raw)];
  const { byRdns, conflictingProviders } = groupWalletProviderClaims(claims);
  assert.equal(byRdns.size, 1);
  assert.equal(byRdns.get('io.metamask')?.length, 1);
  assert.equal(conflictingProviders.size, 0);
});

test('a matching announcement cannot hide another announced raw object with conflicting namespace branding', () => {
  const okx = provider();
  const conflicting = provider();
  const claims = readWalletProviderSnapshot([announcement('com.okex.wallet', okx), announcement('io.rabby', conflicting)], { okxwallet: conflicting });
  assert.equal(claims.length, 3);
  assert.ok(groupWalletProviderClaims(claims).conflictingProviders.has(conflicting));
  for (const id of ['okx', 'rabby']) {
    const choice = buildWalletChoices(claims).find((item) => item.id === id)!;
    assert.equal(choice.injected, 'ambiguous');
    assert.equal(resolveWalletConnectionRoute(choice, { providers: claims, environment: 'mobile' }).kind, 'unavailable');
  }
});


test('live announcement ingestion preserves conflicting identities for resolver and restore', () => {
  clearEip6963AnnouncementsForTest();
  const raw = provider();
  assert.ok(recordEip6963Announcement({ provider: raw, info: { rdns: 'io.metamask' } }));
  assert.equal(recordEip6963Announcement({ provider: raw, info: { rdns: 'io.metamask.mobile' } }), null);
  assert.ok(recordEip6963Announcement({ provider: raw, info: { rdns: 'io.rabby' } }));
  const snapshot = readWalletProviderSnapshot(getDiscoveredEip6963Providers(), {});
  assert.equal(snapshot.length, 2);
  for (const id of ['metamask', 'rabby']) {
    const choice = buildWalletChoices(snapshot).find((item) => item.id === id)!;
    assert.equal(choice.injected, 'ambiguous');
    assert.equal(resolveWalletConnectionRoute(choice, { providers: snapshot, environment: 'mobile' }).kind, 'unavailable');
    assert.equal(selectEip6963Provider(choice.rdns), undefined);
  }
  clearEip6963AnnouncementsForTest();
});

test('announcement and provider property getters cannot crash discovery', () => {
  clearEip6963AnnouncementsForTest();
  const throws = { get() { throw new Error('hostile getter'); } };
  const cases = [
    Object.defineProperty({}, 'provider', throws),
    { provider: Object.defineProperty({}, 'request', throws) },
    Object.defineProperty({ provider: provider() }, 'info', throws),
    { provider: provider(), info: Object.defineProperty({}, 'rdns', throws) },
    { provider: provider(), info: Object.defineProperty({}, 'name', throws) },
  ];
  for (const candidate of cases) assert.equal(recordEip6963Announcement(candidate), null);
  assert.equal(getDiscoveredEip6963Providers().length, 0);
});
