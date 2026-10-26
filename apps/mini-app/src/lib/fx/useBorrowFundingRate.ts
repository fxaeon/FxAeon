'use client';

import { useEffect, useRef, useState } from 'react';
import { BORROW_FUNDING_MAX_AGE_MS, borrowFundingIsFresh, readBorrowFundingRate, type BorrowFundingRate } from './borrowFunding';
import type { FxSdkMarket } from './tokens';

/** No shared RPC promises, wallet dependency, or stale-zero fallback. */
export function useBorrowFundingRate(market: FxSdkMarket) {
  const [state, setState] = useState<{ market: FxSdkMarket; rate: BorrowFundingRate | null; status: 'loading' | 'ready' | 'unavailable' }>({ market, rate: null, status: 'loading' });
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
      const retained = borrowFundingIsFresh(rateRef.current, market) ? rateRef.current : null;
      rateRef.current = retained;
      setState({ market, rate: retained, status: retained ? 'ready' : 'loading' });
      if (retained) timer = setTimeout(expire, Math.max(1, retained.readAt + BORROW_FUNDING_MAX_AGE_MS - Date.now()));
      void readBorrowFundingRate(market).then(rate => {
        if (!active || request !== generation) return;
        const fresh = borrowFundingIsFresh(rate, market);
        clearTimeout(timer);
        rateRef.current = fresh ? rate : null;
        setState({ market, rate: rateRef.current, status: fresh ? 'ready' : 'unavailable' });
        timer = setTimeout(expire, fresh ? Math.max(1, BORROW_FUNDING_MAX_AGE_MS - (Date.now() - rate.readAt)) : BORROW_FUNDING_MAX_AGE_MS);
      }).catch(() => {
        if (!active || request !== generation) return;
        clearTimeout(timer);
        const retained = borrowFundingIsFresh(rateRef.current, market) ? rateRef.current : null;
        rateRef.current = retained;
        setState({ market, rate: retained, status: retained ? 'ready' : 'unavailable' });
        timer = setTimeout(retained ? expire : load, retained ? Math.max(1, retained.readAt + BORROW_FUNDING_MAX_AGE_MS - Date.now()) : BORROW_FUNDING_MAX_AGE_MS);
      }).finally(() => { if (request === generation) pending = false; });
    };
    const expire = () => {
      if (!active) return;
      rateRef.current = null;
      setState({ market, rate: null, status: 'unavailable' });
      load();
    };
    const recover = () => {
      if (!navigator.onLine) {
        ++generation;
        pending = false;
        clearTimeout(timer);
        rateRef.current = null;
        setState({ market, rate: null, status: 'unavailable' });
      } else if (document.visibilityState === 'visible') load();
    };
    if (!navigator.onLine || !borrowFundingIsFresh(rateRef.current, market)) rateRef.current = null;
    setState({ market, rate: rateRef.current, status: rateRef.current ? 'ready' : navigator.onLine ? 'loading' : 'unavailable' });
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
  }, [market]);
  const rate = state.market === market && borrowFundingIsFresh(state.rate, market) ? state.rate : null;
  return { rate, status: state.market !== market ? 'loading' as const : rate ? 'ready' as const : state.status === 'ready' ? 'unavailable' as const : state.status };
}
