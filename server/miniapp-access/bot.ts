import type { DB } from './store';
import { AccessError, json, readJson } from './http';

export const TELEGRAM_WEBHOOK_URL = 'https://fxaeon.com/api/telegram-bot';
const DAY = 86_400_000;
const SECRET_DOMAIN = 'fxaeon:telegram-webhook:v1\0';
export interface BotEnv { ADMISSION_DB?: DB; TELEGRAM_BOT_TOKEN?: string; }
interface Options { fetch?: typeof fetch; now?: () => number; sendTimeoutMs?: number; }
type Command = 'start' | 'help' | 'support';
const TEXT: Record<Command, string> = {
  start: 'Welcome to FxAeon. Open the app to join the waitlist or continue.',
  help: 'Open FxAeon below. Guides: https://fxaeon.com/docs\nFor feedback or a problem, use /support.',
  support: 'Send feedback or report a problem: support@fxaeon.com\nNever share your recovery phrase or private keys.',
};

/** Same domain-separated SHA-256 derivation as deployment sync; no extra secret. */
export async function telegramWebhookSecret(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SECRET_DOMAIN + token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function secretMatches(actual: string | null, expected: string): boolean {
  if (!actual || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function command(update: Record<string, unknown>, now: number): { id: number; chat: number; command: Command } | null {
  if (typeof update.update_id !== 'number' || !Number.isSafeInteger(update.update_id) || update.update_id < 0) return null;
  const message = record(update.message), chat = record(message.chat), from = record(message.from);
  if (chat.type !== 'private' || !positiveId(chat.id) || !positiveId(from.id) || from.id !== chat.id || from.is_bot !== false
    || message.forward_origin || message.sender_chat || message.via_bot || message.business_connection_id) return null;
  // Telegram keeps updates for 24h. Reject old replays even after dedup rows expire.
  if (!positiveId(message.date) || message.date * 1000 < now - DAY || message.date * 1000 > now + 60_000) return null;
  if (typeof message.text !== 'string' || message.text.length > 80 || !Array.isArray(message.entities) || message.entities.length !== 1) return null;
  const entity = record(message.entities[0]);
  const match = /^\/(start|help|support)(?: ([A-Za-z0-9_-]{1,64}))?$/.exec(message.text);
  if (!match || (match[2] && match[1] !== 'start') || entity.type !== 'bot_command' || entity.offset !== 0 || entity.length !== match[1].length + 1) return null;
  // The optional start payload is deliberately neither used nor stored.
  return { id: update.update_id, chat: chat.id, command: match[1] as Command };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS telegram_bot_updates (
    update_id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, received_at INTEGER NOT NULL,
    claim TEXT NOT NULL, attempted INTEGER NOT NULL DEFAULT 0 CHECK(attempted IN (0,1)))`,
  `CREATE INDEX IF NOT EXISTS telegram_bot_updates_chat ON telegram_bot_updates(chat_id,attempted,received_at)`,
  `CREATE INDEX IF NOT EXISTS telegram_bot_updates_age ON telegram_bot_updates(received_at)`,
];
const initialized = new WeakMap<DB, Promise<void>>();
async function initialize(db: DB) {
  let ready = initialized.get(db);
  if (!ready) {
    ready = (async () => {
      const results = await db.batch(SCHEMA.map(sql => db.prepare(sql)));
      if (results.length !== SCHEMA.length || results.some(result => !result.success)) throw new Error('bot_storage_unavailable');
    })();
    initialized.set(db, ready);
  }
  try { await ready; } catch { initialized.delete(db); throw new Error('bot_storage_unavailable'); }
}
async function claimReply(db: DB, update: { id: number; chat: number }, now: number): Promise<boolean> {
  await initialize(db);
  const claim = crypto.randomUUID();
  // D1 batch is atomic: dedup, sliding rate limits, and attempt reservation commit together.
  const results = await db.batch<{ attempted: number }>([
    db.prepare('DELETE FROM telegram_bot_updates WHERE received_at < ?').bind(now - 2 * DAY),
    db.prepare('INSERT OR IGNORE INTO telegram_bot_updates (update_id,chat_id,received_at,claim) VALUES (?,?,?,?)').bind(update.id, update.chat, now, claim),
    db.prepare(`UPDATE telegram_bot_updates SET attempted=1 WHERE update_id=? AND claim=?
      AND (SELECT count(*) FROM telegram_bot_updates WHERE chat_id=? AND attempted=1 AND received_at>?) < 3
      AND (SELECT count(*) FROM telegram_bot_updates WHERE chat_id=? AND attempted=1 AND received_at>?) < 20`)
      .bind(update.id, claim, update.chat, now - 60_000, update.chat, now - DAY),
    db.prepare('SELECT attempted FROM telegram_bot_updates WHERE update_id=? AND claim=?').bind(update.id, claim),
  ]);
  if (results.length !== 4 || results.some(result => !result.success)) throw new Error('bot_storage_unavailable');
  return results[3].results[0]?.attempted === 1;
}

/** At most one send attempt. Ambiguous failures are acknowledged, never auto-retried. */
async function reply(token: string, chat: number, selected: Command, options: Options) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const response = await (options.fetch ?? fetch)(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, redirect: 'error',
          body: JSON.stringify({ chat_id: chat, text: TEXT[selected], link_preview_options: { is_disabled: true },
            reply_markup: { inline_keyboard: [[{ text: 'Open FxAeon', web_app: { url: 'https://fxaeon.com/' } }]] } }),
        });
        // Do not buffer or log Telegram response bodies, which can contain message text.
        void response.body?.cancel().catch(() => {});
      })(),
      new Promise<void>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(); }, options.sendTimeoutMs ?? 5000); }),
    ]);
  } catch { /* No raw provider errors, message bodies, or token-bearing URLs escape. */ }
  finally { clearTimeout(timer); controller.abort(); }
}

export function createTelegramBotHandler(options: Options = {}) {
  return async ({ request, env }: { request: Request; env: BotEnv }): Promise<Response> => {
    if (request.url !== TELEGRAM_WEBHOOK_URL) return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!env.ADMISSION_DB || !token || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) return json({ error: 'bot_unavailable' }, 503);
    try {
      if (!secretMatches(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), await telegramWebhookSecret(token))) return json({ error: 'unauthorized' }, 401);
      const update = await readJson(request, 16_384);
      const now = (options.now ?? Date.now)();
      if (!Number.isSafeInteger(now) || now <= 0) return json({ error: 'bot_unavailable' }, 503);
      const selected = command(update, now);
      if (selected && await claimReply(env.ADMISSION_DB, selected, now)) await reply(token, selected.chat, selected.command, options);
      return json({ ok: true });
    } catch (error) {
      return json({ error: error instanceof AccessError ? 'request_invalid' : 'bot_unavailable' }, error instanceof AccessError ? 400 : 503);
    }
  };
}
