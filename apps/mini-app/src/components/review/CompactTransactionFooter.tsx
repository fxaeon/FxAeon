'use client';

import { useEffect, useState, type Ref } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import type { TransactionExecutionResult } from '@/lib/fx';
import type { ReceiptPresentation } from '@/lib/receiptPresentation';
import { useUsdPrices } from '@/components/PriceProvider';
import { USD_PRICE_MAX_AGE_MS } from '@/lib/prices';
import { priceDemandRegistry } from '@/lib/priceDemand';
import { useTransactionEvidence } from './TransactionEvidenceContext';
import { compactTransactionFooterModel, type CompactDestinationReceipt } from './compactTransactionReceipt';
import styles from './CompactTransactionFooter.module.css';

export { hasCompactConfirmedTransaction } from './compactTransactionReceipt';

/** The outcome above explains what changed; the explorer holds the receipt detail. */
export function CompactTransactionFooter({ result, receipts, destinationReceipt, headingRef }: {
  result: TransactionExecutionResult;
  receipts: readonly ReceiptPresentation[];
  /** Never supply a provider-only destination hint; delivery must be canonically verified. */
  destinationReceipt?: CompactDestinationReceipt;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const quote = useUsdPrices();
  const evidence = useTransactionEvidence();
  const [, tick] = useState(0);
  const timestamp = quote.updatedAts?.ETH ?? quote.updatedAt;
  useEffect(() => priceDemandRegistry.acquire(), []);
  useEffect(() => {
    if (!timestamp || !Number.isFinite(timestamp) || timestamp > Date.now() + 30_000) return;
    const timer = window.setTimeout(() => tick(value => value + 1), Math.max(0, timestamp + USD_PRICE_MAX_AGE_MS - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [timestamp]);
  const model = compactTransactionFooterModel(result, receipts, evidence, quote, Date.now(), destinationReceipt);
  if (!model) return null;
  return <section className={styles.footer} aria-label={model.simulated ? 'Simulated transaction receipt' : 'Confirmed transaction receipt'}>
    <div className={styles.row}>
      <div className={styles.confirmation}>
        <Check size={14} aria-hidden="true" />
        {headingRef ? <h3 ref={headingRef} data-review-focus tabIndex={-1}>{model.confirmationLabel}</h3> : <span>{model.confirmationLabel}</span>}
      </div>
      <div className={styles.links}>{model.explorerUrl
        ? <>
          <a className={styles.link} href={model.explorerUrl} target="_blank" rel="noopener noreferrer" aria-label="View confirmed action transaction on explorer">{model.destinationExplorerUrl ? 'Source' : 'View transaction'} <ArrowUpRight size={14} aria-hidden="true" /></a>
          {model.destinationExplorerUrl && <a className={styles.link} href={model.destinationExplorerUrl} target="_blank" rel="noopener noreferrer" aria-label="View confirmed destination transaction on explorer">Destination <ArrowUpRight size={14} aria-hidden="true" /></a>}
        </>
        : model.simulated ? <span className={styles.note}>No on-chain link</span> : null}</div>
    </div>
    <dl className={styles.row}>
      <dt>{model.gasLabel === 'Source gas fee' ? 'Source network fee' : 'Network fee'}</dt>
      <dd className={styles.fee} data-fee-state={model.feeState} title={model.feeDescription} aria-label={model.feeDescription} tabIndex={0}>
        <span>{model.feeValue}</span>
        {model.feeNote && model.feeNote !== 'now' && <small className={styles.note}>{model.feeNote}</small>}
      </dd>
    </dl>
    {model.feeState === 'priced' && <p className={styles.valuationNote}>USD values at current prices</p>}
  </section>;
}
