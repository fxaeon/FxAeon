'use client';

import type { MouseEvent, ReactNode } from 'react';
import DocsIcon from './DocsIcon';
import { openExternalLink } from '@/lib/telegram';
import styles from './Docs.module.css';

/**
 * A link that leaves FxAeon: a new tab on the web, and Telegram's own browser
 * inside the Mini App, so another site never replaces the app's webview. It
 * carries the ↗ mark, which the docs keep for leaving the app only.
 */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (openExternalLink(href)) event.preventDefault();
  };
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={open}>
    {children}<DocsIcon name="ArrowUpRight" className={styles.externalMark} /><span className="sr-only"> (opens in a new tab)</span>
  </a>;
}
