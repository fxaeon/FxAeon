import type { ReviewFact } from '../../lib/fx/reviewFormatting';
import type { ReactNode } from 'react';
import { formatReviewFactValue } from './reviewFactFormatting';
import styles from './ReviewFactValue.module.css';

/** Amount-only at rest; the original value and its separate caveats stay reachable
 * by touch, keyboard and assistive technology, without a repeated chevron. */
export function ReviewFactValue({ fact, className, display, summaryLabel }: { fact: ReviewFact; className?: string; display?: ReactNode; summaryLabel?: string }) {
  const value = formatReviewFactValue(fact);
  const classes = [styles.value, className].filter(Boolean).join(' ');
  if (!value.expandable && display === undefined) return <span className={classes}>{value.display}</span>;
  return <details className={classes} data-review-value={fact.label}>
    <summary className={styles.summary} aria-label={summaryLabel ?? `${value.display}. Show full ${fact.label.toLowerCase()} value`}>
      <span>{display ?? value.display}</span>
    </summary>
    <div className={styles.expanded}>
      <div><span className={styles.detailLabel}>Full value</span><span className={styles.original}>{value.original}</span></div>
      {value.detail && <div><span className={styles.detailLabel}>Source detail</span><span className={styles.original}>{value.detail}</span></div>}
    </div>
  </details>;
}
