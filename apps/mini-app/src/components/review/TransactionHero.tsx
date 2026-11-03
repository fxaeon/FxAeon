'use client';

import type { ReactNode, Ref } from 'react';
import { Check, Clock3, X } from 'lucide-react';
import { ChainIcon, TokenIcon } from '@/components/TokenIcon';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { groupDigits } from '@/lib/amount';
import { AmountCounterpart, AmountFigure } from './AmountUsd';
import { ReviewTermRow } from './ReviewTermRow';
import { plainAmountLabel, tokenAmountParts } from './transactionAmountPresentation';
import { readableReviewAmount } from './reviewHierarchy';
import styles from './TransactionHero.module.css';

/** What the hero's mark says: nothing yet, proven, stopped, or not known. */
export type HeroTone = 'review' | 'success' | 'danger' | 'warning';

/** A token mark, with its network when the transaction crosses networks. */
export type HeroMark = { symbol: string; chainId?: 1 | 8453 };

/** A token amount as every amount is shown: grouped digits, with ≈ when shortened or estimated. */
export function displayedAmount(fact: ReviewFact) {
  const parts = tokenAmountParts(fact);
  if (!parts) return null;
  const readable = readableReviewAmount(parts.amount);
  const approx = readable.shortened || parts.approximate;
  const digits = groupDigits(readable.value.replace(/,/g, ''));
  const figure = `${approx ? '≈ ' : ''}${digits}`;
  return { ...parts, approx, digits, figure, long: figure.length > 9, extended: readable.value.length > 15 };
}

/** A leg's role in a few words: "You pay", "You receive · est.". */
function legRole(label: string, labels?: Readonly<Record<string, string>>): string {
  const role = labels?.[label] ?? plainAmountLabel(label);
  return role.replace(/ · estimated$/, ' · est.');
}

const BADGES = { success: Check, danger: X, warning: Clock3 } as const;

/**
 * The amount a transaction is about, as large as the sheet allows, with the
 * tokens it moves and the step it is at. One leg leads; any other legs follow
 * as quiet rows inside the same region, so the region names every amount.
 */
export function TransactionHero({ title, headingRef, headingLabel, legs, lead = 0, labels, value, caption, tone = 'review', tokens, live = false, ariaLabel, provenance }: {
  title: string;
  headingRef?: Ref<HTMLHeadingElement>;
  /** A fuller accessible name for the heading, e.g. a simulated result. */
  headingLabel?: string;
  legs: readonly ReviewFact[];
  /** The leg the action is named for: what is borrowed, paid or received. */
  lead?: number;
  /** Role names for receipt legs; reviewed legs use their plain labels. */
  labels?: Readonly<Record<string, string>>;
  /** A non-amount outcome to lead with, such as a target leverage. */
  value?: ReactNode;
  caption?: ReactNode;
  tone?: HeroTone;
  /** Marks in place of the legs' tokens: a request that never completed, or one token on two networks. */
  tokens?: readonly HeroMark[];
  /** Announces a heading that changes on its own, as a bridge's delivery does. */
  live?: boolean;
  /** Names the amounts as a region; without it the hero is plain content. */
  ariaLabel?: string;
  provenance?: 'review' | 'receipt' | 'simulation' | 'mixed';
}) {
  const leading = legs[lead] ?? legs[0];
  const shown = leading ? displayedAmount(leading) : null;
  const rest = legs.filter(leg => leg !== leading);
  // At most two marks: what leaves, then what arrives on top of it.
  const shownMarks: readonly HeroMark[] = tokens ?? [...new Set(legs.flatMap(leg => tokenAmountParts(leg)?.symbol ?? []))].map(symbol => ({ symbol }));
  const marks = shownMarks.length > 2 ? [shownMarks[0], shownMarks.at(-1)!] : shownMarks;
  const Badge = tone === 'review' ? null : BADGES[tone];
  const Region = ariaLabel ? 'section' : 'div';
  return <Region className={styles.hero} data-hero-tone={tone} aria-label={ariaLabel} data-amount-provenance={provenance}>
    <div className={styles.head} aria-live={live ? 'polite' : undefined} aria-atomic={live || undefined}>
      {marks.length > 0 ? <span className={styles.marks} data-marks={marks.length} aria-hidden="true">
        {marks.map((mark, index) => <span key={`${mark.symbol}:${mark.chainId ?? ''}`} className={styles.mark}>
          <TokenIcon symbol={mark.symbol} size={48} />
          {mark.chainId && <span className={styles.network}><ChainIcon chainId={mark.chainId} size={16} /></span>}
          {Badge && index === marks.length - 1 && <span className={styles.badge}><Badge size={14} strokeWidth={3} /></span>}
        </span>)}
      </span> : Badge && <span className={styles.marks} aria-hidden="true">
        {/* Without a token to mark, the outcome is the mark. */}
        <span className={`${styles.mark} ${styles.outcome}`}><Badge size={24} strokeWidth={2.75} /></span>
      </span>}
      {/* The heading keeps focus; only its text is re-keyed, so a real change of state reads as one swap. */}
      <h3 ref={headingRef} data-review-focus tabIndex={-1} aria-label={headingLabel} className={styles.title}><span key={title}>{title}</span></h3>
      {leading && shown ? <div className={styles.lead} data-review-fact={leading.label}>
        <p className={styles.amount} data-review-amount data-long={shown.long || undefined} data-extended={shown.extended || undefined}>
          <AmountFigure amount={shown.amount} symbol={shown.symbol}>{shown.approx && <><span className={styles.approx}>≈</span> </>}{shown.digits} <span className={styles.unit}>{shown.symbol}</span></AmountFigure>
        </p>
        <p className={styles.meta}><span>{legRole(leading.label, labels)}</span><span aria-hidden="true">·</span><AmountCounterpart amount={shown.amount} symbol={shown.symbol} token={`${shown.figure} ${shown.symbol}`} />
          {/* Tall sheets give the context its own line; shorter ones run it on after the value. */}
          {caption && <><span aria-hidden="true" className={styles.captionSeparator}>·</span><span className={styles.caption} data-hero-caption>{caption}</span></>}</p>
      </div> : <>
        {value !== undefined && <div className={styles.lead}><p className={styles.amount}>{value}</p></div>}
        {caption && <p className={styles.caption} data-hero-caption>{caption}</p>}
      </>}
    </div>
    {rest.length > 0 && <div className={styles.legs}>{rest.map(leg => <ReviewTermRow key={`${leg.label}:${leg.value}`} fact={leg} displayLabel={legRole(leg.label, labels)} />)}</div>}
  </Region>;
}
