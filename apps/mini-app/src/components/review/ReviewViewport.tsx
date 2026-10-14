'use client';

import type { ReactNode } from 'react';
import styles from './ActionReviewPresentation.module.css';

/** Reviews use the page's normal scroll flow, including their action area. */
export function ReviewViewport({ children, stable = false, busy = false }: { children: ReactNode; stable?: boolean; busy?: boolean }) {
  return <div data-review-viewport aria-busy={busy} data-stable-review={stable || undefined} className={[styles.reviewViewport, stable ? styles.stableReviewViewport : ''].join(' ')}>{children}</div>;
}
