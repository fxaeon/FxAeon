'use client';

import { useCallback, useContext, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfig } from 'wagmi';
import type { WalletBalancesResult } from '@/lib/fx/balances';
import type { FxSaveClaimable } from '@/lib/fx';
import type { WalletDataConfig } from '@/lib/web3/config';
import {
  fxSaveClaimableQueryOptions, FX_SAVE_CLAIMABLE_REFETCH_MS, FX_SAVE_CLAIMABLE_STALE_MS,
  invalidateWalletQueries, walletBalanceQueryOptions, walletQueryResultFresh,
} from '@/lib/web3/walletQueries';
import { WalletDataSession } from './WalletDataContext';

// Query observers retain their existing session guards and refetch behavior.
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
