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

export function AmountUsd({ amount, symbol, fallback = 'USD value unavailable' }: { amount: string; symbol: string; receipt?: boolean; fallback?: string }) {
  const { quote } = useMatchingDisplayQuote(symbol);
  const usd = amountUsdValue(amount, symbol, quote);
  return <span className={styles.amountUsd} data-usd-state={usd === null ? 'unavailable' : 'estimate'} aria-label={usd === null ? 'USD value unavailable' : undefined}>
    {usd === null ? fallback : `${usd > 0 && usd < .01 ? '' : '≈ '}${formatUsd(usd)}`}
  </span>;
}

/** The route's collateral valuation, never short notional or swap execution price. */
export function CollateralAmount({ collateral }: { collateral: PositionOutcomeFacts['collateral'] }) {
  const { quote } = useMatchingDisplayQuote(collateral.symbol);
  const usd = collateralUsdEstimate(collateral, freshDisplayPrices(quote));
  return <span data-usd-state={usd === null ? 'unavailable' : 'estimate'}>
    {usd ?? collateral.value}
  </span>;
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
