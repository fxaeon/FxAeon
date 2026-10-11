import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPrivyConnectionIntent, acceptedPrivyWallet, privyWalletSelection } from '../src/lib/wallet/privyConnectionIntent';
import { isWalletConnectCancellation } from '../src/lib/wallet/connectWatch';
const ee = { address: `0x${'e'.repeat(40)}`, type: 'ethereum', walletClientType: 'privy-v2' };
const aa = { address: `0x${'a'.repeat(40)}`, type: 'ethereum', walletClientType: 'metamask' };
const bb = { address: `0x${'b'.repeat(40)}`, type: 'ethereum', walletClientType: 'coinbase_wallet' };

test('concurrent consumers join one Privy modal invocation; close releases every waiter', async () => {
  const intent = createPrivyConnectionIntent(); let calls = 0;
  const a = intent.start(() => { calls++; }, false, true);
  const b = intent.start(() => { calls++; }, false, true);
  assert.equal(a, b); assert.equal(calls, 1);
  const result = assert.rejects(a, isWalletConnectCancellation);
  intent.observeModal(true); intent.observeModal(false);
  await result;
});
test('retiring A cannot retire or settle B through a late invocation rejection', async () => {
  const intent = createPrivyConnectionIntent(); let rejectOld!: (cause: Error) => void;
  const a = intent.start(() => new Promise((_resolve, reject) => { rejectOld = reject; }), false, true);
  const aResult = assert.rejects(a, isWalletConnectCancellation); intent.retire(); await aResult;
  let settled = false;
  const b = intent.start(() => {}, false, true);
  const bResult = b.catch((cause) => { settled = true; assert.ok(isWalletConnectCancellation(cause)); });
  rejectOld(new Error('old invocation failed')); await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  intent.observeModal(true); intent.observeModal(false); await bResult;
});
test('call-owned synchronous opening failure settles without leaving a busy intent', async () => {
  const intent = createPrivyConnectionIntent();
  await assert.rejects(intent.start(() => { throw new Error('open failed'); }, false, true), /open failed/);
  const next = intent.start(() => {}, true, true); const result = assert.rejects(next, isWalletConnectCancellation);
  intent.observeModal(false); await result;
});
test('late global payloads have no callback entry point or acceptance authority', () => {
  const intent = createPrivyConnectionIntent();
  assert.deepEqual(Object.keys(intent).sort(), ['observeModal', 'retire', 'start']);
  for (const candidates of [[ee, aa], [aa, bb, ee], [bb, ee, aa, aa]]) {
    assert.equal(acceptedPrivyWallet(candidates, 'user-a', true, undefined), ee);
  }
});
test('external-only hydration does not acquire authority without explicit selection', () => {
  assert.equal(acceptedPrivyWallet([aa, bb], 'user-a', true, undefined), undefined);
  assert.equal(acceptedPrivyWallet([aa, bb], 'user-a', true, privyWalletSelection('user-a', bb)), bb);
});
test('explicit selected wallet survives later candidate announcements and reorder', () => {
  const selection = privyWalletSelection('user-a', aa);
  assert.equal(acceptedPrivyWallet([bb, ee, aa], 'user-a', true, selection), aa);
  assert.equal(acceptedPrivyWallet([aa, bb, ee], 'user-a', true, selection), aa);
});
test('logout, changed user and removed selected account do not resurrect external authority', () => {
  const selection = privyWalletSelection('user-a', aa);
  assert.equal(acceptedPrivyWallet([aa], 'user-a', false, selection), undefined);
  assert.equal(acceptedPrivyWallet([aa], 'user-b', true, selection), undefined);
  assert.equal(acceptedPrivyWallet([bb], 'user-a', true, selection), undefined);
  assert.equal(acceptedPrivyWallet([ee], 'user-b', true, selection), undefined);
  assert.equal(acceptedPrivyWallet([ee], 'user-a', true, selection), undefined);
});
test('only valid current Ethereum choices are eligible for seamless or explicit acceptance', () => {
  for (const wallet of [{ ...aa, type: 'solana' }, { ...aa, address: 'bad' }, { ...aa, address: `0x${'0'.repeat(40)}` }]) {
    assert.equal(acceptedPrivyWallet([wallet], 'user-a', true, privyWalletSelection('user-a', wallet)), undefined);
  }
  assert.equal(acceptedPrivyWallet([ee], undefined, true, undefined), undefined);
});

test('never-opened modal releases busy with a bounded error and permits another explicit attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const intent = createPrivyConnectionIntent();
  const first = intent.start(() => {}, false, true);
  const failed = assert.rejects(first, /window did not open/);
  t.mock.timers.tick(5_000); await failed;
  const second = intent.start(() => {}, true, true);
  const closed = assert.rejects(second, isWalletConnectCancellation);
  intent.observeModal(false); await closed;
});
test('an observed modal does not time out while a person is using it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const intent = createPrivyConnectionIntent(); let settled = false;
  const result = intent.start(() => {}, false, true).catch((cause) => { settled = true; assert.ok(isWalletConnectCancellation(cause)); });
  intent.observeModal(true); t.mock.timers.tick(120_000); await Promise.resolve();
  assert.equal(settled, false);
  intent.observeModal(false); await result;
});
test('old cleared grace timer cannot end the next visible modal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const intent = createPrivyConnectionIntent();
  const first = intent.start(() => {}, false, true); const closed = assert.rejects(first, isWalletConnectCancellation);
  intent.observeModal(true); intent.observeModal(false); await closed;
  let settled = false;
  const result = intent.start(() => {}, true, true).catch((cause) => { settled = true; assert.ok(isWalletConnectCancellation(cause)); });
  t.mock.timers.tick(5_000); await Promise.resolve(); assert.equal(settled, false);
  intent.retire(); await result;
});
test('pinned initial embedded account survives another embedded account, reorder and descriptor cloning', () => {
  const ff = { ...ee, address: `0x${'f'.repeat(40)}` };
  const initial = acceptedPrivyWallet([ee], 'user-a', true, undefined)!;
  const pinned = privyWalletSelection('user-a', initial);
  const clone = { ...ee };
  assert.equal(acceptedPrivyWallet([ff, clone, aa], 'user-a', true, pinned), clone);
  assert.equal(acceptedPrivyWallet([ff], 'user-b', true, pinned), undefined);
});
