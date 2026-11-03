/** Server-only notifications. D1 batch must be atomic; no provider errors escape dispatch.
 * Admission belongs to Store: this module only reads admission_users.
 */
export interface MailResult<T = Record<string, unknown>> { success: boolean; results: T[]; }
export interface MailStatement {
  bind(...values: unknown[]): MailStatement;
  all<T = Record<string, unknown>>(): Promise<MailResult<T>>;
  run<T = Record<string, unknown>>(): Promise<MailResult<T>>;
}
export interface MailDB {
  prepare(sql: string): MailStatement;
  batch<T = Record<string, unknown>>(statements: MailStatement[]): Promise<MailResult<T>[]>;
}
/** Pass Worker server bindings, never browser configuration. Missing credentials disable a channel. */
export interface NotificationEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_MINIAPP_URL?: string;
  MAIL_DAILY_LIMIT?: string | number;
  MAIL_MONTHLY_LIMIT?: string | number;
}
export interface NotificationDiagnostic {
  channel: 'email' | 'telegram'; kind: 'verification' | 'invitation'; attempt: number;
  outcome: Outcome['status']; reason: string; httpStatus?: number;
}
export interface NotificationOptions {
  fetch?: typeof fetch; now?: () => number; timeoutMs?: number;
  onDiagnostic?: (diagnostic: NotificationDiagnostic) => void;
}
export interface VerificationDelivery {
  state: 'not_requested' | 'pending' | 'accepted' | 'failed' | 'uncertain' | 'expired' | 'verified';
  retryAfterMs: number | null;
}
export const INVITATION_TEXT = 'Your FxAeon invitation is ready. Open the miniapp to set up your wallet.';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_ATTEMPTS = 3;
const LEASE = 60_000;
// Stay inside Resend's 24h idempotency retention even after a process crash.
const RETRY_WINDOW = 23 * HOUR;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS access_mail_contacts (
    user_id INTEGER PRIMARY KEY, email TEXT NOT NULL, token_hash TEXT UNIQUE,
    expires_at INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)))`,
  `CREATE TABLE IF NOT EXISTS access_mail_requests (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, email_hash TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS access_mail_requests_user ON access_mail_requests(user_id,created_at)`,
  `CREATE INDEX IF NOT EXISTS access_mail_requests_email ON access_mail_requests(email_hash,created_at)`,
  `CREATE TABLE IF NOT EXISTS access_mail_outbox (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('email','telegram')),
    kind TEXT NOT NULL CHECK(kind IN ('verification','invitation')), destination TEXT NOT NULL,
    sender TEXT NOT NULL, link TEXT NOT NULL, token_hash TEXT, expires_at INTEGER,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','uncertain','cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), created_at INTEGER NOT NULL,
    next_at INTEGER NOT NULL, first_attempt INTEGER, lease_until INTEGER, claim TEXT)`,
  `CREATE INDEX IF NOT EXISTS access_mail_outbox_due ON access_mail_outbox(status,next_at)`,
  `CREATE TABLE IF NOT EXISTS access_mail_budgets (period TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS access_mail_providers (channel TEXT PRIMARY KEY, pause_until INTEGER NOT NULL DEFAULT 0)`,
];
type Envelope = {
  id: string; user_id: number; channel: 'email' | 'telegram'; kind: 'verification' | 'invitation';
  destination: string; sender: string; link: string; token_hash: string | null; expires_at: number | null;
  attempts: number; first_attempt: number; claim: string;
};
type Outcome = { status: 'sent' | 'failed' | 'pending' | 'uncertain'; pause?: number; reason?: string; httpStatus?: number };
export interface DispatchResult { sent: number; failed: number; deferred: number; uncertain: number; }
function identity(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('notification_input_invalid');
}
function emailAddress(value: string): string {
  if (typeof value !== 'string') throw new Error('notification_input_invalid');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)
    || email.split('@')[0].length > 64 || email.split('@')[1].split('.').some(label => label.length > 63)) {
    throw new Error('notification_input_invalid');
  }
  return email;
}
function officialLink(value: string | undefined): string {
  if (!value) return '';
  // Only a configured direct Mini App link. No redirects, credentials, ports or arbitrary query.
  if (!/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}(?:\/[A-Za-z0-9_]{1,64})?(?:\?startapp(?:=[A-Za-z0-9_-]{0,128})?)?$/.test(value)) {
    throw new Error('notification_config_invalid');
  }
  return value;
}
function limit(value: string | number | undefined, cap: number, reserve: number): number {
  const parsed = value === undefined ? cap : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('notification_config_invalid');
  return Math.max(0, Math.min(cap, parsed) - reserve);
}
const bytes = (value: string) => new TextEncoder().encode(value);
const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), n => n.toString(16).padStart(2, '0')).join('');
async function hash(value: string) { return hex(await crypto.subtle.digest('SHA-256', bytes(value))); }

export class NotificationStore {
  private readonly env: NotificationEnv;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly timeout: number;
  private readonly link: string;
  private readonly sender: string;
  private readonly daily: number;
  private readonly monthly: number;
  private readonly diagnose: (diagnostic: NotificationDiagnostic) => void;
  constructor(private readonly db: MailDB, env: NotificationEnv = {}, options: NotificationOptions = {}) {
    this.env = { ...env };
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.diagnose = options.onDiagnostic ?? (diagnostic => console.warn('notification_delivery', diagnostic));
    this.now = options.now ?? Date.now;
    this.timeout = options.timeoutMs ?? 8000;
    if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 15_000) throw new Error('notification_config_invalid');
    this.link = officialLink(env.TELEGRAM_MINIAPP_URL);
    this.sender = env.RESEND_FROM ?? '';
    if (this.sender) {
      const address = /^(?:[^<>\r\n]{1,80} <([^<>]+)>|([^<>]+))$/.exec(this.sender);
      if (!address) throw new Error('notification_config_invalid');
      try { emailAddress(address[1] ?? address[2]); } catch { throw new Error('notification_config_invalid'); }
    }
    if (env.TELEGRAM_BOT_TOKEN && !/^\d+:[A-Za-z0-9_-]{20,}$/.test(env.TELEGRAM_BOT_TOKEN)) throw new Error('notification_config_invalid');
    if (env.RESEND_API_KEY && !/^[A-Za-z0-9_-]{10,256}$/.test(env.RESEND_API_KEY)) throw new Error('notification_config_invalid');
    // Hard application caps 50/day and 1500/month; leave 5/day and 50/month unused.
    this.daily = limit(env.MAIL_DAILY_LIMIT, 50, 5);
    this.monthly = limit(env.MAIL_MONTHLY_LIMIT, 1500, 50);
  }
  private statement(sql: string, ...values: unknown[]) { return this.db.prepare(sql).bind(...values); }
  private async all<T>(sql: string, ...values: unknown[]): Promise<T[]> {
    try {
      const result = await this.statement(sql, ...values).all<T>();
      if (!result.success) throw new Error();
      return result.results;
    } catch { throw new Error('notification_storage_unavailable'); }
  }
  private async batch(statements: MailStatement[]) {
    try {
      const results = await this.db.batch(statements);
      if (results.length !== statements.length || results.some(result => !result.success)) throw new Error();
      return results;
    } catch { throw new Error('notification_storage_unavailable'); }
  }
  async init(): Promise<void> { await this.batch(SCHEMA.map(sql => this.db.prepare(sql))); }
  private enabled(channel: 'email' | 'telegram') {
    return channel === 'email' ? !!(this.env.RESEND_API_KEY && this.sender) : !!(this.env.TELEGRAM_BOT_TOKEN && this.link);
  }
  /** Derivation permits durable delivery without persisting a bearer token in the outbox.
   * Only the hash and random request ID are stored; the server credential is the HMAC key.
   * Rotation safely invalidates queued verification mail (request verification again).
   */
  private async token(id: string) {
    const key = await crypto.subtle.importKey('raw', bytes(this.env.RESEND_API_KEY!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await crypto.subtle.sign('HMAC', key, bytes(`fxaeon-contact-v1:${id}`)));
  }
  /** Authenticated Telegram identity only. Success means durably queued, not delivered.
   * Throws notification_unavailable / notification_rate_limited without identifying the limit.
   * Never return addresses, tokens, or provider details.
   */
  async setContact(userId: number, value: string): Promise<{ status: 'verification_requested' }> {
    identity(userId);
    const email = emailAddress(value);
    const response = { status: 'verification_requested' } as const;
    if (!this.enabled('email')) throw new Error('notification_unavailable');
    const now = this.now();
    const id = crypto.randomUUID();
    const digest = await hash(await this.token(id));
    const emailHash = await hash(email);
    const results = await this.batch([
      this.statement(`INSERT INTO access_mail_requests(id,user_id,email_hash,created_at)
        SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM admission_users WHERE user_id = ?)
        AND (SELECT count(*) FROM access_mail_requests WHERE user_id = ? AND created_at > ?) < 3
        AND (SELECT count(*) FROM access_mail_requests WHERE email_hash = ? AND created_at > ?) < 3 RETURNING id`,
      id, userId, emailHash, now, userId, userId, now - DAY, emailHash, now - DAY),
      this.statement(`INSERT INTO access_mail_contacts(user_id,email,token_hash,expires_at,verified)
        SELECT ?,?,?,?,0 WHERE EXISTS(SELECT 1 FROM access_mail_requests WHERE id = ?)
        ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,token_hash=excluded.token_hash,expires_at=excluded.expires_at,verified=0`,
      userId, email, digest, now + HOUR, id),
      this.statement(`UPDATE access_mail_outbox SET status='cancelled' WHERE user_id=? AND kind='verification' AND status='pending'
        AND EXISTS(SELECT 1 FROM access_mail_requests WHERE id=?)`, userId, id),
      this.statement(`INSERT INTO access_mail_outbox(id,user_id,channel,kind,destination,sender,link,token_hash,expires_at,created_at,next_at)
        SELECT ?,?,'email','verification',?,?,'',?,?,?,? WHERE EXISTS(SELECT 1 FROM access_mail_requests WHERE id=?)`,
      id, userId, email, this.sender, digest, now + HOUR, now, now, id),
    ]);
    if (results[0].results.length === 0) throw new Error('notification_rate_limited');
    return response;
  }
  /** Safe for the authenticated status handler: contains no contact address or token. */
  async contactStatus(userId: number): Promise<{ verified: boolean }> {
    identity(userId);
    const rows = await this.all<{ verified: number }>('SELECT verified FROM access_mail_contacts WHERE user_id=?', userId);
    return { verified: rows[0]?.verified === 1 };
  }
  /** Authenticated user only. Provider acceptance is not proof of inbox delivery. */
  async verificationStatus(userId: number): Promise<VerificationDelivery> {
    identity(userId);
    const rows = await this.all<{ verified: number; expires_at: number; status: string | null;
      next_at: number | null; lease_until: number | null; pause_until: number | null }>(`
      SELECT c.verified,c.expires_at,o.status,o.next_at,o.lease_until,p.pause_until
      FROM access_mail_contacts c LEFT JOIN access_mail_outbox o
        ON o.user_id=c.user_id AND o.token_hash=c.token_hash AND o.kind='verification'
      LEFT JOIN access_mail_providers p ON p.channel='email' WHERE c.user_id=?`, userId);
    const row = rows[0];
    if (!row) return { state: 'not_requested', retryAfterMs: null };
    if (row.verified === 1) return { state: 'verified', retryAfterMs: null };
    const now = this.now();
    if (row.expires_at <= now || row.status === 'cancelled') return { state: 'expired', retryAfterMs: 0 };
    if (row.status === 'sent') return { state: 'accepted', retryAfterMs: null };
    if (row.status === 'failed' || row.status === 'uncertain') return { state: row.status, retryAfterMs: 0 };
    return { state: 'pending', retryAfterMs: Math.max(0, Math.min(DAY,
      Math.max(row.status === 'sending' ? row.lease_until ?? now : row.next_at ?? now, row.pause_until ?? now) - now)) };
  }
  /** Explicit retry only; never reset attempts/idempotency for still-pending mail. */
  async retryVerification(userId: number): Promise<void> {
    const delivery = await this.verificationStatus(userId);
    if (delivery.state === 'not_requested') throw new Error('notification_unavailable');
    if (!['failed', 'uncertain', 'expired'].includes(delivery.state)) return;
    const rows = await this.all<{ email: string }>('SELECT email FROM access_mail_contacts WHERE user_id=? AND verified=0', userId);
    if (rows[0]) await this.setContact(userId, rows[0].email);
  }
  /** Call ONLY after an explicit confirmation POST. GET /invite merely displays a confirmation UI.
   * The fragment keeps the token out of HTTP access logs and link-preview requests.
   */
  async confirmContact(token: string): Promise<number | null> {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const rows = await this.all<{ user_id: number }>(`UPDATE access_mail_contacts SET verified=1,token_hash=NULL
      WHERE token_hash=? AND verified=0 AND expires_at>? RETURNING user_id`, await hash(token), this.now());
    return rows[0]?.user_id ?? null;
  }
  /** Reads the actual durable approval, never trusts a caller-supplied boolean as approval. */
  async enqueueInvitation(userId: number, telegramAllowed: boolean): Promise<void> {
    identity(userId);
    if (typeof telegramAllowed !== 'boolean') throw new Error('notification_input_invalid');
    const now = this.now();
    const statements: MailStatement[] = [];
    if (telegramAllowed && this.enabled('telegram')) statements.push(this.statement(`INSERT INTO access_mail_outbox
      (id,user_id,channel,kind,destination,sender,link,created_at,next_at)
      SELECT 'invite:telegram:'||user_id,user_id,'telegram','invitation',CAST(user_id AS TEXT),'',?,?,?
      FROM admission_users WHERE user_id=? AND external_id IS NOT NULL AND telegram_notify=1
      ON CONFLICT(id) DO NOTHING`, this.link, now, now, userId));
    if (this.enabled('email') && this.link) statements.push(this.statement(`INSERT INTO access_mail_outbox
      (id,user_id,channel,kind,destination,sender,link,created_at,next_at)
      SELECT 'invite:email:'||u.user_id,u.user_id,'email','invitation',c.email,?,?,?,?
      FROM admission_users u JOIN access_mail_contacts c ON c.user_id=u.user_id
      WHERE u.user_id=? AND u.external_id IS NOT NULL AND c.verified=1 ON CONFLICT(id) DO UPDATE SET
        destination=excluded.destination,sender=excluded.sender,link=excluded.link
        WHERE access_mail_outbox.status='pending' AND access_mail_outbox.attempts=0`,
    this.sender, this.link, now, now, userId));
    if (statements.length) await this.batch(statements);
  }
  private async claim(id: string): Promise<Envelope | null> {
    const now = this.now();
    const day = `day:${new Date(now).toISOString().slice(0, 10)}`;
    const month = `month:${new Date(now).toISOString().slice(0, 7)}`;
    const claim = crypto.randomUUID();
    const results = await this.batch([
      this.statement('INSERT INTO access_mail_budgets(period) VALUES(?),(?) ON CONFLICT(period) DO NOTHING', day, month),
      this.statement(`UPDATE access_mail_outbox SET status='sending',attempts=attempts+1,
        first_attempt=coalesce(first_attempt,?),lease_until=?,claim=?
        WHERE id=? AND status='pending' AND next_at<=? AND attempts<3
        AND (first_attempt IS NULL OR first_attempt>?)
        AND NOT EXISTS(SELECT 1 FROM access_mail_providers p WHERE p.channel=access_mail_outbox.channel AND p.pause_until>?)
        AND (channel='telegram' OR ((SELECT used FROM access_mail_budgets WHERE period=?)<?
          AND (SELECT used FROM access_mail_budgets WHERE period=?)<?))
        AND ((kind='verification' AND expires_at>? AND EXISTS(SELECT 1 FROM access_mail_contacts c
          WHERE c.user_id=access_mail_outbox.user_id AND c.token_hash=access_mail_outbox.token_hash AND c.verified=0))
          OR (kind='invitation' AND EXISTS(SELECT 1 FROM admission_users u WHERE u.user_id=access_mail_outbox.user_id
            AND u.external_id IS NOT NULL AND ((channel='telegram' AND u.telegram_notify=1)
            OR (channel='email' AND EXISTS(SELECT 1 FROM access_mail_contacts c WHERE c.user_id=u.user_id
              AND c.verified=1 AND c.email=access_mail_outbox.destination)))))) RETURNING *`,
      now, now + LEASE, claim, id, now, now - RETRY_WINDOW, now, day, this.daily, month, this.monthly, now),
      this.statement(`UPDATE access_mail_budgets SET used=used+1 WHERE period IN (?,?)
        AND EXISTS(SELECT 1 FROM access_mail_outbox WHERE id=? AND claim=? AND channel='email')`, day, month, id, claim),
    ]);
    return results[1].results[0] as Envelope | undefined ?? null;
  }
  private async send(row: Envelope): Promise<Outcome> {
    let payload: object;
    let endpoint: string;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (row.channel === 'email') {
      let text = `${INVITATION_TEXT}\n\n${row.link}`;
      if (row.kind === 'verification') {
        const token = await this.token(row.id);
        if (await hash(token) !== row.token_hash) return { status: 'failed', reason: 'verification_token_invalid' };
        text = `Confirm your email address for FxAeon invitations.\n\nhttps://fxaeon.com/invite#token=${token}\n\nOpen the link and select Confirm email to complete verification. This link expires in one hour. Opening it alone does not confirm your email. If you did not request this, ignore this email.`;
      }
      endpoint = 'https://api.resend.com/emails';
      headers.authorization = `Bearer ${this.env.RESEND_API_KEY}`;
      headers['Idempotency-Key'] = `access-mail/${row.id}`;
      payload = { from: row.sender, to: [row.destination], reply_to: 'support@fxaeon.com', subject: row.kind === 'verification' ? 'Confirm your FxAeon email address' : 'Your FxAeon invitation is ready', text };
    } else {
      endpoint = `https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      payload = { chat_id: row.destination, text: INVITATION_TEXT, link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: [[{ text: 'Open FxAeon', url: row.link }]] } };
    }
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const uncertain = { status: row.channel === 'email' ? 'pending' : 'uncertain' } as Outcome;
    const deadline = new Promise<Outcome>(resolve => {
      timer = setTimeout(() => {
        controller.abort();
        if (reader) void reader.cancel().catch(() => {});
        resolve({ ...uncertain, reason: 'timeout' });
      }, this.timeout);
    });
    const readResponse = async (response: Response): Promise<Record<string, unknown>> => {
      if (!response.body) throw new Error();
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let text = ''; let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 16_384) { void reader.cancel().catch(() => {}); throw new Error(); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      const data: unknown = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      return data as Record<string, unknown>;
    };
    const request = async (): Promise<Outcome> => {
      let httpStatus: number | undefined;
      try {
        const body = JSON.stringify(payload);
        if (bytes(body).length > 8192) return { status: 'failed', reason: 'payload_too_large' };
        // Workers' native fetch rejects a class instance as its `this` receiver.
        const fetcher = this.fetcher;
        const response = await fetcher(endpoint, { method: 'POST', headers, body, redirect: 'manual', signal: controller.signal });
        httpStatus = response.status;
        if (response.redirected || (response.status >= 300 && response.status < 400)) {
          if (response.body) void response.body.cancel().catch(() => {});
          return { ...uncertain, reason: 'redirect', httpStatus };
        }
        if (response.status === 429) {
          // Respect provider quota/rate limits even if their error body is malformed.
          const header = response.headers.get('retry-after') ?? '';
          const retry = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - this.now();
          let delay = Number.isFinite(retry) ? retry : 60_000;
          try {
            const data = await readResponse(response);
            if (row.channel === 'telegram' && data.parameters && typeof data.parameters === 'object') {
              const seconds = (data.parameters as Record<string, unknown>).retry_after;
              if (typeof seconds === 'number' && Number.isFinite(seconds)) delay = Math.max(delay, seconds * 1000);
            }
          } catch { /* The HTTP status still establishes an explicit rejection. */ }
          const pause = this.now() + Math.min(DAY, Math.max(60_000, delay));
          return { status: 'pending', pause, reason: 'provider_rate_limited', httpStatus };
        }
        if (response.status >= 400 && response.status < 500) {
          if (response.body) void response.body.cancel().catch(() => {});
          return { status: 'failed', reason: 'provider_rejected', httpStatus };
        }
        if (!response.ok || !response.body) {
          if (response.body) void response.body.cancel().catch(() => {});
          return { ...uncertain, reason: 'provider_unavailable', httpStatus };
        }
        const result = await readResponse(response);
        if (row.channel === 'email') return typeof result.id === 'string' && result.id ? { status: 'sent' }
          : { ...uncertain, reason: 'invalid_response', httpStatus };
        if (result.ok === true && result.result && typeof result.result === 'object'
          && Number.isSafeInteger((result.result as Record<string, unknown>).message_id)) return { status: 'sent' };
        return result.ok === false && typeof result.error_code === 'number' && result.error_code >= 400 && result.error_code < 500
          ? { status: 'failed', reason: 'provider_rejected', httpStatus }
          : { ...uncertain, reason: 'invalid_response', httpStatus };
      } catch { return { ...uncertain, reason: httpStatus === undefined ? 'transport_exception' : 'invalid_response', httpStatus }; }
    };
    try { return await Promise.race([request(), deadline]); }
    finally { clearTimeout(timer); controller.abort(); if (reader) void reader.cancel().catch(() => {}); }
  }
  /** Run from a scheduled/server task. No raw recipients, credentials or provider responses leave this API. */
  async dispatch(limit = 10): Promise<DispatchResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('notification_input_invalid');
    const now = this.now();
    await this.batch([
      this.statement(`UPDATE access_mail_outbox SET status=CASE WHEN channel='telegram' OR attempts>=3 OR first_attempt<=?
        THEN 'uncertain' ELSE 'pending' END WHERE status='sending' AND lease_until<=?`, now - RETRY_WINDOW, now),
      this.statement(`UPDATE access_mail_outbox SET status='uncertain' WHERE status='pending' AND first_attempt<=?`, now - RETRY_WINDOW),
      this.statement(`UPDATE access_mail_outbox SET status='cancelled' WHERE status='pending' AND kind='verification' AND expires_at<=?`, now),
    ]);
    // Filter ineligible rows before LIMIT so an exhausted email budget or a withdrawn
    // contact cannot starve Telegram work. claim() repeats all checks atomically.
    const day = `day:${new Date(now).toISOString().slice(0, 10)}`;
    const month = `month:${new Date(now).toISOString().slice(0, 7)}`;
    const candidates = await this.all<{ id: string; channel: 'email' | 'telegram' }>(`SELECT id,channel FROM access_mail_outbox o
      WHERE status='pending' AND next_at<=? AND attempts<3
      AND NOT EXISTS(SELECT 1 FROM access_mail_providers p WHERE p.channel=o.channel AND p.pause_until>?)
      AND ((channel='telegram' AND ?=1) OR (channel='email' AND ?=1
        AND coalesce((SELECT used FROM access_mail_budgets WHERE period=?),0)<?
        AND coalesce((SELECT used FROM access_mail_budgets WHERE period=?),0)<?))
      AND ((kind='verification' AND EXISTS(SELECT 1 FROM access_mail_contacts c WHERE c.user_id=o.user_id AND c.token_hash=o.token_hash AND c.verified=0))
        OR (kind='invitation' AND EXISTS(SELECT 1 FROM admission_users u WHERE u.user_id=o.user_id AND u.external_id IS NOT NULL
          AND ((channel='telegram' AND u.telegram_notify=1) OR (channel='email' AND EXISTS(SELECT 1 FROM access_mail_contacts c
            WHERE c.user_id=u.user_id AND c.verified=1 AND c.email=o.destination))))))
      ORDER BY created_at,id LIMIT ?`, now, now, +this.enabled('telegram'), +this.enabled('email'), day, this.daily, month, this.monthly, limit);
    const counts: DispatchResult = { sent: 0, failed: 0, deferred: 0, uncertain: 0 };
    for (const candidate of candidates) {
      if (!this.enabled(candidate.channel)) { counts.deferred++; continue; }
      const row = await this.claim(candidate.id);
      if (!row) { counts.deferred++; continue; }
      let outcome: Outcome;
      try { outcome = await this.send(row); } catch { outcome = { status: row.channel === 'email' ? 'pending' : 'uncertain', reason: 'send_exception' }; }
      if (outcome.status === 'pending' && row.attempts >= MAX_ATTEMPTS) outcome.status = 'uncertain';
      if (outcome.reason) {
        try { this.diagnose({ channel: row.channel, kind: row.kind, attempt: row.attempts, outcome: outcome.status,
          reason: outcome.reason, ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }) }); }
        catch { /* Diagnostics cannot alter delivery/retry state. */ }
      }
      const next = Math.max(this.now() + 60_000 * 2 ** (row.attempts - 1), outcome.pause ?? 0);
      const updates = [this.statement(`UPDATE access_mail_outbox SET status=?,next_at=?,lease_until=NULL
        WHERE id=? AND status='sending' AND claim=?`, outcome.status, next, row.id, row.claim)];
      if (outcome.pause) updates.push(this.statement(`INSERT INTO access_mail_providers(channel,pause_until) VALUES(?,?)
        ON CONFLICT(channel) DO UPDATE SET pause_until=max(pause_until,excluded.pause_until)`, row.channel, outcome.pause));
      // Failure to persist an acknowledgement must never cause a blind Telegram retry.
      await this.batch(updates);
      counts[outcome.status === 'pending' ? 'deferred' : outcome.status]++;
    }
    return counts;
  }
}
