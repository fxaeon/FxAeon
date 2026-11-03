'use client';

import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { fetchFxSaveShareHistory, FX_SAVE_SHARE_HISTORY_SOURCE, HISTORY_DAY_MS } from '@/lib/fxSaveShareHistory';
import { navHistoryRange, navPeriodReturn, trailingNavReturns } from '@/lib/fxSavePerformance';
import { formatUsd } from '@/lib/prices';
import { MetricLabel } from './InfoHelp';
import { MissingValue } from './MissingValue';
import { useChartWidth } from './useChartWidth';
import { useChartInspection } from './useChartInspection';
import { ChartIndicator } from './ChartIndicator';
import { chartObservationSegment } from '@/lib/chartObservation';
import styles from './ProductAnalytics.module.css';

const date = (timestamp: number) => new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const percent = (value: number) => `${value.toFixed(2)}%`;

export function FxSaveHistory() {
  const { ref, element, width } = useChartWidth();
  const [visible, setVisible] = useState(false);
  const [metric, setMetric] = useState<'yield' | 'share'>('yield');
  const [range, setRange] = useState<30 | 90>(30);
  const [expired, setExpired] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '100px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const history = useQuery({
    queryKey: ['fxsave-nav-performance-v2', range], queryFn: ({ signal }) => fetchFxSaveShareHistory(signal, range), enabled: visible,
    staleTime: 60 * 60_000, gcTime: 2 * 60 * 60_000, retry: false, refetchOnWindowFocus: false,
  });
  const observations = history.data ?? [];
  const latest = observations.at(-1)?.timestamp ?? 0;
  const shares = navHistoryRange(observations, range, latest);
  const points = metric === 'yield'
    ? navHistoryRange(trailingNavReturns(observations), range, latest)
    : shares.map(point => ({ timestamp: point.timestamp, value: point.price }));
  const label = metric === 'yield' ? 'Annualized return' : 'Share value';
  const format = (value: number) => metric === 'yield' ? percent(value) : formatUsd(value, 4);
  const first = points[0];
  const last = points.at(-1);
  const period = navPeriodReturn(shares.filter(point => point.timestamp >= (first?.timestamp ?? Infinity) && point.timestamp <= (last?.timestamp ?? 0)));
  const displayedAt = last?.timestamp;
  useEffect(() => {
    const remaining = displayedAt === undefined ? null : displayedAt + 3 * HISTORY_DAY_MS - Date.now();
    setExpired(remaining !== null && remaining <= 0);
    if (remaining === null || remaining <= 0) return;
    const timer = setTimeout(() => setExpired(true), remaining + 1);
    return () => clearTimeout(timer);
  }, [displayedAt]);
  const ready = points.length >= 6 && last && Date.now() - last.timestamp <= 3 * HISTORY_DAY_MS && !expired;
  const inspection = useChartInspection({ points, start: first?.timestamp ?? 0, end: last?.timestamp ?? 0, width, scope: `${metric}:${range}`, mode: 'nearest' });
  const active = inspection.index === null ? undefined : points[inspection.index];
  const values = points.map(point => point.value);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const padding = Math.max(metric === 'yield' ? .1 : .0001, (high - low) * .15);
  const minimum = metric === 'yield' ? low - padding : Math.max(0, low - padding);
  const maximum = Math.max(high + padding, minimum + padding * 2);
  const x = (timestamp: number) => 8 + (timestamp - (first?.timestamp ?? 0)) / Math.max(1, (last?.timestamp ?? 0) - (first?.timestamp ?? 0)) * (width - 16);
  const y = (price: number) => 126 - (price - minimum) / (maximum - minimum) * 112;
  const line = points.map((point, index) => `${index === 0 || point.timestamp - points[index - 1].timestamp > 1.5 * HISTORY_DAY_MS ? 'M' : 'L'}${x(point.timestamp).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
  return <section ref={ref} className={`${styles.section} ${styles.earnHistory}`} aria-label="fxSAVE performance">
    <header className={styles.header}>
      <h3><MetricLabel minimalHelp label={label} help={metric === 'yield'
        ? 'Based on 30 days of vault value; includes valuation changes. Not the current quoted APY.'
        : 'USD net asset value per fxSAVE, read at its actual Ethereum block time. Gaps are not interpolated.'} /></h3>
      <div className={styles.metricControl} aria-label="Performance metric">{(['yield', 'share'] as const).map(value => <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)}>{value === 'yield' ? 'Yield' : 'Share value'}</button>)}</div>
    </header>
    <div className={styles.overview}>
      <div className={styles.performanceReading} aria-live="off"><span>{active ? `${date(active.timestamp)}${metric === 'share' ? ' · per fxSAVE' : ''}` : last ? `${date(last.timestamp)}${metric === 'share' ? ' · per fxSAVE' : ''}` : null}</span><strong>{ready ? format((active ?? last).value) : <MissingValue width="md" status={history.isPending && !history.isError ? 'loading' : 'unavailable'} announce={false} label={`${label} unavailable`} />}</strong></div>
      <div className={styles.ranges} aria-label="Performance range">{([30, 90] as const).map(days => <button key={days} type="button" aria-pressed={range === days} onClick={() => setRange(days)}>{days}D</button>)}</div>
    </div>
    {ready ? <>
      <svg className={styles.plot} viewBox={`0 0 ${width} 148`} role="slider" tabIndex={0}
        aria-label={`Explore fxSAVE ${metric === 'yield' ? 'annualized return' : 'share value'}`} aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={inspection.index ?? points.length - 1}
        aria-valuetext={`${date((active ?? last).timestamp)}: ${format((active ?? last).value)} ${metric === 'yield' ? 'annualized return' : 'per fxSAVE'}`} aria-describedby={`${id}-hint`}
        {...inspection.handlers}>
        <text x={width - 8} y="10" textAnchor="end" className={styles.axis}>{format(maximum)}</text>
        <text x={width - 8} y="144" textAnchor="end" className={styles.axis}>{format(minimum)}</text>
        <path d={line} className={styles.trace} vectorEffect="non-scaling-stroke" />
        <ChartIndicator key={`${metric}:${range}:${chartObservationSegment(points, inspection.index ?? points.length - 1, 1.5 * HISTORY_DAY_MS)}`}
          x={x((active ?? last).timestamp)} y={y((active ?? last).value)} active={Boolean(active)} immediate={inspection.dragging} />
      </svg>
      <span id={`${id}-hint`} className="sr-only">Drag horizontally to inspect observations; swipe vertically to scroll. Arrow keys move between observations. Home and End move to the first and last sample. Escape clears inspection.</span>
      <div className={styles.dates}><span>{date(first.timestamp)}</span><span>{date(last.timestamp)}</span></div>
    </> : history.isError || history.data ? <div className={styles.empty} role="status"><span>{metric === 'yield' ? 'Yield history unavailable' : 'Share value history unavailable'}</span><button type="button" disabled={history.isFetching} onClick={() => void history.refetch()}>{history.isFetching ? 'Loading…' : 'Retry'}</button></div>
      : <div className={styles.loading} role="status" aria-label={`Loading ${metric === 'yield' ? 'yield' : 'share value'} history`} />}
    <div className={`${styles.source} ${styles.performanceSource}`}>
      {ready && period && period.days >= range && <span title={`Change between the first and last displayed NAV observations (${period.days.toFixed(2)} days).`}>Period return {period.percent > 0 ? '+' : ''}{percent(period.percent)}</span>}
      <a aria-label="Performance source: fxSAVE contract (opens in a new tab)" href={FX_SAVE_SHARE_HISTORY_SOURCE} target="_blank" rel="noopener noreferrer">fxSAVE contract<ExternalLink size={11} aria-hidden="true" /></a></div>
  </section>;
}
