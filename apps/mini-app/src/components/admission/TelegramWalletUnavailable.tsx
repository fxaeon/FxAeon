'use client';

import { ArrowUpRight } from 'lucide-react';
import FxLogo from '@/components/FxLogo';
import { openExternalLink } from '@/lib/telegram';
import styles from '@/components/UtilitySurfaces.module.css';

/** Disabled Telegram configuration never falls through to another signer. */
export default function TelegramWalletUnavailable() {
  const href = 'https://fxaeon.com/';
  return <main className={`${styles.loginPanel} ${styles.authStage} utility-stage mx-auto w-full`}>
    <span className={styles.authHalo} aria-hidden="true"><FxLogo size={44} /></span>
    <h1 className={styles.authTitle}>Open FxAeon in your browser</h1>
    <p className={styles.authLead}>Telegram wallet access is unavailable. Connect a wallet in your browser to continue.</p>
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="button button-primary glass-press flex min-h-12 w-full items-center justify-center gap-2 px-4 py-3 font-semibold"
      onClick={event => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && openExternalLink(href)) event.preventDefault();
      }}>Continue in browser <ArrowUpRight aria-hidden="true" /></a>
  </main>;
}
