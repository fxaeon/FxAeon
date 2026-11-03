import assert from 'node:assert/strict';
import test from 'node:test';
import { createPriceRuntimeBridge, type PriceContextValue } from '../src/components/PriceContext';

const value = (refresh: () => Promise<void>): PriceContextValue => ({
  prices: { ETH: 100 }, status: 'stale', updatedAt: 123,
  updatedAts: { ETH: 123 }, refreshing: false, refresh,
});

test('early refresh waits for the runtime, coalesces callers and stays honestly loading', async () => {
  const bridge = createPriceRuntimeBridge();
  let loads = 0;
  bridge.setLoader(() => { loads++; });
  const first = bridge.getSnapshot().refresh();
  const second = bridge.getSnapshot().refresh();
  assert.strictEqual(first, second);
  assert.equal(bridge.getSnapshot().status, 'loading');
  assert.equal(bridge.getSnapshot().updatedAt, null);
  assert.equal(bridge.getSnapshot().refreshing, false);
  let settled = false;
  void first.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(loads, 1);
  let reads = 0;
  let finish!: () => void;
  const gate = new Promise<void>(done => { finish = done; });
  bridge.publish(value(async () => { reads++; await gate; }));
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.equal(settled, false);
  finish();
  await first;
  assert.equal(settled, true);
});

test('publication preserves exact timestamps, stale status and latest refresh ownership', async () => {
  const bridge = createPriceRuntimeBridge();
  const refresh = bridge.getSnapshot().refresh;
  const called: number[] = [];
  let notifications = 0;
  const unsubscribe = bridge.subscribe(() => { notifications++; });
  const snapshot = value(async () => { called.push(1); });
  bridge.publish(snapshot);
  const published = bridge.getSnapshot();
  assert.strictEqual(published.prices, snapshot.prices);
  assert.strictEqual(published.updatedAts, snapshot.updatedAts);
  assert.equal(published.updatedAt, 123);
  assert.equal(published.status, 'stale');
  assert.strictEqual(published.refresh, refresh);
  bridge.publish(value(async () => { called.push(2); }));
  await refresh();
  assert.deepEqual(called, [2]);
  assert.equal(notifications, 2);
  unsubscribe();
  bridge.publish(snapshot);
  assert.equal(notifications, 2);
});

test('an import failure settles waiters as unavailable and allows another load attempt', async () => {
  const bridge = createPriceRuntimeBridge();
  let loads = 0;
  bridge.setLoader(() => { loads++; });
  const first = bridge.getSnapshot().refresh();
  bridge.fail();
  await first;
  assert.equal(bridge.getSnapshot().status, 'unavailable');
  assert.deepEqual(bridge.getSnapshot().prices, {});
  const retry = bridge.getSnapshot().refresh();
  assert.equal(loads, 2);
  bridge.publish(value(async () => undefined));
  await retry;
  bridge.fail();
  assert.equal(bridge.getSnapshot().status, 'stale');
  assert.equal(bridge.getSnapshot().updatedAt, 123);
});

test('unmount releases early waiters without publishing fabricated ready data', async () => {
  const bridge = createPriceRuntimeBridge();
  const pending = bridge.getSnapshot().refresh();
  bridge.release();
  await pending;
  assert.equal(bridge.getSnapshot().status, 'loading');
  assert.equal(bridge.getSnapshot().updatedAt, null);
});
