import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNavSample, fetchFxSaveShareHistory, HISTORY_DAY_MS, type NavHistoryReader } from '../src/lib/fxSaveShareHistory';
import { navHistoryRange, trailingNavReturns, RETURN_WINDOW_MS } from '../src/lib/fxSavePerformance';

const now = Date.UTC(2026, 10, 3, 12);
const head = 24_000_000n;
function fixture(seconds = 12) {
  const calls = { samples: [] as bigint[], headers: [] as bigint[], running: 0, peak: 0 };
  const stamp = (block: bigint) => now - Number(head - block) * seconds * 1000;
  const reader: NavHistoryReader = {
    head: async () => head,
    blockTimestamp: async block => { calls.headers.push(block); return stamp(block); },
    sample: async block => {
      calls.samples.push(block); calls.peak = Math.max(calls.peak, ++calls.running);
      await Promise.resolve(); calls.running--;
      return [BigInt(stamp(block) / 1000), 1_100_000_000_000_000_000n + block * 1000n];
    },
  };
  return { reader, calls, stamp };
}

test('30D/90D include 30-day warmup and reuse immutable dated archive reads across ranges', async () => {
  const { reader, calls } = fixture();
  const short = await fetchFxSaveShareHistory(undefined, 30, { now, reader });
  assert.equal(short.length, 61);
  const points = await fetchFxSaveShareHistory(undefined, 90, { now, reader });
  assert.equal(points.length, 121);
  assert.equal(new Set(calls.samples).size, calls.samples.length, 'overlapping NAV observations are not fetched again');
  assert.ok(calls.peak <= 6);
  const visible = navHistoryRange(trailingNavReturns(points), 90, points.at(-1)!.timestamp);
  assert.equal(visible.length, 91);
  assert.equal(visible.at(-1)!.timestamp - visible[0].timestamp, 90 * HISTORY_DAY_MS);
  assert.ok(points.filter(point => point.windowStart).every(point => point.timestamp - point.windowStart!.timestamp >= RETURN_WINDOW_MS));
  const sampleCount = calls.samples.length;
  await fetchFxSaveShareHistory(undefined, 30, { now, reader });
  assert.equal(calls.samples.length, sampleCount);
});

test('timestamp resolution corrects block-spacing drift with bounded probes and actual elapsed time', async () => {
  const { reader, calls, stamp } = fixture(15);
  const points = await fetchFxSaveShareHistory(undefined, 90, { now, reader });
  assert.equal(points.length, 121, 'a fixed 7150-block assumption cannot cover this chain');
  assert.ok(calls.headers.length <= 8 * (121 + 91));
  assert.ok(calls.samples.every(block => points.some(point => point.timestamp === stamp(block)) || block === head));
  const latest = points.at(-1)!.timestamp;
  assert.equal(navHistoryRange(trailingNavReturns(points), 90, latest).length, 91);
});

test('missing archive endpoints leave holes in NAV and trailing returns, never shorter windows or zeros', async () => {
  const base = fixture();
  const reader = { ...base.reader, sample: async (block: bigint) => {
    const day = Math.floor((now - base.stamp(block)) / HISTORY_DAY_MS);
    if (day >= 40 && day <= 45) throw Error('Missing archive state');
    return base.reader.sample(block);
  } };
  const points = await fetchFxSaveShareHistory(undefined, 90, { now, reader });
  assert.equal(points.length, 115);
  assert.ok(points.some((point, i) => i > 0 && point.timestamp - points[i - 1].timestamp > 6 * HISTORY_DAY_MS));
  const yields = navHistoryRange(trailingNavReturns(points), 90, points.at(-1)!.timestamp);
  assert.equal(yields.length, 79, 'missing endpoint and missing 30-day anchor each create six gaps');
});

test('bad NAV, mismatched block times, stale finality and missing archives fail closed', async () => {
  for (const value of [[0n, 10n ** 18n], [BigInt(now / 1000 + 1), 10n ** 18n], [BigInt(now / 1000), 0n], [BigInt(now / 1000), 10n ** 20n], ['1', '2']]) assert.throws(() => parseNavSample(value, now));
  const { reader } = fixture();
  await assert.rejects(fetchFxSaveShareHistory(undefined, 30, { now, reader: { ...reader, head: async () => 2n } }));
  await assert.rejects(fetchFxSaveShareHistory(undefined, 30, { now: now + 1_800_001, reader }));
  await assert.rejects(fetchFxSaveShareHistory(undefined, 30, { now, reader: { ...reader, sample: async block => { if (block !== head) throw Error('Archive unavailable'); return reader.sample(block); } } }));
  await assert.rejects(fetchFxSaveShareHistory(undefined, 30, { now, reader: { ...reader, blockTimestamp: async block => (await reader.blockTimestamp(block)) - 12_000 } }));
});

test('aborting an active batch queues no more archive reads and does not poison the cache', async () => {
  const base = fixture();
  const controller = new AbortController();
  let cancelled = false;
  const reader = { ...base.reader, sample: async (block: bigint) => {
    if (block !== head && !cancelled) { cancelled = true; controller.abort(); }
    return base.reader.sample(block);
  } };
  await assert.rejects(fetchFxSaveShareHistory(controller.signal, 30, { now, reader }), { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 0));
  const count = base.calls.samples.length;
  assert.ok(count <= 7);
  const recovered = await fetchFxSaveShareHistory(undefined, 30, { now, reader });
  assert.equal(recovered.length, 61);
});

test('pre-aborted requests do no work and hung providers hit the deadline', async () => {
  const { reader, calls } = fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchFxSaveShareHistory(controller.signal, 30, { now, reader }));
  assert.equal(calls.samples.length, 0);
  await assert.rejects(fetchFxSaveShareHistory(undefined, 30, { now, deadlineMs: 10, reader: { ...reader, head: () => new Promise(() => {}) } }), /timed out/);
});

test('missed-slot histories resolve full trailing windows without pretending daily samples are evenly spaced', async () => {
  const stamp = (block: bigint) => now - Number(head - block) * 12_000 - Math.floor(Number(head - block) / 2000) * 12_000;
  const reader: NavHistoryReader = {
    head: async () => head,
    blockTimestamp: async block => stamp(block),
    sample: async block => [BigInt(stamp(block) / 1000), 10n ** 18n + block * 10000n],
  };
  const points = await fetchFxSaveShareHistory(undefined, 90, { now, reader });
  const visible = navHistoryRange(points, 90, points.at(-1)!.timestamp);
  assert.equal(visible.length, 91);
  assert.equal(navHistoryRange(trailingNavReturns(points), 90, points.at(-1)!.timestamp).length, 91);
  assert.ok(visible.every(point => point.windowStart && point.timestamp - point.windowStart.timestamp >= RETURN_WINDOW_MS));
});
