'use client';

import { createContext, useContext } from 'react';
import type { WalletAssetSnapshot } from '@/lib/walletAssets';

export const WalletDataSession = createContext('disconnected');

export type WalletAssetsHookResult = {
  data: WalletAssetSnapshot | null;
  status: 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';
  isFetching: boolean;
  error: string;
  refresh: () => Promise<WalletAssetSnapshot | undefined>;
};

export const WalletAssetsContext = createContext<WalletAssetsHookResult>({
  data: null, status: 'idle', isFetching: false, error: '', refresh: async () => undefined,
});
export function useWalletAssets({ address, enabled = true }: { address?: string; enabled?: boolean } = {}): WalletAssetsHookResult {
  const session = useContext(WalletDataSession);
  const result = useContext(WalletAssetsContext);
  if (!enabled || !address || session === 'disconnected' || session.split(':')[0] !== address.toLowerCase()) {
    return { data: null, status: 'idle', isFetching: false, error: '', refresh: async () => undefined };
  }
  return result;
}
