import styles from './ProductAnalytics.module.css';

/** Only coordinates transition. The date, value, and accessible slider stay exact.
 * CSS retargets from the current position without restarting any reveal animation. */
export function ChartIndicator({ x, y, active, immediate, step = false }: {
  x: number; y: number; active: boolean; immediate: boolean; step?: boolean;
}) {
  return <g className={styles.indicator} data-chart-indicator data-immediate={immediate || undefined}
    data-step={step || undefined} aria-hidden="true" style={{ transform: `translateX(${x}px)` }}>
    <line x1="0" x2="0" y1="14" y2="126" className={styles.cursor} style={{ opacity: active ? .5 : 0 }} />
    <circle cx="0" cy="0" r="4" className={styles.dot} style={{ transform: `translateY(${y}px)` }} />
  </g>;
}
