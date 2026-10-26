import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearEip6963AnnouncementsForTest,
  eip6963FocusTrapDestination,
  getDiscoveredEip6963Providers,
  recordEip6963Announcement,
  selectEip6963Provider,
  shouldBindEip6963ProviderEvents,
  shouldPromptEip6963Provider,
  waitForWalletProvider,
  type Eip6963Announcement,
} from '../src/lib/wallet/eip6963';

function provider(): Eip6963Announcement['provider'] {
  return { request: async () => [] };
}

test('EIP-6963 discovery deduplicates provider objects and sanitizes labels', () => {
  clearEip6963AnnouncementsForTest();
  const wallet = provider()!;
  const first = recordEip6963Announcement({ provider: wallet, info: { name: 'Meta\u0000Mask', rdns: 'io.metamask' } });
  assert.equal(recordEip6963Announcement({ provider: wallet, info: { name: 'Duplicate' } }), null);
  assert.equal(first?.name, 'MetaMask');
  assert.equal(getDiscoveredEip6963Providers().length, 1);
});

for (const announcedRdns of ['io.metamask', 'io.metamask.mobile']) {
  test(`${announcedRdns} restores uniquely through either remembered MetaMask identity`, () => {
    clearEip6963AnnouncementsForTest();
    const exact = provider()!;
    const raw = Object.freeze({ provider: exact, info: Object.freeze({ rdns: announcedRdns, name: 'MetaMask' }) });
    const recorded = recordEip6963Announcement(raw);
    recordEip6963Announcement({ provider: provider(), info: { rdns: 'io.rabby', name: 'Rabby' } });
    assert.equal(recorded?.rdns, 'io.metamask');
    assert.equal(recorded?.provider, exact);
    assert.equal(raw.info.rdns, announcedRdns);
    for (const preferred of ['io.metamask', 'io.metamask.mobile']) {
      assert.equal(selectEip6963Provider(preferred), recorded);
      assert.equal(shouldPromptEip6963Provider(preferred), false);
      assert.equal(shouldBindEip6963ProviderEvents(preferred), true);
    }
  });
}

for (const identities of [['io.metamask', 'io.metamask.mobile'], ['io.metamask.mobile', 'io.metamask']]) {
  test(`discovery deduplicates one object announced as ${identities.join(' then ')}`, () => {
    clearEip6963AnnouncementsForTest();
    const exact = provider()!;
    const first = recordEip6963Announcement({ provider: exact, info: { rdns: identities[0] } });
    assert.equal(recordEip6963Announcement({ provider: exact, info: { rdns: identities[1] } }), null);
    assert.equal(getDiscoveredEip6963Providers().length, 1);
    assert.equal(first?.rdns, 'io.metamask');
    for (const preferred of identities) assert.equal(selectEip6963Provider(preferred)?.provider, exact);
  });

  test(`distinct ${identities.join(' and ')} objects cannot restore through either identity`, () => {
    clearEip6963AnnouncementsForTest();
    for (const rdns of identities) recordEip6963Announcement({ provider: provider(), info: { rdns } });
    assert.equal(getDiscoveredEip6963Providers().length, 2);
    assert.deepEqual(getDiscoveredEip6963Providers().map((item) => item.rdns), ['io.metamask', 'io.metamask']);
    for (const preferred of identities) {
      assert.equal(selectEip6963Provider(preferred), undefined);
      assert.equal(shouldPromptEip6963Provider(preferred), true);
      assert.equal(shouldBindEip6963ProviderEvents(preferred), false);
    }
  });
}

test('unrelated and alias-like announcements cannot satisfy a remembered MetaMask identity', () => {
  clearEip6963AnnouncementsForTest();
  for (const rdns of ['io.rabby', 'io.metamask.mobile.evil.test', 'IO.METAMASK.MOBILE']) {
    const recorded = recordEip6963Announcement({ provider: provider(), info: { rdns } });
    assert.equal(recorded?.rdns, rdns);
  }
  for (const preferred of ['io.metamask', 'io.metamask.mobile']) {
    assert.equal(selectEip6963Provider(preferred), undefined);
    assert.equal(shouldBindEip6963ProviderEvents(preferred), false);
  }
});

test('a valid preferred rdns selects directly while multiple unchosen providers prompt', () => {
  clearEip6963AnnouncementsForTest();
  const first = provider()!;
  const second = provider()!;
  recordEip6963Announcement({ provider: first, info: { name: 'First', rdns: 'com.first' } });
  recordEip6963Announcement({ provider: second, info: { name: 'Second', rdns: 'com.second' } });
  assert.equal(shouldPromptEip6963Provider('com.unknown'), true);
  assert.equal(shouldBindEip6963ProviderEvents('com.unknown'), false);
  assert.equal(shouldPromptEip6963Provider('com.second'), false);
  assert.equal(shouldBindEip6963ProviderEvents('com.second'), true);
  assert.equal(selectEip6963Provider('com.second')?.provider, second);
  assert.equal(selectEip6963Provider('com.unknown'), undefined);
});

test('missing provider metadata gets a safe local fallback and never requests an icon', () => {
  clearEip6963AnnouncementsForTest();
  const item = recordEip6963Announcement({ provider: provider() });
  assert.equal(item?.name, 'Browser wallet');
  assert.match(item?.rdns ?? '', /^unknown-wallet-\d+$/);
});

test('chooser focus trap redirects Tab and Shift+Tab when focus starts outside the dialog', () => {
  assert.equal(eip6963FocusTrapDestination({ activeInside: false, atFirst: false, atLast: false, shiftKey: false }), 'first');
  assert.equal(eip6963FocusTrapDestination({ activeInside: false, atFirst: false, atLast: false, shiftKey: true }), 'last');
  assert.equal(eip6963FocusTrapDestination({ activeInside: true, atFirst: true, atLast: false, shiftKey: true }), 'last');
  assert.equal(eip6963FocusTrapDestination({ activeInside: true, atFirst: false, atLast: true, shiftKey: false }), 'first');
});

test('wallet provider wait resolves when a delayed EIP-6963 announcement arrives', async () => {
  const target = new EventTarget();
  let delayed: Eip6963Announcement['provider'];
  const pending = waitForWalletProvider(() => delayed, target, { pollMs: 5, timeoutMs: 250 });
  setTimeout(() => {
    delayed = provider();
    target.dispatchEvent(new Event('eip6963:announceProvider'));
  }, 30);
  assert.equal(await pending, delayed);
});

test('invalid wallet announcements do not enter discovery or prevent a later valid provider', () => {
  clearEip6963AnnouncementsForTest();
  for (const value of [undefined, null, true, [], {}, { provider: {} }, { provider: { request: true } }]) {
    assert.equal(recordEip6963Announcement(value as Eip6963Announcement), null);
  }
  assert.equal(getDiscoveredEip6963Providers().length, 0);
  const wallet = provider()!;
  assert.equal(recordEip6963Announcement({ provider: wallet })?.provider, wallet);
});

test('wallet provider wait tolerates an initially unavailable injected getter', async () => {
  const wallet = provider()!;
  let calls = 0;
  const result = waitForWalletProvider(() => {
    calls += 1;
    if (calls === 1) throw new Error('Extension is initializing');
    return wallet;
  }, new EventTarget(), { pollMs: 5, timeoutMs: 250 });
  assert.equal(await result, wallet);
});

test('a previously cancelled provider wait does not select an already injected wallet', async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  await assert.rejects(waitForWalletProvider(() => {
    reads += 1;
    return provider();
  }, new EventTarget(), { signal: controller.signal }), /cancelled/);
  assert.equal(reads, 0);
});

test('repeated discovery announcements leave no polling reads after cancellation', async () => {
  const target = new EventTarget();
  const controller = new AbortController();
  let reads = 0;
  const pending = waitForWalletProvider(() => { reads += 1; return undefined; }, target, {
    signal: controller.signal, pollMs: 5, timeoutMs: 100,
  });
  for (let index = 0; index < 5; index += 1) target.dispatchEvent(new Event('eip6963:announceProvider'));
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  const stoppedAt = reads;
  await new Promise((resolve) => setTimeout(resolve, 30));
  target.dispatchEvent(new Event('eip6963:announceProvider'));
  assert.equal(reads, stoppedAt);
});

test('a duplicated self-claimed rdns cannot silently choose the first provider on restore', () => {
  clearEip6963AnnouncementsForTest();
  recordEip6963Announcement({ provider: provider(), info: { rdns: 'io.metamask', name: 'MetaMask' } });
  recordEip6963Announcement({ provider: provider(), info: { rdns: 'io.metamask', name: 'MetaMask' } });
  assert.equal(selectEip6963Provider('io.metamask'), undefined);
  assert.equal(shouldBindEip6963ProviderEvents('io.metamask'), false);
});
