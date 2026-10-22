/** Display-only daily APY. This series never supplies a quote or signing input. */
export const FX_SAVE_HISTORY_SOURCE = 'https://defillama.com/yields/pool/ee0b7069-f8f3-4aa2-a415-728f13e6cc3d';
// The source identifies Ethereum fxSAVE, 0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39.
export const FX_SAVE_HISTORY_ENDPOINT = 'https://yields.llama.fi/chart/ee0b7069-f8f3-4aa2-a415-728f13e6cc3d';
// DefiLlama announces a 2026-11-13 migration. Keep the live endpoint first;
// the documented replacement still returns 404 as of 2026-10-23.
export const FX_SAVE_HISTORY_FALLBACK_ENDPOINT = 'https://api.llama.fi/chart/ee0b7069-f8f3-4aa2-a415-728f13e6cc3d';
export const HISTORY_DAY_MS = 86_400_000;
export type YieldPoint = { timestamp: number; apy: number };

export function parseFxSaveHistory(payload: unknown, now = Date.now()): YieldPoint[] {
  if (!payload || typeof payload !== 'object' || !('status' in payload) || payload.status !== 'success'
    || !('data' in payload) || !Array.isArray(payload.data) || payload.data.length > 5_000) {
    throw new Error('Yield history is unavailable');
  }
  const days = new Map<number, YieldPoint>();
  for (const row of payload.data) {
    if (!row || typeof row !== 'object' || typeof row.timestamp !== 'string') continue;
    const timestamp = Date.parse(row.timestamp);
    if (!Number.isFinite(timestamp) || timestamp > now || timestamp < now - 91 * HISTORY_DAY_MS) continue;
    if (typeof row.apy !== 'number' || !Number.isFinite(row.apy) || row.apy < 0 || row.apy > 1_000) continue;
    const day = Math.floor(timestamp / HISTORY_DAY_MS);
    if ((days.get(day)?.timestamp ?? 0) < timestamp) days.set(day, { timestamp, apy: row.apy });
  }
  const points = [...days.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (points.length < 6 || now - points[points.length - 1].timestamp > 3 * HISTORY_DAY_MS) {
    throw new Error('Recent yield history is unavailable');
  }
  return points;
}

export function yieldHistoryRange(points: readonly YieldPoint[], days: 30 | 90): YieldPoint[] {
  const latest = points.at(-1)?.timestamp;
  return latest === undefined ? [] : points.filter(point => point.timestamp > latest - days * HISTORY_DAY_MS);
}

export async function fetchFxSaveHistory(signal?: AbortSignal): Promise<YieldPoint[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 10_000);
  try {
    for (const endpoint of [FX_SAVE_HISTORY_ENDPOINT, FX_SAVE_HISTORY_FALLBACK_ENDPOINT]) {
      try {
        const response = await fetch(endpoint, {
          signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit',
        });
        if (!response.ok) throw new Error('Yield history is unavailable');
        return parseFxSaveHistory(await response.json());
      } catch (error) {
        if (controller.signal.aborted || endpoint === FX_SAVE_HISTORY_FALLBACK_ENDPOINT) throw error;
      }
    }
    throw new Error('Yield history is unavailable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
