'use client';

import type { ReactNode, Ref } from 'react';
import { ArrowDown, CheckCircle2, Clock3, ExternalLink, XCircle } from 'lucide-react';
import { ChainIcon, TokenIcon } from '@/components/TokenIcon';
import { openExternalLink } from '@/lib/telegram';
import { compactAddress } from '@/lib/addressPresentation';
import { AmountCounterpart, AmountFigure } from './AmountUsd';
import { MissingValue } from '@/components/MissingValue';
import { readableReviewAmount } from './reviewHierarchy';
import styles from './BridgeResultCard.module.css';

export type BridgeResultState = 'pending' | 'source_confirmed' | 'destination_verified' | 'failed';
type Chain = 'Ethereum' | 'Base';

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
  const StateIcon = delivered ? CheckCircle2 : failed ? XCircle : Clock3;
  return <section className={styles.card} data-compact-bridge data-bridge-state={state} data-compact-complete={conciseComplete || undefined} aria-label="Bridge status">
    <header className={styles.header} data-tone={delivered ? 'success' : failed ? 'danger' : 'pending'}>
      <span className={styles.stateIcon} aria-hidden="true"><StateIcon size={20} /></span>
      <div className={styles.heading} aria-live="polite" aria-atomic="true">
        <h3 ref={headingRef} aria-label={delivered && simulated ? `Simulated result: ${title}` : undefined} data-review-focus={headingRef ? true : undefined} tabIndex={headingRef ? -1 : undefined}>{title}</h3>
        <p>{sourceChain} → {destinationChain}</p>
        {failed && <p>{sourceReverted ? 'Source reverted' : 'Delivery unverified · do not repeat'}</p>}
      </div>
    </header>
    {simulated && !conciseComplete && <p className={styles.simulation}>Simulation · no real funds moved</p>}
    <div className={styles.transfer} aria-label="Bridge outcome" data-amount-provenance={simulated ? 'simulation' : delivered ? 'receipt' : 'mixed'}>
      <OutcomeAmount network={sourceChain} token={token} amount={sourceDisplay}
        label={sourceKnown ? 'Sent' : 'Requested'} secondary />
      <span className={styles.direction} aria-hidden="true"><ArrowDown size={17} /></span>
      <OutcomeAmount network={destinationChain} token={token} amount={destinationAmount}
        label={delivered ? 'Received' : destinationAmount ? 'Estimated' : 'Destination'} estimate={!delivered} />
    </div>
    {!conciseComplete && <div className={styles.timeline} aria-label="Bridge progress"><BridgeReceiptRow label={sourceConfirmed ? "Source confirmed" : "Source transaction"} chain={sourceChain} hash={sourceTxHash} simulated={simulated} status={sourceReverted ? 'Reverted' : sourceConfirmed ? 'Confirmed' : sourceTxHash ? 'Pending' : 'Not submitted'} /><BridgeReceiptRow label={`Delivering to ${destinationChain}`} chain={destinationChain} hash={destinationTxHash} simulated={simulated} status={delivered ? 'Confirmed' : destinationTxHash ? 'Confirming' : 'Pending'} /></div>}
    {recipient && <div className={styles.recipient}><span>Recipient</span><span title={recipient}>{compactAddress(recipient)}</span></div>}
    {retryAction}

    {conciseComplete && <div className={styles.completion}>{completionContent}</div>}
  </section>;
}


function OutcomeAmount({ network, token, amount, label, secondary = false, estimate = false }: {
  network: Chain; token: string; amount?: string; label: string; secondary?: boolean; estimate?: boolean;
}) {
  const figure = amount === undefined || amount === '' ? undefined : readableReviewAmount(amount);
  const display = figure ? `${figure.shortened || estimate ? '≈ ' : ''}${figure.value.replace(/^(\d+)(.*)$/, (_, whole: string, fraction: string) => `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`)}` : undefined;
  return <div className={styles.amountRow} data-secondary={secondary || undefined} data-estimate={estimate && figure ? true : undefined}>
    <span className={styles.token} aria-hidden="true"><TokenIcon symbol={token} size={44} /><span><ChainIcon chainId={network === 'Base' ? 8453 : 1} size={16} /></span></span>
    <div className={styles.amountContent}>
      <p className={styles.amount} data-unknown={!figure || undefined} data-long={(display?.length ?? 0) > 17 || undefined}>
        {display && amount !== undefined
          ? <AmountFigure amount={amount} symbol={token}>{display}<span> {token}</span></AmountFigure>
          : <MissingValue width="md" status="unavailable" announce={false} label={`${label} amount unavailable`} />}
      </p>
      <p className={styles.subline}><span>{label}</span><span aria-hidden="true">·</span>{display && amount !== undefined && <><AmountCounterpart amount={amount} symbol={token} token={`${display} ${token}`} /><span aria-hidden="true" data-usd-separator>·</span></>}<span>{!figure && `${token} on `}{network}</span></p>
    </div>
  </div>;
}

export function BridgeReceiptRow({ label, chain, hash, status, simulated }: { label: string; chain: Chain; hash?: string | null; status: string; simulated: boolean }) {
  const confirmed = status === 'Confirmed';
  const Icon = confirmed ? CheckCircle2 : status === 'Reverted' ? XCircle : Clock3;
  const content = <><Icon size={17} aria-hidden="true" /><span><span>{label}</span><small>{simulated ? `Simulated · ${status.toLowerCase()}` : status}</small></span>{!simulated && hash && <ExternalLink size={15} aria-hidden="true" />}</>;
  const url = hash && /^0x[0-9a-f]{64}$/i.test(hash) ? `${chain === 'Base' ? 'https://basescan.org' : 'https://etherscan.io'}/tx/${hash}` : undefined;
  return !simulated && url ? <a className={styles.receipt} data-status={status} href={url} target="_blank" rel="noopener noreferrer" aria-label={`${label}: ${status}. View receipt on ${chain} (opens in a new tab)`} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (openExternalLink(url)) event.preventDefault();
  }}>{content}</a> : <div className={styles.receipt} data-status={status}>{content}</div>;
}
