/**
 * Telegram Mini App admission in front of the Privy wallet.
 *
 * Privy's free plan covers a limited number of monthly active users, and its
 * allowlist cannot restrict Telegram sign-in. The Mini App therefore asks this
 * route before it loads Privy at all. The route verifies Telegram's Ed25519
 * launch signature using only the bot's public numeric ID (no bot token lives
 * here), admits a permanent first-come cohort up to a configured capacity in
 * D1, and records a waitlist once that cohort is full.
 *
 * It holds no key material, reads no wallet, and makes no outbound request.
 * Admission only decides whether this Mini App loads Privy; it is not a
 * transaction authority.
 */

export interface AdmissionStatement {
  bind(...values: unknown[]): AdmissionStatement;
}

export interface AdmissionResult {
  results?: unknown[];
}

/** The subset of Cloudflare's D1 binding this route uses. */
export interface AdmissionDatabase {
  prepare(query: string): AdmissionStatement;
  /** Runs the statements in order inside one transaction. */
  batch(statements: AdmissionStatement[]): Promise<AdmissionResult[]>;
}

export interface TelegramAdmissionEnv {
  ADMISSION_DB?: AdmissionDatabase;
  /** The numeric bot ID, the part of the bot token before ":". It is public. */
  TELEGRAM_BOT_ID?: string;
  /** Whole number of Telegram users admitted to the Privy wallet. */
  TELEGRAM_ADMISSION_CAPACITY?: string;
}

export interface PagesFunctionContext<Env> {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type PagesFunction<Env> = (
  context: PagesFunctionContext<Env>,
) => Response | Promise<Response>;

/** Telegram's production Ed25519 key for third-party launch data validation. */
export const TELEGRAM_LAUNCH_PUBLIC_KEY_HEX = "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";
/** Below Privy's 500 free monthly active users, with room for team accounts. */
export const DEFAULT_ADMISSION_CAPACITY = 480;
export const MAX_ADMISSION_CAPACITY = 1_000_000;
/** Launch data older than this must come from a fresh Telegram launch. */
export const LAUNCH_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;
export const LAUNCH_DATA_FUTURE_SKEW_SECONDS = 60;
export const MAX_REQUEST_BYTES = 8 * 1024;
export const MAX_LAUNCH_DATA_LENGTH = 4 * 1024;

export type AdmissionIntent = "enter" | "join";
export type AdmissionStatus = "admitted" | "full" | "waitlisted";

type AdmissionFailureCode = "binding_missing" | "binding_invalid" | "launch_rejected"
  | "storage_failed" | "internal_failure";

const LOG_SUPPRESSION_MS = 5_000;
const lastFailureLogAt = new Map<AdmissionFailureCode, number>();

/** Emit only a fixed allowlisted category, at most once per window. */
function logAdmissionFailure(code: AdmissionFailureCode): void {
  const now = Date.now();
  const previous = lastFailureLogAt.get(code);
  if (previous !== undefined && now - previous < LOG_SUPPRESSION_MS) return;
  lastFailureLogAt.set(code, now);
  console.warn(`[telegram-admission] ${code}`);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      // Pages `_headers` rules apply to static assets, not Functions.
      "x-content-type-options": "nosniff",
    },
  });
}

export type LaunchVerification =
  | { ok: true; userId: number; authDate: number }
  | { ok: false; reason: "malformed" | "unsigned" | "forged" | "expired" };

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  const base64 = value.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Verify Telegram Mini App launch data with Telegram's Ed25519 signature.
 *
 * Telegram signs `<bot_id>:WebAppData\n` followed by every received field
 * except `hash` and `signature`, sorted by key as `key=value` lines. The
 * public key option exists only so tests can sign with their own key.
 */
export async function verifyTelegramLaunchData(
  launchData: string,
  botId: string,
  options: { nowSeconds?: number; publicKey?: Uint8Array<ArrayBuffer> } = {},
): Promise<LaunchVerification> {
  if (typeof launchData !== "string" || !launchData || launchData.length > MAX_LAUNCH_DATA_LENGTH) {
    return { ok: false, reason: "malformed" };
  }
  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(launchData)) {
    // A repeated key makes the signed text ambiguous.
    if (!key || fields.has(key)) return { ok: false, reason: "malformed" };
    fields.set(key, value);
  }
  const signatureText = fields.get("signature");
  if (!signatureText) return { ok: false, reason: "unsigned" };
  const signature = base64UrlBytes(signatureText);
  if (!signature || signature.length !== 64) return { ok: false, reason: "forged" };

  const lines = [...fields]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`);
  const signed = new TextEncoder().encode(`${botId}:WebAppData\n${lines.join("\n")}`);
  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      options.publicKey ?? hexBytes(TELEGRAM_LAUNCH_PUBLIC_KEY_HEX),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify({ name: "Ed25519" }, key, signature, signed);
  } catch {
    verified = false;
  }
  if (!verified) return { ok: false, reason: "forged" };

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const authDateText = fields.get("auth_date") ?? "";
  const authDate = /^\d{1,12}$/.test(authDateText) ? Number(authDateText) : NaN;
  if (!Number.isSafeInteger(authDate)) return { ok: false, reason: "malformed" };
  if (authDate > nowSeconds + LAUNCH_DATA_FUTURE_SKEW_SECONDS || nowSeconds - authDate > LAUNCH_DATA_MAX_AGE_SECONDS) {
    return { ok: false, reason: "expired" };
  }

  let user: unknown;
  try {
    user = JSON.parse(fields.get("user") ?? "null");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const id = typeof user === "object" && user !== null ? (user as { id?: unknown }).id : undefined;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: "malformed" };
  return { ok: true, userId: id, authDate };
}

/**
 * Idempotent schema. A one-row counter, kept by triggers, lets the capacity
 * check read one row instead of counting the cohort on every launch.
 */
export const ADMISSION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS telegram_admission (
    telegram_user_id INTEGER PRIMARY KEY,
    admitted_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS telegram_admission_count (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    admitted INTEGER NOT NULL CHECK (admitted >= 0)
  )`,
  `INSERT OR IGNORE INTO telegram_admission_count (id, admitted) VALUES (1, 0)`,
  `CREATE TRIGGER IF NOT EXISTS telegram_admission_added AFTER INSERT ON telegram_admission
  BEGIN UPDATE telegram_admission_count SET admitted = admitted + 1 WHERE id = 1; END`,
  `CREATE TRIGGER IF NOT EXISTS telegram_admission_removed AFTER DELETE ON telegram_admission
  BEGIN UPDATE telegram_admission_count SET admitted = admitted - 1 WHERE id = 1; END`,
  `CREATE TABLE IF NOT EXISTS telegram_waitlist (
    telegram_user_id INTEGER PRIMARY KEY,
    joined_at INTEGER NOT NULL
  )`,
] as const;

// One statement, so D1's single writer applies the capacity check and the
// insert atomically: concurrent launches at the last seat admit exactly one.
const ADMIT = `INSERT INTO telegram_admission (telegram_user_id, admitted_at)
SELECT ?1, ?2 WHERE (SELECT admitted FROM telegram_admission_count WHERE id = 1) < ?3
ON CONFLICT (telegram_user_id) DO NOTHING`;
const READ_ADMISSION = "SELECT admitted_at FROM telegram_admission WHERE telegram_user_id = ?1";
// Joining twice keeps the first place in line.
const JOIN_WAITLIST = `INSERT INTO telegram_waitlist (telegram_user_id, joined_at)
SELECT ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM telegram_admission WHERE telegram_user_id = ?1)
ON CONFLICT (telegram_user_id) DO NOTHING`;
const READ_WAITLIST = "SELECT joined_at FROM telegram_waitlist WHERE telegram_user_id = ?1";

const schemaReady = new WeakMap<AdmissionDatabase, Promise<void>>();

function ensureSchema(db: AdmissionDatabase): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = db.batch(ADMISSION_SCHEMA.map((statement) => db.prepare(statement))).then(() => undefined);
    // A failed attempt must not poison the isolate; the next request retries.
    ready.catch(() => schemaReady.delete(db));
    schemaReady.set(db, ready);
  }
  return ready;
}

function hasRow(result: AdmissionResult | undefined): boolean {
  return Array.isArray(result?.results) && result.results.length > 0;
}

/**
 * Admit the user while the cohort has room; an admitted user stays admitted.
 * "join" also records a full cohort's visitor on the waitlist, once.
 */
export async function admitTelegramUser(
  db: AdmissionDatabase,
  userId: number,
  options: { capacity: number; intent: AdmissionIntent; nowMs?: number },
): Promise<AdmissionStatus> {
  await ensureSchema(db);
  const now = options.nowMs ?? Date.now();
  const statements = [
    db.prepare(ADMIT).bind(userId, now, options.capacity),
    db.prepare(READ_ADMISSION).bind(userId),
    ...(options.intent === "join" ? [db.prepare(JOIN_WAITLIST).bind(userId, now)] : []),
    db.prepare(READ_WAITLIST).bind(userId),
  ];
  const results = await db.batch(statements);
  if (hasRow(results[1])) return "admitted";
  return hasRow(results[results.length - 1]) ? "waitlisted" : "full";
}

/** A missing capacity uses the default; a malformed one is a configuration error. */
export function admissionCapacity(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return DEFAULT_ADMISSION_CAPACITY;
  if (typeof value !== "string" || !/^\d{1,7}$/.test(value.trim())) return null;
  const capacity = Number(value.trim());
  return capacity <= MAX_ADMISSION_CAPACITY ? capacity : null;
}

async function readRequest(request: Request): Promise<{ launchData: string; intent: AdmissionIntent } | null> {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return null;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_REQUEST_BYTES) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { launchData, intent = "enter" } = body as { launchData?: unknown; intent?: unknown };
  if (typeof launchData !== "string" || (intent !== "enter" && intent !== "join")) return null;
  return { launchData, intent };
}

/** Tests sign with their own key; production always uses Telegram's. */
export function createTelegramAdmissionHandler(
  options: { publicKey?: Uint8Array<ArrayBuffer> } = {},
): PagesFunction<TelegramAdmissionEnv> {
  return async ({ request, env }) => {
  // Browsers send Origin on every POST; a cross-site page cannot use this route.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return jsonResponse({ error: "origin_rejected" }, 403);
  if (new URL(request.url).search) return jsonResponse({ error: "request_invalid" }, 400);

  const db = env?.ADMISSION_DB;
  const botId = typeof env?.TELEGRAM_BOT_ID === "string" ? env.TELEGRAM_BOT_ID.trim() : "";
  const capacity = admissionCapacity(env?.TELEGRAM_ADMISSION_CAPACITY);
  if (!db || !botId) {
    logAdmissionFailure("binding_missing");
    return jsonResponse({ error: "admission_unavailable" }, 503);
  }
  if (!/^\d{1,20}$/.test(botId) || capacity === null || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    logAdmissionFailure("binding_invalid");
    return jsonResponse({ error: "admission_unavailable" }, 503);
  }

  const parsed = await readRequest(request);
  if (!parsed) return jsonResponse({ error: "request_invalid" }, 400);
  const launch = await verifyTelegramLaunchData(parsed.launchData, botId, { publicKey: options.publicKey });
  if (!launch.ok) {
    logAdmissionFailure("launch_rejected");
    return jsonResponse({ error: launch.reason === "expired" ? "launch_expired" : "launch_rejected" }, 403);
  }

  try {
    const status = await admitTelegramUser(db, launch.userId, { capacity, intent: parsed.intent });
    return jsonResponse({ status });
  } catch {
    logAdmissionFailure("storage_failed");
    return jsonResponse({ error: "admission_unavailable" }, 503);
  }
  };
}

export const onRequestPost = createTelegramAdmissionHandler();

export const onRequest: PagesFunction<TelegramAdmissionEnv> = async ({ request, env }) => {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
  // Keep unexpected runtime failures inside the JSON contract; Pages may
  // replace 502/504 bodies with its own error page.
  try {
    return await onRequestPost({ request, env });
  } catch {
    logAdmissionFailure("internal_failure");
    return jsonResponse({ error: "admission_unavailable" }, 503);
  }
};
