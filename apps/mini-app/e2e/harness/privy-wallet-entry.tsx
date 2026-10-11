import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { usePrivyWallet } from '@/lib/wallet';
import { PrivyWalletBridge } from '@/lib/wallet/PrivyWalletBridge';

type HarnessWallet = {
  address: string;
  type: 'ethereum';
  walletClientType?: string;
  chainId?: string;
  getEthereumProvider: () => Promise<{ request: () => Promise<unknown> }>;
  switchChain: () => Promise<void>;
};

type HarnessState = {
  ready: boolean;
  authenticated: boolean;
  telegram: boolean;
  initData: string;
  wallets: HarnessWallet[];
  loginCalls: unknown[];
  connectCalls: number;
  logoutCalls: number;
  telegramReconnectCalls: number;
  loginCallbacks?: { onComplete?: (params: { user: { wallet?: { address: string } } }) => void; onError?: (cause: string) => void };
  walletCallbacks?: { onSuccess?: (params: { wallet: HarnessWallet }) => void; onError?: (cause: string) => void };
  result: string;
  rerender?: () => void;
};

declare global {
  var __privyHarness: HarnessState | undefined;
}

const state: HarnessState = globalThis.__privyHarness ?? {
  ready: true,
  authenticated: false,
  telegram: false,
  initData: '',
  wallets: [],
  loginCalls: [],
  connectCalls: 0,
  logoutCalls: 0,
  telegramReconnectCalls: 0,
  result: 'idle',
};
globalThis.__privyHarness = state;

function Harness() {
  const [, setVersion] = useState(0);
  state.rerender = () => setVersion((version) => version + 1);
  const wallet = usePrivyWallet();
  useEffect(() => {
    return () => { state.rerender = undefined; };
  }, []);
  const runConnect = async (external = false) => {
    state.result = 'pending';
    state.rerender?.();
    try {
      await wallet.connect({ external });
      state.result = 'resolved';
    } catch (cause) {
      state.result = `rejected:${cause instanceof Error ? cause.message : String(cause)}`;
    }
    state.rerender?.();
  };
  const disconnect = async () => {
    await wallet.disconnect();
    state.rerender?.();
  };
  return (
    <main data-harness-ready="true" data-authenticated={String(state.authenticated)}>
      <p data-result={state.result}>{state.result}</p>
      <button type="button" onClick={() => void runConnect()}>Connect</button>
      <button type="button" onClick={() => void runConnect(true)}>Connect another wallet</button>
      <button type="button" onClick={() => void disconnect()}>Disconnect</button>
      <p data-address={wallet.address ?? ''}>{wallet.address ?? 'No wallet'}</p>
    </main>
  );
}

export default function PrivyWalletEntry() {
  return <PrivyWalletBridge><Harness /></PrivyWalletBridge>;
}

createRoot(document.getElementById('root')!).render(<PrivyWalletEntry />);
