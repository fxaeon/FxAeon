import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  ADMISSION_SCHEMA, DEFAULT_ADMISSION_CAPACITY, LAUNCH_DATA_MAX_AGE_SECONDS, TELEGRAM_LAUNCH_PUBLIC_KEY_HEX,
  admissionCapacity, admitTelegramUser, createTelegramAdmissionHandler, onRequest, verifyTelegramLaunchData,
  type AdmissionDatabase, type AdmissionStatement,
} from '../../../functions/api/telegram-admission';

const BOT_ID = '7123456789';
const NOW = 1_793_250_000;

/** Cloudflare D1's prepare/bind/batch contract over Node's SQLite: a real engine for the SQL. */
function d1(db = new DatabaseSync(':memory:')): AdmissionDatabase & { db: DatabaseSync; batches: number } {
  type Bound = AdmissionStatement & { query: string; values: unknown[] };
  const statement = (query: string, values: unknown[] = []): Bound => ({ query, values, bind: (...next: unknown[]) => statement(query, next) });
  const adapter = {
    db,
    batches: 0,
    prepare: (query: string) => statement(query),
    async batch(statements: AdmissionStatement[]) {
      adapter.batches += 1;
      db.exec('BEGIN');
      try {
        const results = (statements as Bound[]).map(({ query, values }) => {
          const prepared = db.prepare(query);
          if (/^\s*SELECT/i.test(query)) return { results: prepared.all(...(values as never[])) };
          prepared.run(...(values as never[]));
          return { results: [] };
        });
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return adapter;
}

/** Plain rows: node:sqlite returns null-prototype objects. */
const rows = (db: { db: DatabaseSync }, sql: string) => db.db.prepare(sql).all().map((row) => ({ ...row }));

async function signer() {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  /** Launch data signed as Telegram signs it for third parties. */
  const sign = async (fields: Record<string, string>, botId = BOT_ID) => {
    const text = `${botId}:WebAppData\n${Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join('\n')}`;
    const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(text)));
    const encoded = Buffer.from(signature).toString('base64url');
    return new URLSearchParams({ ...fields, hash: 'f'.repeat(64), signature: encoded }).toString();
  };
  return { publicKey, sign };
}

const launchFields = (userId: number, authDate = NOW) => ({
  auth_date: String(authDate),
  query_id: 'AAE-test',
  user: JSON.stringify({ id: userId, first_name: 'Ada', language_code: 'en', allows_write_to_pm: true }),
});

test('Telegram third-party launch signatures verify with only the public bot ID', async () => {
  const { publicKey, sign } = await signer();
  const launch = await sign(launchFields(42));
  assert.deepEqual(await verifyTelegramLaunchData(launch, BOT_ID, { publicKey, nowSeconds: NOW + 60 }), { ok: true, userId: 42, authDate: NOW });

  const tampered = launch.replace('%22id%22%3A42', '%22id%22%3A43');
  assert.notEqual(tampered, launch);
  assert.deepEqual(await verifyTelegramLaunchData(tampered, BOT_ID, { publicKey, nowSeconds: NOW }), { ok: false, reason: 'forged' });
  // Signed for another bot, or checked against Telegram's real key.
  assert.deepEqual(await verifyTelegramLaunchData(launch, '7000000000', { publicKey, nowSeconds: NOW }), { ok: false, reason: 'forged' });
  assert.deepEqual(await verifyTelegramLaunchData(launch, BOT_ID, { nowSeconds: NOW }), { ok: false, reason: 'forged' });
});

test('stale, future, unsigned, duplicated and identity-less launches are refused', async () => {
  const { publicKey, sign } = await signer();
  const check = (launch: string, nowSeconds = NOW) => verifyTelegramLaunchData(launch, BOT_ID, { publicKey, nowSeconds });
  assert.deepEqual(await check(await sign(launchFields(7, NOW - LAUNCH_DATA_MAX_AGE_SECONDS - 1))), { ok: false, reason: 'expired' });
  assert.equal((await check(await sign(launchFields(7, NOW - LAUNCH_DATA_MAX_AGE_SECONDS)))).ok, true);
  assert.deepEqual(await check(await sign(launchFields(7, NOW + 3_600))), { ok: false, reason: 'expired' });

  const unsigned = new URLSearchParams({ ...launchFields(7), hash: 'f'.repeat(64) }).toString();
  assert.deepEqual(await check(unsigned), { ok: false, reason: 'unsigned' });
  const signed = await sign(launchFields(7));
  assert.deepEqual(await check(`${signed}&user=${encodeURIComponent('{"id":8}')}`), { ok: false, reason: 'malformed' });
  assert.deepEqual(await check(signed.replace(/signature=[^&]+/, 'signature=short')), { ok: false, reason: 'forged' });
  assert.deepEqual(await check(await sign({ auth_date: String(NOW), user: '{"first_name":"No id"}' })), { ok: false, reason: 'malformed' });
  assert.deepEqual(await check(await sign({ auth_date: String(NOW), user: '{"id":-4}' })), { ok: false, reason: 'malformed' });
  assert.deepEqual(await check(''), { ok: false, reason: 'malformed' });
  assert.deepEqual(await check('x'.repeat(5_000)), { ok: false, reason: 'malformed' });
});

test('production verification is pinned to Telegram’s published Ed25519 key', () => {
  assert.equal(TELEGRAM_LAUNCH_PUBLIC_KEY_HEX, 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d');
});

test('the cohort fills first come, stays admitted, and later visitors can wait in line', async () => {
  const db = d1();
  const admit = (userId: number, intent: 'enter' | 'join' = 'enter', capacity = 2) => admitTelegramUser(db, userId, { capacity, intent, nowMs: 1 });
  assert.equal(await admit(1), 'admitted');
  assert.equal(await admit(2), 'admitted');
  assert.equal(await admit(1), 'admitted', 'a returning member never uses a second seat');
  assert.equal(await admit(3), 'full');
  assert.equal(await admit(3, 'join'), 'waitlisted');
  assert.equal(await admit(3), 'waitlisted');
  assert.equal(await admit(3, 'join'), 'waitlisted', 'joining twice keeps one place');
  assert.deepEqual(rows(db, 'SELECT admitted FROM telegram_admission_count'), [{ admitted: 2 }]);
  assert.deepEqual(rows(db, 'SELECT COUNT(*) AS waiting FROM telegram_waitlist'), [{ waiting: 1 }]);

  // Raising the capacity lets the next launch in; removing a member frees a seat.
  assert.equal(await admit(3, 'enter', 3), 'admitted');
  db.db.prepare('DELETE FROM telegram_admission WHERE telegram_user_id = 2').run();
  assert.deepEqual(rows(db, 'SELECT admitted FROM telegram_admission_count'), [{ admitted: 2 }]);
  assert.equal(await admit(4, 'enter', 3), 'admitted');
  assert.equal(await admit(5, 'join', 3), 'waitlisted');
  // An admitted member is never added to the waitlist.
  assert.equal(await admit(4, 'join', 3), 'admitted');
  assert.deepEqual(rows(db, 'SELECT telegram_user_id FROM telegram_waitlist ORDER BY telegram_user_id'), [{ telegram_user_id: 3 }, { telegram_user_id: 5 }]);
});

test('simultaneous launches at the last seat admit exactly one user', async () => {
  const db = d1();
  await admitTelegramUser(db, 100, { capacity: 3, intent: 'enter' });
  await admitTelegramUser(db, 101, { capacity: 3, intent: 'enter' });
  const results = await Promise.all([200, 201, 202, 203].map((userId) => admitTelegramUser(db, userId, { capacity: 3, intent: 'enter' })));
  assert.deepEqual(results.filter((status) => status === 'admitted').length, 1);
  assert.deepEqual(rows(db, 'SELECT COUNT(*) AS members FROM telegram_admission'), [{ members: 3 }]);
});

test('the schema is idempotent and set up once per database', async () => {
  const db = d1();
  for (const statement of ADMISSION_SCHEMA) db.db.prepare(statement).run();
  for (const statement of ADMISSION_SCHEMA) db.db.prepare(statement).run();
  await admitTelegramUser(db, 1, { capacity: 1, intent: 'enter' });
  await admitTelegramUser(db, 2, { capacity: 1, intent: 'enter' });
  assert.equal(db.batches, 3, 'one schema batch, then one batch per decision');
});

test('capacity defaults below Privy’s free tier and rejects malformed configuration', () => {
  assert.equal(DEFAULT_ADMISSION_CAPACITY, 480);
  assert.equal(admissionCapacity(undefined), 480);
  assert.equal(admissionCapacity(''), 480);
  assert.equal(admissionCapacity(' 250 '), 250);
  assert.equal(admissionCapacity('0'), 0);
  for (const invalid of ['-1', '1.5', 'ten', '99999999', 12]) assert.equal(admissionCapacity(invalid), null);
});

function post(body: unknown, init: { origin?: string; type?: string; search?: string } = {}) {
  return new Request(`https://fxaeon.com/api/telegram-admission${init.search ?? ''}`, {
    method: 'POST',
    headers: { 'content-type': init.type ?? 'application/json', origin: init.origin ?? 'https://fxaeon.com' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = () => undefined;
  try { return await run(); } finally { console.warn = warn; }
}

test('the route admits a verified launch and fills the waitlist after capacity', async () => {
  const { publicKey, sign } = await signer();
  const handler = createTelegramAdmissionHandler({ publicKey });
  const env = { ADMISSION_DB: d1(), TELEGRAM_BOT_ID: BOT_ID, TELEGRAM_ADMISSION_CAPACITY: '1' };
  const now = Math.floor(Date.now() / 1000);
  const first = await handler({ request: post({ launchData: await sign(launchFields(11, now)) }), env });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await first.json(), { status: 'admitted' });

  const second = await sign(launchFields(12, now));
  assert.deepEqual(await (await handler({ request: post({ launchData: second }), env })).json(), { status: 'full' });
  assert.deepEqual(await (await handler({ request: post({ launchData: second, intent: 'join' }), env })).json(), { status: 'waitlisted' });

  const forged = await quietly(async () => handler({ request: post({ launchData: second.replace('%22id%22%3A12', '%22id%22%3A11') }), env }));
  assert.equal(forged.status, 403);
  assert.deepEqual(await forged.json(), { error: 'launch_rejected' });
  const stale = await quietly(async () => handler({ request: post({ launchData: await sign(launchFields(13, now - LAUNCH_DATA_MAX_AGE_SECONDS - 60)) }), env }));
  assert.deepEqual(await stale.json(), { error: 'launch_expired' });
});

test('the route refuses foreign origins, malformed bodies and missing configuration', async () => {
  const { publicKey, sign } = await signer();
  const handler = createTelegramAdmissionHandler({ publicKey });
  const env = { ADMISSION_DB: d1(), TELEGRAM_BOT_ID: BOT_ID };
  const launchData = await sign(launchFields(21, Math.floor(Date.now() / 1000)));
  assert.equal((await handler({ request: post({ launchData }, { origin: 'https://evil.example' }), env })).status, 403);
  for (const request of [
    post('{not json'), post([launchData]), post({ launchData: 5 }), post({ launchData, intent: 'admin' }),
    post({ launchData }, { type: 'text/plain' }), post({ launchData }, { search: '?capacity=9' }),
    post({ launchData: 'x'.repeat(9_000) }),
  ]) assert.equal((await handler({ request, env })).status, 400);

  await quietly(async () => {
    for (const broken of [{}, { ADMISSION_DB: env.ADMISSION_DB }, { TELEGRAM_BOT_ID: BOT_ID },
      { ...env, TELEGRAM_BOT_ID: 'bot' }, { ...env, TELEGRAM_ADMISSION_CAPACITY: 'many' }]) {
      const response = await handler({ request: post({ launchData }), env: broken });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'admission_unavailable' });
    }
    const failing = { ...env, ADMISSION_DB: { prepare: () => ({ bind() { return this; } }), batch: async () => { throw new Error('D1 down'); } } };
    const response = await handler({ request: post({ launchData }), env: failing });
    assert.equal(response.status, 503);
  });
});

test('only POST reaches the admission route', async () => {
  const response = await onRequest({ request: new Request('https://fxaeon.com/api/telegram-admission'), env: {} });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});
