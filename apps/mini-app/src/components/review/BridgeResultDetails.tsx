'use client';

import type { TransactionExecutionResult } from '@/lib/fx';
import type { ReceiptPresentation } from '@/lib/receiptPresentation';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { transactionStepProgress } from '@/lib/transactionProgress';
import { AmountUsd, FeeUsd } from './AmountUsd';
import { BridgeReceiptRow } from './BridgeResultCard';
import { ReviewFactValue } from './ReviewFactValue';
import { useTransactionEvidence } from './TransactionEvidenceContext';
import { TechnicalEvidenceRow } from './TechnicalEvidenceRow';
import styles from './BridgeResultCard.module.css';

/** Flat receipt facts and quoted limits, without another review hero or
 * nested disclosures. Neither quotes nor approval receipts prove delivery. */
export function BridgeResultDetails({ result, receipts, reviewedFacts }: {
  result: TransactionExecutionResult; receipts: readonly ReceiptPresentation[]; reviewedFacts: readonly ReviewFact[];
}) {
  const simulated = useTransactionEvidence() === 'simulation';
  const approvalSteps = result.steps.filter(step => step.transaction.kind === 'approval' && step.hash);
  const fees = receipts.flatMap((receipt, index) => {
    const subject = receipt.transactionKind === 'approval' ? 'Approval' : 'Bridge';
    return [
      receipt.executionFee && { key: `execution-${index}`, label: `${subject} ${result.chainId === 8453 ? 'execution' : 'network'} fee`, value: receipt.executionFee, exact: receipt.exactFees?.execution },
      receipt.l1DataFee && { key: `l1-${index}`, label: `${subject} L1 data fee`, value: receipt.l1DataFee, exact: receipt.exactFees?.l1Data },
      receipt.operatorFee && { key: `operator-${index}`, label: `${subject} operator fee`, value: receipt.operatorFee, exact: receipt.exactFees?.operator },
      receipt.totalExecutionFee && { key: `total-${index}`, label: `${subject} network total`, value: receipt.totalExecutionFee, exact: receipt.exactFees?.total },
      receipt.nativeValue && receipt.nativeValueLabel === 'Bridge fee' && { key: `bridge-${index}`, label: 'Bridge fee sent', value: receipt.nativeValue, exact: receipt.exactNativeValue ?? undefined },
    ].filter((fee): fee is { key: string; label: string; value: string; exact: string | undefined } => Boolean(fee));
  });
  const caveats = [...new Set(receipts.map(receipt => receipt.feeCaveat).filter(Boolean))];
  const facts = reviewedFacts.filter(fact => ['Amount', 'Input amount', 'Estimated received', 'Minimum received', 'Bridge fee'].includes(fact.label));
  const labels: Record<string, string> = { Amount: 'Requested amount', 'Input amount': 'Requested amount', 'Estimated received': 'Quoted output', 'Minimum received': 'Minimum output', 'Bridge fee': 'Quoted bridge fee' };
  return <>
    {approvalSteps.length > 0 && <section className={styles.group} aria-label="Token approval receipts"><h4>Token approval</h4>
      {approvalSteps.map((step, index) => <BridgeReceiptRow key={step.hash} label={approvalSteps.length > 1 ? `Token approval ${index + 1}` : 'Token approval'} chain={result.chainId === 8453 ? 'Base' : 'Ethereum'} hash={step.hash} status={transactionStepProgress(step).label} simulated={simulated} />)}
    </section>}
    {fees.length > 0 && <section className={styles.group} aria-label="Receipt fees"><h4>{simulated ? 'Simulated fees' : 'Receipt costs'}</h4><dl className={styles.facts}>
      {fees.map(fee => <div key={fee.key}><dt>{fee.label}</dt><dd>{fee.value}{fee.exact && <AmountUsd amount={fee.exact} symbol="ETH" receipt />}</dd></div>)}
    </dl>{caveats.map(caveat => <p key={caveat} className={styles.priceNote}>{caveat}</p>)}</section>}
    {facts.length > 0 && <section className={styles.group} aria-label="Reviewed bridge terms"><h4>Reviewed quote · not final amounts</h4><dl className={styles.facts}>
      {facts.map(fact => <div key={fact.label} data-review-fact={fact.label}><dt>{labels[fact.label]}</dt><dd><ReviewFactValue fact={fact} />{fact.label === 'Bridge fee' && <FeeUsd fact={fact} />}</dd></div>)}
    </dl></section>}
    {receipts.flatMap(receipt => receipt.technicalMovements).map((movement, index) => <TechnicalEvidenceRow key={index} label={`Token movement ${index + 1}`} value={movement} preview="View receipt data" />)}
  </>;
}
