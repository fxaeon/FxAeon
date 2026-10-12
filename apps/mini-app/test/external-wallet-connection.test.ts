import assert from 'node:assert/strict';
import test from 'node:test';
import { createExternalWalletConnection, readInjectedWalletSession, requestInjectedAccounts, validWalletAccounts, type ExternalWalletAttemptState } from '../src/lib/wallet/externalWalletConnection';
import type { Eip6963Provider } from '../src/lib/wallet/eip6963';

const address = '0x00000000000000000000000000000000000000aa';
const otherAddress = '0x00000000000000000000000000000000000000bb';
const deferred = <T>() => {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const wallet = { id: 'selected', name: 'Selected wallet' };
function setup() {
  const states: ExternalWalletAttemptState[] = [];
  const committed: string[] = [];
  const flow = createExternalWalletConnection<string>({ onState: (state) => states.push(state), onCommit: (session) => committed.push(session) });
  return { flow, states, committed };
}

test('all CTA consumers share one connection promise and repeated selection requests once', async () => {
  const { flow, committed } = setup(); const pending = deferred<string>(); let requests = 0;
  const first = flow.open(); const second = flow.open();
  assert.equal(first, second);
  const run = () => { requests += 1; return pending.promise; };
  flow.select(wallet, run); flow.select(wallet, run);
  await tick(); assert.equal(requests, 1);
  pending.resolve('approved'); await first;
  assert.deepEqual(committed, ['approved']); assert.equal(flow.getState().status, 'closed');
});

test('closing settles shared callers and late approval cannot publish or close a reopened flow', async () => {
  const { flow, committed } = setup(); const stale = deferred<string>();
  const first = flow.open(); const cancelled = assert.rejects(first, { name: 'WalletConnectCancelledError' });
  flow.select(wallet, () => stale.promise); await tick(); flow.cancel(); await cancelled;
  const second = flow.open(); assert.notEqual(first, second);
  stale.resolve('stale'); await tick();
  assert.deepEqual(committed, []); assert.equal(flow.getState().status, 'choosing');
  flow.select(wallet, async () => 'new'); await second; assert.deepEqual(committed, ['new']);
});

test('new choice owns completion even when earlier wallet approves later', async () => {
  const { flow, committed } = setup(); const old = deferred<string>(); const recent = deferred<string>();
  const promise = flow.open(); flow.select(wallet, () => old.promise); await tick();
  flow.select({ id: 'other', name: 'Other' }, () => recent.promise); await tick();
  recent.resolve('new'); await promise; old.resolve('old'); await tick(); assert.deepEqual(committed, ['new']);
});

test('Back invalidates prompt without settling the chooser; retry can then succeed', async () => {
  const { flow, committed } = setup(); const stale = deferred<string>(); let signal: AbortSignal | undefined;
  const promise = flow.open(); flow.select(wallet, (current) => { signal = current; return stale.promise; }); await tick();
  flow.back(); assert.equal(signal?.aborted, true); assert.equal(flow.getState().status, 'choosing');
  stale.resolve('obsolete'); await tick(); assert.deepEqual(committed, []);
  flow.select(wallet, async () => 'approved'); await promise; assert.deepEqual(committed, ['approved']);
});

test('rejection is visible, preserves the shared request and allows same-wallet retry', async () => {
  const { flow, committed } = setup(); const promise = flow.open();
  flow.select(wallet, async () => { throw Object.assign(new Error('denied'), { code: 4001 }); }); await tick();
  assert.deepEqual(flow.getState(), { status: 'error', walletId: wallet.id, name: wallet.name, message: 'Connection wasn’t completed. Try again.' });
  assert.equal(flow.open(), promise); assert.deepEqual(committed, []);
  flow.select(wallet, async () => 'retry'); await promise; assert.deepEqual(committed, ['retry']);
});

test('cancelled replacement never changes the previously committed session', async () => {
  let active = 'funded'; const states: ExternalWalletAttemptState[] = [];
  const flow = createExternalWalletConnection<string>({ onState: (s) => states.push(s), onCommit: (s) => { active = s; } });
  const pending = deferred<string>(); const promise = flow.open(); const cancelled = assert.rejects(promise);
  flow.select(wallet, () => pending.promise); await tick(); flow.cancel(); await cancelled;
  pending.resolve('replacement'); await tick(); assert.equal(active, 'funded');
});

test('cancel before the operation microtask never calls the provider', async () => {
  const { flow } = setup(); let requests = 0; const promise = flow.open(); const cancelled = assert.rejects(promise);
  flow.select(wallet, async () => { requests += 1; return 'bad'; }); flow.cancel(); await cancelled; await tick(); assert.equal(requests, 0);
});

test('stale rejection cannot overwrite the next error or successful session', async () => {
  const { flow, committed } = setup(); const stale = deferred<string>(); const promise = flow.open();
  flow.select(wallet, () => stale.promise); await tick(); flow.back();
  flow.select(wallet, async () => 'new'); await promise; stale.reject(new Error('old error')); await tick();
  assert.deepEqual(committed, ['new']); assert.equal(flow.getState().status, 'closed');
});

function fixture() {
  const calls: string[] = []; const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let accounts: unknown = [address]; let chain: unknown = '0x1';
  let intercept: ((method: string) => Promise<unknown> | undefined) | undefined;
  const provider: Eip6963Provider = {
    request: async ({ method }) => { calls.push(method); const result = intercept?.(method); if (result) return result; return method === 'eth_chainId' ? chain : accounts; },
    on: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
    removeListener: (name, fn) => { listeners.get(name)?.delete(fn); },
  };
  return { provider, calls, setAccounts: (value: unknown) => { accounts = value; }, setChain: (value: unknown) => { chain = value; }, intercept: (fn: typeof intercept) => { intercept = fn; }, emit: (name: string) => { listeners.get(name)?.forEach((fn) => fn()); }, listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0) };
}

test('validated connection retains exact provider and approved Ethereum account', async () => {
  const f = fixture(); const result = await readInjectedWalletSession(f.provider, { requestAccounts: true });
  assert.equal(result?.provider, f.provider); assert.equal(result?.address, address); assert.equal(result?.chainId, 1);
  assert.deepEqual(f.calls, ['eth_requestAccounts', 'eth_chainId', 'eth_accounts', 'eth_chainId']); assert.equal(f.listenerCount(), 0);
});

test('silent restore never prompts and restores only the remembered approved account', async () => {
  const f = fixture(); f.setAccounts([otherAddress, address]); f.setChain('0x2105');
  const result = await readInjectedWalletSession(f.provider, { requestAccounts: false, preferredAddress: address });
  assert.equal(result?.address, address); assert.equal(result?.chainId, 8453); assert.equal(f.calls.includes('eth_requestAccounts'), false);
  f.setAccounts([otherAddress]); assert.equal(await readInjectedWalletSession(f.provider, { requestAccounts: false, preferredAddress: address }), undefined);
});

test('missing account is disconnected; malformed approval cannot publish', async () => {
  for (const accounts of [[], null, ['bad'], [address, null], ['0x0000000000000000000000000000000000000000']]) {
    const f = fixture(); f.setAccounts(accounts);
    assert.equal(await readInjectedWalletSession(f.provider, { requestAccounts: false }), undefined);
    await assert.rejects(readInjectedWalletSession(f.provider, { requestAccounts: true }), /valid account/); assert.equal(f.listenerCount(), 0);
  }
});

test('unsupported or malformed chain never becomes a usable connection', async () => {
  for (const chain of ['0x89', 'garbage', null, '0x1z', {}, 1]) {
    const f = fixture(); f.setChain(chain); await assert.rejects(readInjectedWalletSession(f.provider, { requestAccounts: true }), /Ethereum or Base/);
  }
});

test('account disappearance during chain read aborts publication', async () => {
  const f = fixture(); f.intercept((method) => { if (method === 'eth_chainId') { f.setAccounts([]); return Promise.resolve('0x1'); } });
  await assert.rejects(readInjectedWalletSession(f.provider, { requestAccounts: true }), /changed/);
});

test('chain changes without an event are caught by the final read', async () => {
  const f = fixture(); let chains = 0;
  f.intercept((method) => method === 'eth_chainId' ? Promise.resolve(++chains === 1 ? '0x1' : '0x2105') : undefined);
  await assert.rejects(readInjectedWalletSession(f.provider, { requestAccounts: true }), /changed/);
});

test('identity and chain events invalidate an in-flight preflight', async () => {
  for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
    const f = fixture(); const pending = deferred<unknown>();
    f.intercept((method) => method === 'eth_chainId' ? pending.promise : undefined);
    const request = readInjectedWalletSession(f.provider, { requestAccounts: true }); await tick(); f.emit(event); pending.resolve('0x1');
    await assert.rejects(request, /changed/); assert.equal(f.listenerCount(), 0);
  }
});

test('cancel removes listeners promptly while the unwithdrawable injected prompt remains shared', async () => {
  const f = fixture(); const prompt = deferred<unknown>(); f.intercept((method) => method === 'eth_requestAccounts' ? prompt.promise : undefined);
  const controller = new AbortController(); const old = readInjectedWalletSession(f.provider, { requestAccounts: true, signal: controller.signal });
  await tick(); controller.abort(); await assert.rejects(old, { name: 'WalletConnectCancelledError' }); assert.equal(f.listenerCount(), 0);
  const recent = readInjectedWalletSession(f.provider, { requestAccounts: true }); await tick();
  assert.equal(f.calls.filter((method) => method === 'eth_requestAccounts').length, 1);
  prompt.resolve([address]); assert.equal((await recent)?.address, address); assert.equal(f.listenerCount(), 0);
});

test('provider prompt sharing never crosses objects, even with the same approved account', async () => {
  const first = fixture(); const second = fixture();
  const one = requestInjectedAccounts(first.provider); assert.equal(one, requestInjectedAccounts(first.provider));
  const two = requestInjectedAccounts(second.provider); assert.notEqual(one, two); await Promise.all([one, two]);
  assert.equal(first.calls.length, 1); assert.equal(second.calls.length, 1);
});

test('an aborted session never requests accounts and valid account normalization is bounded by validity', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(readInjectedWalletSession(f.provider, { requestAccounts: true, signal: controller.signal })); assert.deepEqual(f.calls, []);
  assert.deepEqual(validWalletAccounts([address, address.toUpperCase().replace('0X', '0x')]), [address.toUpperCase().replace('0X', '0x')]);
});

test('wallet browser or installation navigation stays disconnected and does not settle connect', async () => {
  const { flow, committed } = setup(); const stale = deferred<string>();
  const promise = flow.open(); const cancelled = assert.rejects(promise);
  flow.select(wallet, () => stale.promise); await tick();
  let launched = 0; flow.handoff(wallet, 'Continue in the wallet browser.', () => { launched += 1; });
  assert.equal(launched, 1); assert.equal(flow.getState().status, 'handoff');
  stale.resolve('not a connection'); await tick(); assert.deepEqual(committed, []);
  flow.cancel(); await cancelled;
});

test('a navigation exception is an error, never a connected session', async () => {
  const { flow, committed } = setup(); const promise = flow.open(); const cancelled = assert.rejects(promise);
  flow.handoff(wallet, 'Continue there.', () => { throw new Error('blocked'); });
  assert.equal(flow.getState().status, 'error'); assert.deepEqual(committed, []);
  flow.cancel(); await cancelled;
});

test('retained validation observes events between RPC completion and session publication', async () => {
  for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
    const f = fixture();
    const session = await readInjectedWalletSession(f.provider, { requestAccounts: true, retainGuard: true });
    assert.equal(session?.validation?.isCurrent(), true); assert.equal(f.listenerCount(), 3);
    f.emit(event);
    assert.equal(session?.validation?.isCurrent(), false);
    session?.validation?.dispose(); assert.equal(f.listenerCount(), 0);
  }
});

test('cancellation releases a returned validation guard before a stale continuation commits', async () => {
  const f = fixture(); const controller = new AbortController();
  const session = await readInjectedWalletSession(f.provider, { requestAccounts: true, signal: controller.signal, retainGuard: true });
  controller.abort(); assert.equal(session?.validation?.isCurrent(), false); assert.equal(f.listenerCount(), 0);
});

test('discard cleanup belongs to the obsolete result, never the newer session', async () => {
  const discarded: string[] = []; const committed: string[] = [];
  const flow = createExternalWalletConnection<string>({ onState: () => undefined, onCommit: (x) => committed.push(x), onDiscard: (x) => discarded.push(x) });
  const stale = deferred<string>(); const promise = flow.open();
  flow.select(wallet, () => stale.promise); await tick(); flow.back();
  flow.select(wallet, async () => 'current'); await promise; stale.resolve('old'); await tick();
  assert.deepEqual(discarded, ['old']); assert.deepEqual(committed, ['current']);
});

test('a publication failure cleans the candidate and preserves the chooser for retry', async () => {
  let disposed = 0;
  const flow = createExternalWalletConnection<string>({ onState: () => undefined, onCommit: () => { throw new Error('changed'); }, onDiscard: () => { disposed += 1; } });
  const promise = flow.open(); const cancelled = assert.rejects(promise);
  flow.select(wallet, async () => 'candidate'); await tick(); assert.equal(disposed, 1); assert.equal(flow.getState().status, 'error'); flow.cancel(); await cancelled;
});

test('a read that synchronously aborts then rejects is contained without an orphaned rejection', async () => {
  const controller = new AbortController();
  let requests = 0;
  const provider = { request: () => {
    requests += 1;
    controller.abort();
    return Promise.reject(new Error('Provider rejected after synchronous abort'));
  } };
  await assert.rejects(readInjectedWalletSession(provider, { requestAccounts: false, signal: controller.signal }), /cancel/i);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
});

test('an ambiguous provider 4001 response does not claim the person declined', async () => {
  const { flow, committed } = setup();
  const promise = flow.open(); const cancelled = assert.rejects(promise);
  flow.select(wallet, async () => { throw Object.assign(new Error('Wallet is not initialized.'), { code: 4001 }); });
  await tick();
  assert.deepEqual(flow.getState(), {
    status: 'error', walletId: wallet.id, name: wallet.name,
    message: 'Connection wasn’t completed. Try again.',
  });
  assert.deepEqual(committed, []);
  flow.cancel(); await cancelled;
});
