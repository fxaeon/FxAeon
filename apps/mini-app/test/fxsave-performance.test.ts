import test from 'node:test';
import assert from 'node:assert/strict';
import { annualizedNavReturn, trailingNavReturns, navHistoryRange, navPeriodReturn, HISTORY_DAY_MS, RETURN_WINDOW_MS } from '../src/lib/fxSavePerformance';
const end = Date.UTC(2026, 10, 3);
const point = (ago: number, price: number) => ({ timestamp: end - ago, price });

test('annualizes full 30-day NAV growth using actual elapsed milliseconds, including negative and flat returns', () => {
  for (const rate of [-.25, 0, .08]) {
    const elapsed = RETURN_WINDOW_MS + 24_000;
    const growth = (1 + rate) ** (elapsed / (365 * HISTORY_DAY_MS));
    const result = annualizedNavReturn(point(elapsed, 1.1), point(0, 1.1 * growth));
    assert.ok(result !== null && Math.abs(result - rate * 100) < 1e-10);
  }
});

test('requires a complete 30-day window, with no interpolation or oversized substitute', () => {
  for (const elapsed of [0, HISTORY_DAY_MS, RETURN_WINDOW_MS - 1, RETURN_WINDOW_MS + 60_001]) {
    assert.equal(annualizedNavReturn(point(elapsed, 1), point(0, 1.01)), null);
  }
  for (const price of [0, -1, NaN, Infinity]) assert.equal(annualizedNavReturn(point(RETURN_WINDOW_MS, price), point(0, 1)), null);
  assert.equal(annualizedNavReturn({ timestamp: NaN, price: 1 }, point(0, 1)), null);
});

test('keeps gaps when the anchor is missing and never fills with quoted APY', () => {
  assert.deepEqual(trailingNavReturns([point(29 * HISTORY_DAY_MS, 1), point(0, 1.01)]), []);
  const complete = trailingNavReturns([point(RETURN_WINDOW_MS, 1), point(0, 1.01)]);
  assert.equal(complete.length, 1, 'intermediate daily samples are not required for a measured endpoint return');
  assert.equal(complete[0].timestamp, end);
  assert.ok(complete[0].value > 12);
});

test('exact endpoint anchors cover missed slots without rounding a short window up', () => {
  const start = point(RETURN_WINDOW_MS - 12_000, 1);
  const last = point(0, 1.01);
  assert.deepEqual(trailingNavReturns([start, last]), []);
  assert.equal(trailingNavReturns([start, { ...last, windowStart: point(RETURN_WINDOW_MS + 12_000, 1) }]).length, 1);
});

test('warmup never appears in the selected plot and actual period return is not annualized', () => {
  const points = Array.from({ length: 121 }, (_, i) => point((120 - i) * HISTORY_DAY_MS, 1 + i / 1000));
  assert.equal(navHistoryRange(points, 30, end).length, 31);
  const visible = navHistoryRange(trailingNavReturns(points), 90, end);
  assert.equal(visible.length, 91);
  const period = navPeriodReturn([point(30 * HISTORY_DAY_MS, 1), point(0, 1.01)])!;
  assert.equal(period.days, 30);
  assert.ok(Math.abs(period.percent - 1) < 1e-12);
  assert.equal(navPeriodReturn([point(0, 1)]), null);
});

test('block times just before UTC midnight do not expose an extra warmup day', () => {
  const points = Array.from({ length: 61 }, (_, i) => point((60 - i) * HISTORY_DAY_MS + 12_000, 1 + i / 1000));
  assert.equal(navHistoryRange(points, 30, end - 12_000).length, 31);
});
