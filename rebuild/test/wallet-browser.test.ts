import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as tick } from 'node:timers/promises';
import { AppError } from '../src/domain/errors.ts';
import type { ErrorCode } from '../src/domain/errors.ts';
import type { Address, Hash, ReviewedCall } from '../src/domain/ports.ts';
import { createBrowserWallet } from '../src/wallet/browser.ts';

const A = `0x${'a'.repeat(40)}` as Address;
const B = `0x${'b'.repeat(40)}` as Address;
const ROUTER = `0x${'c'.repeat(40)}` as Address;
const HASH = `0x${'d'.repeat(64)}` as Hash;
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const GENERIC = 'injected:generic';
const authorization = () => ({ signal: new AbortController().signal, maxReadMs: 15_000, beforeDispatch() {} });
type Request = { method: string; params?: unknown[] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Provider extends EventEmitter {
  address: Address = A;
  chainId = '0x1';
  calls: Request[] = [];
  hook?: (request: Request) => unknown;
  request(request: Request): unknown {
    assert.ok(this instanceof Provider, 'The captured request uses its exact raw receiver');
    this.calls.push(request);
    if (this.hook) return this.hook(request);
    return this.answer(request);
  }
  answer(request: Request): unknown {
    if (request.method === 'eth_accounts' || request.method === 'eth_requestAccounts') return [this.address];
    if (request.method === 'eth_chainId') return this.chainId;
    if (request.method === 'eth_sendTransaction') return HASH;
    if (request.method === 'wallet_switchEthereumChain') {
      this.chainId = '0x1';
      this.emit('chainChanged', this.chainId);
      return null;
    }
    throw new Error(`Unexpected method ${request.method}`);
  }
  count(method: string): number { return this.calls.filter(item => item.method === method).length; }
}

function setup(initial: unknown = undefined) {
  const events = new EventTarget();
  let injected = initial;
  const wallet = createBrowserWallet({ events, injected: () => injected });
  return { wallet, events, inject: (value: unknown) => { injected = value; } };
}

function announce(events: EventTarget, provider: unknown, uuid = UUID_A, rdns = 'io.metamask', name = 'MetaMask', icon?: () => never): void {
  const info = { uuid, rdns, name };
  if (icon) Object.defineProperty(info, 'icon', { get: icon });
  events.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info, provider } }));
}

function code(expected: ErrorCode): (error: unknown) => boolean {
  return error => error instanceof AppError && error.code === expected;
}

function call(patch: Partial<ReviewedCall> = {}): ReviewedCall {
  return { chainId: 1, from: A, to: ROUTER, data: '0x1234', value: 100n, nonce: 2, ...patch };
}

test('wallet discovery is passive, uses local labels, and never reads a provider icon', async () => {
  const metaMask = new Provider();
  const rabby = new Provider();
  const { wallet, events } = setup(rabby);
  let iconReads = 0;
  announce(events, metaMask, UUID_A, 'io.metamask', 'MetaMask', () => { iconReads += 1; throw new Error('Remote icon'); });
  announce(events, rabby, UUID_B, 'io.rabby', 'Rabby Wallet');
  assert.deepEqual(wallet.choices().map(item => item.name), ['MetaMask', 'Rabby']);
  assert.equal(iconReads, 0);
  assert.equal(metaMask.calls.length + rabby.calls.length, 0);
  const session = await wallet.connect(`eip6963:${UUID_A}`);
  assert.equal(session.label, 'MetaMask');
  assert.equal(rabby.calls.length, 0);
  assert.equal(await wallet.send(call(), session, authorization()), HASH);
  assert.equal(metaMask.count('eth_sendTransaction'), 1);
  assert.equal(rabby.count('eth_sendTransaction'), 0);
  wallet.dispose();
});

test('generic injection is explicit and permits only an unambiguous provider object', async () => {
  const first = new Provider();
  const second = new Provider();
  const { wallet, inject } = setup({ providers: [first, second] });
  assert.deepEqual(wallet.choices(), []);
  await assert.rejects(wallet.connect(GENERIC), code('unavailable'));
  inject({ providers: [first] });
  assert.equal(wallet.choices()[0]?.name, 'Injected browser wallet (unverified)');
  await wallet.connect(GENERIC);
  assert.equal(first.count('eth_requestAccounts'), 1);
  assert.equal(second.calls.length, 0);
  wallet.dispose();
});

test('throwing or revoked discovery getters fail closed without a provider prompt', async () => {
  const { wallet, inject, events } = setup({ get providers() { throw new Error('Provider secret'); } });
  assert.deepEqual(wallet.choices(), []);
  inject({ get request() { throw new Error('Provider secret'); } });
  assert.deepEqual(wallet.choices(), []);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  inject(revoked.proxy);
  assert.deepEqual(wallet.choices(), []);
  events.dispatchEvent(Object.defineProperty(new Event('eip6963:announceProvider'), 'detail', { get() { throw new Error('malformed'); } }));
  assert.deepEqual(wallet.choices(), []);
  await assert.rejects(wallet.connect(GENERIC), code('unavailable'));
  wallet.dispose();
});

test('duplicate exact-object announcements deduplicate, while same-brand collisions block both', async () => {
  const first = new Provider();
  const other = new Provider();
  const { wallet, events } = setup(first);
  announce(events, first);
  announce(events, first, UUID_B, 'io.metamask', 'MetaMask Mobile');
  assert.equal(wallet.choices().length, 1);
  announce(events, other, UUID_C);
  assert.equal(wallet.choices().length, 2);
  assert.ok(wallet.choices().every(item => !item.available));
  await assert.rejects(wallet.connect(GENERIC), code('unavailable'));
  await assert.rejects(wallet.connect(`eip6963:${UUID_A}`), code('unavailable'));
  assert.equal(first.calls.length + other.calls.length, 0);
  wallet.dispose();
});

test('UUID substitution and conflicting local brand claims retire an accepted provider', async () => {
  const original = new Provider();
  const replacement = new Provider();
  const { wallet, events } = setup(original);
  announce(events, original);
  const session = await wallet.connect(`eip6963:${UUID_A}`);
  announce(events, replacement);
  assert.equal(wallet.session(), null);
  await assert.rejects(wallet.send(call(), session, authorization()), code('wallet-changed'));
  announce(events, original, UUID_C, 'io.rabby', 'Rabby');
  assert.ok(wallet.choices().every(item => !item.available));
  assert.equal(original.count('eth_sendTransaction') + replacement.count('eth_sendTransaction'), 0);
  wallet.dispose();
});

test('unknown announcements receive a neutral authored label and never borrow known-wallet branding', () => {
  const { wallet, events } = setup();
  announce(events, new Provider(), UUID_A, 'evil.example', '<script>MetaMask</script>');
  assert.equal(wallet.choices()[0]?.name, 'Announced browser wallet 1');
  announce(events, new Provider(), UUID_B, 'io.metamask', 'MetaMask\u0000');
  assert.equal(wallet.choices()[1]?.available, false);
  wallet.dispose();
});

test('duplicate connect callers share one prompt and cancellation retains the native prompt lock', async () => {
  const provider = new Provider();
  const gate = deferred<unknown>();
  provider.hook = request => request.method === 'eth_requestAccounts' ? gate.promise : provider.answer(request);
  const { wallet } = setup(provider);
  const first = wallet.connect(GENERIC);
  assert.equal(wallet.connect(GENERIC), first);
  assert.equal(provider.count('eth_requestAccounts'), 1);
  const rejected = assert.rejects(first, code('cancelled'));
  wallet.cancelConnect();
  await rejected;
  await assert.rejects(wallet.connect(GENERIC), code('busy'));
  gate.resolve([A]);
  await tick();
  assert.equal(wallet.session(), null);
  assert.equal(provider.listenerCount('accountsChanged'), 0);
  provider.hook = undefined;
  await wallet.connect(GENERIC);
  assert.equal(provider.count('eth_requestAccounts'), 2);
  wallet.dispose();
});

test('cancelling a replacement chooser preserves the previously accepted wallet', async () => {
  const first = new Provider();
  const next = new Provider();
  const { wallet, events } = setup();
  announce(events, first);
  announce(events, next, UUID_B, 'io.rabby', 'Rabby');
  const accepted = await wallet.connect(`eip6963:${UUID_A}`);
  const gate = deferred<unknown>();
  next.hook = request => request.method === 'eth_requestAccounts' ? gate.promise : next.answer(request);
  const replacement = wallet.connect(`eip6963:${UUID_B}`);
  const rejected = assert.rejects(replacement, code('cancelled'));
  wallet.cancelConnect();
  await rejected;
  assert.equal(wallet.session(), accepted);
  assert.equal(first.listenerCount('accountsChanged'), 1);
  gate.resolve([A]);
  await tick();
  assert.equal(wallet.session(), accepted);
  assert.equal(next.listenerCount('accountsChanged'), 0);
  await wallet.assertSession(accepted);
  wallet.dispose();
});

test('disconnect during a connection ignores the late authorization and cannot revive it', async () => {
  const provider = new Provider();
  const gate = deferred<unknown>();
  provider.hook = request => request.method === 'eth_requestAccounts' ? gate.promise : provider.answer(request);
  const { wallet } = setup(provider);
  const pending = wallet.connect(GENERIC);
  const rejected = assert.rejects(pending, code('cancelled'));
  wallet.disconnect();
  await rejected;
  gate.resolve([A]);
  await tick();
  assert.equal(wallet.session(), null);
  assert.equal(provider.count('eth_accounts'), 0);
  wallet.dispose();
});

test('provider rejection stays authored and code 4001 survives connection retirement', async () => {
  const provider = new Provider();
  provider.hook = () => { throw { code: 4001, message: 'Untrusted provider secrets' }; };
  const { wallet } = setup(provider);
  await assert.rejects(wallet.connect(GENERIC), error => code('user-rejected')(error) && !(error as Error).message.includes('secrets'));
  assert.equal(wallet.session(), null);
  assert.equal(provider.listenerCount('chainChanged'), 0);
  wallet.dispose();
});

test('hostile subscription getters are rejected before requesting wallet accounts', async () => {
  const provider = new Provider();
  Object.defineProperty(provider, 'on', { get() { throw new Error('secret'); } });
  const { wallet } = setup(provider);
  await assert.rejects(wallet.connect(GENERIC), code('unavailable'));
  assert.equal(provider.calls.length, 0);
  wallet.dispose();
});

test('account and chain away-and-back events permanently retire the original session', async () => {
  for (const event of ['accountsChanged', 'chainChanged']) {
    const provider = new Provider();
    const { wallet } = setup(provider);
    const session = await wallet.connect(GENERIC);
    provider.emit(event, event === 'accountsChanged' ? [B] : '0x89');
    provider.emit(event, event === 'accountsChanged' ? [A] : '0x1');
    assert.equal(wallet.session(), null);
    await assert.rejects(wallet.send(call(), session, authorization()), code('wallet-changed'));
    assert.equal(provider.count('eth_sendTransaction'), 0);
    wallet.dispose();
  }
});

test('fresh double reads reject eventless account or chain drift before any send', async () => {
  for (const method of ['eth_accounts', 'eth_chainId']) {
    const provider = new Provider();
    const { wallet } = setup(provider);
    const session = await wallet.connect(GENERIC);
    let reads = 0;
    provider.hook = request => {
      if (request.method === method && ++reads === 2) return method === 'eth_accounts' ? [B] : '0x89';
      return provider.answer(request);
    };
    await assert.rejects(wallet.send(call(), session, authorization()), code(method === 'eth_accounts' ? 'wallet-changed' : 'wrong-chain'));
    assert.equal(wallet.session(), null);
    assert.equal(provider.count('eth_sendTransaction'), 0);
    wallet.dispose();
  }
});

test('requestAccounts and fresh accounts must agree even when no change event is emitted', async () => {
  const provider = new Provider();
  provider.hook = request => request.method === 'eth_requestAccounts' ? [B] : provider.answer(request);
  const { wallet } = setup(provider);
  await assert.rejects(wallet.connect(GENERIC), code('wallet-changed'));
  assert.equal(wallet.session(), null);
  wallet.dispose();
});

test('injected object and request-function replacement cannot reuse an accepted same-address session', async () => {
  for (const replace of ['object', 'request']) {
    const provider = new Provider();
    const replacement = new Provider();
    const { wallet, inject } = setup(provider);
    const session = await wallet.connect(GENERIC);
    if (replace === 'object') inject(replacement);
    else provider.request = request => replacement.request(request);
    await assert.rejects(wallet.send(call(), session, authorization()), code('wallet-changed'));
    assert.equal(wallet.session(), null);
    assert.equal(provider.count('eth_sendTransaction') + replacement.count('eth_sendTransaction'), 0);
    wallet.dispose();
  }
});

test('disconnect while a fresh read is pending fences the undispatched transaction', async () => {
  const provider = new Provider();
  const { wallet } = setup(provider);
  const session = await wallet.connect(GENERIC);
  const gate = deferred<unknown>();
  provider.hook = request => request.method === 'eth_accounts' ? gate.promise : provider.answer(request);
  const send = wallet.send(call(), session, authorization());
  wallet.disconnect();
  gate.resolve([A]);
  await assert.rejects(send, code('wallet-changed'));
  assert.equal(provider.count('eth_sendTransaction'), 0);
  wallet.dispose();
});

test('a duplicate event during the double read invalidates that attempt even if values match', async () => {
  const provider = new Provider();
  const { wallet } = setup(provider);
  const session = await wallet.connect(GENERIC);
  provider.hook = request => {
    if (request.method === 'eth_chainId') provider.emit('accountsChanged', [A]);
    return provider.answer(request);
  };
  await assert.rejects(wallet.send(call(), session, authorization()), code('wallet-changed'));
  assert.equal(provider.count('eth_sendTransaction'), 0);
  wallet.dispose();
});

test('concurrent send callers dispatch only once and no fee fields are supplied to the wallet', async () => {
  const provider = new Provider();
  const { wallet } = setup(provider);
  const session = await wallet.connect(GENERIC);
  const reviewed = call();
  const first = wallet.send(reviewed, session, authorization());
  await assert.rejects(wallet.send(reviewed, session, authorization()), code('busy'));
  assert.equal(await first, HASH);
  assert.equal(provider.count('eth_sendTransaction'), 1);
  const sent = provider.calls.find(item => item.method === 'eth_sendTransaction');
  assert.deepEqual(sent?.params, [{ from: A, to: ROUTER, data: '0x1234', value: '0x64', nonce: '0x2', chainId: '0x1' }]);
  wallet.dispose();
});

test('transaction snapshot cannot be mutated by its caller during preflight', async () => {
  const provider = new Provider();
  const { wallet } = setup(provider);
  const session = await wallet.connect(GENERIC);
  const reviewed = { ...call() };
  const sending = wallet.send(reviewed, session, authorization());
  reviewed.to = B;
  reviewed.value = 999n;
  await sending;
  const sent = provider.calls.find(item => item.method === 'eth_sendTransaction');
  assert.equal((sent?.params?.[0] as { to: Address }).to, ROUTER);
  assert.equal((sent?.params?.[0] as { value: string }).value, '0x64');
  wallet.dispose();
});

test('a settled send cannot be replayed by the original caller or an equivalent call object', async () => {
  const provider = new Provider();
  const { wallet } = setup(provider);
  const session = await wallet.connect(GENERIC);
  const reviewed = call();
  assert.equal(await wallet.send(reviewed, session, authorization()), HASH);
  await assert.rejects(wallet.send(reviewed, session, authorization()), code('policy'));
  await assert.rejects(wallet.send({ ...reviewed }, session, authorization()), code('policy'));
  assert.equal(provider.count('eth_sendTransaction'), 1);
  wallet.dispose();
});

test('a definite rejection permits a fresh explicit review with the same bytes but never the old reviewed call', async () => {
  const provider = new Provider();
  const { wallet } = setup(provider);
  const session = await wallet.connect(GENERIC);
  const rejectedReview = call();
  provider.hook = request => { if (request.method === 'eth_sendTransaction') throw { code: 4001 }; return provider.answer(request); };
  await assert.rejects(wallet.send(rejectedReview, session, authorization()), code('user-rejected'));
  provider.hook = undefined;
  await assert.rejects(wallet.send(rejectedReview, session, authorization()), code('policy'));
  assert.equal(await wallet.send({ ...rejectedReview }, session, authorization()), HASH);
  assert.equal(provider.count('eth_sendTransaction'), 2);
  wallet.dispose();
});

test('an uncertain issued outcome blocks a same-byte new review and cannot be retried after reconnect', async () => {
  const provider = new Provider();
  const { wallet } = setup(provider);
  const session = await wallet.connect(GENERIC);
  provider.hook = request => request.method === 'eth_sendTransaction' ? undefined : provider.answer(request);
  await assert.rejects(wallet.send(call(), session, authorization()), code('submission-unknown'));
  provider.hook = undefined;
  wallet.disconnect();
  const replacementSession = await wallet.connect(GENERIC);
  await assert.rejects(wallet.send(call(), replacementSession, authorization()), code('policy'));
  assert.equal(provider.count('eth_sendTransaction'), 1);
  wallet.dispose();
});

test('invalid transaction fields fail before any send and leave valid session usable', async () => {
  const provider = new Provider();
  const { wallet } = setup(provider);
  const session = await wallet.connect(GENERIC);
  const invalid: Partial<ReviewedCall>[] = [
    { from: B }, { to: '0x' }, { data: '0x123' }, { data: '0xgg' },
    { value: -1n }, { value: 2n ** 256n }, { nonce: -1 }, { nonce: 0.5 }, { nonce: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const patch of invalid) await assert.rejects(wallet.send(call(patch), session, authorization()), code('policy'));
  await assert.rejects(wallet.send(call({ chainId: 2 as 1 }), session, authorization()), code('wrong-chain'));
  assert.equal(provider.count('eth_sendTransaction'), 0);
  await wallet.assertSession(session);
  wallet.dispose();
});

test('already-issued request retains its hash through disconnect, replacement, and disposal without replay', async () => {
  const original = new Provider();
  const replacement = new Provider();
  const { wallet, events } = setup();
  announce(events, original);
  announce(events, replacement, UUID_B, 'io.rabby', 'Rabby');
  const session = await wallet.connect(`eip6963:${UUID_A}`);
  const result = deferred<unknown>();
  original.hook = request => request.method === 'eth_sendTransaction' ? result.promise : original.answer(request);
  const sending = wallet.send(call(), session, authorization());
  await tick();
  assert.equal(original.count('eth_sendTransaction'), 1);
  wallet.disconnect();
  const fresh = await wallet.connect(`eip6963:${UUID_B}`);
  await assert.rejects(wallet.send(call(), fresh, authorization()), code('busy'));
  wallet.dispose();
  result.resolve(HASH.toUpperCase().replace('0X', '0x'));
  assert.equal(await sending, HASH);
  assert.equal(replacement.count('eth_sendTransaction'), 0);
  assert.equal(wallet.session(), null);
});

test('invalid or missing issued hash and unclassified issued failures remain submission-unknown', async () => {
  for (const result of [undefined, null, '0x1', `0x${'z'.repeat(64)}`, { hash: HASH }, new Error('Wallet secret')]) {
    const provider = new Provider();
    const { wallet } = setup(provider);
    const session = await wallet.connect(GENERIC);
    provider.hook = request => {
      if (request.method !== 'eth_sendTransaction') return provider.answer(request);
      wallet.disconnect();
      if (result instanceof Error) throw result;
      return result;
    };
    await assert.rejects(wallet.send(call(), session, authorization()), error => code('submission-unknown')(error) && !(error as Error).message.includes('secret'));
    assert.equal(provider.count('eth_sendTransaction'), 1);
    wallet.dispose();
  }
});

test('issued explicit rejection stays user-rejected while hostile error-code getters reveal nothing', async () => {
  for (const error of [{ code: 4001 }, { get code() { throw new Error('secret'); }, message: 'secret' }]) {
    const provider = new Provider();
    const { wallet } = setup(provider);
    const session = await wallet.connect(GENERIC);
    provider.hook = request => {
      if (request.method !== 'eth_sendTransaction') return provider.answer(request);
      wallet.disconnect();
      throw error;
    };
    const expected = Object.getOwnPropertyDescriptor(error, 'code')?.value === 4001 ? 'user-rejected' : 'submission-unknown';
    await assert.rejects(wallet.send(call(), session, authorization()), code(expected));
    assert.equal(provider.count('eth_sendTransaction'), 1);
    wallet.dispose();
  }
});

test('wrong chain is visible after connect and only explicit switch prompts for Ethereum', async () => {
  const provider = new Provider();
  provider.chainId = '0x89';
  const { wallet } = setup(provider);
  const old = await wallet.connect(GENERIC);
  assert.equal(old.chainId, 137);
  assert.equal(provider.count('wallet_switchEthereumChain'), 0);
  await assert.rejects(wallet.send(call(), old, authorization()), code('wrong-chain'));
  await wallet.switchToEthereum();
  const fresh = wallet.session();
  assert.equal(fresh?.chainId, 1);
  assert.notEqual(fresh?.id, old.id);
  assert.equal(provider.count('wallet_switchEthereumChain'), 1);
  assert.equal(provider.count('wallet_addEthereumChain'), 0);
  await assert.rejects(wallet.send(call(), old, authorization()), code('wallet-changed'));
  wallet.dispose();
});

test('concurrent network-switch callers cannot open duplicate prompts', async () => {
  const provider = new Provider();
  provider.chainId = '0xa';
  const { wallet } = setup(provider);
  await wallet.connect(GENERIC);
  const results = await Promise.allSettled([wallet.switchToEthereum(), wallet.switchToEthereum()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(provider.count('wallet_switchEthereumChain'), 1);
  wallet.dispose();
});

test('unknown-chain switch failure never adds a chain or retries another provider', async () => {
  const provider = new Provider();
  provider.chainId = '0xa';
  const { wallet } = setup(provider);
  await wallet.connect(GENERIC);
  provider.hook = request => { if (request.method === 'wallet_switchEthereumChain') throw { code: 4902 }; return provider.answer(request); };
  await assert.rejects(wallet.switchToEthereum(), code('unavailable'));
  assert.equal(provider.count('wallet_switchEthereumChain'), 1);
  assert.equal(provider.count('wallet_addEthereumChain'), 0);
  assert.equal(wallet.session(), null);
  wallet.dispose();
});

test('observer exceptions and disposed late announcements cannot change signing authority', async () => {
  const provider = new Provider();
  const { wallet, events } = setup(provider);
  wallet.subscribe(() => { throw new Error('UI observer'); });
  const session = await wallet.connect(GENERIC);
  await wallet.assertSession(session);
  wallet.dispose();
  announce(events, new Provider());
  assert.deepEqual(wallet.choices(), []);
  assert.equal(provider.listenerCount('disconnect'), 0);
  await assert.rejects(wallet.connect(GENERIC), code('cancelled'));
});

test('final synchronous review guard runs after awaited reads and blocks expired authority without consuming the call', async () => {
  const provider = new Provider(); const { wallet } = setup(provider);
  const session = await wallet.connect(GENERIC); const reviewed = call();
  let expired = false; let guards = 0;
  provider.hook = request => { if (request.method === 'eth_accounts') expired = true; return provider.answer(request); };
  await assert.rejects(wallet.send(reviewed, session, { ...authorization(), beforeDispatch() {
    guards++; assert.equal(expired, true); throw new AppError('expired', 'Expired in final wallet read');
  } }), code('expired'));
  assert.equal(guards, 1); assert.equal(provider.count('eth_sendTransaction'), 0);
  assert.equal(await wallet.send(reviewed, session, authorization()), HASH);
  wallet.dispose();
});

test('cancelled and timed-out final reads release the send reservation without issuing a wallet transaction', async () => {
  for (const cancel of [false, true]) {
    const provider = new Provider(); const { wallet } = setup(provider);
    const session = await wallet.connect(GENERIC); const gate = deferred<unknown>();
    provider.hook = request => request.method === 'eth_accounts' ? gate.promise : provider.answer(request);
    const abort = new AbortController(); let guards = 0;
    const sending = wallet.send(call(), session, { signal: abort.signal, maxReadMs: 10, beforeDispatch() { guards++; } });
    if (cancel) abort.abort();
    await assert.rejects(sending, code(cancel ? 'cancelled' : 'unavailable'));
    assert.equal(guards, 0); assert.equal(provider.count('eth_sendTransaction'), 0);
    provider.hook = undefined; gate.resolve([A]); await tick();
    assert.equal(await wallet.send(call(), session, authorization()), HASH);
    wallet.dispose();
  }
});

test('the read deadline never abandons an already issued wallet prompt', async () => {
  const provider = new Provider(); const { wallet } = setup(provider);
  const session = await wallet.connect(GENERIC); const answer = deferred<unknown>();
  provider.hook = request => request.method === 'eth_sendTransaction' ? answer.promise : provider.answer(request);
  let settled = false;
  const sending = wallet.send(call(), session, { ...authorization(), maxReadMs: 5 }).finally(() => { settled = true; });
  await tick(); assert.equal(provider.count('eth_sendTransaction'), 1);
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(settled, false);
  answer.resolve(HASH); assert.equal(await sending, HASH); wallet.dispose();
});
