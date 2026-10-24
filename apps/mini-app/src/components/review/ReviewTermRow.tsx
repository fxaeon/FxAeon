import type { ReactNode } from 'react';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { MetricLabel } from '@/components/InfoHelp';
import { INFO_HELP_CONTENT } from '@/components/infoHelpContent';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { FeeAmount } from './AmountUsd';
import { ReviewFactValue } from './ReviewFactValue';
import { ProtocolFeeAmount } from './ProtocolFeeAmount';
import { reviewHelpDefinition } from './reviewHelp';
import styles from './ActionReviewPresentation.module.css';

/** Compact decision value with a single, concise explanation on its info icon. */
export function ReviewTermRow({ fact, displayLabel, displayValue, help: helpOverride, quiet = false }: {
  fact: ReviewFact; displayLabel?: string; displayValue?: ReactNode; help?: ReactNode; quiet?: boolean;
}) {
  const definition = reviewHelpDefinition(fact.label);
  const unavailable = ['Unavailable', 'Not quoted', '—'].includes(fact.value);
  const help = helpOverride ?? reviewTermHelp(fact);
  return <div data-review-fact={fact.label} className={styles.compactFact}>
    <MetricLabel minimalHelp label={displayLabel ?? fact.label} definition={definition} help={help} />
    <span>
      {fact.value === '—' ? <ValueOrSkeleton value={fact.value} width="md" announce={!quiet} label={`Loading ${fact.label.toLowerCase()}`} />
        : unavailable ? fact.value
        : ['Gas fee', 'Bridge fee'].includes(fact.label) ? <FeeAmount fact={fact} />
        : ['f(x) fee', 'Protocol fee'].includes(fact.label) ? <ProtocolFeeAmount fact={fact} />
        : <ReviewFactValue fact={fact} display={displayValue} />}
      {fact.equivalent && <small>{fact.equivalent}</small>}
    </span>
  </div>;
}

/** Definitions stay short; transaction precision remains in the accepted model. */
export function reviewTermHelp(fact: ReviewFact): string | undefined {
  const definition = reviewHelpDefinition(fact.label);
  const source = fact.title && fact.title !== fact.value ? fact.title : undefined;
  if (['Unavailable', 'Not quoted', '—'].includes(fact.value) && source) return source;
  if (fact.label === 'Minimum fxSP') return 'This minimum protects the intermediate fxSP deposit. The final fxSAVE share amount is an estimate and can change with the vault conversion.';
  if (fact.label === 'Rebalance price' || fact.label === 'Liquidation price') return `${definition ? INFO_HELP_CONTENT[definition] : ''} Uses the pool’s collateral price, not an ETH/USD or BTC/USD spot quote.`;
  if (source && !/^(?:≈\s*)?[+\-\d$€£]/.test(source)) return `${definition ? `${INFO_HELP_CONTENT[definition]} ` : ''}${source}`;
  return undefined;
}
