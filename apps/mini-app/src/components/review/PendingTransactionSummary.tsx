'use client';
import { LoaderCircle } from 'lucide-react';
import TokenIcon from '@/components/TokenIcon';
import type { PlanStatus, TransactionStepResult } from '@/lib/fx';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import type { transactionCardIdentity } from './transactionCardIdentity';
import { plainAmountLabel } from './transactionAmountPresentation';
import { compactExecutionStatus } from './compactExecution';
import { TransactionHashLink } from './ReviewProgress';
import { hasTransactionHash } from '@/lib/transactionProgress';
import { ReviewFactValue } from './ReviewFactValue';
import styles from './ActionReviewPresentation.module.css';

export function PendingTransactionSummary({ identity, facts, status, steps, chainId, networkSwitching, nextKind }: {
  identity: ReturnType<typeof transactionCardIdentity>; facts: readonly ReviewFact[]; status: PlanStatus;
  steps: readonly TransactionStepResult[]; chainId: number; networkSwitching: boolean; nextKind?: string;
}) {
  const progress = compactExecutionStatus(status, steps, networkSwitching, nextKind);
  return <section className={styles.pendingSummary} aria-label="Transaction progress">
    <div className={styles.pendingStatus} role="status" aria-live="polite"><LoaderCircle size={19} className="animate-spin" aria-hidden="true" /><strong>{progress.label}</strong>{progress.warning && <span>{progress.warning}</span>}</div>
    <div className={styles.pendingIdentity}>{identity.symbol && <TokenIcon symbol={identity.symbol} size={28} />}<strong>{identity.name}</strong><span>{identity.subtitle}</span></div>
    {facts.length > 0 && <dl>{facts.map(fact => <div key={fact.label}><dt>{plainAmountLabel(fact.label)}</dt><dd><ReviewFactValue fact={fact} /></dd></div>)}</dl>}
    {steps.filter(hasTransactionHash).map(step => <TransactionHashLink key={`${step.index}-${step.hash}`} step={step} chainId={chainId} />)}
  </section>;
}
