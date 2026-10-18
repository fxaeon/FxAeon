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
        <section className={styles.group} aria-labelledby="more-account">
          <h2 id="more-account">Account & preferences</h2>
          <div className={styles.links}>
            <ActionRow icon={Wallet} title="Wallet & account" description="Connections and account details" href="/settings" />
            <ActionRow icon={History} title="History" description="Trades, transfers and vault activity" href="/history" />
            <TransactionSettings slippage presentation="row" />
          </div>
        </section>
        <section className={`${styles.group} ${styles.resources}`} aria-labelledby="more-resources">
          <h2 id="more-resources">Help & resources</h2>
          <div className={styles.links}>
            <ActionRow icon={BookOpen} title="FxAeon docs" description="Guides to using the app" href="/docs" />
            <ActionRow icon={BookOpen} title="Protocol docs" description="Explore f(x) Protocol" href="https://fxprotocol.gitbook.io/fx-docs" external />
            <ActionRow icon={MessageCircleQuestionMark} title="Support on X" description="Get in touch with FxAeon" href="https://x.com/FxAeonxyz" external />
          </div>
        </section>
      </div>
    </AccountWorkspace>
  </AppShell>;
}
