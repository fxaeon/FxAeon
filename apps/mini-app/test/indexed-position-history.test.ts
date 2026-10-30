import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INDEXED_ORDER_PAGE_SIZE, loadIndexedPositionHistory, type IndexedPositionHistory } from '../src/lib/protocolPositionHistory';

type Body = { data?: Record<string, unknown>; errors?: unknown[] };

/** A fetch that answers each GraphQL query in turn and records it. */
function indexFetch(answers: Array<Body | ((query: string) => Body) | Response>) {
  const requests: Array<{ url: string; query: string }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const query = JSON.parse(String(init?.body)).query as string;
    requests.push({ url: String(url), query });
    const answer = answers[requests.length - 1];
    if (!answer) throw new Error(`unexpected query ${requests.length}`);
    if (answer instanceof Response) return answer;
    return new Response(JSON.stringify(typeof answer === 'function' ? answer(query) : answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetcher, requests };
}

const order = (positionId: string, index: number, overrides: Record<string, unknown> = {}) => ({
  id: `${positionId}_0x${index.toString(16).padStart(64, '0')}`, type: 'CollIndexChanged', logIndex: '7', blockNumber: String(1_000 + index),
  deltaColls: null, deltaDebts: null, positionColls: '2000000000000000000', positionDebts: '3000000000000000000000', oldPositionColls: '2000000000000000001',
  execPrice: '0', price: '2400000000000000000000', priceRate: '1200000000000000000', protocolFees: null, tickMovement: null, ...overrides,
});
const first = (orders: unknown[], position: Record<string, unknown> | null = { colls: '2000000000000000000', debts: '3000000000000000000000', targetLeverage: '3.18', isClosed: false }, block = 5_000) => ({
  data: { _meta: { block: { number: block }, hasIndexingErrors: false }, position, orders },
});

test('a position with more than a page of orders is read whole, every page pinned to the first page’s block', async () => {
  const page = Array.from({ length: INDEXED_ORDER_PAGE_SIZE }, (_, index) => order('2033', index));
  const rest = Array.from({ length: 5 }, (_, index) => order('2033', INDEXED_ORDER_PAGE_SIZE + index));
  const { fetcher, requests } = indexFetch([first(page), { data: { orders: rest } }]);
  const history = await loadIndexedPositionHistory({ market: 'ETH', side: 'long', positionId: 2033, fetcher });

  assert.equal(history.orders.length, INDEXED_ORDER_PAGE_SIZE + 5);
  assert.equal(history.block, 5_000n);
  assert.equal(history.colls, 2n * 10n ** 18n);
  assert.equal(history.debts, 3_000n * 10n ** 18n);
  assert.equal(history.targetLeverage, '3.18');
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.url === 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wsteth/3.0.0/gn'));
  // The first query reads the index block, the position and the first page together.
  assert.match(requests[0].query, /_meta \{ block \{ number \} hasIndexingErrors \}/);
  assert.match(requests[0].query, /position\(id: "2033"\) \{ colls debts targetLeverage isClosed \}/);
  assert.match(requests[0].query, /orders\(first: 1000, orderBy: id, orderDirection: asc, where: \{ positionId: "2033", id_gt: "" \}\)/);
  for (const field of ['execPrice', 'price', 'priceRate', 'deltaColls', 'deltaDebts', 'positionColls', 'positionDebts', 'oldPositionColls', 'protocolFees', 'type']) {
    assert.match(requests[0].query, new RegExp(`\\b${field}\\b`), field);
  }
  // The next page continues after the last id, at the same block.
  assert.match(requests[1].query, new RegExp(`orders\\(first: 1000, block: \\{ number: 5000 \\}, orderBy: id, orderDirection: asc, where: \\{ positionId: "2033", id_gt: "${page.at(-1)!.id}" \\}\\)`));
  // Amounts are typed, signed where an order moves them, and null where it moves none.
  const parsed = history.orders[0];
  assert.equal(parsed.deltaColls, 0n);
  assert.equal(parsed.oldPositionColls, 2_000_000_000_000_000_001n);
  assert.equal(parsed.priceRate, 1_200_000_000_000_000_000n);
});

test('each pool reads the index the official app does, the wstETH short its later deployment', async () => {
  for (const [market, side, path] of [
    ['ETH', 'long', 'fx-v2-wsteth/3.0.0'], ['BTC', 'long', 'fx-v2-wbtc/3.0.0'],
    ['ETH', 'short', 'fx-v2-wsteth-short-backup/v2.0.0'], ['BTC', 'short', 'fx-v2-wbtc-short/v2.0.0'],
  ] as const) {
    const { fetcher, requests } = indexFetch([first([order('7', 1, { type: 'Reduce', deltaDebts: '-5' })])]);
    const history = await loadIndexedPositionHistory({ market, side, positionId: 7, fetcher });
    assert.equal(requests[0].url, `https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/${path}/gn`);
    assert.equal(history.orders[0].deltaDebts, -5n);
  }
});

test('a later read adds only the orders after the previous block', async () => {
  const { fetcher: initialFetch } = indexFetch([first([order('9', 1), order('9', 2)], undefined, 5_000)]);
  const previous = await loadIndexedPositionHistory({ market: 'BTC', side: 'long', positionId: 9, fetcher: initialFetch });
  const newer = order('9', 3, { blockNumber: '5003', type: 'Add', deltaColls: '100000000', execPrice: '81000000000000000000000' });
  const { fetcher, requests } = indexFetch([first([newer], { colls: '3000000000000000000', debts: '3000000000000000000000', targetLeverage: null, isClosed: false }, 5_004)]);
  const next = await loadIndexedPositionHistory({ market: 'BTC', side: 'long', positionId: 9, fetcher, previous });
  assert.match(requests[0].query, /where: \{ positionId: "9", id_gt: "", blockNumber_gt: "5000" \}/);
  assert.deepEqual(next.orders.map((item) => item.id), [...previous.orders.map((item) => item.id), newer.id]);
  assert.equal(next.block, 5_004n);
  assert.equal(next.colls, 3n * 10n ** 18n);
  assert.equal(next.targetLeverage, null);

  // A read of another position never continues from this one.
  const other = indexFetch([first([order('10', 1)])]);
  await loadIndexedPositionHistory({ market: 'BTC', side: 'long', positionId: 10, fetcher: other.fetcher, previous });
  assert.doesNotMatch(other.requests[0].query, /blockNumber_gt/);
  // An index behind the previous read is not trusted.
  const behind = indexFetch([first([], undefined, 4_999)]);
  await assert.rejects(loadIndexedPositionHistory({ market: 'BTC', side: 'long', positionId: 9, fetcher: behind.fetcher, previous }), /moved back/);
});

test('an index that is not current, a missing position or a malformed record is rejected, never read around', async () => {
  const cases: Array<[string, Array<Body | Response>]> = [
    ['indexing errors', [{ data: { ...first([]).data, _meta: { block: { number: 5_000 }, hasIndexingErrors: true } } }]],
    ['no block', [{ data: { ...first([]).data, _meta: { hasIndexingErrors: false } } }]],
    ['no position', [first([], null)]],
    ['GraphQL errors', [{ data: first([]).data, errors: [{ message: 'boom' }] }]],
    ['HTTP failure', [new Response('unavailable', { status: 503 })]],
    ['another position', [first([order('2034', 1)])]],
    ['an order past the block', [first([order('2033', 1, { blockNumber: '5001' })])]],
    ['a malformed amount', [first([order('2033', 1, { positionColls: '1.5' })])]],
    ['a malformed delta', [first([order('2033', 1, { deltaColls: '0x10' })])]],
    ['a malformed type', [first([order('2033', 1, { type: 'Open; drop' })])]],
    ['a malformed leverage', [first([], { colls: '1', debts: '1', targetLeverage: 3, isClosed: false })]],
    ['an unexpected page', [first(Array.from({ length: INDEXED_ORDER_PAGE_SIZE }, (_, index) => order('2033', index))), { data: { orders: 'none' } }]],
  ];
  for (const [label, answers] of cases) {
    const { fetcher } = indexFetch(answers);
    await assert.rejects(loadIndexedPositionHistory({ market: 'ETH', side: 'long', positionId: 2033, fetcher }), Error, label);
  }
  await assert.rejects(loadIndexedPositionHistory({ market: 'ETH', side: 'long', positionId: 0, fetcher: indexFetch([]).fetcher }), /valid position/);
});

test('a history longer than FxAeon reads is refused rather than cut short', async () => {
  const full = (start: number) => Array.from({ length: INDEXED_ORDER_PAGE_SIZE }, (_, index) => order('5', start + index, { blockNumber: '1000' }));
  const answers: Body[] = [first(full(0)), ...Array.from({ length: 39 }, (_, page) => ({ data: { orders: full((page + 1) * INDEXED_ORDER_PAGE_SIZE) } }))];
  const { fetcher, requests } = indexFetch(answers);
  await assert.rejects(loadIndexedPositionHistory({ market: 'ETH', side: 'long', positionId: 5, fetcher }), /more orders than FxAeon reads/);
  assert.equal(requests.length, 40);
});

test('a tick movement sorts by its own event, as the official app sorts it', async () => {
  const { fetcher } = indexFetch([first([order('3', 1, { type: 'TickMovement', logIndex: '227', tickMovement: { typeLogIndex: '234' } })])]);
  const history: IndexedPositionHistory = await loadIndexedPositionHistory({ market: 'ETH', side: 'long', positionId: 3, fetcher });
  assert.equal(history.orders[0].logIndex, 234);
});
