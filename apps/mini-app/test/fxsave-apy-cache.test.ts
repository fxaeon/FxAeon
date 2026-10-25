import assert from 'node:assert/strict';
import test from 'node:test';
import { FX_SAVE_APY_MAX_AGE_MS, FX_SAVE_APY_REUSE_MS, fxSaveApyObservationIsCurrent, shouldRefreshFxSaveApy } from '../src/lib/fxSaveApyCache';
const now = 10_000_000;
const snapshot = { apy: 6.25, observedAt: now - 1_000 };

test('automatic activation reuses a recent APY, while manual refresh always requests a read', () => {
  assert.equal(shouldRefreshFxSaveApy(snapshot, false, now), false);
  assert.equal(shouldRefreshFxSaveApy(snapshot, true, now), true);
  assert.equal(shouldRefreshFxSaveApy({ ...snapshot, observedAt: now - FX_SAVE_APY_REUSE_MS }, false, now), true);
  assert.equal(snapshot.observedAt, now - 1_000);
});

test('five-minute expiry, future timestamps, failed data and invalid observations cannot be reused', () => {
  assert.equal(fxSaveApyObservationIsCurrent({ ...snapshot, observedAt: now - FX_SAVE_APY_MAX_AGE_MS + 1 }, now), true);
  for (const value of [null, { ...snapshot, observedAt: now - FX_SAVE_APY_MAX_AGE_MS }, { ...snapshot, observedAt: now + 1 }, { ...snapshot, observedAt: NaN }, { ...snapshot, apy: Infinity }]) {
    assert.equal(fxSaveApyObservationIsCurrent(value, now), false);
    assert.equal(shouldRefreshFxSaveApy(value, false, now), true);
  }
});
