import type { ReviewFact } from '../../lib/fx/reviewFormatting';
import { formatReviewFactValue } from './reviewFactFormatting';
import styles from './ReviewFactValue.module.css';

/** Amount-only at rest; the original value and its separate caveats stay reachable
 * by touch, keyboard and assistive technology, without a repeated chevron. */
export function ReviewFactValue({ fact, className }: { fact: ReviewFact; className?: string }) {
  const value = formatReviewFactValue(fact);
  const classes = [styles.value, className].filter(Boolean).join(' ');
  if (!value.expandable) return <span className={classes}>{value.display}</span>;
  return <details className={classes} data-review-value={fact.label}>
    <summary className={styles.summary} aria-label={`${value.display}. Show full ${fact.label.toLowerCase()} value`}>
      <span>{value.display}</span>
    </summary>
    <div className={styles.expanded}>
      <div><span className={styles.detailLabel}>Full value</span><span className={styles.original}>{value.original}</span></div>
      {value.detail && <div><span className={styles.detailLabel}>Source detail</span><span className={styles.original}>{value.detail}</span></div>}
    </div>
  </details>;
}
