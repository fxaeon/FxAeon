'use client';
import { ArrowDown, Plus } from 'lucide-react';
import { TokenIcon, ChainIcon } from '@/components/TokenIcon';
import type { PairedPositionFact } from './actionReviewModel';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { AmountUsd } from './AmountUsd';
import { groupDigits } from '@/lib/amount';
import { plainAmountLabel, tokenAmountParts } from './transactionAmountPresentation';
import { formatReviewFactValue } from './reviewFactFormatting';
import { readableReviewAmount } from './reviewHierarchy';
import styles from './ActionReviewPresentation.module.css';

/** The same amount-led presentation for reviewed intent and observed transfers. */
export function TransactionAmountFlow({ facts, chainId, caption, receipt = false, simulated = false, ariaLabel, labels, showNetwork = true, embedded = false }: {
  facts: readonly ReviewFact[]; chainId: number; caption?: string; receipt?: boolean; simulated?: boolean;
  ariaLabel?: string; labels?: Readonly<Record<string, string>>;
  showNetwork?: boolean;
  embedded?: boolean;
}) {
  if (!facts.length) return null;
  return <section className={`${styles.amountFlow} ${embedded ? styles.amountFlowEmbedded : ''}`} aria-label={ariaLabel ?? (receipt ? 'Observed token movements' : 'Transaction amounts')} data-amount-provenance={simulated ? 'simulation' : receipt ? 'receipt' : 'review'}>
    {caption && <p className={styles.flowCaption}>{caption}</p>}
    {facts.map((fact, index) => {
      const parts = tokenAmountParts(fact);
      if (!parts) return null;
      const display = readableReviewAmount(parts.amount);
      const estimate = !receipt && fact.label.startsWith('Estimated');
      return <div key={`${fact.label}-${index}`}>
        {index > 0 && (facts[index - 1].label === fact.label || facts.every(item => item.label.startsWith('Minimum received (') || /^Estimated (fxUSD|USDC) payout$/.test(item.label)) ? <Plus className={styles.flowArrow} size={16} aria-hidden="true" /> : <ArrowDown className={styles.flowArrow} size={18} aria-hidden="true" />)}
        <div className={styles.flowAmount} data-review-fact={fact.label}>
          <span className={styles.flowToken} aria-hidden="true"><TokenIcon symbol={parts.symbol} size={40} />{index === 0 && showNetwork && (chainId === 1 || chainId === 8453) && <span><ChainIcon chainId={chainId} size={15} /></span>}</span>
          <div className={styles.flowValue}>
            <details className={styles.flowExact}><summary data-long={display.value.length > 15 || undefined} aria-label={`Show ${estimate ? 'full estimate' : `${parts.exact ? 'exact' : 'full'} amount`}: ${parts.amount} ${parts.symbol}`}><span>{display.shortened || parts.approximate ? '≈ ' : ''}{groupDigits(display.value.replace(/,/g, ''))} <span className={styles.flowUnit}>{parts.symbol}</span></span></summary><p><span>{estimate ? 'Unrounded estimate' : `${parts.exact ? 'Exact' : 'Reported'} ${simulated ? 'simulated' : receipt ? 'receipt' : 'reviewed'} amount`}</span><span className={styles.selectableAmount}>{fact.title ?? fact.value}</span></p></details>
            <div className={styles.flowSubline}><span>{amountCaption(labels?.[fact.label] ?? plainAmountLabel(fact.label))}</span><span aria-hidden="true">·</span><AmountUsd amount={parts.amount} symbol={parts.symbol} receipt={receipt} />{index === 0 && showNetwork && <><span aria-hidden="true">·</span><span>{chainId === 8453 ? 'Base' : chainId === 1 ? 'Ethereum' : `chain ${chainId}`}</span></>}</div>
          </div>
        </div>
      </div>;
    })}
  </section>;
}

/** The token is already beside the amount; this line describes its role. */
function amountCaption(label: string): string {
  if (label === 'You receive · estimated') return 'Estimated';
  if (/^(?:fxUSD|USDC) payout · estimated$/.test(label)) return 'Estimated payout';
  if (label === 'You receive · minimum' || /^(?:fxUSD|USDC) · minimum$/.test(label)) return 'Minimum received';
  const caption = label.replace(/^You /, '');
  return caption.charAt(0).toUpperCase() + caption.slice(1);
}

function boundedReviewedValue(value: string): string {
  return formatReviewFactValue({ label: 'Position value', value }).display;
}

/** Position consequences are not wallet transfers. Show the reviewed target, never invented cash legs. */
export function LeverageChangeSummary({ facts, changes = [], receipt = false }: {
  facts: readonly ReviewFact[];
  changes?: readonly PairedPositionFact[];
  receipt?: boolean;
}) {
  const target = facts.find(fact => fact.label === 'Target leverage');
  if (!target && !changes.length) return null;
  return <section className={`${styles.amountFlow} ${styles.leverageSummary}`} aria-label="Reviewed leverage change">
    {target && <><span className={styles.flowLabel}>{receipt ? 'Reviewed target leverage' : 'Target leverage'}</span><strong className={styles.leverageTarget}>{target.value}</strong></>}
    {changes.length > 0 && <><p className={styles.flowLabel}>Current → estimated</p><dl>{changes.map(change => <div key={change.label}><dt>{change.label}</dt><dd><details className={styles.leveragePair}><summary aria-label={`Show full reviewed ${change.label.toLowerCase()} values`}><span>{boundedReviewedValue(change.before)}</span><span aria-hidden="true">→</span><span>{boundedReviewedValue(change.after)}</span></summary><p><span>Current at review: {change.before}{change.beforeTitle && change.beforeTitle !== change.before && <><br />Source detail: {change.beforeTitle}</>}</span><span>Estimated at review: {change.after}{change.afterTitle && change.afterTitle !== change.after && <><br />Estimate detail: {change.afterTitle}</>}</span></p></details></dd></div>)}</dl></>}

  </section>;
}
