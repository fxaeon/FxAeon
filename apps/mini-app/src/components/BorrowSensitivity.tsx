'use client';

import { useState, type CSSProperties } from 'react';
import { collateralScenarioLtv } from '@/lib/borrowSensitivity';
import { MetricLabel } from './InfoHelp';
import { useChartWidth } from './useChartWidth';
import styles from './ProductAnalytics.module.css';

export function BorrowSensitivity({ debt, collateralUsd, limitBps }: { debt: bigint; collateralUsd: bigint; limitBps: bigint }) {
  const [change, setChange] = useState(0);
  const { ref, width } = useChartWidth();
  const current = collateralScenarioLtv(debt, collateralUsd, 0);
  const stressed = collateralScenarioLtv(debt, collateralUsd, change);
  const highest = collateralScenarioLtv(debt, collateralUsd, -30);
  if (current === null || stressed === null || highest === null || limitBps <= 0n) return null;
  const limit = Number(limitBps) / 100;
  const ceiling = Math.max(100, highest * 1.15, limit * 1.15);
  const x = (value: number) => 8 + (value + 30) / 60 * (width - 16);
  const y = (value: number) => 130 - value / ceiling * 112;
  const curve = Array.from({ length: 61 }, (_, index) => `${index ? 'L' : 'M'}${x(index - 30).toFixed(2)},${y(collateralScenarioLtv(debt, collateralUsd, index - 30)!).toFixed(2)}`).join(' ');
  const scenario = change === 0 ? 'Unchanged collateral value' : `${change > 0 ? '+' : '−'}${Math.abs(change)}% collateral value`;
  return <section ref={ref} className={styles.section} aria-label="Collateral sensitivity">
    <header className={styles.header}><h3><MetricLabel minimalHelp label="Collateral sensitivity" help="An illustration using the collateral value and debt entered in this form. Only collateral value changes; debt stays constant. Funding, fees, rebalancing and liquidation are not simulated. The form limit is a borrowing guard, not the liquidation threshold. Final amounts and risks are checked in review." /></h3></header>
    <div className={styles.reading}><span>{scenario}</span><strong>{stressed.toFixed(2)}% LTV</strong></div>
    <svg className={styles.plot} viewBox={`0 0 ${width} 148`} role="img" aria-label={`Illustrated loan-to-value: ${current.toFixed(2)}% now, ${stressed.toFixed(2)}% with ${scenario.toLowerCase()}`}>
      <line x1="8" x2={width - 8} y1={y(limit)} y2={y(limit)} className={styles.cursor} />
      <text x={width - 8} y={y(limit) - 7} textAnchor="end" className={styles.axis}>Form limit {limit.toFixed(1)}%</text>
      <line x1="8" x2={width - 8} y1="130" y2="130" className={styles.guide} />
      <line x1={x(change)} x2={x(change)} y1="18" y2="130" className={styles.guide} />
      <path d={curve} className={styles.trace} vectorEffect="non-scaling-stroke" />
      <circle cx={x(change)} cy={y(stressed)} r="4" className={styles.dot} vectorEffect="non-scaling-stroke" />
    </svg>
    <input className={`lever ${styles.slider}`} style={{ '--fill': `${(change + 30) / 60 * 100}%` } as CSSProperties} type="range" min={-30} max={30} step={1} value={change} aria-label="Illustrated collateral value change" aria-valuetext={`${scenario}, ${stressed.toFixed(2)}% loan-to-value`} onChange={event => setChange(Number(event.target.value))} />
    <div className={styles.dates}><span>−30%</span><span>0%</span><span>+30%</span></div>
    <p className={styles.note}>Price-only illustration. Funding, fees and protocol interventions are excluded.</p>
  </section>;
}
