'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { PRIVY_APP_ID } from '@/lib/privyConfig';
import { getWebApp, hasTelegramMiniAppLaunchData, hasTelegramNativeHostHint, hasTelegramWebHostHint, waitForTelegramWebApp } from '@/lib/telegram';
import { BrowserWalletProvider } from '@/lib/wallet';
import { WalletProviderModeContext, type WalletProviderMode } from '@/lib/wallet/providerMode';
import { ProviderLoadingState } from '@/components/ProviderLoadingState';
import WalletRouteProviders from '@/components/WalletRouteProviders';

// The SDK and its authentication/session effects are loaded only for Telegram.
const TelegramWalletProvider = dynamic(() => import('@/components/PrivyClientProvider'), {
  ssr: false,
  loading: () => <ProviderLoadingState />,
});

export default function ClientWalletProvider({ children }: { children: React.ReactNode }) {
  // The outer boundary renders configured builds client-side. Capture launch
  // intent before routing consumes Telegram's hash. A known Telegram reload
  // can restore its payload only when the asynchronous bridge arrives, so
  // settle that case before mounting either wallet. Ordinary browsers and
  // launches already carrying data remain immediate. This chooses UX only;
  // Privy still verifies signed Telegram data before login.
  const [mode, setMode] = useState<WalletProviderMode | null>(() => {
    if (!PRIVY_APP_ID) return 'browser';
    if (hasTelegramMiniAppLaunchData()) return 'privy';
    return !getWebApp() && (hasTelegramNativeHostHint() || hasTelegramWebHostHint()) ? null : 'browser';
  });
  useEffect(() => {
    if (mode !== null) return;
    let cancelled = false;
    void waitForTelegramWebApp().then(() => {
      if (!cancelled) setMode(hasTelegramMiniAppLaunchData() ? 'privy' : 'browser');
    });
    return () => { cancelled = true; };
  }, [mode]);
  // Once selected, never replace a connected wallet after navigation or a
  // later bridge update. A missing bridge falls back after the bounded wait.
  if (mode === null) return <ProviderLoadingState />;
  return <WalletProviderModeContext.Provider value={mode}>
    {mode === 'privy'
      ? <TelegramWalletProvider>{children}</TelegramWalletProvider>
      : <BrowserWalletProvider allowTelegramHost={Boolean(PRIVY_APP_ID)}><WalletRouteProviders>{children}</WalletRouteProviders></BrowserWalletProvider>}
  </WalletProviderModeContext.Provider>;
}
