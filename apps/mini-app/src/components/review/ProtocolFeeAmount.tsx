'use client';

import { useEffect, useState } from 'react';
import { useUsdPrices } from '@/components/PriceProvider';
import { priceDemandRegistry } from '@/lib/priceDemand';
import { formatUsd, priceKeyForSymbol, USD_PRICE_MAX_AGE_MS, type UsdPriceSnapshot } from '@/lib/prices';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { amountUsdValue } from './transactionAmountPresentation';
import { ReviewFactValue } from './ReviewFactValue';

/** Every charged leg needs its own fresh display price. A stablecoin's name
 * never supplies a dollar peg, and an unknown fee base never becomes zero. */
export function protocolFeeUsdValue(fact: ReviewFact, quote: UsdPriceSnapshot, now = Date.now()): number | null {
  if (!fact.feeAmounts) return null;
  let total = 0;
  for (const leg of fact.feeAmounts) {
    if (!/^\d+(?:\.\d+)?$/.test(leg.amount)) return null;
    if (!/[1-9]/.test(leg.amount)) continue;
    const value = amountUsdValue(leg.amount, leg.symbol, quote, now);
    if (value === null || value === 0) return null;
    total += value;
  }
  return Number.isFinite(total) ? total : null;
}

/** Dollars lead in forms and review. The exact quoted rate and token
 * breakdown stay in the same touch/keyboard disclosure. */
export function ProtocolFeeAmount({ fact, className }: { fact: ReviewFact; className?: string }) {
  const quote = useUsdPrices();
  const [, tick] = useState(0);
  useEffect(() => priceDemandRegistry.acquire(), []);
  const expiresAt = Math.min(...(fact.feeAmounts ?? []).filter(leg => /[1-9]/.test(leg.amount)).map(leg => {
    const key = priceKeyForSymbol(leg.symbol);
    return (key ? quote.updatedAts?.[key] ?? quote.updatedAt : null) ?? 0;
  }).filter(timestamp => Number.isFinite(timestamp) && timestamp > 0).map(timestamp => timestamp + USD_PRICE_MAX_AGE_MS));
  useEffect(() => {
    if (!Number.isFinite(expiresAt)) return;
    const timer = window.setTimeout(() => tick(value => value + 1), Math.max(0, expiresAt - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  const usd = protocolFeeUsdValue(fact, quote);
  const display = usd === null ? 'Unavailable' : `${usd > 0 && usd < .01 || usd === 0 ? '' : '≈ '}${formatUsd(usd)}`;
  const detail = `${fact.title ?? fact.value} USD is a current-price estimate of these quoted protocol fees; excludes network gas and conversion costs.`;
  return <ReviewFactValue className={className} fact={{ ...fact, title: detail }} display={<span data-usd-state={usd === null ? 'unavailable' : 'estimate'}>{display}</span>}
    summaryLabel={`${display}. Show f(x) fee amount and rate breakdown`} />;
}
