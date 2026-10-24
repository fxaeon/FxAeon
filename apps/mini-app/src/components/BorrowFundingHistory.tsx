'use client';

import { useEffect, useId, useState, type PointerEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { readBorrowFundingHistory } from '@/lib/fx/borrowFundingHistory';
import { borrowFundingDisplay, borrowFundingIsFresh, formatBorrowFundingApr, formatBorrowFundingEightHour, type BorrowFundingRate } from '@/lib/fx/borrowFunding';
import type { FxSdkMarket } from '@/lib/fx/tokens';
import { MetricLabel } from './InfoHelp';
import { useChartWidth } from './useChartWidth';
import styles from './ProductAnalytics.module.css';

const date = (timestamp: number) => new Date(timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Official pool snapshots: eight-hour collateral charges, separate from yield. */
export function BorrowFundingHistory({ market, rate, status }: { market: FxSdkMarket; rate: BorrowFundingRate | null; status: 'loading' | 'ready' | 'unavailable' }) {
  const { ref, width } = useChartWidth();
  const id = useId();
  const queryClient = useQueryClient();
  const [foreground, setForeground] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<{ market: FxSdkMarket; index: number } | null>(null);
  useEffect(() => {
    const update = () => {
      const visible = document.visibilityState === 'visible' && navigator.onLine;
      setOnline(navigator.onLine);
      setForeground(visible);
      if (!visible) void queryClient.cancelQueries({ queryKey: ['borrow-funding-history', market], exact: true });
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      void queryClient.cancelQueries({ queryKey: ['borrow-funding-history', market], exact: true });
    };
  }, [market, queryClient]);
  const history = useQuery({ queryKey: ['borrow-funding-history', market], queryFn: ({ signal }) => readBorrowFundingHistory(market, { signal }),
    enabled: foreground, staleTime: 5 * 60_000, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: true,
    refetchInterval: foreground ? 5 * 60_000 : false, refetchIntervalInBackground: false });
  const data = !history.isError && history.data?.market === market && Date.now() / 1000 - history.data.indexedAt <= 86_400 ? history.data : null;
  const points = data ? [{ timestamp: data.startAt, ratio: data.snapshots[0].ratio }, ...data.snapshots.filter(row => row.timestamp >= data.startAt)] : [];
  const last = points.at(-1);
  const activeIndex = selected?.market === market && points.length ? Math.min(Math.max(0, selected.index), points.length - 1) : null;
  const active = activeIndex === null ? undefined : points[activeIndex];
  const current = borrowFundingIsFresh(rate, market) ? borrowFundingDisplay(rate) : null;
  const maximum = Math.max(...points.map(point => Number(point.ratio) / 1e18 / 1095 * 100), .0001) * 1.15;
  const x = (timestamp: number) => 8 + (timestamp - (data?.startAt ?? 0)) / Math.max(1, (data?.endAt ?? 0) - (data?.startAt ?? 0)) * (width - 16);
  const y = (ratio: bigint) => 126 - (Number(ratio) / 1e18 / 1095 * 100) / maximum * 112;
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'H'}${x(point.timestamp).toFixed(2)}${index === 0 ? ',' : ' V'}${y(point.ratio).toFixed(2)}`).join(' ') + (data && last ? ` H${x(data.endAt).toFixed(2)}` : '');
  const inspect = (event: PointerEvent<SVGSVGElement>) => {
    if (!data) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const time = data.startAt + Math.max(0, Math.min(1, (event.clientX - bounds.left - 8) / Math.max(1, bounds.width - 16))) * (data.endAt - data.startAt);
    let index = 0;
    points.forEach((point, candidate) => { if (point.timestamp <= time) index = candidate; });
    setSelected({ market, index });
  };
  return <section ref={ref} className={styles.section} aria-label={`${market} borrow funding history`}>
    <header className={styles.header}><h3><MetricLabel minimalHelp label="Funding history" help="Official f(x) funding snapshots for this collateral pool, shown per eight hours as in fxMINT Advanced. The chart records gross charges on the whole collateral. Any short-pool earnings offset is separate. These rates are borrowing costs and can change." /></h3><span className={styles.axis}>30D · per 8h</span></header>
    <div className={styles.reading}><span><MetricLabel minimalHelp label="Current cost APR" help={current?.title ?? 'The current annualized gross charge on the whole collateral could not be verified. This is a borrowing cost; historical observations do not establish its current value.'} /></span><strong>{current && rate ? formatBorrowFundingApr(rate.ratio) : status === 'loading' ? 'Checking…' : 'Unavailable'}</strong></div>
    {data && last ? <>
      <div className={styles.reading} aria-live="off"><span>{active ? date(active.timestamp) : data.averageRatio === null ? 'Latest observed' : 'Period average'}</span><strong title={data.averageRatio === null ? undefined : `Time-weighted annualized gross charge: ${formatBorrowFundingApr(data.averageRatio)}`}>{formatBorrowFundingEightHour(active?.ratio ?? data.averageRatio ?? last.ratio)} / 8h</strong></div>
      <svg className={styles.plot} viewBox={`0 0 ${width} 148`} role="slider" tabIndex={0} aria-label="Explore historical funding charge" aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={activeIndex ?? points.length - 1} aria-valuetext={`${date((active ?? last).timestamp)}: ${formatBorrowFundingEightHour((active ?? last).ratio)} per eight hours`} aria-describedby={`${id}-hint`}
        onPointerDown={inspect} onPointerMove={inspect} onPointerLeave={event => { if (event.pointerType === 'mouse') setSelected(null); }} onFocus={() => setSelected({ market, index: points.length - 1 })} onBlur={() => setSelected(null)}
        onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setSelected(value => ({ market, index: event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (value?.market === market ? value.index : points.length - 1) + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1))) })); }}>
        <line x1="8" x2={width - 8} y1="126" y2="126" className={styles.guide} /><text x={width - 8} y="10" textAnchor="end" className={styles.axis}>{maximum.toFixed(4)}%</text><text x={width - 8} y="144" textAnchor="end" className={styles.axis}>0%</text>
        <path d={line} className={styles.trace} vectorEffect="non-scaling-stroke" />{active && <line x1={x(active.timestamp)} x2={x(active.timestamp)} y1="14" y2="126" className={styles.cursor} />}<circle cx={x(active ? active.timestamp : data.endAt)} cy={y((active ?? last).ratio)} r="4" className={styles.dot} vectorEffect="non-scaling-stroke" />
      </svg><span id={`${id}-hint`} className="sr-only">Use the arrow keys to explore funding snapshots. Home and End move to the first and last observation.</span><div className={styles.dates}><span>{date(data.startAt)}</span><span>{date(data.endAt)}</span></div>
      {data.averageRatio !== null && <div className={styles.reading}><span><MetricLabel minimalHelp label="Average cost APR" help="Time-weighted annualized gross borrowing charge across the dates shown. Each indexed rate applies until the next snapshot, ending at the index’s verified block. This is a historical cost average, not an earned return or forecast." /></span><strong>{formatBorrowFundingApr(data.averageRatio)}</strong></div>}
    </> : online === false || history.isError || history.data ? <div className={styles.empty} role="status"><span>{online === false ? 'Offline · funding history unavailable' : 'Funding history unavailable'}</span><button type="button" disabled={history.isFetching || !foreground} onClick={() => void history.refetch()}>{history.isFetching ? 'Loading…' : 'Retry'}</button></div> : <div className={styles.loading} role="status" aria-label="Loading funding history" />}
    <div className={styles.source}><span>Gross collateral charge · {market === 'ETH' ? 'stETH' : 'WBTC'}</span><a href="https://fx.aladdin.club/v2/fxmint" target="_blank" rel="noopener noreferrer">f(x) Advanced<ExternalLink size={11} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></div>
  </section>;
}
