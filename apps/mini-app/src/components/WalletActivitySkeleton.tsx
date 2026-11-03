'use client';

import Link from 'next/link';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { SectionTitle } from './SectionTitle';
import styles from './WalletActivity.module.css';

/** Rows in the shape of the activity they stand in for: mark, title and place, amount. */
export function ActivityRowsSkeleton({ count, label }: { count: number; label: string }) {
  return <div role="status" aria-label={label} className={styles.loading}>
    <ul className={styles.list} aria-hidden="true">{Array.from({ length: count }, (_, index) => <li key={index}><span className={styles.skeletonRow}>
      <span className={`skeleton ${styles.skeletonMark}`} />
      <span className={styles.skeletonLines}><span className="skeleton" /><span className="skeleton" /></span>
      <span className={`${styles.skeletonLines} ${styles.skeletonOutcome}`}><span className="skeleton" /><span className="skeleton" /></span>
    </span></li>)}</ul>
  </div>;
}

/** Portfolio's history preview before the wallet is known: its heading, links and three waiting rows. */
export function RecentActivitySkeleton() {
  return <section className={styles.section} aria-label="Recent history" aria-busy="true">
    <SectionTitle right={<div className={styles.toolbar}>
      <Link href="/history" aria-label="View all history">View all<ChevronRight size={14} aria-hidden="true" /></Link>
      <button type="button" className={styles.refresh} aria-label="Refresh history" title="Refresh history" disabled><RefreshCw size={16} aria-hidden="true" /></button>
    </div>}>History</SectionTitle>
    <ActivityRowsSkeleton count={3} label="Loading history" />
  </section>;
}
