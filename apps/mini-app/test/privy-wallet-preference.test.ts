import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privySessionIntentFor } from '../src/lib/wallet/privySessionIntent';

const ee = { address: `0x${'e'.repeat(40)}`, type: 'ethereum', walletClientType: 'privy-v2', connectorType: 'embedded', walletIndex: 0, imported: false, meta: { id: 'privy' } };
const aa = { address: `0x${'a'.repeat(40)}`, type: 'ethereum', walletClientType: 'metamask', connectorType: 'injected', imported: false, meta: { id: 'io.metamask' } };
const bb = { ...aa, address: `0x${'b'.repeat(40)}` };
const snapshot = (wallets = [ee, aa], overrides = {}) => ({ ready: true, walletsReady: true, authenticated: true, userId: 'user-a', wallets, ...overrides });

test('explicit external preference survives provider remount using only the current SDK descriptor', () => {
  const document = {}; const first = privySessionIntentFor(document);
  assert.equal(first.resolveWallet(snapshot()), ee);
  assert.equal(first.selectWallet(snapshot(), aa.address), aa);
  const clone = { ...aa, chainId: 'eip155:8453', connectedAt: 123 };
  const remounted = privySessionIntentFor(document);
  assert.equal(remounted.resolveWallet(snapshot([bb, ee, clone])), clone);
  assert.equal(privySessionIntentFor({}).resolveWallet(snapshot()), ee);
});

test('initial seamless embedded preference remains pinned across remount, clones and reorder', () => {
  const document = {}; const intent = privySessionIntentFor(document);
  assert.equal(intent.resolveWallet(snapshot()), ee);
  const ff = { ...ee, address: `0x${'f'.repeat(40)}`, walletIndex: 1 };
  const clone = { ...ee };
  assert.equal(privySessionIntentFor(document).resolveWallet(snapshot([ff, clone, aa])), clone);
});

test('not-ready and empty hydration withholds authority without discarding accepted preference', () => {
  const document = {}; const intent = privySessionIntentFor(document);
  intent.selectWallet(snapshot(), aa.address);
  const remounted = privySessionIntentFor(document);
  assert.equal(remounted.resolveWallet(snapshot([], { ready: false, authenticated: false, userId: undefined, walletsReady: false })), undefined);
  assert.equal(remounted.resolveWallet(snapshot([], { walletsReady: false })), undefined);
  assert.equal(remounted.resolveWallet(snapshot([ee, aa], { walletsReady: false })), undefined);
  assert.equal(remounted.selectWallet(snapshot([ee, aa], { walletsReady: false }), ee.address), undefined);
  assert.equal(remounted.resolveWallet(snapshot()), aa);
});

test('ready disappearance requires explicit selection even after reappearance or remount', () => {
  for (const missing of [[], [ee], [bb]]) {
    const document = {}; const intent = privySessionIntentFor(document);
    intent.selectWallet(snapshot(), aa.address);
    assert.equal(intent.resolveWallet(snapshot(missing)), undefined);
    const remounted = privySessionIntentFor(document);
    assert.equal(remounted.resolveWallet(snapshot()), undefined);
    assert.equal(remounted.selectWallet(snapshot(), aa.address), aa);
    assert.equal(remounted.resolveWallet(snapshot()), aa);
  }
});

test('removed embedded pin does not silently move to another embedded wallet or return on reappearance', () => {
  const intent = privySessionIntentFor({});
  intent.resolveWallet(snapshot());
  const ff = { ...ee, address: `0x${'f'.repeat(40)}` };
  assert.equal(intent.resolveWallet(snapshot([ff, aa])), undefined);
  assert.equal(intent.resolveWallet(snapshot([ff, ee, aa])), undefined);
  assert.equal(intent.selectWallet(snapshot([ff, ee, aa]), ee.address), ee);
});

test('logout synchronously clears preference and blocks stale SDK updates across remount', () => {
  const document = {}; const intent = privySessionIntentFor(document);
  intent.selectWallet(snapshot(), aa.address);
  intent.block();
  const remounted = privySessionIntentFor(document);
  assert.equal(remounted.resolveWallet(snapshot()), undefined);
  assert.equal(remounted.selectWallet(snapshot(), aa.address), undefined);
  remounted.resume();
  assert.equal(remounted.resolveWallet(snapshot()), ee);
});

test('observed SDK logout clears the prior preference without a manual logout callback', () => {
  const intent = privySessionIntentFor({});
  intent.selectWallet(snapshot(), aa.address);
  assert.equal(intent.resolveWallet(snapshot([], { authenticated: false })), undefined);
  assert.equal(intent.resolveWallet(snapshot()), ee);
});

test('user A to B to A invalidates prior external preference synchronously, including during hydration', () => {
  for (const walletsReady of [true, false]) {
    const document = {}; const intent = privySessionIntentFor(document);
    intent.selectWallet(snapshot(), aa.address);
    assert.equal(intent.resolveWallet(snapshot([aa, bb], { userId: 'user-b', walletsReady })), undefined);
    assert.equal(privySessionIntentFor(document).resolveWallet(snapshot([aa, bb])), undefined);
    assert.equal(intent.resolveWallet(snapshot()), undefined);
  }
});

test('semantic identity rejects same-address wallet substitution and requires a new explicit choice', () => {
  for (const replacement of [
    { ...aa, walletClientType: 'rainbow' },
    { ...aa, connectorType: 'wallet_connect' },
    { ...aa, meta: { id: 'app.rainbow' } },
    { ...aa, walletIndex: 1 },
    { ...aa, imported: true },
    { ...aa, type: 'solana' },
  ]) {
    const intent = privySessionIntentFor({});
    intent.selectWallet(snapshot(), aa.address);
    assert.equal(intent.resolveWallet(snapshot([ee, replacement])), undefined);
    assert.equal(intent.resolveWallet(snapshot()), undefined);
  }
});

test('address-only explicit selection fails closed on distinct wallet identities sharing an address', () => {
  const intent = privySessionIntentFor({});
  const other = { ...aa, meta: { id: 'other.wallet' } };
  assert.equal(intent.resolveWallet(snapshot()), ee);
  assert.equal(intent.selectWallet(snapshot([ee, aa, other]), aa.address), undefined);
  assert.equal(intent.resolveWallet(snapshot()), ee);
});

test('external-only availability never accepts a new wallet, even across remount', () => {
  const document = {};
  assert.equal(privySessionIntentFor(document).resolveWallet(snapshot([aa, bb])), undefined);
  assert.equal(privySessionIntentFor(document).resolveWallet(snapshot([bb, aa])), undefined);
});

test('render reconciliation never notifies listeners and preference retains no wallet/provider objects', () => {
  const intent = privySessionIntentFor({}); let notifications = 0;
  intent.subscribe(() => { notifications++; });
  const wallet = { ...aa };
  intent.selectWallet(snapshot([ee, wallet]), aa.address);
  intent.resolveWallet(snapshot([wallet, ee]));
  wallet.meta = { id: 'mutated.wallet' };
  assert.equal(intent.resolveWallet(snapshot([wallet, ee])), undefined);
  assert.equal(notifications, 0);
});


test('logout A then login B never adopts the old embedded list and allows an explicit new choice', () => {
  const document = {}; const intent = privySessionIntentFor(document);
  intent.resolveWallet(snapshot());
  intent.block();
  intent.resolveWallet(snapshot([], { authenticated: false }));
  intent.resume();
  const nextUser = snapshot([ee, bb], { userId: 'user-b' });
  const remounted = privySessionIntentFor(document);
  assert.equal(remounted.resolveWallet(nextUser), undefined);
  assert.equal(remounted.selectWallet(nextUser, bb.address), bb);
  assert.equal(remounted.resolveWallet(nextUser), bb);
});

test('repeated StrictMode-style and interrupted reconciliation cannot revive a retired pin', () => {
  const document = {}; const intent = privySessionIntentFor(document);
  intent.selectWallet(snapshot(), aa.address);
  for (let i = 0; i < 3; i++) {
    assert.equal(intent.resolveWallet(snapshot()), aa);
  }
  // The ready missing render is interrupted before effects/commit can run.
  assert.equal(intent.resolveWallet(snapshot([ee])), undefined);
  for (let i = 0; i < 3; i++) {
    assert.equal(privySessionIntentFor(document).resolveWallet(snapshot()), undefined);
  }
  assert.equal(intent.selectWallet(snapshot(), aa.address), aa);
});

test('cross-user tombstone survives SDK auth drops and explicit logout until a fresh choice', () => {
  for (const manualLogout of [false, true]) {
    const intent = privySessionIntentFor({});
    intent.resolveWallet(snapshot());
    const userB = snapshot([ee, aa], { userId: 'user-b' });
    assert.equal(intent.resolveWallet(userB), undefined);
    if (manualLogout) intent.block();
    assert.equal(intent.resolveWallet({ ...userB, authenticated: false }), undefined);
    if (manualLogout) intent.resume();
    assert.equal(intent.resolveWallet(userB), undefined);
    assert.equal(intent.selectWallet(userB, aa.address), aa);
    assert.equal(intent.resolveWallet(userB), aa);
  }
});

test('ready disappearance tombstone survives auth loss and explicit logout/resume', () => {
  for (const manualLogout of [false, true]) {
    const intent = privySessionIntentFor({});
    intent.selectWallet(snapshot(), aa.address);
    assert.equal(intent.resolveWallet(snapshot([])), undefined);
    if (manualLogout) intent.block();
    assert.equal(intent.resolveWallet(snapshot([], { authenticated: false })), undefined);
    if (manualLogout) intent.resume();
    assert.equal(intent.resolveWallet(snapshot()), undefined);
  }
});
