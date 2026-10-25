import { HISTORY_DAY_MS } from './fxSaveHistory';
import { FX_SAVE_TOKEN_ADDRESS } from './fxSaveApy';

export const FX_SAVE_SHARE_HISTORY_KEY = `ethereum:${FX_SAVE_TOKEN_ADDRESS}`;
export const FX_SAVE_SHARE_HISTORY_ENDPOINT = `https://coins.llama.fi/chart/${FX_SAVE_SHARE_HISTORY_KEY}?span=90&period=1d&searchWidth=6h`;
export const FX_SAVE_SHARE_HISTORY_FALLBACK = `https://api.llama.fi/chart/${FX_SAVE_SHARE_HISTORY_KEY}?span=90&period=1d&searchWidth=6h`;
export const FX_SAVE_SHARE_HISTORY_SOURCE = FX_SAVE_SHARE_HISTORY_ENDPOINT;
export type SharePricePoint = { timestamp: number; price: number };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Reported token USD prices, not protocol NAV, APY or a redemption quote. */
export function parseFxSaveShareHistory(payload: unknown, now = Date.now()): SharePricePoint[] {
  if (!record(payload) || !record(payload.coins)) throw new Error('Share value history unavailable');
  const coin = Object.entries(payload.coins).find(([key]) => key.toLowerCase() === FX_SAVE_SHARE_HISTORY_KEY.toLowerCase())?.[1];
  if (!record(coin) || coin.symbol !== 'fxSAVE' || coin.decimals !== 18 || typeof coin.confidence !== 'number' || !Number.isFinite(coin.confidence) || coin.confidence < .5 || coin.confidence > 1 || !Array.isArray(coin.prices) || coin.prices.length > 5_000) throw new Error('Share value history unavailable');
  const days = new Map<number, SharePricePoint>();
  for (const row of coin.prices) {
    if (!record(row) || typeof row.timestamp !== 'number' || !Number.isSafeInteger(row.timestamp) || typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price <= 0) continue;
    const timestamp = row.timestamp * 1000;
    if (timestamp > now || timestamp < now - 91 * HISTORY_DAY_MS) continue;
    const day = Math.floor(timestamp / HISTORY_DAY_MS);
    if ((days.get(day)?.timestamp ?? 0) < timestamp) days.set(day, { timestamp, price: row.price });
  }
  const points = [...days.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (points.length < 6 || now - points[points.length - 1].timestamp > 3 * HISTORY_DAY_MS) throw new Error('Recent share value history unavailable');
  return points;
}

export async function fetchFxSaveShareHistory(signal?: AbortSignal): Promise<SharePricePoint[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 10_000);
  try {
    for (const endpoint of [FX_SAVE_SHARE_HISTORY_ENDPOINT, FX_SAVE_SHARE_HISTORY_FALLBACK]) {
      try {
        const response = await fetch(endpoint, { signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit' });
        if (!response.ok) throw new Error('Share value history unavailable');
        return parseFxSaveShareHistory(await response.json());
      } catch (error) {
        if (controller.signal.aborted || endpoint === FX_SAVE_SHARE_HISTORY_FALLBACK) throw error;
      }
    }
    throw new Error('Share value history unavailable');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
