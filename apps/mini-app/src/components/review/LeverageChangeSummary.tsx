'use client';
import type { PairedPositionFact } from './actionReviewModel';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { formatReviewFactValue } from './reviewFactFormatting';
import styles from './ActionReviewPresentation.module.css';

function boundedReviewedValue(value: string): string {
  return formatReviewFactValue({ label: 'Position value', value }).display;
}

/** Position consequences are not wallet transfers. Show the reviewed target, never invented cash legs. */
export function LeverageChangeSummary({ facts, changes = [], receipt = false }: {
  facts: readonly ReviewFact[];
  changes?: readonly PairedPositionFact[];
  receipt?: boolean;
}) {
  const target = facts.find(fact => fact.label === 'Target leverage');
  if (!target && !changes.length) return null;
  return <section className={styles.leverageSummary} aria-label="Reviewed leverage change">
    {target && <><span className={styles.flowLabel}>{receipt ? 'Reviewed target leverage' : 'Target leverage'}</span><strong className={styles.leverageTarget}>{target.value}</strong></>}
    {changes.length > 0 && <><p className={styles.flowLabel}>Current → estimated</p><dl>{changes.map(change => <div key={change.label}><dt>{change.label}</dt><dd className={styles.leveragePair}><span>{boundedReviewedValue(change.before)}</span><span aria-hidden="true">→</span><span>{boundedReviewedValue(change.after)}</span></dd></div>)}</dl></>}

  </section>;
}
