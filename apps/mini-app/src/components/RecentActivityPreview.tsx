'use client';

import type { Address } from 'viem';
import dynamic from 'next/dynamic';
import { RecentActivitySkeleton } from './WalletActivitySkeleton';

// The preview is mounted only for a selected Activity tab or an open drawer.
// Keep transaction history and bridge detail code off the guest startup graph.
const WalletActivity = dynamic(() => import('./WalletActivity'), {
  loading: () => <RecentActivitySkeleton />,
});

export default function RecentActivityPreview({ walletAddress, inDialog = false }: { walletAddress: Address; inDialog?: boolean }) {
  return <WalletActivity walletAddress={walletAddress} compact inDialog={inDialog} />;
}
