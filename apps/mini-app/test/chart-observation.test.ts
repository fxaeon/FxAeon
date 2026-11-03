import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartObservationIndex, chartObservationSegment, chartStepObservations } from '../src/lib/chartObservation';

const points = [100, 110, 180, 400].map(timestamp => ({ timestamp }));
test('nearest observation uses irregular timestamps, clamps edges, and keeps earlier ties', () => {
  for (const [time, index] of [[0, 0], [105, 0], [106, 1], [144, 1], [146, 2], [399, 3], [1000, 3]]) {
    assert.equal(chartObservationIndex(points, time, 'nearest'), index);
  }
  assert.equal(chartObservationIndex([], 100, 'nearest'), null);
  assert.equal(chartObservationIndex(points, NaN, 'nearest'), null);
});
test('funding selects the held rate, never a future snapshot or interpolated rate', () => {
  for (const [time, index] of [[90, 0], [109, 0], [110, 1], [179, 1], [180, 2], [399, 2], [400, 3], [500, 3]]) {
    assert.equal(chartObservationIndex(points, time, 'step'), index);
  }
});
test('an anchor before the plot remains the actual observation and gaps isolate motion', () => {
  assert.equal(chartObservationIndex(points, 150, 'step'), 1);
  assert.equal(points[chartObservationIndex(points, 150, 'step')!].timestamp, 110);
  assert.deepEqual(points.map((_, index) => chartObservationSegment(points, index, 100)), [0, 0, 0, 1]);
  assert.equal(chartObservationSegment([], -1, 100), 0);
});

test('equal-time funding rows use the last rate at boundaries and within the window without mutating input', () => {
  const rows = [{ timestamp: 90, ratio: 1n }, { timestamp: 100, ratio: 2n }, { timestamp: 100, ratio: 3n },
    { timestamp: 180, ratio: 4n }, { timestamp: 180, ratio: 5n }, { timestamp: 400, ratio: 6n }, { timestamp: 400, ratio: 0n }];
  const before = structuredClone(rows);
  const visible = chartStepObservations(rows, 100);
  assert.deepEqual(visible, [rows[2], rows[4], rows[6]]);
  assert.deepEqual(rows, before);
  assert.equal(visible[chartObservationIndex(visible, 399, 'step')!].ratio, 5n);
  assert.equal(visible[chartObservationIndex(visible, 400, 'step')!].ratio, 0n);
  assert.equal(new Set(visible.map(point => point.timestamp)).size, visible.length);
});

test('duplicate pre-window snapshots retain the last actual baseline, including single-point and empty histories', () => {
  const rows = [{ timestamp: 90, ratio: 1n }, { timestamp: 90, ratio: 2n }, { timestamp: 180, ratio: 3n }];
  assert.deepEqual(chartStepObservations(rows, 100), [rows[1], rows[2]]);
  assert.deepEqual(chartStepObservations(rows, 200), [rows[2]]);
  assert.deepEqual(chartStepObservations(rows.slice(0, 1), 100), [rows[0]]);
  assert.deepEqual(chartStepObservations([], 100), []);
});
