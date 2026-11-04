// Test-only fixture shared by the cross-boundary passkey proof. No live network.
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createAccessHandler, createOperatorHandler, type Env } from '../../../../server/miniapp-access/index';
import { Store, type DB, type DBResult, type DBStatement } from '../../../../server/miniapp-access/store';
import type { verifyRegistration, verifyApproval } from '../../../../server/miniapp-access/passkeys';
type RegistrationResponseJSON = Parameters<typeof verifyRegistration>[0];
type AuthenticationResponseJSON = Parameters<typeof verifyApproval>[0];
const ORIGIN = 'https://fxaeon.com';
const BOT = '123456789';
const OPERATOR = 'synthetic-operator-secret-at-least-32-characters';
const ADDRESS = `0x${'ab'.repeat(20)}`;
const HASH = `0x${'12'.repeat(32)}`;
const utf8 = (value: string) => new TextEncoder().encode(value);
const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64url');
const decode = (value: string) => new Uint8Array(Buffer.from(value, 'base64url'));
const concat = (...values: Uint8Array[]) => new Uint8Array(Buffer.concat(values));
const digest = async (value: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', value));
let telegram: CryptoKeyPair;
let publicKey: Uint8Array<ArrayBuffer>;
export async function initializeIdentity() {
  telegram = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', telegram.publicKey));
}
/** Real D1-shaped SQLite transactions; no matching SQL strings to canned responses. */
class SQLiteDB implements DB {
  readonly sql: DatabaseSync;
  afterWrite?: () => void;
  constructor(path = ':memory:') {
    this.sql = new DatabaseSync(path);
    this.sql.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
  }
  prepare(sql: string) { return new Statement(this, sql); }
  async batch<T = Record<string, unknown>>(statements: DBStatement[]): Promise<DBResult<T>[]> {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => (statement as Statement).execute<T>());
      this.sql.exec('COMMIT'); return results;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
class Statement implements DBStatement {
  constructor(readonly db: SQLiteDB, readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.db, this.sql, values); }
  execute<T>(): DBResult<T> {
    const statement = this.db.sql.prepare(this.sql);
    if (statement.columns().length) return { success: true, results: statement.all(...this.values as SQLInputValue[]) as T[] };
    const result = statement.run(...this.values as SQLInputValue[]);
    this.db.afterWrite?.();
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async all<T = Record<string, unknown>>() { return this.execute<T>(); }
  async run<T = Record<string, unknown>>() { return this.execute<T>(); }
}
export async function launch(userId = 1, age = 0, bot = BOT, allowsWriteToPm?: boolean): Promise<string> {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - age), query_id: 'test-query',
    user: JSON.stringify({ id: userId, first_name: 'Private first name', username: 'private_username', allows_write_to_pm: allowsWriteToPm }) });
  const text = `${bot}:WebAppData\n${[...fields].sort(([a], [b]) => a < b ? -1 : 1).map(([key, value]) => `${key}=${value}`).join('\n')}`;
  fields.set('signature', b64(new Uint8Array(await crypto.subtle.sign('Ed25519', telegram.privateKey, utf8(text)))));
  return fields.toString();
}
function request(body: unknown, path = '/api/telegram-wallet', init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body), ...init });
}
type Result = { status: number; body: any; response: Response };
async function result(response: Response): Promise<Result> {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  return { status: response.status, body: await response.json(), response };
}
type Call = { url: string; method: string; headers: Headers; body: any };
type FixtureLifecycle = { after(callback: () => Promise<void>): void };
/** Guard even calls that accidentally bypass the injected provider transport. */
export function forbidGlobalFetch(t: FixtureLifecycle) {
  const original = globalThis.fetch;
  let escapes = 0;
  globalThis.fetch = async () => { escapes++; throw new Error('NETWORK FORBIDDEN'); };
  t.after(async () => {
    globalThis.fetch = original;
    assert.equal(escapes, 0, 'all server providers must use the injected transport');
  });
  return () => escapes;
}
export async function fixture(t: FixtureLifecycle, overrides: Partial<Env> = {}, path?: string) {
  const db = new SQLiteDB(path);
  const env: Env = { ADMISSION_DB: db, TELEGRAM_BOT_ID: BOT, MINIAPP_ORIGIN: ORIGIN,
    MINIAPP_ACCESS_MODE: 'passkey', MINIAPP_LEGACY_USERS: '5', MINIAPP_OPERATOR_TOKEN: OPERATOR,
    PRIVY_APP_ID: 'testapp000000000000000000', PRIVY_APP_SECRET: 'synthetic-provider-secret', PRIVY_PUBLIC_SIGNUP_DISABLED: 'yes',
    RESEND_API_KEY: 're_synthetic_key_never_live', RESEND_FROM: 'FxAeon <invite@fxaeon.com>',
    TELEGRAM_BOT_TOKEN: `${BOT}:abcdefghijklmnopqrstuvwxyz`, TELEGRAM_MINIAPP_URL: 'https://t.me/FxAeonBot/app', ...overrides };
  const store = new Store(db);
  const calls: Call[] = []; const unexpected: string[] = []; const background: Promise<unknown>[] = [];
  let rpcFailure = false;
  let mailResponse: () => Response | Promise<Response> = () => Response.json({ id: 'mock-email-id' });
  let lookup: (call: Call) => Response | Promise<Response> = () => Response.json({ transactions: [] });
  let onRPC: ((call: Call) => void) | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const call: Call = { url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    assert.equal(init?.redirect, 'manual');
    if (call.url === 'https://api.resend.com/emails') return mailResponse();
    if (call.url === `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`) return Response.json({ ok: true, result: { message_id: 1 } });
    const external = /^https:\/\/api\.privy\.io\/v1\/wallets\/ext_wal_([a-zA-Z0-9_-]+)$/.exec(call.url);
    if (external) {
      const row = (await store.enrollments()).find(row => row.externalId === external[1]);
      assert.ok(row?.credential);
      return Response.json({ id: `wallet-${row.userId}`, address: ADDRESS, chain_type: 'ethereum', external_id: row.externalId,
        owner_id: `owner-${row.userId}`, additional_signers: [] });
    }
    const owner = /^https:\/\/api\.privy\.io\/v1\/key_quorums\/owner-(\d+)$/.exec(call.url);
    if (owner) return Response.json({ id: `owner-${owner[1]}`, authorization_threshold: 1,
      authorization_keys: [{ public_key: (await store.status(Number(owner[1])))!.credential!.ownerSPKI }], user_ids: [], key_quorum_ids: [] });
    if (/^https:\/\/api\.privy\.io\/v1\/wallets\/wallet-\d+\/rpc$/.test(call.url)) {
      onRPC?.(call);
      if (rpcFailure) throw new Error('private provider response and synthetic-provider-secret');
      return Response.json({ method: 'eth_sendTransaction', data: { hash: HASH, caip2: call.body.caip2 } });
    }
    if (new URL(call.url).origin === 'https://api.privy.io' && new URL(call.url).pathname === '/v1/transactions') {
      assert.equal(call.method, 'GET'); assert.equal(call.body, undefined);
      assert.deepEqual([...new URL(call.url).searchParams.keys()], ['reference_id']);
      return lookup(call);
    }
    unexpected.push(call.url); throw new Error('unexpected provider request');
  };
  const access = createAccessHandler({ publicKey, fetch: fetcher });
  const operator = createOperatorHandler({ fetch: fetcher });
  const handleRequest = async (incoming: Request) => result(await access({ request: incoming, env,
    waitUntil: work => { background.push(work); } }));
  const send = async (body: unknown, init?: RequestInit) => handleRequest(request(body, undefined, init));
  const asUser = async (action: string, id = 1, fields: Record<string, unknown> = {}) => send({ action, launchData: await launch(id), ...fields });
  const operate = async (body: unknown, authorization: string | null = `Bearer ${OPERATOR}`, init: RequestInit = {}) => result(await operator({
    request: request(body, '/api/miniapp-operator', { headers: { 'content-type': 'application/json', ...(authorization === null ? {} : { authorization }) }, ...init }), env }));
  // Initialize without a launch: status now reserves eligible signed users.
  assert.equal((await operate({ action: 'list' })).status, 200);
  t.after(async () => {
    try { await Promise.all(background); assert.deepEqual(unexpected, []); }
    finally { db.sql.close(); }
  });
  return { db, env, store, calls, access, operator, send, handleRequest, asUser, operate, background, fetcher,
    mailResponse: (response: typeof mailResponse) => { mailResponse = response; },
    failRPC: (value = true) => { rpcFailure = value; },
    lookup: (response: typeof lookup) => { lookup = response; },
    onRPC: (observer: (call: Call) => void) => { onRPC = observer; },
    async refreshedUser(action: string, userId = 1, fields: Record<string, unknown> = {}) {
      const restarted = createAccessHandler({ publicKey, fetch: fetcher });
      return result(await restarted({ request: request({ action, launchData: await launch(userId), ...fields }), env }));
    },
    outbox: () => db.sql.prepare('SELECT * FROM access_mail_outbox').all(),
    async approve(id = 1, notify = false) {
      assert.equal((await asUser('join', id, { notify })).status, 200);
      const approved = await operate({ action: 'approve', userIds: [id] }); assert.equal(approved.status, 200, JSON.stringify(approved.body));
    } };
}

// Independent WebAuthn wire construction, adapted from passkeys.test.ts; no verifier mocks.
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function head(major: number, length: number): Uint8Array {
  if (length < 24) return Uint8Array.of(major * 32 + length);
  if (length < 256) return Uint8Array.of(major * 32 + 24, length);
  assert.ok(length < 65536); return Uint8Array.of(major * 32 + 25, length >>> 8, length & 255);
}
function cbor(value: Cbor): Uint8Array {
  if (typeof value === 'number') return head(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  if (typeof value === 'string') { const data = utf8(value); return concat(head(3, data.length), data); }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  return concat(head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)]));
}
function der(raw: Uint8Array) {
  const integer = (part: Uint8Array) => {
    let first = 0; while (first < part.length - 1 && part[first] === 0) first++;
    const value = part.slice(first); const positive = value[0] & 128 ? concat(Uint8Array.of(0), value) : value;
    return concat(Uint8Array.of(2, positive.length), positive);
  };
  const encoded = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(Uint8Array.of(0x30, encoded.length), encoded);
}
async function authenticator() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const id = crypto.getRandomValues(new Uint8Array(32));
  const cose = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, decode(jwk.x!)], [-3, decode(jwk.y!)]]));
  const authData = async (flags: number, counter: number) => {
    const count = new Uint8Array(4); new DataView(count.buffer).setUint32(0, counter);
    return concat(await digest(utf8('fxaeon.com')), Uint8Array.of(flags), count);
  };
  const clientData = (type: string, challenge: string, origin = ORIGIN) => utf8(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return { id: b64(id),
    async registration(challenge: string, origin = ORIGIN): Promise<RegistrationResponseJSON> {
      const data = concat(await authData(0x5d, 0), new Uint8Array(16), Uint8Array.of(0, id.length), id, cose);
      return { id: b64(id), rawId: b64(id), type: 'public-key', clientExtensionResults: {}, response: {
        clientDataJSON: b64(clientData('webauthn.create', challenge, origin)), transports: ['internal'],
        attestationObject: b64(cbor(new Map<Cbor, Cbor>([['fmt', 'none'], ['authData', data], ['attStmt', new Map()]]))) } };
    },
    async assertion(challenge: string, counter = 1, flags = 0x1d): Promise<AuthenticationResponseJSON> {
      const data = await authData(flags, counter); const client = clientData('webauthn.get', challenge);
      const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, concat(data, await digest(client))));
      return { id: b64(id), rawId: b64(id), type: 'public-key', clientExtensionResults: {}, response: {
        authenticatorData: b64(data), clientDataJSON: b64(client), signature: b64(der(signature)) } };
    },
  };
}
export async function ready(f: Awaited<ReturnType<typeof fixture>>, id = 1) {
  await f.approve(id);
  const device = await authenticator();
  const options = await f.asUser('register/options', id); assert.equal(options.status, 200);
  const response = await device.registration(options.body.options.challenge);
  const completed = await f.asUser('register/complete', id, { challengeId: options.body.challengeId, response });
  assert.equal(completed.status, 200, JSON.stringify(completed.body)); assert.equal(completed.body.state, 'ready');
  return { device, options, response };
}
