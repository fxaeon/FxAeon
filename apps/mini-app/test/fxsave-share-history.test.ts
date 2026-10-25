import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFxSaveShareHistory, FX_SAVE_SHARE_HISTORY_KEY, fetchFxSaveShareHistory } from '../src/lib/fxSaveShareHistory';
import { HISTORY_DAY_MS } from '../src/lib/fxSaveHistory';

const now = Date.UTC(2026, 9, 25, 20);
const rows = Array.from({ length: 90 }, (_, i) => ({ timestamp: (now - (89 - i) * HISTORY_DAY_MS) / 1000, price: 1.1 + i / 10000 }));
const payload = (prices: unknown = rows, changes = {}) => ({ coins: { [FX_SAVE_SHARE_HISTORY_KEY]: { symbol: 'fxSAVE', decimals: 18, confidence: 1, prices, ...changes } } });

test('reported share prices retain real daily observations, sorted and deduplicated', () => {
  const duplicate = { timestamp: rows[0].timestamp + 1, price: 1.09 };
  const points = parseFxSaveShareHistory(payload([...rows].reverse().concat(duplicate)), now);
  assert.equal(points.length, 90);
  assert.equal(points[0].price, 1.09);
  assert.equal(points.at(-1)?.timestamp, now);
  assert.equal(points.at(-1)?.price, rows.at(-1)?.price);
});

test('share history verifies identity and confidence and rejects stale or sparse data', () => {
  for (const changes of [{ symbol: 'fxUSD' }, { decimals: 6 }, { confidence: .1 }, { confidence: NaN }, { confidence: 2 }]) assert.throws(() => parseFxSaveShareHistory(payload(rows, changes), now));
  assert.throws(() => parseFxSaveShareHistory({ coins: { 'ethereum:0x123': payload() } }, now));
  assert.throws(() => parseFxSaveShareHistory(payload(rows.slice(0, 5)), now));
  assert.throws(() => parseFxSaveShareHistory(payload(rows.slice(0, 80)), now));
});

test('invalid points do not become zeros and missing days remain gaps', () => {
  const gapped = [...rows.slice(0, 40), ...rows.slice(45), { timestamp: now / 1000 + 1, price: 2 }, { timestamp: now / 1000, price: NaN }, { timestamp: now / 1000, price: -1 }];
  const points = parseFxSaveShareHistory(payload(gapped), now);
  assert.equal(points.length, 85);
  assert.ok(points[40].timestamp - points[39].timestamp > 3 * HISTORY_DAY_MS);
  assert.ok(points.every(point => point.price > 0 && Number.isFinite(point.price)));
});

test('an already aborted share-history request does not return data', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchFxSaveShareHistory(controller.signal));
});
