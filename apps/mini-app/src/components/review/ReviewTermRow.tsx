import type { ReactNode } from 'react';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { MetricLabel } from '@/components/InfoHelp';
import { INFO_HELP_CONTENT } from '@/components/infoHelpContent';
import { MissingValue, ValueOrSkeleton } from '@/components/MissingValue';
import { FeeAmount, InlineAmount } from './AmountUsd';
import { ReviewFactValue } from './ReviewFactValue';
import { tokenAmountParts } from './transactionAmountPresentation';
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
        : unavailable ? <MissingValue width="md" status="unavailable" announce={!quiet} label={`${fact.label} unavailable`} />
        : ['Gas fee', 'Bridge fee'].includes(fact.label) ? <FeeAmount fact={fact} />
        : ['f(x) fee', 'Protocol fee'].includes(fact.label) ? <ProtocolFeeAmount fact={fact} />
        : <PricedFactValue fact={fact} display={displayValue} />}
      {fact.equivalent && <small>{fact.equivalent}</small>}
    </span>
  </div>;
}

/** A token amount carries its USD estimate, like every amount leg; other values stay as reviewed. */
function PricedFactValue({ fact, display }: { fact: ReviewFact; display?: ReactNode }) {
  const value = <ReviewFactValue fact={fact} display={display} />;
  const parts = display === undefined && !fact.equivalent ? tokenAmountParts(fact) : null;
  return parts ? <InlineAmount amount={parts.amount} symbol={parts.symbol} token={value} /> : value;
}

/** Definitions stay short; transaction precision remains in the accepted model. */
export function reviewTermHelp(fact: ReviewFact): string | undefined {
  const definition = reviewHelpDefinition(fact.label);
  const source = fact.title && fact.title !== fact.value ? fact.title : undefined;
  if (['Unavailable', 'Not quoted', '—'].includes(fact.value) && source) return source;
  if (fact.label === 'Minimum fxSP') return 'This minimum protects the intermediate fxSP deposit. The final fxSAVE share amount is an estimate and can change with the vault conversion.';
  if (fact.label === 'Rebalance price' || fact.label === 'Liquidation price') return `${definition ? INFO_HELP_CONTENT[definition] : ''} Uses the pool’s collateral price, not an ETH/USD or BTC/USD spot quote.`;
  if (fact.label === 'f(x) fee' || fact.label === 'Protocol fee') {
    const rates = source?.match(/\d+(?:\.\d+)?% of (?:supplied collateral|withdrawn collateral|borrowed debt|repaid debt)/g)
      ?? (/^\d+(?:\.\d+)?%$/.test(fact.value) ? [fact.value] : []);
    return rates.length ? `${INFO_HELP_CONTENT.protocolFee} Quoted ${rates.length === 1 ? 'rate' : 'rates'}: ${rates.join(' + ')}.` : undefined;
  }
  if (source && !/^(?:≈\s*)?[+\-\d$€£]/.test(source)) return `${definition ? `${INFO_HELP_CONTENT[definition]} ` : ''}${source}`;
  return undefined;
}
