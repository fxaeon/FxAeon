import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BorrowPage from '@/app/borrow/page';

type HarnessState = {
  wallet: { ready: boolean; authenticated: boolean; address?: string; chainId: number; connectionVersion: number };
  shared: { walletAddress: string | null; positions: object[]; status: string; failedGroups: Array<{ market: string; side: string; reason: unknown }>; lastVerifiedAt: number | null; [key: string]: unknown };
  plannerCount: number;
  walletRequestCount: number;
  reviewAttemptCount: number;
  exerciseReviewStage: boolean;
  balances?: Record<string, { status: string; amount: string }>;
  maxRequests?: Array<{ balanceWei: bigint; resolve: (amount: bigint) => void; reject: (error: Error) => void }>;
  rerender?: () => void;
};

declare global {
  var __borrowHarness: HarnessState;
}

const accountA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const position = {
  market: 'ETH', side: 'long', stale: false,
  info: { positionId: 17, rawColls: 2n * 10n ** 18n, rawCollsDecimals: 18, rawCollsToken: 'ETH', rawDebts: 100n * 10n ** 18n, rawDebtsDecimals: 18, rawDebtsToken: 'fxUSD', currentLeverage: 2 },
};
const initialState: HarnessState = {
  wallet: { ready: true, authenticated: true, address: accountA, chainId: 1, connectionVersion: 1 },
  shared: {
    walletAddress: accountA, positions: [position], status: 'ready', failedGroups: [], lastVerifiedAt: Date.now(), refreshing: false,
    refresh: async () => ({ positions: [position], failedGroups: [], successfulGroups: [], status: 'ready', newPositions: [] }),
    trackConfirmedPosition: async () => true,
  },
  plannerCount: 0, walletRequestCount: 0, reviewAttemptCount: 0, exerciseReviewStage: false,
};

function Harness() {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => { globalThis.__borrowHarness.rerender = () => setVersion((value) => value + 1); }, []);
  return <BorrowPage />;
}

const root: Root = createRoot(document.getElementById('root')!);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
globalThis.__borrowHarness = { ...initialState, shared: { ...initialState.shared } };
root.render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
document.documentElement.dataset.harnessReady = 'true';

export {};
