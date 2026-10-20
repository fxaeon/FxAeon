'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Check, ChevronDown, Copy } from 'lucide-react';
import { ChainIcon, TokenIcon } from '@/components/TokenIcon';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { compactAddress } from '@/lib/addressPresentation';
import { copyText } from '@/lib/clipboard';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { readableReviewAmount, reviewFactLabel } from './reviewHierarchy';
import styles from './ActionReviewPresentation.module.css';
import { AmountUsd, FeeUsd } from './AmountUsd';
import { tokenAmountParts } from './transactionAmountPresentation';

function BridgeAmount({ fact, network, chainId, received = false }: {
  fact: ReviewFact; network?: ReviewFact; chainId?: number; received?: boolean;
}) {
  const parts = tokenAmountParts(fact);
  const figure = parts ? readableReviewAmount(parts.amount) : undefined;
  const unit = parts?.symbol;
  return <div data-review-fact={fact.label} className={styles.bridgeAmount}>
    <span className={styles.bridgeToken} aria-hidden="true">
      {unit && <TokenIcon symbol={unit} size={34} />}
      {(chainId === 1 || chainId === 8453) && <span><ChainIcon chainId={chainId} size={15} /></span>}
    </span>
    <div className={styles.bridgeAmountText}>
      <span className={styles.bridgeAmountLabel}>{received ? 'You receive · estimated' : 'You send'}</span>
      <details className={styles.bridgeExactAmount}>
        <summary data-long={(figure?.value.length ?? 0) > 15 || undefined} aria-label={`${received ? 'Show full receive estimate' : 'Show exact sent amount'}: ${fact.title ?? fact.value}`}>
          <span>{figure ? `${figure.shortened || fact.value.startsWith('≈') ? '≈ ' : ''}${figure.value}` : <ValueOrSkeleton value={fact.value} width="lg" label="Bridge amount unavailable" />} {unit && <span className={styles.flowUnit}>{unit}</span>}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <p><span>{received ? 'Unrounded estimate' : 'Exact send amount'}</span>{fact.title ?? fact.value}</p>
      </details>
      <span className={styles.bridgeAssetNetwork}>{parts && <AmountUsd amount={parts.amount} symbol={parts.symbol} />}{network && <span>{network.value}</span>}</span>
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
  if (!isAddress) return <BridgeFact fact={fact} />;
  return <details data-review-fact={fact.label} className={styles.bridgeRecipient}>
    <summary><span>Recipient</span><span>{compactAddress(fact.value)}<ChevronDown size={14} aria-hidden="true" /></span></summary>
    <div><p>{fact.value}</p><button type="button" aria-label="Copy full recipient address" disabled={copyState === 'copying'} aria-busy={copyState === 'copying'} onClick={() => void copyRecipient()}>
      {copyState === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copyState === 'copied' ? 'Copied' : copyState === 'copying' ? 'Copying…' : 'Copy address'}
    </button><span className="sr-only" role="status">{copyState === 'copied' ? 'Recipient address copied.' : ''}</span>{copyState === 'unconfirmed' && <p role="status">Copy not confirmed. You can select the full address above.</p>}</div>
  </details>;
}

function BridgeFact({ fact }: { fact: ReviewFact }) {
  const label = fact.label === 'Gas fee' ? 'Network fee' : reviewFactLabel(fact.label);
  const value = <><ValueOrSkeleton value={fact.value} width="md" label={`${label} unavailable`} />{fact.equivalent && <small>{fact.equivalent}</small>}{['Gas fee', 'Bridge fee', 'Total cost'].includes(fact.label) && <FeeUsd fact={fact} />}</>;
  return fact.title && fact.title !== fact.value
    ? <details data-review-fact={fact.label} className={styles.bridgeExactFact}><summary><span>{label}</span><span>{value}<ChevronDown size={12} aria-hidden="true" /></span></summary><p>{fact.title}</p></details>
    : <div data-review-fact={fact.label} className={styles.bridgeFact}><span>{label}</span><span>{value}</span></div>;
}

/** Display only the accepted facts. No alternate quote, fee or timing math. */
export function BridgeReviewSummary({ facts, allFacts, sourceChainId, destinationChainId, compactTerms = false, amountsOnly = false }: {
  facts: readonly ReviewFact[]; allFacts: readonly ReviewFact[]; sourceChainId: number; destinationChainId?: number; compactTerms?: boolean; amountsOnly?: boolean;
}) {
  const sent = facts.find(fact => fact.label === 'Amount' || fact.label === 'Input amount');
  const received = facts.find(fact => fact.label === 'Estimated received');
  const source = allFacts.find(fact => fact.label === 'Source network');
  const destination = allFacts.find(fact => fact.label === 'Destination network');
  const amountsShowNetworks = Boolean(sent && received && source && destination);
  const remaining = facts.filter(fact => !(fact.label === 'Delivery estimate' && /^(?:Not provided by bridge|Unavailable|Unknown|—)?$/i.test(fact.value.trim())) && fact !== sent && fact !== received && !(amountsShowNetworks && fact.label === 'Networks'));
  return <section className={styles.bridgeSummary} aria-label="Bridge amounts and terms">
    <div className={styles.bridgeAmounts}>
      {sent && <BridgeAmount fact={sent} network={source} chainId={sourceChainId} />}
      {sent && received && <ArrowDown className={styles.bridgeDirection} size={17} aria-hidden="true" />}
      {received && <BridgeAmount fact={received} network={destination} chainId={destinationChainId} received />}
    </div>
    {amountsOnly ? null : compactTerms ? <details className={styles.bridgeReviewedTerms}><summary>Reviewed terms<ChevronDown size={14} aria-hidden="true" /></summary><p className={styles.reviewExplanation}>These are the accepted quote and limits, not final destination amounts.</p><div className={styles.bridgeTerms}>{remaining.map(fact => fact.label === 'Recipient'
      ? <Recipient key={`${fact.label}:${fact.value}`} fact={fact} />
      : <BridgeFact key={`${fact.label}:${fact.value}`} fact={fact} />)}</div></details>
      : <div className={styles.bridgeTerms}>{remaining.map(fact => fact.label === 'Recipient'
      ? <Recipient key={`${fact.label}:${fact.value}`} fact={fact} />
      : <BridgeFact key={`${fact.label}:${fact.value}`} fact={fact} />)}</div>}
  </section>;
}
