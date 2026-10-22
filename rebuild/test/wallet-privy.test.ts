import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as tick } from 'node:timers/promises';
import { AppError } from '../src/domain/errors.ts';
import type { ErrorCode } from '../src/domain/errors.ts';
import type { Address, Hash, ReviewedCall } from '../src/domain/ports.ts';
import { createPrivyWallet } from '../src/wallet/privy.ts';
import type { PrivyDriver, PrivySnapshot, PrivyWalletDescriptor } from '../src/wallet/privy.ts';
import { createTelegramWallet } from '../src/wallet/telegram.ts';

const A = `0x${'a'.repeat(40)}` as Address;
const B = `0x${'b'.repeat(40)}` as Address;
const TO = `0x${'c'.repeat(40)}` as Address;
const HASH = `0x${'d'.repeat(64)}` as Hash;
const auth = () => ({ signal: new AbortController().signal, maxReadMs: 15_000, beforeDispatch() {} });
const code = (value: ErrorCode) => (error: unknown) => error instanceof AppError && error.code === value;
const call = (patch: Partial<ReviewedCall> = {}): ReviewedCall => ({ from: A, to: TO, chainId: 1, data: '0x1234', value: 10n, nonce: 2, ...patch });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}
class Provider extends EventEmitter {
  address: Address = A;
  chain = '0x1';
  calls: { method: string; params?: unknown[] }[] = [];
  hook?: (request: { method: string; params?: unknown[] }) => unknown;
  request(input: { method: string; params?: unknown[] }): unknown {
    assert.ok(this instanceof Provider);
    this.calls.push(input);
    return this.hook ? this.hook(input) : this.answer(input);
  }
  answer(input: { method: string; params?: unknown[] }): unknown {
    if (input.method === 'eth_accounts') return [this.address];
    if (input.method === 'eth_chainId') return this.chain;
    if (input.method === 'eth_sendTransaction') return HASH;
    throw new Error(`Unexpected signing request ${input.method}`);
  }
  count(method: string) { return this.calls.filter(item => item.method === method).length; }
}
function descriptor(provider: Provider, embedded = false, patch: Partial<PrivyWalletDescriptor> = {}): PrivyWalletDescriptor {
  return {
    type: 'ethereum', address: provider.address, walletClientType: embedded ? 'privy' : 'metamask', connectorType: embedded ? 'embedded' : 'injected',
    meta: { id: embedded ? 'io.privy.wallet' : 'io.metamask' }, walletIndex: embedded ? 0 : undefined, imported: false, chainId: `eip155:${Number(BigInt(provider.chain))}`,
    getEthereumProvider: async () => provider,
    switchChain: async chain => { provider.chain = `0x${chain.toString(16)}`; provider.emit('chainChanged', provider.chain); },
    ...patch,
  };
}
function setup(wallets: PrivyWalletDescriptor[], options: { scope?: object; configured?: boolean; timeout?: number } = {}) {
  const wallet = createPrivyWallet({ configured: options.configured ?? true, documentScope: options.scope ?? {}, modalTimeoutMs: options.timeout ?? 30 });
  const calls: { name: string; value?: unknown; address?: Address }[] = [];
  let send: (value: ReviewedCall, address: Address) => Promise<unknown> = async () => ({ hash: HASH });
  let logout: () => Promise<void> = async () => undefined;
  const driver: PrivyDriver = {
    login() { calls.push({ name: 'login' }); }, connectWallet() { calls.push({ name: 'connect' }); },
    createWallet: async () => { calls.push({ name: 'create' }); return {}; },
    logout: () => { calls.push({ name: 'logout' }); return logout(); },
    exportWallet: async address => { calls.push({ name: 'export', address }); },
    sendTransaction: (value, address) => { calls.push({ name: 'send', value, address }); return send(value, address); },
    setTheme: theme => { calls.push({ name: 'theme', value: theme }); },
  };
  let snapshot: PrivySnapshot = { ready: true, authenticated: true, userId: 'user-a', walletsReady: true, wallets, modalOpen: false };
  wallet.attach(driver); wallet.update(snapshot);
  return { wallet, driver, calls, setSend: (next: typeof send) => { send = next; }, setLogout: (next: typeof logout) => { logout = next; }, update: (patch: Partial<PrivySnapshot>) => { snapshot = { ...snapshot, ...patch }; wallet.update(snapshot); }, snapshot: () => snapshot };
}
async function choose(state: ReturnType<typeof setup>, index = 0) { return state.wallet.connect(state.wallet.choices()[index]!.id); }

test('missing or malformed public app ID exposes unavailable authentication without SDK initialization', async () => {
  for (const appId of [undefined, '', ' invalid ', 'https://other.example']) {
    const wallet = createTelegramWallet({ appId });
    assert.equal(wallet.management.status().state, 'unavailable');
    assert.equal(wallet.session(), null); assert.deepEqual(wallet.choices(), []);
    await assert.rejects(wallet.management.login(), code('unavailable')); wallet.dispose();
  }
});

test('initial unique embedded wallet hydrates silently only after user and wallet readiness', async () => {
  const provider = new Provider(); const state = setup([]);
  state.update({ walletsReady: false, wallets: [descriptor(provider, true)] });
  await tick(); assert.equal(state.wallet.session(), null); assert.equal(provider.calls.length, 0);
  state.update({ walletsReady: true }); await tick();
  assert.equal(state.wallet.session()?.address, A);
  assert.equal(state.wallet.management.status().state, 'connected');
  assert.deepEqual(state.calls, []); assert.equal(provider.count('eth_accounts'), 2); state.wallet.dispose();
});

test('available external wallets never become selected until an explicit choice', async () => {
  const provider = new Provider(); const state = setup([descriptor(provider)]);
  await tick(); assert.equal(state.wallet.session(), null); assert.equal(provider.calls.length, 0);
  const selected = await choose(state); assert.equal(selected.address, A);
  assert.equal(provider.count('eth_requestAccounts'), 0); state.wallet.dispose();
});

test('cloned reordered descriptors and same-document remount preserve only a semantic preference', async () => {
  const provider = new Provider(); const second = new Provider(); second.address = B;
  const scope = {}; const original = descriptor(provider); const other = descriptor(second);
  const state = setup([original, other], { scope }); const accepted = await choose(state);
  state.update({ wallets: [{ ...other }, { ...original }] });
  assert.equal(state.wallet.session()?.id, accepted.id);
  state.wallet.dispose();
  const next = setup([{ ...other }, { ...original }], { scope }); await tick();
  assert.equal(next.wallet.session()?.address, A);
  assert.notEqual(next.wallet.session()?.id, accepted.id);
  await assert.rejects(next.wallet.send(call(), accepted, auth()), code('wallet-changed'));
  assert.equal(provider.count('eth_sendTransaction'), 0); next.wallet.dispose();
});

test('hydration withholds signing authority without forgetting the selected identity', async () => {
  const provider = new Provider(); const value = descriptor(provider, true); const state = setup([value]); await tick();
  const old = state.wallet.session()!; state.update({ walletsReady: false, wallets: [] });
  assert.equal(state.wallet.session(), null);
  await assert.rejects(state.wallet.send(call(), old, auth()), code('wallet-changed'));
  state.update({ walletsReady: true, wallets: [{ ...value }] }); await tick();
  assert.equal(state.wallet.session()?.address, A); assert.notEqual(state.wallet.session()?.id, old.id); state.wallet.dispose();
});

test('a definitively missing or ambiguously duplicated identity requires explicit selection after reappearance', async () => {
  for (const collision of [false, true]) {
    const provider = new Provider(); const value = descriptor(provider, true); const state = setup([value]); await tick();
    state.update({ wallets: collision ? [value, { ...value }] : [] });
    assert.equal(state.wallet.session(), null);
    state.update({ wallets: [value] }); await tick(); assert.equal(state.wallet.session(), null);
    await choose(state); assert.equal(state.wallet.session()?.address, A); state.wallet.dispose();
  }
});

test('same-address descriptor collisions fail closed even with different wallet metadata', async () => {
  const provider = new Provider(); const state = setup([descriptor(provider), descriptor(provider, true)]);
  await tick(); assert.equal(state.wallet.session(), null); assert.ok(state.wallet.choices().every(choice => !choice.available));
  await assert.rejects(choose(state), code('unavailable')); state.wallet.dispose();
});

test('A to B to A authentication changes cannot silently re-adopt an embedded wallet', async () => {
  const provider = new Provider(); const state = setup([descriptor(provider, true)]); await tick();
  const old = state.wallet.session()!;
  state.update({ userId: 'user-b' }); await tick(); assert.equal(state.wallet.session(), null);
  state.update({ userId: 'user-a' }); await tick(); assert.equal(state.wallet.session(), null);
  await assert.rejects(state.wallet.send(call(), old, auth()), code('wallet-changed'));
  await choose(state); state.wallet.dispose();
});

test('manual logout blocks immediately and delayed SDK authentication cannot revive selection', async () => {
  const provider = new Provider(); const state = setup([descriptor(provider, true)]); await tick();
  const gate = deferred<void>(); state.setLogout(() => gate.promise);
  const exiting = state.wallet.management.logout(); assert.equal(state.wallet.session(), null);
  state.update({ authenticated: true }); await tick(); assert.equal(state.wallet.session(), null);
  state.wallet.detach(state.driver); state.wallet.attach(state.driver); state.update({ authenticated: true }); await tick(); assert.equal(state.wallet.session(), null);
  gate.resolve(); await exiting;
  await state.wallet.management.login(); await tick(); assert.equal(state.wallet.session(), null, 'Explicit new wallet selection remains required');
  await choose(state); state.wallet.dispose();
});

test('duplicate explicit choice callers share one acquisition and cancelled replacement preserves the funded wallet', async () => {
  const provider = new Provider(); const next = new Provider(); next.address = B;
  const gate = deferred<unknown>(); const state = setup([descriptor(provider), descriptor(next, false, { getEthereumProvider: () => gate.promise })]);
  const accepted = await choose(state); const id = state.wallet.choices()[1]!.id;
  const attempt = state.wallet.connect(id); assert.equal(state.wallet.connect(id), attempt);
  const rejection = assert.rejects(attempt, code('cancelled')); state.wallet.cancelConnect!(); await rejection;
  assert.equal(state.wallet.session(), accepted);
  gate.resolve(next); await tick(); assert.equal(state.wallet.session(), accepted);
  assert.equal(next.listenerCount('accountsChanged'), 0); state.wallet.dispose();
});

test('connection modal callers join one wait and late available wallets never become accepted', async () => {
  const provider = new Provider(); const other = new Provider(); other.address = B;
  const state = setup([descriptor(provider)]); const accepted = await choose(state);
  const first = state.wallet.management.connectAnother(); assert.equal(state.wallet.management.connectAnother(), first);
  assert.equal(state.calls.filter(call => call.name === 'connect').length, 1);
  state.update({ modalOpen: true }); const rejection = assert.rejects(first, code('cancelled'));
  state.wallet.cancelConnect!(); await rejection;
  await assert.rejects(state.wallet.management.connectAnother(), code('busy'));
  state.update({ wallets: [descriptor(provider), descriptor(other)], modalOpen: false });
  assert.equal(state.wallet.session(), accepted); state.wallet.dispose();
});

test('modal dismissal without a callback completes availability flow without choosing an external wallet', async () => {
  const provider = new Provider(); const state = setup([]);
  const waiting = state.wallet.management.connectAnother(); state.update({ modalOpen: true });
  state.update({ modalOpen: false, wallets: [descriptor(provider)] }); await waiting;
  assert.equal(state.wallet.session(), null); assert.equal(provider.calls.length, 0); state.wallet.dispose();
});

test('a connection modal that never opens has a bounded authored error', async () => {
  const state = setup([], { timeout: 3 });
  await assert.rejects(state.wallet.management.connectAnother(), code('unavailable'));
  assert.equal(state.wallet.management.status().state, 'choose-wallet'); state.wallet.dispose();
});

test('embedded sends use the selected address and SDK authority; external sends use only the exact provider', async () => {
  for (const embedded of [true, false]) {
    const provider = new Provider(); const state = setup([descriptor(provider, embedded)]); await tick();
    const selected = state.wallet.session() ?? await choose(state);
    assert.equal(await state.wallet.send(call(), selected, auth()), HASH);
    assert.equal(provider.count('eth_sendTransaction'), embedded ? 0 : 1);
    assert.equal(state.calls.filter(call => call.name === 'send').length, embedded ? 1 : 0);
    if (embedded) assert.deepEqual(state.calls.find(call => call.name === 'send'), { name: 'send', value: call(), address: A });
    else assert.deepEqual(provider.calls.find(call => call.method === 'eth_sendTransaction')?.params, [{ from: A, to: TO, data: '0x1234', value: '0xa', nonce: '0x2', chainId: '0x1' }]);
    state.wallet.dispose();
  }
});

test('recreated embedded provider wrappers are allowed but replacement external objects are rejected', async () => {
  for (const embedded of [true, false]) {
    const initial = new Provider(); const replacement = new Provider(); let current = initial;
    const state = setup([descriptor(initial, embedded, { getEthereumProvider: async () => current })]); await tick();
    const selected = state.wallet.session() ?? await choose(state); current = replacement;
    if (embedded) assert.equal(await state.wallet.send(call(), selected, auth()), HASH);
    else await assert.rejects(state.wallet.send(call(), selected, auth()), code('wallet-changed'));
    assert.equal(initial.count('eth_sendTransaction') + replacement.count('eth_sendTransaction'), 0); state.wallet.dispose();
  }
});

test('selected account and chain away-and-back events permanently retire held authority', async () => {
  for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
    const provider = new Provider(); const value = descriptor(provider); const state = setup([value]); const accepted = await choose(state);
    provider.emit(event, event === 'accountsChanged' ? [B] : '0x89');
    provider.emit(event, event === 'accountsChanged' ? [A] : '0x1');
    state.update({ wallets: [{ ...value }] }); await tick(); assert.equal(state.wallet.session(), null);
    await assert.rejects(state.wallet.send(call(), accepted, auth()), code('wallet-changed')); assert.equal(provider.count('eth_sendTransaction'), 0); state.wallet.dispose();
  }
});

test('a user change while provider acquisition is held produces no signing request', async () => {
  const provider = new Provider(); const gate = deferred<unknown>(); let held = false;
  const state = setup([descriptor(provider, false, { getEthereumProvider: () => held ? gate.promise : Promise.resolve(provider) })]); const accepted = await choose(state); held = true;
  const send = state.wallet.send(call(), accepted, auth()); const rejection = assert.rejects(send, code('wallet-changed'));
  state.update({ userId: 'user-b' }); gate.resolve(provider); await rejection;
  assert.equal(provider.count('eth_sendTransaction'), 0); state.wallet.dispose();
});

test('final synchronous authorization runs after reads and expiry does not consume a new review', async () => {
  const provider = new Provider(); const state = setup([descriptor(provider)]); const accepted = await choose(state); const reviewed = call();
  await assert.rejects(state.wallet.send(reviewed, accepted, { ...auth(), beforeDispatch() { throw new AppError('expired', 'Refresh review'); } }), code('expired'));
  assert.equal(provider.count('eth_sendTransaction'), 0);
  assert.equal(await state.wallet.send(reviewed, accepted, auth()), HASH); state.wallet.dispose();
});

test('a hostile request getter that logs out during the final identity fence cannot sign', async () => {
  const provider = new Provider(); const state = setup([descriptor(provider)]); const accepted = await choose(state);
  const original = provider.request; let armed = false;
  Object.defineProperty(provider, 'request', { get() { if (armed) state.wallet.disconnect(); return original; } });
  await assert.rejects(state.wallet.send(call(), accepted, { ...auth(), beforeDispatch() { armed = true; } }), code('wallet-changed'));
  assert.equal(provider.count('eth_sendTransaction'), 0); state.wallet.dispose();
});

test('concurrent confirms and equivalent reviewed calls can issue only one transaction', async () => {
  const provider = new Provider(); const state = setup([descriptor(provider)]); const accepted = await choose(state);
  const gate = deferred<unknown>(); provider.hook = input => input.method === 'eth_sendTransaction' ? gate.promise : provider.answer(input);
  const reviewed = call(); const first = state.wallet.send(reviewed, accepted, auth()); await tick();
  await assert.rejects(state.wallet.send(reviewed, accepted, auth()), code('busy'));
  gate.resolve(HASH); await first;
  await assert.rejects(state.wallet.send(call(), accepted, auth()), code('policy'));
  assert.equal(provider.count('eth_sendTransaction'), 1); state.wallet.dispose();
});

test('issued embedded results survive logout and disposal without becoming new session authority', async () => {
  const provider = new Provider(); const state = setup([descriptor(provider, true)]); await tick();
  const accepted = state.wallet.session()!; const gate = deferred<unknown>(); state.setSend(() => gate.promise);
  const sending = state.wallet.send(call(), accepted, auth()); await tick();
  assert.equal(state.calls.filter(call => call.name === 'send').length, 1);
  state.wallet.disconnect(); state.wallet.dispose(); gate.resolve({ hash: HASH });
  assert.equal(await sending, HASH); assert.equal(state.wallet.session(), null);
});

test('unknown and invalid-hash outcomes remain consumed while a definite rejection allows a fresh review', async () => {
  for (const outcome of ['unknown', 'hash', 'rejected']) {
    const provider = new Provider(); const state = setup([descriptor(provider, true)]); await tick(); const selected = state.wallet.session()!;
    state.setSend(async () => { if (outcome === 'hash') return { hash: 'wrong' }; throw { code: outcome === 'rejected' ? 4001 : -32603, message: 'PRIVATE' }; });
    const reviewed = call(); await assert.rejects(state.wallet.send(reviewed, selected, auth()), code(outcome === 'rejected' ? 'user-rejected' : 'submission-unknown'));
    state.setSend(async () => ({ hash: HASH }));
    await assert.rejects(state.wallet.send(reviewed, selected, auth()), code('policy'));
    if (outcome === 'rejected') assert.equal(await state.wallet.send(call(), selected, auth()), HASH);
    else await assert.rejects(state.wallet.send(call(), selected, auth()), code('policy'));
    state.wallet.dispose();
  }
});

test('explicit supported-chain switch obtains fresh authority and same nonce on another chain is independent', async () => {
  for (const embedded of [false, true]) {
    const provider = new Provider(); const state = setup([descriptor(provider, embedded)]); await tick(); let accepted = state.wallet.session() ?? await choose(state);
    assert.equal(await state.wallet.send(call(), accepted, auth()), HASH);
    await state.wallet.switchChain!(8453); const before = accepted; accepted = state.wallet.session()!;
    assert.equal(accepted.chainId, 8453); assert.notEqual(accepted.id, before.id);
    await assert.rejects(state.wallet.send(call({ chainId: 8453 }), before, auth()), code('wallet-changed'));
    assert.equal(await state.wallet.send(call({ chainId: 8453 }), accepted, auth()), HASH); state.wallet.dispose();
  }
});

test('export opens only the selected embedded address without login or reconnect', async () => {
  const provider = new Provider(); const state = setup([descriptor(provider, true)]); await tick();
  await state.wallet.management.exportWallet();
  assert.deepEqual(state.calls, [{ name: 'export', address: A }]); state.wallet.dispose();
});

test('cancelled or timed-out asynchronous reads cannot produce a late transaction', async () => {
  const provider = new Provider(); const state = setup([descriptor(provider)]); const selected = await choose(state);
  const gate = deferred<unknown>(); provider.hook = input => input.method === 'eth_accounts' ? gate.promise : provider.answer(input);
  await assert.rejects(state.wallet.send(call(), selected, { ...auth(), maxReadMs: 3 }), code('unavailable'));
  gate.resolve([A]); await tick(); assert.equal(provider.count('eth_sendTransaction'), 0); state.wallet.dispose();
});

test('a changed live connection timestamp invalidates authority while semantic wallet identity stays unchanged', async () => {
  const provider = new Provider(); const value = descriptor(provider, false, { connectedAt: 10, isConnected: async () => true });
  const state = setup([value]); const accepted = await choose(state);
  state.update({ wallets: [{ ...value, connectedAt: 11 }] });
  assert.equal(state.wallet.session(), null); await assert.rejects(state.wallet.send(call(), accepted, auth()), code('wallet-changed'));
  state.update({ wallets: [value] }); await tick(); assert.equal(state.wallet.session(), null); state.wallet.dispose();
});

test('fresh isConnected false and hostile event getters fail closed without a transaction', async () => {
  const provider = new Provider(); let available = true;
  const state = setup([descriptor(provider, false, { isConnected: async () => available })]); const accepted = await choose(state);
  available = false; await assert.rejects(state.wallet.send(call(), accepted, auth()), code('wallet-changed'));
  assert.equal(provider.count('eth_sendTransaction'), 0); state.wallet.dispose();
  const hostile = new Provider();
  Object.defineProperty(hostile, 'on', { get() { throw new Error('Private value'); } });
  Object.defineProperty(hostile, 'removeListener', { get() { throw new Error('Private value'); } });
  const other = setup([descriptor(hostile)]); await assert.rejects(choose(other), code('unavailable'));
  assert.equal(hostile.calls.length, 0); other.wallet.dispose();
});

test('an already open SDK confirmation blocks new signing until it closes and never replays the old action', async () => {
  const provider = new Provider(); const state = setup([descriptor(provider, true)]); await tick(); const accepted = state.wallet.session()!;
  state.update({ modalOpen: true }); await assert.rejects(state.wallet.send(call(), accepted, auth()), code('busy'));
  assert.equal(state.calls.filter(call => call.name === 'send').length, 0);
  state.update({ modalOpen: false }); assert.equal(await state.wallet.send(call(), accepted, auth()), HASH);
  state.update({ modalOpen: true }); await assert.rejects(state.wallet.management.exportWallet(), code('busy')); state.wallet.dispose();
});
