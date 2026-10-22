import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collateralScenarioLtv } from '../src/lib/borrowSensitivity';
import { fetchFxSaveHistory, FX_SAVE_HISTORY_ENDPOINT, FX_SAVE_HISTORY_FALLBACK_ENDPOINT, HISTORY_DAY_MS, parseFxSaveHistory, yieldHistoryRange } from '../src/lib/fxSaveHistory';

const now = Date.UTC(2026, 9, 23, 12);
const samples = Array.from({ length: 100 }, (_, index) => ({ timestamp: new Date(now - (99 - index) * HISTORY_DAY_MS).toISOString(), apy: 6 + index / 100 }));

test('history keeps recent daily observations in time order and selects thirty or ninety days', () => {
  const points = parseFxSaveHistory({ status: 'success', data: [...samples].reverse() }, now);
  assert.equal(yieldHistoryRange(points, 30).length, 30);
  assert.equal(yieldHistoryRange(points, 90).length, 90);
  assert.equal(points.at(-1)?.apy, 6.99);
  assert.equal(yieldHistoryRange([], 30).length, 0);
});

test('history rejects unavailable, stale and insufficient series without inventing values', () => {
  assert.throws(() => parseFxSaveHistory({ status: 'error', data: samples }, now));
  assert.throws(() => parseFxSaveHistory({ status: 'success', data: samples.slice(0, 90) }, now));
  assert.throws(() => parseFxSaveHistory({ status: 'success', data: samples.slice(-5) }, now));
  assert.throws(() => parseFxSaveHistory({ status: 'success', data: Array(5001).fill(samples[0]) }, now));
});

test('history never accepts future, nonfinite, negative or string-valued APYs', () => {
  const invalid = [null, '6', -1, Infinity, NaN, 1_001].map(apy => ({ timestamp: new Date(now).toISOString(), apy }));
  invalid.push({ timestamp: new Date(now + HISTORY_DAY_MS).toISOString(), apy: 900 });
  const points = parseFxSaveHistory({ status: 'success', data: [...samples, ...invalid] }, now);
  assert.equal(points.at(-1)?.apy, 6.99);
  const duplicate = { timestamp: new Date(now - 1_000).toISOString(), apy: 7 };
  assert.equal(parseFxSaveHistory({ status: 'success', data: [...samples, duplicate] }, now).at(-1)?.apy, 6.99);
});

test('fetch uses only the pinned public history endpoint and omits credentials', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    assert.equal(url, FX_SAVE_HISTORY_ENDPOINT);
    assert.equal(init?.credentials, 'omit');
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ status: 'success', data: samples.map((row, index) => ({ ...row, timestamp: new Date(Date.now() - (99 - index) * HISTORY_DAY_MS).toISOString() })) }));
  }) as typeof fetch;
  try { assert.ok((await fetchFxSaveHistory()).length >= 90); }
  finally { globalThis.fetch = original; }
});

test('caller cancellation reaches the history fetch and failures propagate', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  controller.abort();
  globalThis.fetch = (async (_url, init) => {
    calls += 1;
    assert.equal(init?.signal?.aborted, true);
    throw new DOMException('Aborted', 'AbortError');
  }) as typeof fetch;
  try { await assert.rejects(fetchFxSaveHistory(controller.signal), { name: 'AbortError' }); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});

test('history migration falls back once, validates the replacement and fails closed if both fail', async () => {
  const original = globalThis.fetch;
  const calls: unknown[] = [];
  const fresh = { status: 'success', data: samples.map((row, index) => ({ ...row, timestamp: new Date(Date.now() - (99 - index) * HISTORY_DAY_MS).toISOString() })) };
  let replacement: unknown = fresh;
  globalThis.fetch = (async (url, init) => {
    calls.push(url);
    assert.equal(init?.credentials, 'omit');
    return url === FX_SAVE_HISTORY_ENDPOINT ? new Response('', { status: 410 }) : new Response(JSON.stringify(replacement));
  }) as typeof fetch;
  try {
    assert.ok((await fetchFxSaveHistory()).length >= 90);
    assert.deepEqual(calls, [FX_SAVE_HISTORY_ENDPOINT, FX_SAVE_HISTORY_FALLBACK_ENDPOINT]);
    calls.length = 0;
    replacement = { status: 'success', data: [] };
    await assert.rejects(fetchFxSaveHistory());
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});

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
