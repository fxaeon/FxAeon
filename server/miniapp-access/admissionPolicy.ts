import type { Capacity, DB, DBResult } from './store';

// The permanent seat inventory remains the sole count, including reservations
// whose wallet provisioning is still in flight. A policy can only lower 480.
const USED = `(SELECT legacy_slots FROM admission_settings WHERE id = 1) +
  (SELECT count(*) FROM admission_users WHERE external_id IS NOT NULL)`;
const OPEN = `EXISTS(SELECT 1 FROM admission_policy WHERE id = 1 AND paused = 0 AND (${USED}) < threshold)`;
const NOW = `CAST(strftime('%s','now') AS INTEGER) * 1000`;

export const ADMISSION_POLICY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admission_policy (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    threshold INTEGER NOT NULL CHECK(threshold BETWEEN 1 AND 480),
    paused INTEGER NOT NULL CHECK(paused IN (0,1)),
    revision INTEGER NOT NULL CHECK(revision >= 0)
  )`,
  `INSERT INTO admission_policy (id,threshold,paused,revision)
    SELECT 1,480,0,0 WHERE NOT EXISTS(SELECT 1 FROM admission_policy)`,
  `CREATE TABLE IF NOT EXISTS admission_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK(kind IN ('reservation','policy','legacy')),
    at INTEGER NOT NULL,
    threshold INTEGER NOT NULL,
    paused INTEGER NOT NULL CHECK(paused IN (0,1)),
    revision INTEGER NOT NULL,
    previous_legacy INTEGER, legacy INTEGER, used INTEGER,
    CHECK((kind = 'legacy' AND previous_legacy IS NOT NULL AND legacy IS NOT NULL AND used IS NOT NULL
      AND previous_legacy >= 0 AND legacy > previous_legacy AND legacy <= used AND used <= 480)
      OR (kind IN ('reservation','policy') AND previous_legacy IS NULL AND legacy IS NULL AND used IS NULL))
  )`,
  `CREATE TRIGGER IF NOT EXISTS admission_legacy_audit AFTER UPDATE OF legacy_slots ON admission_settings
    WHEN NEW.legacy_slots > OLD.legacy_slots
    BEGIN
      INSERT INTO admission_activity (kind,at,threshold,paused,revision,previous_legacy,legacy,used)
        SELECT 'legacy',${NOW},threshold,paused,revision,OLD.legacy_slots,NEW.legacy_slots,
          NEW.legacy_slots + (SELECT count(*) FROM admission_users WHERE external_id IS NOT NULL)
        FROM admission_policy WHERE id = 1;
    END`,
  `CREATE TRIGGER IF NOT EXISTS admission_policy_no_delete BEFORE DELETE ON admission_policy
    BEGIN SELECT RAISE(ABORT, 'admission policy is permanent'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_policy_no_replace BEFORE INSERT ON admission_policy
    WHEN EXISTS(SELECT 1 FROM admission_policy)
    BEGIN SELECT RAISE(ABORT, 'admission policy is permanent'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_policy_revision BEFORE UPDATE ON admission_policy
    WHEN NEW.id != OLD.id OR NEW.revision != OLD.revision + 1
    BEGIN SELECT RAISE(ABORT, 'admission policy revision required'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_policy_update_limit BEFORE UPDATE OF external_id ON admission_users
    WHEN OLD.external_id IS NULL AND NEW.external_id IS NOT NULL AND NOT ${OPEN}
    BEGIN SELECT RAISE(ABORT, 'admission paused or seat limit'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_policy_insert_limit BEFORE INSERT ON admission_users
    WHEN NEW.external_id IS NOT NULL AND NOT ${OPEN}
    BEGIN SELECT RAISE(ABORT, 'admission paused or seat limit'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_policy_audit AFTER UPDATE ON admission_policy
    BEGIN INSERT INTO admission_activity (kind,at,threshold,paused,revision)
      VALUES ('policy',${NOW},NEW.threshold,NEW.paused,NEW.revision); END`,
  ...['INSERT', 'UPDATE OF external_id'].map((event, index) =>
    `CREATE TRIGGER IF NOT EXISTS admission_reservation_audit_${index} AFTER ${event} ON admission_users
      WHEN NEW.external_id IS NOT NULL${index ? ' AND OLD.external_id IS NULL' : ''}
      BEGIN INSERT INTO admission_activity (kind,at,threshold,paused,revision)
        SELECT 'reservation',${NOW},threshold,paused,revision FROM admission_policy WHERE id = 1; END`),
  `CREATE TRIGGER IF NOT EXISTS admission_activity_no_replace BEFORE INSERT ON admission_activity
    WHEN EXISTS(SELECT 1 FROM admission_activity WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'admission activity is permanent'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_activity_no_delete BEFORE DELETE ON admission_activity
    BEGIN SELECT RAISE(ABORT, 'admission activity is permanent'); END`,
  `CREATE TRIGGER IF NOT EXISTS admission_activity_no_update BEFORE UPDATE ON admission_activity
    BEGIN SELECT RAISE(ABORT, 'admission activity is permanent'); END`,
];

export interface AdmissionPolicy { threshold: number; paused: boolean; revision: number; active: boolean }
export type AdmissionEvent = { id: number; at: number; threshold: number; paused: boolean; revision: number } &
  ({ kind: 'reservation' | 'policy' } | { kind: 'legacy'; previousLegacy: number; legacy: number; used: number });
const rows = <T>(result: DBResult<T>): T[] => {
  if (!result.success) throw new Error('admission policy storage failure');
  return result.results;
};

export class AdmissionControl {
  constructor(private readonly db: DB) {}

  async policy(): Promise<AdmissionPolicy> {
    return (await this.snapshot()).policy;
  }

  async snapshot(): Promise<{ policy: AdmissionPolicy; capacity: Capacity }> {
    const [row] = rows(await this.db.prepare(`SELECT threshold,paused,revision,(${USED}) AS used,
      (SELECT legacy_slots FROM admission_settings WHERE id = 1) AS legacy FROM admission_policy WHERE id = 1`)
      .all<{ threshold: number; paused: number; revision: number; used: number; legacy: number }>());
    if (!row || row.legacy === null || row.used === null) throw new Error('admission policy unavailable');
    return { policy: { threshold: row.threshold, paused: row.paused === 1, revision: row.revision,
      active: row.paused === 1 || row.used >= row.threshold }, capacity: { used: row.used, legacy: row.legacy, max: 480 } };
  }

  async configure(threshold: number, paused: boolean, expectedRevision: number): Promise<boolean> {
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 480 || typeof paused !== 'boolean'
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision === Number.MAX_SAFE_INTEGER) {
      throw new Error('invalid admission policy');
    }
    return rows(await this.db.prepare(`UPDATE admission_policy SET threshold = ?,paused = ?,revision = revision + 1
      WHERE id = 1 AND revision = ? RETURNING id`).bind(threshold, +paused, expectedRevision).all()).length === 1;
  }

  /** Authenticated Telegram launch only. No reservation or waiting row at capacity. */
  async resolve(userId: number): Promise<void> {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('invalid Telegram user id');
    if (rows(await this.db.prepare('SELECT user_id FROM admission_users WHERE user_id = ? AND external_id IS NOT NULL')
      .bind(userId).all()).length) return;
    const externalId = crypto.randomUUID();
    const result = await this.db.batch([
      this.db.prepare(`INSERT INTO admission_users (user_id,joined_at,telegram_notify,external_id)
        SELECT ?,?,0,? WHERE NOT EXISTS(SELECT 1 FROM admission_users WHERE user_id = ?) AND ${OPEN}`)
        .bind(userId, Date.now(), externalId, userId),
      this.db.prepare(`UPDATE admission_users SET external_id = ? WHERE user_id = ? AND external_id IS NULL AND ${OPEN}`)
        .bind(externalId, userId),
    ]);
    if (result.length !== 2) throw new Error('incomplete admission transaction');
    result.forEach(rows);
  }

  async activity(): Promise<AdmissionEvent[]> {
    const records = rows(await this.db.prepare(`SELECT id,kind,at,threshold,paused,revision,previous_legacy,legacy,used
      FROM admission_activity ORDER BY id DESC LIMIT 100`)
      .all<{ id: number; kind: 'reservation' | 'policy' | 'legacy'; at: number; threshold: number; paused: number; revision: number;
        previous_legacy: number | null; legacy: number | null; used: number | null }>());
    return records.map((row): AdmissionEvent => {
      const common = { id: row.id, at: row.at, threshold: row.threshold, paused: row.paused === 1, revision: row.revision };
      if (row.kind !== 'legacy') return { ...common, kind: row.kind };
      if (row.previous_legacy === null || row.legacy === null || row.used === null) throw new Error('invalid legacy activity');
      return { ...common, kind: 'legacy', previousLegacy: row.previous_legacy, legacy: row.legacy, used: row.used };
    });
  }
}
