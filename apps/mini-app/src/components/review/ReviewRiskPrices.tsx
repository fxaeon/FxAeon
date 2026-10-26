'use client';

import type { PlannedRoute } from '@/lib/fx';
import { projectedLiquidationPrice, projectedRebalancePrice } from '@/lib/fx/liquidationQuote';
import { useRouteRiskQuote } from '@/lib/fx/useRouteRiskQuote';
import { ReviewTermRow } from './ReviewTermRow';
import styles from './ActionReviewPresentation.module.css';

export function ReviewRiskPrices({ route }: { route?: PlannedRoute | null }) {
  const risk = useRouteRiskQuote(route);
  const liquidation = risk.route ? projectedLiquidationPrice(risk.route) : undefined;
  const rebalance = risk.route ? projectedRebalancePrice(risk.route) : undefined;
  // Keep every available threshold in the decision. Missing auxiliary reads
  // share one honest disclosure instead of displacing the amounts and costs.
  const known = [
    rebalance && { label: 'Rebalance price', value: `≈ ${rebalance.value}`, title: rebalance.title },
    liquidation && { label: 'Liquidation price', value: `≈ ${liquidation.value}`, title: liquidation.title },
  ].filter((fact): fact is { label: string; value: string; title: string } => Boolean(fact));
  return <div className={styles.compactRisk}>
    {known.map(fact => <ReviewTermRow key={fact.label} fact={fact} />)}
    {known.length < 2 && <ReviewTermRow fact={{ label: known.length ? 'Other risk estimates' : 'Risk estimates', value: risk.loading ? '—' : 'Unavailable', title: `Fresh, complete pool inputs are unavailable for ${!rebalance && !liquidation ? 'the rebalance and liquidation thresholds' : !rebalance ? 'the rebalance threshold' : 'the liquidation threshold'}. These estimates use the pool’s collateral price. Rebalancing reduces collateral and debt before liquidation. Funding, rates and rebalancing can change both thresholds.` }} />}
  </div>;
}
