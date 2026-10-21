import type { PlanStatus, TransactionStepResult } from '@/lib/fx';
import { transactionStepProgress } from '@/lib/transactionProgress';

/** Presentation only. Never invent a confirmation count or promote a hash to success. */
export function compactExecutionStatus(status: PlanStatus, steps: readonly TransactionStepResult[], networkSwitching = false, nextKind?: string) {
  const uncertain = steps.find(step => ['unknown', 'unverified'].includes(transactionStepProgress(step).state));
  if (uncertain) return { label: transactionStepProgress(uncertain).label, warning: 'Do not resubmit' };
  if (networkSwitching) return { label: 'Switching network' };
  if (status === 'awaiting-user') return { label: nextKind === 'approval' ? 'Approve in wallet' : 'Confirm in wallet' };
  if (status === 'included' || status === 'confirming') {
    const active = steps.find(step => step.status === 'included' || step.status === 'confirming');
    const count = active?.confirmations, required = active?.requiredConfirmations;
    const knownCount = Number.isInteger(count) && count! >= 0 && Number.isInteger(required) && required! > 0;
    return { label: knownCount ? `Confirming · ${count}/${required}` : status === 'included' ? 'Included' : 'Confirming' };
  }
  if (status === 'submitted') return { label: 'Submitted', warning: 'Do not resubmit' };
  if (status === 'confirmed') return { label: 'Step confirmed' };
  if (status === 'partial') return { label: 'Partially completed' };
  if (status === 'failed') return { label: 'Action stopped' };
  return { label: 'Preparing request' };
}
