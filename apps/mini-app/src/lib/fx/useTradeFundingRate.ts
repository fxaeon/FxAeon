'use client';

import { useEffect, useRef, useState } from 'react';
import { TRADE_FUNDING_MAX_AGE_MS, tradeFundingIsFresh, readTradeFundingRate, type TradeFundingRate, type TradeFundingSide } from './tradeFunding';
import type { FxSdkMarket } from './tokens';

/** Shared wallet-independent reads retain original expiry; no stale-zero fallback. */
export function useTradeFundingRate(market: FxSdkMarket, side: TradeFundingSide) {
  const [state, setState] = useState<{ market: FxSdkMarket; side: TradeFundingSide; rate: TradeFundingRate | null; status: 'loading' | 'ready' | 'unavailable' }>({ market, side, rate: null, status: 'loading' });
  const rateRef = useRef(state.rate);
  useEffect(() => {
    let active = true;
    let generation = 0;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      if (!active || pending || document.visibilityState !== 'visible' || !navigator.onLine) return;
      clearTimeout(timer);
      const request = ++generation;
      pending = true;
      const retained = tradeFundingIsFresh(rateRef.current, market, side) ? rateRef.current : null;
      rateRef.current = retained;
      setState({ market, side, rate: retained, status: retained ? 'ready' : 'loading' });
      if (retained) timer = setTimeout(expire, Math.max(1, retained.readAt + TRADE_FUNDING_MAX_AGE_MS - Date.now()));
      void readTradeFundingRate(market, side).then(rate => {
        if (!active || request !== generation) return;
        const fresh = tradeFundingIsFresh(rate, market, side);
        clearTimeout(timer);
        rateRef.current = fresh ? rate : null;
        setState({ market, side, rate: rateRef.current, status: fresh ? 'ready' : 'unavailable' });
        timer = setTimeout(expire, fresh ? Math.max(1, TRADE_FUNDING_MAX_AGE_MS - (Date.now() - rate.readAt)) : TRADE_FUNDING_MAX_AGE_MS);
      }).catch(() => {
        if (!active || request !== generation) return;
        clearTimeout(timer);
        const retained = tradeFundingIsFresh(rateRef.current, market, side) ? rateRef.current : null;
        rateRef.current = retained;
        setState({ market, side, rate: retained, status: retained ? 'ready' : 'unavailable' });
        timer = setTimeout(retained ? expire : load, retained ? Math.max(1, retained.readAt + TRADE_FUNDING_MAX_AGE_MS - Date.now()) : TRADE_FUNDING_MAX_AGE_MS);
      }).finally(() => { if (request === generation) pending = false; });
    };
    const expire = () => {
      if (!active) return;
      rateRef.current = null;
      setState({ market, side, rate: null, status: 'unavailable' });
      load();
    };
    const recover = () => {
      if (!navigator.onLine) {
        ++generation;
        pending = false;
        clearTimeout(timer);
        rateRef.current = null;
        setState({ market, side, rate: null, status: 'unavailable' });
      } else if (document.visibilityState === 'visible') load();
    };
    if (!navigator.onLine || !tradeFundingIsFresh(rateRef.current, market, side)) rateRef.current = null;
    setState({ market, side, rate: rateRef.current, status: rateRef.current ? 'ready' : navigator.onLine ? 'loading' : 'unavailable' });
    load();
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('online', recover);
    window.addEventListener('offline', recover);
    return () => {
      active = false;
      ++generation;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('online', recover);
      window.removeEventListener('offline', recover);
    };
  }, [market, side]);
  const rate = state.market === market && state.side === side && tradeFundingIsFresh(state.rate, market, side) ? state.rate : null;
  return { rate, status: (state.market !== market || state.side !== side) ? 'loading' as const : rate ? 'ready' as const : state.status === 'ready' ? 'unavailable' as const : state.status };
}
