'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { reviewFactLabel } from './reviewHierarchy';
import styles from './BridgeReviewSummary.module.css';
import { ReviewTermRow } from './ReviewTermRow';

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
    <span className={styles.recipientLabel}>Recipient</span>
    <button className={styles.recipientCopy} type="button" title={fact.value} aria-label={`Copy recipient address: ${fact.value}`} disabled={copyState === 'copying'} aria-busy={copyState === 'copying'} onClick={() => void copyRecipient()}>
      <span className={styles.recipientPreview} translate="no">{compactAddress}</span>
      {copyState === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
    <span className="sr-only" role="status">{copyState === 'copied' ? 'Recipient address copied.' : ''}</span>
    {copyState === 'unconfirmed' && <p className={styles.copyStatus} role="status">Couldn’t copy. Try again.</p>}
  </div>;
}

function BridgeFact({ fact }: { fact: ReviewFact }) {
  const label = fact.label === 'Gas fee' ? (/max/i.test(fact.value) ? 'Network fee (max)' : 'Network fee') : fact.label === 'Estimated received' ? 'You receive · estimated' : fact.label === 'Minimum received' ? 'Min. received' : fact.label === 'Slippage' ? 'Max. slippage' : reviewFactLabel(fact.label);
  return <ReviewTermRow fact={fact} displayLabel={label} />;
}

/** The terms beneath the transfer hero. Display only the accepted facts: no alternate quote, fee or timing math. */
export function BridgeReviewSummary({ facts, allFacts }: { facts: readonly ReviewFact[]; allFacts: readonly ReviewFact[] }) {
  const sent = facts.find(fact => fact.label === 'Amount' || fact.label === 'Input amount');
  const received = facts.find(fact => fact.label === 'Estimated received');
  const source = allFacts.find(fact => fact.label === 'Source network');
  const destination = allFacts.find(fact => fact.label === 'Destination network');
  const amountsShowNetworks = Boolean(sent && received && source && destination);
  const priceImpact = allFacts.find(fact => fact.label === 'Price impact');
  const slippage = allFacts.find(fact => fact.label === 'Slippage');
  const remaining = facts.filter(fact => !(fact.label === 'Delivery estimate' && /^(?:Not provided by bridge|Unavailable|Unknown|—)?$/i.test(fact.value.trim())) && fact !== sent && fact !== received && !(amountsShowNetworks && fact.label === 'Networks'));
  return <section className={styles.summary} aria-label="Bridge terms">
    <div className={styles.terms}>
      <div className={styles.consequenceGroup}>{remaining.filter(fact => ['Minimum received', 'Quoted minimum received'].includes(fact.label)).map(fact => <BridgeFact key={fact.label} fact={fact} />)}{slippage && <BridgeFact fact={slippage} />}</div>
      <div className={styles.costGroup}>{remaining.filter(fact => ['Gas fee', 'Bridge fee', 'Protocol fee', 'f(x) fee'].includes(fact.label)).map(fact => <BridgeFact key={fact.label} fact={fact} />)}</div>
      {priceImpact && <BridgeFact fact={priceImpact} />}
      <div className={styles.context}>{remaining.filter(fact => !['Minimum received', 'Quoted minimum received', 'Price impact', 'Slippage', 'Total cost', 'Gas fee', 'Bridge fee', 'Protocol fee', 'f(x) fee'].includes(fact.label)).map(fact => fact.label === 'Recipient'
        ? <Recipient key={`${fact.label}:${fact.value}`} fact={fact} />
        : <BridgeFact key={`${fact.label}:${fact.value}`} fact={fact} />)}</div>
    </div>
  </section>;
}
