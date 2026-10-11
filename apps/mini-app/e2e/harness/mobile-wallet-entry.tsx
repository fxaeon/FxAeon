import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserWalletProvider, usePrivyWallet } from '@/lib/wallet/usePrivyWallet';
import { isWalletConnectCancellation } from '@/lib/wallet/connectWatch';

type Request = { method: string; params?: unknown[] };
type Provider = {
  request: (request: Request) => Promise<unknown>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
};
export type MobileWalletFixture = {
  calls: Request[];
  holdAccounts: boolean;
  accountReadsWaiting: number;
  settleAccounts: () => void;
  holdChain: boolean;
  chainReadsWaiting: number;
  settleChain: () => void;
  holdPrompt: boolean;
  promptsWaiting: number;
  settlePrompt: () => void;
  emit: (event: string, payload?: unknown) => void;
  listenerCount: (event: string) => number;
  provider: Provider;
};
export type MobileWalletHarnessState = {
  wallets: MobileWalletFixture[];
  cancellations: number;
  errors: string[];
  announce: (index: number) => void;
  inject: (index: number) => void;
  rerender?: () => void;
};
declare global { var __mobileWalletHarness: MobileWalletHarnessState; }

const addresses = ['0x00000000000000000000000000000000000000aa', '0x00000000000000000000000000000000000000bb'];
function createFixture(index: number): MobileWalletFixture {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let accounts: string[] = new URLSearchParams(location.search).get('authorized') === '1' ? [addresses[index]] : [];
  let chain = '0x1';
  let resolveAccounts: (() => void) | undefined;
  let resolveChain: (() => void) | undefined;
  let resolvePrompt: (() => void) | undefined;
  const fixture: MobileWalletFixture = {
    calls: [], holdAccounts: new URLSearchParams(location.search).get('holdAuto') === '1', accountReadsWaiting: 0,
    settleAccounts: () => resolveAccounts?.(),
    holdChain: false, chainReadsWaiting: 0, settleChain: () => resolveChain?.(),
    holdPrompt: false, promptsWaiting: 0, settlePrompt: () => resolvePrompt?.(),
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
    emit: (event, payload) => {
      if (event === 'accountsChanged') accounts = payload as string[];
      if (event === 'chainChanged') chain = payload as string;
      if (event === 'disconnect') accounts = [];
      listeners.get(event)?.forEach((listener) => listener(payload));
    },
    provider: {
      request: async (request) => {
        fixture.calls.push(request);
        if (request.method === 'eth_requestAccounts') {
          if (fixture.holdPrompt) { fixture.promptsWaiting += 1; await new Promise<void>((resolve) => { resolvePrompt = resolve; }); }
          accounts = [addresses[index]]; return [...accounts];
        }
        if (request.method === 'eth_accounts') {
          // An already-pending RPC returns its old snapshot, so account events
          // must invalidate preflight before React has time to render again.
          const observed = [...accounts];
          if (fixture.holdAccounts) {
            fixture.accountReadsWaiting += 1;
            await new Promise<void>((resolve) => { resolveAccounts = resolve; });
          }
          return observed;
        }
        if (request.method === 'eth_chainId') {
          const observed = chain;
          if (fixture.holdChain) {
            fixture.chainReadsWaiting += 1;
            await new Promise<void>((resolve) => { resolveChain = resolve; });
          }
          return observed;
        }
        if (request.method === 'wallet_switchEthereumChain') { chain = (request.params?.[0] as { chainId: string }).chainId; return null; }
        if (request.method === 'eth_sendTransaction') return `0x${(index === 0 ? 'a' : 'b').repeat(64)}`;
        return null;
      },
      on: (event, listener) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      },
      removeListener: (event, listener) => { listeners.get(event)?.delete(listener); },
    },
  };
  return fixture;
}
const wallets = [createFixture(0), createFixture(1)];
const announce = (index: number) => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
  detail: { info: { name: `Test wallet ${index + 1}`, rdns: `test.wallet.${index + 1}` }, provider: wallets[index].provider },
}));
globalThis.__mobileWalletHarness = {
  wallets, cancellations: 0, errors: [], announce,
  inject: (index) => { window.ethereum = wallets[index].provider; },
};
const mode = new URLSearchParams(location.search).get('wallets');
if (mode === 'legacy' || mode === 'single' || mode === 'multiple') window.ethereum = wallets[0].provider;
if (mode === 'single' || mode === 'multiple') window.addEventListener('eip6963:requestProvider', () => {
  announce(0); if (mode === 'multiple') announce(1);
});

function Content() {
  const wallet = usePrivyWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hash, setHash] = useState('');
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); }
    catch (cause) {
      if (isWalletConnectCancellation(cause)) { globalThis.__mobileWalletHarness.cancellations += 1; return; }
      const message = cause instanceof Error ? cause.message : String(cause);
      globalThis.__mobileWalletHarness.errors.push(message); setError(message);
    } finally { setBusy(false); }
  };
  return <main data-harness-ready={String(wallet.ready)} data-connected={String(wallet.authenticated)}
    data-address={wallet.address ?? ''} data-chain={wallet.chainId ?? ''} data-prompt={String(wallet.promptOpen)}>
    <button disabled={busy} onClick={() => { void run(wallet.connect); }}>Connect wallet</button>
    <button onClick={() => { void run(wallet.disconnect); }}>Disconnect wallet</button>
    <button onClick={() => { void run(async () => { const result = await wallet.sendTransaction({ chainId: 1, to: '0x0000000000000000000000000000000000000001', value: 0n }); setHash(result.hash); }); }}>Send test transaction</button>
    <button onClick={() => { void run(() => wallet.switchChain(8453)); }}>Switch to Base</button>
    <output data-testid="transaction-hash">{hash}</output>
    {error && <p role="alert">{error}</p>}
  </main>;
}
function Harness() {
  const [, setVersion] = useState(0);
  globalThis.__mobileWalletHarness.rerender = () => setVersion((version) => version + 1);
  return <BrowserWalletProvider><Content /></BrowserWalletProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
