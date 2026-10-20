'use client';

import { useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import { evidencePreview, evidenceTextRows } from './technicalEvidence';
import styles from './ActionReviewPresentation.module.css';

/** Compact evidence, never rounded: view and copy always use the original text. */
export function TechnicalEvidenceRow({ label, value, preview }: { label: string; value: string; preview?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const display = preview ?? evidencePreview(value);
  async function copy() {
    setCopyState('copying');
    const copied = await Promise.race([copyText(value), new Promise<boolean>(resolve => window.setTimeout(() => resolve(false), 2000))]);
    setCopyState(copied ? 'copied' : 'failed');
  }
  return <div className={styles.evidenceRow} data-review-evidence={label}>
    <span>{label}</span>
    <div>
      <button type="button" className={styles.evidenceValue} onClick={() => dialog.current?.showModal()} aria-label={`View full ${label.toLowerCase()}`} title={value}>{display}</button>
      <button type="button" className={styles.evidenceCopy} onClick={() => void copy()} disabled={copyState === 'copying'} aria-label={`Copy full ${label.toLowerCase()}`}>
        {copyState === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {copyState === 'copied' ? 'Copied' : copyState === 'copying' ? 'Copying' : 'Copy full'}
      </button>
    </div>
    {copyState === 'failed' && <p role="status">Copy not confirmed. Tap the value to select the full text.</p>}
    <span className="sr-only" role="status">{copyState === 'copied' ? `${label} copied.` : ''}</span>
    <dialog ref={dialog} onKeyDown={event => {
      // Native modal owns Escape and Tab; do not let the surrounding phone
      // sheet interpret Escape as dismissing/resetting the transaction review.
      if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation();
    }} className={styles.evidenceDialog} aria-label={`Full ${label.toLowerCase()}`}>
      <header><span>{label}</span><button type="button" aria-label="Close full data" onClick={() => dialog.current?.close()}><X size={20} /></button></header>
      <textarea readOnly rows={evidenceTextRows(value)} value={value} aria-label={`Exact ${label.toLowerCase()}`} onFocus={event => event.currentTarget.select()} />
      <button type="button" className={styles.evidenceCopy} onClick={() => void copy()} disabled={copyState === 'copying'}>{copyState === 'copied' ? 'Copied' : 'Copy full'}</button>
    </dialog>
  </div>;
}
