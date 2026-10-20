'use client';

import { BookOpen, History, MessageCircleQuestionMark, Wallet } from 'lucide-react';
import { AppShell } from '@/components/ui';
import { ActionRow, PageHeading } from '@/components/ProductUI';
import { TransactionSettings } from '@/components/TransactionSettings';
import styles from './More.module.css';
import { AccountWorkspace } from '@/components/ProductLayout';

/** Stable destinations, whether or not a wallet is connected. */
export default function MorePage() {
  return <AppShell>
    <AccountWorkspace className={styles.workspace}>
      <PageHeading title="More" visible />
      <div className={styles.directory} data-utility-directory>
        <section className={styles.group} aria-label="Account">
          <div className={styles.links}>
            <ActionRow icon={Wallet} title="Wallet & account" href="/settings" />
            <ActionRow icon={History} title="History" href="/history" />
            <TransactionSettings slippage presentation="row" />
          </div>
        </section>
        <section className={styles.group} aria-label="Resources">
          <div className={styles.links}>
            <ActionRow icon={BookOpen} title="FxAeon docs" href="/docs" />
            <ActionRow icon={BookOpen} title="Protocol docs" href="https://fxprotocol.gitbook.io/fx-docs" external />
            <ActionRow icon={MessageCircleQuestionMark} title="Support on X" href="https://x.com/FxAeonxyz" external />
          </div>
        </section>
      </div>
    </AccountWorkspace>
  </AppShell>;
}
