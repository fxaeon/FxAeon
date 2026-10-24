import assert from 'node:assert/strict';
import { test } from 'node:test';
import { averageBorrowFundingRatio, BORROW_FUNDING_HISTORY_URL, readBorrowFundingHistory } from '../src/lib/fx/borrowFundingHistory';

const now = 1_792_852_224_000;
const start = now / 1000 - 30 * 86_400;
const row = (timestamp: number, ratio: string, type = 'wstETH') => ({ timestamp: String(timestamp), fundingRate: ratio, fundingId: { type } });
const result = (snapshots: unknown[] = [row(start + 1000, '45318576060452136')], previous: unknown[] = [row(start - 100, '0')]) => ({ data: { _meta: { block: { number: 26263102, timestamp: now / 1000 - 60 }, hasIndexingErrors: false }, previous, snapshots } });
const fetcher = (reply: unknown) => (async () => Response.json(reply)) as typeof fetch;

test('history uses the official source and exact market-specific snapshots', async () => {
  for (const market of ['ETH', 'BTC'] as const) {
    let query = '';
    const history = await readBorrowFundingHistory(market, { now, fetch: async (url, options) => {
      assert.equal(url, BORROW_FUNDING_HISTORY_URL);
      query = JSON.parse(options!.body as string).query;
      return Response.json(result([row(start + 1000, '45318576060452136', market === 'ETH' ? 'wstETH' : 'WBTC')], [row(start - 100, '0', market === 'ETH' ? 'wstETH' : 'WBTC')]));
    } });
    assert.match(query, new RegExp(`type: "${market === 'ETH' ? 'wstETH' : 'WBTC'}"`));
    assert.equal(history.market, market);
    assert.equal(history.snapshots[1].ratio, 45318576060452136n);
    assert.equal(history.startAt, start);
    assert.equal(history.endAt, now / 1000 - 60);
    assert.ok(history.averageRatio! > 0n);
  }
});

test('time weighted averages preserve zero periods and stop at the indexed block', () => {
  assert.equal(averageBorrowFundingRatio([{ timestamp: 5, ratio: 0n }, { timestamp: 20, ratio: 100n }], 10, 30), 50n);
  assert.equal(averageBorrowFundingRatio([{ timestamp: 20, ratio: 100n }], 10, 30), null);
  assert.equal(averageBorrowFundingRatio([], 10, 30), null);
});

test('pagination is bound to the original index block rather than a changing latest result', async () => {
  let calls = 0;
  const fullPage = Array.from({ length: 1000 }, (_, index) => row(start + index, '1000'));
  const history = await readBorrowFundingHistory('ETH', { now, fetch: async (_url, options) => {
    calls += 1;
    if (calls === 1) return Response.json(result(fullPage));
    const query = JSON.parse(options!.body as string).query;
    assert.match(query, /skip: 1000/);
    assert.match(query, /block: \{number: 26263102\}/);
    return Response.json({ data: { snapshots: [row(start + 1001, '0')] } });
  } });
  assert.equal(calls, 2);
  assert.equal(history.snapshots.length, 1002);
});

test('malformed, stale, future, cross-market and errored index data stay unavailable', async () => {
  const bad: unknown[] = [
    { errors: [{ message: 'index error' }], ...result() },
    result([row(start, '-1')]), result([row(start, (2n ** 256n).toString())]),
    result([row(start, '1', 'WBTC')]), result([row(now / 1000 + 1, '1')]),
    result([row(start + 2, '1'), row(start + 1, '0')]),
  ];
  const indexingError = result(); indexingError.data._meta.hasIndexingErrors = true; bad.push(indexingError);
  const stale = result(); stale.data._meta.block.timestamp = now / 1000 - 86_401; bad.push(stale);
  const future = result(); future.data._meta.block.timestamp = now / 1000 + 61; bad.push(future);
  for (const reply of bad) await assert.rejects(readBorrowFundingHistory('ETH', { now, fetch: fetcher(reply) }));
  await assert.rejects(readBorrowFundingHistory('ETH', { now, fetch: async () => new Response('', { status: 503 }) }));
});

test('history aborts transport requests at its deadline', async () => {
  await assert.rejects(readBorrowFundingHistory('ETH', { now, deadlineMs: 5, fetch: async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) }), /aborted/);
});
