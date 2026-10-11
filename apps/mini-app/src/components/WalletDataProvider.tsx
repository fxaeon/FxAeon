'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { WagmiProvider, useConfig, useWatchBlockNumber } from 'wagmi';
import { usePrivyWallet } from '@/lib/wallet';
import { createWalletDataConfig, type WalletDataConfig } from '@/lib/web3/config';
import {
  canonicalAssetReadFromWalletBalances, canonicalWalletAssetQueryOptions, createWalletQueryClient, fxSaveClaimableQueryOptions, FX_SAVE_CLAIMABLE_REFETCH_MS, FX_SAVE_CLAIMABLE_STALE_MS, invalidateWalletQueries, moveBalanceQueryOptions, refreshStaleWalletQueries, walletBalanceQueryOptions, walletQueryResultFresh, WALLET_QUERY_ROOT,
} from '@/lib/web3/walletQueries';
import type { WalletBalancesResult } from '@/lib/fx/balances';
import type { FxSaveClaimable } from '@/lib/fx';
import type { CanonicalMoveBalanceMap } from '@/lib/moveBalances';
import {
  mergeCanonicalWalletAssets,
  filterSupportedWalletAssets, type CanonicalAssetRead, type WalletAssetSnapshot,
} from '@/lib/walletAssets';
import { useUsdPrices } from '@/components/PriceProvider';
import { createAlchemyChainPulse, initialRealtimeChainState, type RealtimeChainEvent, type RealtimeChainState } from '@/lib/realtimeChain';
import { priceDemandRegistry } from '@/lib/priceDemand';
import type { FxChainId } from '@/lib/fx/types';
import { subscribeToForegroundResume } from '@/lib/foreground';
import { createDeferredQueryCacheNotification } from '@/lib/deferredQueryCacheNotification';
import { createWalletBlockRefreshGate } from '@/lib/walletDataRefresh';

const WalletDataSession = createContext('disconnected');

type WalletAssetsHookResult = {
  data: WalletAssetSnapshot | null;
  status: 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';
  isFetching: boolean;
  error: string;
  refresh: () => Promise<WalletAssetSnapshot | undefined>;
};

const EMPTY_CHAIN_STATE: Record<FxChainId, RealtimeChainState> = {
  1: initialRealtimeChainState(1),
  8453: initialRealtimeChainState(8453),
};
const WalletAssetsContext = createContext<WalletAssetsHookResult>({
  data: null, status: 'idle', isFetching: false, error: '', refresh: async () => undefined,
});
const RealtimeChainContext = createContext<Record<FxChainId, RealtimeChainState>>(EMPTY_CHAIN_STATE);

export function walletAssetRefreshChains(chainId?: FxChainId): readonly FxChainId[] {
  return chainId === undefined ? [1, 8453] : [chainId];
}

export function walletAssetRefreshKey(session: string, address: string, chainId?: FxChainId): string {
  return `${session}:${address.toLowerCase()}:${chainId ?? 'all'}`;
}

export default function WalletDataProvider({ children, enabled = true, expandedAssets = true, chainPulse = true }: { children: React.ReactNode; enabled?: boolean; expandedAssets?: boolean; chainPulse?: boolean }) {
  const wallet = usePrivyWallet();
  const [config] = useState(createWalletDataConfig);
  const [queryClient] = useState(createWalletQueryClient);
  const session = wallet.ready && wallet.authenticated && wallet.address
    ? `${wallet.address.toLowerCase()}:${wallet.chainId ?? 'unknown'}` : 'disconnected';

  useEffect(() => {
    // Cancel old-session queries, including their late RPC results, without
    // remounting the page or resetting a user's form inputs.
    const filters = { predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
      queryKey[0] === WALLET_QUERY_ROOT && (queryKey[1] === 'assets'
        ? session === 'disconnected' || queryKey[2] !== session.split(':')[0]
        : queryKey[1] !== session) };
    void queryClient.cancelQueries(filters);
    queryClient.removeQueries(filters);
  }, [queryClient, session]);
  useEffect(() => {
    // TanStack's visibility/online subscriptions handle tab/app resume. Also
    // cover wallet-extension popups returning focus to the same visible tab.
    return subscribeToForegroundResume(() => { if (enabled) void queryClient.refetchQueries({ type: 'active', stale: true }, { cancelRefetch: false }); });
  }, [enabled, queryClient]);
  useEffect(() => {
    if (!enabled) return undefined;
    return priceDemandRegistry.acquire();
  }, [enabled]);

  return <WagmiProvider config={config} reconnectOnMount={false}>
    <QueryClientProvider client={queryClient}>
      <WalletDataSession.Provider value={session}>
        <WalletAssetLayer address={wallet.address} enabled={enabled && wallet.ready && wallet.authenticated} expandedAssets={expandedAssets} chainPulse={chainPulse}>{children}</WalletAssetLayer>
      </WalletDataSession.Provider>
    </QueryClientProvider>
  </WagmiProvider>;
}

export function useWalletBalances({ address, chainId = 1, enabled = true }: {
  address?: string; chainId?: number; enabled?: boolean;
}): {
  data: WalletBalancesResult | null;
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  isFetching: boolean;
  updatedAt: number | null;
  error: string;
  refresh: (afterReceipt?: boolean) => Promise<WalletBalancesResult | undefined>;
} {
  const config = useConfig<WalletDataConfig>();
  const queryClient = useQueryClient();
  const session = useContext(WalletDataSession);
  const latestSession = useRef(session);
  latestSession.current = session;
  const active = enabled && Boolean(address) && session !== 'disconnected'
    && session.split(':')[0] === address?.toLowerCase();
  const supported = chainId === 1;
  const options = walletBalanceQueryOptions(config, session, address ?? '', chainId);
  const query = useQuery({ ...options, enabled: active && supported, refetchInterval: 60_000 });
  const refresh = useCallback(async (afterReceipt = false) => {
    if (!active || !supported || !address || latestSession.current !== session) return;
    await invalidateWalletQueries(queryClient, address, chainId, { afterReceipt });
    // Invalidation already refetched this active observer. Never recreate an
    // old session's query if the wallet changed while that read was pending.
    if (latestSession.current !== session) return;
    const key = walletBalanceQueryOptions(config, session, address, chainId).queryKey;
    if (queryClient.getQueryState(key)?.status !== 'success') return;
    return queryClient.getQueryData(key);
  }, [active, address, chainId, config, queryClient, session, supported]);
  const status = !active ? 'idle' : !supported || query.isError ? 'unavailable'
    : query.data ? 'ready' : 'loading';
  return useMemo(() => ({
    data: status === 'ready' ? query.data ?? null : null,
    status,
    isFetching: active && query.isFetching,
    updatedAt: status === 'ready' && query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null,
    error: '',
    refresh,
  }), [active, query.data, query.dataUpdatedAt, query.isFetching, refresh, status]);
}

export function useFxSaveClaimable({ address, enabled = true }: { address?: string; enabled?: boolean }): {
  data: FxSaveClaimable | null;
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  isFetching: boolean;
  updatedAt: number | null;
  refresh: () => Promise<FxSaveClaimable | undefined>;
} {
  const client = useQueryClient();
  const session = useContext(WalletDataSession);
  const latestSession = useRef(session);
  latestSession.current = session;
  const active = enabled && Boolean(address) && session !== 'disconnected'
    && session.split(':')[0] === address?.toLowerCase();
  const options = fxSaveClaimableQueryOptions(session, address ?? '');
  const query = useQuery({ ...options, enabled: active, refetchInterval: FX_SAVE_CLAIMABLE_REFETCH_MS });
  const refresh = useCallback(async () => {
    if (!active || !address || latestSession.current !== session) return;
    await invalidateWalletQueries(client, address, 1);
    if (latestSession.current !== session) return;
    const key = fxSaveClaimableQueryOptions(session, address).queryKey;
    if (client.getQueryState(key)?.status !== 'success') return;
    return client.getQueryData(key);
  }, [active, address, client, session]);
  const fresh = Boolean(query.data && walletQueryResultFresh(query.dataUpdatedAt, query.isStale, query.isFetching, Date.now(), FX_SAVE_CLAIMABLE_STALE_MS));
  const status = !active ? 'idle' : query.isError ? 'unavailable' : fresh ? 'ready' : 'loading';
  return useMemo(() => ({
    data: status === 'ready' ? query.data ?? null : null,
    status,
    isFetching: active && query.isFetching,
    updatedAt: status === 'ready' && query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null,
    refresh,
  }), [active, query.data, query.dataUpdatedAt, query.isFetching, refresh, status]);
}

export function useInvalidateWalletData() {
  const client = useQueryClient();
  return useCallback(async (address: string, chainId: number) => {
    await invalidateWalletQueries(client, address, chainId, { afterReceipt: true });
  }, [client]);
}

export function useWalletAssets({ address, enabled = true }: { address?: string; enabled?: boolean } = {}): WalletAssetsHookResult {
  const session = useContext(WalletDataSession);
  const result = useContext(WalletAssetsContext);
  if (!enabled || !address || session === 'disconnected' || session.split(':')[0] !== address.toLowerCase()) {
    return { data: null, status: 'idle', isFetching: false, error: '', refresh: async () => undefined };
  }
  return result;
}

export function useRealtimeChainState(chainId?: FxChainId): Record<FxChainId, RealtimeChainState> | RealtimeChainState {
  const state = useContext(RealtimeChainContext);
  return chainId ? state[chainId] : state;
}

function WalletAssetLayer({ address, enabled, expandedAssets, chainPulse, children }: { address?: string; enabled: boolean; expandedAssets: boolean; chainPulse: boolean; children: React.ReactNode }) {
  const config = useConfig<WalletDataConfig>();
  const client = useQueryClient();
  const session = useContext(WalletDataSession);
  const { prices, status: priceStatus, updatedAt: priceUpdatedAt, updatedAts: priceUpdatedAts } = useUsdPrices();
  const priceRef = useRef({ prices, status: priceStatus, updatedAt: priceUpdatedAt, updatedAts: priceUpdatedAts });
  priceRef.current = { prices, status: priceStatus, updatedAt: priceUpdatedAt, updatedAts: priceUpdatedAts };
  const active = enabled && expandedAssets && Boolean(address) && session !== 'disconnected' && session.split(':')[0] === address?.toLowerCase();
  const pulseActive = enabled && chainPulse && Boolean(address) && session !== 'disconnected' && session.split(':')[0] === address?.toLowerCase();
  const [chainStates, setChainStates] = useState<Record<FxChainId, RealtimeChainState>>(EMPTY_CHAIN_STATE);
  const mergedRef = useRef<WalletAssetSnapshot | null>(null);
  const requestRef = useRef(new Map<string, { controller: AbortController; promise: Promise<WalletAssetSnapshot | undefined>; session: string; address: string }>());
  const [blockRefreshGate] = useState(() => createWalletBlockRefreshGate(
    (walletAddress, chainId) => refreshStaleWalletQueries(client, walletAddress, chainId),
  ));
  const latestSession = useRef(session);
  latestSession.current = session;

  useEffect(() => { blockRefreshGate.reset(); }, [blockRefreshGate, session]);

  // Keep a bounded per-chain HTTP fallback while its websocket is reconnecting
  // or unavailable. One chain's outage must not add polling to the healthy
  // chain, and the interval remains a safety net if block polling fails.
  const ethereumFallbackInterval = chainStates[1].status === 'live' ? false : 30_000;
  const baseFallbackInterval = chainStates[8453].status === 'live' ? false : 30_000;
  const ethereum = useQuery({ ...canonicalWalletAssetQueryOptions(config, session, address ?? '', 1), enabled: active, refetchInterval: ethereumFallbackInterval });
  const base = useQuery({ ...canonicalWalletAssetQueryOptions(config, session, address ?? '', 8453), enabled: active, refetchInterval: baseFallbackInterval });

  const failedRead = useCallback((chainId: FxChainId, query: { data?: CanonicalAssetRead; isError: boolean; isPending: boolean }): CanonicalAssetRead | null => {
    if (query.data) return query.data;
    if (query.isPending || !query.isError) return null;
    const failedTokens = chainId === 1
      ? ['ETH', 'WETH', 'wstETH', 'stETH', 'WBTC', 'USDC', 'USDT', 'fxUSD', 'fxUSDBasePool', 'fxSAVE', 'FXN'] as const
      : ['ETH', 'fxUSD', 'fxSAVE'] as const;
    return { chainId, balances: [], failedTokens: [...failedTokens], updatedAt: Date.now() };
  }, []);
  const canonicalReads = useMemo(() => {
    // `isFetching` also becomes true when TanStack Query is refreshing a
    // successful result. Keep that result in the read so the merger can retain
    // the verified rows while marking the network pending. An empty pending
    // read would look like an authoritative zero balance.
    const read = (chainId: FxChainId, query: typeof ethereum) => {
      if (query.data) return {
        ...query.data,
        // A background refetch still has a last verified result. Keep that
        // result authoritative until the request settles, so a healthy total
        // does not flicker to "$" on every block pulse.
        status: query.isError ? 'unavailable' as const : query.data.status,
      };
      return query.isFetching
        ? { chainId, balances: [], failedTokens: [], updatedAt: Date.now(), status: 'pending' as const }
        : failedRead(chainId, query);
    };
    return [read(1, ethereum), read(8453, base)].filter((item): item is CanonicalAssetRead => Boolean(item));
  }, [base, ethereum, failedRead]);
  const merged = useMemo(() => {
    if (!active || !address) return null;
    if (mergedRef.current?.walletAddress !== address.toLowerCase()) mergedRef.current = null;
    // Portfolio shares the targeted balance queries used by the forms.
    // No all-token discovery, metadata pagination, or duplicate balance read.
    const previous = mergedRef.current ? filterSupportedWalletAssets(mergedRef.current) : null;
    if (canonicalReads.length === 0) return previous;
    const next = mergeCanonicalWalletAssets(previous, address, canonicalReads, { prices, status: priceStatus, updatedAt: priceUpdatedAt, updatedAts: priceUpdatedAts });
    mergedRef.current = next;
    return next;
  }, [active, address, canonicalReads, priceStatus, priceUpdatedAt, priceUpdatedAts, prices]);

  const refresh = useCallback((chainId?: FxChainId): Promise<WalletAssetSnapshot | undefined> => {
    if (!active || !address || latestSession.current !== session) return Promise.resolve(undefined);
    const addressKey = address.toLowerCase();
    const requestKey = walletAssetRefreshKey(session, addressKey, chainId);
    const existing = requestRef.current.get(requestKey)
      ?? (chainId === undefined ? undefined : requestRef.current.get(walletAssetRefreshKey(session, addressKey)));
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = (async () => {
      const chains = walletAssetRefreshChains(chainId);
      const tasks: Promise<unknown>[] = [
        ...chains.map((targetChainId) => invalidateWalletQueries(client, address, targetChainId)),
      ];
      await Promise.all(tasks);
      if (controller.signal.aborted || latestSession.current !== session) return undefined;
      const cachedCanonical = (chainId: FxChainId): CanonicalAssetRead | null => {
        const options = chainId === 1
          ? canonicalWalletAssetQueryOptions(config, session, address, 1)
          : canonicalWalletAssetQueryOptions(config, session, address, 8453);
        const key = options.queryKey;
        const data = chainId === 1
          ? (() => {
            const exact = client.getQueryData<WalletBalancesResult>(key);
            return exact ? canonicalAssetReadFromWalletBalances(exact) : undefined;
          })()
          : client.getQueryData<CanonicalAssetRead>(key);
        const state = client.getQueryState(key);
        if (data) return {
          ...data,
          status: state?.status === 'error' ? 'unavailable' : state?.fetchStatus === 'fetching' ? 'pending' : data.status,
        };
        if (state?.fetchStatus === 'fetching') return { chainId, balances: [], failedTokens: [], updatedAt: Date.now(), status: 'pending' };
        if (state?.status === 'error') return { chainId, balances: [], failedTokens: chainId === 1
          ? ['ETH', 'WETH', 'wstETH', 'stETH', 'WBTC', 'USDC', 'USDT', 'fxUSD', 'fxUSDBasePool', 'fxSAVE', 'FXN']
          : ['ETH', 'fxUSD', 'fxSAVE'], updatedAt: Date.now(), status: 'unavailable' };
        return null;
      };
      const nextCanonical = [cachedCanonical(1), cachedCanonical(8453)]
        .filter((read): read is CanonicalAssetRead => Boolean(read));
      return mergeCanonicalWalletAssets(mergedRef.current, address, nextCanonical, priceRef.current);
    })().finally(() => {
      if (requestRef.current.get(requestKey)?.controller === controller) requestRef.current.delete(requestKey);
    });
    requestRef.current.set(requestKey, { controller, promise, session, address: addressKey });
    return promise;
  }, [active, address, client, config, session]);

  const triggerRefresh = useCallback((event?: RealtimeChainEvent) => {
    void refresh(event?.chainId).catch(() => undefined);
  }, [refresh]);
  useEffect(() => {
    if (!pulseActive || !address) {
      setChainStates(EMPTY_CHAIN_STATE);
      return;
    }
    const controllers: Partial<Record<FxChainId, ReturnType<typeof createAlchemyChainPulse>>> = {};
    // Positions and protocol forms use Ethereum only. Base has live consumers
    // when the portfolio/profile requests expanded assets; otherwise its heads
    // and wallet logs would be a paid feed with nobody reading the results.
    const chains: readonly FxChainId[] = active ? [1, 8453] : [1];
    if (!active) setChainStates((current) => ({ ...current, 8453: EMPTY_CHAIN_STATE[8453] }));
    let disposed = false;
    const update = () => {
      const foreground = document.visibilityState === 'visible' && navigator.onLine;
      for (const chainId of chains) controllers[chainId]?.setActive(foreground);
    };
    for (const chainId of chains) {
      try {
        const controller = createAlchemyChainPulse({
          chainId, walletAddress: address,
          onState: (next) => { if (!disposed) setChainStates((current) => ({ ...current, [chainId]: next })); },
          onEvent: (event) => {
            if (disposed) return;
            if (event.kind === 'block') void blockRefreshGate.refresh(address, chainId);
            else triggerRefresh(event);
          },
        });
        controllers[chainId] = controller;
      } catch {
        setChainStates((current) => ({ ...current, [chainId]: { ...current[chainId], status: 'unavailable' } }));
      }
    }
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      Object.values(controllers).forEach((controller) => controller?.stop());
    };
  }, [active, address, blockRefreshGate, client, pulseActive, refresh, triggerRefresh]);
  useEffect(() => {
    for (const [key, request] of requestRef.current) {
      if (request.session !== session) {
        request.controller.abort();
        requestRef.current.delete(key);
      }
    }
  }, [session]);
  useEffect(() => () => {
    for (const request of requestRef.current.values()) request.controller.abort();
    requestRef.current.clear();
  }, []);

  const status: WalletAssetsHookResult['status'] = !active ? 'idle'
    : merged ? Object.values(merged.networks).some((network) => network.status === 'pending') ? 'loading'
      : Object.values(merged.networks).some((network) => network.status === 'unavailable') ? 'unavailable'
        : Object.values(merged.networks).some((network) => network.status === 'partial') ? 'partial' : 'ready'
      : ethereum.isError && base.isError ? 'unavailable' : 'loading';
  const error = '';
  const value = useMemo<WalletAssetsHookResult>(() => ({ data: merged, status, isFetching: ethereum.isFetching || base.isFetching, error, refresh }), [base.isFetching, error, ethereum.isFetching, merged, refresh, status]);
  return <WalletAssetsContext.Provider value={value}><RealtimeChainContext.Provider value={chainStates}><BalanceBlockWatcher chainId={1} /><BalanceBlockWatcher chainId={8453} />{children}</RealtimeChainContext.Provider></WalletAssetsContext.Provider>;
}

/** One block watcher per actively displayed chain, never one per token/card. */
function BalanceBlockWatcher({ chainId }: { chainId: 1 | 8453 }) {
  const config = useConfig<WalletDataConfig>();
  const client = useQueryClient();
  const session = useContext(WalletDataSession);
  const realtime = useContext(RealtimeChainContext)[chainId];
  const subscribe = useCallback((onStoreChange: () => void) => {
    // QueryCache can notify synchronously while a route component registers a
    // useQuery observer during render. Use TanStack's scheduler just as its own
    // React adapter does, so React never receives this store update mid-render.
    const notification = createDeferredQueryCacheNotification(onStoreChange);
    const unsubscribe = client.getQueryCache().subscribe(notification.notify);
    document.addEventListener('visibilitychange', notification.notify);
    window.addEventListener('online', notification.notify);
    window.addEventListener('offline', notification.notify);
    return () => {
      notification.dispose();
      unsubscribe();
      document.removeEventListener('visibilitychange', notification.notify);
      window.removeEventListener('online', notification.notify);
      window.removeEventListener('offline', notification.notify);
    };
  }, [client]);
  const getSnapshot = useCallback(() => {
    const active = typeof document !== 'undefined' && typeof navigator !== 'undefined'
      && realtime.status !== 'live' && session !== 'disconnected'
      && document.visibilityState === 'visible' && navigator.onLine
      && client.getQueryCache().findAll({ predicate: ({ queryKey }) =>
        queryKey[0] === WALLET_QUERY_ROOT && queryKey[1] === session && queryKey[2] === chainId,
      }).some((query) => query.isActive());
    // A public/no-RPC build must show the normal unavailable state, not throw
    // while React reads the external query-cache snapshot.
    try { if (active) config.getClient({ chainId }); return active; }
    catch { return false; }
  }, [chainId, client, config, realtime.status, session]);
  // QueryCache notifies synchronously, so subscribe schedules its change
  // callback outside the current render stack. useSyncExternalStore then keeps
  // React's snapshot reads consistent as route queries activate or settle.
  const watching = useSyncExternalStore(subscribe, getSnapshot, () => false);
  useWatchBlockNumber({
    config, chainId, enabled: watching, poll: true, pollingInterval: 12_000, emitOnBegin: false,
    onBlockNumber: (_block, previous) => {
      if (previous === undefined) return;
      void refreshStaleWalletQueries(client, session.split(':')[0], chainId);
    },
    onError: () => { /* Queries retain their own error/retry/fallback refresh state. */ },
  });
  return null;
}

export function useMoveBalances({ address, chainId, enabled = true }: { address?: string; chainId: number; enabled?: boolean }): {
  data: { balances: CanonicalMoveBalanceMap; status: 'ready' | 'unavailable' } | null;
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  isFetching: boolean;
  refresh: () => Promise<void>;
} {
  const config = useConfig<WalletDataConfig>();
  const client = useQueryClient();
  const session = useContext(WalletDataSession);
  const latestSession = useRef(session);
  latestSession.current = session;
  const active = enabled && Boolean(address) && session !== 'disconnected'
    && session.split(':')[0] === address?.toLowerCase();
  const supported = chainId === 1 || chainId === 8453;
  const query = useQuery({ ...moveBalanceQueryOptions(config, session, address ?? '', chainId),
    enabled: active && supported, refetchInterval: 60_000 });
  const refresh = useCallback(async () => {
    if (!active || !supported || !address || latestSession.current !== session) return;
    await invalidateWalletQueries(client, address, chainId);
  }, [active, address, chainId, client, session, supported]);
  const status = !active ? 'idle' : !supported || query.isError ? 'unavailable'
    : query.data?.status ?? 'loading';
  return { data: active && supported && !query.isError ? query.data ?? null : null,
    status, isFetching: active && query.isFetching, refresh };
}
