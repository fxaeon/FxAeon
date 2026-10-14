import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLegacyWalletProviderSnapshot, readWalletProviderSnapshot } from '../src/lib/wallet/walletProviderSnapshot';
import { buildWalletChoices } from '../src/lib/wallet/walletCatalog';
import { resolveWalletConnectionRoute } from '../src/lib/wallet/walletConnectionRoutes';
import type { Eip6963Provider } from '../src/lib/wallet/eip6963';

const raw = (): Eip6963Provider => ({ request: async () => { throw new Error('Discovery must never request permissions'); } });
const hosts = [
  ['Bitget Wallet', 'com.bitget.web3', (provider: Eip6963Provider) => ({ bitkeep: { ethereum: provider } })],
  ['Coin98 Wallet', 'com.coin98', (provider: Eip6963Provider) => ({ coin98: { provider } })],
  ['OneKey', 'so.onekey.app.wallet', (provider: Eip6963Provider) => ({ $onekey: { ethereum: provider } })],
  ['Talisman', 'xyz.talisman', (provider: Eip6963Provider) => ({ talismanEth: provider })],
  ['Backpack', 'app.backpack.mobile', (provider: Eip6963Provider) => ({ backpack: { ethereum: provider } })],
  ['SafePal', null, (provider: Eip6963Provider) => ({ safepalProvider: provider })],
] as const;

for (const [name, rdns, host] of hosts) {
  test(`${name} namespace keeps exact legacy object and display metadata without inventing rdns`, () => {
    const provider = raw();
    const legacy = readLegacyWalletProviderSnapshot([], host(provider));
    const choice = buildWalletChoices([], legacy).find(item => item.provider === provider)!;
    assert.equal(choice.name, name); assert.equal(choice.rdns, null); assert.equal(choice.source, 'legacy');
    assert.deepEqual(resolveWalletConnectionRoute(choice, { providers: [], legacyProviders: legacy.map(item => item.provider), environment: 'desktop' }), { kind: 'injected', provider, rdns: null });
    const replaced = readLegacyWalletProviderSnapshot([], host(raw()));
    assert.equal(resolveWalletConnectionRoute(choice, { providers: [], legacyProviders: replaced.map(item => item.provider), environment: 'desktop' }).kind, 'unavailable');
    if (rdns) {
      const canonical = raw(); const announced = [{ provider: canonical, rdns, name }];
      assert.deepEqual(readLegacyWalletProviderSnapshot(announced, { ...host(provider), ethereum: { providers: [provider, canonical] } }), []);
    }
  });
}

test('legacy arrays deduplicate aliases and announcements without offering the aggregate signer', () => {
  const one = raw(), two = raw(), three = raw();
  const ethereum = Object.assign(raw(), { providers: [one, two, one, three] });
  const announced = [{ provider: one, rdns: 'org.example.evm', name: 'Example EVM' }];
  const snapshot = readWalletProviderSnapshot(announced, {});
  const legacy = readLegacyWalletProviderSnapshot(snapshot, { ethereum, $onekey: { ethereum: two } });
  assert.deepEqual(legacy.map(item => item.provider), [two, three]);
  const choices = buildWalletChoices(snapshot, legacy).filter(item => item.injected === 'available');
  assert.equal(choices.length, 3); assert.ok(!choices.some(item => item.provider === ethereum));
  const ids = new Map(choices.map(item => [item.provider, item.id]));
  const reordered = buildWalletChoices(snapshot, [...legacy].reverse());
  for (const item of reordered.filter(item => item.provider)) assert.equal(item.id, ids.get(item.provider));
});

test('one hostile array index or namespace getter does not hide later valid providers', () => {
  const provider = raw(); const providers = [null, provider];
  Object.defineProperty(providers, 0, { get() { throw new Error('Unloading'); } });
  const host = Object.defineProperty({ ethereum: { providers } }, 'bitkeep', { get() { throw new Error('Unloading'); } });
  assert.deepEqual(readLegacyWalletProviderSnapshot([], host), [{ provider }]);
});

test('legacy labels terminate and remain distinct when announced names collide with every first suffix', () => {
  const named = raw(), unnamed = raw();
  const initial = buildWalletChoices([], [{ provider: named, name: 'Bitget Wallet' }, { provider: unnamed }]);
  const labels = initial.filter(item => item.source === 'legacy').map(item => item.name);
  const suffix = Number(initial.find(item => item.provider === named)!.id.split(':').at(-1));
  const announcements = [...labels, `Bitget Wallet ${suffix}`, `Bitget Wallet ${suffix + 1}`, 'Wallet 1'].map((name, index) => ({ provider: raw(), rdns: `org.collision.wallet${index}`, name }));
  const choices = buildWalletChoices(announcements, [{ provider: named, name: 'Bitget Wallet' }, { provider: unnamed }]);
  assert.equal(new Set(choices.map(item => item.name.toLowerCase())).size, choices.length);
  assert.equal(choices.find(item => item.provider === named)!.id, initial.find(item => item.provider === named)!.id);
});

test('an arbitrary EIP wallet promotes the same legacy object, while conflicting identities remain blocked', () => {
  const provider = raw();
  const choice = buildWalletChoices([], [{ provider }]).find(item => item.provider === provider)!;
  const announcements = [{ provider, rdns: 'org.new-wallet.provider', name: 'New EVM Wallet' }];
  assert.deepEqual(readLegacyWalletProviderSnapshot(announcements, { ethereum: { providers: [provider] } }), []);
  assert.deepEqual(resolveWalletConnectionRoute(choice, { providers: announcements, legacyProviders: [], environment: 'desktop' }), { kind: 'injected', provider, rdns: 'org.new-wallet.provider' });
  const conflict = [...announcements, { ...announcements[0], rdns: 'org.other-wallet.provider' }];
  assert.equal(resolveWalletConnectionRoute(choice, { providers: conflict, legacyProviders: [], environment: 'desktop' }).kind, 'unavailable');
});
