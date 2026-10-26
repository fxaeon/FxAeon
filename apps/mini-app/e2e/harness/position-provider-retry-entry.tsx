import React from 'react';
import { createRoot } from 'react-dom/client';
import ProtocolPositionProvider, { useProtocolPositions } from '../../src/components/ProtocolPositionProvider';
import { usePauseAutomaticPositionRefresh } from '../../src/components/PositionRefreshActivity';

type RetryHarnessState = {
  wallet: { ready: boolean; authenticated: boolean; address: string };
  failAttempts: Record<string, number>;
  partialReads: Record<string, number[]>;
  emptyWallets: string[];
  reads: string[];
  foreground: boolean;
  block: bigint | null;
  pauses: number;
  setActivity: (pauses: number, block: number) => void;
  resume?: () => void;
  setWallet: (address: string) => void;
  unmount: () => void;
};

const initial = (window as Window & { __positionRetryConfig?: { failAttempts?: Record<string, number>; partialReads?: Record<string, number[]>; emptyWallets?: string[]; foreground?: boolean } }).__positionRetryConfig;
const state: RetryHarnessState = {
  wallet: { ready: true, authenticated: true, address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  failAttempts: Object.fromEntries(Object.entries(initial?.failAttempts ?? {}).map(([address, count]) => [address.toLowerCase(), count])),
  partialReads: Object.fromEntries(Object.entries(initial?.partialReads ?? {}).map(([address, calls]) => [address.toLowerCase(), calls])),
  emptyWallets: (initial?.emptyWallets ?? []).map(address => address.toLowerCase()),
  reads: [],
  foreground: initial?.foreground ?? true,
  block: null,
  pauses: 0,
  setActivity: () => undefined,
  setWallet: () => undefined,
  unmount: () => undefined,
};
(window as Window & { __positionRetryHarness?: RetryHarnessState }).__positionRetryHarness = state;

function Probe() {
  const positions = useProtocolPositions();
  usePauseAutomaticPositionRefresh(state.pauses > 0);
  usePauseAutomaticPositionRefresh(state.pauses > 1);
  return <main data-harness-ready="true">
    <output data-testid="status">{positions.status}</output>
    <output data-testid="reads">{state.reads.length}</output>
    <button type="button" onClick={() => { void positions.refresh(); }}>Manual refresh</button>
    {positions.positions.map((position) => <output data-testid="position" key={`${position.market}:${position.side}:${position.info.positionId}`}>
      {position.market}:{position.side}:{position.info.positionId}
    </output>)}
  </main>;
}

const root = createRoot(document.getElementById('root')!);
function render() { root.render(<ProtocolPositionProvider><Probe /></ProtocolPositionProvider>); }
state.setWallet = (address) => { state.wallet = { ...state.wallet, address }; render(); };
state.setActivity = (pauses, block) => { state.pauses = pauses; state.block = BigInt(block); render(); };
state.unmount = () => root.unmount();
document.documentElement.dataset.harnessReady = 'true';
render();
