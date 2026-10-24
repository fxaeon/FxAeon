import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { LIQUIDATION_QUOTE_TTL_MS, projectedLiquidationPrice, routeRiskScope } from '../src/lib/fx/liquidationQuote';
import { positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from '../src/lib/fx/policy';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import type { PlannedRoute, RouteDetails } from '../src/lib/fx/types';

const now = 1_800_000_000_000;
const require = createRequire(import.meta.url);
const { transformSync } = createRequire(require.resolve('tsx/package.json'))('esbuild') as { transformSync: (source: string, options: Record<string, string>) => { code: string } };
type Quote = NonNullable<RouteDetails['liquidationQuote']>;
function route(market: 'ETH' | 'BTC' = 'ETH'): PlannedRoute {
  return { operation: 'increasePosition', chainId: 1, walletAddress: '0x1111111111111111111111111111111111111111', transactions: [],
    policy: { chainId: 1, walletAddress: '0x1111111111111111111111111111111111111111', reviewedAction: { kind: 'position-increase', positionId: 0, positionType: 'long', poolAddress: positionPoolAddress(market, 'long'), collateralTokenAddress: positionCollateralTokenAddress(market, 'long'), debtTokenAddress: positionDebtTokenAddress(market, 'long'), inputTokenAddress: FX_TOKENS.ETH.address, inputAmount: 1n, nativeInput: true } },
    details: { colls: '1000000000000000000', debts: '1900000000000000000000' } };
}
function quote(market: 'ETH' | 'BTC' = 'ETH', readAt = Date.now()): Quote {
  return { poolAddress: positionPoolAddress(market, 'long'), liquidateRatio: '950000000000000000', rebalanceRatio: '880000000000000000', readAt, ...(market === 'ETH' ? { stEthPerWstEth: '1250000000000000000' } : {}) };
}

/** Exercise the real hook with deterministic effects, browser events and clock. */
function harness() {
  const hooks: unknown[] = [];
  let index = 0;
  let effects: Array<() => void> = [];
  const reads: Array<{ options: { market: 'ETH' | 'BTC'; side: string; deadlineMs: number }; resolve: (quote: Quote | undefined) => void }> = [];
  class Events {
    listeners = new Map<string, Set<() => void>>();
    addEventListener(name: string, callback: () => void) { const callbacks = this.listeners.get(name) ?? new Set(); callbacks.add(callback); this.listeners.set(name, callbacks); }
    removeEventListener(name: string, callback: () => void) { this.listeners.get(name)?.delete(callback); }
    dispatch(name: string) { this.listeners.get(name)?.forEach(callback => callback()); }
  }
  const document = Object.assign(new Events(), { visibilityState: 'visible' });
  const window = new Events();
  const navigator = { onLine: true };
  const react = {
    useState(initial: unknown) { const slot = index++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], (next: unknown) => { hooks[slot] = next; }]; },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const slot = index++;
      const previous = hooks[slot] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => { previous?.cleanup?.(); hooks[slot] = { deps, cleanup: effect() }; });
    },
  };
  const module = { exports: {} as { useRouteRiskQuote: (route: PlannedRoute | null) => { route: PlannedRoute | null; loading: boolean } } };
  const source = readFileSync(new URL('../src/lib/fx/useRouteRiskQuote.ts', import.meta.url), 'utf8');
  runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, require: (name: string) => name === 'react' ? react : { routeRiskScope, LIQUIDATION_QUOTE_TTL_MS, readLiquidationQuote: (options: typeof reads[number]['options']) => new Promise(resolve => reads.push({ options, resolve })) },
    document, window, navigator, Date, setTimeout, clearTimeout,
  });
  return { reads, document, window, navigator,
    render(route: PlannedRoute | null) { index = 0; effects = []; const value = module.exports.useRouteRiskQuote(route); effects.forEach(effect => effect()); return value; },
    async flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); },
    unmount() { hooks.forEach(hook => (hook as { cleanup?: () => void } | null)?.cleanup?.()); },
  };
}

test('missing risk parameters recover and refresh without changing accepted calldata or extending stale quotes', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const h = harness(); context.after(() => h.unmount());
  const original = route();
  assert.equal(h.render(original).loading, true);
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].options.deadlineMs, 12_000);
  h.reads[0].resolve(quote()); await h.flush();
  assert.equal(projectedLiquidationPrice(h.render(original).route!)?.value, '$1,600.00 / stETH');
  context.mock.timers.tick(15_000);
  assert.equal(h.reads.length, 2);
  assert.ok(projectedLiquidationPrice(h.render(original).route!));
  context.mock.timers.tick(15_001);
  assert.equal(h.render(original).route?.details?.liquidationQuote, undefined);
  assert.equal(h.render(original).loading, true);
  h.reads[1].resolve(quote('ETH', now + 15_000)); await h.flush();
  const refreshed = h.render(original).route!;
  assert.equal(projectedLiquidationPrice(refreshed)?.value, '$1,600.00 / stETH');
  assert.equal(original.details?.liquidationQuote, undefined);
  assert.equal(refreshed.transactions, original.transactions);
  assert.equal(refreshed.policy, original.policy);
});

test('late results are route-bound; hidden/offline reads cannot resume or resurrect the previous market', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const h = harness(); context.after(() => h.unmount());
  const eth = route(); const btc = route('BTC');
  h.render(eth); h.render(btc);
  h.reads[0].resolve(quote()); await h.flush();
  assert.equal(h.render(btc).route?.details?.liquidationQuote, undefined);
  h.navigator.onLine = false; h.window.dispatch('offline');
  h.reads[1].resolve(quote('BTC')); await h.flush();
  assert.equal(h.render(btc).route?.details?.liquidationQuote, undefined);
  assert.equal(h.render(btc).loading, false);
  h.document.visibilityState = 'hidden'; h.navigator.onLine = true; h.window.dispatch('online');
  assert.equal(h.reads.length, 2);
  h.document.visibilityState = 'visible'; h.document.dispatch('visibilitychange');
  assert.equal(h.reads.length, 3);
  h.reads[2].resolve(quote('BTC')); await h.flush();
  assert.equal(h.render(btc).route?.details?.liquidationQuote?.poolAddress, positionPoolAddress('BTC', 'long'));
});

test('failed reads retry, while unsupported existing positions receive no invented risk quote', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const h = harness(); context.after(() => h.unmount());
  const planned = route();
  h.render(planned); h.reads[0].resolve(undefined); await h.flush();
  assert.equal(h.render(planned).loading, false);
  assert.equal(projectedLiquidationPrice(h.render(planned).route!), undefined);
  context.mock.timers.tick(5000); assert.equal(h.reads.length, 2);
  const held = route(); if (held.policy!.reviewedAction!.kind === 'position-increase') held.policy!.reviewedAction!.positionId = 1;
  assert.equal(routeRiskScope(held), undefined);
  h.render(held); assert.equal(h.reads.length, 2);
});

test('mounting offline clears a warmed quote and waits for a real online event', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const h = harness(); context.after(() => h.unmount());
  h.navigator.onLine = false;
  const planned = route(); planned.details!.liquidationQuote = quote();
  h.render(planned);
  assert.equal(h.render(planned).route?.details?.liquidationQuote, undefined);
  assert.equal(h.render(planned).loading, false);
  assert.equal(h.reads.length, 0);
  h.navigator.onLine = true; h.window.dispatch('online');
  assert.equal(h.reads.length, 1);
});
