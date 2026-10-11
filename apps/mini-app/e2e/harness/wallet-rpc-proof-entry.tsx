import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import WalletDataProvider, { useWalletAssets, useWalletBalances } from '../../src/components/WalletDataProvider';

type Wallet = { ready: boolean; authenticated: boolean; address?: string; chainId?: number };
declare global {
  interface Window {
    __rpcHarness: { wallet: Wallet; startedAt: number; readyAt?: number };
  }
}
window.__rpcHarness = { wallet: { ready: true, authenticated: true, address: '0x0000000000000000000000000000000000001234', chainId: 1 }, startedAt: performance.now() };
function Readout({ name }: { name: string }) {
  const wallet = window.__rpcHarness.wallet;
  const exact = useWalletBalances({ address: wallet.address });
  const assets = useWalletAssets({ address: wallet.address });
  useEffect(() => {
    if (exact.status === 'ready' && assets.status === 'ready') window.__rpcHarness.readyAt ??= performance.now();
  }, [exact.status, assets.status]);
  return <section aria-label={name}>
    <output data-testid={`${name}-status`}>{exact.status}/{assets.status}</output>
    <output data-testid={`${name}-balance`}>{exact.data?.balances.find(balance => balance.key === 'ETH')?.amountWei.toString() ?? '-'}</output>
    <output data-testid={`${name}-base-balance`}>{assets.data?.assets.find(asset => asset.chainId === 8453 && asset.canonicalKey === 'ETH')?.balanceWei.toString() ?? '-'}</output>
    <button onClick={() => void exact.refresh()}>Refresh {name}</button>
  </section>;
}
function Harness() {
  const realtime = new URLSearchParams(window.location.search).has('realtime');
  const [revision, setRevision] = useState(0);
  const [active, setActive] = useState(true);
  const [expanded, setExpanded] = useState(!realtime);
  const [amount, setAmount] = useState('');
  const setWallet = (wallet: Wallet) => { window.__rpcHarness.wallet = wallet; setRevision(current => current + 1); };
  return <>
    <label>Amount<input aria-label="Amount" value={amount} onChange={event => setAmount(event.target.value)} /></label>
    <button onClick={() => setActive(current => !current)}>{active ? 'Leave wallet route' : 'Return to wallet route'}</button>
    <button onClick={() => setExpanded(current => !current)}>{expanded ? 'Close portfolio profile' : 'Open portfolio profile'}</button>
    <button onClick={() => setWallet({ ready: true, authenticated: true, address: '0x0000000000000000000000000000000000005678', chainId: 1 })}>Switch account</button>
    <button onClick={() => setWallet({ ready: true, authenticated: false })}>Disconnect</button>
    <button onClick={() => setWallet({ ready: true, authenticated: true, address: '0x0000000000000000000000000000000000001234', chainId: 1 })}>Reconnect</button>
    <span data-testid="revision">{revision}</span>
    <WalletDataProvider enabled={active} expandedAssets={active && expanded} chainPulse={realtime}>
      {active && <><Readout name="form" /><Readout name="profile" /></>}
    </WalletDataProvider>
  </>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
