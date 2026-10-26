import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { TRADE_FUNDING_MAX_AGE_MS, tradeFundingIsFresh, type TradeFundingRate } from '../src/lib/fx/tradeFunding';
import { positionPoolAddress } from '../src/lib/fx/policy';

const require = createRequire(import.meta.url);
const { transformSync } = createRequire(require.resolve('tsx/package.json'))('esbuild');
function harness() {
  let now = Date.now();
  let state: unknown;
  let ref: { current: unknown } | undefined;
  let effect: (() => () => void) | undefined;
  let cleanup: (() => void) | undefined;
  let previousMarket: string | undefined;
  let previousSide: string | undefined;
  let nextTimer = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const listeners = new Map<string, Set<() => void>>();
  const requests: Array<{ resolve: (rate: TradeFundingRate) => void; reject: (error: Error) => void }> = [];
  const navigator = { onLine: true };
  const document = { visibilityState: 'visible', addEventListener, removeEventListener };
  function addEventListener(name: string, callback: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); }
  function removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); }
  const module = { exports: {} as { useTradeFundingRate: (market: 'ETH' | 'BTC', side: 'long' | 'short') => { rate: TradeFundingRate | null; status: string } } };
  const source = readFileSync(new URL('../src/lib/fx/useTradeFundingRate.ts', import.meta.url), 'utf8');
  runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, navigator, document, window: { addEventListener, removeEventListener },
    Date: { now: () => now },
    setTimeout: (callback: () => void, delay: number) => { timers.set(++nextTimer, { at: now + delay, callback }); return nextTimer; },
    clearTimeout: (id: number) => timers.delete(id),
    require: (name: string) => name === 'react' ? {
      useState: (initial: unknown) => { state ??= initial; return [state, (next: unknown) => { state = next; }]; },
      useRef: (initial: unknown) => ref ??= { current: initial },
      useEffect: (callback: () => () => void) => { effect = callback; },
    } : name === './tradeFunding' ? {
      TRADE_FUNDING_MAX_AGE_MS, tradeFundingIsFresh: (rate: TradeFundingRate, market: 'ETH' | 'BTC', side: 'long' | 'short') => tradeFundingIsFresh(rate, market, side, now),
      readTradeFundingRate: () => new Promise<TradeFundingRate>((resolve, reject) => requests.push({ resolve, reject })),
    } : {},
  });
  function render(market: 'ETH' | 'BTC' = 'ETH', reactivate = false, side: 'long' | 'short' = 'long') {
    module.exports.useTradeFundingRate(market, side);
    if (market !== previousMarket || side !== previousSide || reactivate) { cleanup?.(); cleanup = effect!(); previousMarket = market; previousSide = side; }
    return module.exports.useTradeFundingRate(market, side);
  }
  return {
    render, requests, navigator,
    rate: (market: 'ETH' | 'BTC' = 'ETH', readAt = now, side: 'long' | 'short' = 'long'): TradeFundingRate => ({ market, side, pool: positionPoolAddress(market, side), ratio: 1n, readAt }),
    emit: (name: string) => listeners.get(name)?.forEach(callback => callback()),
    advance: (milliseconds: number) => { now += milliseconds; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } },
    flush: async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); },
    close: () => cleanup?.(),
  };
}

test('funding remains visible on foreground and route refresh, including failed refresh, but expires on time', async () => {
  const h = harness();
  assert.equal(h.render().status, 'loading');
  const original = h.rate();
  h.requests[0].resolve(original); await h.flush();
  assert.equal(h.render().rate, original);
  h.advance(1000); h.emit('visibilitychange');
  assert.equal(h.render().rate, original);
  h.requests[1].reject(new Error('RPC unavailable')); await h.flush();
  assert.equal(h.render().status, 'ready');
  assert.equal(h.render('ETH', true).rate, original);
  h.advance(TRADE_FUNDING_MAX_AGE_MS - 1000);
  assert.equal(h.render().rate, null);
  assert.equal(h.render().status, 'unavailable');
  h.requests[2].reject(new Error('RPC still unavailable')); await h.flush();
  assert.equal(h.render().rate, null);
  h.close();
});

test('offline and market changes discard funding and late old reads cannot restore it', async () => {
  const h = harness(); h.render();
  h.requests[0].resolve(h.rate()); await h.flush();
  h.emit('visibilitychange');
  h.navigator.onLine = false; h.emit('offline');
  assert.equal(h.render().status, 'unavailable');
  h.requests[1].resolve(h.rate()); await h.flush();
  assert.equal(h.render().rate, null);
  h.navigator.onLine = true; h.emit('online');
  h.requests[2].resolve(h.rate()); await h.flush();
  assert.equal(h.render().status, 'ready');
  h.emit('visibilitychange');
  assert.equal(h.render('BTC').rate, null);
  h.requests[3].resolve(h.rate()); await h.flush();
  assert.equal(h.render('BTC').rate, null);
  const btc = h.rate('BTC'); h.requests[4].resolve(btc); await h.flush();
  assert.equal(h.render('BTC').rate, btc);
  h.close();
});

test('changing only side discards long data and ignores late long results', async () => {
 const h = harness(); h.render(); h.requests[0].resolve(h.rate()); await h.flush();
 h.emit('visibilitychange'); assert.equal(h.render('ETH', false, 'short').rate, null);
 h.requests[1].resolve(h.rate()); await h.flush(); assert.equal(h.render('ETH', false, 'short').rate, null);
 const rate = h.rate('ETH', undefined, 'short'); h.requests[2].resolve(rate); await h.flush();
 assert.equal(h.render('ETH', false, 'short').rate, rate); h.close();
});

