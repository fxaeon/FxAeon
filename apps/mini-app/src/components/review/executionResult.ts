import { AlertTriangle, CheckCircle2, CircleAlert, Clock3, XCircle, type LucideIcon } from 'lucide-react';
import type { TransactionExecutionResult } from '@/lib/fx';
import { userSafeError } from '@/lib/errors';
import { hasTransactionHash, transactionStepProgress } from '@/lib/transactionProgress';

function looksLikeWalletRejection(value: string | undefined): boolean {
  return Boolean(value && /(reject|denied|declin|cancel(?:led|ed)|user refused|user denied)/i.test(value));
}

/**
 * `confirmedTitle` names a fully confirmed action as History will ("Opened
 * ETH Long"); every other state keeps the title that says what happened.
 */
export function resultPresentation(result: TransactionExecutionResult, bridge: boolean, confirmedTitle?: string): {
  title: string;
  body: string;
  tone: 'success' | 'warning' | 'danger';
  icon: LucideIcon;
} {
  const submitted = result.steps.filter(hasTransactionHash);
  const confirmationUnknown = submitted.some((step) => step.hash && !step.receipt);
  const verificationIncomplete = submitted.some((step) => transactionStepProgress(step).state === 'unverified');
  const finalityPending = submitted.some((step) => step.receipt?.status === 'success' && step.status !== 'confirmed');
  const reverted = result.steps.some((step) => step.receipt?.status === 'reverted');
  if (result.status === 'confirmed') {
    return bridge
      ? { title: 'Confirmed on source', body: 'The source route is confirmed. Destination delivery is verified separately below.', tone: 'success', icon: CheckCircle2 }
      : { title: confirmedTitle ?? 'Confirmed', body: `All transaction steps are confirmed on ${result.chainId === 8453 ? 'Base' : result.chainId === 1 ? 'Ethereum' : `Chain ${result.chainId}`}.`, tone: 'success', icon: CheckCircle2 };
  }
  if (confirmationUnknown) return { title: 'Confirmation unknown', body: 'A transaction was submitted, but its receipt could not be verified. Check History from the wallet profile. Do not submit this action again.', tone: 'warning', icon: Clock3 };
  if (verificationIncomplete) return { title: 'Verification incomplete', body: 'A receipt exists, but the submitted transaction could not be fully verified. Check History. Do not submit this action again.', tone: 'warning', icon: AlertTriangle };
  if (finalityPending) return { title: 'Confirmation pending', body: 'A transaction was included, but finality could not be verified yet. Check History or the explorer and do not submit this action again.', tone: 'warning', icon: Clock3 };
  if (result.status === 'partial') {
    const confirmedApproval = result.steps.some((step) => step.transaction.kind === 'approval' && step.status === 'confirmed');
    const confirmedAction = result.steps.some((step) => step.transaction.kind === 'action' && step.status === 'confirmed');
    const submittedAction = result.steps.some((step) => step.transaction.kind === 'action' && hasTransactionHash(step));
    if (confirmedApproval && !confirmedAction && !submittedAction) {
      return { title: 'Approval confirmed', body: 'Action not submitted. The approval is on-chain; review each step before continuing.', tone: 'warning', icon: AlertTriangle };
    }
    return { title: 'Partially completed', body: 'At least one earlier transaction confirmed before the route stopped. Do not repeat the full action; review each step below.', tone: 'warning', icon: AlertTriangle };
  }
  if (reverted) return { title: 'Reverted', body: 'The submitted transaction reverted on-chain. No later step was submitted.', tone: 'danger', icon: XCircle };
  if (looksLikeWalletRejection(result.error)) return { title: 'Wallet request declined', body: 'This transaction was not submitted. No later step was opened.', tone: 'danger', icon: XCircle };
  return { title: 'Not submitted', body: userSafeError(result.error, 'The route stopped before a transaction could be confirmed.'), tone: 'danger', icon: CircleAlert };
}

/** State-refresh copy may claim confirmation only after every step is confirmed. */
export function resultBodyDuringRefresh(input: {
  status: TransactionExecutionResult['status'];
  refreshing: boolean;
  positionAction: boolean;
  body: string;
}): string {
  return input.status === 'confirmed' && input.refreshing && input.positionAction
    ? 'Transaction confirmed. Position details are refreshing.'
    : input.body;
}


/** Short actionable status only; detailed explanation remains available separately. */
export function compactResultWarning(presentation: { title: string; body: string }): string | null {
  if (['Confirmation unknown', 'Verification incomplete', 'Confirmation pending'].includes(presentation.title)) return 'Do not resubmit · check History';
  if (presentation.title === 'Approval confirmed') return 'Action not submitted';
  if (presentation.title === 'Partially completed') return 'Earlier steps confirmed · do not repeat';
  if (presentation.title === 'Reverted') return 'No later step submitted';
  if (presentation.title === 'Wallet request declined') return 'Not submitted';
  if (presentation.title === 'Not submitted' && presentation.body !== 'The route stopped before a transaction could be confirmed.') return presentation.body;
  return null;
}
