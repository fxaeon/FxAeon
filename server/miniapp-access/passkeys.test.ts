import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { registrationOptions, verifyRegistration, verifyApproval, type Passkey } from './passkeys.ts';

// Independent wire fixtures: no mocked verifier and no production encoding helpers.
const ORIGIN = 'https://wallet.example.test';
const RP = 'wallet.example.test';
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const bytes = (value: string) => new Uint8Array(Buffer.from(value, 'base64url'));
const utf8 = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const hash = async (value: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', value));
const challenge = () => b64(crypto.getRandomValues(new Uint8Array(32)));

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function head(major: number, length: number): Uint8Array {
  if (length < 24) return Uint8Array.of(major * 32 + length);
  if (length < 256) return Uint8Array.of(major * 32 + 24, length);
  assert.ok(length < 65536);
  return Uint8Array.of(major * 32 + 25, length >>> 8, length & 255);
}
function cbor(value: Cbor): Uint8Array {
  if (typeof value === 'number') return head(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  if (typeof value === 'string') { const data = utf8(value); return concat(head(3, data.length), data); }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  return concat(head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)]));
}
function derSignature(raw: Uint8Array): Uint8Array {
  assert.equal(raw.length, 64, 'WebCrypto ECDSA returns P1363 r || s');
  const integer = (part: Uint8Array) => {
    let first = 0;
    while (first < part.length - 1 && part[first] === 0) first++;
    const value = part.slice(first);
    const positive = value[0] & 128 ? concat(Uint8Array.of(0), value) : value;
    return concat(Uint8Array.of(2, positive.length), positive);
  };
  const value = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(Uint8Array.of(0x30, value.length), value);
}
type Overrides = { rp?: string; origin?: string; challenge?: string; flags?: number; counter?: number; type?: string };
async function authenticator() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const id = crypto.getRandomValues(new Uint8Array(32));
  const cose = new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, bytes(jwk.x!)], [-3, bytes(jwk.y!)]]);
  const publicKey = cbor(cose);
  const authData = async (flags: number, counter: number, rp: string) => {
    const count = new Uint8Array(4);
    new DataView(count.buffer).setUint32(0, counter);
    return concat(await hash(utf8(rp)), Uint8Array.of(flags), count);
  };
  const clientData = (type: string, expected: string, options: Overrides) => utf8(JSON.stringify({
    type: options.type ?? type, challenge: options.challenge ?? expected,
    origin: options.origin ?? ORIGIN, crossOrigin: false,
  }));
  return {
    keys, id, publicKey,
    async registration(expected: string, options: Overrides = {}, key = publicKey): Promise<RegistrationResponseJSON> {
      const data = concat(await authData(options.flags ?? 0x5d, options.counter ?? 0, options.rp ?? RP),
        new Uint8Array(16), Uint8Array.of(0, id.length), id, key);
      const object = cbor(new Map<Cbor, Cbor>([['fmt', 'none'], ['authData', data], ['attStmt', new Map()]]));
      return { id: b64(id), rawId: b64(id), type: 'public-key', clientExtensionResults: {}, response: {
        clientDataJSON: b64(clientData('webauthn.create', expected, options)), attestationObject: b64(object),
        transports: ['internal'],
      } };
    },
    async assertion(expected: string, options: Overrides = {}): Promise<AuthenticationResponseJSON> {
      const data = await authData(options.flags ?? 0x1d, options.counter ?? 1, options.rp ?? RP);
      const client = clientData('webauthn.get', expected, options);
      const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey,
        concat(data, await hash(client)));
      return { id: b64(id), rawId: b64(id), type: 'public-key', clientExtensionResults: {}, response: {
        authenticatorData: b64(data), clientDataJSON: b64(client), signature: b64(derSignature(new Uint8Array(signature))),
      } };
    },
  };
}
let device: Awaited<ReturnType<typeof authenticator>>;
let registered: Passkey;
before(async () => {
  device = await authenticator();
  const expected = challenge();
  registered = await verifyRegistration(await device.registration(expected), expected, ORIGIN);
});

test('registration requests discoverable ES256 credentials with required user verification', async () => {
  const options = await registrationOptions(RP, 'opaque-account-handle');
  assert.equal(options.rp.id, RP);
  assert.deepEqual(options.pubKeyCredParams, [{ alg: -7, type: 'public-key' }]);
  assert.equal(options.authenticatorSelection?.residentKey, 'required');
  assert.equal(options.authenticatorSelection?.userVerification, 'required');
  assert.equal(options.attestation, 'none');
  assert.equal(Buffer.from(options.user.id, 'base64url').toString(), 'opaque-account-handle');
  assert.ok(bytes(options.challenge).length >= 32);
});

test('verified CBOR credential produces the exact registered P-256 SPKI owner', async () => {
  assert.equal(registered.id, b64(device.id));
  assert.equal(registered.publicKey, b64(device.publicKey));
  assert.equal(registered.counter, 0);
  assert.equal(registered.backedUp, true);
  const spki = await crypto.subtle.exportKey('spki', device.keys.publicKey);
  assert.equal(registered.ownerPublicKey, Buffer.from(spki).toString('base64'));
  const imported = await crypto.subtle.importKey('spki', new Uint8Array(Buffer.from(registered.ownerPublicKey, 'base64')),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const message = utf8('owner-key-possession');
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, device.keys.privateKey, message);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, imported, signature, message), true);
});

for (const [name, overrides, error] of [
  ['wrong RP hash', { rp: 'attacker.test' }, /RP ID/i],
  ['wrong origin', { origin: 'https://attacker.test' }, /origin/i],
  ['wrong challenge', { challenge: 'different' }, /challenge/i],
  ['assertion in registration flow', { type: 'webauthn.get' }, /type/i],
  ['missing UV', { flags: 0x59 }, /verification/i],
  ['missing UP', { flags: 0x5c }, /presence/i],
  ['device-only key', { flags: 0x45 }, /passkey_backup_required/],
  ['backup eligible but not backed up', { flags: 0x4d }, /passkey_backup_required/],
  ['backup without eligibility', { flags: 0x55 }, /backup|Single-device/i],
] as [string, Overrides, RegExp][]) {
  test(`registration rejects ${name}`, async () => {
    const expected = challenge();
    await assert.rejects(verifyRegistration(await device.registration(expected, overrides), expected, ORIGIN), error);
  });
}

test('registration rejects malformed CBOR, unsupported algorithms and invalid EC points', async () => {
  const expected = challenge();
  const response = await device.registration(expected);
  await assert.rejects(verifyRegistration({ ...response, response: { ...response.response, attestationObject: 'AA' } }, expected, ORIGIN));
  for (const [algorithm, curve] of [[-8, 1], [-7, 2], [-7, 1]]) {
    const invalid = cbor(new Map<Cbor, Cbor>([[1, 2], [3, algorithm], [-1, curve], [-2, new Uint8Array(32)], [-3, new Uint8Array(32)]]));
    await assert.rejects(verifyRegistration(await device.registration(expected, {}, invalid), expected, ORIGIN));
  }
});

test('approval verifies a real signature and preserves all original WebAuthn wire fields', async () => {
  const expected = challenge();
  const assertion = await device.assertion(expected);
  const approval = await verifyApproval(assertion, registered, expected, ORIGIN);
  assert.equal(approval.counter, 1);
  assert.equal(approval.authorization, `webauthn:${assertion.response.authenticatorData}:${assertion.response.clientDataJSON}:${assertion.response.signature}`);
});

for (const [name, overrides, error] of [
  ['wrong RP hash', { rp: 'attacker.test' }, /RP ID/i],
  ['wrong origin', { origin: 'https://attacker.test' }, /origin/i],
  ['wrong challenge', { challenge: 'different' }, /challenge/i],
  ['registration in approval flow', { type: 'webauthn.create' }, /type/i],
  ['missing UV', { flags: 0x19 }, /verification/i],
  ['missing UP', { flags: 0x1c }, /present|presence/i],
  ['changed backup eligibility', { flags: 0x05 }, /passkey_rejected/],
] as [string, Overrides, RegExp][]) {
  test(`approval rejects a correctly signed assertion with ${name}`, async () => {
    const expected = challenge();
    await assert.rejects(verifyApproval(await device.assertion(expected, overrides), registered, expected, ORIGIN), error);
  });
}

test('approval rejects changed credential ID, rawId, key, signature and signed bytes', async () => {
  const expected = challenge();
  const valid = await device.assertion(expected);
  const other = await authenticator();
  await assert.rejects(verifyApproval({ ...valid, id: b64(other.id), rawId: b64(other.id) }, registered, expected, ORIGIN), /passkey_rejected/);
  await assert.rejects(verifyApproval({ ...valid, rawId: b64(other.id) }, registered, expected, ORIGIN));
  await assert.rejects(verifyApproval(valid, { ...registered, publicKey: b64(other.publicKey) }, expected, ORIGIN), /passkey_rejected/);
  for (const field of ['signature', 'authenticatorData', 'clientDataJSON'] as const) {
    const changed = structuredClone(valid);
    const data = bytes(changed.response[field]);
    // Keep authenticator data structurally valid; change the signed counter.
    data[field === 'authenticatorData' ? 36 : data.length - 1] ^= 1;
    changed.response[field] = b64(data);
    await assert.rejects(verifyApproval(changed, registered, expected, ORIGIN));
  }
});

test('counter rollback and replay after persisted counter advancement are rejected', async () => {
  const expected = challenge();
  for (const counter of [0, 6, 7]) {
    await assert.rejects(verifyApproval(await device.assertion(expected, { counter }), { ...registered, counter: 7 }, expected, ORIGIN), /counter/i);
  }
  const assertion = await device.assertion(expected, { counter: 8 });
  const first = await verifyApproval(assertion, { ...registered, counter: 7 }, expected, ORIGIN);
  await assert.rejects(verifyApproval(assertion, { ...registered, counter: first.counter }, expected, ORIGIN), /counter/i);
  await assert.rejects(verifyApproval(assertion, registered, challenge(), ORIGIN), /challenge/i);
});

test('mutable backup state can change without invalidating the enrolled multi-device owner', async () => {
  for (const counter of [0, 8]) {
    const expected = challenge();
    const assertion = await device.assertion(expected, { flags: 0x0d, counter });
    const key = { ...registered, counter: counter === 0 ? 0 : 7 };
    const approval = await verifyApproval(assertion, key, expected, ORIGIN);
    assert.equal(approval.counter, counter);
    assert.equal(approval.authorization, `webauthn:${assertion.response.authenticatorData}:${assertion.response.clientDataJSON}:${assertion.response.signature}`);
    await assert.rejects(verifyApproval(assertion, key, challenge(), ORIGIN), /challenge/i);
  }
});

test('synced zero counters work, but replay against a different challenge never does', async () => {
  const expected = challenge();
  const assertion = await device.assertion(expected, { counter: 0 });
  assert.equal((await verifyApproval(assertion, registered, expected, ORIGIN)).counter, 0);
  await assert.rejects(verifyApproval(assertion, registered, challenge(), ORIGIN), /challenge/i);
  // Same-challenge consumption belongs to Store, not this stateless cryptographic verifier.
});
