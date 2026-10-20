'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { resetReviewViewport } from './reviewViewportReset';
import styles from './ActionReviewPresentation.module.css';

/** Phone reviews keep their decision visible while details can expand. */
export function ReviewViewport({ children, stable = false, busy = false, compact = false, phase = 'review' }: { children: ReactNode; stable?: boolean; busy?: boolean; compact?: boolean; phase?: 'review' | 'executing' | 'result' }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const previous = useRef(phase);
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const fitViewport = () => {
      // Inline review can sit below different route headings. Measure that
      // real offset rather than assuming a fixed desktop chrome height.
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const available = Math.max(180, Math.floor(viewportHeight - Math.max(0, element.getBoundingClientRect().top) - 20));
      const value = `${available}px`;
      if (element.style.getPropertyValue('--review-available-height') !== value) element.style.setProperty('--review-available-height', value);
    };
    fitViewport();
    window.addEventListener('resize', fitViewport);
    window.addEventListener('scroll', fitViewport, { passive: true });
    window.visualViewport?.addEventListener('resize', fitViewport);
    return () => {
      window.removeEventListener('resize', fitViewport);
      window.removeEventListener('scroll', fitViewport);
      window.visualViewport?.removeEventListener('resize', fitViewport);
    };
  }, [phase]);
  useLayoutEffect(() => {
    if (phase === 'executing' && previous.current !== phase) resetReviewViewport(rootRef.current);
    previous.current = phase;
  }, [phase]);
  return <div ref={rootRef} data-review-viewport data-compact-review={compact || undefined} aria-busy={busy} data-stable-review={stable || undefined} className={[styles.reviewViewport, stable ? styles.stableReviewViewport : ''].join(' ')}>{children}</div>;
}
