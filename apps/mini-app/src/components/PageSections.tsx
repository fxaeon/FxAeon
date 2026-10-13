'use client';

import { type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { openExternalLink } from '@/lib/telegram';
import styles from './PageSections.module.css';

/** Leaves FxAeon through Telegram's own browser in the Mini App, a new tab elsewhere. */
function leaveApp(href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (openExternalLink(href)) event.preventDefault();
  };
}

/**
 * The part of a page after its main action: live facts, the f(x) mechanics
 * behind the action, and the notes that matter. The general steps and
 * questions live in Docs. Longer explainers expand in place.
 */
export function PageSections({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.sections} aria-label={label} role="region">{children}</div>;
}

export function Section({ id, title, action, children, expandable = false }: {
  id: string;
  title: string;
  action?: { label: string; href: string; external?: boolean };
  children: ReactNode;
  expandable?: boolean;
}) {
  const link = action && (action.external
    ? <a className={styles.sectionAction} href={action.href} target="_blank" rel="noopener noreferrer" onClick={leaveApp(action.href)}>{action.label}<ArrowUpRight aria-hidden="true" /></a>
    : <Link className={styles.sectionAction} href={action.href}>{action.label}<ChevronRight aria-hidden="true" /></Link>);
  if (expandable) return <details id={id} className={styles.explainer}>
    <summary>{title}<ChevronDown size={16} aria-hidden="true" /></summary>
    <section aria-label={title} className={styles.explainerBody}>{children}{link}</section>
  </details>;
  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={styles.sectionHead}>
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        {link}
      </header>
      {children}
    </section>
  );
}

export type Stat = { label: string; value: ReactNode; hint?: ReactNode };

/** Facts that matter before acting, each a quiet tile: label, figure, one line of context. */
export function StatGrid({ stats }: { stats: readonly Stat[] }) {
  return <dl className={styles.stats}>
    {stats.map((stat) => <div key={stat.label} className={styles.stat}>
      <dt>{stat.label}</dt>
      <dd>{stat.value}</dd>
      {stat.hint && <dd className={styles.statHint}>{stat.hint}</dd>}
    </div>)}
  </dl>;
}

/** A note that matters (risk, limits) set apart from the facts. */
export function Callout({ icon: Icon, title, children, link }: { icon: LucideIcon; title: string; children: ReactNode; link?: { label: string; href: string } }) {
  return <div className={styles.callout}>
    <span className={styles.calloutIcon} aria-hidden="true"><Icon /></span>
    <div>
      <h3>{title}</h3>
      <p>{children}</p>
      {link && <a href={link.href} target="_blank" rel="noopener noreferrer" onClick={leaveApp(link.href)} className={styles.calloutLink}>{link.label}<ArrowUpRight aria-hidden="true" /></a>}
    </div>
  </div>;
}
