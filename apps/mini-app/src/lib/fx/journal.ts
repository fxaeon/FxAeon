import { isAddress, keccak256, type Address, type Hex } from "viem";
import { OFFICIAL_FX_METHODS, type FxChainId, type PendingActionIntent, type PendingBridgeContext, type PendingBridgeDeliveryProof, type PendingHashRecord } from "./types";
import { parsePendingBridgeDeliveryProof, samePendingBridgeContext } from "./bridgeProof";

const LEGACY_STORAGE_KEYS = [
  "fxaeon:pending-hashes:v1",
  "fxaeon:pending-hashes:v2",
  "fxaeon:pending-hashes:v3",
  "fxaeon:pending-hashes:v4",
] as const;
const LEGACY_RECORD_KEY_PREFIX = "fxaeon:pending-hash:v5:";
// v6 stores append-only status events per record. A single JSON array is vulnerable
// to cross-tab read-modify-write races: an Ethereum write and a Base write can
// otherwise overwrite one another even though the transaction locks are
// intentionally chain-specific. Separate pending/confirmed/failed keys make
// each transition atomic and prevent a stale pending tab from overwriting a
// terminal receipt event. v1-v5 remain backwards-compatible read sources.
const RECORD_EVENT_KEY_PREFIX = "fxaeon:pending-event:v6:";
const MAX_RECORDS = 100;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
let memoryRecords: PendingHashRecord[] = [];
// Once browser storage becomes unavailable (private-mode quota, a revoked
// permission, or a throwing host shim), keep the receipt journal in memory for
// the lifetime of this page. A failed read must never discard records that a
// previous write already retained in memory.
let storageUnavailable = false;

/**
 * Fired in this tab after every journal write. Storage events only reach other
 * tabs, so in-tab listeners (the header's pending ring, settle notices) use this.
 */
export const JOURNAL_UPDATED_EVENT = "fxaeon:journal-updated";

/** Limit cross-tab recovery work to this journal's own storage mutations. */
export function isRecoveryJournalStorageKey(key: string | null): boolean {
  return typeof key === "string" && (
    (LEGACY_STORAGE_KEYS as readonly string[]).includes(key)
    || key.startsWith(LEGACY_RECORD_KEY_PREFIX)
    || key.startsWith(RECORD_EVENT_KEY_PREFIX)
  );
}

function validBridgeContext(value: unknown, sourceChainId: FxChainId): value is PendingBridgeContext {
  if (!value || typeof value !== "object") return false;
  const bridge = value as Partial<PendingBridgeContext>;
  if (
    (bridge.destinationChainId !== 1 && bridge.destinationChainId !== 8453)
    || bridge.destinationChainId === sourceChainId
    || typeof bridge.sourceOftAddress !== "string"
    || !isAddress(bridge.sourceOftAddress)
    || bridge.sourceOftAddress.toLowerCase() === ZERO_ADDRESS
    || typeof bridge.destinationOftAddress !== "string"
    || !isAddress(bridge.destinationOftAddress)
    || bridge.destinationOftAddress.toLowerCase() === ZERO_ADDRESS
    || typeof bridge.recipient !== "string"
    || !isAddress(bridge.recipient)
    || bridge.recipient.toLowerCase() === ZERO_ADDRESS
    || typeof bridge.amountLD !== "string"
    || !/^[1-9][0-9]*$/.test(bridge.amountLD)
    || typeof bridge.minAmountLD !== "string"
    || !/^[1-9][0-9]*$/.test(bridge.minAmountLD)
    || typeof bridge.destinationBaselineBlock !== "string"
    || !/^(0|[1-9][0-9]*)$/.test(bridge.destinationBaselineBlock)
    || (bridge.bridgeToken !== undefined && (typeof bridge.bridgeToken !== "string" || !/^[\x20-\x7e]{1,64}$/.test(bridge.bridgeToken)))
  ) return false;
  try {
    return BigInt(bridge.minAmountLD) <= BigInt(bridge.amountLD);
  } catch {
    return false;
  }
}

function storage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    storageUnavailable = true;
    return undefined;
  }
}

function validRecord(value: unknown): value is PendingHashRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PendingHashRecord>;
  const expectedId = typeof record.walletAddress === "string"
    && typeof record.hash === "string"
    && (record.chainId === 1 || record.chainId === 8453)
    ? `${record.chainId}:${record.walletAddress.toLowerCase()}:${record.hash.toLowerCase()}`
    : "";
  return typeof record.id === "string"
    && record.id === expectedId
    && typeof record.operation === "string"
    && (record.operation === 'sendAsset' || (OFFICIAL_FX_METHODS as readonly string[]).includes(record.operation))
    && (record.stepKind === undefined || record.stepKind === "approval" || record.stepKind === "action" || record.stepKind === "unknown")
    && typeof record.walletAddress === "string"
    && isAddress(record.walletAddress)
    && (record.chainId === 1 || record.chainId === 8453)
    && typeof record.hash === "string"
    && /^0x[0-9a-fA-F]{64}$/.test(record.hash)
    && typeof record.to === "string"
    && isAddress(record.to)
    && typeof record.submittedAt === "number"
    && Number.isFinite(record.submittedAt)
    && (record.updatedAt === undefined || (typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) && record.updatedAt >= record.submittedAt))
    && (record.nonce === undefined || (Number.isSafeInteger(record.nonce) && record.nonce >= 0))
    && (record.dataHash === undefined || (typeof record.dataHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(record.dataHash)))
    && (record.valueWei === undefined || (typeof record.valueWei === "string" && /^(0|[1-9][0-9]*)$/.test(record.valueWei)))
    && (record.status === "pending" || record.status === "confirmed" || record.status === "failed")
    && (record.bridge === undefined || (
      record.operation === "buildBridgeTx"
      && validBridgeContext(record.bridge, record.chainId)
      && record.bridge.sourceOftAddress.toLowerCase() === record.to?.toLowerCase()
    ))
    && (record.intent === undefined || (typeof record.intent === "string" && ["Open position", "Increase position", "Reduce position", "Close position", "Adjust leverage", "Borrow", "Add collateral", "Repay", "Withdraw collateral", "Repay and withdraw", "Deposit", "Withdraw", "Queue withdrawal", "Claim", "Bridge", "Send"].includes(record.intent)));
}

function recordStorageKey(record: PendingHashRecord): string {
  return `${RECORD_EVENT_KEY_PREFIX}${encodeURIComponent(record.id)}:${record.status}`;
}

function withoutDeliveryProof(bridge: PendingBridgeContext): PendingBridgeContext {
  const { deliveryProof: _deliveryProof, ...context } = bridge;
  return context;
}

/** Corrupt optional evidence must not erase the source hash needed for recovery. */
function sanitizedRecord(value: unknown): PendingHashRecord | null {
  if (!validRecord(value)) return null;
  if (!value.bridge || value.bridge.deliveryProof === undefined) return value;
  const deliveryProof = value.status === "confirmed" && value.stepKind !== "approval"
    ? parsePendingBridgeDeliveryProof(value.bridge.deliveryProof, { ...value, bridge: value.bridge })
    : undefined;
  const bridge = withoutDeliveryProof(value.bridge);
  return { ...value, bridge: { ...bridge, ...(deliveryProof ? { deliveryProof } : {}) } };
}

function readRecordKeys(target: Storage): PendingHashRecord[] {
  const records: PendingHashRecord[] = [];
  // Storage.key()/length are part of the Web Storage contract. A few tiny
  // test shims intentionally omit them; in that case the legacy array still
  // provides a deterministic fallback and writes remain in memory.
  if (typeof target.length !== "number" || typeof target.key !== "function") return records;
  for (let index = 0; index < target.length; index += 1) {
    const key = target.key(index);
    if (!key?.startsWith(LEGACY_RECORD_KEY_PREFIX) && !key?.startsWith(RECORD_EVENT_KEY_PREFIX)) continue;
    try {
      const parsed: unknown = JSON.parse(target.getItem(key) ?? "null");
      const record = sanitizedRecord(parsed);
      if (record) records.push(record);
    } catch {
      // Ignore one malformed/untrusted local record; other records remain
      // independently recoverable.
    }
  }
  return records;
}

function mergeRecords(...groups: readonly PendingHashRecord[][]): PendingHashRecord[] {
  const byId = new Map<string, PendingHashRecord>();
  for (const group of groups) {
    for (const record of group) {
      const previous = byId.get(record.id);
      if (!previous) {
        byId.set(record.id, record);
        continue;
      }
      // Prefer terminal chain truth over a stale pending copy. For records
      // with the same authority level, the newest append-only event wins.
      const previousTerminal = previous.status !== "pending";
      const currentTerminal = record.status !== "pending";
      if (previousTerminal && !currentTerminal) continue;
      const previousUpdatedAt = previous.updatedAt ?? previous.submittedAt;
      const currentUpdatedAt = record.updatedAt ?? record.submittedAt;
      if ((currentTerminal && !previousTerminal) || currentUpdatedAt >= previousUpdatedAt) {
        byId.set(record.id, record);
      }
    }
  }
  return [...byId.values()]
    .sort((left, right) => left.submittedAt - right.submittedAt)
    .slice(-MAX_RECORDS);
}

function readAll(): PendingHashRecord[] {
  if (storageUnavailable) return [...memoryRecords];
  const target = storage();
  if (!target) return [...memoryRecords];
  // Treat a corrupt legacy array as untrusted data, not as a storage outage;
  // otherwise it could hide valid v5 per-record entries after a reload.
  const legacy: PendingHashRecord[] = [];
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      const parsed: unknown = JSON.parse(target.getItem(key) ?? "[]");
      if (Array.isArray(parsed)) legacy.push(...parsed.flatMap(value => {
        const record = sanitizedRecord(value);
        return record ? [record] : [];
      }));
    } catch {
      // One malformed legacy version cannot hide independently valid events.
    }
  }
  try {
    // Include the validated in-memory copy. This is essential for standards-
    // light WebView/test storage shims that support get/set but omit key()/
    // length, and it also preserves a just-signed hash if enumeration becomes
    // unavailable after the write. Terminal events still outrank stale pending
    // copies in mergeRecords.
    const records = mergeRecords(memoryRecords, legacy, readRecordKeys(target));
    // Keep the in-memory copy current whenever storage is readable. This lets
    // a later storage failure continue from the latest validated journal.
    memoryRecords = records.slice(-MAX_RECORDS);
    return [...memoryRecords];
  } catch {
    storageUnavailable = true;
    return [...memoryRecords];
  }
}

function writeRecord(record: PendingHashRecord): void {
  // Update the in-memory copy first so a quota/private-mode failure never
  // loses the hash that was just returned by the wallet.
  memoryRecords = mergeRecords(memoryRecords, [record]);
  const target = storage();
  if (target) {
    try {
      target.setItem(recordStorageKey(record), JSON.stringify(record));
    } catch {
      // A full/private storage area should not block a signed transaction. The
      // in-memory copy above remains the fallback for all subsequent reads.
      storageUnavailable = true;
    }
  }
  announceJournalWrite();
}

/** Display listeners only; a throwing listener can never fail a journal write. */
function announceJournalWrite(): void {
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(JOURNAL_UPDATED_EVENT));
  } catch {
    // Notification is best effort.
  }
}

function writeRecords(records: readonly PendingHashRecord[]): void {
  for (const record of records) writeRecord(record);
}

export function readPendingHashJournal(): PendingHashRecord[] {
  return readAll();
}

export function readPendingHashes(): PendingHashRecord[] {
  return readAll().filter((record) => record.status === "pending");
}

export type BridgeProofJournalIdentity = {
  walletAddress: string;
  chainId: FxChainId;
  hash: string;
  bridge: PendingBridgeContext;
};

function matchingBridgeRecord(record: PendingHashRecord, identity: BridgeProofJournalIdentity): boolean {
  return record.operation === "buildBridgeTx" && record.stepKind !== "approval"
    && record.status === "confirmed" && Boolean(record.bridge)
    && record.chainId === identity.chainId
    && record.walletAddress.toLowerCase() === identity.walletAddress.toLowerCase()
    && record.hash.toLowerCase() === identity.hash.toLowerCase()
    && validBridgeContext(identity.bridge, identity.chainId)
    && samePendingBridgeContext(record.bridge!, identity.bridge);
}

/**
 * Cached evidence is only a recovery hint. The tracker must repeat source-event,
 * destination-event, canonical block, and finality checks before using its amount.
 */
export function readPendingBridgeDeliveryProof(identity: BridgeProofJournalIdentity): PendingBridgeDeliveryProof | undefined {
  const record = readAll().find(candidate => matchingBridgeRecord(candidate, identity));
  return record?.bridge?.deliveryProof;
}

/** Call only after the canonical destination event passes the tracker's finality checks. */
export function updatePendingBridgeDeliveryProof(
  identity: BridgeProofJournalIdentity,
  value: PendingBridgeDeliveryProof,
): boolean {
  const record = readAll().find(candidate => matchingBridgeRecord(candidate, identity));
  if (!record?.bridge) return false;
  const deliveryProof = parsePendingBridgeDeliveryProof(value, { ...record, bridge: record.bridge });
  if (!deliveryProof) return false;
  if (JSON.stringify(record.bridge.deliveryProof) === JSON.stringify(deliveryProof)) return true;
  writeRecord({
    ...record,
    bridge: { ...record.bridge, deliveryProof },
    updatedAt: Math.max(Date.now(), (record.updatedAt ?? record.submittedAt) + 1),
  });
  return true;
}

export function recordPendingHash(params: {
  operation: PendingHashRecord['operation'];
  stepKind?: PendingHashRecord["stepKind"];
  intent?: PendingActionIntent;
  walletAddress: Address;
  chainId: FxChainId;
  hash: Hex;
  to: Address;
  nonce?: number;
  data: Hex;
  value: bigint;
  bridge?: PendingBridgeContext;
}): PendingHashRecord {
  if (params.bridge && (params.operation !== "buildBridgeTx"
    || params.bridge.sourceOftAddress.toLowerCase() !== params.to.toLowerCase()
    || !validBridgeContext(params.bridge, params.chainId))) {
    throw new Error("bridge recovery context does not match the submitted bridge action");
  }
  const submittedAt = Date.now();
  const record: PendingHashRecord = {
    id: `${params.chainId}:${params.walletAddress.toLowerCase()}:${params.hash.toLowerCase()}`,
    operation: params.operation,
    stepKind: params.stepKind,
    intent: params.intent,
    walletAddress: params.walletAddress,
    chainId: params.chainId,
    hash: params.hash,
    to: params.to,
    nonce: params.nonce,
    dataHash: keccak256(params.data),
    valueWei: params.value.toString(),
    // A newly submitted action can carry recovery facts, never completed-delivery evidence.
    bridge: params.bridge ? withoutDeliveryProof(params.bridge) : undefined,
    submittedAt,
    updatedAt: submittedAt,
    status: "pending",
  };
  // A per-record key avoids a cross-chain/cross-tab array overwrite. The
  // existing v4 entry (if any) remains harmless and is merged on reads.
  writeRecord(record);
  return record;
}

export function updatePendingHash(hash: Hex, status: "confirmed" | "failed"): void {
  const records = readAll();
  const changed: PendingHashRecord[] = [];
  for (const record of records) {
    if (record.hash.toLowerCase() !== hash.toLowerCase()) continue;
    // Re-verifying the same terminal truth must not emit another cross-tab
    // storage event. A changed terminal status (for example after a reorg)
    // still appends a newer event below.
    if (record.status === status) continue;
    changed.push({ ...record, status,
      ...(status === "failed" && record.bridge ? { bridge: withoutDeliveryProof(record.bridge) } : {}),
      updatedAt: Math.max(Date.now(), (record.updatedAt ?? record.submittedAt) + 1) });
  }
  if (changed.length) writeRecords(changed);
}

/**
 * Update one journal entry only after its chain receipt has been independently
 * verified for the same wallet and chain. The hash alone is deliberately not
 * enough here: a local journal is untrusted input and must not let a forged
 * record update another wallet's view.
 */
export function updatePendingHashRecord(
  record: Pick<PendingHashRecord, "id" | "walletAddress" | "chainId" | "hash" | "to">,
  status: "confirmed" | "failed",
): void {
  const records = readAll();
  const changed: PendingHashRecord[] = [];
  for (const candidate of records) {
    const sameRecord = candidate.id === record.id
      && candidate.chainId === record.chainId
      && candidate.walletAddress.toLowerCase() === record.walletAddress.toLowerCase()
      && candidate.hash.toLowerCase() === record.hash.toLowerCase()
      && candidate.to.toLowerCase() === record.to.toLowerCase();
    if (sameRecord && candidate.status !== status) {
      changed.push({ ...candidate, status,
        ...(status === "failed" && candidate.bridge ? { bridge: withoutDeliveryProof(candidate.bridge) } : {}),
        updatedAt: Math.max(Date.now(), (candidate.updatedAt ?? candidate.submittedAt) + 1) });
    }
  }
  if (changed.length) writeRecords(changed);
}

/**
 * Reconcile hashes against receipts only. A journal entry can never establish
 * a balance, position, bridge delivery, or authorization; callers must reread
 * the official SDK/chain state after this helper.
 */
export async function reconcilePendingHashes(params: {
  getReceiptStatus: (record: PendingHashRecord) => Promise<"pending" | "confirmed" | "failed">;
}): Promise<PendingHashRecord[]> {
  const pending = readPendingHashes();
  for (const record of pending) {
    const status = await params.getReceiptStatus(record);
    if (status !== "pending") updatePendingHashRecord(record, status);
  }
  return readPendingHashes();
}

export function clearPendingHashJournalForTests(): void {
  memoryRecords = [];
  storageUnavailable = false;
  const target = storage();
  try {
    for (const key of LEGACY_STORAGE_KEYS) target?.removeItem(key);
    if (target && typeof target.length === "number" && typeof target.key === "function") {
      const keys: string[] = [];
      for (let index = 0; index < target.length; index += 1) {
        const key = target.key(index);
        if (key?.startsWith(LEGACY_RECORD_KEY_PREFIX) || key?.startsWith(RECORD_EVENT_KEY_PREFIX)) keys.push(key);
      }
      for (const key of keys) target.removeItem(key);
    }
  } catch {
    // ignored in tests with a read-only storage shim
  }
}
