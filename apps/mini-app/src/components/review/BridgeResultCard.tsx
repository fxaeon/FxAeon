'use client';

import type { ReactNode, Ref } from 'react';
import { CheckCircle2, Clock3, ExternalLink, LoaderCircle, XCircle } from 'lucide-react';
import { openExternalLink } from '@/lib/telegram';
import { compactAddress } from '@/lib/addressPresentation';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { TransactionHero } from './TransactionHero';
import styles from './BridgeResultCard.module.css';

export type BridgeResultState = 'pending' | 'source_confirmed' | 'destination_verified' | 'failed';
type Chain = 'Ethereum' | 'Base';

const chainId = (chain: Chain) => chain === 'Base' ? 8453 as const : 1 as const;

/** Presentation only. Values labelled Sent/Received must come from matched events,
 * never a quote, calldata, wallet balance delta or the source receipt alone.
 * Until then the legs show the reviewed request and estimate, labelled as such. */
export function BridgeResultCard({
  state, sourceChain, destinationChain, token, requestedAmount, sourceAmount, receivedAmount, estimatedAmount,
  sourceTxHash, destinationTxHash, recipient, simulated, sourceReverted = false,
  retryAction, headingRef, completionContent,
}: {
  state: BridgeResultState; sourceChain: Chain; destinationChain: Chain; token: string;
  requestedAmount: string; sourceAmount?: string; receivedAmount?: string;
  /** The reviewed receive estimate; never shown once delivery is verified. */
  estimatedAmount?: string;
  sourceTxHash?: string | null; destinationTxHash?: string | null; recipient?: string;
  simulated: boolean; sourceReverted?: boolean; completionContent?: ReactNode;
  retryAction?: ReactNode; headingRef?: Ref<HTMLHeadingElement>;
}) {
  const delivered = state === 'destination_verified';
  const failed = state === 'failed';
  const conciseComplete = delivered && Boolean(completionContent);
  const sourceConfirmed = state === 'source_confirmed' || delivered;
  // A missing amount remains unknown once delivery is verified: the estimate
  // never stands in for a verified receipt.
  const destinationAmount = delivered ? receivedAmount : estimatedAmount || undefined;
  const sourceKnown = sourceAmount !== undefined;
  const sourceDisplay = sourceKnown ? sourceAmount : requestedAmount || undefined;
  const title = delivered ? simulated ? 'Bridge complete' : `${token} received on ${destinationChain}`
    : failed ? sourceReverted ? 'Bridge not completed' : 'Bridge needs attention'
    : sourceConfirmed ? 'Bridge in progress' : sourceTxHash ? 'Bridge submitted' : 'Bridge not submitted';
  const source: ReviewFact = sourceDisplay ? { label: sourceKnown ? 'Sent' : 'Requested', value: `${sourceDisplay} ${token}` }
    : { label: 'Requested amount', value: 'Unavailable' };
  const destination: ReviewFact = destinationAmount ? { label: delivered ? 'Received' : 'Estimated', value: `${delivered ? '' : '≈ '}${destinationAmount} ${token}` }
    : { label: delivered ? 'Received amount' : 'Destination amount', value: 'Unavailable' };
  const legs = [source, destination];
  return <section className={styles.card} data-compact-bridge data-bridge-state={state} data-compact-complete={conciseComplete || undefined} aria-label="Bridge status">
    {/* Arrival leads once proven; until then what left does. Both stay named by provenance. */}
    <TransactionHero tone={delivered ? 'success' : failed ? 'danger' : 'review'} title={title} headingRef={headingRef} live
      headingLabel={delivered && simulated ? `Simulated result: ${title}` : undefined}
      legs={legs} lead={delivered && destinationAmount ? 1 : 0}
      labels={{ 'Requested amount': 'Requested', 'Received amount': 'Received', 'Destination amount': `On ${destinationChain}` }}
      tokens={[{ symbol: token, chainId: chainId(sourceChain) }, { symbol: token, chainId: chainId(destinationChain) }]}
      caption={failed ? sourceReverted ? 'Source reverted' : 'Delivery unverified · do not repeat' : `${sourceChain} → ${destinationChain}`}
      ariaLabel="Bridge outcome" provenance={simulated ? 'simulation' : delivered ? 'receipt' : 'mixed'} />
    {simulated && !conciseComplete && <p className={styles.simulation}>Simulation · no real funds moved</p>}
    {!conciseComplete && <div className={styles.timeline} aria-label="Bridge progress"><BridgeReceiptRow label={sourceConfirmed ? 'Source confirmed' : 'Source transaction'} chain={sourceChain} hash={sourceTxHash} simulated={simulated} status={sourceReverted ? 'Reverted' : sourceConfirmed ? 'Confirmed' : sourceTxHash ? 'Pending' : 'Not submitted'} /><BridgeReceiptRow label={`Delivering to ${destinationChain}`} chain={destinationChain} hash={destinationTxHash} simulated={simulated} status={delivered ? 'Confirmed' : destinationTxHash ? 'Confirming' : 'Pending'} /></div>}
    {recipient && <div className={styles.recipient}><span>Recipient</span><span title={recipient}>{compactAddress(recipient)}</span></div>}
    {retryAction}

    {conciseComplete && <div className={styles.completion}>{completionContent}</div>}
  </section>;
}

/** One step of the transfer as a quiet row: what it is, its state, and its receipt once a hash exists. */
export function BridgeReceiptRow({ label, chain, hash, status, simulated }: { label: string; chain: Chain; hash?: string | null; status: string; simulated: boolean }) {
  const confirmed = status === 'Confirmed';
  // Only a step actually under way turns; one not yet submitted holds still.
  const Icon = confirmed ? CheckCircle2 : status === 'Reverted' ? XCircle : ['Pending', 'Confirming'].includes(status) && hash !== null ? LoaderCircle : Clock3;
  const content = <><Icon size={17} aria-hidden="true" /><span><span>{label}</span><small>{simulated ? `Simulated · ${status.toLowerCase()}` : status}</small></span>{!simulated && hash && <ExternalLink size={15} aria-hidden="true" />}</>;
  const url = hash && /^0x[0-9a-f]{64}$/i.test(hash) ? `${chain === 'Base' ? 'https://basescan.org' : 'https://etherscan.io'}/tx/${hash}` : undefined;
  return !simulated && url ? <a className={styles.receipt} data-status={status} href={url} target="_blank" rel="noopener noreferrer" aria-label={`${label}: ${status}. View receipt on ${chain} (opens in a new tab)`} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (openExternalLink(url)) event.preventDefault();
  }}>{content}</a> : <div className={styles.receipt} data-status={status}>{content}</div>;
}
