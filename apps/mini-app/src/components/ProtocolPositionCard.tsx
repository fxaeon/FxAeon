'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, ChevronRight, RefreshCw } from 'lucide-react';
import React from 'react';
import {
  formatAmount,
  positionDisplayLeverage,
  positionKey,
  positionTokenDecimals,
  type PositionGroupFailure,
  type UiPosition,
} from '@/app/trade/fxUi';
import { useLiveMarketQuote, useUsdPrices } from '@/components/PriceProvider';
import { usePositionBrake } from '@/components/PositionBrakeContext';
import { MissingValue } from '@/components/MissingValue';
import TokenIcon from '@/components/TokenIcon';
import { formatUsdPrice, priceKeyForSymbol } from '@/lib/prices';
import { freshDisplayPrices } from '@/lib/displayPrices';
import { formatWholeUsd, positionBrakeCopy, positionBrakeView } from '@/lib/positionBrake';
import { calculatePositionUsdValuation, debtCollateralRatioPercent, formatUsdCents } from '@/lib/positionValuation';
import { groupDigits } from '@/lib/amount';
import { positionName, positionSideLabel } from '@/lib/positionNaming';
import { positionCollateralSymbol } from '@/lib/positionUnits';
import { openExternalLink } from '@/lib/telegram';
import styles from './ProtocolPositionCard.module.css';

function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton ${className}`} />;
}

/** Leaves FxAeon through Telegram's own browser in the Mini App, a new tab elsewhere. */
function openDocs(href: string) {
  return (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (openExternalLink(href)) event.preventDefault();
  };
}

function positionValuation(position: UiPosition, prices: ReturnType<typeof useUsdPrices>['prices']) {
  const collateralKey = priceKeyForSymbol(position.info.rawCollsToken);
  const debtKey = priceKeyForSymbol(position.info.rawDebtsToken);
  return calculatePositionUsdValuation({
    collateralRaw: position.info.rawColls,
    collateralDecimals: positionTokenDecimals(position, 'collateral'),
    collateralPrice: collateralKey ? prices[collateralKey] : undefined,
    debtRaw: position.info.rawDebts,
    debtDecimals: positionTokenDecimals(position, 'debt'),
    debtPrice: debtKey ? prices[debtKey] : undefined,
  });
}

/**
 * One position: identity and value, the f(x) split with its brake, and (in
 * full) the four figures behind them. Rows sit inside links and buttons, so
 * their parts are phrasing elements styled as blocks.
 */
function PositionBody({
  position,
  interactive,
  details = false,
  compact = false,
  headingId,
}: {
  position: UiPosition;
  interactive: boolean;
  details?: boolean;
  compact?: boolean;
  headingId?: string;
}) {
  const priceSnapshot = useUsdPrices();
  const prices = freshDisplayPrices(priceSnapshot);
  const { quote: liveQuote, isFresh: hasFreshLiveQuote } = useLiveMarketQuote(position.market);
  // Validate each display quote independently, including retained quotes.
  const valuation = positionValuation(position, prices);
  const missingStatus = priceSnapshot.status === 'loading' ? 'loading' as const : 'unavailable' as const;
  const netEquity = valuation.netEquityUsdCents === null
    ? <MissingValue width="lg" status={missingStatus} />
    : `≈ ${formatUsdCents(valuation.netEquityUsdCents)}`;
  const leverageInfo = positionDisplayLeverage(position);
  const leverage = leverageInfo.value !== null
    ? `${leverageInfo.value.toFixed(2).replace(/\.00$/, '')}×`
    : <MissingValue width="sm" status="loading" />;
  const positionValueTitle = valuation.netEquityUsdCents === null
    ? missingStatus === 'loading' ? 'Loading position value' : 'Position value unavailable until prices refresh'
    : 'Collateral value minus debt';
  const sideLabel = positionSideLabel(position.side);
  // The f(x) split on this position: its collateral value is debt plus the
  // holder's share. Drawn only from the same validated values as the figures.
  const debtShare = valuation.collateralUsdCents !== null && valuation.debtUsdCents !== null
    && valuation.collateralUsdCents > 0n && valuation.debtUsdCents >= 0n && valuation.debtUsdCents <= valuation.collateralUsdCents
    ? Number((valuation.debtUsdCents * 10_000n) / valuation.collateralUsdCents) / 10_000
    : null;
  // The liquidation brake: this position's on-chain debt ratio against its
  // pool's live thresholds, moved with the live quote between chain reads.
  // Without a current read the bar keeps the split above and draws no marker.
  const brake = usePositionBrake(position);
  const brakeView = brake.status === 'ready'
    ? positionBrakeView(brake.reading, hasFreshLiveQuote && liveQuote ? liveQuote.price : null)
    : null;
  const brakeCopy = brakeView ? positionBrakeCopy(brakeView, position.market, position.side) : null;
  const splitFill = brakeView?.fill ?? debtShare;
  const Block = details ? 'div' : 'span';
  const thresholdValue = (kind: 'rebalance' | 'liquidation') => {
    if (position.info.rawDebts === 0n) return 'No debt';
    const reached = brakeView && (kind === 'rebalance' ? brakeView.state !== 'clear' : brakeView.state === 'liquidation');
    if (reached) return <span data-threshold-reached>Reached</span>;
    const price = kind === 'rebalance' ? brakeView?.rebalancePrice : brakeView?.liquidatePrice;
    if (price !== undefined && price !== null) return `≈\u00a0${formatWholeUsd(price)}`;
    return <span title={`Estimated ${kind} price unavailable`}><span aria-hidden="true">—</span><span className="sr-only">Estimated {kind} price unavailable</span></span>;
  };

  return (
    <Block className={styles.content}>
      {headingId && <h2 id={headingId} className="sr-only">{positionName(position.market, position.side)} · #{position.info.positionId}</h2>}
      <span className={styles.identity}>
        <span className={styles.tokenIcon}><TokenIcon symbol={position.market === 'ETH' ? 'ETH' : 'WBTC'} size={32} /></span>
        {/* Two lines that each share out their own width: market and value, then leverage, ID and the value's label. */}
        <span className={styles.identityText}>
          <span className={styles.identityLine}>
            <span className={styles.marketLine}>
              <span className={styles.market}>{position.market}</span>
              {' '}
              <span className={`${styles.side} ${position.side === 'long' ? styles.long : styles.short}`}>{sideLabel}</span>
            </span>
            <span className={styles.positionValueNumber} title={positionValueTitle}>{netEquity}</span>
            {interactive && <ChevronRight className={styles.navigateIcon} aria-hidden="true" />}
          </span>
          <span className={styles.identityLine}>
            <span className={styles.positionMeta}><strong>{leverage}</strong> {leverageInfo.label}<span aria-hidden="true">·</span>#{position.info.positionId}</span>
            <span className={styles.valueBasis}>Position value</span>
            {interactive && <span className={styles.navigateSpace} aria-hidden="true" />}
          </span>
        </span>
      </span>
      {splitFill !== null && <span
        className={styles.split}
        aria-hidden="true"
        data-position-split
        data-brake={brakeView?.state}
        title={brakeView ? 'Debt share of collateral, with the rebalance point marked (liquidation fainter)' : undefined}
        style={{ '--debt-share': splitFill, '--rebalance-at': brakeView?.rebalanceAt ?? undefined, '--liquidate-at': brakeView?.liquidateAt ?? undefined } as React.CSSProperties}
      >
        <span className={styles.splitTrack}><i className={styles.splitDebt} /><i className={styles.splitShare} /></span>
        {brakeView?.liquidateAt != null && <i className={styles.liquidationMarker} data-brake-marker="liquidation" />}
        {brakeView?.rebalanceAt != null && <i className={styles.rebalanceMarker} data-brake-marker="rebalance" />}
      </span>}
      {brake.status === 'loading' && <span className={styles.brake} role="status" aria-label="Loading rebalance point">
        <Skeleton className={styles.brakeSkeleton} />
      </span>}
      {brakeView && brakeCopy && <span
        className={styles.brake}
        data-tone={brakeCopy.tone}
        data-position-brake={brakeView.state}
        title={brakeCopy.tone === 'warn' && interactive ? `${brakeCopy.docsLabel}: ${brakeCopy.docsUrl}` : undefined}
      >
        {brakeCopy.tone === 'warn' && <AlertTriangle aria-hidden="true" />}
        <span>
          {brakeCopy.line}
          {brakeCopy.liquidation && <span className="sr-only"> {brakeCopy.liquidation}</span>}
          {/* A link cannot sit inside a row that is itself a link or button. */}
          {brakeCopy.tone === 'warn' && !interactive && <>
            {' '}<a href={brakeCopy.docsUrl} target="_blank" rel="noopener noreferrer" onClick={openDocs(brakeCopy.docsUrl)}>{brakeCopy.docsLabel}<ArrowUpRight aria-hidden="true" /></a>
          </>}
        </span>
      </span>}
      <span className={styles.cardMetrics}>
        <span><span className={styles.cardMetricLabel}>Est. rebalance</span><span className={styles.cardMetricValue} data-position-price="rebalance">{thresholdValue('rebalance')}</span></span>
        <span><span className={styles.cardMetricLabel}>Est. liquidation</span><span className={styles.cardMetricValue} data-position-price="liquidation">{thresholdValue('liquidation')}</span></span>
      </span>
      {details && <>
        <PositionFacts position={position} prices={prices} valuation={valuation} missingStatus={missingStatus} liveQuote={hasFreshLiveQuote ? liveQuote?.price : undefined} section={compact ? 'primary' : 'all'} />
        {compact && <details className={styles.metricDisclosure}><summary>Position details<ChevronRight aria-hidden="true" /></summary><PositionFacts position={position} prices={prices} valuation={valuation} missingStatus={missingStatus} liveQuote={hasFreshLiveQuote ? liveQuote?.price : undefined} section="secondary" /></details>}
      </>}
    </Block>
  );
}

/** Collateral, debt, market price and debt / collateral as a plain two-column list. */
function PositionFacts({ position, prices, valuation, missingStatus, liveQuote, section = 'all' }: {
  position: UiPosition;
  prices: ReturnType<typeof freshDisplayPrices>;
  valuation: ReturnType<typeof positionValuation>;
  missingStatus: 'loading' | 'unavailable';
  liveQuote: number | undefined;
  section?: 'primary' | 'secondary' | 'all';
}) {
  const collateralKey = priceKeyForSymbol(position.info.rawCollsToken);
  const debtKey = priceKeyForSymbol(position.info.rawDebtsToken);
  const usd = (cents: bigint | null) => cents === null ? <MissingValue width="md" status={missingStatus} /> : `≈ ${formatUsdCents(cents)}`;
  const marketPrice = liveQuote ?? prices[position.market === 'ETH' ? 'ETH' : 'WBTC'];
  const ratio = debtCollateralRatioPercent({
    collateralRaw: position.info.rawColls,
    collateralDecimals: positionTokenDecimals(position, 'collateral'),
    collateralPrice: !collateralKey ? undefined : prices[collateralKey],
    debtRaw: position.info.rawDebts,
    debtDecimals: positionTokenDecimals(position, 'debt'),
    debtPrice: !debtKey ? undefined : prices[debtKey],
  });
  return (
    <dl className={styles.facts}>
      {section !== 'secondary' && <><div className={styles.fact}>
        <dt>Collateral</dt>
        <dd>{groupDigits(formatAmount(position.info.rawColls, positionTokenDecimals(position, 'collateral')))} <span className={styles.factUnit}>{positionCollateralSymbol(position)}</span><small>{usd(valuation.collateralUsdCents)}</small></dd>
      </div>
      <div className={styles.fact}>
        <dt>Debt</dt>
        <dd>{groupDigits(formatAmount(position.info.rawDebts, positionTokenDecimals(position, 'debt')))} <span className={styles.factUnit}>{position.info.rawDebtsToken}</span><small>{usd(valuation.debtUsdCents)}</small></dd>
      </div>
      </>}
      {section === 'secondary' && <>
        <div className={styles.fact}><dt>Collateral value</dt><dd>{usd(valuation.collateralUsdCents)}</dd></div>
        <div className={styles.fact}><dt>Debt value</dt><dd>{usd(valuation.debtUsdCents)}</dd></div>
      </>}
      {section !== 'primary' && <><div className={styles.fact}>
        <dt>Market price</dt>
        <dd>{marketPrice === undefined || !Number.isFinite(marketPrice) ? <MissingValue width="lg" status={missingStatus} /> : formatUsdPrice(marketPrice)}</dd>
      </div>
      <div className={styles.fact} title="Debt value divided by collateral value">
        <dt>Debt / collateral</dt>
        <dd>{ratio ?? <MissingValue width="md" status={missingStatus} />}</dd>
      </div>
      </>}
    </dl>
  );
}

/**
 * A position as a compact row: a link or button when it opens the position,
 * an article otherwise. Rows have no box; a list rules them apart.
 */
export function ProtocolPositionCard({
  position,
  highlighted = false,
  selected = false,
  href,
  onSelect,
  onNavigate,
  className = '',
}: {
  position: UiPosition;
  highlighted?: boolean;
  selected?: boolean;
  href?: string;
  onSelect?: () => void;
  onNavigate?: () => void;
  className?: string;
}) {
  const interactive = Boolean(href || onSelect);
  const classes = [styles.row, interactive && styles.interactive, selected && styles.selected, highlighted && styles.highlighted, className].filter(Boolean).join(' ');
  const body = <PositionBody position={position} interactive={interactive} />;

  if (href) {
    return <Link href={href} onClick={onNavigate} className={classes} data-position-key={positionKey(position)}>{body}</Link>;
  }
  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} className={classes} aria-current={selected ? 'true' : undefined} data-position-key={positionKey(position)}>
        {body}
      </button>
    );
  }
  return <article className={classes} data-position-key={positionKey(position)}>{body}</article>;
}

/** One position in full, as its manager shows it: the row, then its four figures. */
export function ProtocolPositionDetails({ position, headingId, className = '', compact = false }: { position: UiPosition; headingId?: string; className?: string; compact?: boolean }) {
  return (
    <section className={`${styles.details}${compact ? ` ${styles.compactDetails}` : ''} ${className}`} data-position-details={positionKey(position)} aria-labelledby={headingId}>
      <PositionBody position={position} interactive={false} details compact={compact} headingId={headingId} />
    </section>
  );
}

/** Position cards remain one selection target each. */
export function ProtocolPositionList({ label, children, className = '' }: { label?: string; children?: React.ReactNode; className?: string }) {
  return (
    <div role="list" aria-label={label} className={`${styles.list} ${className}`}>
      {React.Children.map(children, (child) => child ? <div role="listitem" className={styles.listItem}>{child}</div> : null)}
    </div>
  );
}

export { positionIsStale } from '@/app/trade/fxUi';

export function ProtocolPositionNotice({
  status,
  failedGroups,
  hasPositions,
  refreshing,
  onRefresh,
  compact = false,
}: {
  status: 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';
  failedGroups: readonly PositionGroupFailure[];
  hasPositions: boolean;
  refreshing: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}) {
  if (status === 'idle' || status === 'loading' || status === 'ready') return null;
  const groups = failedGroups.map((group) => `${group.market} ${group.side}`).join(', ');
  // Each notice names what failed, what is still shown, and offers the retry beside it.
  const label = status === 'partial' && hasPositions
    ? `Couldn’t check ${groups || 'some positions'}. Showing the rest.`
    : hasPositions
      ? `Couldn’t refresh ${groups || 'positions'}. Showing the last verified details.`
      : 'Couldn’t load positions. Your funds are unaffected.';

  return (
    <div role="status" aria-label={refreshing ? 'Checking positions' : label} className={styles.notice} data-compact={compact || undefined}>
      <AlertTriangle aria-hidden="true" />
      {/* Sighted users see the same state the label announces. */}
      <span>{refreshing ? 'Checking positions…' : label}</span>
      {onRefresh && (
        <button type="button" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>
          <RefreshCw className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />Retry
        </button>
      )}
    </div>
  );
}

export { ProtocolPositionSkeleton } from './ProtocolPositionSkeleton';
