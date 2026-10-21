'use client';

import { useEffect, useState } from 'react';
import type { PlannedRoute } from '@/lib/fx';
import { LIQUIDATION_QUOTE_TTL_MS, projectedLiquidationPrice, projectedRebalancePrice } from '@/lib/fx/liquidationQuote';
import { ValueOrSkeleton } from '@/components/MissingValue';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { approximately } from '@/lib/tradeOutcome';
import { ReviewFactValue } from './ReviewFactValue';
import { MetricLabel } from '../InfoHelp';
import { ReviewTermRow } from './ReviewTermRow';
import styles from './ActionReviewPresentation.module.css';

export function ReviewRiskPrices({ route, execution, pending, showExecution = true, compact = false }: { route?: PlannedRoute | null; execution?: ReviewFact; pending: boolean; showExecution?: boolean; compact?: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const readAt = route?.details?.liquidationQuote?.readAt;
    if (readAt === undefined || !Number.isFinite(readAt) || readAt > Date.now()) return;
    const timer = window.setTimeout(() => tick(value => value + 1), Math.max(0, readAt + LIQUIDATION_QUOTE_TTL_MS - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [route]);
  const liquidation = route ? projectedLiquidationPrice(route) : undefined;
  const rebalance = route ? projectedRebalancePrice(route) : undefined;
  const rows = <div className={styles.riskPrices}>
    {showExecution && <div data-review-fact={compact ? undefined : "Execution price"}><MetricLabel label="Execution price" definition="executionPrice" /><span title={execution?.title}>{execution ? <ReviewFactValue fact={{ ...execution, value: approximately(execution.value) }} /> : <ValueOrSkeleton value={pending ? '—' : 'Unavailable'} announce={false} />}</span></div>}
    <div data-review-fact={compact ? undefined : "Rebalance price"}><MetricLabel label="Est. rebalance price" definition="rebalancePrice" /><span title={rebalance?.title}>{rebalance ? <ReviewFactValue fact={{ label: 'Rebalance price', value: `≈ ${rebalance.value}`, title: rebalance.title }} /> : <ValueOrSkeleton value={pending ? '—' : 'Unavailable'} announce={false} />}</span></div>
    <div data-review-fact={compact ? undefined : "Liquidation price"}><MetricLabel label="Est. liquidation price" definition="liquidationPrice" /><span title={liquidation?.title}>{liquidation ? <ReviewFactValue fact={{ label: 'Liquidation price', value: `≈ ${liquidation.value}`, title: liquidation.title }} /> : <ValueOrSkeleton value={pending ? '—' : 'Unavailable'} announce={false} />}</span></div>
  </div>;
  if (!compact) return rows;
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
