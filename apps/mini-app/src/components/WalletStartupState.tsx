'use client';

import { StatusNotice } from '@/components/ProductUI';
import styles from './WalletStartupState.module.css';

/** Identity-independent content shared by the first paint and unresolved wallet. */
export function WalletStartupState({ timedOut = false, label = 'Loading wallet' }: { timedOut?: boolean; label?: string }) {
  return <div className={styles.stage} data-wallet-startup aria-busy={!timedOut}>
    {timedOut ? <StatusNotice tone="warning" title="Your wallet didn’t load"
      action={<button type="button" onClick={() => window.location.reload()}>Try again</button>}>
      Check your connection and try again. Your funds are unaffected.
    </StatusNotice> : <p className={styles.status} role="status" aria-label={label}>{label}…</p>}
  </div>;
}
