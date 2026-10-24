'use client';

import { useEffect, useState } from 'react';
import { LIQUIDATION_QUOTE_TTL_MS, readLiquidationQuote, routeRiskScope } from './liquidationQuote';
import type { PlannedRoute, RouteDetails } from './types';

type Quote = NonNullable<RouteDetails['liquidationQuote']>;
const fresh = (quote: Quote | undefined, now = Date.now()) => Boolean(quote && now >= quote.readAt && now - quote.readAt < LIQUIDATION_QUOTE_TTL_MS);

/** Refresh display-only pool parameters beside the exact immutable route.
 * Changing form/route unbinds the old read on the same render. This never
 * replans calldata, renews route acceptance, or changes signing terms. */
export function useRouteRiskQuote(route: PlannedRoute | null | undefined): { route: PlannedRoute | null; loading: boolean } {
  const [state, setState] = useState<{ source: PlannedRoute; quote?: Quote; loading: boolean } | null>(null);
  useEffect(() => {
    const scope = route ? routeRiskScope(route) : undefined;
    if (!route || !scope) return;
    let active = true;
    let pending = false;
    let generation = 0;
    let quote = route.details?.liquidationQuote;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const publish = (loading: boolean) => {
      if (active) setState({ source: route, quote: fresh(quote) ? quote : undefined, loading });
    };
    const scheduleExpiry = () => {
      clearTimeout(expiryTimer);
      if (fresh(quote)) expiryTimer = setTimeout(() => publish(pending), Math.max(1, quote!.readAt + LIQUIDATION_QUOTE_TTL_MS - Date.now() + 1));
    };
    const load = () => {
      clearTimeout(refreshTimer);
      if (!active || pending || document.visibilityState !== 'visible' || !navigator.onLine) return;
      pending = true;
      const request = ++generation;
      publish(!fresh(quote));
      void readLiquidationQuote({ ...scope, deadlineMs: 12_000 }).then(result => {
        if (!active || request !== generation) return;
        if (result && fresh(result)) quote = result;
      }).finally(() => {
        if (!active || request !== generation) return;
        pending = false;
        publish(false);
        scheduleExpiry();
        refreshTimer = setTimeout(load, fresh(quote) ? Math.max(1_000, quote!.readAt + LIQUIDATION_QUOTE_TTL_MS / 2 - Date.now()) : 5_000);
      });
    };
    const recover = () => {
      if (!navigator.onLine || document.visibilityState !== 'visible') {
        ++generation;
        pending = false;
        quote = undefined;
        clearTimeout(refreshTimer);
        clearTimeout(expiryTimer);
        publish(false);
      } else load();
    };
    const readable = document.visibilityState === 'visible' && navigator.onLine;
    if (!readable) quote = undefined;
    publish(readable && !fresh(quote));
    scheduleExpiry();
    // Missing/timed-out planner reads recover immediately. A fresh quote is
    // refreshed halfway through its lifetime to survive ordinary RPC failover.
    if (fresh(quote)) refreshTimer = setTimeout(load, Math.max(1, quote!.readAt + LIQUIDATION_QUOTE_TTL_MS / 2 - Date.now()));
    else load();
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('online', recover);
    window.addEventListener('offline', recover);
    return () => {
      active = false;
      ++generation;
      clearTimeout(refreshTimer);
      clearTimeout(expiryTimer);
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('online', recover);
      window.removeEventListener('offline', recover);
    };
  }, [route]);
  if (!route) return { route: null, loading: false };
  if (!routeRiskScope(route)) return { route, loading: false };
  const current = state?.source === route ? state : null;
  const quote = current ? current.quote : route.details?.liquidationQuote;
  return { route: { ...route, details: { ...route.details, liquidationQuote: fresh(quote) ? quote : undefined } }, loading: current?.loading ?? !fresh(quote) };
}
