import { formatUnits, type PublicClient } from 'viem';
import { getEthereumClient } from './fx/clients';
import { FX_SAVE_TOKEN_ADDRESS } from './fxSaveApy';

export const HISTORY_DAY_MS = 86_400_000;
export const FX_SAVE_SHARE_HISTORY_SOURCE = `https://etherscan.io/address/${FX_SAVE_TOKEN_ADDRESS}#readContract`;
export type SharePricePoint = { timestamp: number; price: number };
export interface NavHistoryReader {
  head(): Promise<bigint>;
  sample(block: bigint): Promise<unknown>;
}
const NAV_ABI = [{ type: 'function', name: 'nav', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;
const STAMP_ABI = [{ type: 'function', name: 'getCurrentBlockTimestamp', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;

/** Both values come from the same historical block, never a reconstructed APY. */
export function parseNavSample(value: unknown, now: number): SharePricePoint {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'bigint' || typeof value[1] !== 'bigint') throw new Error('Invalid NAV observation');
  const timestamp = Number(value[0]) * 1000;
  const price = Number(formatUnits(value[1], 18));
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > now || timestamp < now - 92 * HISTORY_DAY_MS
    || !Number.isFinite(price) || price <= .5 || price >= 10) throw new Error('Invalid NAV observation');
  return { timestamp, price };
}

function protocolReader(): NavHistoryReader {
  const client = getEthereumClient() as unknown as Pick<PublicClient, 'getBlockNumber' | 'multicall'>;
  return {
    head: () => client.getBlockNumber({ cacheTime: 0 }),
    sample: blockNumber => client.multicall({ blockNumber, allowFailure: false, contracts: [
      { address: '0xcA11bde05977b3631167028862bE2a173976CA11', abi: STAMP_ABI, functionName: 'getCurrentBlockTimestamp' },
      { address: FX_SAVE_TOKEN_ADDRESS, abi: NAV_ABI, functionName: 'nav' },
    ] }),
  };
}

/** Bounded archive reads. Block spacing only locates samples; timestamps and NAV
 * are read together on-chain. Missing archive data stays a gap. Six concurrent
 * reads at most, and no further work is queued after cancellation or timeout. */
export async function fetchFxSaveShareHistory(signal?: AbortSignal, days: 30 | 90 = 30, options: { reader?: NavHistoryReader; now?: number; deadlineMs?: number } = {}): Promise<SharePricePoint[]> {
  if (days !== 30 && days !== 90) throw new Error('Invalid NAV history range');
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('NAV history timed out')), options.deadlineMs ?? 20_000);
  const now = options.now ?? Date.now();
  try {
    const reader = options.reader ?? protocolReader();
    const work = (async () => {
      const head = await reader.head();
      controller.signal.throwIfAborted();
      if (head < 1_000_000n) throw new Error('Invalid Ethereum history head');
      const latest = parseNavSample(await reader.sample(head), now);
      if (now - latest.timestamp > 300_000) throw new Error('NAV history head is stale');
      const points: SharePricePoint[] = [latest];
      let cursor = 1;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (!controller.signal.aborted) {
          const day = cursor++;
          if (day >= days) return;
          const block = head - BigInt(day * 7150);
          try {
            const point = parseNavSample(await reader.sample(block), now);
            if (Math.abs(point.timestamp - (latest.timestamp - day * HISTORY_DAY_MS)) <= HISTORY_DAY_MS / 2) points.push(point);
          } catch { /* An unavailable historical state cannot become a zero. */ }
        }
      }));
      controller.signal.throwIfAborted();
      const byDay = new Map<number, SharePricePoint>();
      for (const point of points) {
        const day = Math.floor(point.timestamp / HISTORY_DAY_MS);
        if (!byDay.has(day) || byDay.get(day)!.timestamp < point.timestamp) byDay.set(day, point);
      }
      const unique = [...byDay.values()].sort((a, b) => a.timestamp - b.timestamp);
      if (unique.length < 6) throw new Error('NAV history unavailable');
      return unique;
    })();
    return await Promise.race([work, new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(controller.signal.reason);
      else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
