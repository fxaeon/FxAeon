'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { POOL_CAPACITY_MAX_AGE_MS, readPoolCapacity } from './poolCapacity';

/** Cached wallet-independent reads refresh quietly while a verified snapshot
 * remains fresh; an error never extends its original read timestamp. */
export function usePoolCapacity(market: 'ETH' | 'BTC', side: 'long' | 'short') {
  const [, updateClock] = useState(0);
  const query = useQuery({
    queryKey: ['fx-pool-capacity', market, side],
    queryFn: () => readPoolCapacity(market, side),
    staleTime: 45_000, gcTime: 5 * 60_000, refetchInterval: 45_000,
    refetchOnWindowFocus: true, retry: false,
  });
  useEffect(() => {
    const remaining = query.data ? query.data.readAt + POOL_CAPACITY_MAX_AGE_MS - Date.now() : null;
    if (remaining === null || remaining <= 0) return;
    const timer = setTimeout(() => updateClock(clock => clock + 1), remaining + 1);
    return () => clearTimeout(timer);
  }, [query.data]);
  const data = query.data;
  const value = data?.market === market && data.side === side && Date.now() >= data.readAt && Date.now() - data.readAt < POOL_CAPACITY_MAX_AGE_MS ? data : null;
  return { value, status: value ? 'ready' as const : query.isPending && !query.isError && query.fetchStatus !== 'paused' ? 'loading' as const : 'unavailable' as const };
}
