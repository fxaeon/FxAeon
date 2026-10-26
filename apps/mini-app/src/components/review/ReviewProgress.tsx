'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Clock3, ExternalLink, LoaderCircle, XCircle } from 'lucide-react';
import type { TransactionStepResult } from '@/lib/fx';
import { openExternalLink } from '@/lib/telegram';
import { transactionExplorerUrl, transactionStepKind, transactionStepProgress } from '@/lib/transactionProgress';
import { useTransactionEvidence } from './TransactionEvidenceContext';
import presentation from './ActionReviewPresentation.module.css';

export function chainName(chainId: number): string {
  return chainId === 8453 ? 'Base' : chainId === 1 ? 'Ethereum' : `Chain ${chainId}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function stepProgress(step: TransactionStepResult | undefined): {
  label: string;
  className: string;
  icon: ReactNode;
} {
  const { state, label } = transactionStepProgress(step);
  if (state === 'confirmed') return { label, className: 'text-success', icon: <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> };
  if (state === 'unknown' || state === 'unverified') return { label, className: 'text-warn', icon: <Clock3 aria-hidden="true" className="h-3.5 w-3.5" /> };
  if (state === 'stopped' || state === 'reverted') return { label, className: 'text-danger', icon: <XCircle aria-hidden="true" className="h-3.5 w-3.5" /> };
  if (state === 'submitted' || state === 'included' || state === 'confirming') return { label, className: 'text-mint', icon: <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> };
  return { label, className: 'text-mut', icon: <Circle aria-hidden="true" className="h-3.5 w-3.5" /> };
}

export function TransactionHashLink({ step, chainId }: { step: TransactionStepResult; chainId: number }) {
  const simulated = useTransactionEvidence() === 'simulation';
  const url = transactionExplorerUrl(chainId, step.hash);
  if (!url || !step.hash) return null;
  const progress = stepProgress(step);
  const kind = transactionStepKind(step);
  if (simulated) return <div className={presentation.hashLink} aria-label={`Simulated ${kind.toLowerCase()} ${step.index + 1}: ${progress.label}. No on-chain link.`}>
    <span><span>{kind} {step.index + 1} · Simulated receipt</span><span className={progress.className}>{progress.icon}{progress.label}</span></span>
    <span>No on-chain link</span>
  </div>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${kind} ${step.index + 1}: ${progress.label}. View transaction ${step.hash} on ${chainName(chainId)} explorer (opens in a new tab)`}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (openExternalLink(url)) event.preventDefault();
      }}
      className={presentation.hashLink}
    >
      <span>
        <span>{kind} {step.index + 1} · {shortHash(step.hash)}</span>
        <span className={progress.className}>{progress.icon}{progress.label}</span>
      </span>
      <span>Explorer <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></span>
    </a>
  );
}

export function StatusNotice({ label, body, className, icon, waiting = false }: { label: string; body: string; className: string; icon: ReactNode; waiting?: boolean }) {
  // Tone follows the semantic text color. Only states that wait on the person
  // (wallet prompts, network switches) carry the attention ring; terminal or
  // uncertain outcomes share the warning tone but must not pulse.
  const tone = (className ?? '').match(/text-(warn|success|danger|mint|mut)/)?.[1] ?? 'mut';
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={presentation.statusNotice} data-tone={tone} data-waiting={waiting || undefined}>
      {/* Animate an actual stage change once; polling/body updates keep the
          same node, live region, and focus rather than replaying the effect. */}
      <div key={label} className={presentation.statusContent}>
      <span className={`${presentation.statusIcon} ${className ?? ''}`}>{icon}</span>
      <span className={presentation.statusText}><span className={className ?? undefined}>{label}</span><span>{body}</span></span>
      </div>
    </div>
  );
}

export function InlineError({ message }: { message: string }) {
  return <div role="alert" className={presentation.inlineError}><AlertTriangle aria-hidden="true" /><span>{message}</span></div>;
}
