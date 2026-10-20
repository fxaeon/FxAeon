'use client';
import { ArrowDown, ChevronDown, Plus } from 'lucide-react';
import { TokenIcon, ChainIcon } from '@/components/TokenIcon';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { AmountUsd } from './AmountUsd';
import { plainAmountLabel, tokenAmountParts } from './transactionAmountPresentation';
import { readableReviewAmount } from './reviewHierarchy';
import styles from './ActionReviewPresentation.module.css';

/** The same amount-led presentation for reviewed intent and observed transfers. */
export function TransactionAmountFlow({ facts, chainId, caption, receipt = false }: {
  facts: readonly ReviewFact[]; chainId: number; caption?: string; receipt?: boolean;
}) {
  if (!facts.length) return null;
  return <section className={styles.amountFlow} aria-label={receipt ? 'Observed token movements' : 'Transaction amounts'} data-amount-provenance={receipt ? 'receipt' : 'review'}>
    {caption && <p className={styles.flowCaption}>{caption}</p>}
    {facts.map((fact, index) => {
      const parts = tokenAmountParts(fact);
      if (!parts) return null;
      const display = readableReviewAmount(parts.amount);
      const estimate = !receipt && fact.label.startsWith('Estimated');
      return <div key={`${fact.label}-${index}`}>
        {index > 0 && (facts[index - 1].label === fact.label || facts.every(item => item.label.startsWith('Minimum received (') || /^Estimated (fxUSD|USDC) payout$/.test(item.label)) ? <Plus className={styles.flowArrow} size={16} aria-hidden="true" /> : <ArrowDown className={styles.flowArrow} size={18} aria-hidden="true" />)}
        <div className={styles.flowAmount} data-review-fact={fact.label}>
          <span className={styles.flowToken} aria-hidden="true"><TokenIcon symbol={parts.symbol} size={40} />{index === 0 && (chainId === 1 || chainId === 8453) && <span><ChainIcon chainId={chainId} size={15} /></span>}</span>
          <div className={styles.flowValue}>
            <span className={styles.flowLabel}>{plainAmountLabel(fact.label)}</span>
            <details className={styles.flowExact}><summary data-long={display.value.length > 15 || undefined} aria-label={`Show ${estimate ? 'full estimate' : `${parts.exact ? 'exact' : 'full'} amount`}: ${parts.amount} ${parts.symbol}`}><span>{display.shortened || parts.approximate ? '≈ ' : ''}{display.value} <span className={styles.flowUnit}>{parts.symbol}</span></span><ChevronDown size={13} aria-hidden="true" /></summary><p><span>{estimate ? 'Unrounded estimate' : `${parts.exact ? 'Exact' : 'Reported'} ${receipt ? 'receipt' : 'reviewed'} amount`}</span>{fact.title ?? fact.value}</p></details>
            <div className={styles.flowSubline}><AmountUsd amount={parts.amount} symbol={parts.symbol} receipt={receipt} />{index === 0 && <span>· {chainId === 8453 ? 'Base' : chainId === 1 ? 'Ethereum' : `chain ${chainId}`}</span>}</div>
          </div>
        </div>
      </div>;
    })}
  </section>;
}

function boundedReviewedValue(value: string): string {
  const parts = tokenAmountParts({ value });
  if (!parts) return value;
  const display = readableReviewAmount(parts.amount);
  return `${parts.approximate || display.shortened ? '≈ ' : ''}${display.value} ${parts.symbol}`;
}

/** Position consequences are not wallet transfers. Show the reviewed target, never invented cash legs. */
export function LeverageChangeSummary({ facts, changes = [], receipt = false }: {
  facts: readonly ReviewFact[];
  changes?: readonly { label: string; before: string; after: string }[];
  receipt?: boolean;
}) {
  const target = facts.find(fact => fact.label === 'Target leverage');
  if (!target && !changes.length) return null;
  return <section className={`${styles.amountFlow} ${styles.leverageSummary}`} aria-label="Reviewed leverage change">
    {target && <><span className={styles.flowLabel}>{receipt ? 'Reviewed target leverage' : 'Target leverage'}</span><strong className={styles.leverageTarget}>{target.value}</strong></>}
    {changes.length > 0 && <><p className={styles.flowLabel}>Current → estimated</p><dl>{changes.map(change => <div key={change.label}><dt>{change.label}</dt><dd><details className={styles.leveragePair}><summary aria-label={`Show full reviewed ${change.label.toLowerCase()} values`}><span>{boundedReviewedValue(change.before)}</span><span aria-hidden="true">→</span><span>{boundedReviewedValue(change.after)}</span><ChevronDown size={12} aria-hidden="true" /></summary><p><span>Current at review: {change.before}</span><span>Estimated at review: {change.after}</span></p></details></dd></div>)}</dl></>}
    <p className={styles.leverageCaveat}>{receipt ? 'Reviewed values, not final position balances.' : 'Final values may change.'}</p>
  </section>;
}
