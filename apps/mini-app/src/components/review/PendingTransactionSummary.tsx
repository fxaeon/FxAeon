'use client';
import { ArrowUpRight } from 'lucide-react';
import type { PlanStatus, TransactionStepResult } from '@/lib/fx';
import { openExternalLink } from '@/lib/telegram';
import { hasTransactionHash, transactionExplorerUrl, transactionStepKind, transactionStepProgress } from '@/lib/transactionProgress';
import { compactExecutionStatus } from './compactExecution';
import { chainName } from './ReviewProgress';
import { useTransactionEvidence } from './TransactionEvidenceContext';
import { TransactionStatusMark, statusMarkState, useSubmittedElapsed } from './TransactionStatusMark';
import styles from './TransactionProgress.module.css';

/**
 * The review's action, once pressed, becomes its progress: the button turns
 * into a status pill in place, and only what the runner reports changes it.
 */
export function PendingTransactionSummary({ status, steps, chainId, networkSwitching, nextKind, heading, requestLabel, requestNumber, requestCount }: {
  status: PlanStatus; steps: readonly TransactionStepResult[]; chainId: number; networkSwitching: boolean; nextKind?: string;
  /** The hero's title; a request that only repeats it is not said twice. */
  heading?: string;
  requestLabel?: string; requestNumber?: number; requestCount?: number;
}) {
  const progress = compactExecutionStatus(status, steps, networkSwitching, nextKind);
  const awaitingWallet = status === 'awaiting-user' && !networkSwitching;
  const mark = statusMarkState(status, steps, networkSwitching);
  const waitingHash = steps.find(step => hasTransactionHash(step) && ['submitted', 'included', 'confirming'].includes(step.status))?.hash;
  // Real time since submission; hidden from the live region so it is never announced each second.
  const elapsed = useSubmittedElapsed(mark === 'pending' ? waitingHash : undefined);
  const steppedRequest = Boolean(requestCount && requestCount > 1 && requestNumber);
  const request = awaitingWallet && requestLabel && (steppedRequest || requestLabel !== heading)
    ? `${requestLabel}${steppedRequest ? ` · step ${requestNumber} of ${requestCount}` : ''}` : undefined;
  const note = request ?? progress.warning;
  return <section className={styles.progress} aria-label="Transaction progress" data-pending-state={mark}>
    <div className={styles.status} role="status" aria-live="polite">
      <div className={styles.pill}>
        <TransactionStatusMark state={mark} />
        {/* Re-keyed per label, so each real status change slides in once. */}
        <span key={progress.label} className={styles.label}><span className={styles.labelText}>{progress.label}</span>{elapsed && <span className={styles.elapsed} aria-hidden="true">{elapsed}</span>}</span>
      </div>
      {note && <p key={note} className={styles.note} data-warning={!request && Boolean(progress.warning) || undefined}>{note}</p>}
    </div>
    <ExplorerLinks steps={steps} chainId={chainId} />
  </section>;
}

/** One quiet link per submitted step; a hash proves submission, never success. */
function ExplorerLinks({ steps, chainId }: { steps: readonly TransactionStepResult[]; chainId: number }) {
  const simulated = useTransactionEvidence() === 'simulation';
  const submitted = steps.filter(hasTransactionHash);
  if (!submitted.length) return null;
  if (simulated) return <p className={styles.links}>Simulated · no on-chain link</p>;
  const explorer = chainId === 8453 ? 'Basescan' : 'Etherscan';
  return <p className={styles.links}>{submitted.map(step => {
    const url = transactionExplorerUrl(chainId, step.hash);
    if (!url) return null;
    const kind = transactionStepKind(step);
    return <a key={`${step.index}-${step.hash}`} href={url} target="_blank" rel="noopener noreferrer"
      aria-label={`${kind} ${step.index + 1}: ${transactionStepProgress(step).label}. View transaction ${step.hash} on ${chainName(chainId)} explorer (opens in a new tab)`}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (openExternalLink(url)) event.preventDefault();
      }}>
      {submitted.length > 1 ? `${kind === 'Approval' ? 'Approval' : 'Transaction'} on ${explorer}` : `View on ${explorer}`}<ArrowUpRight size={14} aria-hidden="true" />
    </a>;
  })}</p>;
}
