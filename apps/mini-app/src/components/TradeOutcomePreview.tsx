'use client';

import { useEffect, useState } from 'react';
import { MissingValue } from '@/components/MissingValue';
import { LIQUIDATION_QUOTE_TTL_MS } from '@/lib/fx/liquidationQuote';
import { positionOutcomeFacts } from '@/lib/fx/reviewFormatting';
import type { PlannedRoute } from '@/lib/fx/types';
import { approximately } from '@/lib/tradeOutcome';
import { ReviewFactValue } from './review/ReviewFactValue';
import { MetricLabel } from './InfoHelp';
import { reviewHelpDefinition } from './review/reviewHelp';
import styles from './TradeOutcomePreview.module.css';

type Row = { label: string; value?: string; title?: string };

/**
 * What the ticket's warmed route would hold once it executes, under the
 * leverage field: the expected execution price, projected liquidation price,
 * and protocol fee. Execution uses the review's own quote; liquidation uses
 * the same projected amounts and a fresh pool threshold. Both prices are
 * estimates; the review still plans, simulates and
 * validates the route before anything is signed. `route` is null while the
 * warm-up runs: the same rows hold their place with placeholders.
 */
export function TradeOutcomePreview({ route }: { market: 'ETH' | 'BTC'; side: 'long' | 'short'; route: PlannedRoute | null }) {
  const [, expireQuote] = useState(0);
  useEffect(() => {
    const readAt = route?.details?.liquidationQuote?.readAt;
    const now = Date.now();
    if (readAt === undefined || !Number.isFinite(readAt) || readAt > now) return;
    const delay = readAt + LIQUIDATION_QUOTE_TTL_MS - now;
    // The ticket can stay untouched: stop displaying an expired pool threshold.
    const timer = window.setTimeout(() => expireQuote((value) => value + 1), Math.max(0, delay + 1));
    return () => window.clearTimeout(timer);
  }, [route]);
  const facts = route ? positionOutcomeFacts(route) : null;
  // A route the review cannot describe either has nothing to preview.
  if (route && !facts) return null;
  const rows: Row[] = facts ? [
    { label: 'Execution price', value: facts.executionPrice ? approximately(facts.executionPrice.value) : 'Unavailable', title: facts.executionPrice?.title },
    { label: 'Liquidation price', value: facts.liquidationPrice ? approximately(facts.liquidationPrice.value) : 'Unavailable', title: facts.liquidationPrice?.title },
    // The rate is the pool's own quoted rate, shown exactly as the review shows it.
    { label: facts.fee?.label ?? 'f(x) fee', value: facts.fee?.value ?? 'Unavailable', title: facts.fee?.title },
  ] : [
    { label: 'Execution price' },
    { label: 'Liquidation price' },
    { label: 'f(x) fee' },
  ];
  return (
    <div className={styles.outcome} role="group" aria-label="Estimated position" aria-busy={!facts || undefined} data-trade-outcome={facts ? 'ready' : 'pending'}>
      <dl className={styles.facts}>
        {rows.map((row) => <div key={row.label} className={styles.row} data-outcome-fact={row.label}>
          <dt><MetricLabel label={row.label} definition={reviewHelpDefinition(row.label)} /></dt>
          <dd>
            {row.value === undefined
              ? <MissingValue width={row.label === 'f(x) fee' ? 'sm' : 'xl'} announce={false} label={`Loading ${row.label.toLowerCase()}`} />
              : <ReviewFactValue className={styles.figure} fact={{ label: row.label, value: row.value, title: row.title }} />}
          </dd>
        </div>)}
      </dl>
    </div>
  );
}
