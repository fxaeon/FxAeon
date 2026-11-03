import type { DB } from './store';
import { AccessError } from './http';
import { validateTransactionContext, type TransactionContext } from './privy';

export interface Operation {
  id: string;
  state: 'dispatching' | 'submitted' | 'unknown' | 'rejected';
  hash: string | null;
  context: TransactionContext;
  acknowledged: boolean;
}
type Row = Omit<Operation, 'context' | 'acknowledged'> & {
  wallet_id: string; reference_id: string; caip2: TransactionContext['caip2'];
  expires_at: number; acknowledged: number;
};
const HASH = /^0x[0-9a-fA-F]{64}$/;

/** Submission evidence survives reloads. Only explicit delivery acknowledgment frees the slot. */
export class Operations {
  constructor(private readonly db: DB) {}
  async init() {
    const results = await this.db.batch([
      this.db.prepare(`CREATE TABLE IF NOT EXISTS access_operations (
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('dispatching','submitted','unknown','rejected')),
        hash TEXT, wallet_id TEXT NOT NULL, reference_id TEXT NOT NULL UNIQUE,
        caip2 TEXT NOT NULL CHECK(caip2 IN ('eip155:1','eip155:8453')), expires_at INTEGER NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged IN (0,1)), created_at INTEGER NOT NULL,
        CHECK((state = 'submitted' AND hash IS NOT NULL) OR (state != 'submitted' AND hash IS NULL)),
        CHECK(acknowledged = 0 OR state IN ('submitted','rejected')),
        CHECK(state != 'rejected' OR acknowledged = 1))`),
      this.db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS access_operation_pending
        ON access_operations(user_id) WHERE acknowledged = 0`),
      // Retain the issued intent even after its one-use challenge is consumed.
      // This lets cancellation/expiry atomically compete with dispatch.
      this.db.prepare(`CREATE TABLE IF NOT EXISTS access_signing_intents (
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, wallet_id TEXT NOT NULL,
        reference_id TEXT NOT NULL UNIQUE, caip2 TEXT NOT NULL CHECK(caip2 IN ('eip155:1','eip155:8453')),
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`),
    ]);
    if (results.some(result => !result.success)) throw new AccessError('access_unavailable', 503);
  }

  private async read(sql: string, ...values: unknown[]): Promise<Operation | null> {
    const result = await this.db.prepare(sql).bind(...values).all<Row>();
    if (!result.success) throw new AccessError('access_unavailable', 503);
    const row = result.results[0];
    return row ? { id: row.id, state: row.state, hash: row.hash, acknowledged: row.acknowledged === 1,
      context: { walletId: row.wallet_id, referenceId: row.reference_id, caip2: row.caip2, expiresAt: row.expires_at } } : null;
  }

  result(userId: number, id: string): Promise<Operation | null> {
    return this.read('SELECT * FROM access_operations WHERE id = ? AND user_id = ?', id, userId);
  }

  pending(userId: number): Promise<Operation | null> {
    return this.read('SELECT * FROM access_operations WHERE user_id = ? AND acknowledged = 0', userId);
  }

  async rememberIntent(userId: number, id: string, context: TransactionContext): Promise<void> {
    validateTransactionContext(context);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
      throw new AccessError('request_invalid');
    }
    const result = await this.db.prepare(`INSERT INTO access_signing_intents
      (id,user_id,wallet_id,reference_id,caip2,expires_at,created_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(id, userId, context.walletId, context.referenceId, context.caip2, context.expiresAt, Date.now()).run();
    if (!result.success) throw new AccessError('access_unavailable', 503);
  }

  /** A rejected row takes the same immutable ID as claim(). Only one can win.
   * Existing dispatching/unknown/submitted operations can never be cancelled here. */
  async rejectUnsubmitted(userId: number, id: string, expiredOnly = false): Promise<boolean> {
    const now = Date.now();
    const result = await this.db.prepare(`INSERT OR IGNORE INTO access_operations
      (id,user_id,state,wallet_id,reference_id,caip2,expires_at,acknowledged,created_at)
      SELECT id,user_id,'rejected',wallet_id,reference_id,caip2,expires_at,1,?
      FROM access_signing_intents WHERE id=? AND user_id=? AND (?=0 OR expires_at<=?)`)
      .bind(now, id, userId, expiredOnly ? 1 : 0, now).run();
    if (!result.success) throw new AccessError('access_unavailable', 503);
    return (await this.result(userId, id))?.state === 'rejected';
  }

  async claim(userId: number, id: string, context: TransactionContext): Promise<void> {
    validateTransactionContext(context);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
      throw new AccessError('request_invalid');
    }
    const now = Date.now();
    if (context.expiresAt <= now || context.expiresAt > now + 300_000) throw new AccessError('approval_expired', 403);
    // A single atomic insert persists lookup context AND takes the slot before any POST.
    // Both reference IDs and operation IDs remain reserved even after acknowledgment.
    const result = await this.db.prepare(`INSERT OR IGNORE INTO access_operations
      (id,user_id,state,wallet_id,reference_id,caip2,expires_at,created_at)
      VALUES (?,?,'dispatching',?,?,?,?,?)`)
      .bind(id, userId, context.walletId, context.referenceId, context.caip2, context.expiresAt, now).run();
    if (!result.success) throw new AccessError('access_unavailable', 503);
    if (result.meta?.changes !== 1) throw new AccessError('transaction_unresolved', 409);
  }

  async complete(id: string, hash: string): Promise<void> {
    if (!HASH.test(hash)) throw new AccessError('transaction_unknown', 503);
    const result = await this.db.prepare(`UPDATE access_operations SET state = 'submitted', hash = ?
      WHERE id = ? AND (state = 'dispatching' OR (state = 'submitted' AND hash = ?))`).bind(hash, id, hash).run();
    if (!result.success || result.meta?.changes !== 1) throw new AccessError('transaction_unknown', 503);
  }

  async unknown(id: string): Promise<void> {
    const result = await this.db.prepare("UPDATE access_operations SET state = 'unknown' WHERE id = ? AND state = 'dispatching'")
      .bind(id).run();
    if (!result.success) throw new AccessError('access_unavailable', 503);
  }

  /** ONLY for submit's local approval_expired error, which proves it never called transport.
   * Provider errors and empty lookups cannot use this path. Retain IDs to prevent replay. */
  async rejectBeforeDispatch(id: string): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE access_operations SET state = 'rejected', acknowledged = 1
      WHERE id = ? AND state = 'dispatching' AND hash IS NULL AND acknowledged = 0`).bind(id).run();
    if (!result.success) throw new AccessError('access_unavailable', 503);
    return result.meta?.changes === 1;
  }

  /** Caller supplies a hash proven by reconcile using this operation's stored context.
   * Also handles a process crash after POST, when the row still says dispatching. */
  async recoverUnknown(userId: number, id: string, hash: string): Promise<boolean> {
    if (!HASH.test(hash)) throw new AccessError('transaction_unknown', 503);
    const result = await this.db.prepare(`UPDATE access_operations SET state = 'submitted', hash = ?
      WHERE user_id = ? AND id = ? AND state IN ('dispatching','unknown') AND acknowledged = 0`)
      .bind(hash, userId, id).run();
    if (!result.success) throw new AccessError('access_unavailable', 503);
    return result.meta?.changes === 1;
  }

  /** Idempotent for a lost ACK response; neither unknown nor another user's row can be cleared. */
  async acknowledge(userId: number, id: string, hash: string): Promise<boolean> {
    if (!HASH.test(hash)) throw new AccessError('request_invalid');
    const result = await this.db.prepare(`UPDATE access_operations SET acknowledged = 1
      WHERE user_id = ? AND id = ? AND state = 'submitted' AND hash = ?`).bind(userId, id, hash).run();
    if (!result.success) throw new AccessError('access_unavailable', 503);
    return result.meta?.changes === 1;
  }
}
