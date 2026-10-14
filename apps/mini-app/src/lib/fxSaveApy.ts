/**
 * Display-only fxSAVE APY from the official f(x) Protocol data service.
 *
 * APY is intentionally kept outside the transaction/read facade: it is
 * informational market data and must never influence SDK plans, bounds, or
 * signing. The endpoint is the same official feed used by f(x)'s own web app.
 */

export const FX_SAVE_APY_ENDPOINT = 'https://api.aladdin.club/api1/concentrator_aToken_tvl_apy';
export const FX_SAVE_APY_DEADLINE_MS = 12_000;
export const FX_SAVE_TOKEN_ADDRESS = '0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39';

export type FxSaveApyResponse = {
  apy: number;
  observedAt: number;
  /** USD TVL reported by the same official feed for the verified fxSAVE address. */
  tvlUsd?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validate the official response instead of displaying an untrusted number. */
export function parseFxSaveApyResponse(payload: unknown, observedAt = Date.now()): FxSaveApyResponse {
  if (!isRecord(payload) || payload.code !== 200 || !isRecord(payload.data) || !isRecord(payload.data.fxSave)) {
    throw new Error('official fxSAVE APY response is malformed');
  }

  const fxSave = payload.data.fxSave;
  if (typeof fxSave.address !== 'string' || fxSave.address.toLowerCase() !== FX_SAVE_TOKEN_ADDRESS.toLowerCase()) {
    throw new Error('official fxSAVE APY response targets an unexpected token');
  }

  const rawApy = fxSave.apy;
  const apy = typeof rawApy === 'number' ? rawApy : typeof rawApy === 'string' && rawApy.trim() !== '' ? Number(rawApy) : Number.NaN;
  // A protocol APY is a percentage. Keep a generous upper bound to reject
  // corrupted/scam responses while allowing legitimate high-yield periods.
  if (!Number.isFinite(apy) || apy < 0 || apy > 1_000) {
    throw new Error('official fxSAVE APY value is invalid');
  }

  const rawTvl = fxSave.tvl;
  const tvl = typeof rawTvl === 'number' ? rawTvl : typeof rawTvl === 'string' && /^\d+(?:\.\d+)?$/.test(rawTvl) ? Number(rawTvl) : Number.NaN;
  return { apy, observedAt, ...(Number.isFinite(tvl) && tvl >= 0 && tvl <= 1e13 ? { tvlUsd: tvl } : {}) };
}

/** Fetch one bounded, abortable, display-only APY snapshot. */
export async function fetchFxSaveApy(signal?: AbortSignal): Promise<FxSaveApyResponse> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = globalThis.setTimeout(() => controller.abort(), FX_SAVE_APY_DEADLINE_MS);

  try {
    const response = await fetch(FX_SAVE_APY_ENDPOINT, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`official fxSAVE APY request failed (${response.status})`);
    return parseFxSaveApyResponse(await response.json());
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
