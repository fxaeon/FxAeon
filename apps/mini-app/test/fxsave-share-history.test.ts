import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNavSample, fetchFxSaveShareHistory, HISTORY_DAY_MS, type NavHistoryReader } from '../src/lib/fxSaveShareHistory';

const now = Date.UTC(2026, 10, 3, 12);
const head = 24_000_000n;
const reader: NavHistoryReader = {
  head: async () => head,
  sample: async block => [BigInt((now - Number(head - block) / 7150 * HISTORY_DAY_MS) / 1000), 1_100_000_000_000_000_000n + (block % 1000n)],
};
test('NAV history reads bounded historical blocks and preserves their actual timestamps', async () => {
  const blocks: bigint[] = [];
  const points = await fetchFxSaveShareHistory(undefined, 90, { now, reader: { ...reader, sample: async block => { blocks.push(block); return reader.sample(block); } } });
  assert.equal(points.length, 90);
  assert.equal(blocks.length, 90);
  assert.equal(new Set(blocks).size, 90);
  assert.equal(points.at(-1)?.timestamp, now);
  assert.equal(points[0].timestamp, now - 89 * HISTORY_DAY_MS);
  assert.ok(points.every(point => point.price >= 1.1));
});
test('invalid NAV, stale heads, sparse history and non-Ethereum heads fail closed', async () => {
  for (const value of [[0n, 10n ** 18n], [BigInt(now / 1000 + 1), 10n ** 18n], [BigInt(now / 1000), 0n], [BigInt(now / 1000), 10n ** 20n], ['1', '2']]) assert.throws(() => parseNavSample(value, now));
  await assert.rejects(fetchFxSaveShareHistory(undefined, 30, { now, reader: { ...reader, head: async () => 2n } }));
  await assert.rejects(fetchFxSaveShareHistory(undefined, 30, { now: now + 301_000, reader }));
  await assert.rejects(fetchFxSaveShareHistory(undefined, 30, { now, reader: { ...reader, sample: async block => { if (block !== head) throw Error('Archive unavailable'); return reader.sample(block); } } }));
});
test('missing archive observations remain gaps instead of zeros', async () => {
  const points = await fetchFxSaveShareHistory(undefined, 30, { now, reader: { ...reader, sample: async block => {
    const day = Number(head - block) / 7150;
    if (day >= 10 && day <= 15) throw Error('Missing state');
    return reader.sample(block);
  } } });
  assert.equal(points.length, 24);
  assert.ok(points.some((point, i) => i > 0 && point.timestamp - points[i - 1].timestamp > 6 * HISTORY_DAY_MS));
});

test('multiple observations on one UTC day retain the newest value', async () => {
  const points = await fetchFxSaveShareHistory(undefined, 30, { now, reader: { ...reader, sample: async block => {
    const day = Number(head - block) / 7150;
    if (day === 2) return [BigInt((now - 1.5 * HISTORY_DAY_MS) / 1000), 1_050_000_000_000_000_000n];
    return reader.sample(block);
  } } });
  assert.equal(points.length, 29);
  const retained = points.find(point => Math.floor(point.timestamp / HISTORY_DAY_MS) === Math.floor((now - HISTORY_DAY_MS) / HISTORY_DAY_MS));
  assert.equal(retained?.timestamp, now - HISTORY_DAY_MS);
  assert.ok(retained!.price >= 1.1);
});
test('cancellation queues no additional reads, and hung providers hit the deadline', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(fetchFxSaveShareHistory(controller.signal, 30, { now, reader: { ...reader, head: async () => { calls++; return head; } } }));
  assert.equal(calls, 0);
  await assert.rejects(fetchFxSaveShareHistory(undefined, 30, { now, deadlineMs: 10, reader: { ...reader, head: () => new Promise(() => {}) } }), /timed out/);
});
