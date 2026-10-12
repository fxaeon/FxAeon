'use client';

/**
 * The Privy boundary loaded only for Telegram Mini App launches.
 *
 * Privy is deliberately configured as a client-side wallet and signing
 * provider. FxAeon never receives a private key, authorization key, session
 * signer grant, or transaction authority. Protocol components ask the
 * user's selected wallet to sign each planned transaction explicitly.
 *
 * Keep one provider above all authenticated routes. Only an explicit native
 * Telegram reconnect restarts it; normal route changes retain the session.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PrivyProvider, type PrivyClientConfig } from '@privy-io/react-auth';
import { base, mainnet } from 'viem/chains';
import { PRIVY_APP_ID } from '@/lib/privyConfig';
import { getSavedTheme, type ThemeId } from '@/lib/theme';
import { getWebApp, isTelegramLaunchContext, restoreTelegramLaunchHash, waitForTelegramWebApp } from '@/lib/telegram';
import { UnavailableWalletProvider } from '@/lib/wallet';
import { PrivyWalletBridge } from '@/lib/wallet/PrivyWalletBridge';
import { privyAppearance } from '@/lib/wallet/privyAppearance';
import { TelegramReconnectContext } from '@/lib/wallet/telegramReconnect';
import './privy-theme.css';
import WalletRouteProviders from '@/components/WalletRouteProviders';

export default function PrivyClientProvider({ children }: { children: React.ReactNode }) {
  const [telegramSession, setTelegramSession] = useState(0);
  const reconnectTelegram = useCallback(() => {
    // The installed SDK's explicit Telegram login opens the legacy web widget.
    // Seamless Mini App auth instead runs at provider initialization. Restart
    // that boundary only after an explicit reconnect, never after logout.
    if (!restoreTelegramLaunchHash()) {
      throw new Error('Reopen FxAeon from Telegram to sign in again.');
    }
    setTelegramSession((session) => session + 1);
  }, []);
  // Keep the first client render identical to the server. Reading localStorage
  // in the state initializer can change Privy's provider tree before hydration
  // (for example, when a visitor has saved the light palette), which shifts
  // every descendant useId. Apply the saved palette immediately after mount.
  const [theme, setTheme] = useState<ThemeId>('official');
  useEffect(() => {
    setTheme(getSavedTheme());
    const syncTheme = (event: Event) => {
      const next = (event as CustomEvent<ThemeId>).detail;
      if (next === 'official' || next === 'dark' || next === 'light') setTheme(next);
    };
    window.addEventListener('fxaeon:theme', syncTheme);
    return () => window.removeEventListener('fxaeon:theme', syncTheme);
  }, []);
  // Privy rebuilds its app configuration whenever this object changes, so it
  // changes only with the theme, not on every route change.
  const privyConfig = useMemo<PrivyClientConfig>(() => ({
    appearance: {
      // The active theme's Aeon background, accent, mark, and sign-in copy.
      // Privy takes a background hex as its theme (a dark hex selects its
      // dark palette), so Official, Dark, and Light each carry through;
      // privy-theme.css maps the rest of its palette to Aeon tokens.
      ...privyAppearance(theme),
      // FxAeon is EVM-only. Do not expose Solana wallet choices.
      walletChainType: 'ethereum-only',
      // Keep email and other enabled account methods reachable before the
      // wallet list. The dashboard remains the source of truth for which
      // login methods are enabled (including Telegram when configured).
      showWalletLoginFirst: false,
    },
    // The protocol uses Ethereum for f(x) and fxSAVE and Base as the
    // supported bridge destination/source. Ethereum remains the default.
    supportedChains: [mainnet, base],
    defaultChain: mainnet,
    embeddedWallets: {
      // Account login may create a user-owned embedded wallet only when
      // the account has no wallet. Existing external wallets are left
      // untouched, and every transaction still requires approval.
      ethereum: { createOnLogin: 'users-without-wallets' },
      // Always display Privy's signing UI. Transaction components may
      // repeat this per request; the provider-level setting is fail-safe.
      showWalletUIs: true,
    },
  }), [theme]);
  // P0 login fix: Privy's seamless Telegram Mini-App login triggers at SDK
  // mount IF `#tgWebAppData=…` is still on the URL. Our entry router drops
  // it, so restore it from WebApp.initData BEFORE the provider mounts. A
  // useState initializer runs synchronously during the first render — ahead
  // of every child/provider effect — which is exactly the ordering needed.
  // (See restoreTelegramLaunchHash for the full story.)
  const telegramLaunch = isTelegramLaunchContext();
  const [telegramBridgeSettled, setTelegramBridgeSettled] = useState(
    () => !PRIVY_APP_ID || !telegramLaunch || Boolean(getWebApp()?.initData),
  );
  useEffect(() => {
    if (!PRIVY_APP_ID || !telegramLaunch || telegramBridgeSettled) return;
    let cancelled = false;
    void (async () => {
      // If Telegram exposes its bridge after the initial render, capture the
      // signed launch payload for the next wallet hand-off. The product shell
      // is already mounted, so a slow bridge never hides the connect CTA.
      const tg = getWebApp() ?? await waitForTelegramWebApp();
      if (cancelled) return;
      if (tg?.initData) restoreTelegramLaunchHash();
      setTelegramBridgeSettled(true);
    })();
    return () => { cancelled = true; };
  }, [telegramBridgeSettled, telegramLaunch]);
  useState(() => {
    // A no-Privy build is deliberately used by static/E2E checks. It must
    // remain a plain public site: restoring Telegram's launch hash would
    // mutate the URL even though no Privy provider exists to consume it.
    if (PRIVY_APP_ID) restoreTelegramLaunchHash();
    return true;
  });
  if (!PRIVY_APP_ID) return (
    <UnavailableWalletProvider>
      <WalletRouteProviders>{children}</WalletRouteProviders>
    </UnavailableWalletProvider>
  );
  // Never gate the product shell on the Telegram bridge.  Telegram can load
  // its WebApp object a little after the document (especially on cold mobile
  // launches); keeping the whole app behind a spinner made the connect CTA
  // disappear and encouraged the browser-wallet fallback.  Privy mounts
  // immediately, while the effect above restores launch data as soon as the
  // bridge becomes available.  ConnectWalletButton queues the user's intent
  // during that hand-off.
  return (
    <TelegramReconnectContext.Provider value={reconnectTelegram}>
    <PrivyProvider
      key={telegramSession}
      appId={PRIVY_APP_ID}
      config={privyConfig}
    >
      <PrivyWalletBridge>
        <WalletRouteProviders>{children}</WalletRouteProviders>
      </PrivyWalletBridge>
    </PrivyProvider>
    </TelegramReconnectContext.Provider>
  );
}
