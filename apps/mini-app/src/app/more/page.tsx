'use client';

import { BookOpen, History, MessageCircleQuestionMark, QrCode, Settings } from 'lucide-react';
import { AppShell } from '@/components/ui';
import { ActionRow, PageHeading } from '@/components/ProductUI';
import { AccountSummary } from '@/components/AccountControls';
import { usePrivyWallet } from '@/lib/wallet';
import styles from './More.module.css';
import { AccountWorkspace } from '@/components/ProductLayout';

/** Quick wallet actions followed by a quiet directory of secondary routes. */
export default function MorePage() {
  const wallet = usePrivyWallet();
  return <AppShell>
    <AccountWorkspace className={styles.workspace}>
      <PageHeading title="More" />
      {wallet.ready && wallet.authenticated && wallet.address && <AccountSummary />}
      <div className={styles.directory} data-utility-directory>
        {wallet.ready && wallet.authenticated && wallet.address && <div className={styles.quickActions}>
          <ActionRow icon={History} title="History" href="/history" />
          <ActionRow icon={QrCode} title="Receive" href="/qr" />
        </div>}
        <div className={styles.links}>
          <ActionRow icon={Settings} title="Settings" href="/settings" />
          <ActionRow icon={BookOpen} title="FxAeon docs" href="/docs" />
          <ActionRow icon={BookOpen} title="Protocol docs" href="https://fxprotocol.gitbook.io/fx-docs" external />
          <ActionRow icon={MessageCircleQuestionMark} title="Support on X" href="https://x.com/FxAeonxyz" external />
        </div>
      </div>
    </AccountWorkspace>
  </AppShell>;
}
