import assert from 'node:assert/strict';
import { after, before, mock, test, type TestContext } from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { createAccessHandler, createOperatorHandler, type Env } from './index.ts';
import { Store, type DB, type DBResult, type DBStatement } from './store.ts';
import { NotificationStore } from './notifications.ts';
import { onRequest as mountedAccess } from '../../functions/api/telegram-wallet.ts';
import { onRequest as mountedOperator } from '../../functions/api/miniapp-operator.ts';

const ORIGIN = 'https://fxaeon.com';
const BOT = '123456789';
const OPERATOR = 'synthetic-operator-secret-at-least-32-characters';
const ADDRESS = `0x${'ab'.repeat(20)}`;
const TO = `0x${'cd'.repeat(20)}`;
const TX = { to: TO, chainId: 8453, value: '16' };
const HASH = `0x${'12'.repeat(32)}`;
const utf8 = (value: string) => new TextEncoder().encode(value);
const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64url');
const decode = (value: string) => new Uint8Array(Buffer.from(value, 'base64url'));
const concat = (...values: Uint8Array[]) => new Uint8Array(Buffer.concat(values));
const digest = async (value: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', value));
let telegram: CryptoKeyPair;
let publicKey: Uint8Array<ArrayBuffer>;
const forbiddenNetwork: string[] = [];
before(async () => {
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => { forbiddenNetwork.push(String(input)); throw new Error('NETWORK FORBIDDEN'); });
  telegram = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', telegram.publicKey));
});
after(() => { mock.restoreAll(); assert.deepEqual(forbiddenNetwork, [], 'all providers must use injected mocks'); });

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
async function launch(userId = 1, age = 0, bot = BOT, allowsWriteToPm?: boolean): Promise<string> {
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
function error(value: Result, status: number, code: string) {
  assert.equal(value.status, status, JSON.stringify(value.body));
  assert.deepEqual(value.body, { error: code });
}
type Call = { url: string; method: string; headers: Headers; body: any };
async function fixture(t: TestContext, overrides: Partial<Env> = {}, path?: string) {
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
  const send = async (body: unknown, init?: RequestInit) => result(await access({ request: request(body, undefined, init), env,
    waitUntil: work => { background.push(work); } }));
  const asUser = async (action: string, id = 1, fields: Record<string, unknown> = {}) => send({ action, launchData: await launch(id), ...fields });
  const operate = async (body: unknown, authorization: string | null = `Bearer ${OPERATOR}`, init: RequestInit = {}) => result(await operator({
    request: request(body, '/api/miniapp-operator', { headers: { 'content-type': 'application/json', ...(authorization === null ? {} : { authorization }) }, ...init }), env }));
  assert.equal((await asUser('status')).status, 200);
  t.after(async () => {
    try { await Promise.all(background); assert.deepEqual(unexpected, []); }
    finally { db.sql.close(); }
  });
  return { db, env, store, calls, access, operator, send, asUser, operate, background, fetcher,
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
async function ready(f: Awaited<ReturnType<typeof fixture>>, id = 1) {
  await f.approve(id);
  const device = await authenticator();
  const options = await f.asUser('register/options', id); assert.equal(options.status, 200);
  const response = await device.registration(options.body.options.challenge);
  const completed = await f.asUser('register/complete', id, { challengeId: options.body.challengeId, response });
  assert.equal(completed.status, 200, JSON.stringify(completed.body)); assert.equal(completed.body.state, 'ready');
  return { device, options, response };
}

test('both actual Pages mounts reject every non-POST method and expose POST handlers', async t => {
  const f = await fixture(t);
  for (const [mount, path] of [[mountedAccess, '/api/telegram-wallet'], [mountedOperator, '/api/miniapp-operator']] as const) {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']) {
      error(await result(await mount({ request: new Request(`${ORIGIN}${path}`, { method }), env: f.env })), 405, 'method_not_allowed');
    }
  }
  error(await result(await mountedAccess({ request: request({ action: 'status', launchData: await launch() }), env: f.env })), 403, 'launch_rejected');
  error(await result(await mountedOperator({ request: request({ action: 'list' }, '/api/miniapp-operator'), env: f.env })), 401, 'unauthorized');
  const listed = await result(await mountedOperator({ request: request({ action: 'list' }, '/api/miniapp-operator', {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${OPERATOR}` } }), env: f.env }));
  assert.equal(listed.status, 200); assert.deepEqual(listed.body.capacity, { legacy: 5, used: 5, max: 480 });
});

test('unsigned, forged, wrong-bot, duplicated and expired Telegram launch data cannot join', async t => {
  const f = await fixture(t);
  error(await f.send({ action: 'join', notify: true }), 400, 'request_invalid');
  const valid = await launch(); const forged = new URLSearchParams(valid); forged.set('user', JSON.stringify({ id: 999 }));
  const unsigned = new URLSearchParams(valid); unsigned.delete('signature');
  for (const launchData of [forged.toString(), unsigned.toString(), `${valid}&user={}`, await launch(1, 0, '987654321')]) {
    error(await f.send({ action: 'join', notify: true, launchData }), 403, 'launch_rejected');
  }
  for (const age of [86401, -120]) error(await f.send({ action: 'join', notify: true, launchData: await launch(1, age) }), 403, 'launch_expired');
  assert.deepEqual(await f.store.enrollments(), []); assert.deepEqual(f.outbox(), []); assert.equal(f.calls.length, 0);
});

test('origin, URL query, JSON shape, chunked byte limits and unexpected fields fail closed', async t => {
  const f = await fixture(t); const body = { action: 'join', notify: false, launchData: await launch() };
  for (const origin of ['https://attacker.test', 'null', '']) {
    error(await f.send(body, { headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) } }), 403, 'origin_rejected');
  }
  for (const url of [`${ORIGIN}/api/telegram-wallet?launchData=private`, 'https://attacker.test/api/telegram-wallet']) {
    error(await result(await f.access({ request: new Request(url, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env: f.env })), 403, 'origin_rejected');
  }
  for (const raw of ['null', '[]', '"text"', '{', JSON.stringify({ ...body, padding: 'x'.repeat(48_001) })]) {
    error(await f.send(body, { body: raw }), 400, 'request_invalid');
  }
  error(await f.send(body, { headers: { origin: ORIGIN, 'content-type': 'text/plain' } }), 400, 'request_invalid');
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(utf8('{"padding":"')); controller.enqueue(utf8('x'.repeat(24_000)));
    controller.enqueue(utf8('x'.repeat(24_001))); controller.enqueue(utf8('"}')); controller.close();
  } });
  error(await f.send(body, { body: stream, duplex: 'half' } as RequestInit), 400, 'request_invalid');
  error(await f.send({ ...body, unknown: true }), 400, 'request_invalid');
  assert.deepEqual(await f.store.enrollments(), []); assert.equal(f.calls.length, 0);
});

test('join only changes the signed identity, never self-approves, and status is an allowlisted public view', async t => {
  const f = await fixture(t, { MINIAPP_ACCESS_MODE: 'waitlist' });
  for (const fields of [{ userId: 99 }, { telegramId: 99 }, { approved: true }, { state: 'approved' }, { externalId: 'chosen' }]) {
    error(await f.asUser('join', 1, { notify: true, ...fields }), 400, 'request_invalid');
  }
  assert.equal((await f.asUser('join', 1, { notify: false })).body.state, 'waiting');
  assert.equal((await f.asUser('notify', 1, { allowed: true })).body.telegramNotify, true);
  assert.equal((await f.store.status(1))!.externalId, null); assert.equal(await f.store.status(99), null);
  assert.deepEqual((await f.asUser('status')).body, { state: 'waiting', cohortFull: false, telegramNotify: true, telegramWriteAllowed: false, emailVerified: false, emailDelivery: { state: 'not_requested', retryAfterMs: null }, hasCredential: false });
  error(await f.asUser('register/options'), 503, 'wallet_unavailable');
  assert.deepEqual(f.outbox(), []); assert.equal(f.calls.length, 0);
});

async function withoutProviderCompletion<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('handler waited for unrelated provider delivery')), 2000);
    })]);
  } finally { clearTimeout(timer); }
}

for (const action of ['join', 'notify']) {
  test(`unapproved ${action} returns immediately without dispatching unrelated queued email`, async t => {
    const f = await fixture(t);
    await f.store.join(2, false);
    await new NotificationStore(f.db, f.env).setContact(2, 'other@example.com');
    let release!: (response: Response) => void;
    const held = new Promise<Response>(resolve => { release = resolve; });
    f.mailResponse(() => held);
    const work = f.asUser(action, 1, action === 'join' ? { notify: false } : { allowed: true });
    try {
      const response = await withoutProviderCompletion(work);
      assert.equal(response.status, 200);
      assert.equal(response.body.state, 'waiting');
      assert.equal(f.calls.length, 0);
      assert.equal(f.background.length, 0);
      assert.equal(f.outbox()[0].attempts, 0);
    } finally { release(Response.json({ id: 'released' })); await work; }
  });
}

test('approved join durably enqueues its invitation and uses waitUntil without waiting for a stalled global send', async t => {
  const f = await fixture(t);
  await f.store.join(1, false); await f.store.approve([1]);
  await f.store.join(2, false);
  await new NotificationStore(f.db, f.env).setContact(2, 'other@example.com');
  let release!: (response: Response) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<Response>(resolve => { release = resolve; });
  f.mailResponse(() => { entered(); return held; });
  const work = f.asUser('join', 1, { notify: true });
  try {
    const response = await withoutProviderCompletion(work);
    assert.equal(response.status, 200); assert.equal(response.body.state, 'approved');
    assert.ok(f.outbox().some(row => row.id === 'invite:telegram:1'));
    assert.equal(f.background.length, 1);
    await withoutProviderCompletion(started);
    let finished = false;
    void f.background[0].then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(finished, false, 'response arrives while waitUntil still owns the provider send');
  } finally { release(Response.json({ id: 'released' })); await work; await Promise.all(f.background); }
});

test('approved invitation stays durable for scheduled dispatch when waitUntil is unavailable', async t => {
  const f = await fixture(t);
  await f.store.join(1, false); await f.store.approve([1]);
  const response = await f.refreshedUser('join', 1, { notify: true });
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 0);
  assert.equal(f.outbox()[0].status, 'pending');
  assert.equal((await f.operate({ action: 'dispatch' })).body.sent, 1);
});

for (const action of ['email/request', 'email/retry']) {
  test(`${action} dispatches only the current user's verification despite a stalled backlog`, async t => {
    const f = await fixture(t);
    const notifications = new NotificationStore(f.db, f.env);
    await f.store.join(1, true); await f.store.approve([1]);
    await notifications.enqueueInvitation(1, true);
    for (let id = 2; id <= 11; id++) {
      await f.store.join(id, false);
      await notifications.setContact(id, `other${id}@example.com`);
    }
    f.db.sql.prepare('UPDATE access_mail_outbox SET created_at=0').run();
    if (action === 'email/retry') {
      await notifications.setContact(1, 'old@example.com');
      await notifications.setContact(1, 'private@example.com');
    }
    let release!: (response: Response) => void;
    const held = new Promise<Response>(resolve => { release = resolve; });
    f.mailResponse(() => f.calls.at(-1)?.body.to.includes('private@example.com')
      ? Response.json({ id: 'accepted' }) : held);
    const work = f.asUser(action, 1, action === 'email/request' ? { email: 'private@example.com' } : {});
    try {
      const response = await withoutProviderCompletion(work);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.delivery, { state: 'accepted', retryAfterMs: null });
      assert.equal(f.calls.length, 1, 'no other user, invitation, or superseded token is dispatched');
      assert.ok(f.outbox().filter(row => row.status !== 'sent').every(row => row.attempts === 0));
    } finally { release(Response.json({ id: 'released' })); await work; }
  });
}

test('email request still awaits its dispatch result before reporting provider acceptance', async t => {
  const f = await fixture(t); await f.store.join(1, false);
  let release!: (response: Response) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<Response>(resolve => { release = resolve; });
  f.mailResponse(() => { entered(); return held; });
  let responded = false;
  const work = f.asUser('email/request', 1, { email: 'private@example.com' }).then(response => {
    responded = true; return response;
  });
  try {
    await withoutProviderCompletion(started);
    assert.equal(responded, false);
  } finally { release(Response.json({ id: 'accepted' })); }
  const response = await work;
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.delivery, { state: 'accepted', retryAfterMs: null });
});

test('verified Telegram write permission skips only the prompt, never opt-in or admission', async t => {
  const f = await fixture(t, { MINIAPP_ACCESS_MODE: 'waitlist' });
  const launchData = await launch(1, 0, BOT, true);
  const initial = await f.send({ action: 'status', launchData });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.telegramWriteAllowed, true);
  assert.equal(initial.body.telegramNotify, false);
  assert.equal(initial.body.state, 'new');
  const joined = await f.send({ action: 'join', launchData, notify: false });
  assert.equal(joined.body.telegramWriteAllowed, true);
  assert.equal(joined.body.telegramNotify, false);
  assert.equal(joined.body.state, 'waiting');
  const optedIn = await f.send({ action: 'notify', launchData, allowed: true });
  assert.equal(optedIn.body.telegramWriteAllowed, true);
  assert.equal(optedIn.body.telegramNotify, true);
  assert.equal(optedIn.body.state, 'waiting');
  assert.equal(optedIn.body.hasCredential, false);
  assert.equal(optedIn.body.wallet, undefined);
  for (const flag of [false, undefined]) {
    const fresh = await f.send({ action: 'status', launchData: await launch(1, 0, BOT, flag) });
    assert.equal(fresh.body.telegramWriteAllowed, false, 'permission belongs to this signed launch, not persisted enrollment');
  }
  const forged = new URLSearchParams(await launch());
  forged.set('user', JSON.stringify({ id: 1, allows_write_to_pm: true }));
  error(await f.send({ action: 'status', launchData: forged.toString() }), 403, 'launch_rejected');
  error(await f.send({ action: 'status', launchData, telegramWriteAllowed: true }), 400, 'request_invalid');
  assert.equal((await f.store.status(1))!.externalId, null);
  assert.deepEqual(f.outbox(), []); assert.equal(f.calls.length, 0);
});

test('status never returns names, contact address, credential material, external ID or server secrets', async t => {
  const f = await fixture(t); await ready(f);
  f.db.sql.prepare('INSERT INTO access_mail_contacts(user_id,email,verified,expires_at) VALUES(1,?,1,0)').run('private@example.com');
  const status = await f.asUser('status');
  assert.deepEqual(status.body, { state: 'ready', cohortFull: false, telegramNotify: false, telegramWriteAllowed: false, emailVerified: true, emailDelivery: { state: 'verified', retryAfterMs: null }, hasCredential: true,
    wallet: { id: 'wallet-1', address: ADDRESS } });
  const row = (await f.store.status(1))!;
  const text = JSON.stringify(status.body);
  for (const secret of ['private@example.com', 'private_username', 'Private first name', row.externalId!, row.credential!.publicKey,
    row.credential!.credentialID, row.credential!.ownerSPKI, f.env.PRIVY_APP_SECRET!, f.env.RESEND_API_KEY!, OPERATOR]) assert.equal(text.includes(secret), false);
  const list = await f.operate({ action: 'list' });
  assert.deepEqual(Object.keys(list.body.users[0]).sort(), ['joinedAt', 'state', 'userId']);
});

test('operator authentication, malformed batches and unknown users cannot reserve seats or enqueue invitations', async t => {
  const f = await fixture(t); await f.asUser('join', 1, { notify: true });
  for (const auth of [null, '', 'Bearer wrong', `bearer ${OPERATOR}`, 'x'.repeat(513)]) {
    error(await f.operate({ action: 'approve', userIds: [1] }, auth), 401, 'unauthorized');
  }
  for (const userIds of [null, '1', [0], [-1], [1.5], ['1'], [Number.MAX_SAFE_INTEGER + 1]]) {
    error(await f.operate({ action: 'approve', userIds }), 400, 'request_invalid');
  }
  error(await f.operate({ action: 'approve', userIds: [1], approved: true }), 400, 'request_invalid');
  error(await f.operate({ action: 'approve', userIds: [1, 99] }), 409, 'approval_not_applied');
  error(await f.operate({ action: 'approve', userIds: Array(481).fill(1) }), 409, 'approval_not_applied');
  error(await f.operate({ action: 'list' }, undefined, { body: '{' }), 400, 'request_invalid');
  error(await f.operate({ action: 'list' }, undefined, { body: JSON.stringify({ action: 'list', padding: 'x'.repeat(8193) }) }), 400, 'request_invalid');
  assert.equal((await f.store.capacity()).used, 5); assert.deepEqual(f.outbox(), []); assert.equal(f.calls.length, 0);
});

test('passkey enrollment and operator approval fail closed without explicit public-signup disable confirmation', async t => {
  for (const flag of [undefined, '', 'true', 'no']) {
    const f = await fixture(t, { PRIVY_PUBLIC_SIGNUP_DISABLED: flag });
    await f.asUser('join', 1, { notify: true });
    error(await f.operate({ action: 'approve', userIds: [1] }), 503, 'wallet_unavailable');
    await f.store.approve([1]);
    for (const action of ['register/options', 'wallet/retry', 'sign/options']) error(await f.asUser(action), 503, 'wallet_unavailable');
    assert.equal(f.calls.length, 0); assert.deepEqual(f.outbox(), []);
  }
});

test('missing explicit legacy baseline and malformed deployment configuration fail closed', async t => {
  const f = await fixture(t);
  for (const patch of [{ MINIAPP_LEGACY_USERS: undefined }, { MINIAPP_LEGACY_USERS: '481' }, { MINIAPP_LEGACY_USERS: '05' },
    { MINIAPP_ACCESS_MODE: 'open' }, { ADMISSION_DB: undefined }, { TELEGRAM_BOT_ID: 'bad' }, { MINIAPP_ORIGIN: 'http://fxaeon.com' }]) {
    const env = { ...f.env, ...patch };
    error(await result(await f.access({ request: request({ action: 'status', launchData: await launch() }), env })), 503, 'access_unavailable');
  }
});

test('approval batch overflow at total 479 rolls back every seat and notification', async t => {
  const f = await fixture(t);
  for (let id = 1; id <= 476; id++) await f.store.join(id, id >= 475);
  await f.store.approve(Array.from({ length: 474 }, (_, i) => i + 1));
  assert.deepEqual(await f.store.capacity(), { legacy: 5, used: 479, max: 480 });
  error(await f.operate({ action: 'approve', userIds: [475, 476] }), 409, 'approval_not_applied');
  assert.equal((await f.store.status(475))!.state, 'waiting'); assert.equal((await f.store.status(476))!.state, 'waiting');
  assert.equal((await f.store.capacity()).used, 479); assert.deepEqual(f.outbox(), []); assert.equal(f.calls.length, 0);
});

test('separate handler isolates racing real SQLite connections cannot exceed 480 including five legacy users', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fxaeon-handler-race-'));
  const path = join(dir, 'admission.sqlite');
  const f = await fixture(t, {}, path);
  f.db.sql.exec('PRAGMA journal_mode=WAL');
  for (let id = 1; id <= 478; id++) await f.store.join(id, id >= 475);
  await f.store.approve(Array.from({ length: 474 }, (_, i) => i + 1));
  const gate = new SharedArrayBuffer(4);
  const { ADMISSION_DB: _db, ...workerEnv } = f.env;
  const workers = [475, 476, 477, 478].map(userId => new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    require('tsx/cjs');
    globalThis.fetch = async () => { throw new Error('NETWORK FORBIDDEN'); };
    const { createOperatorHandler } = require(workerData.index);
    const sql = new DatabaseSync(workerData.path);
    sql.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
    function prepare(query, values=[]) {
      const execute = () => {
        const statement = sql.prepare(query);
        if (statement.columns().length) return { success:true, results:statement.all(...values) };
        const result = statement.run(...values); return { success:true, results:[], meta:{changes:Number(result.changes)} };
      };
      return { bind:(...args)=>prepare(query,args), execute, all:async()=>execute(), run:async()=>execute() };
    }
    const db = { prepare, batch:async statements => {
      sql.exec('BEGIN IMMEDIATE');
      try { const results=statements.map(s=>s.execute()); sql.exec('COMMIT'); return results; }
      catch(error) { sql.exec('ROLLBACK'); throw error; }
    } };
    let calls=0;
    const handler = createOperatorHandler({fetch:async input=> {
      if (!String(input).startsWith('https://api.telegram.org/bot')) throw new Error('Unexpected provider');
      calls++; return Response.json({ok:true,result:{message_id:1}});
    }});
    parentPort.postMessage({ready:true});
    Atomics.wait(new Int32Array(workerData.gate),0,0);
    handler({env:{...workerData.env,ADMISSION_DB:db},request:new Request('https://fxaeon.com/api/miniapp-operator',{
      method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+workerData.env.MINIAPP_OPERATOR_TOKEN},
      body:JSON.stringify({action:'approve',userIds:[workerData.userId]})
    })}).then(async response=>parentPort.postMessage({status:response.status,body:await response.json(),calls}))
      .catch(error=>parentPort.postMessage({failure:String(error)})).finally(()=>sql.close());
  `, { eval: true, workerData: { path, gate, userId, env: workerEnv, index: fileURLToPath(new URL('./index.ts', import.meta.url)) } }));
  t.after(async () => {
    await Promise.all(workers.map(worker => worker.terminate()));
    // fixture's earlier cleanup hook has already closed the main connection.
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith('fxaeon-handler-race-'));
    rmSync(dir, { recursive: true, force: true });
  });
  const outcomes = workers.map(worker => new Promise<any>((resolve, reject) => {
    worker.on('message', value => { if (!value.ready) resolve(value); }); worker.on('error', reject);
    worker.on('exit', code => { if (code !== 0) reject(new Error(`worker exited ${code}`)); });
  }));
  await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => {
    worker.once('message', value => { assert.equal(value.ready, true); resolve(); }); worker.once('error', reject);
  })));
  Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
  const results = await Promise.all(outcomes);
  assert.equal(results.filter(value => value.status === 200).length, 1, JSON.stringify(results));
  assert.equal(results.filter(value => value.status === 409 && value.body.error === 'approval_not_applied').length, 3);
  assert.equal(results.reduce((sum, value) => sum + value.calls, 0), 1);
  assert.deepEqual(await f.store.capacity(), { legacy: 5, used: 480, max: 480 });
  assert.equal((await f.store.enrollments()).filter(row => row.externalId).length, 475);
  assert.equal(f.outbox().length, 1);
});

test('email verification requires POST, never admits a waiting user and cannot choose another identity', async t => {
  const f = await fixture(t);
  error(await f.asUser('email/request', 1, { email: 'private@example.com' }), 403, 'join_required');
  await f.asUser('join', 1, { notify: false });
  const sent = await f.asUser('email/request', 1, { email: 'private@example.com' });
  assert.deepEqual(sent.body, { status: 'verification_requested', delivery: { state: 'accepted', retryAfterMs: null } });
  const email = f.calls.find(call => call.url === 'https://api.resend.com/emails')!;
  const token = /https:\/\/fxaeon\.com\/invite#token=([a-f0-9]{64})/.exec(email.body.text)![1];
  error(await result(await f.access({ request: new Request(`${ORIGIN}/api/telegram-wallet?token=${token}`), env: f.env })), 405, 'method_not_allowed');
  assert.equal((await f.asUser('status')).body.emailVerified, false);
  error(await f.send({ action: 'email/confirm', token, userId: 99 }), 400, 'request_invalid');
  assert.deepEqual((await f.send({ action: 'email/confirm', token })).body, { verified: true });
  error(await f.send({ action: 'email/confirm', token }), 400, 'confirmation_expired');
  assert.equal((await f.store.status(1))!.state, 'waiting'); assert.equal(await f.store.status(99), null);
  error(await f.asUser('register/options'), 403, 'approval_required');
  assert.equal(f.calls.length, 1); assert.equal(f.outbox().length, 1);
});

test('disabled email and rate limits return honest mapped errors without revealing addresses', async t => {
  const f = await fixture(t); await f.asUser('join', 1, { notify: false });
  f.env.RESEND_API_KEY = undefined;
  error(await f.asUser('email/request', 1, { email: 'private@example.com' }), 503, 'notification_unavailable');
  f.env.RESEND_API_KEY = 're_synthetic_key_never_live';
  for (let i = 0; i < 3; i++) assert.equal((await f.asUser('email/request', 1, { email: 'private@example.com' })).status, 200);
  error(await f.asUser('email/request', 1, { email: 'private@example.com' }), 429, 'notification_rate_limited');
  assert.equal(f.calls.length, 3);
});

test('email API exposes only delivery state and bounded retry timing; retry uses signed user identity', async t => {
  const f = await fixture(t);
  error(await f.asUser('email/retry'), 403, 'join_required');
  await f.asUser('join', 1, { notify: false });
  await f.asUser('join', 2, { notify: false });
  f.mailResponse(() => { throw new TypeError('secret provider/recipient/token detail'); });
  const first = await f.asUser('email/request', 1, { email: 'private@example.com' });
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'verification_requested');
  assert.equal(first.body.delivery.state, 'pending');
  assert.ok(first.body.delivery.retryAfterMs > 0 && first.body.delivery.retryAfterMs <= 60000);
  assert.deepEqual(Object.keys(first.body.delivery).sort(), ['retryAfterMs', 'state']);
  const pending = await f.asUser('email/retry');
  assert.equal(pending.body.delivery.state, 'pending');
  assert.equal(f.calls.length, 1, 'retry must not bypass existing backoff');
  error(await f.asUser('email/retry', 2), 503, 'notification_unavailable');
  error(await f.asUser('email/retry', 1, { userId: 2 }), 400, 'request_invalid');
  error(await f.asUser('email/retry', 1, { email: 'other@example.com' }), 400, 'request_invalid');
  assert.deepEqual((await f.asUser('status', 2)).body.emailDelivery, { state: 'not_requested', retryAfterMs: null });
  f.db.sql.prepare("UPDATE access_mail_outbox SET next_at=0 WHERE user_id=1").run();
  f.mailResponse(() => Response.json({ id: 'accepted' }));
  const accepted = await f.asUser('email/retry');
  assert.deepEqual(accepted.body, { status: 'verification_requested', delivery: { state: 'accepted', retryAfterMs: null } });
  assert.equal(f.calls.length, 2);
  assert.deepEqual((await f.asUser('status')).body.emailDelivery, { state: 'accepted', retryAfterMs: null });
  for (const body of [first.body, pending.body, accepted.body]) {
    assert.ok(!JSON.stringify(body).includes('private@example.com'));
    assert.ok(!JSON.stringify(body).includes('token'));
  }
});

test('provider rejection returns failed delivery, and explicit retry can create a rate-limited replacement', async t => {
  const f = await fixture(t); await f.asUser('join', 1, { notify: false });
  f.mailResponse(() => new Response('private credentials/recipient', { status: 403 }));
  const failed = await f.asUser('email/request', 1, { email: 'private@example.com' });
  assert.deepEqual(failed.body, { status: 'verification_requested', delivery: { state: 'failed', retryAfterMs: 0 } });
  f.mailResponse(() => Response.json({ id: 'accepted' }));
  assert.equal((await f.asUser('email/retry')).body.delivery.state, 'accepted');
  assert.equal(f.calls.length, 2);
});

test('operator dispatch reconciles durable approval after interrupted enqueue and sends only one invitation', async t => {
  const f = await fixture(t); await f.asUser('join', 1, { notify: true });
  await f.store.approve([1]); assert.deepEqual(f.outbox(), []);
  assert.equal((await f.operate({ action: 'dispatch' })).body.sent, 1);
  assert.equal((await f.operate({ action: 'dispatch' })).body.sent, 0);
  assert.equal(f.calls.length, 1); assert.equal((await f.store.status(1))!.state, 'approved');
});

test('real registration binds once, requires a fresh launch, and replay or replacement cannot change its owner', async t => {
  const f = await fixture(t); await f.approve();
  error(await f.send({ action: 'register/options', launchData: await launch(1, 901) }), 403, 'launch_expired');
  const device = await authenticator();
  const options = await f.asUser('register/options');
  assert.equal(options.body.options.rp.id, 'fxaeon.com');
  const response = await device.registration(options.body.options.challenge);
  assert.equal((await f.asUser('register/complete', 1, { challengeId: options.body.challengeId, response })).status, 200);
  const original = await f.store.status(1); const calls = f.calls.length;
  error(await f.asUser('register/options'), 409, 'passkey_already_registered');
  error(await f.asUser('register/complete', 1, { challengeId: options.body.challengeId, response }), 403, 'approval_expired');
  assert.deepEqual(await f.store.status(1), original); assert.equal(f.calls.length, calls);
  assert.equal(original!.credential!.credentialID, device.id);
  assert.equal((await f.asUser('wallet/retry')).status, 200);
  assert.deepEqual((await f.store.status(1))!.credential, original!.credential);
});

test('a cryptographically valid registration for the wrong origin is consumed and cannot be retried', async t => {
  const f = await fixture(t); await f.approve(); const device = await authenticator();
  const options = await f.asUser('register/options');
  error(await f.asUser('register/complete', 1, { challengeId: options.body.challengeId,
    response: await device.registration(options.body.options.challenge, 'https://attacker.test') }), 403, 'passkey_rejected');
  error(await f.asUser('register/complete', 1, { challengeId: options.body.challengeId,
    response: await device.registration(options.body.options.challenge) }), 403, 'approval_expired');
  assert.equal((await f.store.status(1))!.credential, null); assert.equal(f.calls.length, 0);
});

test('provisioning never reports a wallet that lost the durable binding race', async t => {
  const f = await fixture(t); await f.approve();
  const device = await authenticator();
  const options = await f.asUser('register/options');
  const winner = { id: 'wallet-winner', address: TO, verified: true } as const;
  const racing = createAccessHandler({ publicKey, fetch: async (input, init) => {
    if (String(input).includes('/wallets/ext_wal_')) assert.equal(await f.store.saveWallet(1, winner), true);
    return f.fetcher(input, init);
  } });
  error(await result(await racing({ env: f.env, request: request({ action: 'register/complete', launchData: await launch(),
    challengeId: options.body.challengeId, response: await device.registration(options.body.options.challenge) }) })),
  503, 'wallet_owner_mismatch');
  assert.equal((await f.store.status(1))!.walletId, winner.id);
  assert.equal((await f.store.status(1))!.walletAddress, winner.address.toLowerCase());
});

test('wallet retries are bounded per approved identity before provider I/O', async t => {
  const f = await fixture(t); await ready(f);
  // Registration already consumed one provisioning attempt.
  for (let i = 0; i < 4; i++) assert.equal((await f.asUser('wallet/retry')).status, 200);
  const calls = f.calls.length;
  error(await f.asUser('wallet/retry'), 429, 'wallet_rate_limited');
  assert.equal(f.calls.length, calls);
});

test('handoff options and completion bind to the original challenge; Telegram identities cannot redirect or poll each other', async t => {
  const f = await fixture(t); await f.approve(1); await f.approve(2);
  const device = await authenticator(); const options = await f.asUser('register/options', 1);
  assert.notEqual((await f.asUser('handoff/create', 2, { challengeId: options.body.challengeId })).status, 200);
  error(await f.asUser('register/complete', 2, { challengeId: options.body.challengeId,
    response: await device.registration(options.body.options.challenge) }), 403, 'approval_expired');
  const created = await f.asUser('handoff/create', 1, { challengeId: options.body.challengeId });
  const link = new URL(created.body.url); assert.equal(link.origin, ORIGIN); assert.equal(link.pathname, '/wallet-approval'); assert.equal(link.search, '');
  const token = new URLSearchParams(link.hash.slice(1)).get('token')!;
  assert.equal(created.body.url.includes('launchData'), false);
  error(await f.asUser('handoff/status', 2, { challengeId: options.body.challengeId }), 403, 'approval_expired');
  const read = await f.send({ action: 'handoff/read', token });
  assert.equal(read.body.kind, 'register'); assert.equal(read.body.options.challenge, options.body.options.challenge);
  assert.deepEqual((await f.asUser('handoff/status', 1, { challengeId: options.body.challengeId })).body, { state: 'pending', result: null });
  error(await f.send({ action: 'handoff/complete', token, userId: 2, response: {} }), 400, 'request_invalid');
  const completed = await f.send({ action: 'handoff/complete', token, response: await device.registration(options.body.options.challenge) });
  assert.equal(completed.body.state, 'ready');
  assert.equal((await f.store.status(1))!.state, 'ready'); assert.equal((await f.store.status(2))!.credential, null);
  assert.equal((await f.asUser('handoff/status', 1, { challengeId: options.body.challengeId })).body.state, 'done');
  error(await f.send({ action: 'handoff/complete', token, response: {} }), 403, 'approval_expired');
});

test('arbitrary proxy URLs, wallet IDs, RPC methods, owners and signer fields are refused before provider I/O', async t => {
  const f = await fixture(t); await ready(f); f.calls.length = 0;
  for (const fields of [{ walletId: 'wallet-other' }, { url: 'https://attacker.test' }, { owner: { public_key: 'attacker' } },
    { authorization: 'arbitrary' }, { method: 'eth_sign' }, { additional_signers: ['backend'] }]) {
    error(await f.asUser('sign/options', 1, { transaction: TX, ...fields }), 400, 'request_invalid');
    error(await f.asUser('wallet/retry', 1, fields), 400, 'request_invalid');
  }
  for (const transaction of [{ ...TX, method: 'eth_sign' }, { ...TX, walletId: 'other' }, { ...TX, url: 'https://attacker.test' }]) {
    error(await f.asUser('sign/options', 1, { transaction }), 400, 'request_invalid');
  }
  for (const transaction of [{ ...TX, from: TO }, { ...TX, chainId: 999 }, { ...TX, to: 'https://attacker.test' }]) {
    error(await f.asUser('sign/options', 1, { transaction }), 400, 'transaction_invalid');
  }
  assert.equal(f.calls.length, 0);
});

test('successful real passkey signing submits the exact approved transaction once and replay returns its hash', async t => {
  const f = await fixture(t); const { device } = await ready(f);
  const options = await f.asUser('sign/options', 1, { transaction: TX }); assert.equal(options.status, 200);
  const response = await device.assertion(options.body.options.challenge);
  const fields = { challengeId: options.body.challengeId, response };
  assert.deepEqual((await f.asUser('sign/complete', 1, fields)).body, { hash: HASH });
  assert.deepEqual((await f.asUser('sign/complete', 1, fields)).body, { hash: HASH });
  const calls = f.calls.filter(call => call.url.endsWith('/rpc')); assert.equal(calls.length, 1);
  const signed = JSON.parse(Buffer.from(options.body.options.challenge, 'base64url').toString());
  assert.deepEqual(calls[0].body, { method: 'eth_sendTransaction', caip2: 'eip155:8453',
    reference_id: signed.body.reference_id, params: { transaction: { to: TO, chain_id: 8453, value: '0x10' } } });
  assert.equal(calls[0].body.reference_id, calls[0].headers.get('privy-idempotency-key'));
  assert.match(calls[0].headers.get('privy-authorization-signature')!, /^webauthn:/);
  assert.equal((await f.store.status(1))!.credential!.counter, 1);
});

test('assertions reject changed BE before provider I/O but mutable BS does not lock out the owner', async t => {
  const f = await fixture(t); const { device } = await ready(f); f.calls.length = 0;
  const invalid = await f.asUser('sign/options', 1, { transaction: TX });
  error(await f.asUser('sign/complete', 1, { challengeId: invalid.body.challengeId,
    response: await device.assertion(invalid.body.options.challenge, 1, 0x05) }), 403, 'passkey_rejected');
  assert.equal(f.calls.length, 0);
  assert.equal((await f.store.status(1))!.credential!.counter, 0);
  const valid = await f.asUser('sign/options', 1, { transaction: TX });
  const fields = { challengeId: valid.body.challengeId,
    response: await device.assertion(valid.body.options.challenge, 1, 0x0d) };
  assert.deepEqual((await f.asUser('sign/complete', 1, fields)).body, { hash: HASH });
  assert.deepEqual((await f.asUser('sign/complete', 1, fields)).body, { hash: HASH });
  assert.equal(f.calls.filter(call => call.url.endsWith('/rpc')).length, 1);
  assert.equal((await f.store.status(1))!.credential!.counter, 1);
  assert.equal((await f.store.status(1))!.credential!.backedUp, true, 'retains enrollment evidence, not current BS');
});

test('unknown transaction outcome is durable: replay cannot submit and fresh signing is blocked before another passkey prompt', async t => {
  const f = await fixture(t); const { device } = await ready(f); f.failRPC();
  const options = await f.asUser('sign/options', 1, { transaction: TX });
  const fields = { challengeId: options.body.challengeId, response: await device.assertion(options.body.options.challenge) };
  error(await f.asUser('sign/complete', 1, fields), 503, 'transaction_unknown');
  error(await f.asUser('sign/complete', 1, fields), 409, 'transaction_unknown');
  const otherHandler = createAccessHandler({ publicKey, fetch: async () => { throw new Error('must not resubmit'); } });
  error(await result(await otherHandler({ request: request({ action: 'sign/complete', launchData: await launch(), ...fields }), env: f.env })), 409, 'transaction_unknown');
  const callsBefore = f.calls.length;
  error(await f.asUser('sign/options', 1, { transaction: TX }), 409, 'transaction_unresolved');
  assert.equal(f.calls.length, callsBefore);
  assert.equal(f.db.sql.prepare("SELECT count(*) n FROM admission_challenges WHERE user_id=1 AND kind='sign'").get()!.n, 0);
  assert.equal(f.calls.filter(call => call.url.endsWith('/rpc')).length, 1);
  assert.equal(f.db.sql.prepare('SELECT state FROM access_operations WHERE id=?').get(options.body.challengeId)!.state, 'unknown');
  assert.equal((await f.store.status(1))!.state, 'ready');
});

type Fixture = Awaited<ReturnType<typeof fixture>>;
function operation(f: Fixture, id: string) {
  const row = f.db.sql.prepare('SELECT * FROM access_operations WHERE id=?').get(id);
  assert.ok(row, 'operation must be durably journaled'); return row;
}
function evidence(f: Fixture, id: string, patch: Record<string, unknown> = {}) {
  const row = operation(f, id);
  return { id: 'provider-transaction-1', reference_id: row.reference_id, wallet_id: row.wallet_id,
    caip2: row.caip2, status: 'broadcasted', transaction_hash: HASH, ...patch };
}
async function signedIntent(f: Fixture, device: Awaited<ReturnType<typeof authenticator>>, chainId = 8453, counter = 1) {
  const options = await f.asUser('sign/options', 1, { transaction: { ...TX, chainId } });
  assert.equal(options.status, 200, JSON.stringify(options.body));
  return { id: options.body.challengeId as string, options: options.body.options,
    fields: { challengeId: options.body.challengeId, response: await device.assertion(options.body.options.challenge, counter) } };
}

for (const chainId of [1, 8453]) test(`lost successful response survives refresh, blocks new signing, and requires exact acknowledgement on chain ${chainId}`, async t => {
  const f = await fixture(t); const { device } = await ready(f);
  assert.deepEqual((await f.asUser('transaction/status')).body, { operation: null });
  const intent = await signedIntent(f, device, chainId);
  const signed = JSON.parse(Buffer.from(intent.options.challenge, 'base64url').toString());
  let inspectedClaim = false;
  f.onRPC(call => {
    const row = operation(f, intent.id); inspectedClaim = true;
    assert.equal(row.state, 'dispatching'); assert.equal(row.acknowledged, 0); assert.equal(row.hash, null);
    assert.equal(row.wallet_id, 'wallet-1'); assert.equal(row.reference_id, signed.body.reference_id);
    assert.equal(row.caip2, `eip155:${chainId}`); assert.equal(row.expires_at, Number(signed.headers['privy-request-expiry']));
    assert.equal(call.body.reference_id, row.reference_id);
    assert.deepEqual(call.body, signed.body);
  });
  // Simulate a lost browser response: ignore the result and reconstruct handler state from SQLite.
  await f.asUser('sign/complete', 1, intent.fields);
  assert.equal(inspectedClaim, true); assert.equal(operation(f, intent.id).state, 'submitted');
  const callsBefore = f.calls.length;
  const recovered = await f.refreshedUser('transaction/status');
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.body, { operation: { id: intent.id, state: 'submitted', hash: HASH, acknowledged: false, chainId } });
  assert.equal(f.calls.length, callsBefore, 'persisted success must not need any provider request');
  error(await f.refreshedUser('sign/options', 1, { transaction: TX }), 409, 'transaction_unresolved');
  assert.equal((await f.store.status(1))!.credential!.counter, 1);
  assert.equal(f.db.sql.prepare("SELECT count(*) n FROM admission_challenges WHERE kind='sign'").get()!.n, 0);
  const ack = await f.refreshedUser('transaction/ack', 1, { id: intent.id, hash: HASH });
  assert.equal(ack.status, 200); assert.deepEqual(ack.body, { acknowledged: true });
  assert.deepEqual((await f.refreshedUser('transaction/ack', 1, { id: intent.id, hash: HASH })).body, { acknowledged: true });
  assert.deepEqual((await f.refreshedUser('transaction/status')).body, { operation: null });
  assert.equal(operation(f, intent.id).acknowledged, 1);
  assert.deepEqual((await f.refreshedUser('sign/complete', 1, intent.fields)).body, { hash: HASH });
  const next = await f.refreshedUser('sign/options', 1, { transaction: TX });
  assert.equal(next.status, 200); assert.notEqual(next.body.challengeId, intent.id);
  assert.equal(f.calls.length, callsBefore, 'neither ACK, status nor new options may POST automatically');
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.url.endsWith('/rpc')).length, 1);
});

test('unknown response recovers by GET of its persisted signed reference and remains blocked until acknowledged', async t => {
  const f = await fixture(t); const { device } = await ready(f); f.failRPC();
  const intent = await signedIntent(f, device);
  error(await f.asUser('sign/complete', 1, intent.fields), 503, 'transaction_unknown');
  const row = operation(f, intent.id); assert.equal(row.state, 'unknown');
  f.lookup(() => Response.json({ transactions: [evidence(f, intent.id)] }));
  const before = f.calls.length;
  const recovered = await f.refreshedUser('transaction/status');
  assert.deepEqual(recovered.body, { operation: { id: intent.id, state: 'submitted', hash: HASH, acknowledged: false, chainId: 8453 } });
  assert.deepEqual(f.calls.slice(before).map(call => [call.method, call.url]), [
    ['GET', `https://api.privy.io/v1/transactions?reference_id=${row.reference_id}`],
  ]);
  assert.equal(operation(f, intent.id).state, 'submitted');
  const recoveredCalls = f.calls.length;
  error(await f.refreshedUser('sign/options', 1, { transaction: TX }), 409, 'transaction_unresolved');
  assert.deepEqual((await f.refreshedUser('sign/complete', 1, intent.fields)).body, { hash: HASH });
  assert.equal(f.calls.length, recoveredCalls);
  assert.deepEqual((await f.refreshedUser('transaction/ack', 1, { id: intent.id, hash: HASH })).body, { acknowledged: true });
  assert.deepEqual((await f.refreshedUser('transaction/status')).body, { operation: null });
  assert.equal(f.calls.filter(call => call.url.endsWith('/rpc')).length, 1);
});

test('mismatched reference, wallet, chain or nonbroadcast evidence never clears an unknown operation', async t => {
  const f = await fixture(t); const { device } = await ready(f); f.failRPC();
  const intent = await signedIntent(f, device);
  error(await f.asUser('sign/complete', 1, intent.fields), 503, 'transaction_unknown');
  const unknown = { operation: { id: intent.id, state: 'unknown', hash: null, acknowledged: false, chainId: 8453 } };
  const bodies = [ {}, { transactions: [] }, { transactions: [evidence(f, intent.id), evidence(f, intent.id)] },
    ...[{ reference_id: crypto.randomUUID() }, { reference_id: undefined }, { wallet_id: 'wallet-other' },
      { caip2: 'eip155:1' }, { status: 'pending' }, { status: 'failed' }, { transaction_hash: '0x123' },
      { transaction_hash: undefined, user_operation_hash: HASH }].map(patch => ({ transactions: [evidence(f, intent.id, patch)] })) ];
  const before = f.calls.length;
  for (const body of bodies) {
    f.lookup(() => Response.json(body));
    const status = await f.refreshedUser('transaction/status'); assert.equal(status.status, 200); assert.deepEqual(status.body, unknown);
    assert.equal(operation(f, intent.id).acknowledged, 0); assert.equal(operation(f, intent.id).state, 'unknown');
    error(await f.refreshedUser('transaction/ack', 1, { id: intent.id, hash: HASH }), 409, 'transaction_unresolved');
    error(await f.refreshedUser('sign/options', 1, { transaction: TX }), 409, 'transaction_unresolved');
  }
  assert.ok(f.calls.slice(before).every(call => call.method === 'GET' && new URL(call.url).pathname === '/v1/transactions'));
  assert.equal(f.calls.filter(call => call.url.endsWith('/rpc')).length, 1);
});

test('recovery failure or elapsed signing expiry does not erase an ambiguous broadcast or trigger a POST', async t => {
  const f = await fixture(t); const { device } = await ready(f); f.failRPC();
  const intent = await signedIntent(f, device); await f.asUser('sign/complete', 1, intent.fields);
  // The signing deadline expired; a prior POST may still have broadcast successfully.
  f.db.sql.prepare('UPDATE access_operations SET expires_at=? WHERE id=?').run(Date.now() - 60_000, intent.id);
  const before = f.calls.length;
  for (const reply of [() => new Response('', { status: 404 }), () => Response.json({ transactions: [] }),
    () => Response.json({ error: 'synthetic-provider-secret' }, { status: 503 }), () => { throw new Error('private provider error'); }]) {
    f.lookup(reply);
    const status = await f.refreshedUser('transaction/status');
    assert.ok([200, 503].includes(status.status));
    assert.equal(JSON.stringify(status.body).includes('synthetic-provider-secret'), false);
    assert.equal(operation(f, intent.id).state, 'unknown'); assert.equal(operation(f, intent.id).acknowledged, 0);
    error(await f.refreshedUser('sign/options', 1, { transaction: TX }), 409, 'transaction_unresolved');
  }
  f.lookup(() => Response.json({ transactions: [evidence(f, intent.id, { status: 'execution_reverted' })] }));
  assert.deepEqual((await f.refreshedUser('transaction/status')).body, {
    operation: { id: intent.id, state: 'submitted', hash: HASH, acknowledged: false, chainId: 8453 },
  });
  assert.ok(f.calls.slice(before).every(call => call.method === 'GET'));
  assert.equal(f.calls.filter(call => call.url.endsWith('/rpc')).length, 1);
});

test('acknowledgement is bound to the signed Telegram identity and exact submitted operation/hash', async t => {
  const f = await fixture(t); const { device } = await ready(f); await f.approve(2);
  const intent = await signedIntent(f, device); await f.asUser('sign/complete', 1, intent.fields);
  const before = f.calls.length;
  assert.deepEqual((await f.asUser('transaction/status', 2)).body, { operation: null });
  error(await f.asUser('transaction/ack', 2, { id: intent.id, hash: HASH }), 409, 'transaction_unresolved');
  error(await f.asUser('transaction/ack', 1, { id: intent.id, hash: `0x${'34'.repeat(32)}` }), 409, 'transaction_unresolved');
  error(await f.asUser('transaction/ack', 1, { id: crypto.randomUUID(), hash: HASH }), 409, 'transaction_unresolved');
  error(await f.asUser('transaction/ack', 1, { id: intent.id, hash: 'not-a-hash' }), 400, 'request_invalid');
  error(await f.asUser('transaction/ack', 1, { id: intent.id, hash: HASH, userId: 2 }), 400, 'request_invalid');
  assert.deepEqual((await f.asUser('transaction/status', 2, { id: intent.id })).body, { operation: null });
  error(await f.asUser('transaction/status', 1, { walletId: 'wallet-other' }), 400, 'request_invalid');
  error(await f.send({ action: 'transaction/ack', id: intent.id, hash: HASH }), 400, 'request_invalid');
  assert.equal(operation(f, intent.id).acknowledged, 0);
  assert.equal(f.calls.length, before, 'acknowledgements do not contact any provider');
  assert.deepEqual((await f.asUser('transaction/ack', 1, { id: intent.id, hash: HASH })).body, { acknowledged: true });
});

test('a process crash leaving dispatching context can recover concurrently using GET without duplicate submission', async t => {
  const f = await fixture(t); const { device } = await ready(f); f.failRPC();
  const intent = await signedIntent(f, device); await f.asUser('sign/complete', 1, intent.fields);
  // A process killed after POST but before unknown()/complete() leaves this durable state.
  f.db.sql.prepare("UPDATE access_operations SET state='dispatching' WHERE id=?").run(intent.id);
  f.lookup(() => Response.json({ transactions: [evidence(f, intent.id)] }));
  const before = f.calls.length;
  const statuses = await Promise.all([f.refreshedUser('transaction/status'), f.refreshedUser('transaction/status')]);
  for (const status of statuses) assert.deepEqual(status.body, { operation: { id: intent.id, state: 'submitted', hash: HASH, acknowledged: false, chainId: 8453 } });
  assert.ok(f.calls.slice(before).every(call => call.method === 'GET'));
  assert.equal(f.calls.filter(call => call.url.endsWith('/rpc')).length, 1);
  assert.equal(operation(f, intent.id).acknowledged, 0);
});

test('expiry before transport exposes terminal rejection only to its owner and releases the slot without an RPC POST', async t => {
  const f = await fixture(t); const { device } = await ready(f); await f.approve(2);
  const intent = await signedIntent(f, device);
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  let expiredAfterClaim = false;
  f.db.afterWrite = () => {
    const row = f.db.sql.prepare('SELECT * FROM access_operations WHERE id=?').get(intent.id);
    if (row?.state === 'dispatching') {
      f.db.afterWrite = undefined; expiredAfterClaim = true; now = Number(row.expires_at);
    }
  };
  error(await f.asUser('sign/complete', 1, intent.fields), 403, 'approval_expired');
  assert.equal(expiredAfterClaim, true);
  assert.equal(operation(f, intent.id).state, 'rejected'); assert.equal(operation(f, intent.id).acknowledged, 1);
  assert.equal(f.calls.filter(call => call.url.endsWith('/rpc')).length, 0);
  assert.deepEqual((await f.refreshedUser('transaction/status')).body, { operation: null });
  const callsBeforeStatus = f.calls.length;
  const exact = await f.refreshedUser('transaction/status', 1, { id: intent.id });
  assert.equal(exact.status, 200);
  assert.deepEqual(exact.body, { operation: { id: intent.id, state: 'rejected', hash: null, acknowledged: true, chainId: 8453 } });
  const other = await f.refreshedUser('transaction/status', 2, { id: intent.id });
  assert.equal(other.status, 200); assert.deepEqual(other.body, { operation: null });
  assert.deepEqual((await f.refreshedUser('transaction/status', 1, { id: crypto.randomUUID() })).body, { operation: null });
  assert.equal(f.calls.length, callsBeforeStatus, 'terminal status reads never contact a provider');
  error(await f.refreshedUser('sign/complete', 1, intent.fields), 403, 'approval_expired');
  assert.equal((await f.refreshedUser('sign/options', 1, { transaction: TX })).status, 200);
  assert.equal(f.calls.filter(call => call.url.endsWith('/rpc')).length, 0);
});

test('browser cancellation persists exact non-submission evidence and blocks later completion', async t => {
  const f = await fixture(t); const { device } = await ready(f);
  const intent = await signedIntent(f, device);
  const handoff = await f.asUser('handoff/create', 1, { challengeId: intent.id });
  const token = new URLSearchParams(new URL(handoff.body.url).hash.slice(1)).get('token')!;
  assert.deepEqual((await f.send({ action: 'handoff/cancel', token })).body, { cancelled: true });
  assert.deepEqual((await f.send({ action: 'handoff/cancel', token })).body, { cancelled: true });
  const status = await f.refreshedUser('transaction/status', 1, { id: intent.id });
  assert.equal(status.body.operation.state, 'rejected');
  assert.equal(status.body.operation.acknowledged, true);
  error(await f.asUser('sign/complete', 1, intent.fields), 403, 'approval_expired');
  error(await f.send({ action: 'handoff/complete', token, response: intent.fields.response }), 403, 'approval_expired');
  assert.equal((await f.asUser('sign/options', 1, { transaction: TX })).status, 200);
  assert.equal(f.calls.filter(call => call.url.endsWith('/rpc')).length, 0);
});

test('cancel and expiry never clear a potentially broadcast handoff', async t => {
  const f = await fixture(t); const { device } = await ready(f); f.failRPC();
  const intent = await signedIntent(f, device);
  const handoff = await f.asUser('handoff/create', 1, { challengeId: intent.id });
  const token = new URLSearchParams(new URL(handoff.body.url).hash.slice(1)).get('token')!;
  error(await f.send({ action: 'handoff/complete', token, response: intent.fields.response }), 503, 'transaction_unknown');
  assert.deepEqual((await f.send({ action: 'handoff/cancel', token })).body, { cancelled: false });
  const expiry = Number(operation(f, intent.id).expires_at);
  t.mock.method(Date, 'now', () => expiry + 1);
  const status = await f.refreshedUser('transaction/status', 1, { id: intent.id });
  assert.equal(status.body.operation.state, 'unknown');
  assert.equal(status.body.operation.acknowledged, false);
  assert.equal(f.calls.filter(call => call.url.endsWith('/rpc')).length, 1);
});

test('expired and pre-dispatch rejected approvals recover after challenge cleanup', async t => {
  const f = await fixture(t); const { device } = await ready(f);
  const rejected = await signedIntent(f, device);
  error(await f.asUser('sign/complete', 1, { challengeId: rejected.id, response: {} }), 403, 'passkey_rejected');
  assert.equal((await f.refreshedUser('transaction/status', 1, { id: rejected.id })).body.operation.state, 'rejected');
  const expired = await signedIntent(f, device);
  const row = f.db.sql.prepare('SELECT expires_at FROM access_signing_intents WHERE id=?').get(expired.id)!;
  t.mock.method(Date, 'now', () => Number(row.expires_at) + 1);
  f.db.sql.prepare('DELETE FROM admission_challenges WHERE id=?').run(expired.id);
  const status = await f.refreshedUser('transaction/status', 1, { id: expired.id });
  assert.equal(status.body.operation.state, 'rejected');
  assert.equal(status.body.operation.acknowledged, true);
  assert.equal(f.calls.filter(call => call.url.endsWith('/rpc')).length, 0);
});
