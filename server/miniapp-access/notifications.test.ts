import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { Store } from './store.ts';
import { NotificationStore, INVITATION_TEXT, escapeEmailHtml, renderNotificationEmailV2, type MailDB, type MailStatement, type MailResult, type NotificationEnv, type NotificationDiagnostic } from './notifications.ts';

test('v2 emails have one primary action, full fallback links and complete plain text without remote content', () => {
  for (const input of [
    { kind: 'verification', url: `https://fxaeon.com/invite#token=${'a'.repeat(64)}`, expiresAt: Date.UTC(2026, 10, 3, 11) },
    { kind: 'invitation', url: 'https://t.me/FxAeonBot?startapp' },
    { kind: 'invitation', url: 'https://t.me/FxAeonBot/app?startapp=welcome' },
  ] as const) {
    const mail = renderNotificationEmailV2(input);
    const links = Array.from(mail.html.matchAll(/href="([^"]+)"/g), match => match[1]);
    assert.deepEqual(links, [input.url, input.url]);
    assert.equal((mail.html.match(/display:inline-block/g) ?? []).length, 1);
    assert.ok(mail.text.includes(`\n${input.url}\n`));
    assert.ok(mail.text.includes(`browser:\n${input.url}`));
    for (const body of [mail.html, mail.text]) {
      assert.match(body, /support@fxaeon\.com/);
      if (input.kind === 'verification') {
        assert.match(body, /2026-11-03 11:00 UTC/);
        assert.match(body, /Opening the link alone does not verify/);
        assert.match(body, /request a new email/);
        assert.match(body, /did not request/);
      } else {
        assert.doesNotMatch(body, /expires|one hour|confirm your email/i);
        assert.match(body, /approved/);
      }
    }
    assert.doesNotMatch(mail.text, /<[^>]+>|&(?:amp|quot|lt|gt);/);
    assert.doesNotMatch(mail.html, /<img|<script|<link|<iframe|@font-face|url\(|utm_|tracking|src=/i);
    assert.match(mail.html, /name="viewport"/);
    assert.ok(Buffer.byteLength(JSON.stringify({ from: ENV.RESEND_FROM, to: ['person@example.com'], reply_to: 'support@fxaeon.com', ...mail })) < 8192);
  }
});

test('v2 templates escape HTML text and attributes and reject injected or off-brand destinations without leaking them', () => {
  assert.equal(escapeEmailHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
  for (const url of ['javascript:alert(1)', 'https://evil.invalid/', 'https://fxaeon.com.evil.invalid/invite',
    'https://user:password@t.me/FxAeonBot/app', 'https://t.me/FxAeonBot/app" onclick="alert(1)',
    'https://t.me/FxAeonBot/app\n', 'https://t.me/FxAeonBot/app?startapp=<script>',
    'https://t.me/FxAeonBot/app#secret', 'https://t.me/FxAeonBot/app?startapp=x&tracker=y']) {
    assert.throws(() => renderNotificationEmailV2({ kind: 'invitation', url }), /^Error: notification_template_invalid$/);
  }
  for (const expiresAt of [NaN, Infinity, 0, -1, 1.5, 8_640_000_000_000_001]) {
    assert.throws(() => renderNotificationEmailV2({ kind: 'verification', url: `https://fxaeon.com/invite#token=${'a'.repeat(64)}`, expiresAt }), /^Error: notification_template_invalid$/);
  }
  assert.throws(() => renderNotificationEmailV2({ kind: 'verification', url: 'https://fxaeon.com/invite#token="<secret>', expiresAt: 1 }), /^Error: notification_template_invalid$/);
});

/** Execute actual SQLite transactions, not SQL-shaped mocks. Every network call is intercepted. */
class SQLiteDB implements MailDB {
  readonly sql = new DatabaseSync(':memory:');
  failAt = -1;
  prepare(sql: string): Statement { return new Statement(this, sql); }
  async batch<T = Record<string, unknown>>(statements: MailStatement[]): Promise<MailResult<T>[]> {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement, index) => {
        if (index === this.failAt) throw new Error('sensitive storage detail');
        return (statement as Statement).execute<T>();
      });
      this.sql.exec('COMMIT');
      return results;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
    finally { this.failAt = -1; }
  }
}
class Statement implements MailStatement {
  constructor(readonly db: SQLiteDB, readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.db, this.sql, values); }
  execute<T>(): MailResult<T> {
    const statement = this.db.sql.prepare(this.sql);
    if (statement.columns().length) return { success: true, results: statement.all(...this.values as SQLInputValue[]) as T[] };
    statement.run(...this.values as SQLInputValue[]);
    return { success: true, results: [] };
  }
  async all<T = Record<string, unknown>>() { return this.execute<T>(); }
  async run<T = Record<string, unknown>>() { return this.execute<T>(); }
}
const ENV: NotificationEnv = {
  RESEND_API_KEY: 're_fake_test_key_never_live', RESEND_FROM: 'FxAeon <invite@fxaeon.com>',
  TELEGRAM_BOT_TOKEN: '123456:abcdefghijklmnopqrstuvwxyz', TELEGRAM_MINIAPP_URL: 'https://t.me/FxAeonBot/app',
};
type Call = { url: string; init: RequestInit; body: Record<string, any> };
async function fixture(t: TestContext, overrides: NotificationEnv = {}, timeoutMs = 100) {
  const db = new SQLiteDB();
  t.after(() => db.sql.close());
  const admission = new Store(db);
  await admission.init();
  let now = Date.UTC(2026, 10, 3, 10);
  const calls: Call[] = [];
  const diagnostics: NotificationDiagnostic[] = [];
  let response: (call: Call) => Response | Promise<Response> = call => Response.json(call.url.includes('resend')
    ? { id: 'email-id' } : { ok: true, result: { message_id: 1 } });
  const fetcher = (async (input, init) => {
    const call = { url: String(input), init: init!, body: JSON.parse(String(init!.body)) };
    calls.push(call);
    return response(call);
  }) as typeof fetch;
  const env = { ...ENV, ...overrides };
  const make = () => new NotificationStore(db, env, { fetch: fetcher, now: () => now, timeoutMs,
    onDiagnostic: diagnostic => { diagnostics.push(diagnostic); } });
  const store = make();
  await store.init();
  return { db, admission, store, make, calls, diagnostics, env, advance: (ms: number) => { now += ms; },
    respond: (handler: typeof response) => { response = handler; }, now: () => now,
    rows: () => db.sql.prepare('SELECT * FROM access_mail_outbox ORDER BY created_at,id').all() as any[],
    async approve(id = 1, notify = true) { await admission.join(id, notify); await admission.approve([id]); },
    verified(id: number, email = `person${id}@example.com`) {
      db.sql.prepare('INSERT INTO access_mail_contacts(user_id,email,expires_at,verified) VALUES(?,?,0,1)').run(id, email);
    },
  };
}
function token(call: Call): string {
  const value = /https:\/\/fxaeon\.com\/invite#token=([a-f0-9]{64})/.exec(call.body.text)?.[1];
  assert.ok(value);
  return value;
}

test('delivery status distinguishes queued, provider acceptance and verified contact without secrets', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.store.verificationStatus(1), { state: 'not_requested', retryAfterMs: null });
  await f.admission.join(1, false);
  await f.store.setContact(1, 'person@example.com');
  assert.deepEqual(await f.store.verificationStatus(1), { state: 'pending', retryAfterMs: 0 });
  assert.equal(f.calls.length, 0);
  await f.store.dispatch();
  assert.deepEqual(await f.store.verificationStatus(1), { state: 'accepted', retryAfterMs: null });
  assert.deepEqual(await f.store.verificationStatus(2), { state: 'not_requested', retryAfterMs: null });
  await f.store.confirmContact(token(f.calls[0]));
  assert.deepEqual(await f.store.verificationStatus(1), { state: 'verified', retryAfterMs: null });
  await f.store.retryVerification(1);
  await f.store.dispatch();
  assert.equal(f.calls.length, 1);
});

test('transport exception stays pending; explicit retry respects backoff and reuses the idempotency key', async t => {
  const f = await fixture(t);
  await f.admission.join(1, false);
  await f.store.setContact(1, 'person@example.com');
  f.respond(() => { throw new TypeError('secret recipient@example.com re_private https://private/#token=private'); });
  await f.store.dispatch();
  assert.deepEqual(await f.store.verificationStatus(1), { state: 'pending', retryAfterMs: 60000 });
  assert.deepEqual(f.diagnostics, [{ channel: 'email', kind: 'verification', attempt: 1,
    outcome: 'pending', reason: 'transport_exception' }]);
  await f.store.retryVerification(1);
  await f.store.dispatch();
  assert.equal(f.calls.length, 1);
  f.advance(60000);
  f.respond(() => Response.json({ id: 'accepted-id' }));
  await f.store.retryVerification(1);
  await f.store.dispatch();
  assert.equal(f.calls.length, 2);
  assert.equal(new Headers(f.calls[0].init.headers).get('Idempotency-Key'), new Headers(f.calls[1].init.headers).get('Idempotency-Key'));
  assert.deepEqual(await f.store.verificationStatus(1), { state: 'accepted', retryAfterMs: null });
  assert.equal(f.rows().length, 1);
});

test('explicit retry after definite rejection is rate limited and cannot switch recipients', async t => {
  const f = await fixture(t);
  await f.admission.join(1, false);
  await f.store.setContact(1, 'person@example.com');
  f.respond(() => new Response('private provider details', { status: 403 }));
  await f.store.dispatch();
  assert.deepEqual(await f.store.verificationStatus(1), { state: 'failed', retryAfterMs: 0 });
  assert.deepEqual(f.diagnostics[0], { channel: 'email', kind: 'verification', attempt: 1,
    outcome: 'failed', reason: 'provider_rejected', httpStatus: 403 });
  await assert.rejects(f.store.retryVerification(2), /notification_unavailable/);
  await f.store.retryVerification(1); await f.store.dispatch();
  await f.store.retryVerification(1); await f.store.dispatch();
  await assert.rejects(f.store.retryVerification(1), /notification_rate_limited/);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => JSON.stringify(call.body.to) === '["person@example.com"]'));
  assert.equal(new Set(f.calls.map(call => new Headers(call.init.headers).get('Idempotency-Key'))).size, 3);
});

test('expiry and exhausted ambiguous attempts are reported truthfully', async t => {
  const f = await fixture(t);
  await f.admission.join(1, false);
  await f.store.setContact(1, 'person@example.com');
  f.respond(() => { throw new Error('transport'); });
  await f.store.dispatch(); f.advance(60000);
  await f.store.dispatch(); f.advance(120000);
  await f.store.dispatch();
  assert.deepEqual(await f.store.verificationStatus(1), { state: 'uncertain', retryAfterMs: 0 });
  f.advance(3600000);
  assert.deepEqual(await f.store.verificationStatus(1), { state: 'expired', retryAfterMs: 0 });
  await f.store.retryVerification(1);
  assert.deepEqual(await f.store.verificationStatus(1), { state: 'pending', retryAfterMs: 0 });
});

test('redirects are never followed and diagnostics cannot leak redirect destinations', async t => {
  const f = await fixture(t);
  await f.admission.join(1, false);
  await f.store.setContact(1, 'person@example.com');
  f.respond(() => new Response(null, { status: 307, headers: { location: 'https://attacker.invalid/private' } }));
  assert.equal((await f.store.dispatch()).deferred, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.redirect, 'manual');
  assert.deepEqual(f.diagnostics, [{ channel: 'email', kind: 'verification', attempt: 1,
    outcome: 'pending', reason: 'redirect', httpStatus: 307 }]);
});

test('verification is generic, hashed at rest, explicit-confirmation only, single-use and durable', async t => {
  const f = await fixture(t);
  await f.admission.join(1, false);
  assert.deepEqual(await f.store.contactStatus(1), { verified: false });
  assert.deepEqual(await f.store.contactStatus(99), { verified: false });
  assert.deepEqual(await f.store.setContact(1, ' Alice@Example.com '), { status: 'verification_requested' });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.store.dispatch(), { sent: 1, failed: 0, deferred: 0, uncertain: 0 });
  const value = token(f.calls[0]);
  assert.match(f.calls[0].body.text, /select Confirm email/);
  assert.equal(f.calls[0].body.reply_to, 'support@fxaeon.com');
  assert.equal(JSON.stringify(f.rows()).includes(value), false);
  assert.equal(JSON.stringify(f.db.sql.prepare('SELECT * FROM access_mail_contacts').all()).includes(value), false);
  assert.equal(f.db.sql.prepare('SELECT verified FROM access_mail_contacts').get()!.verified, 0);
  assert.equal(await f.make().confirmContact(value), 1);
  assert.deepEqual(await f.store.contactStatus(1), { verified: true });
  assert.equal(await f.store.confirmContact(value), null);
  assert.equal(await f.store.confirmContact('invalid'), null);
  await f.store.dispatch();
  assert.equal(f.calls.length, 1);
});

test('verification expires at one hour and old tokens cannot verify replacement contacts', async t => {
  const f = await fixture(t);
  await f.admission.join(1, false);
  await f.store.setContact(1, 'first@example.com'); await f.store.dispatch();
  const first = token(f.calls[0]);
  await f.store.setContact(1, 'second@example.com'); await f.store.dispatch();
  const second = token(f.calls[1]);
  assert.equal(await f.store.confirmContact(first), null);
  f.advance(3_600_000);
  assert.equal(await f.store.confirmContact(second), null);
});

test('concurrent confirmation consumes a token only once', async t => {
  const f = await fixture(t);
  await f.admission.join(1, false);
  await f.store.setContact(1, 'person@example.com'); await f.store.dispatch();
  assert.deepEqual((await Promise.all([f.store.confirmContact(token(f.calls[0])), f.make().confirmContact(token(f.calls[0]))])).sort(), [1, null].sort());
});

test('max three requests per rolling day by Telegram ID and normalized email, including concurrent requests', async t => {
  const f = await fixture(t);
  for (let id = 1; id <= 5; id++) await f.admission.join(id, false);
  const byUser = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => f.make().setContact(1, `user${i}@example.com`)));
  assert.equal(byUser.filter(result => result.status === 'fulfilled').length, 3);
  for (const result of byUser) if (result.status === 'rejected') assert.equal(result.reason.message, 'notification_rate_limited');
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM access_mail_requests').get()!.n, 3);
  const byEmail = await Promise.allSettled([2, 3, 4, 5].map(id => f.make().setContact(id, ' Shared@Example.com ')));
  assert.equal(byEmail.filter(result => result.status === 'fulfilled').length, 3);
  for (const result of byEmail) if (result.status === 'rejected') assert.equal(result.reason.message, 'notification_rate_limited');
  assert.equal(f.db.sql.prepare("SELECT count(*) n FROM access_mail_requests WHERE user_id<>1").get()!.n, 3);
  f.advance(24 * 3_600_000);
  await f.store.setContact(1, 'new@example.com');
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM access_mail_requests WHERE user_id=1').get()!.n, 4);
});

test('unjoined users cannot enqueue verification and invalid addresses do not leak input', async t => {
  const f = await fixture(t);
  await assert.rejects(f.store.setContact(99, 'person@example.com'), { message: 'notification_rate_limited' });
  assert.equal(f.rows().length, 0);
  for (const value of ['secret@example.com\r\nBcc:x@example.com', 'bad', 'a@localhost', `${'a'.repeat(65)}@example.com`]) {
    await assert.rejects(f.store.setContact(1, value), { message: 'notification_input_invalid' });
  }
});

test('contact, rate and verification outbox changes roll back atomically with sanitized errors', async t => {
  const f = await fixture(t);
  await f.admission.join(1, false);
  f.db.failAt = 3;
  await assert.rejects(f.store.setContact(1, 'private@example.com'), { message: 'notification_storage_unavailable' });
  assert.equal(f.rows().length, 0);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM access_mail_contacts').get()!.n, 0);
  assert.equal(f.db.sql.prepare('SELECT count(*) n FROM access_mail_requests').get()!.n, 0);
});

test('invitations require durable approval; email additionally requires verification; enqueue is idempotent', async t => {
  const f = await fixture(t);
  await f.admission.join(1, true);
  f.verified(1);
  await f.store.enqueueInvitation(1, true);
  await f.store.enqueueInvitation(99, true);
  assert.equal(f.rows().length, 0);
  await f.admission.approve([1]);
  await Promise.all([f.store.enqueueInvitation(1, true), f.make().enqueueInvitation(1, true)]);
  assert.equal(f.rows().length, 2);
  await f.approve(2); await f.store.enqueueInvitation(2, false);
  assert.equal(f.rows().length, 2);
  await f.store.dispatch();
  assert.equal(f.calls.length, 2);
  assert.equal((await f.admission.status(1))!.state, 'approved');
});

test('Telegram uses exact professional copy, fixed Mini App button, fixed HTTPS host and manual redirects', async t => {
  const f = await fixture(t);
  await f.approve(); await f.store.enqueueInvitation(1, true); await f.store.dispatch();
  const call = f.calls[0];
  assert.equal(call.url, `https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`);
  assert.equal(call.body.text, INVITATION_TEXT);
  assert.equal(call.body.chat_id, '1');
  assert.deepEqual(call.body.reply_markup, { inline_keyboard: [[{ text: 'Open FxAeon', web_app: { url: 'https://fxaeon.com/' } }]] });
  assert.deepEqual(call.body.link_preview_options, { is_disabled: true });
  assert.equal(call.init.redirect, 'manual');
  assert.equal(call.init.method, 'POST');
  assert.ok(call.init.signal);
});

test('bare bot configuration produces direct email launchers and private Telegram Mini App buttons', async t => {
  const f = await fixture(t, { TELEGRAM_MINIAPP_URL: 'https://t.me/FxAeonBot' });
  await f.approve(); f.verified(1); await f.store.enqueueInvitation(1, true);
  assert.ok(f.rows().every(row => row.link === 'https://t.me/FxAeonBot?startapp'));
  assert.equal((await f.store.dispatch()).sent, 2);
  assert.equal(f.calls.find(call => call.url.includes('resend'))!.body.text, `${INVITATION_TEXT}\n\nhttps://t.me/FxAeonBot?startapp`);
  assert.deepEqual(f.calls.find(call => call.body.chat_id)!.body.reply_markup.inline_keyboard,
    [[{ text: 'Open FxAeon', web_app: { url: 'https://fxaeon.com/' } }]]);
});

test('legacy pending invitation links normalize at send without replaying sent rows or resetting retries', async t => {
  const f = await fixture(t);
  await f.approve(1); f.verified(1); await f.store.enqueueInvitation(1, true);
  await f.approve(2); await f.store.enqueueInvitation(2, true);
  f.db.sql.prepare("UPDATE access_mail_outbox SET link='https://t.me/FxAeonBot'").run();
  f.db.sql.prepare("UPDATE access_mail_outbox SET status='sent',attempts=1,first_attempt=? WHERE user_id=2").run(f.now());
  f.db.sql.prepare("UPDATE access_mail_outbox SET attempts=1,first_attempt=? WHERE user_id=1 AND channel='email'").run(f.now());
  const before = f.rows().find(row => row.user_id === 2);
  assert.equal((await f.store.dispatch()).sent, 2);
  const email = f.calls.find(call => call.url.includes('resend'))!;
  assert.equal(email.body.text, `${INVITATION_TEXT}\n\nhttps://t.me/FxAeonBot?startapp`);
  assert.equal(new Headers(email.init.headers).get('Idempotency-Key'), 'access-mail/invite:email:1');
  assert.equal(f.rows().find(row => row.id === 'invite:email:1').attempts, 2);
  assert.deepEqual(f.calls.find(call => call.body.chat_id)!.body.reply_markup.inline_keyboard,
    [[{ text: 'Open FxAeon', web_app: { url: 'https://fxaeon.com/' } }]]);
  assert.deepEqual(f.rows().find(row => row.user_id === 2), before);
  await f.store.enqueueInvitation(1, true); await f.store.enqueueInvitation(2, true);
  assert.equal((await f.make().dispatch()).sent, 0);
  assert.equal(f.calls.length, 2);
});

test('existing direct email Mini App links retain their reviewed path and start parameter', async t => {
  for (const link of ['https://t.me/FxAeonBot?startapp', 'https://t.me/FxAeonBot?startapp=trade',
    'https://t.me/FxAeonBot/app', 'https://t.me/FxAeonBot/app?startapp=invite']) {
    const f = await fixture(t, { TELEGRAM_MINIAPP_URL: link });
    await f.approve(1, false); f.verified(1); await f.store.enqueueInvitation(1, false);
    await f.store.dispatch();
    assert.equal(f.calls[0].body.text, `${INVITATION_TEXT}\n\n${link}`);
  }
});

test('dispatch rechecks consent and verified destination; stale contacts cannot starve eligible Telegram', async t => {
  const f = await fixture(t);
  await f.approve(1); f.verified(1); await f.store.enqueueInvitation(1, true);
  await f.admission.join(1, false);
  await f.store.setContact(1, 'replacement@example.com');
  await f.approve(2); await f.store.enqueueInvitation(2, true);
  await f.store.dispatch(2);
  assert.ok(f.calls.some(c => c.body.chat_id === '2'));
  assert.equal(f.calls.some(c => c.body.chat_id === '1'), false);
  assert.equal(f.calls.some(c => c.body.to?.includes('person1@example.com')), false);
});

test('two dispatchers claim once and survive process recreation', async t => {
  const f = await fixture(t);
  await f.approve(); f.verified(1); await f.store.enqueueInvitation(1, true);
  await Promise.all([f.store.dispatch(), f.make().dispatch()]);
  assert.equal(f.calls.length, 2);
  await f.make().enqueueInvitation(1, true); await f.make().dispatch();
  assert.equal(f.calls.length, 2);
});

test('Resend retries identical payload and idempotency key after uncertain failure, never revoking admission', async t => {
  const f = await fixture(t);
  await f.approve(1, false); f.verified(1); await f.store.enqueueInvitation(1, false);
  f.respond(() => { throw new Error('provider secret and private@example.com'); });
  assert.deepEqual(await f.store.dispatch(), { sent: 0, failed: 0, deferred: 1, uncertain: 0 });
  f.advance(60_000);
  f.respond(() => Response.json({ id: 'success' }));
  await f.make().dispatch();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, 'https://api.resend.com/emails');
  assert.equal(f.calls[0].body.reply_to, 'support@fxaeon.com');
  assert.equal(f.calls[0].init.body, f.calls[1].init.body);
  assert.equal((f.calls[0].init.headers as any)['Idempotency-Key'], (f.calls[1].init.headers as any)['Idempotency-Key']);
  assert.equal((await f.admission.status(1))!.state, 'approved');
});

test('template staging preserves the legacy Resend payload for verification and invitation retries', async t => {
  for (const kind of ['verification', 'invitation'] as const) {
    const f = await fixture(t);
    if (kind === 'verification') {
      await f.admission.join(1, false); await f.store.setContact(1, 'person@example.com');
    } else {
      await f.approve(1, false); f.verified(1); await f.store.enqueueInvitation(1, false);
    }
    f.respond(() => new Response(null, { status: 503 }));
    await f.store.dispatch();
    const first = f.calls[0];
    const expectedText = kind === 'verification'
      ? `Confirm your email address for FxAeon invitations.\n\nhttps://fxaeon.com/invite#token=${token(first)}\n\nOpen the link and select Confirm email to complete verification. This link expires in one hour. Opening it alone does not confirm your email. If you did not request this, ignore this email.`
      : `${INVITATION_TEXT}\n\n${ENV.TELEGRAM_MINIAPP_URL}`;
    assert.deepEqual(first.body, { from: ENV.RESEND_FROM, to: [kind === 'verification' ? 'person@example.com' : 'person1@example.com'],
      reply_to: 'support@fxaeon.com', subject: kind === 'verification' ? 'Confirm your FxAeon email address' : 'Your FxAeon invitation is ready', text: expectedText });
    f.advance(60_000);
    f.respond(() => Response.json({ id: 'accepted' }));
    await f.make().dispatch();
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].init.body, first.init.body);
    assert.equal(new Headers(f.calls[1].init.headers).get('Idempotency-Key'), new Headers(first.init.headers).get('Idempotency-Key'));
  }
});

test('Resend stops after three attempts and never retries past provider idempotency retention', async t => {
  const f = await fixture(t);
  await f.approve(1, false); f.verified(1); await f.store.enqueueInvitation(1, false);
  f.respond(() => new Response('private provider error', { status: 503 }));
  for (let i = 0; i < 5; i++) { await f.store.dispatch(); f.advance(240_000); }
  assert.equal(f.calls.length, 3);
  assert.equal(f.rows()[0].status, 'uncertain');
  await f.approve(2, false); f.verified(2); await f.store.enqueueInvitation(2, false); await f.store.dispatch();
  f.advance(23 * 3_600_000);
  await f.store.dispatch();
  assert.equal(f.calls.length, 4);
  assert.equal(f.rows()[1].status, 'uncertain');
});

test('uncertain Telegram network, 5xx, malformed and oversized responses never auto-retry', async t => {
  for (const response of [() => { throw new Error('secret'); }, () => new Response('failure', { status: 503 }),
    () => new Response('not json'), () => new Response('x'.repeat(16_385))]) {
    const f = await fixture(t);
    await f.approve(); await f.store.enqueueInvitation(1, true); f.respond(response);
    assert.equal((await f.store.dispatch()).uncertain, 1);
    f.advance(24 * 3_600_000); await f.make().dispatch();
    assert.equal(f.calls.length, 1);
    assert.equal((await f.admission.status(1))!.state, 'approved');
  }
});

test('timeouts cover both fetch and a stalled response body', async t => {
  for (const response of [() => new Promise<Response>(() => {}), () => new Response(new ReadableStream({ start() {} }))]) {
    const f = await fixture(t, {}, 10);
    await f.approve(); await f.store.enqueueInvitation(1, true); f.respond(response);
    assert.equal((await f.store.dispatch()).uncertain, 1);
    assert.equal(f.calls[0].init.signal!.aborted, true);
  }
});

test('explicit Telegram rate limit is retryable and pauses the entire provider', async t => {
  const f = await fixture(t);
  for (const id of [1, 2]) { await f.approve(id); await f.store.enqueueInvitation(id, true); }
  f.respond(() => new Response('rate limited', { status: 429, headers: { 'retry-after': '120' } }));
  await f.store.dispatch();
  assert.equal(f.calls.length, 1);
  f.advance(60_000); await f.store.dispatch(); assert.equal(f.calls.length, 1);
  f.advance(60_000); f.respond(() => Response.json({ ok: true, result: { message_id: 2 } }));
  await f.store.dispatch(); assert.equal(f.calls.length, 3);
});

test('permanent provider rejection records failure, returns no provider detail and never changes admission', async t => {
  const f = await fixture(t);
  await f.approve(); f.verified(1); await f.store.enqueueInvitation(1, true);
  f.respond(() => Response.json({ error: 'secret private@example.com' }, { status: 403 }));
  assert.deepEqual(await f.store.dispatch(), { sent: 0, failed: 2, deferred: 0, uncertain: 0 });
  assert.equal(JSON.stringify(f.rows()).includes('secret'), false);
  assert.equal((await f.admission.status(1))!.state, 'approved');
});

test('crash recovery retries email within its retention window, holds Telegram and exhausts attempt caps', async t => {
  const f = await fixture(t);
  await f.approve(); f.verified(1); await f.store.enqueueInvitation(1, true);
  f.db.sql.prepare("UPDATE access_mail_outbox SET status='sending', attempts=1, first_attempt=?,lease_until=?").run(f.now(), f.now() + 60_000);
  await f.make().dispatch(); assert.equal(f.calls.length, 0);
  f.advance(60_000); await f.make().dispatch();
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].url, /resend/);
  assert.equal(f.rows().find(r => r.channel === 'telegram').status, 'uncertain');
});

test('acknowledgement persistence failure leaves a durable lease; Telegram is not sent again', async t => {
  const f = await fixture(t);
  await f.approve(); await f.store.enqueueInvitation(1, true);
  f.respond(() => { f.db.failAt = 0; return Response.json({ ok: true, result: { message_id: 1 } }); });
  await assert.rejects(f.store.dispatch(), { message: 'notification_storage_unavailable' });
  assert.equal(f.rows()[0].status, 'sending');
  f.advance(60_000); await f.make().dispatch();
  assert.equal(f.calls.length, 1); assert.equal(f.rows()[0].status, 'uncertain');
});

test('daily budget preserves five sends of headroom across concurrent dispatchers and resets at UTC midnight', async t => {
  const f = await fixture(t);
  for (let id = 1; id <= 48; id++) { await f.approve(id, false); f.verified(id); await f.store.enqueueInvitation(id, false); }
  await Promise.all([f.store.dispatch(100), f.make().dispatch(100)]);
  assert.equal(f.calls.length, 45);
  assert.equal(f.db.sql.prepare("SELECT used FROM access_mail_budgets WHERE period='day:2026-11-03'").get()!.used, 45);
  await f.approve(49); await f.store.enqueueInvitation(49, true); await f.store.dispatch(1);
  assert.equal(f.calls.at(-1)!.body.chat_id, '49');
  f.advance(24 * 3_600_000); await f.store.dispatch();
  assert.equal(f.calls.filter(c => c.url.includes('resend')).length, 48);
});

test('monthly cap, lower configured provider budget and 429 all prevent further sends', async t => {
  const f = await fixture(t);
  await f.approve(1, false); f.verified(1); await f.store.enqueueInvitation(1, false);
  f.db.sql.prepare('INSERT INTO access_mail_budgets(period,used) VALUES(?,?)').run('month:2026-11', 1450);
  await f.store.dispatch(); assert.equal(f.calls.length, 0);
  const low = await fixture(t, { MAIL_DAILY_LIMIT: 6, MAIL_MONTHLY_LIMIT: 51 });
  for (const id of [1, 2]) { await low.approve(id, false); low.verified(id); await low.store.enqueueInvitation(id, false); }
  await low.store.dispatch(); assert.equal(low.calls.length, 1);
  const rate = await fixture(t);
  for (const id of [1, 2]) { await rate.approve(id, false); rate.verified(id); await rate.store.enqueueInvitation(id, false); }
  rate.respond(() => new Response('', { status: 429, headers: { 'retry-after': '3600' } }));
  await rate.store.dispatch(); assert.equal(rate.calls.length, 1);
  rate.advance(60_000); await rate.make().dispatch(); assert.equal(rate.calls.length, 1);
});

test('expired pending verification and superseded requests do not send', async t => {
  const f = await fixture(t);
  await f.admission.join(1, false);
  await f.store.setContact(1, 'first@example.com');
  await f.store.setContact(1, 'second@example.com');
  f.advance(3_600_000); await f.store.dispatch();
  assert.equal(f.calls.length, 0);
  assert.ok(f.rows().every(r => r.status === 'cancelled'));
});

test('server configuration rejects arbitrary link hosts, redirects and credential path injection', async t => {
  const f = await fixture(t);
  for (const link of ['http://t.me/FxAeonBot/app', 'https://t.me.evil.test/FxAeonBot/app', 'https://evil.test/',
    'https://t.me@evil.test/FxAeonBot/app', 'https://t.me:443/FxAeonBot/app', 'https://t.me/FxAeonBot/app?url=https://evil.test',
    'https://t.me/FxAeonBot/app#evil', 'https://t.me/FxAeonBot/../evil']) {
    assert.throws(() => new NotificationStore(f.db, { ...ENV, TELEGRAM_MINIAPP_URL: link }), { message: 'notification_config_invalid' });
  }
  assert.throws(() => new NotificationStore(f.db, { ...ENV, TELEGRAM_BOT_TOKEN: '123:secret/../redirect' }));
  assert.throws(() => new NotificationStore(f.db, { ...ENV, RESEND_FROM: 'a@example.com\r\nBcc: private@example.com' }));
  assert.throws(() => new NotificationStore(f.db, { ...ENV, MAIL_DAILY_LIMIT: -1 }));
});

test('missing server credentials disable delivery without exposing configuration', async t => {
  const f = await fixture(t, { RESEND_API_KEY: undefined, TELEGRAM_BOT_TOKEN: undefined });
  await f.approve(); f.verified(1);
  await assert.rejects(f.store.setContact(1, 'person@example.com'), { message: 'notification_unavailable' });
  await f.store.enqueueInvitation(1, true); await f.store.dispatch();
  assert.equal(f.rows().length, 0); assert.equal(f.calls.length, 0);
});

test('an expired, unverified contact never receives an approval invitation', async t => {
  const f = await fixture(t);
  await f.approve(1, false);
  await f.store.setContact(1, 'unverified@example.com'); await f.store.dispatch();
  f.advance(3_600_000);
  assert.equal(await f.store.confirmContact(token(f.calls[0])), null);
  await f.store.enqueueInvitation(1, false); await f.store.dispatch();
  assert.equal(f.calls.length, 1);
  assert.equal(f.rows().filter(row => row.kind === 'invitation').length, 0);
  assert.deepEqual(await f.store.contactStatus(1), { verified: false });
});

test('a newly confirmed contact can replace an unattempted invitation but cannot create a second sent invitation', async t => {
  const f = await fixture(t);
  await f.approve(1, false); f.verified(1); await f.store.enqueueInvitation(1, false);
  await f.store.setContact(1, 'replacement@example.com');
  assert.deepEqual(await f.store.contactStatus(1), { verified: false });
  await f.store.dispatch();
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].body.subject, /Confirm/);
  assert.equal(await f.store.confirmContact(token(f.calls[0])), 1);
  await f.store.enqueueInvitation(1, false); await f.store.dispatch();
  assert.deepEqual(f.calls[1].body.to, ['replacement@example.com']);
  await f.store.enqueueInvitation(1, false); await f.store.dispatch();
  assert.equal(f.calls.length, 2);
});

test('verification credential rotation invalidates queued mail without exposing bearer tokens', async t => {
  const f = await fixture(t);
  await f.admission.join(1, false); await f.store.setContact(1, 'person@example.com');
  f.env.RESEND_API_KEY = 're_rotated_fake_key_never_live';
  assert.equal((await f.make().dispatch()).failed, 1);
  assert.equal(f.calls.length, 0);
});

test('provider Retry-After dates and Telegram retry_after body defer sends durably', async t => {
  for (const bodyOnly of [false, true]) {
    const f = await fixture(t);
    await f.approve(); await f.store.enqueueInvitation(1, true);
    f.respond(() => Response.json({ ok: false, parameters: { retry_after: bodyOnly ? 3600 : 0 } }, {
      status: 429, headers: bodyOnly ? {} : { 'retry-after': new Date(f.now() + 3_600_000).toUTCString() },
    }));
    await f.store.dispatch();
    f.advance(120_000); await f.make().dispatch(); assert.equal(f.calls.length, 1);
    f.advance(3_480_000); await f.make().dispatch(); assert.equal(f.calls.length, 2);
  }
});
