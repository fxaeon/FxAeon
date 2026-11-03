import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartObservationIndex, chartObservationSegment } from '../src/lib/chartObservation';

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
