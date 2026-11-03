'use client';

import { createContext, useContext } from 'react';
import type { UsdPriceSnapshot } from '@/lib/prices';

export type PriceContextValue = UsdPriceSnapshot & {
  refreshing: boolean;
  refresh: () => Promise<void>;
};

export const EMPTY_PRICE_SNAPSHOT: UsdPriceSnapshot = { prices: {}, status: 'loading', updatedAt: null };
export const PriceContext = createContext<PriceContextValue>({
  ...EMPTY_PRICE_SNAPSHOT,
  refreshing: false,
  refresh: async () => undefined,
});

/** Read the existing provider without importing its fetching implementation. */
export function useUsdPrices(): PriceContextValue {
  return useContext(PriceContext);
}
