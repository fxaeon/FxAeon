import type { FxSdkMarket } from './tokens';

/** Public funding index used by https://fx.aladdin.club/v2/fxmint Advanced.
 * Verified against its deployed fxmint-da8f9e44ac276187.js bundle (2026-10-24).
 * Snapshots are annual 1e18 ratios; the official chart divides by 365 * 3.
 * These are gross collateral charges, not yield or the net short-pool offset. */
export const BORROW_FUNDING_HISTORY_URL = 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-funding/v0.0.2/gn';
export type BorrowFundingHistoryRange = '1M' | '3M' | '6M' | '1Y' | 'All';
export const BORROW_FUNDING_HISTORY_RANGE_SECONDS: Readonly<Record<Exclude<BorrowFundingHistoryRange, 'All'>, number>> = {
  '1M': 30 * 86_400,
  '3M': 90 * 86_400,
  '6M': 180 * 86_400,
  '1Y': 365 * 86_400,
};
const PAGE_SIZE = 1000;
const MAX_PAGES = 8;
const MAX_INDEX_AGE_SECONDS = 24 * 60 * 60;

export type BorrowFundingSnapshot = { timestamp: number; ratio: bigint };
export type BorrowFundingHistory = {
  market: FxSdkMarket;
  snapshots: BorrowFundingSnapshot[];
  startAt: number;
  /** End at the index's verified block, never extend a historical rate to now. */
  endAt: number;
  indexedAt: number;
  /** Time-weighted annual charge across the complete covered interval. */
  averageRatio: bigint | null;
};

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function uint(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new Error('Funding history contains invalid numbers');
  const parsed = BigInt(value);
  if (parsed >= 2n ** 256n) throw new Error('Funding history contains invalid numbers');
  return parsed;
}

function parseSnapshot(value: unknown, type: string, endAt: number): BorrowFundingSnapshot {
  const row = record(value);
  if (record(row?.fundingId)?.type !== type) throw new Error('Funding history market does not match');
  const timestamp = Number(uint(row?.timestamp));
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > endAt) throw new Error('Funding history contains an invalid timestamp');
  return { timestamp, ratio: uint(row?.fundingRate) };
}

/** Stepwise integration of rate snapshots; no interpolation across missing coverage. */
export function averageBorrowFundingRatio(snapshots: readonly BorrowFundingSnapshot[], startAt: number, endAt: number): bigint | null {
  if (!snapshots.length || snapshots[0].timestamp > startAt || endAt <= startAt) return null;
  let cursor = startAt;
  let ratio = snapshots[0].ratio;
  let weighted = 0n;
  for (const row of snapshots) {
    if (row.timestamp <= startAt) { ratio = row.ratio; continue; }
    if (row.timestamp > endAt) break;
    weighted += ratio * BigInt(row.timestamp - cursor);
    cursor = row.timestamp;
    ratio = row.ratio;
  }
  weighted += ratio * BigInt(endAt - cursor);
  return weighted / BigInt(endAt - startAt);
}

/** Bounded, cancellable, read-only history with exact market identities and
 * pagination pinned to one index block, so concurrent updates cannot drop rows. */
export async function readBorrowFundingHistory(market: FxSdkMarket, options: { fetch?: typeof fetch; now?: number; signal?: AbortSignal; deadlineMs?: number; range?: BorrowFundingHistoryRange } = {}): Promise<BorrowFundingHistory> {
  if (market !== 'ETH' && market !== 'BTC') throw new Error('Funding history market unavailable');
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const range = options.range ?? '1Y';
  if (range !== 'All' && !Object.hasOwn(BORROW_FUNDING_HISTORY_RANGE_SECONDS, range)) throw new Error('Funding history range unavailable');
  // Unix timestamp 1 includes every indexed record without asking the indexer
  // for a predecessor that cannot exist before the beginning of time.
  const startAt = range === 'All' ? 1 : now - BORROW_FUNDING_HISTORY_RANGE_SECONDS[range];
  const type = market === 'ETH' ? 'wstETH' : 'WBTC';
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(), options.deadlineMs ?? 12_000);
  try {
    const request = async (query: string) => {
      const response = await (options.fetch ?? fetch)(BORROW_FUNDING_HISTORY_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }), signal: controller.signal,
      });
      if (!response.ok) throw new Error('Funding history is unavailable');
      const result = record(await response.json());
      const data = record(result?.data);
      if (result?.errors || !data) throw new Error('Funding history is unavailable');
      return data;
    };
    const fields = 'fundingRate timestamp fundingId { type }';
    const previousField = range === 'All' ? '' : `previous: snapshots(first: 1, orderBy: timestamp, orderDirection: desc, where: {timestamp_lt: "${startAt}", fundingId_: {type: "${type}"}}) { ${fields} }`;
    const initial = await request(`{ _meta { block { number timestamp } hasIndexingErrors } ${previousField} snapshots(first: ${PAGE_SIZE}, orderBy: timestamp, orderDirection: asc, where: {timestamp_gte: "${startAt}", fundingId_: {type: "${type}"}}) { ${fields} } }`);
    const meta = record(initial._meta);
    const block = record(meta?.block);
    const indexedAt = block?.timestamp;
    const blockNumber = block?.number;
    if (meta?.hasIndexingErrors !== false || typeof indexedAt !== 'number' || !Number.isSafeInteger(indexedAt)
      || indexedAt <= startAt || indexedAt > now + 60 || now - indexedAt > MAX_INDEX_AGE_SECONDS
      || typeof blockNumber !== 'number' || !Number.isSafeInteger(blockNumber) || blockNumber <= 0) throw new Error('Funding history index is not current');
    const endAt = Math.min(indexedAt, now);
    const previous = range === 'All' ? [] : initial.previous;
    if (!Array.isArray(previous) || previous.length > 1 || !Array.isArray(initial.snapshots)) throw new Error('Funding history is incomplete');
    const rows: BorrowFundingSnapshot[] = previous.map(value => parseSnapshot(value, type, endAt));
    if (rows.some(row => row.timestamp >= startAt)) throw new Error('Funding history baseline is invalid');
    let page = initial.snapshots;
    for (let index = 0; index < MAX_PAGES; index += 1) {
      if (page.length > PAGE_SIZE) throw new Error('Funding history is incomplete');
      for (const value of page) {
        const row = parseSnapshot(value, type, endAt);
        if (row.timestamp < startAt || (rows.length && row.timestamp < rows[rows.length - 1].timestamp)) throw new Error('Funding history is out of order');
        rows.push(row);
      }
      if (page.length < PAGE_SIZE) {
        if (!rows.length) throw new Error('Funding history has no observations');
        const coveredStart = Math.max(startAt, rows[0].timestamp);
        return { market, snapshots: rows, startAt: coveredStart, endAt, indexedAt, averageRatio: averageBorrowFundingRatio(rows, coveredStart, endAt) };
      }
      if (index === MAX_PAGES - 1) throw new Error('Funding history exceeds the supported window');
      const next = await request(`{ snapshots(first: ${PAGE_SIZE}, skip: ${(index + 1) * PAGE_SIZE}, block: {number: ${blockNumber}}, orderBy: timestamp, orderDirection: asc, where: {timestamp_gte: "${startAt}", fundingId_: {type: "${type}"}}) { ${fields} } }`);
      if (!Array.isArray(next.snapshots)) throw new Error('Funding history is incomplete');
      page = next.snapshots;
    }
    throw new Error('Funding history is incomplete');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
