'use client';

import { useEffect, useState } from 'react';
import { BORROW_FUNDING_MAX_AGE_MS, borrowFundingIsFresh, readBorrowFundingRate, type BorrowFundingRate } from './borrowFunding';
import type { FxSdkMarket } from './tokens';

/** No shared RPC promises, wallet dependency, or stale-zero fallback. */
export function useBorrowFundingRate(market: FxSdkMarket) {
  const [state, setState] = useState<{ market: FxSdkMarket; rate: BorrowFundingRate | null; status: 'loading' | 'ready' | 'unavailable' }>({ market, rate: null, status: 'loading' });
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
      setState({ market, rate: null, status: 'loading' });
      void readBorrowFundingRate(market).then(rate => {
        if (!active || request !== generation) return;
        const fresh = borrowFundingIsFresh(rate, market);
        setState({ market, rate: fresh ? rate : null, status: fresh ? 'ready' : 'unavailable' });
        timer = setTimeout(expire, fresh ? Math.max(1, BORROW_FUNDING_MAX_AGE_MS - (Date.now() - rate.readAt)) : BORROW_FUNDING_MAX_AGE_MS);
      }).catch(() => {
        if (!active || request !== generation) return;
        setState({ market, rate: null, status: 'unavailable' });
        timer = setTimeout(load, BORROW_FUNDING_MAX_AGE_MS);
      }).finally(() => { if (request === generation) pending = false; });
    };
    const expire = () => {
      if (!active) return;
      setState({ market, rate: null, status: 'unavailable' });
      load();
    };
    const recover = () => {
      if (!navigator.onLine) {
        ++generation;
        pending = false;
        clearTimeout(timer);
        setState({ market, rate: null, status: 'unavailable' });
      } else if (document.visibilityState === 'visible') load();
    };
    setState({ market, rate: null, status: navigator.onLine ? 'loading' : 'unavailable' });
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
