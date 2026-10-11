import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ClientWalletProvider from '@/components/ClientWalletProvider';
import { usePrivyWallet } from '@/lib/wallet/context';
import { useWalletProviderMode } from '@/lib/wallet/providerMode';
import { isWalletConnectCancellation } from '@/lib/wallet/connectWatch';
import type { WagmiBoundarySnapshot } from './wallet-wagmi-boundary-state';

const h = globalThis.__wagmiBoundaryHarness;

function Content({ route }: { route: string }) {
  const wallet = usePrivyWallet(); // The production FxWalletContext, never a fixture context.
  const mode = useWalletProviderMode();
  const [identity] = useState(() => crypto.randomUUID());
  const [balance, setBalance] = useState('');
  useEffect(() => {
    h.childMounts += 1;
    return () => { h.childUnmounts += 1; };
  }, []);
  useEffect(() => {
    let current = true;
    setBalance('');
    if (wallet.isEmbedded && wallet.selectedWallet) {
      void wallet.selectedWallet.getEthereumProvider().then((provider) => provider.request({
        method: 'eth_getBalance', params: [wallet.address, 'latest'],
      })).then((result) => { if (current) setBalance(BigInt(String(result)).toString()); })
        .catch((error: Error) => { h.errors.push(error.message); });
    }
    return () => { current = false; };
  }, [wallet.address, wallet.isEmbedded, wallet.selectedWallet]);
  const connect = async () => {
    try { await wallet.connect(); }
    catch (error) { if (!isWalletConnectCancellation(error)) h.errors.push(error instanceof Error ? error.message : String(error)); }
  };
  return <main id="main-content" data-testid="wallet-owner" data-ready={String(wallet.ready)}
    data-provider-mode={mode} data-identity={identity} data-route={route}
    data-address={wallet.address ?? ''} data-embedded={String(wallet.isEmbedded)}
    data-wallet-client={wallet.selectedWallet?.walletClientType ?? ''} data-balance-wei={balance}
    data-authenticated={String(wallet.authenticated)}>
    <h2 tabIndex={-1}>{route === 'settings' ? 'Synthetic Settings' : 'Synthetic Portfolio'}</h2>
    <p>Owner: {mode}. Wallet type: {wallet.selectedWallet?.walletClientType ?? 'none'}.</p>
    <p>Selected address: <output>{wallet.address ?? 'Disconnected'}</output></p>
    {wallet.isEmbedded && <p>Mock funded balance: <output>{balance === '3000000000000000000' ? '3 ETH (synthetic)' : 'Loading'}</output></p>}
    <button data-wallet-connect-trigger onClick={() => void connect()}>Connect wallet</button>
  </main>;
}

function Harness() {
  const [route, setRoute] = useState(new URLSearchParams(location.search).get('route') ?? 'portfolio');
  const [generation, setGeneration] = useState(0);
  const [, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<WagmiBoundarySnapshot>(h.snapshot());
  useEffect(() => {
    const timer = window.setInterval(() => setSnapshot(h.snapshot()), 100);
    return () => clearInterval(timer);
  }, []);
  h.navigate = (next) => {
    const url = new URL(location.href);
    url.searchParams.set('route', next);
    url.hash = ''; // A real router/SDK may consume the Telegram launch hash.
    history.pushState(null, '', url);
    setRoute(next);
  };
  return <>
    <h1>Real wallet ownership boundary</h1>
    <p>Only synthetic wallets and mocked balances. No real authentication, signing, RPC, or funds.</p>
    <nav aria-label="Fixture mode">
      <a href="?mode=telegram">Telegram launch</a> <a href="?mode=web">Ordinary web</a>{' '}
      <a href="?mode=late-host">Late host hints</a> <a href="?mode=bridge-wait">Delayed Telegram bridge</a>
    </nav>
    <div className="fixture-controls">
      <button onClick={() => h.navigate?.('portfolio')}>Open portfolio</button>
      <button onClick={() => h.navigate?.('settings')}>Open settings</button>
      <button onClick={() => setGeneration((value) => value + 1)}>Remount provider</button>
      <button onClick={() => location.reload()}>Reload document</button>
      <button onClick={() => { h.installTelegram(); setVersion((value) => value + 1); }}>Add Telegram launch hints</button>
      <button onClick={() => h.announceBrowser()}>Announce injected fake</button>
    </div>
    <ClientWalletProvider key={generation}><Content route={route} /></ClientWalletProvider>
    <section aria-label="Boundary counters"><h2>Observed real Wagmi factories and mock services</h2>
      <pre data-testid="boundary-counters">{JSON.stringify(snapshot, null, 2)}</pre>
    </section>
  </>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
