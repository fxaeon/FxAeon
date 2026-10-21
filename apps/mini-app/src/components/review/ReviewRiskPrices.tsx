'use client';

import { useEffect, useState } from 'react';
import type { PlannedRoute } from '@/lib/fx';
import { LIQUIDATION_QUOTE_TTL_MS, projectedLiquidationPrice, projectedRebalancePrice } from '@/lib/fx/liquidationQuote';
import { ValueOrSkeleton } from '@/components/MissingValue';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { approximately } from '@/lib/tradeOutcome';
import { ReviewFactValue } from './ReviewFactValue';
import { MetricLabel } from '../InfoHelp';
import styles from './ActionReviewPresentation.module.css';

export function ReviewRiskPrices({ route, execution, pending, showExecution = true }: { route?: PlannedRoute | null; execution?: ReviewFact; pending: boolean; showExecution?: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const readAt = route?.details?.liquidationQuote?.readAt;
    if (readAt === undefined || !Number.isFinite(readAt) || readAt > Date.now()) return;
    const timer = window.setTimeout(() => tick(value => value + 1), Math.max(0, readAt + LIQUIDATION_QUOTE_TTL_MS - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [route]);
  const liquidation = route ? projectedLiquidationPrice(route) : undefined;
  const rebalance = route ? projectedRebalancePrice(route) : undefined;
  return <div className={styles.riskPrices}>
    {showExecution && <div data-review-fact="Execution price"><MetricLabel label="Execution price" definition="executionPrice" /><span title={execution?.title}>{execution ? <ReviewFactValue fact={{ ...execution, value: approximately(execution.value) }} /> : <ValueOrSkeleton value={pending ? '—' : 'Unavailable'} announce={false} />}</span></div>}
    <div data-review-fact="Rebalance price"><MetricLabel label="Est. rebalance price" definition="rebalancePrice" /><span title={rebalance?.title}>{rebalance ? <ReviewFactValue fact={{ label: 'Rebalance price', value: `≈ ${rebalance.value}`, title: rebalance.title }} /> : <ValueOrSkeleton value={pending ? '—' : 'Unavailable'} announce={false} />}</span></div>
    <div data-review-fact="Liquidation price"><MetricLabel label="Est. liquidation price" definition="liquidationPrice" /><span title={liquidation?.title}>{liquidation ? <ReviewFactValue fact={{ label: 'Liquidation price', value: `≈ ${liquidation.value}`, title: liquidation.title }} /> : <ValueOrSkeleton value={pending ? '—' : 'Unavailable'} announce={false} />}</span></div>
  </div>;
}
