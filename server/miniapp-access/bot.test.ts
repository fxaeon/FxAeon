import assert from 'node:assert/strict';
import { after, before, mock, test, type TestContext } from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTelegramBotHandler, telegramWebhookSecret, TELEGRAM_WEBHOOK_URL, type BotEnv } from './bot.ts';
import type { DB, DBResult, DBStatement } from './store.ts';
import { onRequest } from '../../functions/api/telegram-bot.ts';

const TOKEN = '123456789:abcdefghijklmnopqrstuvwxyz';
const NOW = Date.UTC(2026, 10, 3);
const DAY = 86_400_000;
const network: string[] = [];
before(() => { mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => { network.push(String(input)); throw Error('unexpected network'); }); });
after(() => { mock.restoreAll(); assert.deepEqual(network, []); });

/** Real SQLite SQL and atomic D1-shaped batches, including dedup/rate conditions. */
class SQLiteDB implements DB {
  readonly sql: DatabaseSync;
  fail = false;
  constructor(path = ':memory:') { this.sql = new DatabaseSync(path); }
  prepare(sql: string) { return new Statement(this, sql); }
  async batch<T = Record<string, unknown>>(statements: DBStatement[]): Promise<DBResult<T>[]> {
    if (this.fail) throw Error('storage secret should never escape');
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
    statement.run(...this.values as SQLInputValue[]); return { success: true, results: [] };
  }
  async all<T = Record<string, unknown>>() { return this.execute<T>(); }
  async run<T = Record<string, unknown>>() { return this.execute<T>(); }
}
function update(id = 1, text = '/start', now = NOW, chat = 42) {
  return { update_id: id, message: { message_id: id + 1, date: Math.floor(now / 1000), text,
    entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
    chat: { id: chat, type: 'private' }, from: { id: chat, is_bot: false } } };
}
async function request(value: unknown, init: RequestInit = {}, url = TELEGRAM_WEBHOOK_URL) {
  return new Request(url, { method: 'POST', body: JSON.stringify(value), headers: {
    'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': await telegramWebhookSecret(TOKEN),
  }, ...init });
}
function fixture(t: TestContext) {
  const db = new SQLiteDB(); t.after(() => db.sql.close());
  const sent: Array<Record<string, any>> = [];
  let now = NOW;
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), `https://api.telegram.org/bot${TOKEN}/sendMessage`);
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'manual');
    sent.push(JSON.parse(String(init?.body))); return new Response('{"ok":true}');
  };
  const handler = createTelegramBotHandler({ fetch: fetchImpl, now: () => now });
  const env: BotEnv = { ADMISSION_DB: db, TELEGRAM_BOT_TOKEN: TOKEN };
  return { db, sent, env, handler, fetchImpl, setNow: (value: number) => { now = value; },
    run: async (value: unknown) => handler({ request: await request(value), env }) };
}

test('all three commands produce concise, fixed private replies and an open-app button; start payload is opaque', async t => {
  const f = fixture(t);
  for (const [index, text] of ['/start private_payload', '/help', '/support'].entries()) {
    const response = await f.run(update(index, text));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(f.sent.length, 3);
  for (const payload of f.sent) {
    assert.equal(payload.chat_id, 42); assert.ok(payload.text.length < 300);
    assert.doesNotMatch(JSON.stringify(payload), /private_payload|parse_mode|callback_data/);
    assert.deepEqual(payload.reply_markup, { inline_keyboard: [[{ text: 'Open FxAeon', web_app: { url: 'https://fxaeon.com/' } }]] });
  }
  assert.deepEqual(f.sent.map(payload => payload.text), [
    'Welcome to FxAeon. Open the app to join the waitlist or continue.',
    'Open FxAeon below. Guides: https://fxaeon.com/docs\nFor feedback or a problem, use /support.',
    'Send feedback or report a problem: support@fxaeon.com\nNever share your recovery phrase or private keys.',
  ]);
  assert.deepEqual(f.db.sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name), ['telegram_bot_updates']);
  assert.doesNotMatch(JSON.stringify(f.db.sql.prepare('SELECT * FROM telegram_bot_updates').all()), /private_payload|\/start|\/help|\/support/);
});

test('mounted route enforces exact POST URL and secret before reading bodies or writing D1', async t => {
  const f = fixture(t);
  const cases: Array<[Request, number]> = [
    [await request({}, { method: 'GET', body: undefined }), 405],
    [await request({}, { method: 'OPTIONS', body: undefined }), 405],
    [await request({}, {}, TELEGRAM_WEBHOOK_URL + '/'), 404],
    [await request({}, {}, TELEGRAM_WEBHOOK_URL + '?token=x'), 404],
    [await request({}, {}, TELEGRAM_WEBHOOK_URL.replace('fxaeon.com', 'other.test')), 404],
    [await request({}, { headers: { 'content-type': 'application/json' } }), 401],
    [await request({}, { headers: { 'X-Telegram-Bot-Api-Secret-Token': '0'.repeat(64) } }), 401],
  ];
  for (const [req, status] of cases) assert.equal((await onRequest({ request: req, env: f.env })).status, status);
  assert.equal((await onRequest({ request: await request({ update_id: 1 }), env: f.env })).status, 200);
  assert.equal((await onRequest({ request: await request(update()), env: {} })).status, 503);
  assert.deepEqual(f.db.sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(), []);
});

test('ignores noncommands, admin commands, other updates, malformed entities and nonprivate identities', async t => {
  const f = fixture(t);
  const invalid: unknown[] = [
    { update_id: 1, edited_message: update().message }, { update_id: 1, callback_query: {} },
    ...['hello', '/admit', '/admin', '/startx', '/start@another_bot', '/help x', '/start a b', '/start 💰', '/start ' + 'x'.repeat(65)].map(text => update(1, text)),
  ];
  for (const patch of [
    { chat: { id: 42, type: 'group' } }, { chat: { id: -42, type: 'private' } },
    { from: { id: 43, is_bot: false } }, { from: { id: 42, is_bot: true } },
    { from: { id: 0, is_bot: false } }, { from: { id: Number.MAX_SAFE_INTEGER + 1, is_bot: false } },
    { entities: [] }, { entities: [{ type: 'bold', offset: 0, length: 6 }] },
    { entities: [{ type: 'bot_command', offset: 1, length: 6 }] },
    { entities: [{ type: 'bot_command', offset: 0, length: 5 }] },
    { entities: [update().message.entities[0], update().message.entities[0]] },
    { forward_origin: {} }, { via_bot: {} }, { sender_chat: {} }, { business_connection_id: 'x' },
    { date: (NOW - DAY) / 1000 - 1 }, { date: NOW / 1000 + 61 },
  ]) invalid.push({ ...update(), message: { ...update().message, ...patch } });
  invalid.push({ ...update(), update_id: -1 }, { ...update(), update_id: 1.5 });
  for (const value of invalid) assert.equal((await f.run(value)).status, 200);
  assert.equal(f.sent.length, 0);
  assert.deepEqual(f.db.sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(), []);
});

test('duplicate and out-of-order IDs are handled atomically without a high-watermark assumption', async t => {
  const f = fixture(t);
  await Promise.all(Array.from({ length: 12 }, () => f.run(update(900))));
  await f.run(update(899, '/help'));
  assert.equal(f.sent.length, 2);
  assert.equal(f.db.sql.prepare('SELECT count(*) AS n FROM telegram_bot_updates').get()?.n, 2);
});

test('dedup survives a handler and database connection restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fxaeon-bot-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'bot.sqlite'); let sends = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = new SQLiteDB(path);
    try {
      const handler = createTelegramBotHandler({ now: () => NOW, fetch: async () => { sends++; return new Response('{}'); } });
      assert.equal((await handler({ request: await request(update()), env: { ADMISSION_DB: db, TELEGRAM_BOT_TOKEN: TOKEN } })).status, 200);
    } finally { db.sql.close(); }
  }
  assert.equal(sends, 1);
});

test('sliding minute/day limits are durable and denied updates cannot later replay', async t => {
  const f = fixture(t);
  await Promise.all(Array.from({ length: 10 }, (_, id) => f.run(update(id))));
  assert.equal(f.sent.length, 3);
  f.setNow(NOW + 60_000);
  await f.run(update(9)); assert.equal(f.sent.length, 3, 'rate-denied IDs remain consumed');
  for (let index = 0; index < 22; index++) {
    const time = NOW + (index + 1) * 60_000; f.setNow(time); await f.run(update(100 + index, '/help', time));
  }
  assert.equal(f.sent.length, 20);
  await f.run(update(999, '/support', NOW + 22 * 60_000, 43)); assert.equal(f.sent.length, 21, 'different private chat has its own budget');
  f.setNow(NOW + DAY + 23 * 60_000);
  await f.run(update(1000, '/help', NOW + DAY + 23 * 60_000)); assert.equal(f.sent.length, 22);
});

test('expired rows prune without reopening old message replays', async t => {
  const f = fixture(t); await f.run(update());
  f.setNow(NOW + 3 * DAY);
  await f.run(update(2, '/help', NOW + 3 * DAY)); await f.run(update());
  assert.equal(f.sent.length, 2);
  assert.equal(f.db.sql.prepare('SELECT count(*) AS n FROM telegram_bot_updates').get()?.n, 1);
});

test('bounds malformed, oversized, chunked and stalled JSON bodies', async t => {
  const f = fixture(t);
  for (const body of ['{', '[]', '{"text":"' + 'x'.repeat(16_384) + '"}']) {
    assert.equal((await f.handler({ request: await request({}, { body }), env: f.env })).status, 400);
  }
  const headers = { 'content-type': 'text/plain', 'X-Telegram-Bot-Api-Secret-Token': await telegramWebhookSecret(TOKEN) };
  assert.equal((await f.handler({ request: await request({}, { headers }), env: f.env })).status, 400);
  for (const stream of [
    new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(17_000)); controller.close(); } }),
    new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xff])); controller.close(); } }),
    new ReadableStream(),
  ]) {
    const started = Date.now();
    const req = await request({}, { body: stream, duplex: 'half' } as RequestInit);
    assert.equal((await f.handler({ request: req, env: f.env })).status, 400);
    assert.ok(Date.now() - started < 4500);
  }
  assert.equal(f.sent.length, 0);
});

test('storage fails closed with sanitized response, and initialization can recover', async t => {
  const f = fixture(t); f.db.fail = true;
  const response = await f.run(update());
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'bot_unavailable' });
  assert.equal(f.sent.length, 0);
  f.db.fail = false; assert.equal((await f.run(update())).status, 200); assert.equal(f.sent.length, 1);
});

test('failed, rejected, or hung Telegram attempts are bounded and never retried on redelivery', async t => {
  for (const mode of ['throw', 'reject', 'hang']) {
    const f = fixture(t); let calls = 0; let signal: AbortSignal | null | undefined;
    const handler = createTelegramBotHandler({ now: () => NOW, sendTimeoutMs: 10, fetch: async (_input, init) => {
      calls++; signal = init?.signal;
      if (mode === 'throw') throw Error(`https://api.telegram.org/bot${TOKEN}/sendMessage private body`);
      if (mode === 'hang') return new Promise<Response>(() => {});
      return new Response('secret response body', { status: 429 });
    } });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handler({ request: await request(update()), env: f.env });
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
    }
    assert.equal(calls, 1); assert.equal(signal?.aborted, true);
  }
});

test('sync-installed secret and command list drive the actual mounted handler end to end', async t => {
  const syncPath = '../../scripts/sync_telegram_bot.mjs';
  const { syncTelegramBot } = await import(syncPath);
  const state: Record<string, any> = { getWebhookInfo: { url: '' }, getMyCommands: [], getChatMenuButton: {} };
  let installed: any;
  await syncTelegramBot({ token: TOKEN, fetchImpl: async (input: string, init: RequestInit) => {
    const method = new URL(input).pathname.split('/').pop()!;
    const body = JSON.parse(String(init.body)); let result: any;
    if (method === 'setWebhook') { installed = body; state.getWebhookInfo = { url: body.url, allowed_updates: body.allowed_updates }; result = true; }
    else if (method.startsWith('set')) { state[method.replace(/^set/, 'get')] = method === 'setMyCommands' ? body.commands : method === 'setChatMenuButton' ? body.menu_button : body; result = true; }
    else result = state[method];
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
  } });
  assert.equal(installed.url, TELEGRAM_WEBHOOK_URL);
  assert.equal(installed.secret_token, await telegramWebhookSecret(TOKEN));
  assert.deepEqual(installed.allowed_updates, ['message']);
  assert.match(installed.secret_token, /^[a-f0-9]{64}$/);
  assert.deepEqual(state.getMyCommands.map((item: any) => item.command), ['start', 'help', 'support']);
  const f = fixture(t);
  t.mock.method(globalThis, 'fetch', f.fetchImpl);
  for (const [index, item] of state.getMyCommands.entries()) {
    const req = await request(update(index, '/' + item.command, Date.now()), { headers: {
      'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': installed.secret_token,
    } });
    assert.equal((await onRequest({ request: req, env: f.env })).status, 200);
  }
  assert.equal(f.sent.length, 3);
});
