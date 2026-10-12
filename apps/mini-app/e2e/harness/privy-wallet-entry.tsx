import { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserWalletProvider, usePrivyWallet } from '@/lib/wallet';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { PrivyWalletBridge } from '@/lib/wallet/PrivyWalletBridge';
import PrivyWalletControls from '@/components/PrivyWalletSection';

type HarnessWallet = {
  address: string;
  type: string;
  walletClientType?: string;
  connectorType?: string;
  meta?: { id?: string };
  walletIndex?: number;
  imported?: boolean;
  chainId?: string;
  getEthereumProvider: () => Promise<{ request: () => Promise<unknown> }>;
  switchChain: () => Promise<void>;
};

type HarnessState = {
  ready: boolean;
  walletsReady: boolean;
  providerMode: 'privy' | 'browser';
  connectStarts: number;
  connectedCallbacks: number;
  authenticated: boolean;
  userId: string;
  telegram: boolean;
  initData: string;
  modalOpen: boolean;
  wallets: HarnessWallet[];
  loginCalls: unknown[];
  connectCalls: number;
  logoutCalls: number;
  telegramReconnectCalls: number;
  loginCallbacks?: { onComplete?: (params: unknown) => void; onError?: (cause: string) => void };
  walletCallbacks?: { onSuccess?: (params: unknown) => void; onError?: (cause: string) => void };
  results: string[];
  version: number;
  listeners: Set<() => void>;
  notify: () => void;
  remount?: () => void;
};

declare global {
  var __privyHarness: HarnessState;
}

const state: HarnessState = {
  ready: true,
  walletsReady: true,
  providerMode: 'privy',
  connectStarts: 0,
  connectedCallbacks: 0,
  authenticated: false,
  userId: 'user-a',
  telegram: false,
  initData: '',
  modalOpen: false,
  wallets: [],
  loginCalls: [],
  connectCalls: 0,
  logoutCalls: 0,
  telegramReconnectCalls: 0,
  results: [],
  version: 0,
  listeners: new Set(),
  notify: () => { state.version += 1; for (const listener of [...state.listeners]) listener(); },
};
globalThis.__privyHarness = state;

function Harness() {
  useSyncExternalStore((listener) => { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; }, () => state.version);
  const wallet = usePrivyWallet();
  const runConnect = async (external = false) => {
    const index = state.results.push('pending') - 1;
    state.notify();
    try {
      await wallet.connect({ external });
      state.results[index] = 'resolved';
    } catch (cause) {
      state.results[index] = `rejected:${cause instanceof Error ? cause.message : String(cause)}`;
    }
    state.notify();
  };
  return (
    <main data-harness-ready="true" data-wallet-ready={String(wallet.ready)} data-sdk-wallets-ready={String(state.walletsReady)} data-user-id={state.userId} data-authenticated={String(wallet.authenticated)} data-modal-open={String(state.modalOpen)} data-pending-count={state.results.filter((value) => value === 'pending').length}>
      <p data-result={state.results.at(-1) ?? 'idle'}>{state.results.at(-1) ?? 'idle'}</p>
      <button type="button" onClick={() => void runConnect()}>Connect</button>
      <button type="button" onClick={() => void runConnect(true)}>Connect another wallet</button>
      <button type="button" onClick={() => void wallet.disconnect()}>Disconnect</button>
      <button type="button" onClick={() => { state.modalOpen = false; state.notify(); }}>Close Privy modal</button>
      <p data-address={wallet.address ?? ''} data-wallet-client={wallet.selectedWallet?.walletClientType ?? ''}>{wallet.address ?? 'No wallet'}</p>
      <section aria-label="Shared wallet entry">
        <ConnectWalletButton aria-label="Route connect wallet" resumeIfConnected
          onConnectStart={() => { state.connectStarts += 1; }}
          onConnected={() => { state.connectedCallbacks += 1; }}>Connect wallet</ConnectWalletButton>
      </section>
      {state.providerMode === 'privy' && <section aria-label="Settings wallet controls"><PrivyWalletControls /></section>}
    </main>
  );
}

export default function PrivyWalletEntry() {
  const [generation, setGeneration] = useState(0);
  state.remount = () => setGeneration((value) => value + 1);
  return <div data-adapter-mount={generation}>{state.providerMode === 'browser'
    ? <BrowserWalletProvider key={generation}><Harness /></BrowserWalletProvider>
    : <PrivyWalletBridge key={generation}><Harness /></PrivyWalletBridge>}</div>;
}

createRoot(document.getElementById('root')!).render(<PrivyWalletEntry />);
