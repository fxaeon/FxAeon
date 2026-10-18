'use client';

import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, CircleAlert, Layers3, RefreshCw, Wallet, X } from 'lucide-react';
import TokenIcon from '@/components/TokenIcon';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { useUsdPrices } from '@/components/PriceProvider';
import { MobileFlowSheetContext } from '@/components/MobileFlowSheet';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import { useInitialReadPending } from '@/lib/useInitialReadPending';
import { freshDisplayPrices } from '@/lib/displayPrices';
import { priceKeyForSymbol } from '@/lib/prices';
import { calculatePositionUsdValuation, formatUsdCents } from '@/lib/positionValuation';
import { positionCollateralSymbol } from '@/lib/positionUnits';
import { groupDigits } from '@/lib/amount';
import { formatAmount, positionCollateralDecimals, positionDebtDecimals, type UiPosition } from '@/app/trade/fxUi';
import styles from './BorrowPositionCards.module.css';

function usePositionFigures(position: UiPosition, stale = false) {
  const snapshot = useUsdPrices();
  const prices = freshDisplayPrices(snapshot);
  const collateralKey = priceKeyForSymbol(position.info.rawCollsToken);
  const debtKey = priceKeyForSymbol(position.info.rawDebtsToken);
  const valuation = stale ? { collateralUsdCents: null, debtUsdCents: null, netEquityUsdCents: null } : calculatePositionUsdValuation({
    collateralRaw: position.info.rawColls, collateralDecimals: positionCollateralDecimals(position),
    collateralPrice: collateralKey ? prices[collateralKey] : undefined,
    debtRaw: position.info.rawDebts, debtDecimals: positionDebtDecimals(position),
    debtPrice: debtKey ? prices[debtKey] : undefined,
  });
  const ltv = valuation.collateralUsdCents !== null && valuation.collateralUsdCents > 0n && valuation.debtUsdCents !== null
    ? `${(Number((valuation.debtUsdCents * 1000n + valuation.collateralUsdCents - 1n) / valuation.collateralUsdCents) / 10).toFixed(1)}%` : null;
  return {
    ...valuation, ltv,
    pending: !stale && (snapshot.status === 'loading' || snapshot.refreshing) && (valuation.collateralUsdCents === null || valuation.debtUsdCents === null),
    status: !stale && (snapshot.status === 'loading' || snapshot.refreshing) ? 'loading' as const : 'unavailable' as const,
    collateral: `${groupDigits(formatAmount(position.info.rawColls, positionCollateralDecimals(position)))} ${positionCollateralSymbol(position)}`,
    debt: displayDebt(position),
  };
}

/** Round the summary up to cents; the review retains the exact token amount. */
function displayDebt(position: UiPosition): string {
  const decimals = positionDebtDecimals(position);
  if (decimals < 2) return groupDigits(formatAmount(position.info.rawDebts, decimals));
  const scale = 10n ** BigInt(decimals - 2);
  const cents = (position.info.rawDebts + scale - 1n) / scale;
  return `${groupDigits((cents / 100n).toString())}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export function BorrowPositionCard({ position, stale, onOpen }: { position: UiPosition; stale: boolean; onOpen: (trigger: HTMLButtonElement) => void }) {
  const figures = usePositionFigures(position, stale);
  const figuresId = useId();
  const pending = useInitialReadPending(`${position.market}:${position.info.positionId}`, figures.pending);
  if (pending) return <div className={styles.card} role="status" aria-label="Loading borrowing position" aria-busy="true">
    <span className={styles.loadingIdentity} aria-hidden="true"><i className="skeleton" /><span><i className="skeleton" /><i className="skeleton" /></span></span>
    <span className={styles.loadingDebt} aria-hidden="true"><i className="skeleton" /><i className="skeleton" /><i className="skeleton" /></span>
    <span className={styles.loadingFacts} aria-hidden="true">{[0, 1].map(index => <span key={index}><i className="skeleton" /><i className="skeleton" /><i className="skeleton" /></span>)}</span>
  </div>;
  return <button type="button" className={styles.card} aria-label={`Manage ${position.market} position #${position.info.positionId}`} aria-describedby={`${figuresId}-debt ${figuresId}-facts`} onClick={event => onOpen(event.currentTarget)}>
    <span className={styles.identity}>
      <TokenIcon symbol={position.market === 'BTC' ? 'WBTC' : 'ETH'} size={32} />
      <span><strong>{position.market} collateral</strong><small>Position #{position.info.positionId}</small></span>
      <ChevronRight size={18} aria-hidden="true" />
    </span>
    <span id={`${figuresId}-debt`} className={styles.debt}><span>Outstanding debt</span><strong>{figures.debt} <small>{position.info.rawDebtsToken}</small></strong>
      <DollarEquivalent cents={figures.debtUsdCents} status={figures.status} label="Debt value" />
    </span>
    <span id={`${figuresId}-facts`} className={styles.facts}>
      <span><span>Collateral</span><strong>{figures.collateral}</strong><DollarEquivalent cents={figures.collateralUsdCents} status={figures.status} label="Collateral value" /></span>
      <span><span>Loan-to-value</span><strong><ValueOrSkeleton value={figures.ltv ?? '—'} status={figures.status} label="Loan-to-value unavailable" /></strong></span>
    </span>
    {stale && <span className={styles.stale}><CircleAlert size={14} aria-hidden="true" />Update needed before managing</span>}
  </button>;
}

function DollarEquivalent({ cents, status, label }: { cents: bigint | null; status: 'loading' | 'unavailable'; label: string }) {
  return <small className={styles.dollarEquivalent}><ValueOrSkeleton value={cents !== null ? `≈ ${formatUsdCents(cents)}` : '—'} status={status} label={`${label} ${status}`} /></small>;
}

export function BorrowPositionsState({ kind, refreshing, onRetry, children }: {
  kind: 'loading' | 'unavailable' | 'empty' | 'disconnected'; refreshing?: boolean; onRetry?: () => void; children?: ReactNode;
}) {
  const Icon = kind === 'unavailable' ? CircleAlert : kind === 'disconnected' ? Wallet : Layers3;
  const title = kind === 'loading' ? 'Loading your positions' : kind === 'unavailable' ? 'Couldn’t load positions' : kind === 'disconnected' ? 'Your borrowing positions' : 'No borrowing positions yet';
  const description = kind === 'unavailable' ? 'Your positions haven’t changed. Try loading them again.'
    : kind === 'disconnected' ? 'Connect your wallet to view and manage your collateral.'
      : kind === 'empty' ? 'Borrow fxUSD against ETH or BTC, then manage your collateral and debt here.' : 'Reading your ETH and BTC collateral.';
  return <section className={styles.state} aria-busy={kind === 'loading' || refreshing || undefined}>
    <span className={styles.stateIcon}><Icon size={23} aria-hidden="true" /></span>
    <div role="status"><h2>{title}</h2><p>{description}</p></div>
    {kind === 'unavailable' && <button type="button" className="button button-primary" disabled={refreshing} onClick={onRetry}>
      <RefreshCw size={16} aria-hidden="true" className={refreshing ? styles.spinning : undefined} />{refreshing ? 'Loading positions…' : 'Reload positions'}
    </button>}
    {children}
  </section>;
}

/** Management and review share one dialog, so edits never jump to another surface. */
export function BorrowPositionManager({ position, stale, inputStage, locked, triggerRef, onClose, children }: {
  position: UiPosition; stale: boolean; inputStage: boolean; locked: boolean; triggerRef: RefObject<HTMLElement | null>; onClose: () => void; children: ReactNode;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const figures = usePositionFigures(position, stale);
  const dialogRef = useOverlayDialog<HTMLElement>({ open: true, onClose, triggerRef, initialFocusRef: closeRef, dismissible: !locked,
    restoreFocusFallback: () => document.querySelector<HTMLElement>('[data-borrow-positions-heading]') });
  return createPortal(<div data-product-ui="v2" className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget && !locked) onClose(); }}>
    <section ref={dialogRef} className={styles.manager} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className={styles.managerHeader}>
        <span className={styles.handle} aria-hidden="true" />
        <TokenIcon symbol={position.market === 'BTC' ? 'WBTC' : 'ETH'} size={32} />
        <div><h2 id={titleId}>{position.market} position #{position.info.positionId}</h2><p>Borrowing · Ethereum</p></div>
        <button ref={closeRef} type="button" className={styles.close} disabled={locked} onClick={onClose} aria-label="Close position manager"><X size={20} aria-hidden="true" /></button>
      </header>
      <div className={styles.managerBody}>
        {inputStage && <>
          <details className={styles.details}><summary><span className="sr-only">Position details: </span>
            <span className={styles.managerMetrics}>
              <span><span>Outstanding debt</span><strong>{figures.debt} <small>{position.info.rawDebtsToken}</small></strong><DollarEquivalent cents={figures.debtUsdCents} status={figures.status} label="Debt value" /></span>
              <span><span>Loan-to-value</span><strong><ValueOrSkeleton value={figures.ltv ?? '—'} status={figures.status} label="Loan-to-value unavailable" /></strong></span>
            </span><ChevronDown size={15} aria-hidden="true" />
          </summary>
            <dl><div><dt>Collateral</dt><dd>{figures.collateral}<DollarEquivalent cents={figures.collateralUsdCents} status={figures.status} label="Collateral value" /></dd></div>
              <div><dt>Net position value</dt><dd><ValueOrSkeleton value={figures.netEquityUsdCents !== null ? `≈ ${formatUsdCents(figures.netEquityUsdCents)}` : '—'} status={figures.status} label="Net position value unavailable" /></dd></div></dl>
          </details>
        </>}
        <MobileFlowSheetContext.Provider value>{children}</MobileFlowSheetContext.Provider>
      </div>
    </section>
  </div>, document.body);
}
