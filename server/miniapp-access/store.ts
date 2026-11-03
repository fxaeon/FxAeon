/** The subset of Cloudflare D1 used here. batch MUST be an atomic transaction. */
export interface DBResult<T = Record<string, unknown>> {
  success: boolean;
  results: T[];
  error?: string;
  meta?: { changes?: number; [key: string]: unknown };
}
export interface DBStatement {
  bind(...values: unknown[]): DBStatement;
  all<T = Record<string, unknown>>(): Promise<DBResult<T>>;
  run<T = Record<string, unknown>>(): Promise<DBResult<T>>;
}
export interface DB {
  prepare(sql: string): DBStatement;
  batch<T = Record<string, unknown>>(statements: DBStatement[]): Promise<DBResult<T>[]>;
}
export const MAX_SEATS = 480;
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const CHALLENGE_WINDOW_MS = 60_000;
export const CHALLENGE_RATE_LIMIT = 5;
export type ChallengeKind = 'register' | 'sign';
export interface Credential {
  credentialID: string;
  /** COSE public key encoded as unpadded base64url. */
  publicKey: string;
  counter: number;
  /** DER SPKI encoded as standard base64. */
  ownerSPKI: string;
  /** Enrollment-time backup evidence; BS can change later without changing ownership. */
  backedUp: boolean;
}
export interface Enrollment {
  userId: number;
  joinedAt: number;
  state: 'waiting' | 'approved' | 'ready';
  telegramNotify: boolean;
  externalId: string | null;
  credential: Credential | null;
  walletId: string | null;
  walletAddress: string | null;
}
export interface Challenge {
  id: string;
  challenge: string;
  userId: number;
  kind: ChallengeKind;
  payload: unknown;
  expiresAt: number;
}
/** Only pass this after checking the provider response against this user's owner. */
export interface VerifiedWallet { id: string; address: string; verified: true }
export interface Invitation {
  userId: number;
  channel: 'telegram';
  destination: string;
}
export interface Handoff { userId: number; challenge: Challenge }
export interface HandoffResult { status: 'done' | 'error'; result: unknown }
export interface HandoffStatus { status: 'pending' | 'done' | 'error'; result: unknown }
export interface Capacity { used: number; legacy: number; max: 480 }

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admission_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    legacy_slots INTEGER NOT NULL CHECK(legacy_slots BETWEEN 0 AND 480)
  )`,
  `CREATE TABLE IF NOT EXISTS admission_users (
    user_id INTEGER PRIMARY KEY CHECK(user_id > 0 AND user_id <= 9007199254740991),
    joined_at INTEGER NOT NULL CHECK(joined_at >= 0),
    telegram_notify INTEGER NOT NULL CHECK(telegram_notify IN (0,1)),
    external_id TEXT UNIQUE,
    credential_id TEXT UNIQUE, public_key TEXT, counter INTEGER, owner_spki TEXT,
    backed_up INTEGER CHECK(backed_up IN (0,1)),
    wallet_id TEXT UNIQUE, wallet_address TEXT UNIQUE,
    CHECK((credential_id IS NULL AND public_key IS NULL AND counter IS NULL AND owner_spki IS NULL AND backed_up IS NULL)
      OR (external_id IS NOT NULL AND credential_id IS NOT NULL AND public_key IS NOT NULL
        AND counter IS NOT NULL AND counter >= 0 AND owner_spki IS NOT NULL AND backed_up IS NOT NULL)),
    CHECK((wallet_id IS NULL AND wallet_address IS NULL) OR
      (credential_id IS NOT NULL AND wallet_id IS NOT NULL AND wallet_address IS NOT NULL))
  )`,
  `CREATE TRIGGER IF NOT EXISTS admission_settings_no_delete BEFORE DELETE ON admission_settings
    BEGIN SELECT RAISE(ABORT, 'legacy baseline is permanent'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_settings_no_replace BEFORE INSERT ON admission_settings
    WHEN EXISTS(SELECT 1 FROM admission_settings)
    BEGIN SELECT RAISE(ABORT, 'legacy baseline is permanent'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_settings_monotonic BEFORE UPDATE ON admission_settings
    WHEN NEW.id != OLD.id OR NEW.legacy_slots < OLD.legacy_slots
      OR NEW.legacy_slots + (SELECT count(*) FROM admission_users WHERE external_id IS NOT NULL) > 480
    BEGIN SELECT RAISE(ABORT, 'invalid legacy baseline or seat limit'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_users_insert BEFORE INSERT ON admission_users
    WHEN EXISTS(SELECT 1 FROM admission_users WHERE user_id = NEW.user_id
      OR external_id = NEW.external_id OR credential_id = NEW.credential_id
      OR wallet_id = NEW.wallet_id OR wallet_address = NEW.wallet_address)
      OR (NEW.external_id IS NOT NULL AND (
        NOT EXISTS(SELECT 1 FROM admission_settings) OR
        (SELECT legacy_slots FROM admission_settings) + (SELECT count(*) FROM admission_users WHERE external_id IS NOT NULL) >= 480))
    BEGIN SELECT RAISE(ABORT, 'existing identity or seat limit'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_seat_limit BEFORE UPDATE OF external_id ON admission_users
    WHEN OLD.external_id IS NULL AND NEW.external_id IS NOT NULL AND (
      NOT EXISTS(SELECT 1 FROM admission_settings) OR
      (SELECT legacy_slots FROM admission_settings) + (SELECT count(*) FROM admission_users WHERE external_id IS NOT NULL) >= 480)
    BEGIN SELECT RAISE(ABORT, 'seat limit'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_identity_immutable BEFORE UPDATE ON admission_users
    WHEN NEW.user_id != OLD.user_id OR NEW.joined_at != OLD.joined_at OR (OLD.external_id IS NOT NULL AND NEW.external_id IS NOT OLD.external_id)
      OR EXISTS(SELECT 1 FROM admission_users WHERE user_id != OLD.user_id AND (
        external_id = NEW.external_id OR credential_id = NEW.credential_id
        OR wallet_id = NEW.wallet_id OR wallet_address = NEW.wallet_address))
      OR (OLD.credential_id IS NOT NULL AND (NEW.credential_id IS NOT OLD.credential_id
        OR NEW.public_key IS NOT OLD.public_key OR NEW.owner_spki IS NOT OLD.owner_spki
        OR NEW.backed_up IS NOT OLD.backed_up OR NEW.counter IS NULL OR NEW.counter < OLD.counter))
      OR (OLD.wallet_id IS NOT NULL AND (NEW.wallet_id IS NOT OLD.wallet_id OR NEW.wallet_address IS NOT OLD.wallet_address))
    BEGIN SELECT RAISE(ABORT, 'immutable enrollment'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_no_recycle BEFORE DELETE ON admission_users
    BEGIN SELECT RAISE(ABORT, 'enrollment is permanent'); END`,
  `CREATE TABLE IF NOT EXISTS admission_challenges (
    id TEXT PRIMARY KEY, challenge TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES admission_users(user_id),
    kind TEXT NOT NULL CHECK(kind IN ('register','sign')), payload TEXT NOT NULL CHECK(json_valid(payload)),
    expires_at INTEGER NOT NULL, UNIQUE(user_id,kind)
  )`,
  `CREATE TABLE IF NOT EXISTS admission_challenge_rates (
    user_id INTEGER NOT NULL REFERENCES admission_users(user_id), kind TEXT NOT NULL CHECK(kind IN ('register','sign')),
    window_start INTEGER NOT NULL, used INTEGER NOT NULL CHECK(used BETWEEN 1 AND 5),
    issue_id TEXT NOT NULL, PRIMARY KEY(user_id,kind)
  )`,
  `CREATE TABLE IF NOT EXISTS admission_wallet_rates (
    user_id INTEGER PRIMARY KEY REFERENCES admission_users(user_id),
    window_start INTEGER NOT NULL, used INTEGER NOT NULL CHECK(used BETWEEN 1 AND 5)
  )`,
  `CREATE TABLE IF NOT EXISTS admission_handoffs (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES admission_users(user_id), challenge_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL, claimed INTEGER NOT NULL DEFAULT 0 CHECK(claimed IN (0,1)),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','error')),
    result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
    UNIQUE(user_id,challenge_id),
    CHECK((status = 'pending' AND result_json IS NULL) OR (status != 'pending' AND claimed = 1 AND result_json IS NOT NULL))
  )`,
  `CREATE TABLE IF NOT EXISTS admission_invitations (
    user_id INTEGER NOT NULL REFERENCES admission_users(user_id),
    channel TEXT NOT NULL CHECK(channel = 'telegram'), destination TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0 CHECK(delivered IN (0,1)),
    PRIMARY KEY(user_id,channel), CHECK(destination = CAST(user_id AS TEXT))
  )`,
  `CREATE TRIGGER IF NOT EXISTS admission_invitation_authorized BEFORE INSERT ON admission_invitations
    WHEN NOT EXISTS(SELECT 1 FROM admission_users WHERE user_id = NEW.user_id AND telegram_notify = 1 AND external_id IS NOT NULL)
    BEGIN SELECT RAISE(ABORT, 'unauthorized invitation'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_invitation_destination BEFORE UPDATE ON admission_invitations
    WHEN NEW.user_id != OLD.user_id OR NEW.channel != OLD.channel OR NEW.destination != OLD.destination
    BEGIN SELECT RAISE(ABORT, 'immutable invitation destination'); END`,
];

type UserRow = {
  user_id: number; joined_at: number; telegram_notify: number; external_id: string | null;
  credential_id: string | null; public_key: string | null; counter: number | null;
  owner_spki: string | null; backed_up: number | null;
  wallet_id: string | null; wallet_address: string | null;
};
type ChallengeRow = { id: string; challenge: string; user_id: number; kind: ChallengeKind; payload: string; expires_at: number };
function enrollment(row: UserRow): Enrollment {
  return {
    userId: row.user_id, joinedAt: row.joined_at, telegramNotify: row.telegram_notify === 1, externalId: row.external_id,
    state: row.wallet_id !== null && row.wallet_address !== null ? 'ready' : row.external_id !== null ? 'approved' : 'waiting',
    credential: row.credential_id === null ? null : {
      credentialID: row.credential_id, publicKey: row.public_key!, counter: row.counter!,
      ownerSPKI: row.owner_spki!, backedUp: row.backed_up === 1,
    }, walletId: row.wallet_id, walletAddress: row.wallet_address,
  };
}
function challenge(row: ChallengeRow): Challenge {
  return { id: row.id, challenge: row.challenge, userId: row.user_id, kind: row.kind,
    payload: JSON.parse(row.payload), expiresAt: row.expires_at };
}
function identity(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('invalid Telegram user id');
}
function time(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - CHALLENGE_TTL_MS) throw new Error('invalid time');
}
function kind(value: ChallengeKind): void {
  if (value !== 'register' && value !== 'sign') throw new Error('invalid challenge kind');
}
function checked<T>(result: DBResult<T>): T[] {
  if (!result.success) throw new Error(result.error || 'D1 storage failure');
  return result.results;
}
function text(value: string): boolean { return typeof value === 'string' && value.length > 0 && value.length <= 8192; }
function jsonPayload(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined || new TextEncoder().encode(json).length > 65_536) throw new Error('invalid JSON payload');
  return json;
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function tokenHash(token: string): Promise<string | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export class Store {
  constructor(private readonly db: DB) {}

  private statement(sql: string, ...args: unknown[]): DBStatement { return this.db.prepare(sql).bind(...args); }
  private async batch(statements: DBStatement[]): Promise<DBResult[]> {
    const results = await this.db.batch(statements);
    if (results.length !== statements.length) throw new Error('incomplete D1 batch');
    results.forEach(checked);
    return results;
  }

  /** Repeated initialization can raise the legacy baseline, but can never lower it. */
  async init(legacySlots = 0): Promise<void> {
    if (!Number.isInteger(legacySlots) || legacySlots < 0 || legacySlots > MAX_SEATS) throw new Error('invalid legacy slots');
    await this.batch([
      ...SCHEMA.map(sql => this.db.prepare(sql)),
      this.statement('INSERT INTO admission_settings (id,legacy_slots) SELECT 1,? WHERE NOT EXISTS(SELECT 1 FROM admission_settings)', legacySlots),
      this.statement('UPDATE admission_settings SET legacy_slots = max(legacy_slots,?) WHERE id = 1', legacySlots),
    ]);
  }

  async status(userId: number): Promise<Enrollment | null> {
    identity(userId);
    const rows = checked(await this.statement('SELECT * FROM admission_users WHERE user_id = ?', userId).all<UserRow>());
    return rows[0] ? enrollment(rows[0]) : null;
  }

  private invitation(userId: number): DBStatement {
    return this.statement(`INSERT INTO admission_invitations (user_id,channel,destination)
      SELECT user_id,'telegram',CAST(user_id AS TEXT) FROM admission_users
      WHERE user_id = ? AND telegram_notify = 1 AND external_id IS NOT NULL
      ON CONFLICT(user_id,channel) DO NOTHING`, userId);
  }

  async join(userId: number, telegramNotify: boolean): Promise<Enrollment> {
    identity(userId);
    if (typeof telegramNotify !== 'boolean') throw new Error('invalid notification consent');
    const results = await this.batch([
      this.statement(`INSERT INTO admission_users (user_id,joined_at,telegram_notify)
        SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM admission_users WHERE user_id = ?)`, userId, Date.now(), +telegramNotify, userId),
      this.statement('UPDATE admission_users SET telegram_notify = ? WHERE user_id = ?', +telegramNotify, userId),
      this.invitation(userId),
      this.statement('SELECT * FROM admission_users WHERE user_id = ?', userId),
    ]);
    return enrollment(results[3].results[0] as UserRow);
  }

  /** All requested users must have joined. Overflow rolls back the entire batch. */
  async approve(userIds: number[]): Promise<Enrollment[]> {
    if (!Array.isArray(userIds) || userIds.length > MAX_SEATS) throw new Error('invalid approval batch');
    userIds.forEach(identity);
    const ids = [...new Set(userIds)];
    if (!ids.length) return [];
    const existing = await Promise.all(ids.map(id => this.status(id)));
    if (existing.some(row => row === null)) throw new Error('user must join before approval');
    const statements = ids.flatMap(id => [
      this.statement('UPDATE admission_users SET external_id = ? WHERE user_id = ? AND external_id IS NULL', crypto.randomUUID(), id),
      this.invitation(id),
      this.statement('SELECT * FROM admission_users WHERE user_id = ?', id),
    ]);
    const results = await this.batch(statements);
    return ids.map((_, index) => enrollment(results[index * 3 + 2].results[0] as UserRow));
  }

  async approveMany(userIds: number[]): Promise<Enrollment[]> { return this.approve(userIds); }

  /** First binding wins; an existing credential is never overwritten, even on retry. */
  async bindCredential(userId: number, credential: Credential): Promise<boolean> {
    identity(userId);
    const { credentialID, publicKey, counter, ownerSPKI, backedUp } = credential;
    if (!text(credentialID) || !/^[A-Za-z0-9_-]+$/.test(credentialID)
      || !text(publicKey) || !/^[A-Za-z0-9_-]+$/.test(publicKey)
      || !text(ownerSPKI) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ownerSPKI)
      || !Number.isSafeInteger(counter) || counter < 0 || typeof backedUp !== 'boolean') throw new Error('invalid credential');
    const rows = checked(await this.statement(`UPDATE admission_users SET
      credential_id = ?, public_key = ?, counter = ?, owner_spki = ?, backed_up = ?
      WHERE user_id = ? AND external_id IS NOT NULL AND credential_id IS NULL RETURNING user_id`,
    credentialID, publicKey, counter, ownerSPKI, +backedUp, userId).all());
    return rows.length === 1;
  }

  /** The caller must verify ownership and the provider response before invoking this method. */
  async saveWallet(userId: number, wallet: VerifiedWallet): Promise<boolean> {
    identity(userId);
    if (wallet.verified !== true || !text(wallet.id) || !/^0x[0-9a-fA-F]{40}$/.test(wallet.address)) throw new Error('invalid verified wallet');
    return checked(await this.statement(`UPDATE admission_users SET wallet_id = ?, wallet_address = ?
      WHERE user_id = ? AND credential_id IS NOT NULL AND wallet_id IS NULL RETURNING user_id`,
    wallet.id, wallet.address.toLowerCase(), userId).all()).length === 1;
  }

  /** Reserve before provider I/O. Atomic across isolates and retained across service restarts. */
  async claimProvision(userId: number, now = Date.now()): Promise<boolean> {
    identity(userId); time(now);
    return checked(await this.statement(`INSERT INTO admission_wallet_rates (user_id,window_start,used)
      SELECT user_id,?,1 FROM admission_users WHERE user_id = ? AND external_id IS NOT NULL AND credential_id IS NOT NULL
      ON CONFLICT(user_id) DO UPDATE SET
        window_start = CASE WHEN ? >= window_start + 60000 THEN ? ELSE window_start END,
        used = CASE WHEN ? >= window_start + 60000 THEN 1 ELSE used + 1 END
      WHERE ? >= window_start AND (used < 5 OR ? >= window_start + 60000)
      RETURNING user_id`, now, userId, now, now, now, now, now).all()).length === 1;
  }

  async updateCounter(userId: number, credentialID: string, expectedCounter: number, newCounter: number): Promise<boolean> {
    identity(userId);
    if (!Number.isSafeInteger(expectedCounter) || !Number.isSafeInteger(newCounter)
      || expectedCounter < 0 || newCounter < expectedCounter
      || (newCounter === expectedCounter && newCounter !== 0)) throw new Error('invalid authenticator counter');
    return checked(await this.statement(`UPDATE admission_users SET counter = ?
      WHERE user_id = ? AND credential_id = ? AND counter = ? RETURNING user_id`,
    newCounter, userId, credentialID, expectedCounter).all()).length === 1;
  }

  /** challengeValue, when supplied, must come from trusted server options/the exact provider signing envelope. */
  async issueChallenge(userId: number, action: ChallengeKind, payload: unknown, now = Date.now(), challengeValue?: string): Promise<Challenge> {
    identity(userId); kind(action); time(now);
    const json = jsonPayload(payload);
    const id = crypto.randomUUID();
    const value = challengeValue ?? randomToken();
    if (typeof value !== 'string' || value.length > 40_000 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid challenge value');
    const eligible = action === 'register' ? 'external_id IS NOT NULL AND credential_id IS NULL' : 'wallet_id IS NOT NULL AND wallet_address IS NOT NULL';
    const results = await this.batch([
      this.statement('DELETE FROM admission_challenges WHERE expires_at <= ?', now),
      this.statement(`INSERT INTO admission_challenge_rates (user_id,kind,window_start,used,issue_id)
        SELECT user_id,?,?,1,? FROM admission_users WHERE user_id = ? AND ${eligible}
        ON CONFLICT(user_id,kind) DO UPDATE SET
          window_start = CASE WHEN ? >= window_start + 60000 THEN ? ELSE window_start END,
          used = CASE WHEN ? >= window_start + 60000 THEN 1 ELSE used + 1 END, issue_id = excluded.issue_id
        WHERE ? >= window_start AND (used < 5 OR ? >= window_start + 60000)`,
      action, now, id, userId, now, now, now, now, now),
      this.statement(`INSERT INTO admission_challenges (id,challenge,user_id,kind,payload,expires_at)
        SELECT ?,?,user_id,kind,?,? FROM admission_challenge_rates WHERE user_id = ? AND kind = ? AND issue_id = ?
        ON CONFLICT(user_id,kind) DO UPDATE SET id = excluded.id, challenge = excluded.challenge,
          payload = excluded.payload, expires_at = excluded.expires_at RETURNING *`,
      id, value, json, now + CHALLENGE_TTL_MS, userId, action, id),
    ]);
    const row = results[2].results[0] as ChallengeRow | undefined;
    if (!row) throw new Error('challenge not allowed or rate limited');
    return challenge(row);
  }

  /** Claim before verification/provider use: even failed verification must not permit replay. */
  async consumeChallenge(userId: number, id: string, action: ChallengeKind, now = Date.now()): Promise<Challenge | null> {
    identity(userId); kind(action); time(now);
    const rows = checked(await this.statement(`DELETE FROM admission_challenges
      WHERE id = ? AND user_id = ? AND kind = ? AND expires_at > ? RETURNING *`, id, userId, action, now).all<ChallengeRow>());
    return rows[0] ? challenge(rows[0]) : null;
  }

  async readChallenge(userId: number, id: string, now = Date.now()): Promise<Challenge | null> {
    identity(userId); time(now);
    const rows = checked(await this.statement(`SELECT * FROM admission_challenges
      WHERE user_id = ? AND id = ? AND expires_at > ?`, userId, id, now).all<ChallengeRow>());
    return rows[0] ? challenge(rows[0]) : null;
  }

  /** Bearer capability for an external browser. Store only its hash; never put Telegram initData in a link. */
  async issueHandoff(userId: number, challengeId: string, now = Date.now()): Promise<string> {
    identity(userId); time(now);
    const token = randomToken();
    const hash = await tokenHash(token);
    const results = await this.batch([
      this.statement('DELETE FROM admission_handoffs WHERE expires_at <= ?', now),
      this.statement(`INSERT INTO admission_handoffs (token_hash,user_id,challenge_id,expires_at)
        SELECT ?,user_id,id,min(expires_at,?) FROM admission_challenges
        WHERE id = ? AND user_id = ? AND expires_at > ?
        ON CONFLICT(user_id,challenge_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at
        WHERE admission_handoffs.claimed = 0 AND admission_handoffs.status = 'pending'
        RETURNING token_hash`, hash, now + CHALLENGE_TTL_MS, challengeId, userId, now),
    ]);
    if (!results[1].results.length) throw new Error('handoff not allowed');
    return token;
  }

  /** Read-only options lookup. Completion must use claimHandoff, not this method. */
  async handoffReference(token: string): Promise<{ userId: number; challengeId: string } | null> {
    const hash = await tokenHash(token);
    if (!hash) return null;
    const rows = checked(await this.statement('SELECT user_id,challenge_id FROM admission_handoffs WHERE token_hash=?', hash)
      .all<{ user_id: number; challenge_id: string }>());
    return rows[0] ? { userId: rows[0].user_id, challengeId: rows[0].challenge_id } : null;
  }

  /** Caller first persisted a rejected operation, which prevents any later dispatch. */
  async closeRejectedHandoff(token: string): Promise<void> {
    const hash = await tokenHash(token);
    if (!hash) return;
    checked(await this.statement(`UPDATE admission_handoffs SET claimed=1,status='error',result_json=?
      WHERE token_hash=? AND status='pending'`, JSON.stringify({ error: 'approval_cancelled' }), hash).run());
  }

  /** Read-only options lookup. Completion must use claimHandoff, not this method. */
  async readHandoff(token: string, now = Date.now()): Promise<Handoff | null> {
    time(now);
    const hash = await tokenHash(token);
    if (!hash) return null;
    const rows = checked(await this.statement(`SELECT c.* FROM admission_handoffs h
      JOIN admission_challenges c ON c.id = h.challenge_id AND c.user_id = h.user_id
      WHERE h.token_hash = ? AND h.status = 'pending' AND h.claimed = 0
        AND h.expires_at > ? AND c.expires_at > ?`, hash, now, now).all<ChallengeRow>());
    return rows[0] ? { userId: rows[0].user_id, challenge: challenge(rows[0]) } : null;
  }

  /** One claimant wins, even on parallel completion requests. Then consume/verify the returned challenge. */
  async claimHandoff(token: string, now = Date.now()): Promise<Handoff | null> {
    time(now);
    const hash = await tokenHash(token);
    if (!hash) return null;
    // Return the snapshot in the UPDATE itself, so a second claimant cannot obtain it via a later SELECT.
    const rows = checked(await this.statement(`UPDATE admission_handoffs SET claimed = 1
      WHERE token_hash = ? AND status = 'pending' AND claimed = 0 AND expires_at > ?
        AND EXISTS(SELECT 1 FROM admission_challenges c WHERE c.id = challenge_id AND c.user_id = admission_handoffs.user_id AND c.expires_at > ?)
      RETURNING user_id,
        (SELECT json_object('id',c.id,'challenge',c.challenge,'user_id',c.user_id,'kind',c.kind,'payload',c.payload,'expires_at',c.expires_at)
         FROM admission_challenges c WHERE c.id = challenge_id AND c.user_id = admission_handoffs.user_id) AS challenge_json`,
    hash, now, now).all<{ user_id: number; challenge_json: string }>());
    return rows[0] ? { userId: rows[0].user_id, challenge: challenge(JSON.parse(rows[0].challenge_json) as ChallengeRow) } : null;
  }

  /** Final result is immutable. The caller must first win claimHandoff and verify/execute the action. */
  async finishHandoff(token: string, result: HandoffResult, now = Date.now()): Promise<boolean> {
    time(now);
    if (result.status !== 'done' && result.status !== 'error') throw new Error('invalid handoff result');
    const json = jsonPayload(result.result);
    const hash = await tokenHash(token);
    if (!hash) return false;
    return checked(await this.statement(`UPDATE admission_handoffs SET status = ?, result_json = ?
      WHERE token_hash = ? AND claimed = 1 AND status = 'pending' AND expires_at > ? RETURNING token_hash`,
    result.status, json, hash, now).all()).length === 1;
  }

  /** Called by the Telegram-authenticated origin; the user ID must come from verified Telegram identity. */
  async pollHandoff(userId: number, challengeId: string, now = Date.now()): Promise<HandoffStatus | null> {
    identity(userId); time(now);
    const rows = checked(await this.statement(`SELECT status,result_json FROM admission_handoffs
      WHERE user_id = ? AND challenge_id = ? AND expires_at > ?`, userId, challengeId, now)
      .all<{ status: HandoffStatus['status']; result_json: string | null }>());
    return rows[0] ? { status: rows[0].status, result: rows[0].result_json === null ? null : JSON.parse(rows[0].result_json) } : null;
  }

  async enrollments(): Promise<Enrollment[]> {
    return checked(await this.statement('SELECT * FROM admission_users ORDER BY joined_at,user_id').all<UserRow>()).map(enrollment);
  }

  /** used includes both the legacy baseline and every lifetime reservation. */
  async capacity(): Promise<Capacity> {
    const rows = checked(await this.statement(`SELECT legacy_slots AS legacy,
      legacy_slots + (SELECT count(*) FROM admission_users WHERE external_id IS NOT NULL) AS used
      FROM admission_settings WHERE id = 1`).all<{ legacy: number; used: number }>());
    if (!rows[0]) throw new Error('store not initialized');
    return { ...rows[0], max: MAX_SEATS };
  }

  /** Rechecks consent at read time; destinations can only be the enrolled Telegram user. */
  async pendingInvitations(limit = 100): Promise<Invitation[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEATS) throw new Error('invalid invitation limit');
    const rows = checked(await this.statement(`SELECT i.user_id,i.channel,i.destination FROM admission_invitations i
      JOIN admission_users u ON u.user_id = i.user_id
      WHERE i.delivered = 0 AND u.telegram_notify = 1 AND u.external_id IS NOT NULL ORDER BY i.user_id LIMIT ?`, limit)
      .all<{ user_id: number; channel: 'telegram'; destination: string }>());
    return rows.map(row => ({ userId: row.user_id, channel: row.channel, destination: row.destination }));
  }

  async markInvitationDelivered(userId: number, channel: 'telegram' = 'telegram'): Promise<void> {
    identity(userId);
    if (channel !== 'telegram') throw new Error('invalid invitation channel');
    checked(await this.statement('UPDATE admission_invitations SET delivered = 1 WHERE user_id = ? AND channel = ?', userId, channel).run());
  }
}
