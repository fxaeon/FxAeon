'use client';
import { useEffect, useState } from 'react';
import { priceDemandRegistry } from '@/lib/priceDemand';
import { useUsdPrices } from '@/components/PriceProvider';
import { USD_PRICE_MAX_AGE_MS, formatUsd, priceKeyForSymbol } from '@/lib/prices';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import type { PositionOutcomeFacts } from '@/lib/fx/reviewFormatting';
import { freshDisplayPrices } from '@/lib/displayPrices';
import { collateralUsdEstimate } from '@/lib/tradeOutcome';
import { formatReviewFactValue } from './reviewFactFormatting';
import { nativeCostAmount, amountUsdValue } from './transactionAmountPresentation';
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

export function AmountUsd({ amount, symbol, receipt = false, fallback = 'USD value unavailable' }: { amount: string; symbol: string; receipt?: boolean; fallback?: string }) {
  const { quote, timestamp } = useMatchingDisplayQuote(symbol);
  const usd = amountUsdValue(amount, symbol, quote);
  return <span className={styles.amountUsd} data-usd-state={usd === null ? 'unavailable' : 'estimate'} title={usd === null ? 'No fresh display price is available for this asset.' : `Display-price estimate, not a signed or receipt-time value. Price checked ${new Date(timestamp!).toISOString()}.`}>
    {usd === null ? fallback : `${usd > 0 && usd < .01 ? '' : '≈ '}${formatUsd(usd)}${receipt ? ' now' : ''}`}
  </span>;
}

/** The route's collateral valuation, never short notional or swap execution price. */
export function CollateralAmount({ collateral }: { collateral: PositionOutcomeFacts['collateral'] }) {
  const { quote } = useMatchingDisplayQuote(collateral.symbol);
  const usd = collateralUsdEstimate(collateral, freshDisplayPrices(quote));
  return <span data-usd-state={usd === null ? 'unavailable' : 'estimate'} title={usd === null
    ? `${collateral.title ?? collateral.value}. USD value unavailable: no fresh matching ${collateral.symbol} price.`
    : `Estimated collateral value at the current ${collateral.symbol} display price, not position notional or an execution price. ${collateral.title ?? collateral.value}`}>
    {usd ?? collateral.value}
  </span>;
}

export function FeeUsd({ fact }: { fact: Pick<ReviewFact, 'value' | 'title'> }) {
  const amount = nativeCostAmount(fact);
  return <AmountUsd amount={amount ?? ''} symbol="ETH" />;
}

/** Fresh display USD leads; the unchanged exact native cap remains accessible. */
export function FeeAmount({ fact }: { fact: Pick<ReviewFact, 'value' | 'title'> }) {
  const amount = nativeCostAmount(fact);
  return <details className={styles.feePrimary}>
    <summary aria-label={`Show exact network cost: ${fact.title ?? fact.value}`}><AmountUsd amount={amount ?? ''} symbol="ETH" fallback={formatReviewFactValue({ label: 'Network fee', ...fact }).display} /></summary>
    <p>{fact.title ?? fact.value}<span>USD is a current-price estimate. The native amount governs the transaction.</span></p>
  </details>;
}
