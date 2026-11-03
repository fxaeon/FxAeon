/** Pure, display-only performance math. Never a quote or transaction input. */
export const HISTORY_DAY_MS = 86_400_000;
export const RETURN_WINDOW_MS = 30 * HISTORY_DAY_MS;
export const HISTORY_TARGET_TOLERANCE_MS = 60_000;
export type SharePricePoint = { timestamp: number; price: number };
export type NavHistoryPoint = SharePricePoint & { windowStart?: SharePricePoint };
export type ReturnPoint = { timestamp: number; value: number };

function valid(point: SharePricePoint): boolean {
  return Number.isSafeInteger(point.timestamp) && point.timestamp > 0 && Number.isFinite(point.price) && point.price > 0;
}

/** Never annualize a shorter substitute. A block just before the target is
 * allowed; its actual elapsed time, including those extra seconds, is used. */
export function annualizedNavReturn(start: SharePricePoint, end: SharePricePoint): number | null {
  const elapsed = end.timestamp - start.timestamp;
  if (!valid(start) || !valid(end) || elapsed < RETURN_WINDOW_MS || elapsed > RETURN_WINDOW_MS + HISTORY_TARGET_TOLERANCE_MS) return null;
  const value = Math.expm1(Math.log(end.price / start.price) * (365 * HISTORY_DAY_MS / elapsed)) * 100;
  return Number.isFinite(value) ? value : null;
}

export function trailingNavReturns(points: readonly NavHistoryPoint[]): ReturnPoint[] {
  const sorted = points.filter(valid).slice().sort((a, b) => a.timestamp - b.timestamp);
  const result: ReturnPoint[] = [];
  let start = 0;
  for (const end of sorted) {
    const target = end.timestamp - RETURN_WINDOW_MS;
    while (start + 1 < sorted.length && sorted[start + 1].timestamp <= target) start++;
    const anchor = end.windowStart ?? sorted[start];
    const value = anchor ? annualizedNavReturn(anchor, end) : null;
    if (value !== null) result.push({ timestamp: end.timestamp, value });
  }
  return result;
}

/** UTC boundaries are stable across range changes; the warmup stays hidden. */
export function navHistoryRange<T extends { timestamp: number }>(points: readonly T[], days: 30 | 90, latest: number): T[] {
  const cutoff = Math.floor((latest + HISTORY_TARGET_TOLERANCE_MS) / HISTORY_DAY_MS) * HISTORY_DAY_MS - days * HISTORY_DAY_MS - HISTORY_TARGET_TOLERANCE_MS;
  return points.filter(point => point.timestamp >= cutoff && point.timestamp <= latest);
}

export function navPeriodReturn(points: readonly SharePricePoint[]): { percent: number; days: number } | null {
  const first = points[0], last = points.at(-1);
  if (!first || !last || !valid(first) || !valid(last) || last.timestamp <= first.timestamp) return null;
  const percent = (last.price / first.price - 1) * 100;
  return Number.isFinite(percent) ? { percent, days: (last.timestamp - first.timestamp) / HISTORY_DAY_MS } : null;
}
