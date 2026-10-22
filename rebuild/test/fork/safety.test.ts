import assert from 'node:assert/strict';
import test from 'node:test';
import { keccak256, parseTransaction } from 'viem';
import type { Address, Hash, ReviewedCall } from '../../src/domain/ports';
import { GuardedFork, loopbackUrl, rpcExchange } from './guard';
import { validateProof } from './manifest';
import type { NativeLongProof } from './manifest';
import { disposableProvider } from './provider';

// These are boundary simulations, explicitly not protocol or fork execution.
const URL = 'http://127.0.0.1:18547/';
const BASE = 25_000_000n;
const BASE_HASH: Hash = `0x${'12'.repeat(32)}`;
const INSTANCE: Hash = `0x${'34'.repeat(32)}`;
const OWNER: Address = `0x${'56'.repeat(20)}`;
const TARGET: Address = `0x${'78'.repeat(20)}`;

class BoundaryFixture {
  readonly calls: { method: string; params: unknown[] }[] = [];
  instance: unknown = INSTANCE;
  chain = '0x1';
  client = 'anvil/v1.7.1';
  forked = true;
  forkBase = BASE;
  canonicalHash = BASE_HASH;
  envelopeIdMismatch = false;
  beforeResult?: (method: string) => void;
  readonly fetch = (async (input: RequestInfo | globalThis.URL, init?: RequestInit) => {
    assert.equal(String(input), URL); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
    this.calls.push(request); this.beforeResult?.(request.method);
    let result: unknown;
    switch (request.method) {
      case 'eth_chainId': result = this.chain; break;
      case 'web3_clientVersion': result = this.client; break;
      case 'anvil_metadata': result = { chainId: 1, clientVersion: this.client, instanceId: this.instance,
        forkedNetwork: this.forked ? { chainId: 1, forkBlockNumber: Number(this.forkBase), forkBlockHash: BASE_HASH } : null }; break;
      case 'eth_getBlockByNumber': result = { number: `0x${BASE.toString(16)}`, hash: this.canonicalHash }; break;
      case 'eth_blockNumber': result = `0x${BASE.toString(16)}`; break;
      case 'anvil_setBalance': result = null; break;
      case 'eth_getTransactionCount': result = '0x0'; break;
      case 'eth_estimateGas': result = '0x5208'; break;
      case 'eth_gasPrice': result = '0x3b9aca00'; break;
      case 'eth_sendRawTransaction': result = keccak256(request.params[0] as Hash); break;
      default: throw new Error(`Unexpected fixture method: ${request.method}`);
    }
    return Response.json({ jsonrpc: '2.0', id: request.id + (this.envelopeIdMismatch ? 1 : 0), result });
  }) as typeof fetch;
  guard(): GuardedFork { return new GuardedFork(URL, { blockNumber: BASE, blockHash: BASE_HASH, instanceId: INSTANCE }, this.fetch); }
  mutations(): string[] { return this.calls.map(value => value.method).filter(value => /send|setBalance|snapshot|revert|sign/i.test(value)); }
}

test('[FORK-GUARD] only canonical literal numeric loopback can be a signing target', () => {
  assert.equal(loopbackUrl('http://127.0.0.1:18547'), URL);
  for (const candidate of [
    'https://ethereum-rpc.publicnode.com', 'http://127.0.0.1.evil.test:18547', 'http://localhost:18547',
    'http://127.1:18547', 'http://2130706433:18547', 'http://127.0.0.1:80', 'http://127.0.0.1:18547/rpc',
    'http://127.0.0.1:18547/?key=x', 'http://user:password@127.0.0.1:18547/', 'http://127.0.0.1:18547/#x',
  ]) assert.throws(() => loopbackUrl(candidate));
});

test('[FORK-GUARD] valid metadata, base header and instance establish read capability without any write', async () => {
  const fixture = new BoundaryFixture(); const fork = fixture.guard();
  await assert.rejects(fork.read('eth_chainId'), /Prove/);
  const proof = await fork.prove();
  assert.equal(proof.blockNumber, BASE); assert.equal(proof.blockHash, BASE_HASH); assert.equal(proof.instanceId, INSTANCE);
  assert.deepEqual(fixture.mutations(), []);
  assert.equal(await fork.read('eth_chainId'), '0x1');
});

test('[FORK-GUARD] an Ethereum Anvil without fork metadata cannot fund an account', async () => {
  const fixture = new BoundaryFixture(); fixture.forked = false;
  await assert.rejects(fixture.guard().fundDisposable(OWNER));
  assert.deepEqual(fixture.mutations(), []);
});

test('[FORK-GUARD] chain ID alone cannot authorize a non-Anvil endpoint', async () => {
  const fixture = new BoundaryFixture(); fixture.client = 'Geth/v1.0';
  await assert.rejects(fixture.guard().fundDisposable(OWNER), /Anvil/);
  assert.deepEqual(fixture.mutations(), []);
});

test('[FORK-GUARD] wrong outer chain cannot borrow authority from plausible Anvil metadata', async () => {
  const fixture = new BoundaryFixture(); fixture.chain = '0x2105';
  await assert.rejects(fixture.guard().fundDisposable(OWNER), /chain 1/);
  assert.deepEqual(fixture.mutations(), []);
});

test('[FORK-GUARD] different pinned block or canonical base hash blocks funding', async () => {
  for (const change of [(f: BoundaryFixture) => { f.forkBase++; }, (f: BoundaryFixture) => { f.canonicalHash = INSTANCE; }]) {
    const fixture = new BoundaryFixture(); change(fixture);
    await assert.rejects(fixture.guard().fundDisposable(OWNER));
    assert.deepEqual(fixture.mutations(), []);
  }
});

test('[FORK-GUARD] missing or replaced instance identity blocks funding and later signing', async () => {
  const missing = new BoundaryFixture(); missing.instance = undefined;
  await assert.rejects(missing.guard().fundDisposable(OWNER)); assert.deepEqual(missing.mutations(), []);
  const fixture = new BoundaryFixture(); const fork = fixture.guard();
  await fork.fundDisposable(OWNER); fixture.instance = BASE_HASH;
  await assert.rejects(fork.beforeSign(OWNER), /instance changed/);
  await assert.rejects(fork.sendRaw(OWNER, `0x${'ab'.repeat(32)}`), /instance changed/);
  assert.deepEqual(fixture.mutations(), ['anvil_setBalance']);
});

test('[FORK-GUARD] read capability cannot send, sign, impersonate or change contract state', async () => {
  const fixture = new BoundaryFixture(); const fork = fixture.guard(); await fork.prove();
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_sign', 'anvil_impersonateAccount', 'anvil_setCode', 'anvil_setStorageAt']) {
    await assert.rejects(fork.read(method), /outside/);
  }
  assert.deepEqual(fixture.mutations(), []);
});

test('[FORK-GUARD] mismatched JSON-RPC IDs and oversized bodies fail closed', async () => {
  const fixture = new BoundaryFixture(); fixture.envelopeIdMismatch = true;
  await assert.rejects(fixture.guard().prove(), /envelope/); assert.deepEqual(fixture.mutations(), []);
  const fetcher = (async () => new Response('oversize', { headers: { 'content-length': '2000001' } })) as typeof fetch;
  await assert.rejects(rpcExchange(URL, fetcher)('eth_chainId'), /size limit/);
});

test('[FORK-GUARD] disposable provider requires the exact accepted call and cannot expose generic signing', async () => {
  const fixture = new BoundaryFixture(); const fork = fixture.guard();
  let accepted: ReviewedCall | undefined;
  const provider = await disposableProvider(fork, () => accepted);
  const input = { from: provider.address, to: TARGET, data: '0x1234', value: '0x1', nonce: '0x0', chainId: '0x1' };
  await assert.rejects(provider.request({ method: 'eth_sendTransaction', params: [input] }), /review/);
  accepted = Object.freeze({ chainId: 1, from: provider.address, to: TARGET, data: '0x1234', value: 1n, nonce: 0 });
  await assert.rejects(provider.request({ method: 'eth_sign', params: [provider.address, '0x1234'] }), /rejects/);
  await assert.rejects(provider.request({ method: 'eth_sendTransaction', params: [{ ...input, value: '0x2' }] }), /differs/);
  await assert.rejects(provider.request({ method: 'eth_sendTransaction', params: [{ ...input, chainId: '0x2105' }] }), /differs/);
  await assert.rejects(provider.request({ method: 'eth_sendTransaction', params: [{ ...input, gas: '0x1' }] }), /unreviewed/);
  assert.equal(provider.issued, 0); assert.deepEqual(fixture.mutations(), ['anvil_setBalance']);
});

test('[FORK-GUARD] instance replacement during wallet gas reads prevents the signature and send', async () => {
  const fixture = new BoundaryFixture(); let accepted: ReviewedCall | undefined;
  const provider = await disposableProvider(fixture.guard(), () => accepted);
  accepted = Object.freeze({ chainId: 1, from: provider.address, to: TARGET, data: '0x1234', value: 1n, nonce: 0 });
  fixture.beforeResult = method => { if (method === 'eth_estimateGas') fixture.instance = BASE_HASH; };
  await assert.rejects(provider.request({ method: 'eth_sendTransaction', params: [{ from: provider.address, to: TARGET,
    data: accepted.data, value: '0x1', nonce: '0x0', chainId: '0x1' }] }), /instance changed/);
  assert.equal(provider.issued, 0); assert.deepEqual(fixture.mutations(), ['anvil_setBalance']);
});

test('[FORK-GUARD] only the disposable account signs exact bytes once; its consumed nonce cannot replay', async () => {
  const fixture = new BoundaryFixture(); let accepted: ReviewedCall | undefined;
  const provider = await disposableProvider(fixture.guard(), () => accepted);
  accepted = Object.freeze({ chainId: 1, from: provider.address, to: TARGET, data: '0x1234', value: 1n, nonce: 0 });
  const request = { method: 'eth_sendTransaction', params: [{ from: provider.address, to: TARGET, data: accepted.data,
    value: '0x1', nonce: '0x0', chainId: '0x1' }] };
  const transactionHash = await provider.request(request);
  const raw = fixture.calls.find(value => value.method === 'eth_sendRawTransaction')!.params[0] as Hash;
  assert.equal(transactionHash, keccak256(raw));
  const transaction = parseTransaction(raw);
  assert.equal(transaction.chainId, 1); assert.equal(transaction.data, accepted.data); assert.equal(transaction.value, 1n);
  assert.equal(transaction.to?.toLowerCase(), TARGET); assert.equal(transaction.nonce, 0);
  await assert.rejects(provider.request(request), /consumed nonce/);
  assert.equal(provider.issued, 1); assert.equal(provider.submitted.length, 1);
  assert.deepEqual(fixture.mutations(), ['anvil_setBalance', 'eth_sendRawTransaction']);
});

function proof(): NativeLongProof {
  return {
    schemaVersion: 1, kind: 'fxaeon-native-long-fork', runId: 'run', sourceManifestHash: 'a'.repeat(64), startedAt: '2026-10-22T00:00:00Z', completedAt: '2026-10-22T00:00:01Z',
    fork: { blockNumber: String(BASE), blockHash: BASE_HASH, instanceId: INSTANCE, clientVersion: 'anvil/v1.7.1' },
    review: { from: OWNER, to: TARGET, data: '0x1234', valueWei: '100000000000000001', nonce: 0, minimumWstEthWei: '1' },
    execution: { hash: BASE_HASH, blockHash: INSTANCE, blockNumber: String(BASE + 1n), status: 'success', minedData: '0x1234',
      minedValueWei: '100000000000000001', minedNonce: 0, positionId: '1', currentOwner: OWNER, collateralStEthWei: '2', debtFxUsdWei: '3',
      networkFeeWei: '1', balanceBeforeWei: '2000000000000000000', balanceAfterWei: '1899999999999999998' },
    recovery: { hash: BASE_HASH, positionId: '1', dispatchesBefore: 1, dispatchesAfter: 1, canonicalReadsRepeated: true },
  };
}

test('[FORK-PROOF] stale run, different fork, mismatched spend, missing accounting and resend cannot produce a passing proof', () => {
  const expected = { runId: 'run', sourceManifestHash: 'a'.repeat(64), blockNumber: BASE, blockHash: BASE_HASH, instanceId: INSTANCE, clientVersion: 'anvil/v1.7.1', localUrl: URL };
  assert.equal(validateProof(proof(), expected).kind, 'fxaeon-native-long-fork');
  assert.throws(() => validateProof(proof(), { ...expected, runId: 'another-run' }));
  assert.throws(() => validateProof(proof(), { ...expected, instanceId: BASE_HASH }));
  for (const altered of [
    { ...proof(), sourceManifestHash: 'b'.repeat(64) },
    { ...proof(), execution: { ...proof().execution, minedValueWei: '100000000000000000' } },
    { ...proof(), execution: { ...proof().execution, currentOwner: TARGET } },
    { ...proof(), execution: { ...proof().execution, debtFxUsdWei: undefined } },
    { ...proof(), recovery: { ...proof().recovery, dispatchesAfter: 2 } },
    { ...proof(), archiveUrl: 'https://example.invalid/secret' },
  ]) assert.throws(() => validateProof(altered, expected));
});
