import type { Hash, PreparedLong, ReviewedCall, VerifiedReceipt } from './ports';
import type { HistoryEntry } from './view';
import { AppError } from './errors';

export interface StoragePort {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}
export interface JournalRecord {
  view: HistoryEntry;
  readonly call: ReviewedCall;
  readonly plan?: PreparedLong;
}
const PREFIX = 'fxaeon.rebuild.transaction.v1:';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DATA = /^0x(?:[0-9a-fA-F]{2})+$/;

/** Recovery stores comparison evidence. No method can replay a stored call. */
export class Journal {
  readonly #records = new Map<string, JournalRecord>();
  constructor(private readonly storage?: StoragePort) {
    this.refresh();
  }

  /** Read other tabs again under the signing lock; persisted labels never establish success. */
  refresh(): void {
    const storage = this.storage;
    if (!storage) return;
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(PREFIX)) continue;
        const raw = storage.getItem(key);
        if (!raw || raw.length > 65_536) continue;
        try {
          const value: unknown = JSON.parse(raw);
          const record = this.#decode(value, key.slice(PREFIX.length));
          if (!record) continue;
          const current = this.#records.get(record.view.id);
          // Keep this tab's dispatched bytes and verified receipts. A storage mutation
          // cannot replace either with a different transaction or claimed outcome.
          if (current?.plan || current?.view.verifiedInSession) continue;
          if (current && (current.call.from.toLowerCase() !== record.call.from.toLowerCase() ||
              current.call.to.toLowerCase() !== record.call.to.toLowerCase() || current.call.data.toLowerCase() !== record.call.data.toLowerCase() ||
              current.call.value !== record.call.value || current.call.nonce !== record.call.nonce ||
              (current.view.hash && current.view.hash.toLowerCase() !== record.view.hash?.toLowerCase()))) continue;
          this.#records.set(record.view.id, record);
        } catch { /* A malformed neighbor does not erase other recoverable hashes. */ }
      }
    } catch { /* Storage can be denied. The in-memory journal remains authoritative for hints. */ }
  }

  #decode(input: unknown, id: string): JournalRecord | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const x = input as Record<string, unknown>;
    if (x.version !== 1 || x.id !== id || !/^[\w-]{1,80}$/.test(id) || !x.call || typeof x.call !== 'object') return null;
    const c = x.call as Record<string, unknown>;
    if (typeof c.from !== 'string' || !ADDRESS.test(c.from) || typeof c.to !== 'string' || !ADDRESS.test(c.to) ||
        c.chainId !== 1 || typeof c.data !== 'string' || !DATA.test(c.data) || c.data.length > 32_770 ||
        typeof c.value !== 'string' || !/^\d{1,78}$/.test(c.value) || typeof c.nonce !== 'number' || !Number.isSafeInteger(c.nonce) || c.nonce < 0 ||
        typeof x.createdAt !== 'number' || !Number.isSafeInteger(x.createdAt) || x.createdAt < 0 || x.createdAt > Date.now() + 60_000 ||
        typeof x.leverageBps !== 'number' || !Number.isInteger(x.leverageBps) || x.leverageBps < 11_000 || x.leverageBps > 50_000) return null;
    if (x.hash !== undefined && (typeof x.hash !== 'string' || !HASH.test(x.hash))) return null;
    const call: ReviewedCall = Object.freeze({ chainId: 1, from: c.from as ReviewedCall['from'], to: c.to as ReviewedCall['to'], data: c.data as Hash, value: BigInt(c.value), nonce: c.nonce });
    if (call.value <= 0n || call.value >= 1n << 256n) return null;
    const hash = x.hash as Hash | undefined;
    return {
      call,
      view: Object.freeze({ id, account: call.from.toLowerCase(), createdAt: x.createdAt, amountWei: call.value.toString(), leverageBps: x.leverageBps,
        state: hash ? 'pending' : 'unverified', hash, verifiedInSession: false })
    };
  }

  begin(plan: PreparedLong, now: number): JournalRecord {
    const id = `${now}-${globalThis.crypto.randomUUID()}`;
    const record: JournalRecord = { plan, call: plan.call,
      view: Object.freeze({ id, account: plan.call.from.toLowerCase(), createdAt: now, amountWei: plan.call.value.toString(), leverageBps: plan.intent.leverageBps, state: 'wallet-request', verifiedInSession: false }) };
    if (!this.#persist(record)) throw new AppError('unavailable', 'Your browser could not save transaction recovery information. Enable site storage before signing. No wallet request was made.');
    this.#records.set(id, record);
    return record;
  }

  update(id: string, patch: Partial<Pick<HistoryEntry, 'state' | 'hash' | 'verifiedInSession'>> & { receipt?: VerifiedReceipt }): void {
    const record = this.#records.get(id);
    if (!record) return;
    record.view = Object.freeze({ ...record.view, ...patch });
    this.#persist(record);
  }

  #persist(record: JournalRecord): boolean {
    try {
      if (!this.storage) return false;
      const key = `${PREFIX}${record.view.id}`;
      // Only an observed current-session no-send result may remove the hint.
      // A stored terminal label can never authorize a later retry.
      if (record.view.state === 'declined' && !record.view.hash) {
        this.storage.removeItem?.(key);
        return this.storage.getItem(key) === null;
      }
      const encoded = JSON.stringify({
        version: 1, id: record.view.id, createdAt: record.view.createdAt, leverageBps: record.view.leverageBps,
        state: record.view.state, hash: record.view.hash,
        call: { ...record.call, value: record.call.value.toString() }
      });
      this.storage.setItem(key, encoded);
      return this.storage.getItem(key) === encoded;
    } catch { return false; /* After dispatch, the in-memory hash survives a storage failure. */ }
  }

  get(id: string): JournalRecord | undefined { this.refresh(); return this.#records.get(id); }
  entries(account?: string): HistoryEntry[] {
    if (!account) return [];
    return [...this.#records.values()].map(x => x.view).filter(x => x.account === account.toLowerCase()).sort((a, b) => b.createdAt - a.createdAt);
  }
  unresolved(account: string): boolean {
    this.refresh();
    return this.entries(account).some(x => !['confirmed', 'reverted', 'declined'].includes(x.state));
  }
}
