'use client';

import { BookOpen, History, MessageCircleQuestionMark, Wallet } from 'lucide-react';
import { ActionRow, PageHeading } from '@/components/ProductUI';
import { AccountWorkspace } from '@/components/ProductLayout';
import { TransactionSettings } from '@/components/TransactionSettings';
import styles from '@/app/more/More.module.css';

/** The mobile directory is an overlay, so a partially completed page stays
 * mounted behind it. The standalone /more route remains available on desktop. */
export default function MobileMoreMenu() {
  return <AccountWorkspace className={styles.workspace}>
    <PageHeading title="More" />
    <div className={styles.directory} data-utility-directory>
      <section className={styles.group} aria-labelledby="mobile-more-account">
        <h2 id="mobile-more-account">Account</h2>
        <div className={styles.links}>
          <ActionRow icon={Wallet} title="Wallet & account" href="/settings" />
          <ActionRow icon={History} title="History" href="/history" />
          <TransactionSettings slippage presentation="row" />
        </div>
      </section>
      <section className={styles.group} aria-labelledby="mobile-more-resources">
        <h2 id="mobile-more-resources">Resources</h2>
        <div className={styles.links}>
          <ActionRow icon={BookOpen} title="FxAeon docs" href="/docs" />
          <ActionRow icon={BookOpen} title="Protocol docs" href="https://fxprotocol.gitbook.io/fx-docs" external />
          <ActionRow icon={MessageCircleQuestionMark} title="Feedback & reports" href="mailto:support@fxaeon.com" />
        </div>
      </section>
    </div>
  </AccountWorkspace>;
}
