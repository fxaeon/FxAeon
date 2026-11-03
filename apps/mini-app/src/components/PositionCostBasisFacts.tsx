'use client';

import type { UiPosition } from '@/app/trade/fxUi';
import { costBasisUnit, formatCostBasisPrice, formatPositionPnl } from '@/lib/positionCostBasis';
import { MetricLabel } from '@/components/InfoHelp';
import { MissingValue } from '@/components/MissingValue';
import { usePositionCostBasis, type PositionCostBasisStatus } from '@/components/PositionCostBasisContext';

export const ENTRY_PRICE_HELP = 'The average price this position paid for its collateral (for a short, for the asset it borrowed), worked out from its orders as the f(x) index records them, the way the official f(x) app does. Funding charged on a long raises it; fees are not part of it.';

export function estimatedPnlHelp(market: UiPosition['market']): string {
  return `An estimate, not an amount you would receive: the move from the entry price to the current f(x) DEX mid price for ${costBasisUnit(market)}, times the position’s size. It excludes exit costs (the closing fee, slippage and network fees) and the fees paid to open. The percentage applies the position’s target leverage. It appears once the f(x) index has caught up with the position on chain.`;
}

/** Entry price and PnL text for a resolved status; null where a placeholder belongs. */
export function costBasisFigures(basis: PositionCostBasisStatus, market: UiPosition['market']) {
  const ready = basis.status === 'ready' ? basis : null;
  const status = basis.status === 'loading' ? 'loading' as const : 'unavailable' as const;
  return {
    entry: ready ? formatCostBasisPrice(ready.entryWad, market) : null,
    entryStatus: status,
    pnl: ready?.pnl ? formatPositionPnl(ready.pnl) : null,
    pnlStatus: ready ? (ready.pnlStatus === 'loading' ? 'loading' as const : 'unavailable' as const) : status,
    /** The mid price the PnL is taken at. */
    price: ready?.pnl && ready.priceWad !== null ? formatCostBasisPrice(ready.priceWad, market) : null,
  };
}

/**
 * A position's entry price and estimated PnL as two facts of its details
 * list, each with its assumptions behind an info control. Placeholders hold
 * their place while the index or the price is read; a figure from an index
 * record behind the chain is never shown.
 */
export function PositionCostBasisFacts({ position, factClassName, stale = false }: { position: UiPosition; factClassName?: string; stale?: boolean }) {
  const basis = usePositionCostBasis(position);
  if (basis.status === 'none') return null;
  const figures = stale ? costBasisFigures({ status: 'unavailable' }, position.market) : costBasisFigures(basis, position.market);
  return <>
    <div className={factClassName}>
      <dt><MetricLabel minimalHelp label="Entry price" help={ENTRY_PRICE_HELP} /></dt>
      <dd data-position-cost-basis="entry">{figures.entry
        ?? <MissingValue width="md" status={figures.entryStatus} label={figures.entryStatus === 'loading' ? 'Loading entry price' : 'Entry price unavailable'} />}</dd>
    </div>
    <div className={factClassName}>
      <dt><MetricLabel minimalHelp label="Est. PnL" help={estimatedPnlHelp(position.market)} /></dt>
      <dd data-position-cost-basis="pnl">{figures.pnl
        ?? <MissingValue width="md" status={figures.pnlStatus} label={figures.pnlStatus === 'loading' ? 'Loading estimated PnL' : 'Estimated PnL unavailable'} />}
        {figures.price && <small>at {figures.price}</small>}</dd>
    </div>
  </>;
}
