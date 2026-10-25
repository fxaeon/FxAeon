'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ORACLE_COMPARISON_MAX_AGE_MS, readOracleObservation } from './oracleComparison';

export function useOracleObservation(market: 'ETH' | 'BTC', side: 'long' | 'short') {
  const [, updateClock] = useState(0);
  const query = useQuery({ queryKey: ['fx-pool-oracle', market, side], queryFn: () => readOracleObservation(market, side),
    staleTime: 45_000, gcTime: 5 * 60_000, refetchInterval: 45_000, refetchOnWindowFocus: true, retry: false });
  useEffect(() => {
    const remaining = query.data ? query.data.readAt + ORACLE_COMPARISON_MAX_AGE_MS - Date.now() : null;
    if (remaining === null || remaining <= 0) return;
    const timer = setTimeout(() => updateClock(clock => clock + 1), remaining + 1);
    return () => clearTimeout(timer);
  }, [query.data]);
  const value = query.data?.market === market && query.data.side === side && Date.now() >= query.data.readAt && Date.now() - query.data.readAt < ORACLE_COMPARISON_MAX_AGE_MS ? query.data : null;
  return { value, status: value ? 'ready' as const : query.isPending && !query.isError && query.fetchStatus !== 'paused' ? 'loading' as const : 'unavailable' as const };
}
