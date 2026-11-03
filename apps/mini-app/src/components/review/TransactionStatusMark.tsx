'use client';
import { useEffect, useState } from 'react';
import { CircleAlert, LoaderCircle, Network, Wallet } from 'lucide-react';
import type { PlanStatus, TransactionStepResult } from '@/lib/fx';
import { transactionStepProgress } from '@/lib/transactionProgress';
import styles from './TransactionProgress.module.css';

export type StatusMarkState = 'wallet' | 'network' | 'pending' | 'uncertain' | 'preparing';

/** What is being waited on while signing. Presentation only: the runner reports every state. */
export function statusMarkState(status: PlanStatus, steps: readonly TransactionStepResult[], networkSwitching: boolean): StatusMarkState {
  if (steps.some(step => ['unknown', 'unverified'].includes(transactionStepProgress(step).state))) return 'uncertain';
  if (networkSwitching) return 'network';
  if (status === 'awaiting-user') return 'wallet';
  if (status === 'submitted' || status === 'included' || status === 'confirming') return 'pending';
  return 'preparing';
}

/**
 * One glyph, moving only while something is actually waited on: the wallet
 * breathes while its prompt is open, a thin spinner turns while the chain
 * confirms, and an uncertain outcome holds still.
 */
export function TransactionStatusMark({ state }: { state: StatusMarkState }) {
  const Icon = state === 'wallet' ? Wallet : state === 'network' ? Network : state === 'uncertain' ? CircleAlert : LoaderCircle;
  return <span className={styles.mark} data-status-mark={state} aria-hidden="true"><Icon size={20} strokeWidth={2} /></span>;
}

/** Real time since a submitted transaction was first seen, as m:ss. */
export function useSubmittedElapsed(hash: string | undefined): string | null {
  const [since, setSince] = useState<{ hash: string; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hash) { setSince(null); return; }
    if (since?.hash !== hash) { setSince({ hash, at: Date.now() }); setNow(Date.now()); }
  }, [hash, since?.hash]);
  useEffect(() => {
    if (!since) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [since]);
  if (!since) return null;
  const seconds = Math.max(0, Math.floor((now - since.at) / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
