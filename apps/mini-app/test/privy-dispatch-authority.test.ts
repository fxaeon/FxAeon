import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConnectedWallet } from '@privy-io/react-auth';
import { createPrivyDispatchAuthority } from '../src/lib/wallet/privyDispatchAuthority';

const A = '0x00000000000000000000000000000000000000ee';
const B = '0x00000000000000000000000000000000000000ff';
const HASH = `0x${'a'.repeat(64)}` as const;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
type Listener = (...args: any[]) => void;
class Provider {
  chain = '0x1'; accounts = [A]; reads = 0; sends = 0;
  handlers = new Map<string, Set<Listener>>();
  hook?: (method: string) => Promise<unknown> | undefined;
  request = async ({ method }: { method: string; params?: any[] }): Promise<any> => {
    const override = this.hook?.(method);
    if (override) return override;
    if (method === 'eth_chainId') return this.chain;
    if (method === 'eth_accounts') { this.reads += 1; return this.accounts; }
    if (method === 'eth_sendTransaction') { this.sends += 1; return HASH; }
    throw new Error(`Unexpected RPC ${method}`);
  };
  on = (event: string, listener: Listener) => {
    const set = this.handlers.get(event) ?? new Set(); set.add(listener); this.handlers.set(event, set);
  };
  removeListener = (event: string | symbol, listener: Listener) => { this.handlers.get(String(event))?.delete(listener); };
  emit(event: string, value?: unknown) { for (const listener of [...this.handlers.get(event) ?? []]) listener(value); }
  listeners() { return [...this.handlers.values()].reduce((sum, set) => sum + set.size, 0); }
}
function fixture(embedded = false) {
  const authority = createPrivyDispatchAuthority();
  const provider = new Provider();
  let selectedProvider = provider;
  const wallet = {
    type: 'ethereum', address: A, chainId: 'eip155:1', connectedAt: 123,
    walletClientType: embedded ? 'privy' : 'metamask', connectorType: embedded ? 'embedded' : 'injected',
    walletIndex: embedded ? 0 : undefined, imported: false,
    getEthereumProvider: async () => selectedProvider,
    switchChain: async (chain: string | number) => {
      wallet.chainId = `eip155:${Number(chain)}`;
      provider.chain = `0x${Number(chain).toString(16)}`;
      provider.emit('chainChanged', provider.chain);
      update();
    },
  } as unknown as ConnectedWallet;
  let userId = 'user-a', authenticated = true, ready = true, selected = wallet;
  const update = () => authority.update({ ready, authenticated, userId, wallet: selected });
  update(); authority.setMounted(true);
  let embeddedSends = 0;
  const send = (target: 1 | 8453 = 1) => authority.capture(selected).run(target, async (p, w) => {
    assert.equal(w.address, A);
    if (embedded) { embeddedSends += 1; return { hash: HASH }; }
    return { hash: await p.request({ method: 'eth_sendTransaction', params: [{ from: w.address, to: B }] }) };
  });
  return {
    authority, provider, wallet, update, send, sends: () => embedded ? embeddedSends : provider.sends,
    setUser: (id: string) => { userId = id; update(); },
    setAuth: (auth: boolean) => { authenticated = auth; update(); },
    setReady: (value: boolean) => { ready = value; update(); },
    setWallet: (next: ConnectedWallet) => { selected = next; update(); },
    setProvider: (next: Provider) => { selectedProvider = next; },
  };
}

// This is the original V8 preflight order, retained only as a negative control.
// No real SDK, network, or signing provider is reachable in this test file.
async function baselineSend(f: ReturnType<typeof fixture>) {
  const p = await f.wallet.getEthereumProvider();
  await p.request({ method: 'eth_chainId' });
  await p.request({ method: 'eth_accounts' });
  return p.request({ method: 'eth_sendTransaction' });
}
test('FAIL-BEFORE: V8 preflight dispatches after held account read and authority retirement', async () => {
  const f = fixture(), gate = deferred<unknown>();
  f.provider.hook = (method) => method === 'eth_accounts' ? gate.promise : undefined;
  const send = baselineSend(f); await tick();
  f.authority.invalidate(); f.authority.setMounted(false); gate.resolve([A]);
  assert.equal(await send, HASH); assert.equal(f.sends(), 1);
});

for (const embedded of [false, true]) {
  const path = embedded ? 'embedded' : 'external';
  for (const drift of ['selection', 'logout', 'unmount', 'user', 'account', 'auth', 'ready', 'user-roundtrip', 'chain-roundtrip', 'account-roundtrip']) {
    test(`${path}: ${drift} during held account read prevents dispatch`, async () => {
      const f = fixture(embedded), gate = deferred<unknown>();
      f.provider.hook = (method) => method === 'eth_accounts' ? gate.promise : undefined;
      const result = f.send(); const rejected = assert.rejects(result, /Wallet or session changed/); await tick();
      switch (drift) {
        case 'selection': f.authority.invalidate(); break; // even same address
        case 'logout': f.authority.invalidate(); break; // before awaited logout
        case 'unmount': f.authority.setMounted(false); break;
        case 'user': f.setUser('user-b'); break;
        case 'account': f.setWallet({ ...f.wallet, address: B }); break;
        case 'auth': f.setAuth(false); break;
        case 'ready': f.setReady(false); break;
        case 'user-roundtrip': f.setUser('user-b'); f.setUser('user-a'); break;
        case 'chain-roundtrip': f.provider.emit('chainChanged', '0x2105'); f.provider.emit('chainChanged', '0x1'); break;
        case 'account-roundtrip': f.provider.emit('accountsChanged', [B]); f.provider.emit('accountsChanged', [A]); break;
      }
      gate.resolve([A]); await rejected;
      assert.equal(f.sends(), 0); assert.equal(f.provider.listeners(), 0);
    });
  }
  test(`${path}: stable successful send is dispatched once and cleans up`, async () => {
    const f = fixture(embedded);
    assert.deepEqual(await f.send(), { hash: HASH }); assert.equal(f.sends(), 1); assert.equal(f.provider.listeners(), 0);
  });
  test(`${path}: intended chain switch succeeds without treating it as retirement`, async () => {
    const f = fixture(embedded);
    assert.deepEqual(await f.send(8453), { hash: HASH }); assert.equal(f.sends(), 1); assert.equal(f.provider.listeners(), 0);
  });
  test(`${path}: retirement while awaiting switch blocks provider/signing continuation`, async () => {
    const f = fixture(embedded), gate = deferred<void>(); f.wallet.switchChain = () => gate.promise;
    const result = f.send(8453); const rejected = assert.rejects(result, /Wallet or session changed/); await tick();
    f.authority.invalidate(); gate.resolve(); await rejected; assert.equal(f.sends(), 0); assert.equal(f.provider.listeners(), 0);
  });
  for (const result of ['hash', 'error']) test(`${path}: issued ${result} survives retirement without replay`, async () => {
    const f = fixture(embedded), gate = deferred<{ hash: typeof HASH }>(); let dispatches = 0;
    const send = f.authority.capture(f.wallet).run(1, () => { dispatches += 1; return gate.promise; });
    const expectedError = new Error('wallet rejection after dispatch');
    const settled = result === 'hash' ? send : assert.rejects(send, (cause) => cause === expectedError);
    await tick(); assert.equal(dispatches, 1);
    f.authority.invalidate(); f.authority.setMounted(false); f.setUser('user-b');
    if (result === 'hash') gate.resolve({ hash: HASH }); else gate.reject(expectedError);
    const value = await settled;
    if (result === 'hash') assert.deepEqual(value, { hash: HASH });
    assert.equal(dispatches, 1); assert.equal(f.provider.listeners(), 0);
  });
  test(`${path}: same-semantic cloned hydration retains funded selection`, async () => {
    const f = fixture(embedded), gate = deferred<unknown>(); let first = true;
    f.provider.hook = (method) => { if (method === 'eth_accounts' && first) { first = false; return gate.promise; } return undefined; };
    const result = f.send(); await tick(); f.setWallet({ ...f.wallet }); gate.resolve([A]);
    assert.deepEqual(await result, { hash: HASH }); assert.equal(f.sends(), 1);
  });
  test(`${path}: eventless chain drift while account read waits is rechecked`, async () => {
    const f = fixture(embedded), gate = deferred<unknown>(); let first = true;
    f.provider.hook = (method) => { if (method === 'eth_accounts' && first) { first = false; return gate.promise; } return undefined; };
    const result = f.send(); const rejected = assert.rejects(result, /wrong network/); await tick();
    f.provider.chain = '0x2105'; gate.resolve([A]); await rejected; assert.equal(f.sends(), 0);
  });
  test(`${path}: eventless account drift after first read is rechecked`, async () => {
    const f = fixture(embedded); let reads = 0;
    f.provider.hook = (method) => { if (method === 'eth_accounts' && ++reads === 1) { f.provider.accounts = [B]; return Promise.resolve([A]); } return undefined; };
    await assert.rejects(f.send(), /account does not match/); assert.equal(f.sends(), 0);
  });
}
test('external provider replacement while accounts wait blocks dispatch', async () => {
  const f = fixture(), gate = deferred<unknown>(); let first = true;
  f.provider.hook = (method) => { if (method === 'eth_accounts' && first) { first = false; return gate.promise; } return undefined; };
  const result = f.send(); const rejected = assert.rejects(result, /Wallet or session changed/); await tick();
  f.setProvider(new Provider()); gate.resolve([A]); await rejected; assert.equal(f.sends(), 0);
});
test('embedded intended switch adopts SDK replacement and its fresh provider', async () => {
  const f = fixture(true); let staleAcquisitions = 0;
  f.wallet.getEthereumProvider = async () => { staleAcquisitions += 1; return f.provider; };
  f.wallet.switchChain = async () => {
    setTimeout(() => {
      const target = new Provider(); target.chain = '0x2105';
      f.setWallet({ ...f.wallet, chainId: 'eip155:8453', getEthereumProvider: async () => ({ ...target }) });
    }, 1);
  };
  assert.deepEqual(await f.send(8453), { hash: HASH }); assert.equal(staleAcquisitions, 1); assert.equal(f.sends(), 1);
});
test('embedded fresh provider wrappers do not falsely retire authority', async () => {
  const f = fixture(true); f.wallet.getEthereumProvider = async () => ({ ...f.provider });
  assert.deepEqual(await f.send(), { hash: HASH }); assert.equal(f.sends(), 1);
});
for (const embedded of [false, true]) {
  test(`${embedded ? 'embedded' : 'external'}: retirement during initial provider acquisition cannot issue reads`, async () => {
    const f = fixture(embedded), gate = deferred<Provider>();
    f.wallet.getEthereumProvider = () => gate.promise;
    const result = f.send(); const rejected = assert.rejects(result, /Wallet or session changed/);
    f.authority.invalidate(); gate.resolve(f.provider); await rejected;
    assert.equal(f.provider.reads, 0); assert.equal(f.provider.listeners(), 0); assert.equal(f.sends(), 0);
  });
  test(`${embedded ? 'embedded' : 'external'}: invalidation detaches owned listeners before held read settles`, async () => {
    const f = fixture(embedded), gate = deferred<unknown>(), outsider = () => {};
    f.provider.on('accountsChanged', outsider);
    f.provider.hook = (method) => method === 'eth_accounts' ? gate.promise : undefined;
    const result = f.send(); const rejected = assert.rejects(result); await tick();
    assert.equal(f.provider.listeners(), 5); f.authority.invalidate();
    assert.equal(f.provider.listeners(), 1); gate.resolve([A]); await rejected;
    assert.equal(f.provider.listeners(), 1); assert.equal(f.sends(), 0);
  });
  for (const malformed of ['0x1garbage', '1oops', 'eip155:1', null, {}, 1.5]) {
    test(`${embedded ? 'embedded' : 'external'}: malformed provider chain ${String(malformed)} cannot sign`, async () => {
      const f = fixture(embedded);
      f.provider.hook = (method) => method === 'eth_chainId' ? Promise.resolve(malformed) : undefined;
      await assert.rejects(f.send(), /wrong network/); assert.equal(f.sends(), 0); assert.equal(f.provider.listeners(), 0);
    });
  }
}
test('a dispatch ticket cannot be replayed', async () => {
  const f = fixture(); const ticket = f.authority.capture(f.wallet); let sends = 0;
  await ticket.run(1, async () => { sends += 1; return HASH; });
  await assert.rejects(ticket.run(1, async () => { sends += 1; return HASH; })); assert.equal(sends, 1);
});
test('an unintended return to the starting chain during intended switch retires preflight', async () => {
  const f = fixture();
  f.wallet.switchChain = async () => {
    f.provider.emit('chainChanged', '0x2105'); f.provider.emit('chainChanged', '0x1');
    f.wallet.chainId = 'eip155:8453'; f.provider.chain = '0x2105'; f.update();
  };
  await assert.rejects(f.send(8453), /Wallet or session changed/); assert.equal(f.sends(), 0);
});

test('external provider replacement during an intended switch still retires preflight', async () => {
  const f = fixture();
  f.wallet.switchChain = async () => {
    f.wallet.chainId = 'eip155:8453';
    const next = new Provider(); next.chain = '0x2105';
    f.setProvider(next); f.update();
  };
  await assert.rejects(f.send(8453), /Wallet or session changed/); assert.equal(f.sends(), 0);
});
for (const timing of ['before-attach', 'after-attach']) test(`synchronous provider retirement ${timing} during listener registration cannot leak`, async () => {
  const f = fixture(); const originalOn = f.provider.on; let registrations = 0;
  f.provider.on = (event, listener) => {
    registrations += 1;
    if (timing === 'before-attach') listener([B]);
    originalOn(event, listener);
    if (timing === 'after-attach') listener([B]);
  };
  await assert.rejects(f.send(), /Wallet or session changed/);
  assert.equal(f.provider.listeners(), 0);
  assert.equal(registrations, 1);
  assert.equal(f.sends(), 0);
});
for (const changed of ['chain', 'account']) test(`external same-proxy ${changed} drift during identity reacquisition is freshly checked`, async () => {
  const f = fixture(), gate = deferred<Provider>(); let acquisitions = 0;
  f.wallet.getEthereumProvider = async () => {
    acquisitions += 1;
    return acquisitions === 2 ? gate.promise : f.provider;
  };
  const result = f.send();
  const rejected = assert.rejects(result, changed === 'chain' ? /wrong network/ : /account does not match/);
  await tick(); assert.equal(acquisitions, 2);
  if (changed === 'chain') f.provider.chain = '0x2105';
  else f.provider.accounts = [B];
  gate.resolve(f.provider);
  await rejected; assert.equal(f.sends(), 0); assert.equal(f.provider.listeners(), 0);
});
