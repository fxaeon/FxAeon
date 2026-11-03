'use client';

import { createContext, useContext } from 'react';
import type { UsdPriceSnapshot } from '@/lib/prices';

export type PriceContextValue = UsdPriceSnapshot & {
  refreshing: boolean;
  refresh: () => Promise<void>;
};

export const EMPTY_PRICE_SNAPSHOT: UsdPriceSnapshot = { prices: {}, status: 'loading', updatedAt: null };
export const PriceContext = createContext<PriceContextValue>({
  ...EMPTY_PRICE_SNAPSHOT,
  refreshing: false,
  refresh: async () => undefined,
});

/** Read the existing provider without importing its fetching implementation. */
export function useUsdPrices(): PriceContextValue {
  return useContext(PriceContext);
}

/** One publisher per mounted route wrapper. Calls made before the runtime
 * arrives wait for a real refresh; no quote or successful readiness is invented. */
export function createPriceRuntimeBridge() {
  let runtime: PriceContextValue | null = null;
  let loadRuntime: (() => void) | undefined;
  let pending: { promise: Promise<void>; resolve: () => void; reject: (reason: unknown) => void } | undefined;
  const listeners = new Set<() => void>();
  const refresh = (): Promise<void> => {
    if (runtime) return runtime.refresh();
    if (pending) return pending.promise;
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
    pending = { promise, resolve, reject };
    loadRuntime?.();
    return promise;
  };
  let snapshot: PriceContextValue = { ...EMPTY_PRICE_SNAPSHOT, refreshing: false, refresh };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setLoader(loader: () => void) { loadRuntime = loader; },
    publish(value: PriceContextValue) {
      runtime = value;
      snapshot = { ...value, refresh };
      listeners.forEach(listener => listener());
      const waiting = pending;
      pending = undefined;
      if (waiting) void Promise.resolve().then(() => value.refresh()).then(waiting.resolve, waiting.reject);
    },
    fail() {
      // Match failed price reads: retained quotes stay stale, absent quotes
      // become unavailable. A refresh settling does not imply usable prices.
      runtime = null;
      snapshot = { ...snapshot, refreshing: false,
        status: Object.keys(snapshot.prices).length ? 'stale' : 'unavailable' };
      listeners.forEach(listener => listener());
      pending?.resolve();
      pending = undefined;
    },
    release() {
      runtime = null;
      loadRuntime = undefined;
      // The owner has unmounted; release callers without publishing ready data.
      pending?.resolve();
      pending = undefined;
    },
  };
}
