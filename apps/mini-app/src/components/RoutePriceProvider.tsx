'use client';

import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import { createPriceRuntimeBridge, PriceContext, type PriceContextValue } from './PriceContext';

type Runtime = ComponentType<{ publish: (value: PriceContextValue) => void }>;

/** Wallet/admission children mount before price code is available. The same
 * context and child positions survive the runtime's asynchronous arrival. */
export default function RoutePriceProvider({ children }: { children: React.ReactNode }) {
  const [bridge] = useState(createPriceRuntimeBridge);
  const [Runtime, setRuntime] = useState<Runtime | null>(null);
  const value = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot);
  useEffect(() => {
    let mounted = true;
    let loading = false;
    const load = () => {
      if (loading || !mounted) return;
      loading = true;
      void import('@/components/PriceProvider').then(module => {
        if (mounted) setRuntime(() => module.PriceRuntime);
      }).catch(() => {
        loading = false;
        if (mounted) bridge.fail();
      });
    };
    bridge.setLoader(load);
    load();
    return () => { mounted = false; bridge.release(); };
  }, [bridge]);
  return <PriceContext.Provider value={value}>
    {Runtime && <Runtime publish={bridge.publish} />}
    {children}
  </PriceContext.Provider>;
}
