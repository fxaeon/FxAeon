import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { Store, CHALLENGE_TTL_MS, type Credential, type DB, type DBStatement, type DBResult } from './store.ts';

/** Real SQLite execution, including D1's all-or-nothing batch contract. */
class SQLiteDB implements DB {
  readonly sqlite: DatabaseSync;
  failAt: number | null = null;
  constructor(path = ':memory:') {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }
  prepare(sql: string): SQLiteStatement { return new SQLiteStatement(this, sql, []); }
  async batch<T = Record<string, unknown>>(statements: DBStatement[]): Promise<DBResult<T>[]> {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement, index) => {
        if (index === this.failAt) throw new Error('injected storage failure');
        return (statement as SQLiteStatement).execute<T>();
      });
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    } finally { this.failAt = null; }
  }
}
class SQLiteStatement implements DBStatement {
  constructor(readonly db: SQLiteDB, readonly sql: string, readonly values: unknown[]) {}
  bind(...values: unknown[]): SQLiteStatement { return new SQLiteStatement(this.db, this.sql, values); }
  execute<T>(): DBResult<T> {
    const statement = this.db.sqlite.prepare(this.sql);
    if (statement.columns().length) {
      return { success: true, results: statement.all(...this.values as SQLInputValue[]).map(row => ({ ...row })) as T[] };
    }
    const result = statement.run(...this.values as SQLInputValue[]);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async all<T = Record<string, unknown>>(): Promise<DBResult<T>> { return this.execute<T>(); }
  async run<T = Record<string, unknown>>(): Promise<DBResult<T>> { return this.execute<T>(); }
}
const credential = (id = 'Y3JlZGVudGlhbA'): Credential => ({
  credentialID: id, publicKey: 'pQECAyYgASFYIA', counter: 0, ownerSPKI: 'cHVibGljLWtleQ==', backedUp: true,
});
const wallet = { id: 'wallet-1', address: `0x${'ab'.repeat(20)}`, verified: true } as const;
async function fixture(t: TestContext, legacy = 0) {
  const db = new SQLiteDB();
  t.after(() => db.sqlite.close());
  const store = new Store(db);
  await store.init(legacy);
  return { db, store };
}
async function reserve(store: Store, userId = 1, notify = false) {
  await store.join(userId, notify);
  await store.approve([userId]);
}

test('join is required, waiting is explicit, and wallet fields alone transition approved to ready', async t => {
  const { store } = await fixture(t);
  assert.equal(await store.status(1), null);
  await assert.rejects(store.approve([1]), /join/);
  assert.equal((await store.join(1, false)).state, 'waiting');
  assert.equal(await store.bindCredential(1, credential()), false);
  assert.equal(await store.saveWallet(1, wallet), false);
  const [approved] = await store.approve([1]);
  assert.equal(approved.state, 'approved');
  assert.match(approved.externalId!, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(await store.bindCredential(1, credential()), true);
  assert.equal((await store.status(1))!.state, 'approved');
  await assert.rejects(store.saveWallet(1, { ...wallet, verified: false } as never), /verified wallet/);
  assert.equal(await store.saveWallet(1, wallet), true);
  const ready = await store.status(1);
  assert.equal(ready!.state, 'ready');
  assert.equal(ready!.walletAddress, wallet.address);
  assert.equal(await store.saveWallet(1, { ...wallet, id: 'replacement' }), false);
  assert.deepEqual(await store.status(1), ready);
});

test('retry approval, duplicate input and store reconstruction retain one permanent seat and external ID', async t => {
  const { db, store } = await fixture(t, 479);
  await store.join(1, true);
  const initial = await store.approve([1, 1]);
  assert.equal(initial.length, 1);
  const restarted = new Store(db);
  await restarted.init(0);
  assert.deepEqual(await restarted.approve([1]), initial);
  assert.deepEqual(await restarted.pendingInvitations(), [{ userId: 1, channel: 'telegram', destination: '1' }]);
  await restarted.join(2, false);
  await assert.rejects(restarted.approve([2]), /seat limit/);
  assert.equal((await restarted.status(2))!.state, 'waiting');
});

test('preexisting legacy reservations cannot be reduced or raised beyond the remaining cap', async t => {
  const { db, store } = await fixture(t, 478);
  await reserve(store);
  await store.init(479);
  await store.init(0);
  assert.equal(db.sqlite.prepare('SELECT legacy_slots FROM admission_settings').get()!.legacy_slots, 479);
  await assert.rejects(store.init(480), /seat limit/);
  assert.throws(() => db.sqlite.exec('UPDATE admission_settings SET legacy_slots = 0'), /baseline/);
  assert.throws(() => db.sqlite.exec('DELETE FROM admission_settings'), /permanent/);
  assert.throws(() => db.sqlite.exec('INSERT OR REPLACE INTO admission_settings VALUES (1,0)'), /permanent/);
  await store.join(2, false);
  await assert.rejects(store.approve([2]), /seat limit/);
});

test('last seat multi-approval rolls back every reservation and invitation', async t => {
  const { store } = await fixture(t, 479);
  await store.join(1, true);
  await store.join(2, true);
  await assert.rejects(store.approveMany([1, 2]), /seat limit/);
  assert.deepEqual((await store.enrollments()).map(row => row.state), ['waiting', 'waiting']);
  assert.deepEqual(await store.pendingInvitations(), []);
  await store.approve([2]);
  assert.equal((await store.status(2))!.state, 'approved');
});

test('overlapping final-seat approvals resolve exactly one winner', async t => {
  const { db, store } = await fixture(t, 479);
  const other = new Store(db);
  await store.join(1, true);
  await store.join(2, true);
  const results = await Promise.allSettled([store.approve([1]), other.approve([2])]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await store.enrollments()).filter(row => row.state === 'approved').length, 1);
  assert.equal((await store.pendingInvitations()).length, 1);
});

test('independent SQLite connections racing in worker threads cannot both reserve the final seat', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'admission-race-'));
  const path = join(dir, 'admission.sqlite');
  const db = new SQLiteDB(path);
  t.after(() => { db.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });
  const store = new Store(db);
  await store.init(479);
  await store.join(1, false);
  await store.join(2, false);
  const gate = new SharedArrayBuffer(4);
  const workers = [1, 2].map(userId => new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const { randomUUID } = require('node:crypto');
    const db = new DatabaseSync(workerData.path);
    db.exec('PRAGMA busy_timeout = 5000');
    parentPort.postMessage('ready');
    Atomics.wait(new Int32Array(workerData.gate), 0, 0);
    try {
      db.prepare('UPDATE admission_users SET external_id = ? WHERE user_id = ? AND external_id IS NULL')
        .run(randomUUID(), workerData.userId);
      parentPort.postMessage('reserved');
    } catch (e) { parentPort.postMessage(e.message); }
    finally { db.close(); }
  `, { eval: true, workerData: { path, userId, gate } }));
  t.after(async () => { await Promise.all(workers.map(worker => worker.terminate())); });
  const results = workers.map(worker => new Promise<string>((resolve, reject) => {
    worker.on('message', value => { if (value !== 'ready') resolve(value); });
    worker.on('error', reject);
  }));
  await Promise.all(workers.map(worker => new Promise<void>(resolve => worker.once('message', () => resolve()))));
  Atomics.store(new Int32Array(gate), 0, 1);
  Atomics.notify(new Int32Array(gate), 0);
  const outcomes = await Promise.all(results);
  assert.equal(outcomes.filter(value => value === 'reserved').length, 1);
  assert.equal(outcomes.filter(value => value.includes('seat limit')).length, 1);
  assert.equal((await store.enrollments()).filter(row => row.externalId !== null).length, 1);
});

test('storage failure after reserving a seat rolls back and retry safely succeeds', async t => {
  const { db, store } = await fixture(t, 479);
  await store.join(1, true);
  db.failAt = 2; // The reservation AND invitation have already executed inside the transaction.
  await assert.rejects(store.approve([1]), /injected storage failure/);
  assert.equal((await store.status(1))!.externalId, null);
  assert.deepEqual(await store.pendingInvitations(), []);
  assert.equal((await store.approve([1]))[0].state, 'approved');
  assert.equal((await store.pendingInvitations()).length, 1);
});

test('D1 failure results are surfaced instead of being treated as successful writes', async () => {
  const badStatement: DBStatement = {
    bind() { return this; },
    async all() { return { success: false, results: [], error: 'disk full' }; },
    async run() { return { success: false, results: [], error: 'disk full' }; },
  };
  const store = new Store({ prepare: () => badStatement, batch: async stmts => stmts.map(() => ({ success: false, results: [], error: 'disk full' })) });
  await assert.rejects(store.init(), /disk full/);
  await assert.rejects(store.status(1), /disk full/);
  await assert.rejects(store.bindCredential(1, credential()), /disk full/);
});

test('database guards prohibit recycling, changing identity and direct credential replacement', async t => {
  const { db, store } = await fixture(t);
  await reserve(store);
  await store.bindCredential(1, credential());
  for (const sql of [
    'DELETE FROM admission_users WHERE user_id = 1',
    'UPDATE admission_users SET external_id = NULL WHERE user_id = 1',
    'UPDATE admission_users SET user_id = 2 WHERE user_id = 1',
    "UPDATE admission_users SET public_key = 'different' WHERE user_id = 1",
    "INSERT OR REPLACE INTO admission_users(user_id,joined_at,telegram_notify) VALUES(1,0,0)",
  ]) assert.throws(() => db.sqlite.exec(sql), /permanent|immutable|identity/);
});

test('credential first-binding CAS refuses replacement, including concurrent callers', async t => {
  const { db, store } = await fixture(t);
  await reserve(store);
  const other = new Store(db);
  const results = await Promise.all([store.bindCredential(1, credential('Zmlyc3Q')), other.bindCredential(1, credential('c2Vjb25k'))]);
  assert.deepEqual(results.sort(), [false, true]);
  const saved = (await store.status(1))!.credential;
  assert.equal(await store.bindCredential(1, credential('dGhpcmQ')), false);
  assert.deepEqual((await store.status(1))!.credential, saved);
  assert.deepEqual((await new Store(db).status(1))!.credential, saved);
  await reserve(store, 2);
  await assert.rejects(store.bindCredential(2, saved!), /immutable|UNIQUE/);
});

test('SQLite REPLACE cannot evict a different user via unique external ID or credential collisions', async t => {
  const { db, store } = await fixture(t);
  await reserve(store);
  await store.bindCredential(1, credential());
  await store.join(2, false);
  const original = await store.status(1);
  assert.throws(() => db.sqlite.prepare(`INSERT OR REPLACE INTO admission_users
    (user_id,joined_at,telegram_notify,external_id) VALUES (3,0,0,?)`).run(original!.externalId), /identity/);
  assert.throws(() => db.sqlite.prepare(`UPDATE OR REPLACE admission_users SET external_id = ?
    WHERE user_id = 2`).run(original!.externalId), /immutable/);
  await store.approve([2]);
  assert.throws(() => db.sqlite.prepare(`UPDATE OR REPLACE admission_users
    SET credential_id = ?, public_key = ?, counter = 0, owner_spki = ?, backed_up = 1
    WHERE user_id = 2`).run(credential().credentialID, credential().publicKey, credential().ownerSPKI), /immutable/);
  assert.deepEqual(await store.status(1), original);
  assert.equal((await store.enrollments()).length, 2);
});

test('already-approved users in a multi-approval do not consume additional seats', async t => {
  const { store } = await fixture(t, 478);
  await reserve(store, 1, true);
  const initialId = (await store.status(1))!.externalId;
  await store.join(2, true);
  const rows = await store.approve([1, 2, 1]);
  assert.equal(rows[0].externalId, initialId);
  assert.deepEqual(rows.map(row => row.state), ['approved', 'approved']);
  assert.notEqual(rows[0].externalId, rows[1].externalId);
  assert.equal((await store.pendingInvitations()).length, 2);
});

test('authenticator counters use CAS, refuse rollback and allow zero-counter authenticators', async t => {
  const { store } = await fixture(t);
  await reserve(store);
  await store.bindCredential(1, credential());
  assert.equal(await store.updateCounter(1, credential().credentialID, 0, 0), true);
  assert.equal(await store.updateCounter(1, credential().credentialID, 0, 4), true);
  assert.equal(await store.updateCounter(1, credential().credentialID, 0, 5), false);
  assert.equal(await store.updateCounter(1, 'wrong', 4, 5), false);
  await assert.rejects(store.updateCounter(1, credential().credentialID, 4, 4), /counter/);
  await assert.rejects(store.updateCounter(1, credential().credentialID, 4, 3), /counter/);
});

test('challenges bind user, action and JSON payload; cross-user/action attempts do not consume them', async t => {
  const { store } = await fixture(t);
  await reserve(store);
  await reserve(store, 2);
  const payload = { chainId: 8453, transaction: { to: 'receiver', value: '1' } };
  const issued = await store.issueChallenge(1, 'register', payload, 1000);
  assert.match(issued.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await store.consumeChallenge(2, issued.id, 'register', 1001), null);
  assert.equal(await store.consumeChallenge(1, issued.id, 'sign', 1001), null);
  const claimed = await store.consumeChallenge(1, issued.id, 'register', 1001);
  assert.deepEqual(claimed, issued);
  assert.deepEqual(claimed!.payload, payload);
  assert.equal(await store.consumeChallenge(1, issued.id, 'register', 1002), null);
});

test('expired challenges fail at the exact boundary and competing claims have one winner', async t => {
  const { db, store } = await fixture(t);
  await reserve(store);
  const expired = await store.issueChallenge(1, 'register', {}, 0);
  assert.equal(await store.consumeChallenge(1, expired.id, 'register', CHALLENGE_TTL_MS), null);
  const fresh = await store.issueChallenge(1, 'register', {}, CHALLENGE_TTL_MS);
  const claims = await Promise.all([
    store.consumeChallenge(1, fresh.id, 'register', CHALLENGE_TTL_MS + 1),
    new Store(db).consumeChallenge(1, fresh.id, 'register', CHALLENGE_TTL_MS + 1),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
});

test('new signing challenge invalidates the old payload and consumption permanently prevents replay', async t => {
  const { store } = await fixture(t);
  await reserve(store);
  await assert.rejects(store.issueChallenge(1, 'sign', {}, 0), /not allowed/);
  await store.bindCredential(1, credential());
  await assert.rejects(store.issueChallenge(1, 'register', {}, 0), /not allowed/);
  await store.saveWallet(1, wallet);
  const first = await store.issueChallenge(1, 'sign', { value: '1' }, 1);
  const latest = await store.issueChallenge(1, 'sign', { value: '2' }, 2);
  assert.equal(await store.consumeChallenge(1, first.id, 'sign', 3), null);
  assert.deepEqual((await store.consumeChallenge(1, latest.id, 'sign', 3))!.payload, { value: '2' });
  assert.equal(await store.consumeChallenge(1, latest.id, 'sign', 4), null);
});

test('rate limiting persists across claims and restarts, bounds storage, and resets only after its window', async t => {
  const { db, store } = await fixture(t);
  await reserve(store);
  for (let i = 0; i < 5; i++) {
    const issued = await store.issueChallenge(1, 'register', {}, 100 + i);
    await store.consumeChallenge(1, issued.id, 'register', 100 + i);
  }
  await assert.rejects(new Store(db).issueChallenge(1, 'register', {}, 105), /rate limited/);
  await assert.rejects(store.issueChallenge(1, 'register', {}, 99), /rate limited/);
  await assert.rejects(store.issueChallenge(1, 'register', {}, 60_099), /rate limited/);
  await store.issueChallenge(1, 'register', {}, 60_100);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM admission_challenge_rates').get()!.n, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM admission_challenges').get()!.n, 1);
  await assert.rejects(store.issueChallenge(999, 'register', {}, 60_100), /not allowed/);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM admission_challenge_rates').get()!.n, 1);
  await assert.rejects(store.issueChallenge(1, 'register', 'x'.repeat(65_536), 60_101), /payload/);
});

test('challenge issuance storage failure rolls back throttling and preserves the earlier challenge', async t => {
  const { db, store } = await fixture(t);
  await reserve(store);
  const issued = await store.issueChallenge(1, 'register', { first: true }, 100);
  db.failAt = 2;
  await assert.rejects(store.issueChallenge(1, 'register', {}, 101), /storage failure/);
  assert.deepEqual(await store.consumeChallenge(1, issued.id, 'register', 102), issued);
  assert.equal(db.sqlite.prepare('SELECT used FROM admission_challenge_rates').get()!.used, 1);
});

test('outbox requires opt-in, is unique, cannot target another destination and respects withdrawn consent', async t => {
  const { db, store } = await fixture(t);
  await reserve(store, 1, false);
  await store.join(2, true);
  assert.deepEqual(await store.pendingInvitations(), []);
  assert.throws(() => db.sqlite.exec("INSERT INTO admission_invitations VALUES(1,'telegram','1',0)"), /unauthorized/);
  assert.throws(() => db.sqlite.exec("INSERT INTO admission_invitations VALUES(2,'telegram','2',0)"), /unauthorized/);
  await store.join(1, true);
  await store.approve([1]);
  assert.equal((await store.pendingInvitations()).length, 1);
  assert.throws(() => db.sqlite.exec("UPDATE admission_invitations SET destination = '999'"), /immutable/);
  await store.join(1, false);
  assert.deepEqual(await store.pendingInvitations(), []);
  await store.join(1, true);
  await store.markInvitationDelivered(1);
  await store.approve([1]);
  assert.deepEqual(await store.pendingInvitations(), []);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM admission_invitations').get()!.n, 1);
});

test('Telegram identities must be positive safe integers without coercion', async t => {
  const { store } = await fixture(t);
  for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '123'] as number[]) {
    await assert.rejects(store.join(invalid, false), /Telegram user id/);
    await assert.rejects(store.status(invalid), /Telegram user id/);
    await assert.rejects(store.approve([invalid]), /Telegram user id/);
    await assert.rejects(store.consumeChallenge(invalid, 'id', 'register', 0), /Telegram user id/);
  }
  assert.equal((await store.join(Number.MAX_SAFE_INTEGER, true)).userId, Number.MAX_SAFE_INTEGER);
});

test('capacity includes the permanent legacy baseline and reserved seats, not waiting users', async t => {
  const { store } = await fixture(t, 478);
  assert.deepEqual(await store.capacity(), { used: 478, legacy: 478, max: 480 });
  await store.join(1, false);
  await store.join(2, false);
  assert.equal((await store.capacity()).used, 478);
  await store.approve([1]);
  assert.equal((await store.capacity()).used, 479);
  await store.approve([1, 2]);
  assert.deepEqual(await store.capacity(), { used: 480, legacy: 478, max: 480 });
});

test('enrollments are ordered by immutable first join time', async t => {
  const { db, store } = await fixture(t);
  let now = 100;
  t.mock.method(Date, 'now', () => now);
  await store.join(2, false);
  now = 200;
  await store.join(1, false);
  now = 300;
  assert.equal((await store.join(2, true)).joinedAt, 100);
  assert.deepEqual((await store.enrollments()).map(row => [row.userId, row.joinedAt]), [[2, 100], [1, 200]]);
  assert.throws(() => db.sqlite.exec('UPDATE admission_users SET joined_at = 50 WHERE user_id = 1'), /immutable/);
});

test('exact server challenges and large signing payloads survive storage without modification', async t => {
  const { store } = await fixture(t);
  await reserve(store);
  const optionsChallenge = 'YWJjZGVmZ2hpamts';
  const registration = await store.issueChallenge(1, 'register', { options: true }, 0, optionsChallenge);
  assert.equal(registration.challenge, optionsChallenge);
  assert.deepEqual(await store.readChallenge(1, registration.id, 1), registration);
  assert.equal(await store.readChallenge(2, registration.id, 1), null);
  assert.equal(await store.readChallenge(1, registration.id, CHALLENGE_TTL_MS), null);
  await store.consumeChallenge(1, registration.id, 'register', 1);
  assert.equal(await store.readChallenge(1, registration.id, 1), null);
  await store.bindCredential(1, credential());
  await store.saveWallet(1, wallet);
  const envelopeChallenge = 'A'.repeat(40_000);
  const payload = { envelope: 'x'.repeat(60_000) };
  const signing = await store.issueChallenge(1, 'sign', payload, 2, envelopeChallenge);
  assert.equal(signing.challenge, envelopeChallenge);
  assert.deepEqual((await store.consumeChallenge(1, signing.id, 'sign', 3))!.payload, payload);
  for (const invalid of ['', 'abc=', 'abc+', 'A'.repeat(40_001)]) {
    await assert.rejects(store.issueChallenge(1, 'sign', {}, 4, invalid), /challenge value/);
  }
});

test('handoffs persist only a SHA256 token hash and bind the user and exact challenge', async t => {
  const { db, store } = await fixture(t);
  await reserve(store);
  const issued = await store.issueChallenge(1, 'register', { options: { rp: 'example.test' } }, 100);
  await assert.rejects(store.issueHandoff(2, issued.id, 101), /not allowed/);
  const token = await store.issueHandoff(1, issued.id, 101);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const stored = db.sqlite.prepare('SELECT * FROM admission_handoffs').get()!;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  const hash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  assert.equal(stored.token_hash, hash);
  assert.equal(JSON.stringify(stored).includes(token), false);
  assert.equal(stored.expires_at, issued.expiresAt);
  assert.deepEqual(await store.readHandoff(token, 102), { userId: 1, challenge: issued });
  assert.deepEqual(await new Store(db).readHandoff(token, 102), { userId: 1, challenge: issued });
  assert.deepEqual(await store.pollHandoff(1, issued.id, 102), { status: 'pending', result: null });
  assert.equal(await store.pollHandoff(2, issued.id, 102), null);
  assert.equal(await store.readHandoff('bad', 102), null);
  assert.equal(await store.readHandoff('A'.repeat(43), 102), null);
  assert.equal(await store.finishHandoff(token, { status: 'done', result: {} }, 102), false);
});

test('one handoff claimant wins and the immutable completion can only be polled by its Telegram user', async t => {
  const { db, store } = await fixture(t);
  await reserve(store);
  const issued = await store.issueChallenge(1, 'register', { options: true }, 0);
  const token = await store.issueHandoff(1, issued.id, 1);
  const claims = await Promise.all([store.claimHandoff(token, 2), new Store(db).claimHandoff(token, 2)]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.deepEqual(claims.find(Boolean), { userId: 1, challenge: issued });
  assert.equal(await store.readHandoff(token, 3), null);
  await assert.rejects(store.issueHandoff(1, issued.id, 3), /not allowed/);
  assert.deepEqual(await store.consumeChallenge(1, issued.id, 'register', 3), issued);
  const result = { status: 'done', result: { walletId: 'verified-wallet' } } as const;
  assert.equal(await store.finishHandoff(token, result, 4), true);
  assert.equal(await store.finishHandoff(token, { status: 'error', result: { code: 'late' } }, 5), false);
  assert.equal(await store.claimHandoff(token, 5), null);
  assert.deepEqual(await new Store(db).pollHandoff(1, issued.id, 5), result);
  assert.equal(await store.pollHandoff(2, issued.id, 5), null);
});

test('handoff token rotation invalidates the old link and stale or expired challenges cannot be claimed', async t => {
  const { store } = await fixture(t);
  await reserve(store);
  const issued = await store.issueChallenge(1, 'register', {}, 0);
  const oldToken = await store.issueHandoff(1, issued.id, 1);
  const token = await store.issueHandoff(1, issued.id, 2);
  assert.notEqual(token, oldToken);
  assert.equal(await store.readHandoff(oldToken, 3), null);
  assert.equal(await store.claimHandoff(oldToken, 3), null);
  assert.equal(await store.readHandoff(token, CHALLENGE_TTL_MS), null);
  assert.equal(await store.claimHandoff(token, CHALLENGE_TTL_MS), null);
  assert.equal(await store.pollHandoff(1, issued.id, CHALLENGE_TTL_MS), null);
  await assert.rejects(store.issueHandoff(1, issued.id, CHALLENGE_TTL_MS), /not allowed/);
  const fresh = await store.issueChallenge(1, 'register', {}, CHALLENGE_TTL_MS);
  const freshToken = await store.issueHandoff(1, fresh.id, CHALLENGE_TTL_MS);
  await store.issueChallenge(1, 'register', { newer: true }, CHALLENGE_TTL_MS + 1);
  assert.equal(await store.readHandoff(freshToken, CHALLENGE_TTL_MS + 2), null);
  assert.equal(await store.claimHandoff(freshToken, CHALLENGE_TTL_MS + 2), null);
});

test('handoff errors are durable and expired claims cannot publish a late result', async t => {
  const { store } = await fixture(t);
  await reserve(store);
  const issued = await store.issueChallenge(1, 'register', {}, 0);
  const token = await store.issueHandoff(1, issued.id, 1);
  await store.claimHandoff(token, 2);
  assert.equal(await store.finishHandoff(token, { status: 'error', result: { code: 'verification_failed' } }, 3), true);
  assert.deepEqual(await store.pollHandoff(1, issued.id, 4), { status: 'error', result: { code: 'verification_failed' } });
  const fresh = await store.issueChallenge(1, 'register', {}, 10);
  const freshToken = await store.issueHandoff(1, fresh.id, 11);
  await store.claimHandoff(freshToken, 12);
  assert.equal(await store.finishHandoff(freshToken, { status: 'done', result: {} }, fresh.expiresAt), false);
  assert.equal(await store.pollHandoff(1, fresh.id, fresh.expiresAt), null);
});
