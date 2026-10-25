'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UsdPriceSnapshot } from '../prices';
import { oracleMarketDifference, ORACLE_MARKET_MAX_SKEW_MS, type OracleObservation } from './oracleComparison';
import { fetchOracleMarketQuote, ORACLE_MARKET_REFRESH_MS } from './oracleMarketQuote';

export function useOracleMarketDifference(oracle: OracleObservation | null | undefined, prices: UsdPriceSnapshot) {
  const [, tick] = useState(0);
  const direct = oracleMarketDifference(oracle, prices);
  const token = oracle?.token;
  const query = useQuery({
    queryKey: ['fx-oracle-market-quote', token],
    queryFn: ({ signal }) => fetchOracleMarketQuote(token!, signal),
    enabled: !!token && !direct,
    staleTime: ORACLE_MARKET_REFRESH_MS, gcTime: 5 * 60_000,
    refetchInterval: ORACLE_MARKET_REFRESH_MS, retry: false,
  });
  const timestamp = direct?.marketAt ?? query.data?.updatedAt;
  useEffect(() => {
    if (!timestamp) return;
    const remaining = timestamp + ORACLE_MARKET_MAX_SKEW_MS - Date.now();
    if (remaining < 0) return;
    const timer = setTimeout(() => tick(value => value + 1), remaining + 1);
    return () => clearTimeout(timer);
  }, [timestamp]);
  return direct ?? (query.data ? oracleMarketDifference(oracle, query.data) : null);
}
