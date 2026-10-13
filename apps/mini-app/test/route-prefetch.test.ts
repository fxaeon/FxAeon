import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";
import { RoutePrefetchStore, ROUTE_PREFETCH_TTL_MS, routePrefetchKey, type RoutePrefetchDescriptor } from "../src/lib/fx/routePrefetch";
import type { PlannedRoute } from "../src/lib/fx/types";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN = "0x2222222222222222222222222222222222222222" as Address;

function descriptor(overrides: Partial<RoutePrefetchDescriptor> = {}): RoutePrefetchDescriptor {
  return {
    sessionId: "session-1",
    walletAddress: WALLET,
    walletChainId: 1,
    routeChainId: 1,
    market: "ETH",
    side: "long",
    inputTokenAddress: TOKEN,
    amountWei: 1_000_000_000_000_000n,
    leverage: 2,
    slippagePercent: 0.5,
    leverageMin: 1.1,
    leverageMax: 6.8,
    blockNumber: 100n,
    ...overrides,
  };
}

const ROUTE = {} as PlannedRoute;

test("a stalled warm-up releases Review at its remaining TTL and ignores its late result", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = new RoutePrefetchStore();
  let now = 1_000;
  let resolve!: (route: PlannedRoute) => void;
  let snapshotReads = 0;
  void store.prime(descriptor(), () => new Promise<PlannedRoute>((done) => { resolve = done; }), now);
  now += ROUTE_PREFETCH_TTL_MS - 100;
  const pending = store.readValidated(descriptor(), async () => { snapshotReads++; return descriptor(); }, () => now);
  t.mock.timers.tick(100);
  assert.equal(await pending, null);
  // A late result must not displace a newer quote or spend a block read.
  const next = descriptor({ blockNumber: 101n });
  await store.prime(next, async () => ROUTE, now);
  resolve(ROUTE);
  await Promise.resolve();
  assert.equal(snapshotReads, 0);
  assert.equal(await store.read(next, now), ROUTE);
});

test("a stalled validation block read is also bounded by the quote TTL", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = new RoutePrefetchStore();
  const now = 1_000;
  await store.prime(descriptor(), async () => ROUTE, now);
  let snapshotReads = 0;
  const pending = store.readValidated(descriptor(), () => {
    snapshotReads++;
    return new Promise(() => undefined);
  }, () => now);
  await Promise.resolve();
  assert.equal(snapshotReads, 1);
  t.mock.timers.tick(ROUTE_PREFETCH_TTL_MS);
  assert.equal(await pending, null);
  assert.equal(store.read(descriptor(), now), null);
});

test("a completed lookup clears its deadline instead of invalidating the cache later", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = new RoutePrefetchStore();
  await store.prime(descriptor(), async () => ROUTE, 1_000);
  assert.equal(await store.readValidated(descriptor(), async () => descriptor(), () => 1_000), ROUTE);
  t.mock.timers.tick(ROUTE_PREFETCH_TTL_MS);
  assert.equal(await store.read(descriptor(), 1_000), ROUTE);
});

test("failed warm-up falls back to fresh planning without reading a stale chain snapshot", async () => {
  const store = new RoutePrefetchStore();
  let reject!: (error: Error) => void;
  let snapshotReads = 0;
  let freshPlans = 0;
  void store.prime(descriptor(), () => new Promise<PlannedRoute>((_, fail) => { reject = fail; })).catch(() => undefined);
  const pending = store.readValidated(descriptor(), async () => { snapshotReads++; return descriptor(); });
  reject(new DOMException('signal is aborted without reason', 'AbortError'));
  const planned = await pending ?? await (async () => { freshPlans++; return ROUTE; })();
  assert.equal(planned, ROUTE);
  assert.equal(freshPlans, 1);
  assert.equal(snapshotReads, 0);
});

test("an expired in-flight warm-up skips the extra block read", async () => {
  const store = new RoutePrefetchStore();
  let now = 1_000;
  let resolve!: (route: PlannedRoute) => void;
  let snapshotReads = 0;
  void store.prime(descriptor(), () => new Promise<PlannedRoute>((done) => { resolve = done; }), now);
  const pending = store.readValidated(descriptor(), async () => { snapshotReads++; return descriptor(); }, () => now);
  now += ROUTE_PREFETCH_TTL_MS;
  resolve(ROUTE);
  assert.equal(await pending, null);
  assert.equal(snapshotReads, 0);
});

test("an unavailable current snapshot cannot make a warm quote usable", async () => {
  const store = new RoutePrefetchStore();
  await store.prime(descriptor(), async () => ROUTE);
  assert.equal(await store.readValidated(descriptor(), async () => { throw new Error('RPC unavailable'); }), null);
});

test("awaited prefetch rejects expiry, a backwards block, and session invalidation", async () => {
  for (const change of ['expiry', 'block', 'session'] as const) {
    const store = new RoutePrefetchStore();
    let now = 1_000;
    let resolve!: (route: PlannedRoute) => void;
    void store.prime(descriptor(), () => new Promise<PlannedRoute>((done) => { resolve = done; }), now);
    const pending = store.readValidated(descriptor(), async () => descriptor({ blockNumber: change === 'block' ? 99n : 100n }), () => now);
    if (change === 'expiry') now += ROUTE_PREFETCH_TTL_MS;
    if (change === 'session') store.invalidate();
    resolve(ROUTE);
    assert.equal(await pending, null);
  }
});

test("a newer block reuses exact input calldata without extending its deadline", async () => {
  const store = new RoutePrefetchStore();
  await store.prime(descriptor(), async () => ROUTE, 1_000);
  assert.equal(await store.readValidated(descriptor(), async () => descriptor({ blockNumber: 105n }), () => 2_000), ROUTE);
  assert.equal(await store.readValidated(descriptor(), async () => descriptor({ blockNumber: 106n }), () => 1_000 + ROUTE_PREFETCH_TTL_MS), null);
});

test("current limits, wallet, and every ticket input must still match across blocks", async () => {
  const changes: Partial<RoutePrefetchDescriptor>[] = [
    { leverageMin: 1.2 }, { leverageMax: 6.7 }, { leverage: 2.1 },
    { slippagePercent: 1 }, { side: 'short' }, { market: 'BTC' },
    { inputTokenAddress: WALLET }, { amountWei: 2n },
    { walletAddress: TOKEN }, { walletChainId: 8453 }, { routeChainId: 8453 }, { sessionId: 'other' },
  ];
  for (const change of changes) {
    const store = new RoutePrefetchStore();
    await store.prime(descriptor(), async () => ROUTE, 1_000);
    assert.equal(await store.readValidated(descriptor(), async () => descriptor({ blockNumber: 101n, ...change }), () => 2_000), null);
  }
});

test("prefetch rechecks expiry after the current chain snapshot resolves", async () => {
  const store = new RoutePrefetchStore();
  let now = 1_000;
  await store.prime(descriptor(), async () => ROUTE, now);
  assert.equal(await store.readValidated(descriptor(), async () => descriptor(), () => now), ROUTE);
  assert.equal(await store.readValidated(descriptor(), async () => {
    now += ROUTE_PREFETCH_TTL_MS;
    return descriptor();
  }, () => now), null);
});

test("route prefetch keys bind wallet, exact inputs, bounds, and block", () => {
  const base = routePrefetchKey(descriptor());
  assert.notEqual(base, routePrefetchKey(descriptor({ amountWei: 2_000_000_000_000_000n })));
  assert.notEqual(base, routePrefetchKey(descriptor({ blockNumber: 101n })));
  assert.notEqual(base, routePrefetchKey(descriptor({ leverageMax: 6.7 })));
  assert.notEqual(base, routePrefetchKey(descriptor({ walletAddress: "0x3333333333333333333333333333333333333333" as Address })));
});

test("route prefetch entries expire and never return after invalidation", async () => {
  const store = new RoutePrefetchStore();
  let resolve!: (route: PlannedRoute) => void;
  const promise = new Promise<PlannedRoute>((done) => { resolve = done; });
  const current = store.prime(descriptor(), () => promise, 1_000);
  assert.equal(store.read(descriptor(), 1_000), current);
  assert.equal(store.read(descriptor(), 1_000 + ROUTE_PREFETCH_TTL_MS), null);
  resolve(ROUTE);
  await current;
  assert.equal(store.read(descriptor(), 1_000), null);

  const next = store.prime(descriptor({ sessionId: "session-2" }), async () => ROUTE, 2_000);
  store.invalidate();
  assert.equal(store.read(descriptor({ sessionId: "session-2" }), 2_001), null);
  await next;
});

test("a late failed builder cannot clear a newer exact entry", async () => {
  const store = new RoutePrefetchStore();
  let rejectOld!: (cause: Error) => void;
  const old = store.prime(descriptor(), () => new Promise<PlannedRoute>((_, reject) => { rejectOld = reject; }), 1_000);
  const next = store.prime(descriptor({ blockNumber: 101n }), async () => ROUTE, 1_001);
  rejectOld(new Error("old route failed"));
  await assert.rejects(old, /old route failed/);
  assert.equal(await store.read(descriptor({ blockNumber: 101n }), 1_002), ROUTE);
  await next;
});

test("a synchronous builder failure is contained and does not leave a readable entry", async () => {
  const store = new RoutePrefetchStore();
  const pending = store.prime(descriptor(), () => { throw new Error("invalid route"); });
  await assert.rejects(pending, /invalid route/);
  assert.equal(store.read(descriptor()), null);
});
