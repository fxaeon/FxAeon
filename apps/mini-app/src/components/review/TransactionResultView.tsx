'use client';

import type { CSSProperties, ReactNode, Ref } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TransactionExecutionResult, TransactionStepResult } from '@/lib/fx';
import { receiptMovementLines, type ReceiptPresentation } from '@/lib/receiptPresentation';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { TransactionAmountFlow, LeverageChangeSummary } from './TransactionAmountFlow';
import { transactionAmountFacts } from './transactionAmountPresentation';
import { BridgeResultDetails } from './BridgeResultDetails';
import { CompactTransactionFooter, hasCompactConfirmedTransaction } from './CompactTransactionFooter';
import { ReviewViewport } from './ReviewViewport';
import { compactAddress } from '@/lib/addressPresentation';
import { hasTransactionHash } from '@/lib/transactionProgress';
import { debtShare } from '@/lib/leverageShare';
import { positionSideLabel } from '@/lib/positionNaming';
import { Button } from '@/components/ui';
import TokenIcon from '@/components/TokenIcon';
import { ReceiptSummary } from '@/components/review/ActionReviewSummary';
import { chainName, TransactionHashLink } from '@/components/review/ReviewProgress';
import styles from './ActionReviewPresentation.module.css';
import flowStyles from '../FlowWorkspace.module.css';
import rowStyles from '../ProtocolPositionCard.module.css';
import { resultBodyDuringRefresh, type resultPresentation } from '@/components/review/executionResult';

type ResultPresentation = ReturnType<typeof resultPresentation>;

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

/**
 * The new position as its row will show it: token, name and number, the
 * target it was opened at, and the split chosen on the ticket in the row's own
 * colours. The bar is that choice, labelled by its target; the row it becomes
 * on the position's page is drawn from the confirmed read (see lib/positionBorn).
 */
function NewPositionRow({ position }: { position: NewPositionView }) {
  return (
    <div className={styles.newPosition}>
      <p className={styles.newPositionLine}>
        <span className={styles.newPositionToken} aria-hidden="true"><TokenIcon symbol={position.market === 'ETH' ? 'ETH' : 'WBTC'} size={24} /></span>
        <span className={styles.newPositionName}>
          {position.market} <span className={position.side === 'long' ? rowStyles.long : rowStyles.short}>{positionSideLabel(position.side)}</span>
          <span className={styles.newPositionId}> · #{position.positionId}</span>
        </span>
        <span className={styles.newPositionTarget} title="Target leverage"><b>{position.targetLeverage}×</b> target</span>
      </p>
      <span
        className={rowStyles.split}
        aria-hidden="true"
        data-position-born-source={position.key}
        style={{ '--debt-share': debtShare(position.side, position.targetLeverage) } as CSSProperties}
      >
        <span className={rowStyles.splitTrack}><i className={rowStyles.splitDebt} /><i className={rowStyles.splitShare} /></span>
      </span>
    </div>
  );
}

export function TransactionResultView({
  result,
  presentation,
  refreshing,
  positionAction,
  positionLabel,
  newPosition,
  receipts,
  reviewedFacts = [],
  reviewedPositionChanges = [],
  bridgeTracker,
  nextLabel,
  onNext,
  headingRef,
}: {
  result: TransactionExecutionResult;
  presentation: ResultPresentation;
  refreshing: boolean;
  positionAction: boolean;
  positionLabel?: string;
  /** Drawn as its row in place of the position caption. */
  newPosition?: NewPositionView;
  receipts: readonly ReceiptPresentation[];
  reviewedFacts?: readonly ReviewFact[];
  reviewedPositionChanges?: readonly { label: string; before: string; after: string }[];
  bridgeTracker?: (advancedContent: ReactNode, completionContent?: (destinationTxHash: string) => ReactNode) => ReactNode;
  /** Also the accessible name, so speech and sight name the same action. */
  nextLabel: string;
  onNext: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const ResultIcon = presentation.icon;
  const compactSuccess = result.status === 'confirmed' && presentation.tone === 'success' && !bridgeTracker && result.operation !== 'buildBridgeTx';
  const bridge = result.operation === 'buildBridgeTx';
  const provenSuccess = presentation.tone === 'success' && hasCompactConfirmedTransaction(result);
  const conciseSuccess = provenSuccess && !bridgeTracker && !bridge;
  const receiptLines = receiptMovementLines(receipts).movements;
  const exactTokenMovements = receipts.flatMap(receipt => receipt.exactMovements ?? []);
  // Never reinterpret compact receipt strings (≈ or <) as exact amounts.
  // A native input and ERC-20 output are distinct observed movements.
  // Include each transaction's native send once, but never a bridge fee.
  const exactMovements = [
    ...receipts.flatMap(receipt => receipt.exactNativeValue && receipt.nativeValueLabel === 'Native value sent'
      ? [{ direction: 'sent' as const, amount: receipt.exactNativeValue, symbol: 'ETH' }] : []),
    ...exactTokenMovements,
  ];
  const observedFacts = exactMovements.map(movement => ({ label: movement.direction === 'sent' ? 'Sent' : 'Received', value: `${movement.amount} ${movement.symbol}` }))
    .sort((a, b) => Number(a.label === 'Received') - Number(b.label === 'Received'));
  const reviewedAmounts = transactionAmountFacts(reviewedFacts);
  const queuedWithdrawal = result.status === 'confirmed' && reviewedFacts.some(fact => fact.label === 'Availability' && /cooldown/i.test(fact.value));
  const actionReceipts = receipts.filter(receipt => receipt.transactionKind === 'action');
  const noTransferAdjustment = result.status === 'confirmed' && result.operation === 'adjustPositionLeverage' && actionReceipts.length > 0
    && actionReceipts.every(receipt => receipt.movements.length === 0 && receipt.technicalMovements.length === 0 && !receipt.nativeValue);
  const transactionLinks = result.steps.some(hasTransactionHash) && <div className="flex w-full flex-col gap-2 text-left">
    {result.steps.map((step: TransactionStepResult) => hasTransactionHash(step)
      ? <TransactionHashLink key={`${step.index}-${step.hash}`} step={step} chainId={result.chainId} /> : null)}
  </div>;
  const advancedContent = bridge ? <BridgeResultDetails result={result} receipts={receipts} reviewedFacts={reviewedFacts} /> : <>
          <p className={styles.resultMeta} title={result.walletAddress}>{chainName(result.chainId)} · {compactAddress(result.walletAddress)}</p>
          {observedFacts.length > 0 && <p className={styles.reviewExplanation}>Amounts are from verified receipts. USD uses current prices, not receipt-time prices.</p>}
          <ReceiptSummary receipts={receipts} variant="details" />
          {observedFacts.length > 0 && reviewedAmounts.length > 0 && <section className={styles.advancedGroup} aria-label="Reviewed estimates"><p className={styles.advancedGroupLabel}>Reviewed estimates</p><TransactionAmountFlow facts={reviewedAmounts} chainId={result.chainId} caption="Reviewed amounts, not final outcomes." /></section>}
  </>;
  return (
    <ReviewViewport phase="result">
      <div data-review-scroll className={styles.reviewScrollBody} role="region" aria-label="Transaction result" tabIndex={0}>
      <div className={`${styles.result} ${compactSuccess ? styles.resultSuccess : ''}`}>
        {bridgeTracker ? null : bridge ? null : observedFacts.length ? <TransactionAmountFlow facts={observedFacts} chainId={result.chainId} receipt />
          : result.operation === 'adjustPositionLeverage' ? <LeverageChangeSummary facts={reviewedFacts} changes={reviewedPositionChanges} receipt />
          : <TransactionAmountFlow facts={reviewedAmounts} chainId={result.chainId} caption={result.status === 'confirmed' ? 'Reviewed amounts · final token movements unavailable' : 'Reviewed amounts · action not completed'} />}
        {bridgeTracker?.(advancedContent, provenSuccess ? destinationTxHash => <CompactTransactionFooter result={result} receipts={receipts} headingRef={headingRef} destinationReceipt={{ chainId: result.chainId === 1 ? 8453 : 1, hash: destinationTxHash }} /> : undefined)}
        {!bridgeTracker && !conciseSuccess && <div className={styles.resultStatus} data-tone={presentation.tone}>
          <span className={styles.resultMark} data-tone={presentation.tone} aria-hidden="true"><ResultIcon className="h-6 w-6" /></span>
          <div><h3 ref={headingRef} data-review-focus tabIndex={-1}>{presentation.title}</h3>
            {(!compactSuccess || refreshing || queuedWithdrawal || noTransferAdjustment) && <p>{queuedWithdrawal ? 'No payout yet. Claim your fxUSD and/or USDC after the cooldown.' : noTransferAdjustment ? refreshing ? 'Transaction confirmed. Position details are refreshing.' : 'No wallet token transfer appears in this receipt.' : resultBodyDuringRefresh({ status: result.status, refreshing, positionAction, body: presentation.body })}</p>}
          </div>
        </div>}
        {!bridge && !observedFacts.length && receiptLines.length > 0 && <div className={styles.receiptFallback} aria-label="Reported receipt movements">{receiptLines.map((line, index) => <p key={index}>{conciseSuccess && line === 'Token movement available in technical details' ? 'View token movement in the transaction explorer' : line}</p>)}</div>}
        {!conciseSuccess && (newPosition ? <NewPositionRow position={newPosition} /> : positionLabel && <p className={styles.resultMeta}>Position: {positionLabel}</p>)}
        {!bridgeTracker && !conciseSuccess && transactionLinks && <section className={styles.receiptLinks} aria-label="Transaction receipts">{transactionLinks}</section>}
        {conciseSuccess && <>
          {(queuedWithdrawal || refreshing) && <p className={styles.claimCaveat} role="status">{queuedWithdrawal ? 'No payout yet. Claim your fxUSD and/or USDC after the cooldown.' : 'Position details are refreshing.'}</p>}
          <CompactTransactionFooter result={result} receipts={receipts} headingRef={headingRef} />
        </>}
        {!bridgeTracker && !conciseSuccess && <details className={styles.resultDetails}>
          <summary>Advanced <ChevronDown aria-hidden="true" className="h-4 w-4 disclosure-chevron" /></summary>
          {advancedContent}
        </details>}
      </div>
      </div>
      <div data-review-actions className={`${flowStyles.reviewInlineActions} ${styles.actions}`}>
        <Button variant={presentation.tone === 'danger' ? 'ghost' : 'primary'} className={flowStyles.primaryAction} onClick={onNext}>{nextLabel}</Button>
      </div>
    </ReviewViewport>
  );
}
