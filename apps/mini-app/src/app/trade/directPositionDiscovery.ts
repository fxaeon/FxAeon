import { decodeFunctionResult, encodeFunctionData, multicall3Abi, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { positionPoolAddress } from '@/lib/fx/policy';
import type { FxPublicClient } from '@/lib/fx/types';
import type { PositionGroup } from './fxUi';

/**
 * The four f(x) position pools are ERC-721 contracts, but they do not expose
 * ERC-721Enumerable.  Discovery therefore uses the wallet balance as the
 * completeness oracle and ownerOf only for a bounded token-id scan.
 */
export const POSITION_NFT_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getNextPositionId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'nextPositionId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'owner', type: 'address' }],
  },
] as const;

/** A scan is deliberately small enough to be safe on a public RPC endpoint. */
export const DIRECT_POSITION_SCAN_MAX_IDS = 4_096;
export const DIRECT_POSITION_SCAN_INITIAL_IDS = 16;
export const DIRECT_POSITION_SCAN_BATCH_SIZE = 128;
export const DIRECT_POSITION_SCAN_CONCURRENCY = 2;
export const DIRECT_POSITION_SCAN_DEADLINE_MS = 12_000;
export const DIRECT_POSITION_CANDIDATE_CACHE_MAX_ENTRIES = 128;
export const DIRECT_POSITION_CANDIDATE_SESSION_KEY = 'fxaeon:position-candidates:v1';
const DIRECT_POSITION_CANDIDATE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

type ReadContract = FxPublicClient['readContract'];
type MulticallResult = { status?: string; result?: unknown } | unknown;
type DiscoveryClient = Pick<FxPublicClient, 'readContract'> & {
  multicall?: (args: {
    contracts: readonly {
      address: Address;
      abi: typeof POSITION_NFT_ABI;
      functionName: 'ownerOf';
      args: readonly [bigint];
    }[];
    allowFailure: true;
  }) => Promise<readonly MulticallResult[]>;
};

// Candidate IDs only. Accounting and actionability are never cached; every
// reuse is checked against the current balance and ownerOf values.
const candidateIdCache = new Map<string, number[]>();

export interface PositionCandidateStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

type StoredCandidate = { key: string; ids: number[]; updatedAt: number };

/** Parse a bounded session cache. Entries are untrusted candidate IDs only. */
export function parsePositionCandidateCache(raw: string | null, now = Date.now()): StoredCandidate[] {
  try {
    if (!raw || raw.length > 64_000) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > DIRECT_POSITION_CANDIDATE_CACHE_MAX_ENTRIES) return [];
    const seen = new Set<string>();
    return parsed.flatMap((value: unknown) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Partial<StoredCandidate>;
      if (typeof item.key !== 'string' || item.key.length > 180 || seen.has(item.key)
        || !Array.isArray(item.ids) || item.ids.length === 0 || item.ids.length > DIRECT_POSITION_SCAN_MAX_IDS
        || typeof item.updatedAt !== 'number' || !Number.isSafeInteger(item.updatedAt)
        || item.updatedAt > now || now - item.updatedAt > DIRECT_POSITION_CANDIDATE_MAX_AGE_MS
        || item.ids.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)) return [];
      const ids = [...new Set(item.ids as number[])].sort((a, b) => a - b);
      if (ids.length !== item.ids.length) return [];
      seen.add(item.key);
      return [{ key: item.key, ids, updatedAt: item.updatedAt }];
    });
  } catch { return []; }
}

/** Store candidate IDs in sessionStorage without treating them as verified state. */
export function storePositionCandidateIds(
  storage: PositionCandidateStorage | undefined,
  key: string,
  ids: readonly number[],
  now = Date.now(),
): void {
  if (!storage) return;
  try {
    const validated = uniqueVerifiedIds(ids);
    if (!validated.length || validated.length > DIRECT_POSITION_SCAN_MAX_IDS) return;
    const records = parsePositionCandidateCache(storage.getItem(DIRECT_POSITION_CANDIDATE_SESSION_KEY), now)
      .filter((record) => record.key !== key);
    records.push({ key, ids: validated, updatedAt: now });
    while (records.length > DIRECT_POSITION_CANDIDATE_CACHE_MAX_ENTRIES) records.shift();
    let serialized = JSON.stringify(records);
    while (serialized.length > 64_000 && records.length > 1) {
      records.shift();
      serialized = JSON.stringify(records);
    }
    if (serialized.length <= 64_000) storage.setItem(DIRECT_POSITION_CANDIDATE_SESSION_KEY, serialized);
  } catch { /* Storage denial must fall back to a canonical scan. */ }
}

function sessionCandidateStorage(): PositionCandidateStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage; }
  catch { return undefined; }
}

function readStoredPositionCandidateIds(storage: PositionCandidateStorage | undefined, key: string): number[] | undefined {
  if (!storage) return undefined;
  try { return parsePositionCandidateCache(storage.getItem(DIRECT_POSITION_CANDIDATE_SESSION_KEY)).find((record) => record.key === key)?.ids; }
  catch { return undefined; }
}

function removeStoredPositionCandidateIds(storage: PositionCandidateStorage | undefined, key: string): void {
  if (!storage) return;
  try {
    const records = parsePositionCandidateCache(storage.getItem(DIRECT_POSITION_CANDIDATE_SESSION_KEY)).filter((record) => record.key !== key);
    storage.setItem(DIRECT_POSITION_CANDIDATE_SESSION_KEY, JSON.stringify(records));
  } catch { /* Storage denial must not affect the canonical read. */ }
}

function rememberCandidateIds(cache: Map<string, number[]>, key: string, ids: readonly number[]): void {
  cache.delete(key);
  cache.set(key, [...ids]);
  while (cache.size > DIRECT_POSITION_CANDIDATE_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export interface DirectPositionDiscoveryParams {
  client: DiscoveryClient;
  group: PositionGroup;
  walletAddress: Address;
  /** IDs already hydrated and ownerOf-verified by the fast SDK path. */
  verifiedIndexerIds: readonly number[];
  /** ERC-721 balanceOf read immediately before discovery. */
  expectedCount?: bigint;
  /** Shared refresh deadline, so a slow indexer cannot add another full timeout. */
  deadlineAt?: number;
  /** Test hook: isolate the in-memory layer while exercising session-cache reuse. */
  memoryCandidates?: Map<string, number[]>;
  /** Test hook for sessionStorage-backed candidate reuse. */
  candidateStorage?: PositionCandidateStorage;
}

export interface DirectPositionDiscoveryResult {
  ids: number[];
  expectedCount: bigint;
  usedScan: boolean;
}

function assertPositionId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function readResult(value: unknown): unknown {
  if (value && typeof value === 'object' && 'status' in value) {
    const result = value as { status?: unknown; result?: unknown };
    return result.status === 'success' ? result.result : undefined;
  }
  return value;
}

function asCount(value: unknown): bigint {
  const result = readResult(value);
  if (typeof result !== 'bigint' || result < 0n) throw new TypeError('position NFT balance was malformed');
  return result;
}

function ownerMatches(value: unknown, walletAddress: string): boolean {
  const owner = readResult(value);
  return typeof owner === 'string' && owner.toLowerCase() === walletAddress.toLowerCase();
}

function asNextId(value: unknown): number {
  const result = readResult(value);
  if (typeof result !== 'bigint' || result < 1n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError('position NFT next ID was malformed');
  }
  return Number(result);
}

function uniqueVerifiedIds(ids: readonly number[]): number[] {
  const unique = new Set<number>();
  for (const id of ids) unique.add(assertPositionId(id, 'verified position ID'));
  return [...unique].sort((a, b) => a - b);
}

class DirectPositionDeadlineError extends Error {
  constructor() { super('direct position scan deadline exceeded'); }
}

async function withDeadline<T>(task: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new DirectPositionDeadlineError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DirectPositionDeadlineError()), remaining);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readBalance(client: DiscoveryClient, pool: Address, walletAddress: Address): Promise<bigint> {
  const value = await client.readContract({
    address: pool,
    abi: POSITION_NFT_ABI,
    functionName: 'balanceOf',
    args: [walletAddress],
  } as Parameters<ReadContract>[0]);
  return asCount(value);
}

/** Read the canonical ERC-721 ownership count before consulting the indexer. */
export async function readDirectWalletPositionCount(params: {
  client: DiscoveryClient;
  group: PositionGroup;
  walletAddress: Address;
  deadlineAt?: number;
}): Promise<bigint> {
  const deadline = params.deadlineAt ?? Date.now() + DIRECT_POSITION_SCAN_DEADLINE_MS;
  return withDeadline(readBalance(params.client, positionPoolAddress(params.group.market, params.group.side), params.walletAddress), deadline);
}

/** Batch initial pool counts on a chain-verified Ethereum client.
 * Failed/malformed slots retry the existing direct read within the same deadline;
 * they are never interpreted as an empty wallet. No count survives this refresh.
 */
export function readDirectWalletPositionCounts(params: {
  client: Pick<FxPublicClient, 'readContract'>;
  groups: readonly PositionGroup[];
  walletAddress: Address;
  deadlineAt?: number;
}): readonly Promise<bigint>[] {
  const deadline = params.deadlineAt ?? Date.now() + DIRECT_POSITION_SCAN_DEADLINE_MS;
  const readDirect = async (group: PositionGroup) => {
    // Do not start a fallback RPC after an exhausted aggregate deadline.
    if (Date.now() >= deadline) throw new Error('direct position scan deadline exceeded');
    return readDirectWalletPositionCount({ ...params, group, deadlineAt: deadline });
  };
  if (params.groups.length === 0) return [];
  const batch = (async () => {
    if (Date.now() >= deadline) throw new Error('direct position scan deadline exceeded');
    const results: unknown = await withDeadline(params.client.readContract({
      address: mainnet.contracts.multicall3.address,
      abi: multicall3Abi,
      functionName: 'aggregate3',
      args: [params.groups.map((group) => ({
        target: positionPoolAddress(group.market, group.side),
        allowFailure: true,
        callData: encodeFunctionData({ abi: POSITION_NFT_ABI, functionName: 'balanceOf', args: [params.walletAddress] }),
      }))],
    }), deadline);
    if (!Array.isArray(results) || results.length !== params.groups.length) throw new Error('position count multicall returned an incomplete batch');
    return results as unknown[];
  })();
  // Each failed slot can fall back independently; a hung fallback must not
  // consume the other groups' deadline before they begin their ownership work.
  return params.groups.map((group, index) => batch.then((results) => {
    const result = results[index];
    if (!result || typeof result !== 'object' || !('success' in result) || result.success !== true
      || !('returnData' in result) || typeof result.returnData !== 'string' || !/^0x[0-9a-f]*$/i.test(result.returnData)) {
      throw new Error('position count multicall slot was unavailable');
    }
    return asCount(decodeFunctionResult({ abi: POSITION_NFT_ABI, functionName: 'balanceOf', data: result.returnData as `0x${string}` }));
  }).catch((cause: unknown) => {
    // A fired deadline is final even if the wall clock has not caught up
    // with the timer or moved backwards. It must not start another RPC.
    if (cause instanceof DirectPositionDeadlineError) throw cause;
    return readDirect(group);
  }));
}

async function scanOwners(params: {
  client: DiscoveryClient;
  pool: Address;
  walletAddress: Address;
  nextId: number;
  expectedCount: bigint;
  deadline: number;
}): Promise<number[]> {
  if (!params.client.multicall) throw new Error('direct position scan requires multicall support');
  const found = new Set<number>();
  const lastId = params.nextId - 1;
  const firstId = Math.max(1, lastId - DIRECT_POSITION_SCAN_MAX_IDS + 1);
  // Probe a small recent tail before paying for two full batches. The cap is
  // a per-refresh work budget, not a limit on how many NFTs a pool may mint.
  // An older holding outside this window leaves discovery incomplete; only
  // the canonical wallet count can establish completeness.
  let windowEnd = lastId;
  let windowSize = DIRECT_POSITION_SCAN_INITIAL_IDS;
  while (windowEnd >= firstId) {
    if (Date.now() >= params.deadline) throw new Error('direct position scan deadline exceeded');
    const windowStart = Math.max(firstId, windowEnd - windowSize + 1);
    const jobs: Promise<readonly MulticallResult[]>[] = [];
    const batchStarts: number[] = [];
    for (let offset = 0; offset < DIRECT_POSITION_SCAN_CONCURRENCY; offset += 1) {
      const batchEnd = windowEnd - offset * DIRECT_POSITION_SCAN_BATCH_SIZE;
      if (batchEnd < windowStart) break;
      const batchStart = Math.max(windowStart, batchEnd - DIRECT_POSITION_SCAN_BATCH_SIZE + 1);
      batchStarts.push(batchStart);
      const contracts = Array.from({ length: batchEnd - batchStart + 1 }, (_, index) => ({
        address: params.pool,
        abi: POSITION_NFT_ABI,
        functionName: 'ownerOf' as const,
        args: [BigInt(batchStart + index)] as readonly [bigint],
      }));
      jobs.push(withDeadline(params.client.multicall({ contracts, allowFailure: true }), params.deadline));
    }
    const results = await Promise.all(jobs);
    results.forEach((batch, batchIndex) => {
      const batchStart = batchStarts[batchIndex]!;
      const batchEnd = windowEnd - batchIndex * DIRECT_POSITION_SCAN_BATCH_SIZE;
      if (batch.length !== batchEnd - batchStart + 1) throw new Error('direct position scan returned an incomplete batch');
      batch.forEach((result, index) => {
        if (ownerMatches(result, params.walletAddress)) found.add(batchStart + index);
      });
    });
    if (BigInt(found.size) === params.expectedCount) {
      // A balance reread closes the race where a new NFT arrives after the
      // initial count. If it changed, continue as incomplete rather than
      // presenting the early subset as the complete wallet.
      const finalCount = await withDeadline(readBalance(params.client, params.pool, params.walletAddress), params.deadline);
      if (finalCount === params.expectedCount) return [...found].sort((a, b) => a - b);
      throw new Error('direct position scan was incomplete');
    }
    windowEnd = windowStart - 1;
    windowSize = DIRECT_POSITION_SCAN_BATCH_SIZE * DIRECT_POSITION_SCAN_CONCURRENCY;
  }

  if (BigInt(found.size) !== params.expectedCount) {
    throw new Error('direct position scan was incomplete');
  }
  return [...found].sort((a, b) => a - b);
}

async function verifyCachedOwners(params: {
  client: DiscoveryClient;
  pool: Address;
  walletAddress: Address;
  ids: readonly number[];
  expectedCount: bigint;
  deadline: number;
}): Promise<number[] | null> {
  if (!params.client.multicall || BigInt(params.ids.length) !== params.expectedCount) return null;
  const results: MulticallResult[] = [];
  for (let start = 0; start < params.ids.length; start += DIRECT_POSITION_SCAN_BATCH_SIZE) {
    const batchIds = params.ids.slice(start, start + DIRECT_POSITION_SCAN_BATCH_SIZE);
    const batch = await withDeadline(params.client.multicall({
      contracts: batchIds.map((id) => ({
        address: params.pool,
        abi: POSITION_NFT_ABI,
        functionName: 'ownerOf' as const,
        args: [BigInt(id)] as readonly [bigint],
      })),
      allowFailure: true,
    }), params.deadline);
    results.push(...batch);
  }
  const valid = params.ids.filter((_, index) => ownerMatches(results[index], params.walletAddress));
  return BigInt(valid.length) === params.expectedCount ? [...valid] : null;
}

/**
 * Reconcile indexer IDs against the canonical ERC-721 count.  A complete
 * verified indexer response remains the fast path.  Any deficit or indexer
 * failure must take the bounded ownerOf path; a capped/failed scan rejects so
 * callers can retain a stale snapshot instead of presenting an empty wallet.
 */
export async function discoverDirectWalletPositionIds(
  params: DirectPositionDiscoveryParams,
): Promise<DirectPositionDiscoveryResult> {
  const pool = positionPoolAddress(params.group.market, params.group.side);
  const deadline = params.deadlineAt ?? Date.now() + DIRECT_POSITION_SCAN_DEADLINE_MS;
  const expectedCount = params.expectedCount ?? await withDeadline(readBalance(params.client, pool, params.walletAddress), deadline);
  if (expectedCount > BigInt(DIRECT_POSITION_SCAN_MAX_IDS)) {
    throw new Error(`position NFT balance exceeds ${DIRECT_POSITION_SCAN_MAX_IDS} supported IDs`);
  }

  const indexedIds = uniqueVerifiedIds(params.verifiedIndexerIds);
  const storage = params.candidateStorage ?? sessionCandidateStorage();
  const memoryCandidates = params.memoryCandidates ?? candidateIdCache;
  const cacheKey = `1:${pool.toLowerCase()}:${params.walletAddress.toLowerCase()}`;
  if (expectedCount === 0n) return { ids: [], expectedCount, usedScan: false };
  if (BigInt(indexedIds.length) === expectedCount) {
    rememberCandidateIds(memoryCandidates, cacheKey, indexedIds);
    storePositionCandidateIds(storage, cacheKey, indexedIds);
    return { ids: indexedIds, expectedCount, usedScan: false };
  }

  const cached = memoryCandidates.get(cacheKey) ?? readStoredPositionCandidateIds(storage, cacheKey);
  if (cached) {
    const reused = await verifyCachedOwners({
      client: params.client,
      pool,
      walletAddress: params.walletAddress,
      ids: cached,
      expectedCount,
      deadline,
    });
    if (reused) {
      rememberCandidateIds(memoryCandidates, cacheKey, reused);
      return { ids: reused, expectedCount, usedScan: true };
    }
    memoryCandidates.delete(cacheKey);
    removeStoredPositionCandidateIds(storage, cacheKey);
  }

  const nextIdValue = await withDeadline(params.client.readContract({
    address: pool,
    abi: POSITION_NFT_ABI,
    functionName: 'getNextPositionId',
  } as Parameters<ReadContract>[0]), deadline);
  const nextId = asNextId(nextIdValue);
  const ids = await scanOwners({ client: params.client, pool, walletAddress: params.walletAddress, nextId, expectedCount, deadline });
  rememberCandidateIds(memoryCandidates, cacheKey, ids);
  storePositionCandidateIds(storage, cacheKey, ids);
  return { ids, expectedCount, usedScan: true };
}
