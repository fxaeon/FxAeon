import { formatUnits, type PublicClient } from 'viem';
import { getEthereumClient } from './fx/clients';
import { FX_SAVE_TOKEN_ADDRESS } from './fxSaveApy';
import { HISTORY_DAY_MS, HISTORY_TARGET_TOLERANCE_MS, RETURN_WINDOW_MS, type NavHistoryPoint, type SharePricePoint } from './fxSavePerformance';
export { HISTORY_DAY_MS, type SharePricePoint } from './fxSavePerformance';

export const FX_SAVE_SHARE_HISTORY_SOURCE = `https://etherscan.io/address/${FX_SAVE_TOKEN_ADDRESS}#readContract`;
export interface NavHistoryReader {
  /** Finalized Ethereum block: cached observations cannot reorg. */
  head(): Promise<bigint>;
  blockTimestamp(block: bigint): Promise<number>;
  sample(block: bigint): Promise<unknown>;
}
const NAV_ABI = [{ type: 'function', name: 'nav', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;
const STAMP_ABI = [{ type: 'function', name: 'getCurrentBlockTimestamp', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;
const readers = new WeakMap<object, NavHistoryReader>();
type HistoryCache = { targets: Map<number, bigint>; stamps: Map<bigint, number>; samples: Map<bigint, SharePricePoint> };
const caches = new WeakMap<NavHistoryReader, HistoryCache>();

export function parseNavSample(value: unknown, now: number): SharePricePoint {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'bigint' || typeof value[1] !== 'bigint') throw new Error('Invalid NAV observation');
  const timestamp = Number(value[0]) * 1000;
  const price = Number(formatUnits(value[1], 18));
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > now || timestamp < now - 123 * HISTORY_DAY_MS
    || !Number.isFinite(price) || price <= 0 || price >= 10) throw new Error('Invalid NAV observation');
  return { timestamp, price };
}

function protocolReader(): NavHistoryReader {
  const client = getEthereumClient() as unknown as Pick<PublicClient, 'getBlock' | 'multicall'>;
  let reader = readers.get(client);
  if (!reader) {
    reader = {
      head: async () => (await client.getBlock({ blockTag: 'finalized' })).number,
      blockTimestamp: async blockNumber => Number((await client.getBlock({ blockNumber })).timestamp) * 1000,
      sample: blockNumber => client.multicall({ blockNumber, allowFailure: false, contracts: [
        { address: '0xcA11bde05977b3631167028862bE2a173976CA11', abi: STAMP_ABI, functionName: 'getCurrentBlockTimestamp' },
        { address: FX_SAVE_TOKEN_ADDRESS, abi: NAV_ABI, functionName: 'nav' },
      ] }),
    };
    readers.set(client, reader);
  }
  return reader;
}

/** Six workers, at most eight block probes per target, and 30 days of warmup.
 * Block spacing is only an initial guess: accepted blocks must be at/before the
 * timestamp target within one minute. Cancellation stops scheduling/cache writes;
 * in-flight RPCs retain the public client's transport deadline. */
export async function fetchFxSaveShareHistory(signal?: AbortSignal, days: 30 | 90 = 30, options: { reader?: NavHistoryReader; now?: number; deadlineMs?: number } = {}): Promise<NavHistoryPoint[]> {
  if (days !== 30 && days !== 90) throw new Error('Invalid NAV history range');
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('NAV history timed out')), options.deadlineMs ?? 30_000);
  const check = () => controller.signal.throwIfAborted();
  const now = () => options.now ?? Date.now();
  try {
    const reader = options.reader ?? protocolReader();
    const cache: HistoryCache = caches.get(reader) ?? { targets: new Map(), stamps: new Map(), samples: new Map() };
    caches.set(reader, cache);
    const cutoff = now() - 123 * HISTORY_DAY_MS;
    for (const [target] of cache.targets) if (target < cutoff) cache.targets.delete(target);
    for (const [block, stamp] of cache.stamps) if (stamp < cutoff) { cache.stamps.delete(block); cache.samples.delete(block); }
    if (cache.stamps.size > 4096 || cache.samples.size > 1024 || cache.targets.size > 1024) {
      cache.stamps.clear(); cache.samples.clear(); cache.targets.clear();
    }
    const work = (async () => {
      const head = await reader.head();
      check();
      if (head < 1_000_000n) throw new Error('Invalid Ethereum history head');
      const sample = async (block: bigint) => {
        check();
        const cached = cache.samples.get(block);
        if (cached) return cached;
        const point = parseNavSample(await reader.sample(block), now());
        check();
        const stamp = cache.stamps.get(block);
        if (stamp !== undefined && stamp !== point.timestamp) throw new Error('NAV block timestamp mismatch');
        cache.samples.set(block, point); cache.stamps.set(block, point.timestamp);
        return point;
      };
      const latest = await sample(head);
      if (now() - latest.timestamp > 30 * 60_000) throw new Error('NAV history head is stale');
      const resolve = async (target: number): Promise<SharePricePoint> => {
        check();
        if (target === latest.timestamp) return sample(head);
        const cached = cache.targets.get(target);
        if (cached !== undefined) return sample(cached);
        let lower = 0n, upper = head;
        let block = head - BigInt(Math.ceil((latest.timestamp - target) / 12_000));
        for (let probe = 0; probe < 8; probe++) {
          check();
          if (block <= lower || block >= upper) block = (lower + upper) / 2n;
          if (block <= 0n || block >= head || upper - lower <= 1n) break;
          const stamp = cache.stamps.get(block) ?? await reader.blockTimestamp(block);
          check();
          if (!Number.isSafeInteger(stamp) || stamp <= 0 || stamp > latest.timestamp) throw new Error('Invalid historical block time');
          cache.stamps.set(block, stamp);
          const delta = target - stamp;
          if (delta >= 0 && delta <= HISTORY_TARGET_TOLERANCE_MS) {
            const point = await sample(block);
            check();
            cache.targets.set(target, block);
            return point;
          }
          if (delta < 0) upper = block; else lower = block;
          // Learn the observed spacing instead of repeatedly assuming 12s.
          // The bracket still bounds probes across outages or missed slots.
          const spacing = Math.max(1, (latest.timestamp - stamp) / Number(head - block));
          block += BigInt(delta > 0 ? Math.max(1, Math.floor(delta / spacing)) : Math.min(-1, Math.floor(delta / spacing)));
        }
        throw new Error('Historical timestamp could not be resolved');
      };
      const dayBoundary = Math.floor(latest.timestamp / HISTORY_DAY_MS) * HISTORY_DAY_MS;
      // Metadata belongs to this result, never to shared cached observations.
      const points: NavHistoryPoint[] = [];
      let cursor = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (!controller.signal.aborted) {
          const day = cursor++;
          if (day > days + 30) return;
          try { points.push({ ...await resolve(dayBoundary - day * HISTORY_DAY_MS) }); }
          catch { /* Missing archive state stays a gap. */ }
        }
      }));
      check();
      points.sort((a, b) => a.timestamp - b.timestamp);
      // Missed slots can make a daily anchor a few seconds too recent. Resolve
      // that endpoint's exact 30-day target rather than shortening its window.
      cursor = 0;
      const visible = points.filter(point => point.timestamp >= dayBoundary - days * HISTORY_DAY_MS - HISTORY_TARGET_TOLERANCE_MS);
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (!controller.signal.aborted) {
          const point = visible[cursor++];
          if (!point) return;
          const target = point.timestamp - RETURN_WINDOW_MS;
          const anchor = points.slice().reverse().find(candidate => candidate.timestamp <= target && target - candidate.timestamp <= HISTORY_TARGET_TOLERANCE_MS);
          try { point.windowStart = anchor ? { timestamp: anchor.timestamp, price: anchor.price } : { ...await resolve(target) }; }
          catch { /* NAV is still usable when its trailing return is unavailable. */ }
        }
      }));
      check();
      if (points.length < 2) throw new Error('NAV history unavailable');
      return points;
    })();
    return await Promise.race([work, new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(controller.signal.reason);
      else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
