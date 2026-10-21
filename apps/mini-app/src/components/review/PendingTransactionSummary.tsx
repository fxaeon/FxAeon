'use client';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import type { PlanStatus, TransactionStepResult } from '@/lib/fx';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import type { transactionCardIdentity } from './transactionCardIdentity';
import { compactExecutionStatus } from './compactExecution';
import { TransactionHashLink } from './ReviewProgress';
import { hasTransactionHash } from '@/lib/transactionProgress';
import { TransactionAmountFlow } from './TransactionAmountFlow';
import styles from './ActionReviewPresentation.module.css';

export function PendingTransactionSummary({ identity, facts, status, steps, chainId, networkSwitching, nextKind, requestLabel, requestNumber, requestCount, showIdentity = true }: {
  identity: ReturnType<typeof transactionCardIdentity>; facts: readonly ReviewFact[]; status: PlanStatus;
  steps: readonly TransactionStepResult[]; chainId: number; networkSwitching: boolean; nextKind?: string;
  requestLabel?: string; requestNumber?: number; requestCount?: number;
  showIdentity?: boolean;
}) {
  const progress = compactExecutionStatus(status, steps, networkSwitching, nextKind);
  const awaitingWallet = status === 'awaiting-user' && !networkSwitching;
  const uncertain = Boolean(progress.warning) && status !== 'submitted';
  return <section className={styles.pendingSummary} aria-label="Transaction progress">
    <div className={styles.pendingStatus} data-warning={uncertain || undefined} role="status" aria-live="polite">
      <span className={styles.pendingMark} aria-hidden="true">{uncertain ? <CircleAlert size={20} /> : <LoaderCircle size={20} className={styles.pendingSpinner} />}</span>
      <div><strong>{progress.label}</strong>{awaitingWallet && requestLabel && (showIdentity || requestLabel !== identity.name || (requestCount ?? 0) > 1) ? <p>{requestLabel}{requestCount && requestCount > 1 && requestNumber ? ` · step ${requestNumber} of ${requestCount}` : ''}</p> : showIdentity && <p>{identity.name}</p>}{progress.warning && <p className={styles.pendingWarning}>{progress.warning}</p>}</div>
    </div>
    <TransactionAmountFlow facts={facts} chainId={chainId} ariaLabel="Reviewed transaction amounts" />
    {steps.filter(hasTransactionHash).map(step => <TransactionHashLink key={`${step.index}-${step.hash}`} step={step} chainId={chainId} />)}
  </section>;
}
