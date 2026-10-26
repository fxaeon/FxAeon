import type { ReviewFact } from '../../lib/fx/reviewFormatting';
import type { ReactNode } from 'react';
import { formatReviewFactValue } from './reviewFactFormatting';
import { MissingValue } from '@/components/MissingValue';
import styles from './ReviewFactValue.module.css';

/** Keep the decision value compact. Context and source notes belong to its info help. */
export function ReviewFactValue({ fact, className, display }: { fact: ReviewFact; className?: string; display?: ReactNode }) {
  const value = formatReviewFactValue(fact);
  const classes = [styles.value, className].filter(Boolean).join(' ');
  if (/^(?:Unavailable|Not quoted|—)$/i.test(fact.value.trim())) {
    const loading = fact.value === '—';
    return <span className={classes}><MissingValue width="md" status={loading ? 'loading' : 'unavailable'} announce={false} label={loading ? `Loading ${fact.label.toLowerCase()}` : `${fact.label} unavailable`} /></span>;
  }
  return <span className={classes}>{display ?? value.display}</span>;
}
