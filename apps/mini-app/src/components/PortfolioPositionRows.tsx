'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { formatAmount, positionDisplayLeverage, positionIsStale, positionKey, positionTokenDecimals, type PositionGroupFailure, type UiPosition } from '@/app/trade/fxUi';
import { useLiveMarketQuote, useUsdPrices } from '@/components/PriceProvider';
import { usePositionBrake } from '@/components/PositionBrakeContext';
import { MissingValue } from '@/components/MissingValue';
import TokenIcon from '@/components/TokenIcon';
import { PortfolioPositionSkeleton } from '@/components/PortfolioPositionSkeleton';
import { groupDigits } from '@/lib/amount';
import { freshDisplayPrices } from '@/lib/displayPrices';
import { useInitialReadPending } from '@/lib/useInitialReadPending';
import { formatWholeUsd, positionBrakeCopy, positionBrakeView } from '@/lib/positionBrake';
import { positionName } from '@/lib/positionNaming';
import { positionCollateralSymbol } from '@/lib/positionUnits';
import { calculatePositionUsdValuation, formatUsdCents } from '@/lib/positionValuation';
import { priceKeyForSymbol } from '@/lib/prices';
import styles from './PortfolioPositionRows.module.css';

/** Every verified position stays reachable; expanding one reveals its accounting and risk estimates. */
export function PortfolioPositionRows({ positions, failedGroups }: { positions: readonly UiPosition[]; failedGroups: readonly PositionGroupFailure[] }) {
  return <div className={styles.list} role="list" aria-label="Open positions">
    {positions.map((position) => <div role="listitem" key={positionKey(position)}>
      <PortfolioPositionRow position={position} stale={positionIsStale(position, failedGroups)} />
    </div>)}
  </div>;
}

function PortfolioPositionRow({ position, stale }: { position: UiPosition; stale: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const valueId = useId();
  const riskId = useId();
  const snapshot = useUsdPrices();
  const prices = freshDisplayPrices(snapshot);
  const { quote, isFresh } = useLiveMarketQuote(position.market);
  const brake = usePositionBrake(position);
  const collateralKey = priceKeyForSymbol(position.info.rawCollsToken);
  const debtKey = priceKeyForSymbol(position.info.rawDebtsToken);
  // A retained position is useful as an identity, never as a fresh dollar value or risk estimate.
  const valuation = calculatePositionUsdValuation({
    collateralRaw: position.info.rawColls,
    collateralDecimals: positionTokenDecimals(position, 'collateral'),
    collateralPrice: !stale && collateralKey ? prices[collateralKey] : undefined,
    debtRaw: position.info.rawDebts,
    debtDecimals: positionTokenDecimals(position, 'debt'),
    debtPrice: !stale && debtKey ? prices[debtKey] : undefined,
  });
  const pricesPending = snapshot.status === 'loading' || snapshot.refreshing;
  const missingStatus = !stale && pricesPending ? 'loading' : 'unavailable';
  const pending = useInitialReadPending(positionKey(position), !stale && (brake.status === 'loading' || pricesPending && valuation.netEquityUsdCents === null));
  if (pending) return <PortfolioPositionSkeleton />;
  const usd = (value: bigint | null, label: string) => value === null || stale
    ? <MissingValue width="md" status={missingStatus} label={`${label} ${missingStatus === 'loading' ? 'loading' : 'unavailable'}`} />
    : `≈ ${formatUsdCents(value)}`;
  const leverage = positionDisplayLeverage(position);
  const view = !stale && brake.status === 'ready' ? positionBrakeView(brake.reading, isFresh && quote ? quote.price : null) : null;
  const risk = view ? positionBrakeCopy(view, position.market, position.side) : null;
  const showRiskSummary = stale || risk?.tone === 'warn';
  const threshold = (kind: 'rebalance' | 'liquidation') => {
    if (stale) return <MissingValue width="md" status="unavailable" label={`Estimated ${kind} price unavailable`} />;
    if (position.info.rawDebts === 0n) return 'No debt';
    if (view && (kind === 'rebalance' ? view.state !== 'clear' : view.state === 'liquidation')) return 'Reached';
    const price = kind === 'rebalance' ? view?.rebalancePrice : view?.liquidatePrice;
    return price !== null && price !== undefined ? `≈ ${formatWholeUsd(price)}`
      : <MissingValue width="md" status={brake.status === 'loading' ? 'loading' : 'unavailable'} label={`Estimated ${kind} price unavailable`} />;
  };
  const key = encodeURIComponent(positionKey(position));
  return <details className={styles.position} onToggle={(event) => setExpanded(event.currentTarget.open)} data-position-key={positionKey(position)}>
    <summary aria-label={`${positionName(position.market, position.side)} position #${position.info.positionId.toString()} details`} aria-describedby={`${valueId}${showRiskSummary ? ` ${riskId}` : ''}`}>
      <TokenIcon symbol={position.market === 'ETH' ? 'ETH' : 'WBTC'} size={42} />
      <span className={styles.identity}><strong>{positionName(position.market, position.side)}</strong><small>
        {leverage.value !== null ? `${leverage.value.toFixed(2).replace(/\.00$/, '')}×` : '—'}
      </small></span>
      <span id={valueId} className={styles.value} title="Position value: collateral value minus debt"><span className="sr-only">Position value </span><strong>{usd(valuation.netEquityUsdCents, 'Position value')}</strong></span>
      <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
      {showRiskSummary && <span id={riskId} className={styles.riskSummary} data-tone={stale ? 'stale' : risk?.tone ?? 'neutral'}>{(stale || risk?.tone === 'warn') && <AlertTriangle size={13} aria-hidden="true" />}{stale ? 'Refresh needed' : risk?.line}</span>}
    </summary>
    {expanded && <div className={styles.details}>
      <dl className={styles.facts}>
        <div><dt>Collateral</dt><dd>{groupDigits(formatAmount(position.info.rawColls, positionTokenDecimals(position, 'collateral')))} {positionCollateralSymbol(position)}<small>{usd(valuation.collateralUsdCents, 'Collateral value')}</small></dd></div>
        <div><dt>Debt</dt><dd>{groupDigits(formatAmount(position.info.rawDebts, positionTokenDecimals(position, 'debt')))} {position.info.rawDebtsToken}<small>{usd(valuation.debtUsdCents, 'Debt value')}</small></dd></div>
        <div><dt>Est. rebalance</dt><dd data-position-price="rebalance">{threshold('rebalance')}</dd></div>
        <div><dt>Est. liquidation</dt><dd data-position-price="liquidation">{threshold('liquidation')}</dd></div>
      </dl>
      <Link href={`/positions?position=${key}`} className={styles.manage}>Manage position <ChevronRight size={15} aria-hidden="true" /></Link>
    </div>}
  </details>;
}
