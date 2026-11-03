import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import canonicalize from 'canonicalize';
import { AccessError } from './http.ts';
import { PrivyWalletApi, transactionBody, type PreparedTransaction, type Wallet, type WalletReservation } from './privy.ts';

const API = 'https://api.privy.io/v1';
const APP = 'testapp000000000000000000';
const SECRET = 'synthetic-test-secret';
const ADDRESS = `0x${'ab'.repeat(20)}`;
const TO = `0x${'cd'.repeat(20)}`;
const HASH = `0x${'12'.repeat(32)}`;
const AUTH = 'webauthn:YXV0aA:Y2xpZW50:c2ln';
const REFERENCE = '11111111-1111-4111-8111-111111111111';
const OTHER_REFERENCE = '22222222-2222-4222-8222-222222222222';
const NOW = 1_800_000_000_000;
const wallet: Wallet = { id: 'wallet-1', address: ADDRESS, verified: true };
const tx = { to: TO, chainId: 8453, value: '16' };
let reservation: WalletReservation;
before(async () => {
  // Even an accidental default-transport call must never reach a provider.
  mock.method(globalThis, 'fetch', async () => { throw new Error('NETWORK FORBIDDEN IN SECURITY TESTS'); });
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  reservation = { externalId: 'reserved-seat-123', ownerPublicKey: Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64') };
});
after(() => mock.restoreAll());
const remoteWallet = () => ({ id: wallet.id, address: ADDRESS, chain_type: 'ethereum',
  external_id: reservation.externalId, owner_id: 'owner-1', additional_signers: [] });
const quorum = () => ({ id: 'owner-1', authorization_threshold: 1,
  authorization_keys: [{ public_key: reservation.ownerPublicKey, display_name: null }], user_ids: [], key_quorum_ids: [] });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const errorCode = (code: string) => (error: unknown) => error instanceof AccessError && error.code === code;
type Call = { url: string; method: string; headers: Headers; body?: Record<string, unknown>; redirect?: RequestRedirect };
type Reply = Response | Error;
function transport(...replies: Reply[]) {
  const calls: Call[] = [];
  const send: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined, redirect: init?.redirect });
    const next = replies.shift();
    assert.ok(next, 'unexpected transport call');
    if (next instanceof Error) throw next;
    return next;
  };
  return { api: new PrivyWalletApi(APP, SECRET, send), calls, remaining: () => replies.length };
}

test('existing wallet is fetched by reserved external ID and its single owner quorum is verified', async () => {
  const fixture = transport(response(remoteWallet()), response(quorum()));
  assert.deepEqual(await fixture.api.provision(reservation), wallet);
  assert.deepEqual(fixture.calls.map(call => [call.method, call.url]), [
    ['GET', `${API}/wallets/ext_wal_${reservation.externalId}`], ['GET', `${API}/key_quorums/owner-1`],
  ]);
  for (const call of fixture.calls) {
    assert.equal(call.redirect, 'manual');
    assert.equal(call.headers.get('authorization'), `Basic ${Buffer.from(`${APP}:${SECRET}`).toString('base64')}`);
    assert.equal(call.headers.get('privy-app-id'), APP);
    assert.equal(call.headers.get('privy-authorization-signature'), null);
  }
});

test('create registers only the verified public key with no users or additional signers', async () => {
  const fixture = transport(response({}, 404), response(remoteWallet()), response(quorum()));
  assert.deepEqual(await fixture.api.provision(reservation), wallet);
  const create = fixture.calls[1];
  assert.equal(create.url, `${API}/wallets`);
  assert.equal(create.method, 'POST');
  assert.equal(create.headers.get('privy-idempotency-key'), reservation.externalId);
  assert.deepEqual(create.body, { chain_type: 'ethereum', external_id: reservation.externalId,
    owner: { public_key: reservation.ownerPublicKey }, additional_signers: [] });
  assert.equal(fixture.remaining(), 0);
});

for (const [name, patch] of [
  ['missing owner', { owner_id: null }], ['path traversal owner', { owner_id: '../other' }],
  ['wrong external ID', { external_id: 'someone-else' }], ['wrong chain', { chain_type: 'solana' }],
  ['bad wallet ID', { id: '../other' }], ['bad address', { address: '0x123' }],
  ['additional signer', { additional_signers: [{ signer_id: 'backend-key' }] }],
  ['missing signer list', { additional_signers: undefined }], ['malformed signer list', { additional_signers: {} }],
] as [string, Record<string, unknown>][]) {
  test(`provision rejects ${name} before trusting the wallet`, async () => {
    const fixture = transport(response({ ...remoteWallet(), ...patch }));
    await assert.rejects(fixture.api.provision(reservation), errorCode('wallet_owner_mismatch'));
    assert.equal(fixture.calls.length, 1);
  });
}

for (const [name, patch] of [
  ['different owner key', { authorization_keys: [{ public_key: 'A'.repeat(124) }] }],
  ['multiple keys', { authorization_keys: [{ public_key: 'first' }, { public_key: 'second' }] }],
  ['missing keys', { authorization_keys: [] }], ['malformed key', { authorization_keys: [null] }],
  ['zero threshold', { authorization_threshold: 0 }], ['two-key threshold', { authorization_threshold: 2 }],
  ['string threshold', { authorization_threshold: '1' }],
  ['user signer', { user_ids: ['did:privy:unexpected'] }],
  ['nested quorum', { key_quorum_ids: ['another-owner'] }], ['malformed users', { user_ids: {} }],
  ['wrong quorum identity', { id: 'someone-else' }],
] as [string, Record<string, unknown>][]) {
  test(`owner verification rejects ${name}`, async () => {
    const fixture = transport(response(remoteWallet()), response({ ...quorum(), ...patch }));
    await assert.rejects(fixture.api.provision(reservation), errorCode('wallet_owner_mismatch'));
    assert.equal(fixture.calls.length, 2);
  });
}

test('owner key whitespace and null empty membership lists are normalized', async () => {
  const fixture = transport(response(remoteWallet()), response({ ...quorum(), user_ids: null, key_quorum_ids: null,
    authorization_keys: [{ public_key: reservation.ownerPublicKey.replace(/(.{32})/g, '$1\n') }] }));
  assert.deepEqual(await fixture.api.provision(reservation), wallet);
});

for (const failure of ['timeout', 'conflict', 'server-error', 'malformed-success']) {
  test(`ambiguous create (${failure}) only reconciles the same external ID`, async () => {
    const failed = failure === 'timeout' ? new Error('simulated lost response')
      : failure === 'malformed-success' ? new Response('not json', { status: 200 })
      : response({}, failure === 'conflict' ? 409 : 503);
    const fixture = transport(response({}, 404), failed, response(remoteWallet()), response(quorum()));
    assert.deepEqual(await fixture.api.provision(reservation), wallet);
    assert.deepEqual(fixture.calls.map(call => call.method), ['GET', 'POST', 'GET', 'GET']);
    assert.equal(fixture.calls[0].url, fixture.calls[2].url);
    assert.equal(fixture.calls[1].body?.external_id, reservation.externalId);
    assert.equal(fixture.calls[1].headers.get('privy-idempotency-key'), reservation.externalId);
  });
}

test('unresolved creation cannot generate a replacement external ID on a later retry', async () => {
  const fixture = transport(response({}, 404), new Error('timeout'), response({}, 404),
    response({}, 404), new Error('timeout'), response({}, 404));
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(fixture.api.provision(reservation), errorCode('wallet_unavailable'));
  }
  assert.equal(fixture.calls.filter(call => call.method === 'POST').length, 2);
  assert.ok(fixture.calls.filter(call => call.method === 'GET').every(call => call.url === `${API}/wallets/ext_wal_${reservation.externalId}`));
  assert.ok(fixture.calls.filter(call => call.method === 'POST').every(call =>
    call.body?.external_id === reservation.externalId && call.headers.get('privy-idempotency-key') === reservation.externalId));
});

test('lookup errors do not trigger wallet creation and malformed reservations never reach transport', async () => {
  const fixture = transport(response({}, 503));
  await assert.rejects(fixture.api.provision(reservation), errorCode('wallet_unavailable'));
  assert.equal(fixture.calls.length, 1);
  for (const invalid of [{ ...reservation, externalId: '../other' }, { ...reservation, ownerPublicKey: 'not-SPKI' }]) {
    const blocked = transport();
    await assert.rejects(blocked.api.provision(invalid), errorCode('wallet_owner_invalid'));
    assert.equal(blocked.calls.length, 0);
  }
});

test('transaction fields normalize quantities and sender while retaining Ethereum/Base chain binding', () => {
  for (const chainId of [1, 8453]) {
    assert.deepEqual(transactionBody({ ...tx, chainId, from: ADDRESS.toUpperCase().replace('0X', '0x'),
      data: '0xabcdef', gasLimit: 21000, maxFeePerGas: '0016', maxPriorityFeePerGas: '0x01', nonce: 0 }, ADDRESS), {
      method: 'eth_sendTransaction', caip2: `eip155:${chainId}`, params: { transaction: {
        to: TO, chain_id: chainId, value: '0x10', data: '0xabcdef', gas_limit: '0x5208',
        max_fee_per_gas: '0x10', max_priority_fee_per_gas: '0x1', nonce: '0x0',
      } },
    });
  }
  assert.deepEqual(transactionBody({ to: TO, chainId: 1 }, ADDRESS), {
    method: 'eth_sendTransaction', caip2: 'eip155:1', params: { transaction: { to: TO, chain_id: 1, value: '0x0' } },
  });
  assert.equal(((transactionBody({ ...tx, gasPrice: '15' }, ADDRESS).params as any).transaction).gas_price, '0xf');
});

test('chain parsing rejects unsupported chains, coercion and partial numeric strings', () => {
  for (const chainId of [0, 137, 11155111, -1, 1.5, NaN, Infinity, '1junk', '8453x', '0x2105junk', 'eip155:8453', '', null, true, {}, '1', '0x1']) {
    assert.throws(() => transactionBody({ ...tx, chainId }, ADDRESS), errorCode('transaction_invalid'), String(chainId));
  }
});

test('transaction rejects extra fields, different sender, malformed data and mixed fee models', () => {
  for (const value of [null, [], 'tx', {}, { ...tx, to: '0x123' }, { ...tx, from: TO },
    { ...tx, data: '0x1' }, { ...tx, data: '0xgg' }, { ...tx, data: '0x' + 'aa'.repeat(8192) },
    { ...tx, gasPrice: '1', maxFeePerGas: '2' }, { ...tx, gasPrice: '1', maxPriorityFeePerGas: '2' }]) {
    assert.throws(() => transactionBody(value, ADDRESS), errorCode('transaction_invalid'));
  }
  for (const field of ['sponsor', 'owner', 'additional_signers', 'chain_id', 'gas_limit', 'type', 'authorization_list', 'method']) {
    assert.throws(() => transactionBody({ ...tx, [field]: true }, ADDRESS), errorCode('request_invalid'), field);
  }
});

test('all quantity fields reject negative, unsafe, fractional, nonnumeric and uint256-overflow values', () => {
  for (const field of ['value', 'gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'nonce']) {
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '-1', '1.5', '1e3', ' 1', '', '0x', true, {}, (2n ** 256n).toString(), null]) {
      assert.throws(() => transactionBody({ ...tx, [field]: value }, ADDRESS), errorCode('transaction_invalid'), `${field}: ${String(value)}`);
    }
  }
  const largest = (2n ** 256n - 1n).toString();
  assert.equal((transactionBody({ ...tx, value: largest }, ADDRESS).params as any).transaction.value, `0x${'f'.repeat(64)}`);
});

test('approval challenge contains exact RFC8785 canonical bytes with signed expiry and idempotency headers', () => {
  const fixture = transport();
  const prepared = fixture.api.prepare(wallet, tx, REFERENCE, NOW);
  const expected = `{"body":{"caip2":"eip155:8453","method":"eth_sendTransaction","params":{"transaction":{"chain_id":8453,"to":"${TO}","value":"0x10"}},"reference_id":"${REFERENCE}"},"headers":{"privy-app-id":"${APP}","privy-idempotency-key":"${REFERENCE}","privy-request-expiry":"${NOW + 300000}"},"method":"POST","url":"${API}/wallets/wallet-1/rpc","version":1}`;
  assert.equal(Buffer.from(prepared.challenge, 'base64url').toString('utf8'), expected);
  assert.equal(prepared.expiresAt, NOW + 300000);
  assert.equal(fixture.calls.length, 0);
  assert.ok(!expected.includes(SECRET));
  for (const other of [fixture.api.prepare(wallet, { ...tx, value: '17' }, REFERENCE, NOW),
    fixture.api.prepare(wallet, { ...tx, chainId: 1 }, REFERENCE, NOW),
    fixture.api.prepare(wallet, tx, OTHER_REFERENCE, NOW), fixture.api.prepare(wallet, tx, REFERENCE, NOW + 1)]) {
    assert.notEqual(other.challenge, prepared.challenge);
  }
});

test('submit sends exact prepared body and signed headers once and returns the transaction hash', async () => {
  const fixture = transport(response({ method: 'eth_sendTransaction', data: { hash: HASH, caip2: 'eip155:8453' } }));
  const prepared = fixture.api.prepare(wallet, tx, REFERENCE);
  assert.equal(await fixture.api.submit(prepared, wallet.id, AUTH), HASH);
  assert.equal(fixture.calls.length, 1);
  const call = fixture.calls[0];
  assert.equal(call.url, prepared.url);
  assert.deepEqual(call.body, prepared.body);
  for (const [key, value] of Object.entries(prepared.headers)) assert.equal(call.headers.get(key), value);
  assert.equal(call.headers.get('privy-authorization-signature'), AUTH);
});

const mutations: [string, (value: PreparedTransaction) => void][] = [
  ['reference ID', p => { p.body.reference_id = OTHER_REFERENCE; }],
  ['missing reference ID', p => { delete p.body.reference_id; }],
  ['body recipient', p => { (p.body.params as any).transaction.to = ADDRESS; }],
  ['body chain', p => { p.body.caip2 = 'eip155:1'; }],
  ['method', p => { p.body.method = 'personal_sign'; }],
  ['idempotency key', p => { p.headers['privy-idempotency-key'] = 'different'; }],
  ['missing idempotency key', p => { delete p.headers['privy-idempotency-key']; }],
  ['expiry header', p => { p.headers['privy-request-expiry'] = String(p.expiresAt + 1); }],
  ['missing expiry header', p => { delete p.headers['privy-request-expiry']; }],
  ['expiry metadata', p => { p.expiresAt += 1; }],
  ['nonfinite expiry', p => { p.expiresAt = NaN; }],
  ['challenge', p => { p.challenge = 'dGFtcGVyZWQ'; }],
  ['authorization header injection', p => { p.headers.authorization = 'Basic attacker'; }],
  ['URL', p => { p.url += '/other'; }],
  ['app ID', p => { p.headers['privy-app-id'] = 'another-app'; }],
];
for (const [name, mutate] of mutations) {
  test(`submit rejects changed ${name} before transport`, async () => {
    const fixture = transport(response({ data: { hash: HASH } }));
    const prepared = fixture.api.prepare(wallet, tx, REFERENCE);
    mutate(prepared);
    await assert.rejects(fixture.api.submit(prepared, wallet.id, AUTH), errorCode('approval_expired'));
    assert.equal(fixture.calls.length, 0);
  });
}

test('expiry rejects at the exact deadline; invalid authorization or wallet cannot reach transport', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const fixture = transport();
  const expired = fixture.api.prepare(wallet, tx, REFERENCE, NOW - 300000);
  await assert.rejects(fixture.api.submit(expired, wallet.id, AUTH), errorCode('approval_expired'));
  const fresh = fixture.api.prepare(wallet, tx, REFERENCE, NOW);
  for (const authorization of ['', 'plain-signature', 'webauthn:a:b', `${AUTH}\r\nother:yes`, 'webauthn:a=:b:c']) {
    await assert.rejects(fixture.api.submit(fresh, wallet.id, authorization), errorCode('approval_expired'));
  }
  await assert.rejects(fixture.api.submit(fresh, 'different-wallet', AUTH), errorCode('approval_expired'));
  assert.equal(fixture.calls.length, 0);
});

for (const data of [undefined, null, {}, { hash: '' }, { hash: null }, { hash: 123 }, { hash: '0x123' },
  { hash: `0x${'gg'.repeat(32)}` }, { user_operation_hash: HASH }]) {
  test(`missing or invalid transaction hash is unknown, without retry: ${JSON.stringify(data)}`, async () => {
    const fixture = transport(response({ method: 'eth_sendTransaction', data }));
    await assert.rejects(fixture.api.submit(fixture.api.prepare(wallet, tx, REFERENCE), wallet.id, AUTH), errorCode('transaction_unknown'));
    assert.equal(fixture.calls.length, 1);
  });
}

test('transport failure during submission is never automatically retried', async () => {
  const fixture = transport(new Error('ambiguous timeout'));
  await assert.rejects(fixture.api.submit(fixture.api.prepare(wallet, tx, REFERENCE), wallet.id, AUTH), /ambiguous timeout/);
  assert.equal(fixture.calls.length, 1);
});

test('Privy redirects are not followed with app or authorization credentials', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const fixture = transport(new Response(null, { status, headers: { location: 'https://attacker.invalid' } }));
    await assert.rejects(fixture.api.submit(fixture.api.prepare(wallet, tx, REFERENCE), wallet.id, AUTH), errorCode('wallet_unavailable'));
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].redirect, 'manual');
    assert.equal(fixture.calls[0].url, `${API}/wallets/${wallet.id}/rpc`);
  }
});

test('prepare requires a UUID reference and binds it to the signed idempotency header', () => {
  const fixture = transport();
  for (const id of ['', 'intent-1', 'a'.repeat(65), '../reference', REFERENCE + '\n']) {
    assert.throws(() => fixture.api.prepare(wallet, tx, id), errorCode('request_invalid'));
  }
  for (const now of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => fixture.api.prepare(wallet, tx, REFERENCE, now), errorCode('request_invalid'));
  }
  const prepared = fixture.api.prepare(wallet, tx, REFERENCE, NOW);
  assert.equal(prepared.body.reference_id, REFERENCE);
  assert.equal(prepared.headers['privy-idempotency-key'], REFERENCE);
  assert.deepEqual(fixture.api.validatePrepared(prepared, wallet.id, NOW), {
    walletId: wallet.id, referenceId: REFERENCE, caip2: 'eip155:8453', expiresAt: NOW + 300000,
  });
  assert.throws(() => fixture.api.validatePrepared(prepared, wallet.id, NOW + 300000), errorCode('approval_expired'));
  assert.throws(() => fixture.api.validatePrepared(prepared, wallet.id, NOW - 1), errorCode('approval_expired'));
  assert.equal(fixture.calls.length, 0);
});

test('even a recomputed canonical challenge cannot approve a malformed RPC envelope', () => {
  const fixture = transport();
  const changes: ((p: PreparedTransaction) => void)[] = [
    p => { p.body.reference_id = OTHER_REFERENCE; },
    p => { delete p.body.reference_id; },
    p => { p.body.method = 'personal_sign'; },
    p => { p.body.caip2 = 'eip155:1'; },
    p => { p.body.sponsor = true; },
    p => { (p.body.params as any).extra = true; },
    p => { (p.body.params as any).transaction.value = '-1'; },
    p => { (p.body.params as any).transaction.from = TO; },
    p => { (p.body.params as any).transaction.authorization_list = []; },
    p => { (p.body.params as any).transaction.chain_id = '8453junk'; },
    p => { (p.body.params as any).transaction.to = '0x123'; },
    p => { p.body.params = null; },
  ];
  for (const change of changes) {
    const p = fixture.api.prepare(wallet, tx, REFERENCE, NOW);
    change(p);
    p.challenge = Buffer.from(canonicalize({ version: 1, method: 'POST', url: p.url, body: p.body, headers: p.headers })!).toString('base64url');
    assert.throws(() => fixture.api.validatePrepared(p, wallet.id, NOW), errorCode('approval_expired'));
  }
  assert.equal(fixture.calls.length, 0);
});

test('valid-looking hashes with the wrong response method or chain remain unknown', async () => {
  for (const body of [
    { data: { hash: HASH, caip2: 'eip155:8453' } },
    { method: 'eth_signTransaction', data: { hash: HASH, caip2: 'eip155:8453' } },
    { method: 'eth_sendTransaction', data: { hash: HASH, caip2: 'eip155:1' } },
    { method: 'eth_sendTransaction', data: { hash: HASH } },
  ]) {
    const fixture = transport(response(body));
    await assert.rejects(fixture.api.submit(fixture.api.prepare(wallet, tx, REFERENCE), wallet.id, AUTH), errorCode('transaction_unknown'));
    assert.equal(fixture.calls.length, 1);
  }
});

const context = () => ({ walletId: wallet.id, referenceId: REFERENCE,
  caip2: 'eip155:8453' as const, expiresAt: NOW - 300000 });
const recordedTransaction = () => ({ id: 'transaction-1', wallet_id: wallet.id,
  reference_id: REFERENCE, caip2: 'eip155:8453', status: 'broadcasted', transaction_hash: HASH });

for (const status of ['broadcasted', 'confirmed', 'finalized', 'execution_reverted']) {
  test(`GET-only reconciliation returns the original hash for ${status}, not an execution-success claim`, async () => {
    const fixture = transport(response({ transactions: [{ ...recordedTransaction(), status }] }));
    assert.equal(await fixture.api.reconcile(context()), HASH);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].method, 'GET');
    assert.equal(fixture.calls[0].url, `${API}/transactions?reference_id=${REFERENCE}`);
    assert.equal(fixture.calls[0].body, undefined);
    assert.equal(fixture.calls[0].headers.get('privy-authorization-signature'), null);
    assert.equal(fixture.calls[0].headers.get('privy-idempotency-key'), null);
  });
}

test('missing, ambiguous, mismatched and non-broadcast reference lookups cannot resolve an unknown', async () => {
  const invalid = [
    {}, { transactions: [] }, { transactions: null }, { transactions: {} },
    { transactions: [null] }, { transactions: [recordedTransaction(), recordedTransaction()] },
    ...[
      { reference_id: OTHER_REFERENCE }, { reference_id: null }, { reference_id: undefined },
      { wallet_id: 'other-wallet' }, { caip2: 'eip155:1' }, { caip2: 'eip155:8453junk' },
      { id: '' }, { id: '../other' }, { id: undefined },
      { transaction_hash: null }, { transaction_hash: '0x123' }, { transaction_hash: 12 },
      { transaction_hash: undefined, user_operation_hash: HASH },
      ...['pending', 'failed', 'provider_error', 'replaced', 'success', null].map(status => ({ status })),
    ].map(patch => ({ transactions: [{ ...recordedTransaction(), ...patch }] })),
  ];
  for (const body of invalid) {
    const fixture = transport(response(body));
    assert.equal(await fixture.api.reconcile(context()), null, JSON.stringify(body));
    assert.deepEqual(fixture.calls.map(call => call.method), ['GET']);
  }
});

test('reconcile never posts after absence, HTTP rejection, malformed response, or transport failure', async () => {
  const missing = transport(response({}, 404));
  assert.equal(await missing.api.reconcile(context()), null);
  assert.deepEqual(missing.calls.map(call => call.method), ['GET']);
  for (const reply of [response({}, 400), response({}, 401), response({}, 429), response({}, 503),
    new Response('bad json'), new Error('lost lookup response')]) {
    const fixture = transport(reply);
    await assert.rejects(fixture.api.reconcile(context()));
    assert.deepEqual(fixture.calls.map(call => call.method), ['GET']);
  }
  for (const patch of [{ referenceId: '../reference' }, { walletId: '../wallet' }, { caip2: 'eip155:137' }, { expiresAt: NaN }]) {
    const fixture = transport();
    await assert.rejects(fixture.api.reconcile({ ...context(), ...patch } as any), errorCode('request_invalid'));
    assert.equal(fixture.calls.length, 0);
  }
});

test('POST rejection is not retried or treated as proof that nothing was broadcast', async () => {
  for (const status of [400, 409, 422, 429, 500]) {
    const fixture = transport(response({ error: 'insufficient funds' }, status));
    await assert.rejects(fixture.api.submit(fixture.api.prepare(wallet, tx, REFERENCE), wallet.id, AUTH));
    assert.deepEqual(fixture.calls.map(call => call.method), ['POST']);
  }
});
