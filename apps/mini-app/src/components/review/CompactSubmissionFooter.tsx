'use client';

import { ArrowUpRight } from 'lucide-react';
import { transactionExplorerUrl } from '@/lib/transactionProgress';
import { useTransactionEvidence } from './TransactionEvidenceContext';
import styles from './CompactTransactionFooter.module.css';

/**
 * Wallet Send returns a submitted hash, not a verified receipt. Keep the same
 * compact layout without upgrading submission or quoting an estimate as paid gas.
 */
export function CompactSubmissionFooter({ chainId, hash }: { chainId: number; hash: string }) {
  const simulated = useTransactionEvidence() === 'simulation';
  const explorerUrl = simulated ? null : transactionExplorerUrl(chainId, hash);
  return <dl className={styles.footer} aria-label={simulated ? 'Simulated submission details' : 'Submitted transaction details'}>
    <div className={styles.row}>
      <dt>{simulated ? 'Simulation submitted' : 'Transaction submitted'}</dt>
      <dd>{explorerUrl
        ? <a className={styles.link} href={explorerUrl} target="_blank" rel="noopener noreferrer" aria-label="View submitted transaction on explorer">View <ArrowUpRight size={14} aria-hidden="true" /></a>
        : <span className={styles.note}>{simulated ? 'No on-chain link' : 'Explorer unavailable'}</span>}</dd>
    </div>
    <div className={styles.row}>
      <dt>{simulated ? 'Simulated gas fee' : 'Gas fee'}</dt>
      <dd className={styles.fee}>Pending confirmation</dd>
    </div>
  </dl>;
}
