'use client';

import { groupDigits } from '@/lib/amount';
import { TokenIcon } from '@/components/TokenIcon';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { AmountUsd } from './AmountUsd';
import { plainAmountLabel, tokenAmountParts } from './transactionAmountPresentation';
import { readableReviewAmount } from './reviewHierarchy';
import styles from './ActionReviewPresentation.module.css';

/** Accepted transaction identity beside its input. This is never a wallet balance. */
export function TransactionIdentity({ name, subtitle, symbol, amount, amountLabel, secondary, value }: {
  name: string; subtitle: string; symbol?: string; amount?: ReviewFact; amountLabel?: string; secondary?: string; value?: string;
}) {
  const parts = amount && tokenAmountParts(amount);
  const display = parts && readableReviewAmount(parts.amount);
  return <section className={styles.transactionIdentity} aria-label="Transaction summary" data-amount-provenance="review">
    <div className={styles.identityLeft}>
      {symbol && <span className={styles.identityToken}><TokenIcon symbol={symbol} size={42} /></span>}
      <div className={styles.identityCopy}><h4>{name}</h4><p>{subtitle}</p></div>
    </div>
    <div className={styles.identityAmount} data-review-fact={amount?.label}>
      <span className={styles.identityAmountLabel}>{amountLabel ?? (amount ? plainAmountLabel(amount.label) : '')}</span>
      {amount ? <details className={styles.identityExact}>
        <summary aria-label={`Show full reviewed amount: ${amount.title ?? amount.value}`}>
          <span>{parts && display ? `${parts.approximate || display.shortened ? '≈ ' : ''}${groupDigits(display.value.replace(/,/g, ''))} ${parts.symbol}` : amount.value}</span>
        </summary>
        <p>{amount.title ?? amount.value}</p>
      </details> : value && <strong>{value}</strong>}
      {secondary ? <span className={styles.identitySecondary}>{secondary}</span> : parts && <AmountUsd amount={parts.amount} symbol={parts.symbol} />}
    </div>
  </section>;
}
