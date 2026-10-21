'use client';

import type { ReactNode, Ref } from 'react';
import { ArrowUpRight, Check, ChevronDown } from 'lucide-react';
import type { TransactionExecutionResult, TransactionStepResult } from '@/lib/fx';
import type { ReceiptPresentation } from '@/lib/receiptPresentation';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { TransactionIdentity } from './TransactionIdentity';
import type { transactionCardIdentity } from './transactionCardIdentity';
import { compactTransactionOutcomeModel } from './compactTransactionReceipt';
import { ReviewFactValue } from './ReviewFactValue';
import { useTransactionEvidence } from './TransactionEvidenceContext';
import { BridgeResultDetails } from './BridgeResultDetails';
import { CompactTransactionFooter, hasCompactConfirmedTransaction } from './CompactTransactionFooter';
import { ReviewViewport } from './ReviewViewport';
import { compactAddress } from '@/lib/addressPresentation';
import { hasTransactionHash, transactionExplorerUrl, transactionStepProgress } from '@/lib/transactionProgress';
import { Button } from '@/components/ui';
import { readbackMatchesResult, type ConfirmedPositionReadback } from './positionReview';
import { ReceiptSummary } from '@/components/review/ActionReviewSummary';
import { chainName, TransactionHashLink } from '@/components/review/ReviewProgress';
import styles from './ActionReviewPresentation.module.css';
import flowStyles from '../FlowWorkspace.module.css';
import { compactResultWarning, resultPresentation as executionResultPresentation } from '@/components/review/executionResult';

type ResultPresentation = ReturnType<typeof executionResultPresentation>;

/** A position the confirmed transaction just opened, from its receipt and its review. */
export type NewPositionView = {
  /** "ETH:long:42", the key its row and page use. */
  key: string;
  market: 'ETH' | 'BTC';
  side: 'long' | 'short';
  positionId: number;
  /** The reviewed target leverage, whose split the ticket showed. */
  targetLeverage: number;
};

/** A shortened display always retains the exact receipt value for touch/keyboard users. */
function ResultAmount({ amount, symbol }: { amount: string; symbol: string }) {
  return <ReviewFactValue fact={{ label: 'Receipt amount', value: `${amount} ${symbol}` }} />;
}

export function TransactionResultView({
  result,
  presentation,
  refreshing,
  positionAction,
  positionClosed = false,
  positionLabel,
  newPosition,
  receipts,
  reviewedFacts = [],
  confirmedPosition,
  reviewIdentity,
  bridgeTracker,
  nextLabel,
  onNext,
  headingRef,
}: {
  result: TransactionExecutionResult;
  presentation: ResultPresentation;
  refreshing: boolean;
  positionAction: boolean;
  positionClosed?: boolean;
  positionLabel?: string;
  /** Identity verified from the new position's confirmed receipt. */
  newPosition?: NewPositionView;
  receipts: readonly ReceiptPresentation[];
  reviewedFacts?: readonly ReviewFact[];
  reviewedPositionChanges?: readonly { label: string; before: string; after: string }[];
  confirmedPosition?: ConfirmedPositionReadback | null;
  reviewIdentity?: ReturnType<typeof transactionCardIdentity>;
  bridgeTracker?: (advancedContent: ReactNode, completionContent?: (destinationTxHash: string) => ReactNode) => ReactNode;
  /** Also the accessible name, so speech and sight name the same action. */
  nextLabel: string;
  onNext: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const evidence = useTransactionEvidence();
  const simulated = evidence === 'simulation';
  const confirmedAction = hasCompactConfirmedTransaction(result);
  // An outer confirmed status cannot upgrade missing, reverted, or approval-only proof.
  const safePresentation = result.status === 'confirmed' && !confirmedAction
    ? executionResultPresentation({ ...result, status: result.steps.some(step => step.status === 'confirmed') ? 'partial' : 'failed' }, result.operation === 'buildBridgeTx')
    : presentation;
  const ResultIcon = safePresentation.icon;
  const bridge = result.operation === 'buildBridgeTx';
  const provenSuccess = safePresentation.tone === 'success' && confirmedAction;
  const conciseSuccess = provenSuccess && !bridgeTracker && !bridge;
  const outcome = conciseSuccess ? compactTransactionOutcomeModel(result, receipts, reviewedFacts) : null;
  const receiptedSteps = result.steps.filter(step => hasTransactionHash(step) && step.receipt);
  const verifiedReceipts = receipts.filter((receipt, index) => receiptedSteps.length === receipts.length
    && receipt.transactionKind === receiptedSteps[index]?.transaction.kind && transactionStepProgress(receiptedSteps[index]).state === 'confirmed');
  const exactTokenMovements = verifiedReceipts.flatMap(receipt => receipt.exactMovements ?? []);
  // Never reinterpret compact receipt strings (≈ or <) as exact amounts.
  // A native input and ERC-20 output are distinct observed movements.
  // Include each transaction's native send once, but never a bridge fee.
  const exactMovements = [
    ...verifiedReceipts.flatMap(receipt => receipt.exactNativeValue && receipt.nativeValueLabel === 'Native value sent'
      ? [{ direction: 'sent' as const, amount: receipt.exactNativeValue, symbol: 'ETH' }] : []),
    ...exactTokenMovements,
  ];
  const observedFacts = exactMovements.map(movement => ({ label: movement.direction === 'sent' ? 'Sent' : 'Received', value: `${movement.amount} ${movement.symbol}` }))
    .sort((a, b) => Number(a.label === 'Received') - Number(b.label === 'Received'));
  const targetLeverage = reviewedFacts.find(fact => fact.label === 'Target leverage');
  const queuedWithdrawal = outcome?.queuedWithdrawal ?? false;
  const positionReadback = readbackMatchesResult(confirmedPosition, result) ? confirmedPosition : null;
  const actionReceipts = receipts.filter(receipt => receipt.transactionKind === 'action');
  const noTransferAdjustment = confirmedAction && result.operation === 'adjustPositionLeverage' && actionReceipts.length > 0
    && actionReceipts.every(receipt => receipt.movements.length === 0 && receipt.technicalMovements.length === 0 && !receipt.nativeValue);
  const needsReceiptDetails = Boolean(outcome?.hasTechnicalMovements || outcome?.hasUnresolvedMovements);
  const outcomeTitle = queuedWithdrawal ? 'Withdrawal queued'
    : newPosition ? `${newPosition.market} ${newPosition.side === 'long' ? 'Long' : 'Short'} opened` : safePresentation.title;
  const simulatedTarget = newPosition ? `${newPosition.targetLeverage}×` : targetLeverage?.value;
  // The operation identifies the outcome; the footer and provenance label
  // identify simulation. A reviewed target never becomes achieved leverage.
  const subtitle = simulated ? `${simulatedTarget ? `Target ${simulatedTarget}` : 'Simulation'} · ${chainName(result.chainId)}`
    : newPosition ? `Position #${newPosition.positionId} · ${chainName(result.chainId)}`
    : positionLabel ? `${positionLabel} · ${chainName(result.chainId)}`
    : queuedWithdrawal ? `fxSAVE · ${chainName(result.chainId)}` : chainName(result.chainId);
  const submitted = result.steps.filter(hasTransactionHash);
  const lastSubmitted = [...submitted].reverse().find(step => step.transaction.kind === 'action') ?? submitted.at(-1);
  const recoveryExplorer = simulated || !lastSubmitted ? null : transactionExplorerUrl(result.chainId, lastSubmitted.hash);
  const transactionLinks = result.steps.some(hasTransactionHash) && <div className="flex w-full flex-col gap-2 text-left">
    {result.steps.map((step: TransactionStepResult) => hasTransactionHash(step)
      ? <TransactionHashLink key={`${step.index}-${step.hash}`} step={step} chainId={result.chainId} /> : null)}
  </div>;
  const readbackSection = positionReadback && <section className={styles.positionReadback} aria-label="Latest position read" data-position-readback="verified">
    <p>{simulated ? 'Simulated position' : 'Position'} #{positionReadback.key.split(':')[2]} · post-confirmation read</p>
    <dl>{positionReadback.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd><ReviewFactValue fact={fact} /></dd></div>)}</dl>
  </section>;
  const recoveryWarning = compactResultWarning(safePresentation);
  const advancedContent = bridge ? <BridgeResultDetails result={result} receipts={receipts} reviewedFacts={reviewedFacts} /> : <>
    <p className={styles.resultMeta} title={result.walletAddress}>{chainName(result.chainId)} · {compactAddress(result.walletAddress)}</p>
    {observedFacts.length > 0 && <p className={styles.reviewExplanation}>{simulated ? 'Amounts are simulated.' : 'Amounts are from verified receipts.'} USD uses current prices, not receipt-time prices.</p>}
    <ReceiptSummary receipts={receipts} variant="details" />
    {readbackSection}
    {!conciseSuccess && transactionLinks && <section className={styles.receiptLinks} aria-label="Transaction receipts">{transactionLinks}</section>}
    {reviewedFacts.length > 0 && <section className={styles.advancedGroup} aria-label="Reviewed terms"><p className={styles.advancedGroupLabel}>Reviewed terms</p><p className={styles.resultStatNote}>Reviewed amounts, not final outcomes.</p><dl>{reviewedFacts.map((fact, index) => <div className={styles.resultStatRow} key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd><ReviewFactValue fact={fact} /></dd></div>)}</dl></section>}
  </>;
  return (
    <ReviewViewport phase="result">
      <div data-review-scroll className={styles.reviewScrollBody} role="region" aria-label="Transaction result" tabIndex={0}>
        <div className={`${styles.result} ${conciseSuccess ? styles.resultSuccess : ''}`}>
          {conciseSuccess && outcome && <>
            <div className={styles.resultHeading}>
              <span className={styles.resultHeadingIcon} aria-hidden="true"><Check size={23} /></span>
              <div className={styles.resultHeadingCopy}>
                <h3 ref={headingRef} data-review-focus tabIndex={-1} aria-label={simulated ? `Simulated result: ${outcomeTitle}` : undefined}>{outcomeTitle}</h3>
                <p>{subtitle}</p>
              </div>
            </div>
            {(outcome.rows.length > 0 || queuedWithdrawal) && <dl className={styles.resultStats} aria-label={simulated ? 'Simulated token movements' : 'Confirmed transaction amounts'} data-amount-provenance={simulated ? 'simulation' : 'receipt'}>
              {outcome.rows.map((row, index) => <div className={styles.resultStatRow} key={`${row.direction}-${row.symbol}-${index}`} data-review-fact={row.direction === 'sent' ? 'Sent' : 'Received'}>
                <dt>{row.label}</dt><dd><ResultAmount amount={row.amount} symbol={row.symbol} /></dd>
              </div>)}
              {queuedWithdrawal && <div className={styles.resultStatRow}><dt>Claim status</dt><dd>Check live status</dd></div>}
            </dl>}
            {!outcome.rows.length && !queuedWithdrawal && <dl className={styles.resultPositionStatus}><dt>{noTransferAdjustment ? 'Token transfers' : 'Token amounts'}</dt><dd>{noTransferAdjustment ? 'None' : 'Unavailable'}</dd></dl>}
            {needsReceiptDetails && <dl className={styles.resultPositionStatus}><dt>Additional movements</dt><dd>See details</dd></dl>}
            {queuedWithdrawal && <dl className={styles.resultPositionStatus} role="status"><dt>Payout</dt><dd>After cooldown</dd></dl>}
            {refreshing && !positionAction && <dl className={styles.resultPositionStatus} role="status"><dt>Balances</dt><dd>Refreshing</dd></dl>}
            {positionAction && !positionClosed && <dl className={styles.resultPositionStatus} aria-label="Position read status" data-position-readback={positionReadback ? 'verified' : refreshing ? 'refreshing' : 'unavailable'} role="status"><dt>{positionReadback ? `Position #${positionReadback.key.split(':')[2]}` : newPosition ? `Position #${newPosition.positionId}` : 'Position values'}</dt><dd>{positionReadback ? 'Updated' : refreshing ? 'Refreshing' : 'Unavailable'}</dd></dl>}
            <CompactTransactionFooter result={result} receipts={receipts} />
          </>}
          {bridgeTracker?.(advancedContent, provenSuccess ? destinationTxHash => <CompactTransactionFooter result={result} receipts={receipts} headingRef={headingRef} destinationReceipt={{ chainId: result.chainId === 1 ? 8453 : 1, hash: destinationTxHash }} /> : undefined)}
          {!bridgeTracker && !conciseSuccess && <section className={styles.resultRecoveryStatus} aria-label="Transaction status">
            <div className={styles.resultStatus} data-tone={safePresentation.tone}>
              <span className={styles.resultMark} data-tone={safePresentation.tone} aria-hidden="true"><ResultIcon className="h-6 w-6" /></span>
              <div><h3 ref={headingRef} data-review-focus tabIndex={-1}>{safePresentation.title}</h3>
                {recoveryWarning && <p>{recoveryWarning}</p>}
              </div>
            </div>
            {lastSubmitted && <div className={styles.resultStatusLinks}><span>{simulated ? 'Simulation submitted' : lastSubmitted.transaction.kind === 'approval' ? 'Approval submitted' : 'Transaction submitted'}</span>{recoveryExplorer
              ? <a href={recoveryExplorer} target="_blank" rel="noopener noreferrer">View on explorer <ArrowUpRight size={13} aria-hidden="true" /></a>
              : <span>{simulated ? 'No on-chain link' : 'Explorer unavailable'}</span>}</div>}
          </section>}
          {!bridgeTracker && !bridge && !conciseSuccess && <>
            {exactMovements.length > 0 && <section className={styles.resultStats} aria-label={simulated ? 'Earlier simulated steps' : 'Already confirmed movements'} data-amount-provenance={simulated ? 'simulation' : 'receipt'}>
              <p className={styles.resultStatNote}>{simulated ? 'Earlier simulated steps' : 'Already confirmed · earlier steps only'}</p>
              <dl>{exactMovements.map((movement, index) => <div className={styles.resultStatRow} key={`${movement.direction}-${movement.symbol}-${index}`}><dt>{movement.direction === 'sent' ? 'Already sent' : 'Already received'}</dt><dd><ResultAmount amount={movement.amount} symbol={movement.symbol} /></dd></div>)}</dl>
            </section>}
            {reviewIdentity && <TransactionIdentity {...reviewIdentity} />}

          </>}
          {!bridgeTracker && <details className={styles.resultDetails}>
            <summary>Execution details <ChevronDown aria-hidden="true" className="h-4 w-4 disclosure-chevron" /></summary>
            {advancedContent}
          </details>}
        </div>
      </div>
      <div data-review-actions className={`${flowStyles.reviewInlineActions} ${styles.actions}`}>
        <Button variant={safePresentation.tone === 'danger' ? 'ghost' : 'primary'} className={flowStyles.primaryAction} onClick={onNext}>{nextLabel}</Button>
      </div>
    </ReviewViewport>
  );
}
