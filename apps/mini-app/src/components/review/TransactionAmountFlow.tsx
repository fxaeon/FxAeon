'use client';
import { ArrowDown, Plus } from 'lucide-react';
import { TokenIcon, ChainIcon } from '@/components/TokenIcon';
import type { PairedPositionFact } from './actionReviewModel';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { AmountCounterpart, AmountFigure, useLeadingUsdFigures } from './AmountUsd';
import { groupDigits } from '@/lib/amount';
import { plainAmountLabel, tokenAmountParts } from './transactionAmountPresentation';
import { formatReviewFactValue } from './reviewFactFormatting';
import { readableReviewAmount } from './reviewHierarchy';
import styles from './ActionReviewPresentation.module.css';
import compactStyles from './TransactionAmountFlow.module.css';

/** The same amount-led presentation for reviewed intent and observed transfers. */
export function TransactionAmountFlow({ facts, chainId, caption, receipt = false, simulated = false, ariaLabel, labels, showNetwork = true, embedded = false, compact = false }: {
  facts: readonly ReviewFact[]; chainId: number; caption?: string; receipt?: boolean; simulated?: boolean;
  ariaLabel?: string; labels?: Readonly<Record<string, string>>;
  showNetwork?: boolean;
  embedded?: boolean;
  /** Review-only density; pending and receipt presentations keep their rhythm. */
  compact?: boolean;
}) {
  // Size the pair by the figures actually shown: USD figures, while they lead, are usually the longer.
  const usdFigures = useLeadingUsdFigures(facts.map(fact => tokenAmountParts(fact) ?? { amount: '', symbol: '' }));
  if (!facts.length) return null;
  const dense = compact && !receipt;
  // Both sides use the same type scale so their baselines remain aligned.
  const longPair = dense && facts.length === 2 && facts.some((fact, index) => {
    const parts = tokenAmountParts(fact);
    return parts && !usdFigures[index] && groupDigits(readableReviewAmount(parts.amount).value.replace(/,/g, '')).length > 6;
  });
  const widePair = dense && facts.length === 2 && facts.some((fact, index) => {
    const parts = tokenAmountParts(fact);
    if (!parts) return false;
    if (usdFigures[index]) return usdFigures[index]!.length > 9;
    const display = readableReviewAmount(parts.amount);
    return `${display.shortened || parts.approximate ? '≈ ' : ''}${groupDigits(display.value.replace(/,/g, ''))} ${parts.symbol}`.length > 14;
  });
  const densityClass = (base: string, condensed: string) => dense ? `${base} ${condensed}` : base;
  return <section className={`${styles.amountFlow} ${embedded ? styles.amountFlowEmbedded : ''} ${dense ? compactStyles.compact : ''}`} data-compact-amounts={dense ? facts.length : undefined} data-compact-long={longPair || undefined} data-compact-wide={widePair || undefined} aria-label={ariaLabel ?? (receipt ? 'Observed token movements' : 'Transaction amounts')} data-amount-provenance={simulated ? 'simulation' : receipt ? 'receipt' : 'review'}>
    {caption && <p className={styles.flowCaption}>{caption}</p>}
    {facts.map((fact, index) => {
      const parts = tokenAmountParts(fact);
      if (!parts) return null;
      const display = readableReviewAmount(parts.amount);
      const figure = groupDigits(display.value.replace(/,/g, ''));
      const approximate = display.shortened || parts.approximate ? '≈ ' : '';
      const amountLabel = labels?.[fact.label] ?? plainAmountLabel(fact.label);
      const role = dense && facts.length === 1 ? amountLabel : amountCaption(amountLabel, dense);
      const network = chainId === 8453 ? 'Base' : chainId === 1 ? 'Ethereum' : `chain ${chainId}`;
      const token = <span className={densityClass(styles.flowToken, compactStyles.token)} aria-hidden="true"><TokenIcon symbol={parts.symbol} size={dense ? 16 : 40} />{index === 0 && showNetwork && (chainId === 1 || chainId === 8453) && <span><ChainIcon chainId={chainId} size={dense ? 8 : 15} /></span>}</span>;
      return <div key={`${fact.label}-${index}`} className={dense ? compactStyles.leg : undefined}>
        {index > 0 && (facts[index - 1].label === fact.label || facts.every(item => item.label.startsWith('Minimum received (') || /^Estimated (fxUSD|USDC) payout$/.test(item.label)) ? <Plus className={densityClass(styles.flowArrow, compactStyles.connector)} size={16} aria-hidden="true" /> : <ArrowDown className={densityClass(styles.flowArrow, compactStyles.connector)} size={18} aria-hidden="true" />)}
        <div className={densityClass(styles.flowAmount, compactStyles.amount)} data-review-fact={fact.label}>
          {(!dense || widePair) && token}
          <div className={densityClass(styles.flowValue, compactStyles.value)}>
            <div className={densityClass(styles.flowExact, compactStyles.exact)}>
              {dense && !widePair && <span className={compactStyles.heading}>{token}<span className={compactStyles.role}>{role}</span></span>}
              <span data-long={longPair || figure.length > 9 || undefined} data-extended={display.value.length > 15 || undefined} data-review-amount={dense ? '' : undefined}><AmountFigure amount={parts.amount} symbol={parts.symbol}>{approximate}{figure} <span className={styles.flowUnit}>{parts.symbol}</span></AmountFigure></span>
            </div>
            <div className={densityClass(styles.flowSubline, compactStyles.meta)}>{(!dense || widePair) && <><span>{role}</span><span aria-hidden="true">·</span></>}<AmountCounterpart amount={parts.amount} symbol={parts.symbol} token={`${approximate}${figure} ${parts.symbol}`} fallback={dense ? '—' : undefined} />{index === 0 && showNetwork && <span data-network className={compactStyles.network}>{network}</span>}</div>
          </div>
        </div>
      </div>;
    })}
  </section>;
}

/** The token is already beside the amount; this line describes its role. */
function amountCaption(label: string, showRole = false): string {
  if (label === 'You receive · estimated') return showRole ? 'Receive · est.' : 'Estimated';
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
    {changes.length > 0 && <><p className={styles.flowLabel}>Current → estimated</p><dl>{changes.map(change => <div key={change.label}><dt>{change.label}</dt><dd className={styles.leveragePair}><span>{boundedReviewedValue(change.before)}</span><span aria-hidden="true">→</span><span>{boundedReviewedValue(change.after)}</span></dd></div>)}</dl></>}

  </section>;
}
