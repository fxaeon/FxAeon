'use client';

import { createContext, useContext } from 'react';

export type WalletProviderMode = 'browser' | 'privy';
export const WalletProviderModeContext = createContext<WalletProviderMode>('browser');

/** The provider selected for this document, never inferred from an app ID alone. */
export function useWalletProviderMode(): WalletProviderMode {
  return useContext(WalletProviderModeContext);
}
