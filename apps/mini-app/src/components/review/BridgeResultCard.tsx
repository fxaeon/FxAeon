'use client';

import type { ReactNode, Ref } from 'react';
import { ArrowDown, CheckCircle2, ChevronDown, Clock3, ExternalLink, XCircle } from 'lucide-react';
import { ChainIcon, TokenIcon } from '@/components/TokenIcon';
import { openExternalLink } from '@/lib/telegram';
import { compactAddress } from '@/lib/addressPresentation';
import { AmountUsd } from './AmountUsd';
import { readableReviewAmount } from './reviewHierarchy';
import { TechnicalEvidenceRow } from './TechnicalEvidenceRow';
import styles from './BridgeResultCard.module.css';

export type BridgeResultState = 'pending' | 'source_confirmed' | 'destination_verified' | 'failed';
type Chain = 'Ethereum' | 'Base';

/** Presentation only. Values labelled Sent/Received must come from matched events,
 * never a quote, calldata, wallet balance delta or the source receipt alone. */
export function BridgeResultCard({
  state, sourceChain, destinationChain, token, requestedAmount, sourceAmount, receivedAmount,
  sourceTxHash, destinationTxHash, recipient, simulated, sourceReverted = false,
  advancedContent, verificationDetails, retryAction, headingRef, completionContent,
}: {
  state: BridgeResultState; sourceChain: Chain; destinationChain: Chain; token: string;
  requestedAmount: string; sourceAmount?: string; receivedAmount?: string;
  sourceTxHash?: string | null; destinationTxHash?: string | null; recipient?: string;
  simulated: boolean; sourceReverted?: boolean; advancedContent?: ReactNode; completionContent?: ReactNode;
  verificationDetails?: ReactNode; retryAction?: ReactNode; headingRef?: Ref<HTMLHeadingElement>;
}) {
  const delivered = state === 'destination_verified';
  const failed = state === 'failed';
  const conciseComplete = delivered && Boolean(completionContent);
  const sourceConfirmed = state === 'source_confirmed' || delivered;
  // A missing amount remains unknown, even if delivery itself was verified.
  const destinationAmount = delivered ? receivedAmount : undefined;
  const sourceKnown = sourceAmount !== undefined;
  const sourceDisplay = sourceKnown ? sourceAmount : !sourceConfirmed && !failed ? requestedAmount : undefined;
  const title = delivered ? simulated ? 'Simulation complete' : 'Bridge complete'
    : failed ? sourceReverted ? 'Bridge not completed' : 'Bridge needs attention'
    : sourceConfirmed ? 'Destination pending' : sourceTxHash ? 'Bridge submitted' : 'Bridge not submitted';
  const body = delivered ? `${token} delivered on ${destinationChain}.`
    : failed ? sourceReverted ? 'The source transaction reverted. No bridge delivery was completed.' : 'Delivery is not verified. Check the receipt before trying again.'
    : sourceConfirmed ? `${sourceChain} confirmed. Waiting for ${destinationChain}.`
    : sourceTxHash ? `Waiting for confirmation on ${sourceChain}.` : 'No bridge transaction has been submitted.';
  const StateIcon = delivered ? CheckCircle2 : failed ? XCircle : Clock3;
  return <section className={styles.card} data-compact-bridge data-bridge-state={state} data-compact-complete={conciseComplete || undefined} aria-label="Bridge status">
    {!conciseComplete && <header className={styles.header} data-tone={delivered ? 'success' : failed ? 'danger' : 'pending'}>
      <span className={styles.stateIcon} aria-hidden="true"><StateIcon size={20} /></span>
      <div className={styles.heading} aria-live="polite" aria-atomic="true">
        <h3 ref={headingRef} data-review-focus={headingRef ? true : undefined} tabIndex={headingRef ? -1 : undefined}>{title}</h3>
        {!delivered && <p>{body}</p>}
      </div>
    </header>}
    {simulated && !conciseComplete && <p className={styles.simulation}>Simulation · no real funds moved</p>}
    <div className={styles.transfer} aria-label="Bridge outcome">
      <OutcomeAmount network={sourceChain} token={token} amount={sourceDisplay}
        label={sourceKnown ? 'Sent' : sourceConfirmed ? 'Source confirmed' : failed ? 'Source amount' : 'Requested'}
        missing={sourceConfirmed || failed ? 'Amount unavailable' : 'Not available'} secondary receipt={sourceKnown} inspectExact={conciseComplete} />
      <span className={styles.direction} aria-hidden="true"><ArrowDown size={17} /></span>
      <OutcomeAmount network={destinationChain} token={token} amount={destinationAmount}
        label={delivered ? 'Received' : 'Destination'}
        missing={delivered ? 'Amount unavailable' : failed ? 'Not verified' : 'Awaiting delivery'} receipt={delivered} inspectExact={conciseComplete} />
    </div>
    {!conciseComplete && recipient && <div className={styles.recipient}><span>Recipient</span><span title={recipient}>{compactAddress(recipient)}</span></div>}
    {retryAction}
    {conciseComplete && <div className={styles.completion}>{completionContent}</div>}
    {!conciseComplete && <details className={styles.advanced}>
      <summary><span>Advanced</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className={styles.detailsBody}>
        {!conciseComplete && <section className={styles.group} aria-label="Bridge receipts">
          <h4>Receipts</h4>
          <BridgeReceiptRow label={`Bridge from ${sourceChain}`} chain={sourceChain} hash={sourceTxHash} simulated={simulated} status={sourceReverted ? 'Reverted' : sourceConfirmed ? 'Confirmed' : sourceTxHash ? 'Pending' : 'Not submitted'} />
          <BridgeReceiptRow label={`Bridge to ${destinationChain}`} chain={destinationChain} hash={destinationTxHash} simulated={simulated} status={delivered ? 'Confirmed' : destinationTxHash ? 'Confirming' : 'Not verified'} />
        </section>}
        {(sourceKnown || destinationAmount !== undefined) && <section className={styles.group} aria-label="Verified bridge amounts">
          <h4>{simulated ? 'Simulated amounts' : 'Verified amounts'}</h4>
          <dl className={styles.facts}>
            {sourceKnown && <div><dt>Exact sent</dt><dd>{sourceAmount} {token}</dd></div>}
            {destinationAmount !== undefined && <div><dt>Exact received</dt><dd>{destinationAmount} {token}</dd></div>}
          </dl>
        </section>}
        {recipient && <section className={styles.group}><TechnicalEvidenceRow label="Recipient" value={recipient} preview={compactAddress(recipient)} /></section>}
        {!conciseComplete && advancedContent}
        {!conciseComplete && verificationDetails && <section className={styles.notes} aria-label="Delivery verification">{verificationDetails}</section>}
        <p className={styles.priceNote}>{!simulated && 'Sent and received amounts come from verified bridge events. '}USD values use current prices, not transaction-time prices.</p>
      </div>
    </details>}
  </section>;
}

function OutcomeAmount({ network, token, amount, label, missing, secondary = false, receipt = false, inspectExact = false }: {
  network: Chain; token: string; amount?: string; label: string; missing: string; secondary?: boolean; receipt?: boolean; inspectExact?: boolean;
}) {
  const figure = amount === undefined || amount === '' ? undefined : readableReviewAmount(amount);
  const display = figure ? `${figure.shortened ? '≈ ' : ''}${figure.value.replace(/^(\d+)(.*)$/, (_, whole: string, fraction: string) => `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`)}` : undefined;
  return <div className={styles.amountRow} data-secondary={secondary || undefined}>
    <span className={styles.token} aria-hidden="true"><TokenIcon symbol={token} size={44} /><span><ChainIcon chainId={network === 'Base' ? 8453 : 1} size={16} /></span></span>
    <div className={styles.amountContent}>
      <span className={styles.label}>{label}</span>
      {inspectExact && figure ? <details className={styles.exactAmount}>
        <summary aria-label={`Show exact ${label.toLowerCase()} amount: ${amount} ${token}`}>
          <span className={styles.amount} data-long={(display?.length ?? 0) > 17 || undefined}>{display}<span> {token}</span></span>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <p className={styles.exactValue}><span>Exact {label.toLowerCase()}</span>{amount} {token}</p>
      </details> : <p className={styles.amount} data-unknown={!figure || undefined} data-long={(display?.length ?? 0) > 17 || undefined} title={amount === undefined ? undefined : `${amount} ${token}`}>
        {display ?? missing}{figure && <span> {token}</span>}
      </p>}
      <p className={styles.subline}>{figure && amount !== undefined && <><AmountUsd amount={amount} symbol={token} receipt={receipt} /><span aria-hidden="true">·</span></>}<span>{!figure && `${token} on `}{network}</span></p>
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
