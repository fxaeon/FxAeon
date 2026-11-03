import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { Store, type DB, type DBStatement, type DBResult } from './store.ts';
import { AdmissionControl } from './admissionPolicy.ts';

const BOT = '123456789';
const TOKEN = 'synthetic-operator-token-more-than-32-characters';
const ORIGIN = 'https://fxaeon.com';
class Sqlite implements DB {
  sql: DatabaseSync;
  constructor(path: string) { this.sql = new DatabaseSync(path); this.sql.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=15000; PRAGMA journal_mode=WAL'); }
  prepare(query: string) { return new Statement(this, query); }
  async batch<T = Record<string, unknown>>(statements: DBStatement[]): Promise<DBResult<T>[]> {
    this.sql.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(s => (s as Statement).execute<T>()); this.sql.exec('COMMIT'); return results; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
class Statement implements DBStatement {
  constructor(readonly db: Sqlite, readonly query: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.db, this.query, values); }
  execute<T>(): DBResult<T> {
    const s = this.db.sql.prepare(this.query);
    if (s.columns().length) return { success: true, results: s.all(...this.values as SQLInputValue[]) as T[] };
    const r = s.run(...this.values as SQLInputValue[]); return { success: true, results: [], meta: { changes: Number(r.changes) } };
  }
  async all<T = Record<string, unknown>>() { return this.execute<T>(); }
  async run<T = Record<string, unknown>>() { return this.execute<T>(); }
}
async function fixture(t: TestContext, legacy: number) {
  const dir = mkdtempSync(join(tmpdir(), 'fxaeon-resolve-race-'));
  const path = join(dir, 'db.sqlite'); const db = new Sqlite(path); const store = new Store(db);
  t.after(() => { db.sql.close(); rmSync(dir, { recursive: true, force: true }); });
  await store.init(legacy);
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = [...new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))];
  async function launch(id: number) {
    const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now()/1000)), query_id: 'race', user: JSON.stringify({ id, first_name: 'test' }) });
    const message = `${BOT}:WebAppData\n${[...fields].sort(([a], [b]) => a < b ? -1 : 1).map(([k,v]) => `${k}=${v}`).join('\n')}`;
    fields.set('signature', Buffer.from(await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(message))).toString('base64url'));
    return fields.toString();
  }
  return { db, store, control: new AdmissionControl(db), path, publicKey, launch, legacy };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Job = { kind: 'status'; launch: string } | { kind: 'configure'; threshold: number; paused: boolean; expectedRevision: number };
async function race(f: Fixture, jobs: Job[]) {
  const gate = new SharedArrayBuffer(4); const flag = new Int32Array(gate);
  const workers = jobs.map(job => new Worker(`
    const {parentPort,workerData} = require('node:worker_threads');
    const {DatabaseSync} = require('node:sqlite');
    require('tsx/cjs');
    globalThis.fetch = async () => { throw new Error('network forbidden'); };
    const {createAccessHandler,createOperatorHandler} = require(workerData.module);
    const sql = new DatabaseSync(workerData.path);
    sql.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=15000;');
    function prepare(query,values=[]) {
      const execute=()=>{ const s=sql.prepare(query); if(s.columns().length) return {success:true,results:s.all(...values)};
        const r=s.run(...values); return {success:true,results:[],meta:{changes:Number(r.changes)}}; };
      return {bind:(...v)=>prepare(query,v),execute,all:async()=>execute(),run:async()=>execute()};
    }
    const db={prepare,batch:async statements=>{sql.exec('BEGIN IMMEDIATE'); try {const r=statements.map(s=>s.execute());sql.exec('COMMIT');return r;}
      catch(e){sql.exec('ROLLBACK');throw e;}}};
    const env={ADMISSION_DB:db,TELEGRAM_BOT_ID:workerData.bot,MINIAPP_ORIGIN:'https://fxaeon.com',MINIAPP_ACCESS_MODE:'passkey',
      MINIAPP_LEGACY_USERS:String(workerData.legacy),MINIAPP_OPERATOR_TOKEN:workerData.token,PRIVY_APP_ID:'testapp000000000000000000',
      PRIVY_APP_SECRET:'synthetic-provider-secret',PRIVY_PUBLIC_SIGNUP_DISABLED:'yes'};
    const job=workerData.job, operator=job.kind==='configure';
    const body=operator?{action:'configure',threshold:job.threshold,paused:job.paused,expectedRevision:job.expectedRevision}:{action:'status',launchData:job.launch};
    const handler=operator?createOperatorHandler():createAccessHandler({publicKey:new Uint8Array(workerData.publicKey)});
    const headers={'content-type':'application/json',origin:'https://fxaeon.com'};
    if(operator) headers.authorization='Bearer '+workerData.token;
    const request=new Request('https://fxaeon.com/api/'+(operator?'miniapp-operator':'telegram-wallet'),{method:'POST',headers,body:JSON.stringify(body)});
    parentPort.postMessage({ready:true}); Atomics.wait(new Int32Array(workerData.gate),0,0);
    handler({request,env}).then(async r=>parentPort.postMessage({status:r.status,body:await r.json()}))
      .catch(e=>parentPort.postMessage({failure:String(e)})).finally(()=>sql.close());
  `, { eval: true, workerData: { job, gate, path: f.path, publicKey: f.publicKey, legacy: f.legacy, bot: BOT, token: TOKEN,
    module: fileURLToPath(new URL('./index.ts', import.meta.url)) } }));
  const outcomes = workers.map(worker => new Promise<any>((resolve, reject) => {
    worker.on('message', m => { if (!m.ready) resolve(m); }); worker.on('error', reject);
    worker.on('exit', code => { if (code !== 0) reject(new Error(`worker exited ${code}`)); });
  }));
  try {
    await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => {
      worker.once('message', m => { if (m.ready) resolve(); else reject(new Error('worker did not initialize')); }); worker.once('error', reject);
    })));
    Atomics.store(flag, 0, 1); Atomics.notify(flag, 0);
    return await Promise.all(outcomes);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}
const statuses = async (f: Fixture, ids: number[]) => Promise.all(ids.map(async id => ({ kind: 'status' as const, launch: await f.launch(id) })));

test('independent full status handlers compete for last seat at threshold 1 and hard cap 480', async t => {
  for (const [legacy, threshold] of [[0,1], [479,480]]) {
    const f = await fixture(t, legacy);
    if (threshold === 1) assert.equal(await f.control.configure(1, false, 0), true);
    const results = await race(f, await statuses(f, [101,102,103,104,105,106]));
    assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
    assert.equal(results.filter(r => r.body.state === 'approved').length, 1, JSON.stringify(results));
    assert.equal(results.filter(r => r.body.state === 'new').length, 5);
    assert.deepEqual(await f.control.snapshot(), { capacity: { used: threshold, legacy, max: 480 },
      policy: { threshold, paused: false, revision: threshold === 1 ? 1 : 0, active: true } });
    assert.equal((await f.control.activity()).filter(e => e.kind === 'reservation').length, 1);
  }
});

test('replayed authenticated launches across handlers preserve one seat and one audit event', async t => {
  const f = await fixture(t, 0); await f.control.configure(1, false, 0);
  const launch = await f.launch(123); const results = await race(f, Array.from({length: 6}, () => ({kind:'status', launch})));
  assert.ok(results.every(r => r.status === 200 && r.body.state === 'approved'), JSON.stringify(results));
  assert.equal((await f.store.enrollments()).length, 1);
  assert.equal((await f.control.activity()).filter(e => e.kind === 'reservation').length, 1);
  assert.equal((await f.control.snapshot()).capacity.used, 1);
});

test('pause and competing policy CAS serialize with simultaneous automatic reservations', async t => {
  const f = await fixture(t, 0);
  const results = await race(f, [...await statuses(f, [1,2,3,4]),
    {kind:'configure', threshold: 480, paused:true, expectedRevision:0},
    {kind:'configure', threshold: 480, paused:true, expectedRevision:0}]);
  assert.ok(results.slice(0,4).every(r => r.status === 200), JSON.stringify(results));
  assert.deepEqual(results.slice(4).map(r => r.status).sort(), [200,409]);
  const events = (await f.control.activity()).reverse();
  const pause = events.findIndex(e => e.kind === 'policy'); assert.ok(pause >= 0);
  assert.ok(events.slice(pause+1).every(e => e.kind !== 'reservation'), JSON.stringify(events));
  assert.ok(events.slice(0,pause).every(e => e.kind === 'reservation' && !e.paused && e.revision === 0));
  assert.equal((await f.control.snapshot()).policy.paused, true);
  const after = await race(f, await statuses(f, [5]));
  assert.equal(after[0].body.state, 'new');
});

test('direct writes, baseline reinitialization and immutable audit cannot bypass runtime policy', async t => {
  const f = await fixture(t, 2); await f.control.resolve(1); await f.store.join(2, false);
  await f.control.configure(3, false, 0);
  assert.throws(() => f.db.sql.exec("INSERT INTO admission_users(user_id,joined_at,telegram_notify,external_id) VALUES(3,0,0,'bypass')"));
  assert.throws(() => f.db.sql.exec("UPDATE admission_users SET external_id='bypass' WHERE user_id=2"));
  await f.store.init(0); assert.equal((await f.control.snapshot()).capacity.legacy, 2);
  await f.store.init(4); const snapshot = await f.control.snapshot();
  assert.equal(snapshot.capacity.used, 5); assert.equal(snapshot.policy.active, true);
  assert.equal((await f.store.status(1))?.state, 'approved');
  assert.throws(() => f.db.sql.exec('UPDATE admission_activity SET kind=\'policy\''));
  assert.throws(() => f.db.sql.exec('DELETE FROM admission_activity'));
  const events = await f.control.activity();
  assert.deepEqual(events[0], { id: events[0].id, kind: 'legacy', at: events[0].at, threshold: 3,
    paused: false, revision: 1, previousLegacy: 2, legacy: 4, used: 5 });
});
import { createAccessHandler, createOperatorHandler, type Env } from './index.ts';

test('forged status, unknown actions and unauthenticated operator calls cannot reserve or alter policy', async t => {
  const f = await fixture(t, 0);
  const env: Env = { ADMISSION_DB: f.db, TELEGRAM_BOT_ID: BOT, MINIAPP_ORIGIN: ORIGIN, MINIAPP_ACCESS_MODE: 'passkey',
    MINIAPP_LEGACY_USERS: '0', MINIAPP_OPERATOR_TOKEN: TOKEN, PRIVY_APP_ID: 'testapp000000000000000000',
    PRIVY_APP_SECRET: 'synthetic-provider-secret', PRIVY_PUBLIC_SIGNUP_DISABLED: 'yes' };
  const access = createAccessHandler({ publicKey: new Uint8Array(f.publicKey), fetch: async () => { throw new Error('network forbidden'); } });
  const operator = createOperatorHandler();
  const callAccess = (body: unknown, origin = ORIGIN) => access({ env, request: new Request(`${ORIGIN}/api/telegram-wallet`, {
    method:'POST', headers:{origin, 'content-type':'application/json'}, body:JSON.stringify(body) }) });
  const launch = await f.launch(55);
  const bad = new URLSearchParams(launch); bad.set('user', JSON.stringify({id:56, first_name:'test'}));
  assert.equal((await callAccess({action:'status', launchData:bad.toString()})).status, 403);
  assert.equal((await callAccess({action:'status', launchData:launch}, 'https://attacker.test')).status, 403);
  assert.notEqual((await callAccess({action:'unknown', launchData:launch})).status, 200);
  const request = (body: unknown, token: string) => new Request(`${ORIGIN}/api/miniapp-operator`, { method:'POST',
    headers:{authorization:`Bearer ${token}`, 'content-type':'application/json'}, body:JSON.stringify(body) });
  assert.equal((await operator({env, request:request({action:'configure', threshold:1, paused:false, expectedRevision:0}, 'wrong')})).status, 401);
  assert.equal((await operator({env, request:request({action:'unknown'}, TOKEN)})).status, 400);
  assert.equal((await f.store.enrollments()).length, 0);
  assert.deepEqual(await f.control.activity(), []);
  assert.deepEqual((await f.control.snapshot()).policy, {threshold:480, paused:false, revision:0, active:false});
});

test('activity returns the most recent 100 policy events in insertion order without identity fields', async t => {
  const f = await fixture(t, 0);
  for (let revision = 0; revision < 105; revision++) {
    assert.equal(await f.control.configure(480, revision % 2 === 0, revision), true);
  }
  const events = await f.control.activity();
  assert.equal(events.length, 100);
  assert.equal(events[0].revision, 105);
  assert.equal(events[99].revision, 6);
  assert.ok(events.every((event, i) => Object.keys(event).sort().join(',') === 'at,id,kind,paused,revision,threshold'
    && (i === 0 || events[i - 1].id > event.id)));
});

test('authenticated activity handler exposes safe legacy capacity context', async t => {
  const f = await fixture(t, 5); await f.control.resolve(22); await f.store.init(8);
  const env: Env = { ADMISSION_DB:f.db, TELEGRAM_BOT_ID:BOT, MINIAPP_ORIGIN:ORIGIN, MINIAPP_ACCESS_MODE:'waitlist',
    MINIAPP_LEGACY_USERS:'8', MINIAPP_OPERATOR_TOKEN:TOKEN };
  const handler = createOperatorHandler();
  const request = new Request(`${ORIGIN}/api/miniapp-operator`, { method:'POST',
    headers:{authorization:`Bearer ${TOKEN}`, 'content-type':'application/json'}, body:JSON.stringify({action:'activity'}) });
  const response = await handler({request, env}); assert.equal(response.status, 200);
  const result = await response.json() as {events: Record<string, unknown>[]};
  assert.equal(result.events[0].kind, 'legacy');
  assert.equal(result.events[0].previousLegacy, 5); assert.equal(result.events[0].legacy, 8); assert.equal(result.events[0].used, 9);
  assert.ok(result.events.every(event => !('userId' in event)));
});
