'use client';

import { useEffect, useState } from 'react';
import type { PlannedRoute } from '@/lib/fx';
import { LIQUIDATION_QUOTE_TTL_MS, projectedLiquidationPrice, projectedRebalancePrice } from '@/lib/fx/liquidationQuote';
import { ReviewTermRow } from './ReviewTermRow';
import styles from './ActionReviewPresentation.module.css';

export function ReviewRiskPrices({ route }: { route?: PlannedRoute | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const readAt = route?.details?.liquidationQuote?.readAt;
    if (readAt === undefined || !Number.isFinite(readAt) || readAt > Date.now()) return;
    const timer = window.setTimeout(() => tick(value => value + 1), Math.max(0, readAt + LIQUIDATION_QUOTE_TTL_MS - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [route]);
  const liquidation = route ? projectedLiquidationPrice(route) : undefined;
  const rebalance = route ? projectedRebalancePrice(route) : undefined;
  // Keep every available threshold in the decision. Missing auxiliary reads
  // share one honest disclosure instead of displacing the amounts and costs.
  const known = [
    rebalance && { label: 'Rebalance price', value: `≈ ${rebalance.value}`, title: rebalance.title },
    liquidation && { label: 'Liquidation price', value: `≈ ${liquidation.value}`, title: liquidation.title },
  ].filter((fact): fact is { label: string; value: string; title: string } => Boolean(fact));
  return <div className={styles.compactRisk}>
    {known.map(fact => <ReviewTermRow key={fact.label} fact={fact} />)}
    {known.length < 2 && <ReviewTermRow fact={{ label: known.length ? 'Other risk estimates' : 'Risk estimates', value: 'Unavailable', title: `Fresh, complete pool inputs are unavailable for ${!rebalance && !liquidation ? 'the rebalance and liquidation thresholds' : !rebalance ? 'the rebalance threshold' : 'the liquidation threshold'}. These estimates use the pool’s collateral price. Rebalancing reduces collateral and debt before liquidation. Funding, rates and rebalancing can change both thresholds.` }} />}
  </div>;
}
