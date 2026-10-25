import type { FxSaveApyResponse } from './fxSaveApy';

export const FX_SAVE_APY_REUSE_MS = 60_000;
export const FX_SAVE_APY_MAX_AGE_MS = 5 * 60_000;

/** Display snapshots keep their original observation time through reuse/failure. */
export function fxSaveApyObservationIsCurrent(snapshot: FxSaveApyResponse | null, now = Date.now()): boolean {
  return Boolean(snapshot && Number.isFinite(snapshot.apy) && snapshot.apy >= 0
    && Number.isFinite(snapshot.observedAt) && snapshot.observedAt > 0
    && snapshot.observedAt <= now && now - snapshot.observedAt < FX_SAVE_APY_MAX_AGE_MS);
}
export function shouldRefreshFxSaveApy(snapshot: FxSaveApyResponse | null, force = false, now = Date.now()): boolean {
  return force || !fxSaveApyObservationIsCurrent(snapshot, now) || now - snapshot!.observedAt >= FX_SAVE_APY_REUSE_MS;
}
