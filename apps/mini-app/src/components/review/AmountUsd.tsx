'use client';
import { useEffect, useState } from 'react';
import { priceDemandRegistry } from '@/lib/priceDemand';
import { useUsdPrices } from '@/components/PriceProvider';
import { USD_PRICE_MAX_AGE_MS, formatUsd, priceKeyForSymbol } from '@/lib/prices';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { nativeCostAmount, amountUsdValue } from './transactionAmountPresentation';
import styles from './ActionReviewPresentation.module.css';

export function AmountUsd({ amount, symbol, receipt = false }: { amount: string; symbol: string; receipt?: boolean }) {
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
  const usd = amountUsdValue(amount, symbol, quote);
  return <span className={styles.amountUsd} data-usd-state={usd === null ? 'unavailable' : 'estimate'} title={usd === null ? 'No fresh display price is available for this asset.' : `Display-price estimate, not a signed or receipt-time value. Price checked ${new Date(timestamp!).toISOString()}.`}>
    {usd === null ? 'USD value unavailable' : `${usd > 0 && usd < .01 ? '' : '≈ '}${formatUsd(usd)}${receipt ? ' now' : ''}`}
  </span>;
}

export function FeeUsd({ fact }: { fact: Pick<ReviewFact, 'value' | 'title'> }) {
  const amount = nativeCostAmount(fact);
  return <AmountUsd amount={amount ?? ''} symbol="ETH" />;
}
