import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collateralScenarioLtv } from '../src/lib/borrowSensitivity';
test('collateral sensitivity uses entered debt, holds it fixed and rounds LTV upward', () => {
  const unit = 10n ** 18n;
  assert.equal(collateralScenarioLtv(50n * unit, 100n * unit, 0), 50);
  assert.equal(collateralScenarioLtv(50n * unit, 100n * unit, -20), 62.5);
  assert.equal(collateralScenarioLtv(50n * unit, 100n * unit, 20), 41.67);
  assert.equal(collateralScenarioLtv(unit, 3n * unit, 0), 33.34);
  for (const [debt, collateral, change] of [[0n, unit, 0], [unit, 0n, 0], [unit, unit, -100], [unit, unit, 31], [unit, unit, .1]] as const) {
    assert.equal(collateralScenarioLtv(debt, collateral, change), null);
  }
  assert.equal(collateralScenarioLtv(2n ** 255n, 1n, -30), null);
});
