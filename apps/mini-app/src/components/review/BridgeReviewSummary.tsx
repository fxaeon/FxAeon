'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Check, Copy } from 'lucide-react';
import { ChainIcon, TokenIcon } from '@/components/TokenIcon';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { groupDigits } from '@/lib/amount';
import { GroupedAddress } from '@/components/GroupedAddress';
import { copyText } from '@/lib/clipboard';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { readableReviewAmount, reviewFactLabel } from './reviewHierarchy';
import styles from './BridgeReviewSummary.module.css';
import { AmountUsd } from './AmountUsd';
import { tokenAmountParts } from './transactionAmountPresentation';
import { ReviewTermRow } from './ReviewTermRow';

function BridgeAmount({ fact, network, chainId, received = false }: {
  fact: ReviewFact; network?: ReviewFact; chainId?: number; received?: boolean;
}) {
  const parts = tokenAmountParts(fact);
  const figure = parts ? readableReviewAmount(parts.amount) : undefined;
  const unit = parts?.symbol;
  return <div data-review-fact={fact.label} className={styles.amount}>
    <span className={styles.token} aria-hidden="true">
      {unit && <TokenIcon symbol={unit} size={34} />}
      {(chainId === 1 || chainId === 8453) && <span><ChainIcon chainId={chainId} size={15} /></span>}
    </span>
    <div className={styles.amountText}>
      <details className={styles.exactAmount}>
        <summary data-long={(figure?.value.length ?? 0) > 15 || undefined} aria-label={`${received ? 'Show full receive estimate' : 'Show exact sent amount'}: ${fact.title ?? fact.value}`}>
          <span>{figure ? `${figure.shortened || fact.value.startsWith('≈') ? '≈ ' : ''}${groupDigits(figure.value.replace(/,/g, ''))}` : <ValueOrSkeleton value={fact.value} width="lg" label="Bridge amount unavailable" />} {unit && <span className={styles.flowUnit}>{unit}</span>}</span>
        </summary>
        <p><span>{received ? 'Unrounded estimate' : 'Exact send amount'}</span>{fact.title ?? fact.value}</p>
      </details>
      <span className={styles.networkLine}><span>{received ? 'Estimated' : 'Send'}</span>{parts && <><span aria-hidden="true">·</span><AmountUsd amount={parts.amount} symbol={parts.symbol} /></>}{network && <><span aria-hidden="true">·</span><span>{network.value}</span></>}</span>
    </div>
  </div>;
}

function Recipient({ fact }: { fact: ReviewFact }) {
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'unconfirmed'>('idle');
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { request.current += 1; clearTimeout(timer.current); }, []);
  const copyRecipient = async () => {
    const current = ++request.current;
    clearTimeout(timer.current);
    setCopyState('copying');
    // Some embedded browsers leave clipboard permission unresolved. Never
    // show success without confirmation or leave a silent, unresponsive tap.
    timer.current = setTimeout(() => { if (current === request.current) setCopyState('unconfirmed'); }, 2000);
    const copied = await copyText(fact.value);
    if (current !== request.current) return;
    clearTimeout(timer.current);
    setCopyState(copied ? 'copied' : 'unconfirmed');
  };
  const isAddress = /^0x[\da-f]{40}$/i.test(fact.value);
  if (!isAddress) return <ReviewTermRow fact={fact} displayLabel="Recipient" />;
  const compactAddress = `${fact.value.slice(0, 6)}…${fact.value.slice(-4)}`;
  return <div data-review-fact={fact.label} className={styles.recipient}>
    <details className={styles.recipientDetails}>
      <summary aria-label={`Show full recipient address: ${fact.value}`}>
        <span className={styles.recipientLabel}>Recipient</span>
        <span className={styles.recipientPreview} title={fact.value}>{compactAddress}</span>
        <span className={styles.recipientAction}><span>Show full</span><span>Hide</span></span>
      </summary>
      <div className={styles.recipientExpanded}>
        <GroupedAddress address={fact.value} />
        <button type="button" aria-label="Copy full recipient address" disabled={copyState === 'copying'} aria-busy={copyState === 'copying'} onClick={() => void copyRecipient()}>
          {copyState === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          <span>{copyState === 'copied' ? 'Copied' : copyState === 'copying' ? 'Copying…' : 'Copy exact address'}</span>
        </button>
      </div>
    </details>
    <span className="sr-only" role="status">{copyState === 'copied' ? 'Recipient address copied.' : ''}</span>
    {copyState === 'unconfirmed' && <p className={styles.copyStatus} role="status">Copy not confirmed. You can select the full address above.</p>}
  </div>;
}

function BridgeFact({ fact }: { fact: ReviewFact }) {
  const label = fact.label === 'Gas fee' ? (/max/i.test(fact.value) ? 'Network fee (max)' : 'Network fee') : fact.label === 'Estimated received' ? 'You receive · estimated' : fact.label === 'Minimum received' ? 'Min. received' : fact.label === 'Slippage' ? 'Max. slippage' : reviewFactLabel(fact.label);
  return <ReviewTermRow fact={fact} displayLabel={label} />;
}

/** Display only the accepted facts. No alternate quote, fee or timing math. */
export function BridgeReviewSummary({ facts, allFacts, sourceChainId, destinationChainId }: {
  facts: readonly ReviewFact[]; allFacts: readonly ReviewFact[]; sourceChainId: number; destinationChainId?: number;
}) {
  const sent = facts.find(fact => fact.label === 'Amount' || fact.label === 'Input amount');
  const received = facts.find(fact => fact.label === 'Estimated received');
  const source = allFacts.find(fact => fact.label === 'Source network');
  const destination = allFacts.find(fact => fact.label === 'Destination network');
  const amountsShowNetworks = Boolean(sent && received && source && destination);
  const priceImpact = allFacts.find(fact => fact.label === 'Price impact') ?? { label: 'Price impact', value: 'Unavailable', title: 'The accepted route does not provide a verified price-impact estimate.' };
  const slippage = allFacts.find(fact => fact.label === 'Slippage');
  const remaining = facts.filter(fact => !(fact.label === 'Delivery estimate' && /^(?:Not provided by bridge|Unavailable|Unknown|—)?$/i.test(fact.value.trim())) && fact !== sent && fact !== received && !(amountsShowNetworks && fact.label === 'Networks'));
  return <section className={styles.summary} aria-label="Bridge amounts and terms">
    <div className={styles.amounts}>
      {sent && <BridgeAmount fact={sent} network={source} chainId={sourceChainId} />}
      {sent && received && <ArrowDown className={styles.direction} size={17} aria-hidden="true" />}
      {received && <BridgeAmount fact={received} network={destination} chainId={destinationChainId} received />}
    </div>
    <div className={styles.terms}>
      <div className={styles.consequenceGroup}>{remaining.filter(fact => ['Minimum received', 'Quoted minimum received'].includes(fact.label)).map(fact => <BridgeFact key={fact.label} fact={fact} />)}{slippage && <BridgeFact fact={slippage} />}</div>
      <div className={styles.costGroup}>{remaining.filter(fact => ['Gas fee', 'Bridge fee', 'Protocol fee', 'f(x) fee'].includes(fact.label)).map(fact => <BridgeFact key={fact.label} fact={fact} />)}</div>
      <BridgeFact fact={priceImpact} />
      <div className={styles.context}>{remaining.filter(fact => !['Minimum received', 'Quoted minimum received', 'Price impact', 'Slippage', 'Total cost', 'Gas fee', 'Bridge fee', 'Protocol fee', 'f(x) fee'].includes(fact.label)).map(fact => fact.label === 'Recipient'
        ? <Recipient key={`${fact.label}:${fact.value}`} fact={fact} />
        : <BridgeFact key={`${fact.label}:${fact.value}`} fact={fact} />)}</div>
    </div>
  </section>;
}
