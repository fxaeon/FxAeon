'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { TELEGRAM_PASSKEY_MODE } from '@/lib/miniappAccess';
import { PRIVY_APP_ID } from '@/lib/privyConfig';
import { hasTelegramMiniAppLaunchData, hasTelegramNativeHostHint, hasTelegramWebHostHint, waitForTelegramWebApp } from '@/lib/telegram';
import { BrowserWalletProvider } from '@/lib/wallet';
import { WalletProviderModeContext, type WalletProviderMode } from '@/lib/wallet/providerMode';
import { ProviderLoadingState } from '@/components/ProviderLoadingState';
import TelegramWalletUnavailable from '@/components/admission/TelegramWalletUnavailable';
import WalletRouteProviders from '@/components/WalletRouteProviders';

const TelegramPasskeyProvider = dynamic(() => import('@/components/admission/TelegramPasskeyProvider'), {
  ssr: false,
  loading: () => <ProviderLoadingState />,
});

export default function ClientWalletProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Secret-link pages are independent of both wallet login providers.
  if (pathname === '/wallet-approval' || pathname === '/wallet-approval/' || pathname === '/invite' || pathname === '/invite/') return <>{children}</>;
  return <SelectedWalletProvider>{children}</SelectedWalletProvider>;
}

function SelectedWalletProvider({ children }: { children: React.ReactNode }) {
  // The outer boundary renders configured builds client-side. Capture launch
  // intent before routing consumes Telegram's hash. A known Telegram reload
  // can restore its payload only when the asynchronous bridge arrives, so
  // settle that case before mounting either wallet. Ordinary browsers and
  // launches already carrying data remain immediate. This chooses UX only;
  // the server verifies signed Telegram identity before granting access.
  const [mode, setMode] = useState<WalletProviderMode | null>(() => {
    if (hasTelegramMiniAppLaunchData()) return 'telegram';
    const telegramHost = hasTelegramNativeHostHint() || hasTelegramWebHostHint();
    if (telegramHost) return TELEGRAM_PASSKEY_MODE && PRIVY_APP_ID ? null : 'telegram';
    return 'browser';
  });
  useEffect(() => {
    if (mode !== null) return;
    let cancelled = false;
    void waitForTelegramWebApp().then(() => {
      if (!cancelled) setMode(hasTelegramMiniAppLaunchData()
        || hasTelegramNativeHostHint() || hasTelegramWebHostHint() ? 'telegram' : 'browser');
    });
    return () => { cancelled = true; };
  }, [mode]);
  // Once selected, never replace a connected wallet after navigation or a
  // later bridge update. Known Telegram hosts remain gated in passkey mode
  // even when the bounded bridge wait ends without a signed payload.
  if (mode === null) return <ProviderLoadingState />;
  if (mode === 'telegram') return <WalletProviderModeContext.Provider value="telegram">
    {TELEGRAM_PASSKEY_MODE && PRIVY_APP_ID
      ? <TelegramPasskeyProvider>{children}</TelegramPasskeyProvider>
      : <TelegramWalletUnavailable />}
  </WalletProviderModeContext.Provider>;
  return <WalletProviderModeContext.Provider value={mode}>
    <BrowserWalletProvider><WalletRouteProviders>{children}</WalletRouteProviders></BrowserWalletProvider>
  </WalletProviderModeContext.Provider>;
}
