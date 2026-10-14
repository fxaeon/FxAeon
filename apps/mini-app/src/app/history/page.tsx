'use client';

import { useState } from 'react';
import { AppShell } from '@/components/ui';
import WalletActivity, { HistoryFeedSkeleton } from '@/components/WalletActivity';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { PageHeading } from '@/components/ProductUI';
import { providerFallbackOnScreen } from '@/components/ProviderLoadingState';
import { usePrivyWallet } from '@/lib/wallet';
import type { Address } from 'viem';
import styles from '@/app/AccountWorkspace.module.css';

/** Canonical wallet-scoped journal route. While the wallet starts, the feed's
 * own skeleton holds the filters and rows the loaded history fills. */
export default function HistoryPage() {
  const wallet = usePrivyWallet();
  // When the first-paint outline already drew this feed, take its place without fading in again.
  const [continued] = useState(providerFallbackOnScreen);
  return (
    <AppShell>
      <PageHeading title="History" backHref="/more" visible />
      <div className={`${styles.workspace} ${styles.activitySection} ${styles.activityCompactWorkspace}`} data-continued={continued || undefined}>
        {!wallet.address ? (
          <WalletConnectCTA compact ready={wallet.ready} authenticated={wallet.authenticated} body="Connect to see your activity." placeholder={<HistoryFeedSkeleton />} />
        ) : (
          <WalletActivity walletAddress={wallet.address as Address} />
        )}
      </div>
    </AppShell>
  );
}
