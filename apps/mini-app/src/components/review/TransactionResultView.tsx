'use client';

import type { CSSProperties, ReactNode, Ref } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TransactionExecutionResult, TransactionStepResult } from '@/lib/fx';
import type { ReceiptPresentation } from '@/lib/receiptPresentation';
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
  bridgeTracker?: ReactNode;
  /** Also the accessible name, so speech and sight name the same action. */
  nextLabel: string;
  onNext: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const ResultIcon = presentation.icon;
  const compactSuccess = result.status === 'confirmed' && presentation.tone === 'success' && !bridgeTracker && result.operation !== 'buildBridgeTx';
  const transactionLinks = result.steps.some(hasTransactionHash) && <div className="flex w-full flex-col gap-2 text-left">
    {result.steps.map((step: TransactionStepResult) => hasTransactionHash(step)
      ? <TransactionHashLink key={`${step.index}-${step.hash}`} step={step} chainId={result.chainId} /> : null)}
  </div>;
  return (
    <div className={`${styles.result} ${compactSuccess ? styles.resultSuccess : ''}`}>
      <span className={styles.resultMark} data-tone={presentation.tone} aria-hidden="true">
        {presentation.tone === 'success'
          // A confirmed receipt draws its check once; nothing else celebrates.
          ? <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="M15.5 27.2 22.6 34.3 37 19.6" /></svg>
          : <ResultIcon className="h-7 w-7" />}
      </span>
      <h3 ref={headingRef} data-review-focus data-result-heading tabIndex={-1} className="text-display mt-4 text-[22px] font-semibold outline-none">{presentation.title}</h3>
      {(!compactSuccess || refreshing && positionAction) && <p className="mt-1.5 max-w-[34ch] text-[14px] leading-snug text-mut">
        {resultBodyDuringRefresh({ status: result.status, refreshing, positionAction, body: presentation.body })}
      </p>}
      {compactSuccess && <ReceiptSummary receipts={receipts} variant="outcome" />}
      {!compactSuccess && <><p className={styles.resultMeta} title={result.walletAddress}>
        {chainName(result.chainId)} · Wallet {compactAddress(result.walletAddress)}
      </p>
      <div className="mt-4 w-full">{transactionLinks}</div>
      <ReceiptSummary receipts={receipts} /></>}
      {newPosition
        ? <NewPositionRow position={newPosition} />
        : positionLabel && <p className={styles.resultMeta}>Position: {positionLabel}</p>}
      {bridgeTracker}
      {compactSuccess && <details className={styles.resultDetails}>
        <summary>Transaction details <ChevronDown aria-hidden="true" className="h-4 w-4 disclosure-chevron" /></summary>
        <p className={styles.resultMeta} title={result.walletAddress}>{chainName(result.chainId)} · {compactAddress(result.walletAddress)}</p>
        <ReceiptSummary receipts={receipts} variant="details" />
        {transactionLinks}
      </details>}
      <Button variant={presentation.tone === 'danger' ? 'ghost' : 'primary'} className={`mt-5 ${flowStyles.primaryAction}`} onClick={onNext}>{nextLabel}</Button>
    </div>
  );
}
