import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import WalletProviderBoundary from '@/components/WalletProviderBoundary';
import LoginPage from '@/app/login/page';
import WalletSection from '@/components/WalletSection';
import { TransactionSettings } from '@/components/TransactionSettings';
import { useWalletProviderMode } from '@/lib/wallet/providerMode';
import { usePrivyWallet } from '@/lib/wallet';

export type ProviderBoundaryHarnessState = {
  browserMounts: number;
  browserUnmounts: number;
  privyMounts: number;
  privyUnmounts: number;
  routeMounts: number;
  routeUnmounts: number;
  childMounts: number;
  childUnmounts: number;
  connectCalls: number;
  sdkHookCalls: number;
  importMarkers: string[];
  gasQuoteChains: number[];
  browserAllowsTelegramHost?: boolean;
  navigate?: (path: string) => void;
  rerender?: () => void;
};

declare global {
  var __providerBoundaryHarness: ProviderBoundaryHarnessState;
}

function Content({ path }: { path: string }) {
  const mode = useWalletProviderMode();
  const wallet = usePrivyWallet();
  const [identity] = useState(() => crypto.randomUUID());
  useEffect(() => {
    globalThis.__providerBoundaryHarness.childMounts += 1;
    return () => { globalThis.__providerBoundaryHarness.childUnmounts += 1; };
  }, []);
  return <section data-harness-ready="true" data-provider-mode={mode} data-identity={identity}
    data-connected={String(wallet.authenticated)}>
    {path === '/transaction-settings' ? <TransactionSettings slippage /> : path === '/settings' ? <WalletSection /> : <LoginPage />}
  </section>;
}

function Harness() {
  const [path, setPath] = useState(location.pathname.endsWith('/transaction-settings')
    ? '/transaction-settings' : location.pathname.endsWith('/settings') ? '/settings' : '/login');
  const [, setVersion] = useState(0);
  const state = globalThis.__providerBoundaryHarness;
  state.navigate = (nextPath) => {
    const variant = location.pathname.split('/')[1];
    history.pushState(null, '', `/${variant}${nextPath}`);
    setPath(nextPath);
  };
  state.rerender = () => setVersion((version) => version + 1);
  return <>
    <nav aria-label="Harness routes">
      <button onClick={() => state.navigate?.('/login')}>Open login</button>
      <button onClick={() => state.navigate?.('/settings')}>Open settings</button>
    </nav>
    <WalletProviderBoundary><Content path={path} /></WalletProviderBoundary>
  </>;
}

// Simulate a router consuming the launch hash after Telegram helpers initialize
// but before the lazy client boundary mounts.
if (new URLSearchParams(location.search).has('consumeLaunchHash')) history.replaceState(null, '', location.pathname);
createRoot(document.getElementById('root')!).render(<Harness />);
