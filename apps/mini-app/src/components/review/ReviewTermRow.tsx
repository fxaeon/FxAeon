import type { ReactNode } from 'react';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { MetricLabel } from '@/components/InfoHelp';
import { INFO_HELP_CONTENT } from '@/components/infoHelpContent';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { FeeAmount } from './AmountUsd';
import { ReviewFactValue } from './ReviewFactValue';
import { reviewHelpDefinition } from './reviewHelp';
import styles from './ActionReviewPresentation.module.css';

/** A decision term owns its definition and exact source value in place.
 * The technical panel does not need a second copy of the same term. */
export function ReviewTermRow({ fact, displayLabel, displayValue, quiet = false }: {
  fact: ReviewFact; displayLabel?: string; displayValue?: ReactNode; quiet?: boolean;
}) {
  const definition = reviewHelpDefinition(fact.label);
  const unavailable = ['Unavailable', 'Not quoted', '—'].includes(fact.value);
  const help = reviewTermHelp(fact);
  return <div data-review-fact={fact.label} className={styles.compactFact}>
    <MetricLabel minimalHelp label={displayLabel ?? fact.label} definition={definition} help={help} />
    <span>
      {fact.value === '—' ? <ValueOrSkeleton value={fact.value} width="md" announce={!quiet} label={`Loading ${fact.label.toLowerCase()}`} />
        : unavailable ? fact.value
        : ['Gas fee', 'Bridge fee'].includes(fact.label) ? <FeeAmount fact={fact} />
        : <ReviewFactValue fact={fact} display={displayValue} />}
      {fact.equivalent && <small>{fact.equivalent}</small>}
    </span>
  </div>;
}

/** Definitions stay short. Full numeric precision remains on the value itself;
 * missing-source and nonnumeric quote caveats stay reachable on the info icon. */
export function reviewTermHelp(fact: ReviewFact): string | undefined {
  const definition = reviewHelpDefinition(fact.label);
  const source = fact.title && fact.title !== fact.value ? fact.title : undefined;
  if (['Unavailable', 'Not quoted', '—'].includes(fact.value) && source) return source;
  if (fact.label === 'Rebalance price' || fact.label === 'Liquidation price') return `${definition ? INFO_HELP_CONTENT[definition] : ''} Uses the pool’s collateral price, not an ETH/USD or BTC/USD spot quote.`;
  if (source && !/^(?:≈\s*)?[+\-\d$€£]/.test(source)) return `${definition ? `${INFO_HELP_CONTENT[definition]} ` : ''}${source}`;
  return undefined;
}
