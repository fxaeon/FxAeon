'use client';

import { useEffect, useState } from 'react';
import type { PlannedRoute } from '@/lib/fx';
import { LIQUIDATION_QUOTE_TTL_MS, projectedLiquidationPrice, projectedRebalancePrice } from '@/lib/fx/liquidationQuote';
import { ValueOrSkeleton } from '@/components/MissingValue';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { approximately } from '@/lib/tradeOutcome';
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
    {showExecution && <div data-review-fact="Execution price"><span>Execution price</span><span title={execution?.title}><ValueOrSkeleton value={execution ? approximately(execution.value) : pending ? '—' : 'Unavailable'} announce={false} /></span></div>}
    <div data-review-fact="Rebalance price"><span>Est. rebalance price</span><span title={rebalance?.title}><ValueOrSkeleton value={rebalance ? `≈ ${rebalance.value}` : pending ? '—' : 'Unavailable'} announce={false} /></span></div>
    <div data-review-fact="Liquidation price"><span>Est. liquidation price</span><span title={liquidation?.title}><ValueOrSkeleton value={liquidation ? `≈ ${liquidation.value}` : pending ? '—' : 'Unavailable'} announce={false} /></span></div>
  </div>;
}
