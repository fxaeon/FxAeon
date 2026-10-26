'use client';

import { useEffect, useId, useState, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { fetchFxSaveHistory, FX_SAVE_HISTORY_SOURCE, HISTORY_DAY_MS } from '@/lib/fxSaveHistory';
import { fetchFxSaveShareHistory, FX_SAVE_SHARE_HISTORY_SOURCE } from '@/lib/fxSaveShareHistory';
import { formatUsd } from '@/lib/prices';
import { MetricLabel } from './InfoHelp';
import { MissingValue } from './MissingValue';
import { useChartWidth } from './useChartWidth';
import styles from './ProductAnalytics.module.css';

const date = (timestamp: number) => new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function FxSaveHistory() {
  const [metric, setMetric] = useState<'apy' | 'share'>('apy');
  const { ref, element, width } = useChartWidth();
  const [visible, setVisible] = useState(false);
  const [range, setRange] = useState<30 | 90>(30);
  const [selected, setSelected] = useState<number | null>(null);
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
    queryKey: ['fxsave-performance-history', metric], queryFn: async ({ signal }) => metric === 'share'
      ? (await fetchFxSaveShareHistory(signal)).map(point => ({ timestamp: point.timestamp, value: point.price }))
      : (await fetchFxSaveHistory(signal)).map(point => ({ timestamp: point.timestamp, value: point.apy })), enabled: visible,
    staleTime: 10 * 60_000, gcTime: 15 * 60_000, retry: false, refetchOnWindowFocus: false,
  });
  useEffect(() => {
    const latest = history.data?.at(-1)?.timestamp;
    const remaining = latest === undefined ? null : latest + 3 * HISTORY_DAY_MS - Date.now();
    setExpired(remaining !== null && remaining <= 0);
    if (remaining === null || remaining <= 0) return;
    const timer = setTimeout(() => setExpired(true), remaining + 1);
    return () => clearTimeout(timer);
  }, [history.data]);
  const latest = history.data?.at(-1)?.timestamp;
  const points = (history.data ?? []).filter(point => latest !== undefined && point.timestamp > latest - range * HISTORY_DAY_MS);
  const first = points[0];
  const last = points.at(-1);
  // A failed background refresh must not erase still-current dated samples.
  const ready = points.length >= 6 && last && Date.now() - last.timestamp <= 3 * HISTORY_DAY_MS && !expired;
  const average = points.reduce((sum, point) => sum + point.value, 0) / (points.length || 1);
  const active = selected === null ? undefined : points[Math.min(selected, points.length - 1)];
  const values = points.map(point => point.value);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const padding = metric === 'share' ? Math.max(.0001, (high - low) * .15) : .25;
  const minimum = Math.max(0, low - padding);
  const maximum = Math.max(high + padding, minimum + padding * 2);
  const x = (timestamp: number) => 8 + (timestamp - (first?.timestamp ?? 0)) / Math.max(1, (last?.timestamp ?? 0) - (first?.timestamp ?? 0)) * (width - 16);
  const y = (apy: number) => 126 - (apy - minimum) / (maximum - minimum) * 112;
  const line = points.map((point, index) => `${index === 0 || point.timestamp - points[index - 1].timestamp > 1.5 * HISTORY_DAY_MS ? 'M' : 'L'}${x(point.timestamp).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
  const inspectPoint = (event: PointerEvent<SVGSVGElement>) => {
    if (!first || !last) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left - 8) / Math.max(1, bounds.width - 16)));
    const target = first.timestamp + fraction * (last.timestamp - first.timestamp);
    setSelected(points.reduce((best, point, index) => Math.abs(point.timestamp - target) < Math.abs(points[best].timestamp - target) ? index : best, 0));
  };
  return <section ref={ref} className={styles.section} aria-label="fxSAVE performance">
    <header className={styles.header}>
      <h3><MetricLabel minimalHelp label="Performance" help={metric === 'apy'
        ? 'Daily APY snapshots reported by DefiLlama for Ethereum fxSAVE. The average is the arithmetic mean of the displayed samples, not a realized return. The live APY above comes from f(x). Gaps are not interpolated; this history does not forecast earnings.'
        : 'Daily USD prices per fxSAVE reported by DefiLlama, not protocol NAV. Samples are dated and gaps are not interpolated. This price history does not forecast earnings.'} /></h3>
      <div className={styles.tabs} aria-label="Performance metric">{(['apy', 'share'] as const).map(value => <button key={value} type="button" aria-pressed={metric === value} onClick={() => { setMetric(value); setSelected(null); }}>{value === 'apy' ? 'APY' : 'Share value'}</button>)}</div>
    </header>
    <div className={styles.overview}>
      <div className={styles.performanceReading} aria-live="off"><span>{metric === 'share' ? `${active ? date(active.timestamp) : last ? date(last.timestamp) : ''} · per fxSAVE` : active ? date(active.timestamp) : `${range}-day average APY`}</span><strong>{ready ? metric === 'share' ? formatUsd((active ?? last).value, 4) : `${(active?.value ?? average).toFixed(2)}%` : <MissingValue width="md" status={history.isPending && !history.isError ? 'loading' : 'unavailable'} announce={false} label={metric === 'share' ? 'Share value unavailable' : 'Average APY unavailable'} />}</strong></div>
      {<div className={styles.ranges} aria-label="Performance range">{([30, 90] as const).map(days => <button key={days} type="button" aria-pressed={range === days} onClick={() => { setRange(days); setSelected(null); }}>{days}D</button>)}</div>}
    </div>
    {ready ? <>
      <svg className={styles.plot} viewBox={`0 0 ${width} 148`} role="slider" tabIndex={0}
        aria-label={metric === 'share' ? 'Explore daily fxSAVE share value' : 'Explore daily fxSAVE APY'} aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={selected ?? points.length - 1}
        aria-valuetext={`${date((active ?? last).timestamp)}: ${metric === 'share' ? formatUsd((active ?? last).value, 4) + ' per fxSAVE' : (active ?? last).value.toFixed(2) + '% APY'}`} aria-describedby={`${id}-hint`}
        onPointerDown={inspectPoint} onPointerMove={inspectPoint}
        onPointerLeave={event => { if (event.pointerType === 'mouse') setSelected(null); }} onBlur={() => setSelected(null)} onFocus={() => setSelected(index => index ?? points.length - 1)}
        onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setSelected(index => event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.min(points.length - 1, Math.max(0, (index ?? points.length - 1) + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1)))); }}>
        <line x1="8" x2={width - 8} y1="126" y2="126" className={styles.guide} />
        <text x={width - 8} y="10" textAnchor="end" className={styles.axis}>{metric === 'share' ? formatUsd(maximum, 4) : `${maximum.toFixed(1)}%`}</text>
        <text x={width - 8} y="144" textAnchor="end" className={styles.axis}>{metric === 'share' ? formatUsd(minimum, 4) : `${minimum.toFixed(1)}%`}</text>
        <path d={line} className={styles.trace} vectorEffect="non-scaling-stroke" />
        {active && <line x1={x(active.timestamp)} x2={x(active.timestamp)} y1="14" y2="126" className={styles.cursor} />}
        <circle cx={x((active ?? last).timestamp)} cy={y((active ?? last).value)} r="4" className={styles.dot} vectorEffect="non-scaling-stroke" />
      </svg>
      <span id={`${id}-hint`} className="sr-only">Use the arrow keys to read daily samples. Home and End move to the first and last sample.</span>
      <div className={styles.dates}><span>{date(first.timestamp)}</span><span>{date(last.timestamp)}</span></div>
    </> : history.isError || history.data ? <div className={styles.empty} role="status"><span>{metric === 'share' ? 'Share value history unavailable' : 'Yield history unavailable'}</span><button type="button" disabled={history.isFetching} onClick={() => void history.refetch()}>{history.isFetching ? 'Loading…' : 'Retry'}</button></div>
      : <div className={styles.loading} role="status" aria-label={metric === 'share' ? 'Loading share value history' : 'Loading yield history'} />}
    {<div className={`${styles.source} ${styles.sourceOnly}`}><a aria-label={metric === 'share' ? 'Share price history source: DefiLlama (opens in a new tab)' : 'APY history source: DefiLlama (opens in a new tab)'} href={metric === 'share' ? FX_SAVE_SHARE_HISTORY_SOURCE : FX_SAVE_HISTORY_SOURCE} target="_blank" rel="noopener noreferrer">DefiLlama<ExternalLink size={11} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></div>}
  </section>;
}
