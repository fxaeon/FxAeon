'use client';

import { MissingValue } from '@/components/MissingValue';
import { useRouteRiskQuote } from '@/lib/fx/useRouteRiskQuote';
import { positionOutcomeFacts } from '@/lib/fx/reviewFormatting';
import type { PlannedRoute } from '@/lib/fx/types';
import { approximately } from '@/lib/tradeOutcome';
import { ReviewFactValue } from './review/ReviewFactValue';
import { ProtocolFeeAmount } from './review/ProtocolFeeAmount';
import { MetricLabel } from './InfoHelp';
import { reviewHelpDefinition } from './review/reviewHelp';
import styles from './TradeOutcomePreview.module.css';

type Row = { label: string; value?: string; title?: string; feeAmounts?: import('@/lib/fx/reviewFormatting').ReviewFact['feeAmounts'] };

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
  const risk = useRouteRiskQuote(route);
  const facts = risk.route ? positionOutcomeFacts(risk.route) : null;
  // A route the review cannot describe either has nothing to preview.
  if (route && !facts) return null;
  const rows: Row[] = facts ? [
    { label: 'Execution price', value: facts.executionPrice ? approximately(facts.executionPrice.value) : 'Unavailable', title: facts.executionPrice?.title },
    { label: 'Liquidation price', value: facts.liquidationPrice ? approximately(facts.liquidationPrice.value) : risk.loading ? undefined : 'Unavailable', title: facts.liquidationPrice?.title },
    { label: facts.fee?.label ?? 'f(x) fee', value: facts.fee?.value ?? 'Unavailable', title: facts.fee?.title, feeAmounts: facts.fee?.feeAmounts },
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
              : row.label === 'f(x) fee' ? <ProtocolFeeAmount className={styles.figure} fact={{ ...row, value: row.value }} />
              : <ReviewFactValue className={styles.figure} fact={{ label: row.label, value: row.value, title: row.title }} />}
          </dd>
        </div>)}
      </dl>
    </div>
  );
}
