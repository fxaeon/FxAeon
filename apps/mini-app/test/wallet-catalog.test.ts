import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import type { DiscoveredEip6963Provider, Eip6963Provider } from '../src/lib/wallet/eip6963';
import { buildWalletChoices, getWalletBrand, WALLET_CATALOG } from '../src/lib/wallet/walletCatalog';

const provider = (): Eip6963Provider => ({ request: async () => { throw new Error('Discovery must not request accounts'); } });
const announced = (rdns: string, instance = provider(), name = 'Announced wallet'): DiscoveredEip6963Provider => ({ rdns, provider: instance, name });

test('catalog has eight distinct brands, four primary options, and local safe logos', () => {
  assert.equal(WALLET_CATALOG.length, 8);
  assert.equal(new Set(WALLET_CATALOG.map((wallet) => wallet.id)).size, 8);
  assert.equal(new Set(WALLET_CATALOG.map((wallet) => wallet.rdns)).size, 8);
  assert.deepEqual(WALLET_CATALOG.filter((wallet) => wallet.primary).map((wallet) => wallet.id), ['metamask', 'coinbase', 'okx', 'rabby']);
  assert.deepEqual(WALLET_CATALOG.filter((wallet) => wallet.primary).map((wallet) => wallet.name), ['MetaMask', 'Base Wallet', 'OKX', 'Rabby']);
  assert.deepEqual(WALLET_CATALOG.filter((wallet) => !wallet.primary).map((wallet) => wallet.id), ['trust', 'phantom', 'rainbow', 'zerion']);
  for (const wallet of WALLET_CATALOG) {
    assert.equal(getWalletBrand(wallet.rdns), wallet);
    assert.ok(wallet.icon.startsWith('/wallets/'));
    const svg = readFileSync(resolve(process.cwd(), 'public', wallet.icon.slice(1)), 'utf8');
    assert.ok(svg.includes('<svg'));
    assert.doesNotMatch(svg, /<script|<foreignObject|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i);
  }
  assert.equal(getWalletBrand('unknown.wallet'), undefined);
  assert.equal(getWalletBrand('io.metamask.evil.test'), undefined);
  assert.equal(getWalletBrand('IO.METAMASK'), undefined);
});

test('zero providers still shows each brand once with no invented available provider or install link', () => {
  const choices = buildWalletChoices([]);
  assert.equal(choices.length, WALLET_CATALOG.length);
  assert.deepEqual(choices.map((choice) => choice.id), WALLET_CATALOG.map((wallet) => wallet.id));
  for (const choice of choices) {
    assert.equal(choice.source, 'catalog');
    assert.equal(choice.injected, 'none');
    assert.equal(choice.provider, undefined);
    assert.equal('href' in choice, false);
    assert.equal('extensionUrl' in choice, false);
    assert.equal('action' in choice, false);
  }
});

test('one announced wallet enriches its canonical row without adding a second row', () => {
  const wallet = announced('io.metamask', provider(), 'An untrusted name');
  const choices = buildWalletChoices([wallet]);
  assert.equal(choices.length, WALLET_CATALOG.length);
  const choice = choices.find((item) => item.id === 'metamask')!;
  assert.equal(choice.name, 'MetaMask');
  assert.equal(choice.provider, wallet.provider);
  assert.equal(choice.injected, 'available');
});

test('Base Wallet retains the Coinbase identity and exact provider without duplicate compatibility rows', () => {
  const exact = announced('com.coinbase.wallet', provider(), 'Coinbase Wallet');
  const choices = buildWalletChoices([exact, { ...exact, name: 'Base Wallet' }], exact.provider);
  const base = choices.find((choice) => choice.id === 'coinbase')!;
  assert.equal(base.name, 'Base Wallet');
  assert.equal(base.rdns, 'com.coinbase.wallet');
  assert.equal(base.primary, true);
  assert.equal(base.injected, 'available');
  assert.equal(base.provider, exact.provider);
  assert.equal(getWalletBrand('com.coinbase.wallet')?.id, 'coinbase');
  assert.equal(choices.length, WALLET_CATALOG.length);
  assert.equal(choices.filter((choice) => choice.provider === exact.provider).length, 1);
  assert.equal(choices.some((choice) => choice.name === 'Coinbase Wallet'), false);
  assert.equal(choices.some((choice) => choice.id === 'base'), false);
});

test('distinct Coinbase identity claims remain one ambiguous Base Wallet row', () => {
  const choices = buildWalletChoices([
    announced('com.coinbase.wallet', provider(), 'Base Wallet'),
    announced('com.coinbase.wallet', provider(), 'Coinbase Wallet'),
  ]);
  const matches = choices.filter((choice) => choice.rdns === 'com.coinbase.wallet');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, 'Base Wallet');
  assert.equal(matches[0].injected, 'ambiguous');
  assert.equal(matches[0].provider, undefined);
});

test('installed Trust and Phantom each enrich one secondary catalog row', () => {
  for (const id of ['trust', 'phantom']) {
    const brand = WALLET_CATALOG.find((wallet) => wallet.id === id)!;
    const exact = announced(brand.rdns);
    const choices = buildWalletChoices([exact, exact], exact.provider);
    const matches = choices.filter((choice) => choice.id === id);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].primary, false);
    assert.equal(matches[0].provider, exact.provider);
    assert.equal(choices.length, WALLET_CATALOG.length);
  }
});

test('a raw MetaMask Mobile announcement enriches the canonical row with its exact object', () => {
  const mobile = Object.freeze(announced('io.metamask.mobile', provider(), 'MetaMask Mobile'));
  const choices = buildWalletChoices(Object.freeze([mobile]), mobile.provider);
  const choice = choices.find((item) => item.id === 'metamask')!;
  assert.equal(choices.length, WALLET_CATALOG.length);
  assert.equal(choice.name, 'MetaMask');
  assert.equal(choice.rdns, 'io.metamask');
  assert.equal(choice.source, 'catalog');
  assert.equal(choice.injected, 'available');
  assert.equal(choice.provider, mobile.provider);
  assert.equal(choices.some((item) => item.source === 'discovered' || item.source === 'legacy'), false);
  assert.equal(getWalletBrand(mobile.rdns), getWalletBrand('io.metamask'));
  assert.equal(mobile.rdns, 'io.metamask.mobile', 'normalization must not mutate the raw announcement');
});

for (const identities of [['io.metamask', 'io.metamask.mobile'], ['io.metamask.mobile', 'io.metamask']]) {
  test(`the same object announced as ${identities.join(' then ')} is one selectable MetaMask`, () => {
    const instance = provider();
    const choices = buildWalletChoices(identities.map((rdns) => announced(rdns, instance)), instance);
    assert.equal(choices.length, WALLET_CATALOG.length);
    const choice = choices.find((item) => item.id === 'metamask')!;
    assert.equal(choice.rdns, 'io.metamask');
    assert.equal(choice.injected, 'available');
    assert.equal(choice.provider, instance);
    assert.equal(choices.filter((item) => item.provider === instance).length, 1);
  });

  test(`distinct objects announced as ${identities.join(' then ')} form one ambiguous MetaMask row`, () => {
    const providers = identities.map((rdns) => announced(rdns));
    const choices = buildWalletChoices(providers, providers[0].provider);
    assert.equal(choices.length, WALLET_CATALOG.length);
    const choice = choices.find((item) => item.id === 'metamask')!;
    assert.equal(choice.rdns, 'io.metamask');
    assert.equal(choice.injected, 'ambiguous');
    assert.equal(choice.provider, undefined);
    assert.equal(choices.some((item) => item.source === 'discovered' || item.source === 'legacy'), false);
  });
}

test('MetaMask Mobile alias matching does not accept related-looking or case-folded identities', () => {
  for (const rdns of ['io.metamask.mobile.evil.test', 'io.metamask.mobile.extra', 'IO.METAMASK.MOBILE', 'mobile.io.metamask']) {
    const wallet = announced(rdns, provider(), 'MetaMask Mobile');
    const choices = buildWalletChoices([wallet]);
    assert.equal(getWalletBrand(rdns), undefined);
    assert.equal(choices.find((item) => item.id === 'metamask')?.injected, 'none');
    assert.equal(choices.find((item) => item.id === `injected:${rdns}`)?.provider, wallet.provider);
  }
});

test('many announced wallets each retain their exact provider and catalog ordering', () => {
  const providers = WALLET_CATALOG.map((wallet) => announced(wallet.rdns));
  const choices = buildWalletChoices([...providers].reverse());
  assert.deepEqual(choices.map((choice) => choice.id), WALLET_CATALOG.map((wallet) => wallet.id));
  for (let index = 0; index < providers.length; index++) {
    assert.equal(choices[index].provider, providers[index].provider);
    assert.equal(choices[index].injected, 'available');
  }
});

test('late discovery updates one stable row while previous snapshots stay unchanged', () => {
  const before = buildWalletChoices([]);
  const late = announced('io.rabby');
  const after = buildWalletChoices([late]);
  assert.deepEqual(before.map((choice) => choice.id), after.map((choice) => choice.id));
  assert.equal(before.find((choice) => choice.id === 'rabby')?.injected, 'none');
  assert.equal(after.find((choice) => choice.id === 'rabby')?.provider, late.provider);
});

test('reannouncing the same provider object does not duplicate or make the wallet ambiguous', () => {
  const instance = provider();
  const wallet = announced('io.metamask', instance);
  const choices = buildWalletChoices([wallet, { ...wallet, name: 'Renamed' }, wallet], instance);
  assert.equal(choices.length, WALLET_CATALOG.length);
  assert.equal(choices.find((choice) => choice.id === 'metamask')?.injected, 'available');
  assert.equal(choices.filter((choice) => choice.provider === instance).length, 1);
});

test('one provider object with conflicting identities cannot hide behind first-object deduplication', () => {
  const instance = provider();
  const choices = buildWalletChoices([
    announced('test.first', instance, 'First announcement'),
    announced('test.second', instance, 'Second announcement'),
  ]);
  assert.equal(choices.filter((choice) => choice.provider === instance).length, 0);
  const conflicting = choices.filter((choice) => choice.source === 'discovered');
  assert.equal(conflicting.length, 2);
  assert.ok(conflicting.every((choice) => choice.injected === 'ambiguous'));
});

test('different objects claiming one known rdns produce one ambiguous row with no selected provider', () => {
  const choices = buildWalletChoices([announced('io.metamask'), announced('io.metamask')]);
  const matches = choices.filter((choice) => choice.rdns === 'io.metamask');
  assert.equal(choices.length, WALLET_CATALOG.length);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].injected, 'ambiguous');
  assert.equal(matches[0].provider, undefined);
});

test('unknown wallets remain available without borrowing a known brand identity', () => {
  const wallet = announced('test.custom', provider(), 'MetaMask');
  const choices = buildWalletChoices([wallet]);
  const unknown = choices.find((choice) => choice.rdns === wallet.rdns)!;
  assert.equal(choices.length, WALLET_CATALOG.length + 1);
  assert.equal(unknown.id, 'injected:test.custom');
  assert.equal(unknown.source, 'discovered');
  assert.equal(unknown.name, 'Wallet 1');
  assert.equal(unknown.icon, undefined);
  assert.equal(unknown.provider, wallet.provider);
  assert.equal(choices.find((choice) => choice.id === 'metamask')?.injected, 'none');
  assert.equal(choices.filter((choice) => choice.name === 'MetaMask').length, 1);
});

test('catalog-name collisions are neutral regardless of case, spacing, or compatibility characters', () => {
  const providers = [
    announced('test.first', provider(), '  metamask  '),
    announced('test.second', provider(), 'ＭｅｔａＭａｓｋ'),
    announced('test.third', provider(), 'Trust   Wallet'),
  ];
  const unknown = buildWalletChoices(providers).filter((choice) => choice.source === 'discovered');
  assert.deepEqual(unknown.map((choice) => choice.name), ['Wallet 1', 'Wallet 2', 'Wallet 3']);
  assert.deepEqual(unknown.map((choice) => choice.provider), providers.map((item) => item.provider));
  assert.deepEqual(unknown.map((choice) => choice.rdns), providers.map((item) => item.rdns));
});

test('unknown self-attested labels cannot impersonate Base or its Coinbase compatibility brand', () => {
  const names = ['Base Wallet', 'Base', 'Base App', 'Coinbase Wallet', 'Coinbase', '  base   wallet  ', 'Ｃｏｉｎｂａｓｅ Ｗａｌｌｅｔ', 'OKX Wallet'];
  const providers = names.map((name, index) => announced(`test.brand.${index}`, provider(), name));
  const choices = buildWalletChoices(providers);
  const unknown = choices.filter((choice) => choice.source === 'discovered');
  assert.deepEqual(unknown.map((choice) => choice.name), names.map((_, index) => `Wallet ${index + 1}`));
  assert.deepEqual(unknown.map((choice) => choice.provider), providers.map((item) => item.provider));
  assert.ok(unknown.every((choice) => choice.icon === undefined && !choice.primary));
  assert.equal(choices.find((choice) => choice.id === 'coinbase')?.injected, 'none');
  for (const rdns of ['org.base', 'com.base.wallet', 'com.coinbase.wallet.evil.test', 'COM.COINBASE.WALLET']) {
    assert.equal(getWalletBrand(rdns), undefined, 'display branding must not expand accepted provider identities');
  }
});

test('repeated unknown names are numbered while unique names stay recognizable', () => {
  const providers = [
    announced('test.first', provider(), 'Custom wallet'),
    announced('test.second', provider(), 'Custom wallet'),
    announced('test.third', provider(), 'Other wallet'),
  ];
  const unknown = buildWalletChoices(providers).filter((choice) => choice.source === 'discovered');
  assert.deepEqual(unknown.map((choice) => choice.name), ['Custom wallet 1', 'Custom wallet 2', 'Other wallet']);
  assert.deepEqual(unknown.map((choice) => choice.provider), providers.map((item) => item.provider));
});

test('generated labels cannot collide with literal numbered names or the neutral legacy row', () => {
  const providers = [
    announced('test.first', provider(), 'MetaMask'),
    announced('test.second', provider(), 'Wallet 1'),
    announced('test.third', provider(), 'Wallet'),
    announced('test.fourth', provider(), 'Custom'),
    announced('test.fifth', provider(), 'custom'),
    announced('test.sixth', provider(), 'Custom 1'),
  ];
  const choices = buildWalletChoices(providers, provider());
  const names = choices.map((choice) => choice.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  assert.equal(choices.find((choice) => choice.source === 'legacy')?.name, 'Wallet');
  assert.equal(choices.find((choice) => choice.rdns === 'test.second')?.name, 'Wallet 1');
  assert.equal(choices.find((choice) => choice.rdns === 'test.sixth')?.name, 'Custom 1');
});

test('identical unknown rdns claims form one ambiguous row, while different rdns remain separate', () => {
  const choices = buildWalletChoices([
    announced('test.custom', provider(), 'Custom'),
    announced('test.custom', provider(), 'Custom clone'),
    announced('test.other', provider(), 'Custom'),
  ]);
  const unknown = choices.filter((choice) => choice.source === 'discovered');
  assert.equal(unknown.length, 2);
  assert.equal(unknown[0].injected, 'ambiguous');
  assert.equal(unknown[0].provider, undefined);
  assert.equal(unknown[1].injected, 'available');
  assert.deepEqual(unknown.map((choice) => choice.name), ['Custom 1', 'Custom 2']);
});

test('a real unannounced legacy object is only a neutral Wallet', () => {
  const legacy = Object.assign(provider(), { isMetaMask: true, isCoinbaseWallet: true });
  const choices = buildWalletChoices([], legacy);
  const browser = choices.find((choice) => choice.source === 'legacy')!;
  assert.equal(browser.name, 'Wallet');
  assert.equal(browser.id, 'legacy:browser');
  assert.equal(browser.rdns, null);
  assert.equal(browser.icon, undefined);
  assert.equal(browser.provider, legacy);
  assert.equal(choices.find((choice) => choice.id === 'metamask')?.provider, undefined);
  assert.equal(choices.find((choice) => choice.id === 'coinbase')?.provider, undefined);
});

test('announced legacy provider is never duplicated as Wallet, even for ambiguous rdns', () => {
  const legacy = provider();
  const choices = buildWalletChoices([announced('io.metamask', legacy), announced('io.metamask')], legacy);
  assert.equal(choices.some((choice) => choice.source === 'legacy'), false);
  assert.equal(choices.find((choice) => choice.id === 'metamask')?.injected, 'ambiguous');
});

test('an unrelated legacy object remains its own selectable row next to announced wallets', () => {
  const exact = announced('io.metamask');
  const legacy = provider();
  const choices = buildWalletChoices([exact], legacy);
  assert.equal(choices.find((choice) => choice.id === 'metamask')?.provider, exact.provider);
  assert.equal(choices.find((choice) => choice.source === 'legacy')?.provider, legacy);
});

test('a legacy placeholder without a request method never creates a Wallet', () => {
  const invalid = { isMetaMask: true } as unknown as Eip6963Provider;
  assert.equal(buildWalletChoices([], invalid).some((choice) => choice.source === 'legacy'), false);
});

test('building rows never mutates caller discovery objects', () => {
  const wallet = Object.freeze(announced('test.custom'));
  const providers = Object.freeze([wallet]);
  assert.doesNotThrow(() => buildWalletChoices(providers));
  assert.equal(Object.keys(wallet).length, 3);
});
