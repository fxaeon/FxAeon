'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { FxTokenKey } from '@/lib/fx/tokens';
import {
  createCoinbaseTickerController,
  isLiveQuoteFresh,
  type LiveMarketStatus,
  type LiveQuote,
} from '@/lib/liveMarket';
import type { MarketSymbol } from '@/lib/marketData';
import { liveMarketStore } from '@/lib/liveMarketStore';
import { priceDemandRegistry } from '@/lib/priceDemand';
import {
  fetchUsdPrices,
  parseUsdPriceCache,
  USD_PRICE_CACHE_KEY,
  type UsdPriceSnapshot,
  type UsdPriceUpdate,
} from '@/lib/prices';

import { mergeUsdPriceUpdate, startPriceRefreshLoop } from '@/lib/priceRefresh';
import { EMPTY_PRICE_SNAPSHOT as EMPTY_SNAPSHOT, PriceContext, useUsdPrices, type PriceContextValue } from './PriceContext';

export { useUsdPrices } from './PriceContext';

const EMPTY_LIVE_MARKET = { quote: null, status: 'paused' as const, now: 0 };

function readCachedSnapshot(): UsdPriceSnapshot | null {
  try {
    const raw = window.localStorage.getItem(USD_PRICE_CACHE_KEY);
    if (!raw) return null;
    const cached = parseUsdPriceCache(JSON.parse(raw));
    return cached ? { ...cached, status: 'stale' } : null;
  } catch {
    return null;
  }
}

function writeCachedSnapshot(snapshot: Pick<UsdPriceSnapshot, 'prices' | 'updatedAt' | 'updatedAts'>): void {
  try {
    window.localStorage.setItem(USD_PRICE_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private browsing or an embedded host may deny storage. Live fetching
    // remains fully functional without the availability cache.
  }
}

async function fetchWithRetry(signal?: AbortSignal, onProgress?: (snapshot: UsdPriceUpdate) => void) {
  try {
    return await fetchUsdPrices(fetch, signal, onProgress);
  } catch (firstFailure) {
    if (signal?.aborted) throw firstFailure;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { window.clearTimeout(timer); reject(signal?.reason); };
      const timer = window.setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 600);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    return fetchUsdPrices(fetch, signal, onProgress);
  }
}

type PriceRefreshWork = { signal?: AbortSignal; promise: Promise<void> };

/** One price fetch per provider; callers joining a live refresh await it. */
export function createPriceRefreshCoordinator(onRefreshing: (refreshing: boolean) => void) {
  let current: PriceRefreshWork | null = null;
  return {
    run(signal: AbortSignal | undefined, task: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
      if (signal?.aborted) return Promise.resolve();
      if (current && !current.signal?.aborted) return current.promise;
      const work: PriceRefreshWork = { signal, promise: Promise.resolve() };
      current = work;
      onRefreshing(true);
      work.promise = Promise.resolve().then(() => task(() => current === work && !signal?.aborted)).finally(() => {
        if (current === work) {
          current = null;
          onRefreshing(false);
        }
      });
      return work.promise;
    },
  };
}

function usePriceRuntimeValue(): PriceContextValue {
  const [snapshot, setSnapshot] = useState<UsdPriceSnapshot>(EMPTY_SNAPSHOT);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [foreground, setForeground] = useState(false);
  const priceDemandActive = useSyncExternalStore(priceDemandRegistry.subscribe, priceDemandRegistry.isActive, () => false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const refreshCoordinator = useRef<ReturnType<typeof createPriceRefreshCoordinator> | null>(null);
  if (!refreshCoordinator.current) refreshCoordinator.current = createPriceRefreshCoordinator(setIsRefreshing);

  const refresh = useCallback((signal?: AbortSignal) => {
    if (!priceDemandActive || signal?.aborted) return Promise.resolve();
    return refreshCoordinator.current!.run(signal, async (isCurrent) => {
      try {
        const applyProgress = (next: UsdPriceUpdate) => {
          if (!isCurrent()) return;
          const merged = mergeUsdPriceUpdate(snapshotRef.current, next);
          snapshotRef.current = merged;
          writeCachedSnapshot(merged);
          setSnapshot(merged);
        };
        const next = await fetchWithRetry(signal, applyProgress);
        applyProgress(next);
      } catch (cause) {
        if (!isCurrent() || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        const failed: UsdPriceSnapshot = {
          ...snapshotRef.current,
          status: Object.keys(snapshotRef.current.prices).length > 0 ? 'stale' : 'unavailable',
        };
        snapshotRef.current = failed;
        setSnapshot(failed);
      }
    });
  }, [priceDemandActive]);

  useEffect(() => {
    if (!priceDemandActive) return undefined;
    let controller: AbortController | null = null;
    const cached = readCachedSnapshot();
    if (cached && Object.keys(snapshotRef.current.prices).length === 0) {
      snapshotRef.current = cached;
      setSnapshot(cached);
    }
    const onVisibility = () => {
      controller?.abort();
      controller = null;
      if (document.visibilityState === 'visible' && navigator.onLine) {
        controller = new AbortController();
        void refresh(controller.signal);
      }
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onVisibility);
    window.addEventListener('offline', onVisibility);
    return () => {
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onVisibility);
      window.removeEventListener('offline', onVisibility);
    };
  }, [priceDemandActive, refresh]);

  useEffect(() => {
    if (!priceDemandActive || !foreground) return undefined;
    return startPriceRefreshLoop({
      refresh,
      getStatus: () => snapshotRef.current.status,
      isActive: () => document.visibilityState === 'visible' && navigator.onLine !== false,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer),
    });
    // Quote progress must not dispose the request publishing that progress.
  }, [foreground, priceDemandActive, refresh]);

  // One public Coinbase socket serves both instruments. It is foreground-only
  // so a Telegram WebView or background browser tab never holds a live stream
  // open. The validated HTTP snapshot remains the anchor and fallback.
  useEffect(() => {
    const active = () => priceDemandActive && document.visibilityState === 'visible' && navigator.onLine !== false;
    const onQuote = (quote: LiveQuote) => {
      liveMarketStore.acceptQuote(quote);
    };
    const liveController = createCoinbaseTickerController({
      getAnchors: () => ({ ETH: snapshotRef.current.prices.ETH, BTC: snapshotRef.current.prices.WBTC }),
      onQuote,
      onStatus: (status) => liveMarketStore.setStatus(status),
    });
    const sync = () => {
      const isActive = active();
      setForeground(isActive);
      liveController.setActive(isActive);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      liveController.stop();
    };
  }, [priceDemandActive]);

  const retry = useCallback(async () => { await refresh(); }, [refresh]);
  const value = useMemo(() => ({ ...snapshot, refreshing: isRefreshing, refresh: retry }), [isRefreshing, retry, snapshot]);
  return value;
}

/** Renderless implementation: its demand/cache/freshness effects retain one
 * lifetime while the route wrapper owns the stable consumer context. */
export function PriceRuntime({ publish }: { publish: (value: PriceContextValue) => void }) {
  const value = usePriceRuntimeValue();
  useEffect(() => { publish(value); }, [publish, value]);
  return null;
}

// Preserve the standalone provider API for existing consumers and fixtures.
export default function PriceProvider({ children }: { children: React.ReactNode }) {
  const value = usePriceRuntimeValue();
  return <PriceContext.Provider value={value}>{children}</PriceContext.Provider>;
}

export function useUsdPrice(key: FxTokenKey | null | undefined): number | undefined {
  const { prices } = useUsdPrices();
  return key ? prices[key] : undefined;
}

export function useLiveMarketQuote(market: MarketSymbol): { quote: LiveQuote | null; status: LiveMarketStatus; isFresh: boolean } {
  const live = useSyncExternalStore(liveMarketStore.subscribe, () => liveMarketStore.getSnapshot(market), () => EMPTY_LIVE_MARKET);
  const quote = live.quote;
  return { quote, status: live.status, isFresh: live.status === 'live' && isLiveQuoteFresh(quote, live.now) };
}
