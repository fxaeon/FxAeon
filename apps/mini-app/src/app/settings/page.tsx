'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { AppShell, Skeleton } from '@/components/ui';
import { AccountSummary, SessionControl } from '@/components/AccountControls';
import { Disclosure, PageHeading } from '@/components/ProductUI';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/SettingsWorkspace.module.css';
import { AccountWorkspace } from '@/components/ProductLayout';

const WalletSection = dynamic(() => import('@/components/WalletSection'), { ssr: false, loading: () => <Skeleton className="h-24" /> });

/** Wallet management lives here; transaction preferences open directly from each action form and More. */
export default function SettingsPage() {
  const wallet = usePrivyWallet();
  const [walletChoicesExpanded, setWalletChoicesExpanded] = useState(Boolean(wallet.selectionRequired));
  useEffect(() => { if (wallet.selectionRequired) setWalletChoicesExpanded(true); }, [wallet.selectionRequired]);

  return <AppShell>
    <AccountWorkspace className={styles.workspace + ' ' + styles.settingsWorkspace}>
      <PageHeading title="Wallet & account" backHref="/more" />
      <section className={styles.section} aria-label="Wallet">
        <AccountSummary />
        <div className={styles.walletManagement}>
          <Disclosure title={wallet.selectionRequired ? 'Choose wallet' : 'Change wallet'} defaultOpen={walletChoicesExpanded}>
            <WalletSection />
          </Disclosure>
        </div>
      </section>
      <div className={styles.disconnect}><SessionControl /></div>
    </AccountWorkspace>
  </AppShell>;
}
