'use client';

import { createContext, useContext } from 'react';
import type { FxPrivyWallet } from './types';

export const FxWalletContext = createContext<FxPrivyWallet | null>(null);

export function usePrivyWallet(): FxPrivyWallet {
  const wallet = useContext(FxWalletContext);
  if (!wallet) throw new Error('usePrivyWallet must be used inside PrivyClientProvider');
  return wallet;
}
