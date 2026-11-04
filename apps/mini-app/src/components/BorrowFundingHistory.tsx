'use client';

import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { readBorrowFundingHistory, type BorrowFundingHistoryRange } from '@/lib/fx/borrowFundingHistory';
import { formatBorrowFundingApr, formatBorrowFundingEightHour } from '@/lib/fx/borrowFunding';
import type { FxSdkMarket } from '@/lib/fx/tokens';
import { MetricLabel } from './InfoHelp';
import { MissingValue } from './MissingValue';
import { useChartWidth } from './useChartWidth';
import { useChartInspection } from './useChartInspection';
import { ChartIndicator } from './ChartIndicator';
import { chartStepObservations } from '@/lib/chartObservation';
import styles from './ProductAnalytics.module.css';

const date = (timestamp: number, year = false) => new Date(timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', ...(year ? { year: 'numeric' as const } : {}) });
const ranges: BorrowFundingHistoryRange[] = ['1M', '3M', '6M', '1Y', 'All'];

/** Official pool snapshots: eight-hour collateral charges, separate from yield. */
export function BorrowFundingHistory({ market }: { market: FxSdkMarket }) {
  const { ref, width } = useChartWidth();
  const id = useId();
  const queryClient = useQueryClient();
  const [foreground, setForeground] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [range, setRange] = useState<BorrowFundingHistoryRange>('1Y');
  useEffect(() => {
    const update = () => {
      const visible = document.visibilityState === 'visible' && navigator.onLine;
      setOnline(navigator.onLine);
      setForeground(visible);
      if (!visible) void queryClient.cancelQueries({ queryKey: ['borrow-funding-history', market] });
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      void queryClient.cancelQueries({ queryKey: ['borrow-funding-history', market] });
    };
  }, [market, queryClient]);
  const history = useQuery({ queryKey: ['borrow-funding-history', market, range], queryFn: ({ signal }) => readBorrowFundingHistory(market, { signal, range }),
    enabled: foreground, staleTime: 5 * 60_000, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: true,
    refetchInterval: foreground ? 5 * 60_000 : false, refetchIntervalInBackground: false });
  const data = !history.isError && history.data?.market === market && Date.now() / 1000 - history.data.indexedAt <= 86_400 ? history.data : null;
  // Preserve the effective baseline's real date; the last equal-time row wins.
  const points = data ? chartStepObservations(data.snapshots, data.startAt) : [];
  const last = points.at(-1);
  const inspection = useChartInspection({ points, start: data?.startAt ?? 0, end: data?.endAt ?? 0, width, scope: `${market}:${range}`, mode: 'step' });
  const activeIndex = inspection.index;
  const active = activeIndex === null ? undefined : points[activeIndex];
  const maximum = Math.max(...points.map(point => Number(point.ratio) / 1e18 / 1095 * 100), .0001) * 1.15;
  const x = (timestamp: number) => 8 + Math.max(0, timestamp - (data?.startAt ?? 0)) / Math.max(1, (data?.endAt ?? 0) - (data?.startAt ?? 0)) * (width - 16);
  const y = (ratio: bigint) => 126 - (Number(ratio) / 1e18 / 1095 * 100) / maximum * 112;
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'H'}${x(point.timestamp).toFixed(2)}${index === 0 ? ',' : ' V'}${y(point.ratio).toFixed(2)}`).join(' ') + (data && last ? ` H${x(data.endAt).toFixed(2)}` : '');
  return <section ref={ref} className={`${styles.section} ${styles.funding}`} aria-label={`${market} borrow funding history`}>
    <header className={styles.header}><h3><MetricLabel minimalHelp label="Funding & costs" help="Official f(x) funding history for this collateral pool. The chart shows gross charges per eight hours, as in fxMINT Advanced. The average is annualized over the displayed dates. These variable costs apply to the whole collateral; any short-pool earnings offset is separate." /></h3></header>
    <div className={styles.overview}>
      <div className={styles.performanceReading}><span><MetricLabel minimalHelp label="Average cost APR" help="Time-weighted annualized gross borrowing charge over the displayed dates. Each indexed rate applies until the next snapshot, ending at the index’s verified block. This is a historical cost average, not an earned return or forecast." /></span><strong>{data?.averageRatio !== null && data?.averageRatio !== undefined ? formatBorrowFundingApr(data.averageRatio) : <MissingValue status={history.isPending && online !== false ? 'loading' : 'unavailable'} label={history.isPending && online !== false ? 'Loading average funding cost' : 'Average funding cost unavailable'} />}</strong></div>
    </div>
    <div className={styles.fundingChartHeader}><span className={styles.axis}>Funding rate / 8h</span><div className={styles.ranges} role="group" aria-label="Funding history period">{ranges.map(value => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{value}</button>)}</div></div>
    {data && last ? <>
      <div className={styles.fundingPlot}>
      <div className={styles.fundingInspection} data-active={Boolean(active)} aria-hidden={!active} aria-live="off"><span>Snapshot {date((active ?? last).timestamp)}</span><strong>{formatBorrowFundingEightHour((active ?? last).ratio)} / 8h</strong></div>
      <svg className={styles.plot} viewBox={`0 0 ${width} 148`} role="slider" tabIndex={0} aria-label="Explore historical funding charge" aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={activeIndex ?? points.length - 1} aria-valuetext={`${date((active ?? last).timestamp)}: ${formatBorrowFundingEightHour((active ?? last).ratio)} per eight hours`} aria-describedby={`${id}-hint`}
        {...inspection.handlers}>
        <line x1="8" x2={width - 8} y1="126" y2="126" className={styles.guide} /><text x={width - 8} y="10" textAnchor="end" className={styles.axis}>{maximum.toFixed(4)}%</text><text x={width - 8} y="144" textAnchor="end" className={styles.axis}>0%</text>
        <path d={line} className={styles.trace} vectorEffect="non-scaling-stroke" />
        <ChartIndicator key={`${market}:${range}`} x={x(active ? active.timestamp : data.endAt)} y={y((active ?? last).ratio)} active={Boolean(active)} immediate={inspection.dragging} step />
      </svg></div><span id={`${id}-hint`} className="sr-only">Drag horizontally to inspect snapshots; swipe vertically to scroll. Arrow keys move between snapshots. Home and End move to the first and last observation. Escape clears inspection. Dates are UTC snapshot dates; the first rate may come from before the displayed window.</span><div className={styles.dates}><span>{date(data.startAt, true)}</span><span>{date(data.endAt, true)}</span></div>
    </> : online === false || history.isError || history.data ? <div className={styles.empty} role="status"><span>{online === false ? 'Offline · funding history unavailable' : 'Funding history unavailable'}</span><button type="button" disabled={history.isFetching || !foreground} onClick={() => void history.refetch()}>{history.isFetching ? 'Loading…' : 'Retry'}</button></div> : <div className={styles.loading} role="status" aria-label="Loading funding history" />}
    <div className={styles.source}><span>{market === 'ETH' ? 'stETH collateral' : 'WBTC collateral'}</span><a href="https://fx.aladdin.club/v2/fxmint" target="_blank" rel="noopener noreferrer">f(x) Advanced<ExternalLink size={11} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></div>
  </section>;
}
