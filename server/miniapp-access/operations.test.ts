import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { before, after, mock, test, type TestContext } from 'node:test';
import { AccessError } from './http.ts';
import { Operations } from './operations.ts';
import { PrivyWalletApi, type TransactionContext } from './privy.ts';
import type { DB, DBStatement, DBResult } from './store.ts';

before(() => mock.method(globalThis, 'fetch', async () => { throw new Error('NETWORK FORBIDDEN IN JOURNAL TESTS'); }));
after(() => mock.restoreAll());
const HASH = `0x${'12'.repeat(32)}`;
const OTHER_HASH = `0x${'34'.repeat(32)}`;
const NOW = 1_800_000_000_000;
const context = (): TransactionContext => ({ walletId: 'wallet-1', referenceId: crypto.randomUUID(),
  caip2: 'eip155:8453', expiresAt: NOW + 300000 });
const errorCode = (code: string) => (error: unknown) => error instanceof AccessError && error.code === code;

/** Execute real SQL constraints/CAS and D1's transactional batch contract; no provider or disk. */
class MemoryDB implements DB {
  readonly sqlite = new DatabaseSync(':memory:');
  failNext = false;
  prepare(sql: string): DBStatement {
    const statement = (args: unknown[]): DBStatement => {
      const execute = async <T>(): Promise<DBResult<T>> => {
        if (this.failNext) { this.failNext = false; return { success: false, results: [], error: 'injected failure' }; }
        const query = this.sqlite.prepare(sql);
        if (query.columns().length) return { success: true, results: query.all(...args as SQLInputValue[]) as T[] };
        const result = query.run(...args as SQLInputValue[]);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      };
      return { bind: (...values) => statement(values), all: execute, run: execute };
    };
    return statement([]);
  }
  async batch<T>(statements: DBStatement[]): Promise<DBResult<T>[]> {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results: DBResult<T>[] = [];
      for (const statement of statements) {
        const result = await statement.run<T>();
        if (!result.success) throw new Error('batch failure');
        results.push(result);
      }
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
async function fixture(t: TestContext) {
  t.mock.method(Date, 'now', () => NOW);
  const db = new MemoryDB();
  t.after(() => db.sqlite.close());
  const operations = new Operations(db);
  await operations.init();
  return { db, operations };
}

test('claim durably records immutable lookup context before dispatch and survives reconstruction', async t => {
  const { db, operations } = await fixture(t);
  const original = context();
  const expected = structuredClone(original);
  await operations.claim(1, 'operation-1', original);
  original.referenceId = crypto.randomUUID();
  original.walletId = 'swapped-wallet';
  const restarted = new Operations(db);
  await restarted.init();
  const stored = { id: 'operation-1', state: 'dispatching', hash: null, context: expected, acknowledged: false };
  assert.deepEqual(await restarted.result(1, 'operation-1'), stored);
  assert.deepEqual(await restarted.pending(1), stored);
  assert.equal(await restarted.result(2, 'operation-1'), null);
  assert.equal(await restarted.pending(2), null);
});

test('dispatching, unknown and unacknowledged submitted rows all block another intent after reload', async t => {
  const { db, operations } = await fixture(t);
  await operations.claim(1, 'operation-1', context());
  for (const state of ['dispatching', 'unknown', 'submitted']) {
    if (state === 'unknown') await operations.unknown('operation-1');
    if (state === 'submitted') assert.equal(await operations.recoverUnknown(1, 'operation-1', HASH), true);
    const restarted = new Operations(db);
    await assert.rejects(restarted.claim(1, 'operation-2', context()), errorCode('transaction_unresolved'));
    assert.equal((await restarted.pending(1))?.state, state);
  }
  // Other users' independent transactions remain possible.
  await operations.claim(2, 'operation-2', context());
});

test('concurrent claims have exactly one winner and preserve that winner context', async t => {
  const { db, operations } = await fixture(t);
  const contexts = Array.from({ length: 12 }, context);
  const results = await Promise.allSettled(contexts.map((ctx, i) =>
    new Operations(db).claim(1, `operation-${i}`, ctx)));
  const winner = results.findIndex(result => result.status === 'fulfilled');
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of results) if (result.status === 'rejected') assert.ok(errorCode('transaction_unresolved')(result.reason));
  assert.equal((await operations.pending(1))?.id, `operation-${winner}`);
  assert.deepEqual((await operations.pending(1))?.context, contexts[winner]);
});

test('lost success response is redelivered until exact submitted id/hash acknowledgment', async t => {
  const { db, operations } = await fixture(t);
  await operations.claim(1, 'operation-1', context());
  await operations.complete('operation-1', HASH);
  const restarted = new Operations(db);
  assert.equal((await restarted.pending(1))?.hash, HASH);
  for (const [user, id, hash] of [[2, 'operation-1', HASH], [1, 'other', HASH], [1, 'operation-1', OTHER_HASH]] as const) {
    assert.equal(await restarted.acknowledge(user, id, hash), false);
    assert.equal((await restarted.pending(1))?.hash, HASH);
  }
  assert.equal(await restarted.acknowledge(1, 'operation-1', HASH), true);
  assert.equal(await restarted.pending(1), null);
  assert.equal(await restarted.acknowledge(1, 'operation-1', HASH), true, 'lost ACK response may safely retry the same ACK');
  assert.equal((await restarted.result(1, 'operation-1'))?.acknowledged, true);
  await restarted.claim(1, 'operation-2', context());
  assert.equal((await restarted.pending(1))?.id, 'operation-2');
  await restarted.acknowledge(1, 'operation-1', HASH);
  assert.equal((await restarted.pending(1))?.id, 'operation-2', 'late old ACK never clears the new intent');
});

test('neither an operation ID nor its reference can be recycled after acknowledgment', async t => {
  const { operations } = await fixture(t);
  const original = context();
  await operations.claim(1, 'operation-1', original);
  await operations.complete('operation-1', HASH);
  await operations.acknowledge(1, 'operation-1', HASH);
  await assert.rejects(operations.claim(1, 'operation-1', context()), errorCode('transaction_unresolved'));
  await assert.rejects(operations.claim(1, 'operation-2', original), errorCode('transaction_unresolved'));
  await assert.rejects(operations.claim(2, 'operation-2', original), errorCode('transaction_unresolved'));
  assert.equal(await operations.pending(1), null);
  assert.equal((await operations.result(1, 'operation-1'))?.hash, HASH);
});

test('unknown cannot be acknowledged and expiry never clears a slot', async t => {
  const { operations } = await fixture(t);
  await operations.claim(1, 'operation-1', context());
  assert.equal(await operations.acknowledge(1, 'operation-1', HASH), false);
  await operations.unknown('operation-1');
  assert.equal(await operations.acknowledge(1, 'operation-1', HASH), false);
  t.mock.method(Date, 'now', () => NOW + 10_000_000);
  assert.equal((await operations.pending(1))?.state, 'unknown');
  await assert.rejects(operations.claim(1, 'operation-2', { ...context(), expiresAt: Date.now() + 300000 }), errorCode('transaction_unresolved'));
});

for (const state of ['dispatching', 'unknown']) {
  test(`positive recovery from ${state} uses CAS and cannot overwrite the winning hash`, async t => {
    const { db, operations } = await fixture(t);
    await operations.claim(1, 'operation-1', context());
    if (state === 'unknown') await operations.unknown('operation-1');
    assert.equal(await operations.recoverUnknown(2, 'operation-1', HASH), false);
    assert.equal(await operations.recoverUnknown(1, 'missing', HASH), false);
    const results = await Promise.all([
      operations.recoverUnknown(1, 'operation-1', HASH),
      new Operations(db).recoverUnknown(1, 'operation-1', OTHER_HASH),
    ]);
    assert.deepEqual(results, [true, false]);
    assert.equal((await operations.pending(1))?.hash, HASH);
    assert.equal((await operations.pending(1))?.state, 'submitted');
    assert.equal(await operations.recoverUnknown(1, 'operation-1', HASH), false);
    await operations.unknown('operation-1');
    assert.equal((await operations.pending(1))?.state, 'submitted', 'late error must not downgrade proof');
  });
}

test('POST completion racing positive recovery is idempotent only for the exact same hash', async t => {
  const { operations } = await fixture(t);
  await operations.claim(1, 'operation-1', context());
  await operations.recoverUnknown(1, 'operation-1', HASH);
  await operations.complete('operation-1', HASH);
  await assert.rejects(operations.complete('operation-1', OTHER_HASH), errorCode('transaction_unknown'));
  await operations.acknowledge(1, 'operation-1', HASH);
  await operations.complete('operation-1', HASH);
  await operations.unknown('operation-1');
  assert.equal(await operations.pending(1), null);
  assert.equal((await operations.result(1, 'operation-1'))?.hash, HASH);
});

test('malformed context and expired approvals fail locally without claiming a journal slot', async t => {
  const { operations } = await fixture(t);
  for (const patch of [{ referenceId: 'not-uuid' }, { walletId: '../wallet' }, { caip2: 'eip155:137' },
    { expiresAt: NaN }, { expiresAt: NOW }, { expiresAt: NOW - 1 }, { expiresAt: NOW + 300001 }]) {
    await assert.rejects(operations.claim(1, 'operation-1', { ...context(), ...patch } as TransactionContext));
    assert.equal(await operations.pending(1), null);
  }
  const api = new PrivyWalletApi('testapp000000000000000000', 'synthetic-test-secret');
  const wallet = { id: 'wallet-1', address: `0x${'ab'.repeat(20)}`, verified: true } as const;
  const prepared = api.prepare(wallet, { to: wallet.address, chainId: 1 }, crypto.randomUUID(), NOW - 300000);
  assert.throws(() => api.validatePrepared(prepared, wallet.id), errorCode('approval_expired'));
  assert.equal(await operations.pending(1), null);
});

test('storage failure before dispatch creates no row; failed completion remains blocked and recoverable', async t => {
  const { db, operations } = await fixture(t);
  db.failNext = true;
  await assert.rejects(operations.claim(1, 'operation-1', context()), errorCode('access_unavailable'));
  assert.equal(await operations.pending(1), null);
  await operations.claim(1, 'operation-1', context());
  db.failNext = true;
  await assert.rejects(operations.complete('operation-1', HASH), errorCode('transaction_unknown'));
  db.failNext = true;
  await assert.rejects(operations.unknown('operation-1'), errorCode('access_unavailable'));
  assert.equal((await operations.pending(1))?.state, 'dispatching');
  assert.equal(await operations.recoverUnknown(1, 'operation-1', HASH), true);
  db.failNext = true;
  await assert.rejects(operations.acknowledge(1, 'operation-1', HASH), errorCode('access_unavailable'));
  assert.equal((await operations.pending(1))?.acknowledged, false);
});

test('malformed hashes and missing rows cannot manufacture submitted state', async t => {
  const { operations } = await fixture(t);
  await operations.claim(1, 'operation-1', context());
  for (const hash of ['', '0x123', `0x${'gg'.repeat(32)}`]) {
    await assert.rejects(operations.complete('operation-1', hash));
    await assert.rejects(operations.recoverUnknown(1, 'operation-1', hash));
    await assert.rejects(operations.acknowledge(1, 'operation-1', hash));
  }
  await assert.rejects(operations.complete('missing', HASH), errorCode('transaction_unknown'));
  assert.equal((await operations.pending(1))?.state, 'dispatching');
});

test('expiry between claim and submit proves no POST and permits explicit local rejection', async t => {
  const { operations } = await fixture(t);
  let calls = 0;
  const api = new PrivyWalletApi('testapp000000000000000000', 'synthetic-test-secret', async () => {
    calls++;
    throw new Error('must not dispatch expired request');
  });
  const wallet = { id: 'wallet-1', address: `0x${'ab'.repeat(20)}`, verified: true } as const;
  const prepared = api.prepare(wallet, { to: wallet.address, chainId: 1 }, crypto.randomUUID(), NOW - 299999);
  const ctx = api.validatePrepared(prepared, wallet.id);
  await operations.claim(1, 'operation-1', ctx);
  t.mock.method(Date, 'now', () => NOW + 1);
  await assert.rejects(api.submit(prepared, wallet.id, 'webauthn:YQ:Yg:Yw'), errorCode('approval_expired'));
  assert.equal(calls, 0);
  assert.equal(await operations.rejectBeforeDispatch('operation-1'), true);
  assert.deepEqual(await operations.result(1, 'operation-1'), {
    id: 'operation-1', state: 'rejected', hash: null, context: ctx, acknowledged: true,
  });
  assert.equal(await operations.pending(1), null);
  assert.equal(await operations.rejectBeforeDispatch('operation-1'), false);
  await assert.rejects(operations.claim(1, 'operation-1', context()), errorCode('transaction_unresolved'));
  await assert.rejects(operations.claim(1, 'operation-2', { ...ctx, expiresAt: NOW + 300000 }), errorCode('transaction_unresolved'));
  assert.equal(await operations.recoverUnknown(1, 'operation-1', HASH), false);
  await assert.rejects(operations.complete('operation-1', HASH), errorCode('transaction_unknown'));
  await operations.claim(1, 'operation-2', context());
});

test('local rejection cannot unlock unknown or erase a proven broadcast, even in a race', async t => {
  const { operations } = await fixture(t);
  await operations.claim(1, 'unknown', context());
  await operations.unknown('unknown');
  assert.equal(await operations.rejectBeforeDispatch('unknown'), false);
  assert.equal((await operations.pending(1))?.state, 'unknown');
  await operations.claim(2, 'broadcast', context());
  const [recovered, rejected] = await Promise.all([
    operations.recoverUnknown(2, 'broadcast', HASH), operations.rejectBeforeDispatch('broadcast'),
  ]);
  assert.equal(recovered, true);
  assert.equal(rejected, false);
  assert.equal((await operations.pending(2))?.hash, HASH);
  assert.equal(await operations.rejectBeforeDispatch('missing'), false);
});
