import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLandingMarketData } from '../market-data.mjs';
import { startLandingMarketData } from '../market-data-client.mjs';

const ETH = 'ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const BTC = 'ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

class FakeTarget extends EventTarget {
  constructor() {
    super();
    this.navigator = { onLine: true };
    this.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    this.timers = new Map();
    this.nextTimer = 1;
  }
  setTimeout(callback, delay) {
    const id = this.nextTimer++;
    this.timers.set(id, { callback, delay });
    return id;
  }
  clearTimeout(id) { this.timers.delete(id); }
  fire(type) { this.dispatchEvent(new Event(type)); }
  changeVisibility(state) {
    this.document.visibilityState = state;
    this.document.dispatchEvent(new Event('visibilitychange'));
  }
}

function pollTimerCount(target) {
  return [...target.timers.values()].filter((timer) => timer.delay === 60_000).length;
}

function feedSnapshot(now, eth = 2_400) {
  const timestamp = Math.floor((now - 30_000) / 1000);
  return normalizeLandingMarketData({
    now,
    pricePayload: { coins: {
      [ETH]: { price: eth, timestamp, confidence: 0.99 },
      [BTC]: { price: 80_000, timestamp, confidence: 0.99 },
    } },
    priceFetchedAt: now,
    fxSavePayload: { code: 200, data: { fxSave: {
      address: '0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39', apy: '6.38', tvl: '85284837.6280',
    } } },
    fxSaveFetchedAt: now,
  });
}

async function flushMicrotasks() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test('only the newest overlapping refresh may publish or schedule the next poll', async () => {
  const target = new FakeTarget();
  const requests = [];
  const client = startLandingMarketData({ target, fetchImpl: () => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  } });
  assert.equal(requests.length, 1, 'start begins one foreground refresh');

  const older = requests[0];
  const newestRefresh = client.refresh();
  assert.equal(requests.length, 2);
  const newest = requests[1];
  newest.resolve({ ok: true, json: async () => feedSnapshot(Date.now(), 2_500) });
  await newestRefresh;
  older.resolve({ ok: true, json: async () => feedSnapshot(Date.now(), 2_000) });
  await flushMicrotasks();

  assert.equal(target.__fxaeonMarketData.ethUsd.value, 2_500);
  assert.equal(target.timers.size, 1, 'only the current generation schedules a poll');
  client.stop();
});

test('foreground resume expires old values synchronously before starting its request', async () => {
  const target = new FakeTarget();
  let now = 1_800_000_000_000;
  const requests = [];
  const client = startLandingMarketData({ target, now: () => now, fetchImpl: () => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  } });
  requests[0].resolve({ ok: true, json: async () => feedSnapshot(now) });
  await flushMicrotasks();
  assert.equal(target.__fxaeonMarketData.ethUsd.status, 'fresh');

  now += 6 * 60_000;
  target.changeVisibility('hidden');
  target.changeVisibility('visible');
  assert.equal(requests.length, 2);
  assert.equal(target.__fxaeonMarketData.ethUsd.status, 'unavailable', 'the expired quote is cleared before fetch resolves');
  assert.equal(target.__fxaeonMarketData.ethUsd.value, null);
  assert.equal(target.__fxaeonMarketData.fxSaveTvlUsd.value, null);

  requests[1].resolve({ ok: true, json: async () => feedSnapshot(now, 2_600) });
  await flushMicrotasks();
  assert.equal(target.__fxaeonMarketData.ethUsd.value, 2_600);
  client.stop();
});

test('offline and stopped clients never publish cancelled responses or leave polling timers', async () => {
  const target = new FakeTarget();
  const first = deferred();
  let calls = 0;
  const client = startLandingMarketData({ target, fetchImpl: () => {
    calls += 1;
    return calls === 1 ? first.promise : Promise.resolve({ ok: true, json: async () => feedSnapshot(Date.now()) });
  } });
  let events = 0;
  target.addEventListener('fxaeon:market-data', () => { events += 1; });
  const afterStart = events;
  target.navigator.onLine = false;
  target.fire('offline');
  assert.equal(target.__fxaeonMarketData.status, 'unavailable');
  assert.equal(pollTimerCount(target), 0);
  first.resolve({ ok: true, json: async () => feedSnapshot(Date.now(), 9_999) });
  await flushMicrotasks();
  assert.equal(target.__fxaeonMarketData.ethUsd.value, null);
  assert.equal(events, afterStart + 1, 'aborted work does not publish after the offline state update');

  target.navigator.onLine = true;
  target.fire('online');
  await flushMicrotasks();
  assert.equal(target.__fxaeonMarketData.ethUsd.status, 'fresh');
  const beforeStop = events;
  client.stop();
  assert.equal(pollTimerCount(target), 0);
  await client.refresh();
  assert.equal(events, beforeStop, 'stop prevents later manual or asynchronous publications');
});
