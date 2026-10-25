import test from 'node:test';
import assert from 'node:assert/strict';
import { createOracleMarketQuoteFetcher } from '../src/lib/fx/oracleMarketQuote';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { oracleMarketDifference, type OracleObservation } from '../src/lib/fx/oracleComparison';

const payload = (timestamp: number, token = 'stETH') => ({ [FX_TOKENS[token as 'stETH'].address.toLowerCase()]: { usd: 2000, last_updated_at: timestamp } });
test('comparison fallback uses exact token, shares concurrent reads and caches for one minute', async () => {
  let calls = 0;
  const fetcher = createOracleMarketQuoteFetcher((async (url, init) => {
    calls++;
    assert.ok(String(url).includes(FX_TOKENS.stETH.address.toLowerCase()));
    assert.ok(init?.signal);
    return Response.json(payload(Math.floor(Date.now() / 1000)));
  }) as typeof fetch);
  const [a, b] = await Promise.all([fetcher('stETH'), fetcher('stETH')]);
  assert.equal(a, b);
  assert.equal(await fetcher('stETH'), a);
  assert.equal(calls, 1);
  const now = Date.now();
  const oracle: OracleObservation = { market: 'ETH', side: 'long', token: 'stETH', usd: 2020, readAt: now, blockAt: now - 12000, blockNumber: 1n };
  assert.ok(Math.abs(oracleMarketDifference(oracle, a)!.percent - 1) < 1e-10);
  assert.equal(oracleMarketDifference({ ...oracle, token: 'wstETH' }, a), null);
});

test('comparison fallback rejects stale, future and wrong-token quotes', async () => {
  for (const body of [payload(Math.floor(Date.now() / 1000) - 301), payload(Math.floor(Date.now() / 1000) + 30), payload(Math.floor(Date.now() / 1000), 'wstETH')]) {
    const fetcher = createOracleMarketQuoteFetcher((async () => Response.json(body)) as typeof fetch);
    await assert.rejects(fetcher('stETH'), /Recent comparison quote unavailable/);
  }
});

test('429 backoff covers other tokens and failed reads do not fan out', async () => {
  let calls = 0;
  const fetcher = createOracleMarketQuoteFetcher((async () => {
    calls++;
    return new Response('', { status: 429, headers: { 'retry-after': '180' } });
  }) as typeof fetch);
  await assert.rejects(fetcher('stETH'));
  await assert.rejects(fetcher('WBTC'), /cooling down/);
  await assert.rejects(fetcher('stETH'));
  assert.equal(calls, 1);
});

test('an already aborted read makes no provider request', async () => {
  let calls = 0;
  const fetcher = createOracleMarketQuoteFetcher((async () => { calls++; return Response.json({}); }) as typeof fetch);
  await assert.rejects(fetcher('stETH', AbortSignal.abort()));
  assert.equal(calls, 0);
});

test('switching tokens waits for the active provider read instead of failing or fanning out', async () => {
  let finish!: (value: Response) => void;
  let calls = 0;
  const fetcher = createOracleMarketQuoteFetcher(((url) => {
    calls++;
    if (String(url).includes(FX_TOKENS.WBTC.address.toLowerCase())) return Promise.resolve(Response.json(payload(Math.floor(Date.now() / 1000), 'WBTC')));
    return new Promise<Response>(resolve => { finish = resolve; });
  }) as typeof fetch);
  const pending = fetcher('stETH');
  const next = fetcher('WBTC');
  assert.equal(calls, 1);
  finish(Response.json(payload(Math.floor(Date.now() / 1000))));
  await pending;
  await next;
  assert.equal(calls, 2);
});

test('a canceled read cannot poison the cache or block a newly selected token', async () => {
  let finish!: (value: Response) => void;
  let calls = 0;
  const fetcher = createOracleMarketQuoteFetcher((() => {
    calls++;
    if (calls === 1) return new Promise<Response>(resolve => { finish = resolve; });
    return Promise.resolve(Response.json({ ...payload(Math.floor(Date.now() / 1000)), ...payload(Math.floor(Date.now() / 1000), 'WBTC') }));
  }) as typeof fetch);
  const controller = new AbortController();
  const first = fetcher('stETH', controller.signal);
  const rejected = assert.rejects(first);
  controller.abort();
  await fetcher('WBTC');
  finish(Response.json(payload(Math.floor(Date.now() / 1000))));
  await rejected;
  await fetcher('stETH');
  assert.equal(calls, 3);
});
