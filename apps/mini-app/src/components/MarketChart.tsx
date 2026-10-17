'use client';

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { BarChart3, ChartCandlestick, ChartLine, ChevronDown, CircleAlert, RefreshCw } from 'lucide-react';
import type { DeepPartial, IChartApi, ISeriesApi, TimeChartOptions, UTCTimestamp } from 'lightweight-charts';
import TokenIcon from '@/components/TokenIcon';
import { useLiveMarketQuote, useUsdPrices } from '@/components/PriceProvider';
import { type MarketHistorySnapshot, type MarketRange, type MarketSymbol } from '@/lib/marketData';
import { fetchMarketCandles, fetchMarketHistoryWithCoinbaseFallback, liveQuoteCandle, liveQuotePending, type LiveMarketRange, type MarketCandleSnapshot } from '@/lib/liveMarket';
import { formatUsdPrice } from '@/lib/prices';
import { haptic } from '@/lib/telegram';
import { subscribeToForegroundResume } from '@/lib/foreground';
import { createCoalescedReadCache } from '@/lib/coalescedRead';
import { formatScrubTime, localTimeShiftSeconds, scrubChangePercent, type ChartScrubReading } from '@/lib/chartTime';
import { Segmented } from '@/components/ProtocolForm';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { RollingFigure } from '@/components/RollingFigure';
import styles from '@/components/trade-surfaces.module.css';

type HistoryState = { status: 'loading' | 'ready' | 'unavailable'; snapshot: MarketHistorySnapshot | null };
const MARKET_CACHE_MAX_AGE_MS = 90_000;
const historyCache = createCoalescedReadCache<MarketHistorySnapshot>();
const candleCache = createCoalescedReadCache<MarketCandleSnapshot>();
const RANGE_OPTIONS: LiveMarketRange[] = ['1H', '1D', '7D', '30D'];
type ChartStyle = 'line' | 'candles';
const CHART_STYLES: readonly ChartStyle[] = ['line', 'candles'];
const CHART_STYLE_LABELS: Record<ChartStyle, string> = { line: 'Line chart', candles: 'Candlestick chart' };
const CHART_STYLE_KEY = 'fxaeon.chart-style.v1';
const RADIO_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

/** Device-local display preference only; it never reaches protocol state. */
function useChartStyle(): [ChartStyle, (style: ChartStyle) => void] {
  const [style, setStyle] = useState<ChartStyle>('line');
  useEffect(() => {
    try { if (window.localStorage.getItem(CHART_STYLE_KEY) === 'candles') setStyle('candles'); } catch { /* storage unavailable */ }
  }, []);
  const update = useCallback((next: ChartStyle) => {
    setStyle(next);
    try { window.localStorage.setItem(CHART_STYLE_KEY, next); } catch { /* storage unavailable */ }
  }, []);
  return [style, update];
}

/** Roving radio-group keys: arrows wrap, Home and End jump, focus follows the choice. */
function moveRadio<T>(event: KeyboardEvent<HTMLButtonElement>, options: readonly T[], focused: T, select: (value: T) => void) {
  if (!RADIO_KEYS.includes(event.key)) return;
  event.preventDefault();
  const current = options.indexOf(focused);
  const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (backwards ? -1 : 1) + options.length) % options.length;
  select(options[next]);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  haptic('selection');
}

function boundedSignal(signal: AbortSignal, timeoutMs = 15_000): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

export function useMarketHistory(market: MarketSymbol, range: MarketRange): HistoryState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<HistoryState>({ status: 'loading', snapshot: null });
  const stateRef = useRef(state);
  stateRef.current = state;
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    const key = `${market}:${range}`;
    const cached = historyCache.getFresh(key, Date.now(), MARKET_CACHE_MAX_AGE_MS);
    if (cached) setState({ status: 'ready', snapshot: cached });
    else setState({ status: 'loading', snapshot: null });
    if (cached) return () => { active = false; };
    void historyCache.read(key, () => {
      const controller = new AbortController();
      return fetchMarketHistoryWithCoinbaseFallback(market, range, fetch, boundedSignal(controller.signal));
    }).then((snapshot) => {
      if (!active) return;
      setState({ status: 'ready', snapshot });
    }).catch(() => { if (active) setState((current) => current.snapshot ? current : { status: 'unavailable', snapshot: null }); });
    return () => { active = false; };
  }, [attempt, market, range]);
  useEffect(() => subscribeToForegroundResume(() => {
    if (stateRef.current.status === 'loading') return;
    const key = `${market}:${range}`;
    if (stateRef.current.status === 'unavailable' || !historyCache.getFresh(key, Date.now(), MARKET_CACHE_MAX_AGE_MS)) retry();
  }), [market, range, retry]);
  return { ...state, retry };
}

function useLiveCandles(market: MarketSymbol, range: LiveMarketRange, enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'unavailable'; snapshot: MarketCandleSnapshot | null }>({ status: 'loading', snapshot: null });
  const stateRef = useRef(state);
  stateRef.current = state;
  const baseSnapshotRef = useRef<MarketCandleSnapshot | null>(null);
  const live = useLiveMarketQuote(market);
  useEffect(() => {
    let active = true;
    const key = `${market}:${range}`;
    if (!enabled) return () => undefined;
    const cached = candleCache.getFresh(key, Date.now(), MARKET_CACHE_MAX_AGE_MS);
    if (cached) {
      baseSnapshotRef.current = cached;
      setState({ status: 'ready', snapshot: cached });
    } else { baseSnapshotRef.current = null; setState({ status: 'loading', snapshot: null }); }
    if (cached) return () => { active = false; };
    void candleCache.read(key, () => {
      const controller = new AbortController();
      return fetchMarketCandles(market, range, fetch, controller.signal);
    }).then((snapshot) => {
      if (!active) return;
      baseSnapshotRef.current = snapshot;
      setState({ status: 'ready', snapshot });
    }).catch(() => { if (active) setState((current) => current.snapshot ? current : { status: 'unavailable', snapshot: null }); });
    return () => { active = false; };
  }, [attempt, enabled, market, range]);
  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeToForegroundResume(() => {
      if (stateRef.current.status === 'loading') return;
      const key = `${market}:${range}`;
      if (stateRef.current.status === 'unavailable' || !candleCache.getFresh(key, Date.now(), MARKET_CACHE_MAX_AGE_MS)) setAttempt((value) => value + 1);
    });
  }, [enabled, market, range]);
  const baseSnapshot = baseSnapshotRef.current;
  let displayedSnapshot = baseSnapshot;
  if (baseSnapshot && live.isFresh && live.quote) {
    const next = liveQuoteCandle(baseSnapshot, live.quote);
    if (next) {
      const candles = baseSnapshot.candles.slice();
      if (candles.at(-1)?.time === next.time) candles[candles.length - 1] = next;
      else candles.push(next);
      const first = candles[0];
      if (first) displayedSnapshot = { ...baseSnapshot, candles, points: candles.map((candle) => ({ timestamp: candle.time * 1_000, price: candle.close })), currentPrice: next.close, high: Math.max(baseSnapshot.high, next.high), low: Math.min(baseSnapshot.low, next.low), percentChange: ((next.close - first.open) / first.open) * 100, updatedAt: live.quote.sourceAt };
    }
  }
  return { ...state, snapshot: enabled ? displayedSnapshot : null, retry: () => setAttempt((value) => value + 1) };
}

export function TradeMarketChart({ market, onMarketChange }: { market: MarketSymbol; onMarketChange?: (market: MarketSymbol) => void }) {
  const [range, setRange] = useState<LiveMarketRange>('1D');
  const [chartStyle, setChartStyle] = useChartStyle();
  // Unknown is intentionally distinct from desktop: on a mobile first paint,
  // matchMedia has not resolved yet and the collapsed chart must stay cold.
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const chartId = useId();
  const expanded = isMobile === false || (isMobile === true && mobileExpanded);
  const history = useLiveCandles(market, range, expanded);
  const { prices, status: priceStatus } = useUsdPrices();
  const live = useLiveMarketQuote(market);
  const fallbackPrice = prices[market === 'ETH' ? 'ETH' : 'WBTC'];
  const price = live.isFresh ? live.quote?.price : fallbackPrice ?? history.snapshot?.currentPrice;
  const change = live.isFresh ? live.quote?.percentChange24h : history.snapshot?.percentChange;
  // History loads only while the chart is open, so a closed chart never waits on it.
  const changeStatus = liveQuotePending(live.status) || (expanded && history.status === 'loading') ? 'loading' : 'unavailable';
  // The price can also come from the first price read; the range only from the feed or open history.
  const priceValueStatus = changeStatus === 'loading' || priceStatus === 'loading' ? 'loading' : 'unavailable';
  const high = live.isFresh ? live.quote?.high24h : history.snapshot?.high;
  const low = live.isFresh ? live.quote?.low24h : history.snapshot?.low;
  const positive = change !== undefined && change >= 0;
  // While a finger or pointer scrubs the chart, the header reads the hovered
  // bar instead of the live quote; releasing returns it to live.
  const [scrub, setScrub] = useState<ChartScrubReading | null>(null);
  useEffect(() => setScrub(null), [market, range, expanded]);
  const scrubRising = scrub?.changePercent !== null && scrub?.changePercent !== undefined && scrub.changePercent >= 0;
  useEffect(() => {
    // Treat compact tablets as mobile-first as well. The chart stays cold
    // until explicitly expanded below the desktop two-column breakpoint.
    const media = window.matchMedia('(max-width: 839px)');
    const update = () => {
      // Read the viewport directly: resize can fire before matchMedia has
      // delivered its change event, and the stale value would collapse a
      // chart that should remain expanded when returning from desktop.
      const next = window.innerWidth <= 839;
      setIsMobile(next);
    };
    update();
    media.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return <section className={`${styles.marketChart} market-chart-panel`} data-mobile-expanded={expanded} data-scrubbing={scrub ? true : undefined} aria-label={`${market} market chart`}>
    <header className="market-chart-header">
      <div className="flex min-w-0 items-center gap-3"><span className="market-chart-token"><TokenIcon symbol={market === 'BTC' ? 'WBTC' : 'ETH'} size={34} /></span><div className="min-w-0"><span className="micro-label text-[11px] text-mut">Market</span><h2 className="truncate text-[18px] font-semibold">{market} / USD</h2></div></div>
      <div className="shrink-0 text-right">{scrub ? <>
        {/* A scrub reading follows the finger, so it never rolls digits. */}
        <p className="text-display text-[24px] font-semibold tabular-nums" data-scrub-price>{formatUsdPrice(scrub.price)}</p>
        <p className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${scrub.changePercent === null ? 'text-mut' : scrubRising ? 'text-success' : 'text-danger'}`} data-scrub-time>
          {scrub.changePercent !== null && <><span aria-hidden="true">{scrubRising ? '↗' : '↘'}</span>{scrubRising ? '+' : ''}{scrub.changePercent.toFixed(2)}% · </>}
          <time dateTime={new Date(scrub.unixSeconds * 1_000).toISOString()} className="text-mut">{formatScrubTime(scrub.unixSeconds, range)}</time>
        </p>
      </> : <><p className="text-display text-[24px] font-semibold tabular-nums"><ValueOrSkeleton value={formatUsdPrice(price) === '—' ? '—' : <RollingFigure value={formatUsdPrice(price)} />} width="lg" status={priceValueStatus} label={priceValueStatus === 'loading' ? 'Market price loading' : 'Market price unavailable'} /></p><p className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${change === undefined ? 'text-mut' : positive ? 'text-success' : 'text-danger'}`}><ValueOrSkeleton value={change === undefined ? '—' : <><span aria-hidden="true">{positive ? '↗' : '↘'}</span>{positive ? '+' : ''}{change.toFixed(2)}% 24h</>} width="md" status={changeStatus} label={changeStatus === 'loading' ? '24 hour change loading' : '24 hour change unavailable'} /></p></>}</div>
    </header>
    <div className="market-chart-instrument-meta">
      <dl className="market-chart-stats"><div><dt>24h high</dt><dd><ValueOrSkeleton value={formatUsdPrice(high)} width="lg" status={changeStatus} label={changeStatus === 'loading' ? '24 hour high loading' : '24 hour high unavailable'} /></dd></div><div><dt>24h low</dt><dd><ValueOrSkeleton value={formatUsdPrice(low)} width="lg" status={changeStatus} label={changeStatus === 'loading' ? '24 hour low loading' : '24 hour low unavailable'} /></dd></div></dl>
    </div>
    {onMarketChange && <div className="market-chart-market-switch"><Segmented value={market} onChange={onMarketChange} ariaLabel="Market" options={[{ value: 'ETH', label: 'ETH', sub: 'Ethereum', ariaLabel: 'ETH', icon: <TokenIcon symbol="ETH" size={20} /> }, { value: 'BTC', label: 'BTC', sub: 'Wrapped BTC', ariaLabel: 'BTC', icon: <TokenIcon symbol="WBTC" size={20} /> }]} /></div>}
    <button type="button" className="market-chart-toggle" aria-expanded={expanded} aria-controls={chartId} aria-disabled={isMobile === null || undefined} disabled={isMobile === null} onClick={() => { setMobileExpanded((value) => !value); haptic('selection'); }}><BarChart3 className="h-4 w-4" aria-hidden="true" /><span>{expanded ? 'Hide chart' : 'Show chart'}</span><ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
    <div id={chartId} className="market-chart-content" hidden={!expanded}><div className="market-chart-frame">
      {history.status === 'loading' && <ChartSkeleton />}
      {history.status === 'unavailable' && <div className="market-chart-empty" role="status" aria-live="polite"><BarChart3 className="h-5 w-5 shrink-0 text-mut" aria-hidden="true" /><span><strong>Chart couldn’t load</strong><small>Price history for this range is unavailable right now.</small></span><button type="button" onClick={history.retry} className="glass-press flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold text-mint"><RefreshCw className="h-4 w-4" aria-hidden="true" />Retry</button></div>}
      {history.status === 'ready' && history.snapshot && <LazyPriceChart snapshot={history.snapshot} chartStyle={chartStyle} onScrub={setScrub} />}
    </div><footer className="market-chart-footer">
      <div role="radiogroup" aria-label="Chart range" className="chart-range-tabs" data-thumb="" style={{ '--seg-index': RANGE_OPTIONS.indexOf(range), '--seg-count': RANGE_OPTIONS.length } as CSSProperties}>{RANGE_OPTIONS.map((option) => <button key={option} type="button" role="radio" aria-checked={range === option} tabIndex={range === option ? 0 : -1} onClick={() => { setRange(option); haptic('selection'); }} onKeyDown={(event) => moveRadio(event, RANGE_OPTIONS, option, setRange)} className={range === option ? 'chart-range-active' : ''}>{option}</button>)}</div>
      <div role="radiogroup" aria-label="Chart style" className="chart-range-tabs chart-style-tabs" data-thumb="" style={{ '--seg-index': CHART_STYLES.indexOf(chartStyle), '--seg-count': CHART_STYLES.length } as CSSProperties}>{CHART_STYLES.map((option) => { const Icon = option === 'line' ? ChartLine : ChartCandlestick; return <button key={option} type="button" role="radio" aria-checked={chartStyle === option} aria-label={CHART_STYLE_LABELS[option]} title={CHART_STYLE_LABELS[option]} tabIndex={chartStyle === option ? 0 : -1} onClick={() => { setChartStyle(option); haptic('selection'); }} onKeyDown={(event) => moveRadio(event, CHART_STYLES, option, setChartStyle)} className={chartStyle === option ? 'chart-range-active' : ''}><Icon aria-hidden="true" /></button>; })}</div>
    </footer></div>
  </section>;
}

export function MarketMiniCard({ market }: { market: MarketSymbol }) {
  const history = useMarketHistory(market, '1D');
  const { prices, status: priceStatus } = useUsdPrices();
  const live = useLiveMarketQuote(market);
  const price = live.isFresh ? live.quote?.price : prices[market === 'ETH' ? 'ETH' : 'WBTC'] ?? history.snapshot?.currentPrice;
  const change = live.isFresh ? live.quote?.percentChange24h : history.snapshot?.percentChange;
  const positive = change !== undefined && change >= 0;
  const changeStatus = liveQuotePending(live.status) || history.status === 'loading' ? 'loading' : 'unavailable';
  const priceValueStatus = changeStatus === 'loading' || priceStatus === 'loading' ? 'loading' : 'unavailable';
  const id = useId();
  // The whole card opens its market in Trade: named for where it goes, described by its price and change.
  return <Link href={`/trade?market=${market}`} aria-label={`Trade ${market}`} aria-describedby={`${id}-price ${id}-change`} className={`${styles.marketMiniCard} portfolio-market-card`}><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><TokenIcon symbol={market === 'BTC' ? 'WBTC' : 'ETH'} size={28} /><strong className="text-[13px]">{market}</strong></span><span id={`${id}-change`} className={`text-[11px] font-semibold ${change === undefined ? 'text-mut' : positive ? 'text-success' : 'text-danger'}`}><ValueOrSkeleton value={change === undefined ? '—' : `${positive ? '+' : ''}${change.toFixed(2)}%`} width="md" status={changeStatus} label={changeStatus === 'loading' ? '24 hour change loading' : '24 hour change unavailable'} /></span></div><p id={`${id}-price`} className="mt-3 text-display text-[20px] font-semibold tabular-nums"><ValueOrSkeleton value={formatUsdPrice(price) === '—' ? '—' : <RollingFigure value={formatUsdPrice(price)} />} width="lg" status={priceValueStatus} label={priceValueStatus === 'loading' ? 'Market price loading' : 'Market price unavailable'} /></p><div className="market-chart-compact mt-2 h-[54px]">{history.status === 'ready' && history.snapshot ? <Sparkline snapshot={history.snapshot} rising={change === undefined ? undefined : positive} /> : history.status === 'loading' ? <div role="status" aria-label="Loading market history" className="market-chart-skeleton h-full" />
    // The whole card is a link into Trade, where the full chart retries; the card itself retries when the app returns to the foreground.
    : <div role="status" className="market-chart-empty-mini"><CircleAlert aria-hidden="true" />Chart unavailable</div>}</div></Link>;
}

type Candles = MarketCandleSnapshot['candles'];
type ChartModule = typeof import('lightweight-charts');
type ChartTheme = { accent: string; axis: string; crosshair: string; label: string; surface: string; up: string; down: string; font: string };
type SeriesEntry = { style: 'line'; series: ISeriesApi<'Area'> } | { style: 'candles'; series: ISeriesApi<'Candlestick'> };

/** The canvas cannot read CSS variables, so the chart samples the live tokens. */
function readChartTheme(): ChartTheme {
  const tokens = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => tokens.getPropertyValue(name).trim() || fallback;
  return {
    accent: token('--mint', '#2973ff'),
    axis: token('--mut-2', '#8d869d'),
    crosshair: token('--line-strong', '#3f3a52'),
    label: token('--surface-3', '#282535'),
    surface: token('--surface', '#16151e'),
    up: token('--success', '#53d5a0'),
    down: token('--danger', '#ff5c70'),
    font: getComputedStyle(document.body).fontFamily || 'Inter, system-ui, sans-serif',
  };
}

/** `#rgb`/`#rrggbb` with an alpha channel; other color syntaxes pass through. */
function withAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (!hex) return alpha === 0 ? 'transparent' : color;
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const priceCents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const priceWhole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
/** Exact readings (crosshair and last price) always keep cents, grouped. */
function formatPrice(price: number) { return priceCents.format(price); }
/** Axis ticks drop cents once prices reach five figures, where they only add noise. */
function formatTickmarks(prices: number[]) { return prices.map((price) => (Math.abs(price) >= 10_000 ? priceWhole : priceCents).format(price)); }

function chartOptions(theme: ChartTheme, module: ChartModule): DeepPartial<TimeChartOptions> {
  return {
    layout: { background: { color: 'transparent' }, textColor: theme.axis, fontFamily: theme.font, fontSize: 11 },
    localization: { priceFormatter: formatPrice, tickmarksPriceFormatter: formatTickmarks },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    // The bottom margin keeps the line clear of the attribution mark; the fill fades beneath it.
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.14, bottom: 0.24 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 2, fixLeftEdge: true },
    crosshair: {
      mode: module.CrosshairMode.Magnet,
      vertLine: { color: theme.crosshair, width: 1, style: module.LineStyle.Solid, labelBackgroundColor: theme.label },
      horzLine: { visible: false, labelBackgroundColor: theme.label },
    },
    // A display chart: vertical swipes and the mouse wheel keep scrolling the page.
    handleScroll: { mouseWheel: false, vertTouchDrag: false },
    handleScale: { mouseWheel: false },
    // A long press scrubs; lifting the finger ends it, so the header returns to live.
    trackingMode: { exitMode: module.TrackingModeExitMode.OnTouchEnd },
  };
}

function lineOptions(theme: ChartTheme) {
  return {
    lineColor: theme.accent,
    lineWidth: 2 as const,
    topColor: withAlpha(theme.accent, 0.3),
    bottomColor: withAlpha(theme.accent, 0),
    priceLineVisible: false,
    crosshairMarkerRadius: 4,
    crosshairMarkerBorderWidth: 2,
    crosshairMarkerBorderColor: theme.surface,
    crosshairMarkerBackgroundColor: theme.accent,
  };
}

function candleOptions(theme: ChartTheme) {
  return { upColor: theme.up, downColor: theme.down, borderVisible: false, wickUpColor: theme.up, wickDownColor: theme.down };
}

function addPriceSeries(chart: IChartApi, module: ChartModule, style: ChartStyle, theme: ChartTheme): SeriesEntry {
  return style === 'line'
    ? { style, series: chart.addSeries(module.AreaSeries, lineOptions(theme)) }
    : { style, series: chart.addSeries(module.CandlestickSeries, candleOptions(theme)) };
}

/**
 * Writes the whole history, or only the newest bar when just the tail moved.
 * `shift` moves every time into the viewer's zone; a tail write reuses the shift of the full write before it.
 */
function writeSeries(entry: SeriesEntry, candles: Candles, shift: number, tailOnly = false) {
  const source = tailOnly ? candles.slice(-1) : candles;
  if (entry.style === 'line') {
    const points = source.map((candle) => ({ time: (candle.time + shift) as UTCTimestamp, value: candle.close }));
    if (tailOnly) entry.series.update(points[0]);
    else entry.series.setData(points);
    return;
  }
  const bars = source.map((candle) => ({ time: (candle.time + shift) as UTCTimestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close }));
  if (tailOnly) entry.series.update(bars[0]);
  else entry.series.setData(bars);
}

function LazyPriceChart({ snapshot, chartStyle, onScrub }: { snapshot: MarketCandleSnapshot; chartStyle: ChartStyle; onScrub?: (reading: ChartScrubReading | null) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const candlesRef = useRef(snapshot.candles);
  candlesRef.current = snapshot.candles;
  const styleRef = useRef(chartStyle);
  styleRef.current = chartStyle;
  const renderedCandlesRef = useRef<Candles>([]);
  const chartRef = useRef<{ chart: IChartApi; module: ChartModule; entry: SeriesEntry; shift: number } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void import('lightweight-charts').then((module) => {
      if (!active || !hostRef.current) return;
      const theme = readChartTheme();
      const chart = module.createChart(hostRef.current, { autoSize: true, ...chartOptions(theme, module) });
      const state = { chart, module, entry: addPriceSeries(chart, module, styleRef.current, theme), shift: localTimeShiftSeconds(candlesRef.current.at(-1)?.time) };
      chartRef.current = state;
      writeSeries(state.entry, candlesRef.current, state.shift);
      renderedCandlesRef.current = candlesRef.current;
      chart.timeScale().fitContent();
      // The crosshair's bar becomes the header's reading; leaving the chart clears it.
      chart.subscribeCrosshairMove((param) => {
        const report = onScrubRef.current;
        if (!report) return;
        const bar = (param.point && param.time !== undefined ? param.seriesData.get(state.entry.series) : undefined) as { value?: unknown; close?: unknown } | undefined;
        const raw = bar?.value ?? bar?.close;
        const price = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
        if (price === undefined || typeof param.time !== 'number') { report(null); return; }
        report({ price, changePercent: scrubChangePercent(candlesRef.current[0]?.open, price), unixSeconds: param.time - state.shift });
      });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; chartRef.current?.chart.remove(); chartRef.current = null; onScrubRef.current?.(null); };
  }, []);
  useEffect(() => {
    const state = chartRef.current;
    if (!state || state.entry.style === chartStyle) return;
    // Swap the series in place so the chart never blanks between styles.
    state.chart.removeSeries(state.entry.series);
    state.entry = addPriceSeries(state.chart, state.module, chartStyle, readChartTheme());
    state.shift = localTimeShiftSeconds(candlesRef.current.at(-1)?.time);
    writeSeries(state.entry, candlesRef.current, state.shift);
    renderedCandlesRef.current = candlesRef.current;
  }, [chartStyle]);
  useEffect(() => {
    const state = chartRef.current;
    if (!state) return;
    const previous = renderedCandlesRef.current;
    const next = snapshot.candles;
    const tailOnly = previous.length > 0 && next.length >= previous.length && next.length <= previous.length + 1
      && previous.slice(0, -1).every((candle, index) => candle === next[index]);
    if (!tailOnly) state.shift = localTimeShiftSeconds(next.at(-1)?.time);
    writeSeries(state.entry, next, state.shift, tailOnly && next.length > 0);
    // A new range or market replaces the history; frame all of it again.
    if (!tailOnly) state.chart.timeScale().fitContent();
    renderedCandlesRef.current = next;
  }, [snapshot.candles]);
  if (failed) return <div className="market-chart-empty" role="img" aria-label={`${snapshot.market} ${snapshot.range} USD price chart`}><BarChart3 className="h-6 w-6 text-mut" aria-hidden="true" /><span><strong>{snapshot.market} price chart</strong><small>Current {formatUsdPrice(snapshot.currentPrice)} · high {formatUsdPrice(snapshot.high)} · low {formatUsdPrice(snapshot.low)}</small></span></div>;
  return <div ref={hostRef} className="market-chart-graphic" data-chart-style={chartStyle} role="img" aria-label={`${snapshot.market} ${snapshot.range} USD price chart, current price ${formatUsdPrice(snapshot.currentPrice)}`}><span className="sr-only">High {formatUsdPrice(snapshot.high)}. Low {formatUsdPrice(snapshot.low)}.</span></div>;
}

/** `rising` is the change printed beside the line, so color and label never disagree. */
function Sparkline({ snapshot, rising }: { snapshot: MarketHistorySnapshot; rising?: boolean }) {
  const fillId = useId();
  const values = snapshot.points.map((point) => point.price);
  const min = Math.min(...values); const max = Math.max(...values); const span = Math.max(max - min, max * 0.002, 1e-8);
  const coordinates = values.map((value, index) => `${((index / Math.max(1, values.length - 1)) * 100).toFixed(2)},${(8 + ((max - value) / span) * 84).toFixed(2)}`).join(' ');
  const color = (rising ?? snapshot.percentChange >= 0) ? 'var(--success)' : 'var(--danger)';
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={`${snapshot.market} 24 hour trend`}><defs><linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.2" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs><polygon className="sparkline-fill" points={`0,100 ${coordinates} 100,100`} fill={`url(#${fillId})`} /><polyline className="sparkline-line" pathLength={1} points={coordinates} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /><title>{snapshot.market} trend</title></svg>;
}

/** Fills the chart frame at every breakpoint, so the loaded chart takes its exact place. */
function ChartSkeleton() { return <div role="status" aria-label="Loading market chart" className="market-chart-skeleton" />; }
