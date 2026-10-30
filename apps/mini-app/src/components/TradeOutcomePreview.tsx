'use client';

import { MissingValue } from '@/components/MissingValue';
import { useRouteRiskQuote } from '@/lib/fx/useRouteRiskQuote';
import { positionOutcomeFacts, type PositionOutcomeFacts } from '@/lib/fx/reviewFormatting';
import type { PlannedRoute } from '@/lib/fx/types';
import { approximately } from '@/lib/tradeOutcome';
import { ReviewFactValue } from './review/ReviewFactValue';
import { ProtocolFeeAmount } from './review/ProtocolFeeAmount';
import { MetricLabel } from './InfoHelp';
import { reviewHelpDefinition } from './review/reviewHelp';
import styles from './TradeOutcomePreview.module.css';

type Row = { label: string; value?: string; status?: 'loading' | 'unavailable'; title?: string; feeAmounts?: import('@/lib/fx/reviewFormatting').ReviewFact['feeAmounts'] };
const valueOrAbsent = (value?: string) => value && !/^(?:Unavailable|Not quoted|—|-)?$/i.test(value.trim()) ? value : undefined;

/**
 * What the ticket's warmed route would hold once it executes, under the
 * leverage field: the expected execution price, projected rebalance (the f(x)
 * "liquidation brake") and liquidation prices, and protocol fee. Execution
 * uses the review's own quote; the thresholds use the same projected amounts
 * and fresh pool ratios. Every price is an estimate; the review still plans,
 * simulates and validates the route before anything is signed. `route` is
 * null while the warm-up runs: the same rows hold their place with placeholders.
 */
export function TradeOutcomePreview({ route, facts: publicFacts }: { market: 'ETH' | 'BTC'; side: 'long' | 'short'; route: PlannedRoute | null; facts?: PositionOutcomeFacts }) {
  const risk = useRouteRiskQuote(route);
  const facts = publicFacts ?? (risk.route ? positionOutcomeFacts(risk.route) : null);
  // A route the review cannot describe either has nothing to preview.
  if (route && !facts) return null;
  const threshold = (label: string, fact: PositionOutcomeFacts['rebalancePrice']): Row => ({
    label, value: fact ? valueOrAbsent(approximately(fact.value)) : undefined, status: risk.loading ? 'loading' : 'unavailable', title: fact?.title,
  });
  const rows: Row[] = facts ? [
    { label: 'Execution price', value: facts.executionPrice ? valueOrAbsent(approximately(facts.executionPrice.value)) : undefined, status: 'unavailable', title: facts.executionPrice?.title },
    threshold('Rebalance price', facts.rebalancePrice),
    threshold('Liquidation price', facts.liquidationPrice),
    { label: facts.fee?.label ?? 'f(x) fee', value: valueOrAbsent(facts.fee?.value), status: 'unavailable', title: facts.fee?.title, feeAmounts: facts.fee?.feeAmounts },
  ] : [
    { label: 'Execution price', status: 'loading' },
    { label: 'Rebalance price', status: 'loading' },
    { label: 'Liquidation price', status: 'loading' },
    { label: 'f(x) fee', status: 'loading' },
  ];
  return (
    <div className={styles.outcome} role="group" aria-label="Position preview" aria-busy={!facts || undefined} data-trade-outcome={facts ? 'ready' : 'pending'}>
      <dl className={styles.facts}>
        {rows.map((row) => <div key={row.label} className={styles.row} data-outcome-fact={row.label}>
          <dt><MetricLabel minimalHelp label={row.label} definition={reviewHelpDefinition(row.label)} /></dt>
          <dd>
            {row.value === undefined
              ? <MissingValue width={row.label === 'f(x) fee' ? 'sm' : 'xl'} status={row.status ?? 'loading'} announce={false} label={row.status === 'unavailable' ? `${row.label} unavailable` : `Loading ${row.label.toLowerCase()}`} />
              : row.label === 'f(x) fee' && row.feeAmounts?.length ? <ProtocolFeeAmount className={styles.figure} fact={{ ...row, value: row.value }} />
              : <ReviewFactValue className={styles.figure} fact={{ label: row.label, value: row.value, title: row.title }} />}
          </dd>
        </div>)}
      </dl>
    </div>
  );
}
