'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { priceDemandRegistry } from '@/lib/priceDemand';
import { useAmountUnit } from '@/lib/amountUnit';
import { haptic } from '@/lib/telegram';
import { useUsdPrices } from '@/components/PriceProvider';
import { USD_PRICE_MAX_AGE_MS, formatUsd, priceKeyForSymbol } from '@/lib/prices';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import type { PositionOutcomeFacts } from '@/lib/fx/reviewFormatting';
import { freshDisplayPrices } from '@/lib/displayPrices';
import { collateralUsdEstimate } from '@/lib/tradeOutcome';
import { formatReviewFactValue } from './reviewFactFormatting';
import { nativeCostAmount, amountUsdValue } from './transactionAmountPresentation';
import { MissingValue } from '@/components/MissingValue';
import styles from './ActionReviewPresentation.module.css';

/** Matching-asset expiry redraws the value even when the provider is quiet. */
function useMatchingDisplayQuote(symbol: string) {
  const quote = useUsdPrices();
  useEffect(() => priceDemandRegistry.acquire(), []);
  const [, tick] = useState(0);
  const key = priceKeyForSymbol(symbol);
  const timestamp = key ? quote.updatedAts?.[key] ?? quote.updatedAt : null;
  useEffect(() => {
    if (!timestamp || !Number.isFinite(timestamp) || timestamp > Date.now() + 30_000) return;
    const timer = window.setTimeout(() => tick(value => value + 1), Math.max(0, timestamp + USD_PRICE_MAX_AGE_MS - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [timestamp]);
  return { quote, timestamp };
}

/** A USD estimate as copy: "≈ $1.21", or "<$0.01", which is already approximate. */
export function usdEstimateText(usd: number): string {
  return `${usd > 0 && usd < .01 ? '' : '≈ '}${formatUsd(usd)}`;
}

export function AmountUsd({ amount, symbol, fallback }: { amount: string; symbol: string; receipt?: boolean; fallback?: string }) {
  const { quote } = useMatchingDisplayQuote(symbol);
  const usd = amountUsdValue(amount, symbol, quote);
  const visibleFallback = fallback && !/^(?:USD value unavailable|Unavailable|Not quoted|—|-)?$/i.test(fallback.trim()) ? fallback : undefined;
  return <span className={styles.amountUsd} data-usd-state={usd === null ? 'unavailable' : 'estimate'}>
    {usd === null ? visibleFallback ?? <MissingValue width="sm" status="unavailable" announce={false} label="USD value unavailable" /> : usdEstimateText(usd)}
  </span>;
}

/**
 * One amount in the reader's unit. USD leads only while that asset has a
 * fresh price; otherwise the token amount leads and no toggle is offered.
 */
export function useAmountInUnit(amount: string | null | undefined, symbol: string) {
  const [unit, toggle] = useAmountUnit();
  const { quote } = useMatchingDisplayQuote(symbol);
  const usd = amount ? amountUsdValue(amount, symbol, quote) : null;
  return { usd, usdText: usd === null ? null : usdEstimateText(usd), showUsd: unit === 'usd' && usd !== null, toggle };
}

/**
 * The secondary figure is the toggle, with ⇅ beside it (as on Jumper). One
 * tap switches every amount in the app between tokens and US dollars.
 */
export function UnitSwap({ children, toUsd, onToggle, className = '' }: { children: ReactNode; toUsd: boolean; onToggle: () => void; className?: string }) {
  // The figure stays the button's name; what the tap does is its description.
  return <button type="button" className={`${styles.unitSwap} ${className}`} data-unit-swap={toUsd ? 'usd' : 'token'}
    title={toUsd ? 'Show amounts in US dollars' : 'Show amounts in tokens'}
    onClick={(event) => { event.stopPropagation(); haptic('selection'); onToggle(); }}>
    <span>{children}</span><ArrowUpDown aria-hidden="true" />
  </button>;
}

/**
 * An amount leg's figure: the token amount it is given, or its USD estimate in
 * USD mode. The estimate is bare text so it takes the figure's own size, not
 * the smaller size a figure gives its unit.
 */
export function AmountFigure({ amount, symbol, children }: { amount: string; symbol: string; children: ReactNode }) {
  const value = useAmountInUnit(amount, symbol);
  return <>{value.showUsd ? value.usdText : children}</>;
}

/** Each amount's USD figure while USD leads (null where a token leads), for layouts sized by the shown text. */
export function useLeadingUsdFigures(amounts: readonly { amount: string; symbol: string }[]): (string | null)[] {
  const [unit] = useAmountUnit();
  const quote = useUsdPrices();
  useEffect(() => priceDemandRegistry.acquire(), []);
  return amounts.map(({ amount, symbol }) => {
    const usd = unit === 'usd' && amount ? amountUsdValue(amount, symbol, quote) : null;
    return usd === null ? null : usdEstimateText(usd);
  });
}

/** An amount leg's secondary line: the other unit, which swaps the app's unit when tapped. */
export function AmountCounterpart({ amount, symbol, token, fallback }: { amount: string; symbol: string; token: ReactNode; fallback?: string }) {
  const value = useAmountInUnit(amount, symbol);
  if (value.usd === null) return <AmountUsd amount={amount} symbol={symbol} fallback={fallback} />;
  return <span className={styles.amountUsd} data-usd-state="estimate">
    <UnitSwap toUsd={!value.showUsd} onToggle={value.toggle}>{value.showUsd ? token : value.usdText}</UnitSwap>
  </span>;
}

/** A token amount in a fact row: the chosen unit leads and the other sits beneath it. */
export function InlineAmount({ amount, symbol, token }: { amount: string; symbol: string; token: ReactNode }) {
  const value = useAmountInUnit(amount, symbol);
  if (value.usd === null) return <>{token}</>;
  return <>
    <span data-amount-unit={value.showUsd ? 'usd' : 'token'}>{value.showUsd ? value.usdText : token}</span>
    <small className={styles.inlineCounterpart} data-usd-state="estimate">
      <UnitSwap toUsd={!value.showUsd} onToggle={value.toggle}>{value.showUsd ? token : value.usdText}</UnitSwap>
    </small>
  </>;
}

/** The route's collateral valuation, never short notional or swap execution price. */
export function CollateralAmount({ collateral }: { collateral: PositionOutcomeFacts['collateral'] }) {
  const { quote } = useMatchingDisplayQuote(collateral.symbol);
  const [unit, toggle] = useAmountUnit();
  const usd = collateralUsdEstimate(collateral, freshDisplayPrices(quote));
  if (usd === null) return <span data-usd-state="unavailable">{collateral.value}</span>;
  const showUsd = unit === 'usd';
  return <>
    <span data-usd-state="estimate" data-amount-unit={showUsd ? 'usd' : 'token'}>{showUsd ? usd : collateral.value}</span>
    <small className={styles.inlineCounterpart}><UnitSwap toUsd={!showUsd} onToggle={toggle}>{showUsd ? collateral.value : usd}</UnitSwap></small>
  </>;
}

export function FeeUsd({ fact }: { fact: Pick<ReviewFact, 'value' | 'title'> }) {
  const amount = nativeCostAmount(fact);
  return <AmountUsd amount={amount ?? ''} symbol="ETH" />;
}

/** Keep the fee estimate compact; the accepted native cap remains in its fact. */
export function FeeAmount({ fact }: { fact: Pick<ReviewFact, 'value' | 'title'> }) {
  const amount = nativeCostAmount(fact);
  return <AmountUsd amount={amount ?? ''} symbol="ETH" fallback={formatReviewFactValue({ label: 'Network fee', ...fact }).display} />;
}
