'use client';

import { BookOpen, History, MessageCircleQuestionMark, Settings } from 'lucide-react';
import { AppShell } from '@/components/ui';
import { ActionRow, PageHeading } from '@/components/ProductUI';
import { usePrivyWallet } from '@/lib/wallet';
import { useWalletProviderMode } from '@/lib/wallet/providerMode';
import { TransactionSettings } from '@/components/TransactionSettings';
import styles from './More.module.css';
import { AccountWorkspace } from '@/components/ProductLayout';

/** Secondary destinations, with wallet history only for a connected account. */
export default function MorePage() {
  const wallet = usePrivyWallet();
  const providerMode = useWalletProviderMode();
  const walletSetsFees = providerMode === 'browser' || (Boolean(wallet.address) && !wallet.isEmbedded);
  return <AppShell>
    <AccountWorkspace className={styles.workspace}>
      <PageHeading title="More" />
      <div className={styles.directory} data-utility-directory>
        <div className={styles.links}>
          {wallet.ready && wallet.authenticated && wallet.address && <ActionRow icon={History} title="History" href="/history" />}
          <div className={styles.transactionSettings}>
            <span className={styles.transactionSettingsCopy}><strong>Transaction settings</strong><small>{walletSetsFees ? 'Slippage tolerance' : 'Slippage and built-in wallet gas speed'}</small></span>
            <TransactionSettings slippage />
          </div>
          <ActionRow icon={Settings} title="Wallet & account" href="/settings" />
          <ActionRow icon={BookOpen} title="FxAeon docs" href="/docs" />
          <ActionRow icon={BookOpen} title="Protocol docs" href="https://fxprotocol.gitbook.io/fx-docs" external />
          <ActionRow icon={MessageCircleQuestionMark} title="Support on X" href="https://x.com/FxAeonxyz" external />
        </div>
      </div>
    </AccountWorkspace>
  </AppShell>;
}
