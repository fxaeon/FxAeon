'use client';

import { BookOpen, CircleDollarSign, History, MessageCircleQuestionMark, QrCode, Settings, Sparkles } from 'lucide-react';
import { AppShell } from '@/components/ui';
import { ActionRow, PageHeading, RowGroup } from '@/components/ProductUI';
import { AccountSummary } from '@/components/AccountControls';
import { useAppearance } from '@/components/AppearancePreference';
import { THEMES } from '@/lib/theme';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/SettingsWorkspace.module.css';
import { AccountWorkspace } from '@/components/ProductLayout';

/** Secondary destinations, not a duplicate portfolio or wallet manager. Each
 * group holds two rows, and a group either describes all of its rows or none. */
export default function MorePage() {
  const { theme, ready } = useAppearance();
  const wallet = usePrivyWallet();
  return <AppShell>
    <AccountWorkspace className={styles.workspace + ' ' + styles.moreWorkspace}>
      <PageHeading title="More" />
      <AccountSummary />
      <div className={styles.directory} data-utility-directory>
        <RowGroup title="Account">
          <ActionRow icon={History} title="History" href="/history" />
          <ActionRow icon={QrCode} title="Receive" description={wallet.ready && !wallet.address ? 'Connect a wallet to receive' : undefined} href="/qr" />
        </RowGroup>
        <RowGroup title="Preferences">
          <ActionRow icon={Settings} title="Settings" href="/settings" />
          <ActionRow icon={Sparkles} title="Appearance" value={ready ? THEMES[theme].name : '—'} href="/settings#appearance" />
        </RowGroup>
        <RowGroup title="f(x) Protocol">
          <ActionRow icon={CircleDollarSign} title="Borrow fxUSD" description="Manage collateral and debt" href="/borrow" />
          <ActionRow icon={BookOpen} title="Protocol docs" description="How the protocol works" href="https://fxprotocol.gitbook.io/fx-docs" external />
        </RowGroup>
        <RowGroup title="Resources">
          <ActionRow icon={BookOpen} title="FxAeon docs" href="/docs" />
          <ActionRow icon={MessageCircleQuestionMark} title="Support on X" href="https://x.com/FxAeonxyz" external />
        </RowGroup>
      </div>
    </AccountWorkspace>
  </AppShell>;
}
