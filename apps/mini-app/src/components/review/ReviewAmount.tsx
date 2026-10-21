'use client';

import { useEffect, useState } from 'react';
import { TokenIcon } from '@/components/TokenIcon';
import { useUsdPrices } from '@/components/PriceProvider';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { USD_PRICE_MAX_AGE_MS, formatUsd, priceKeyForSymbol, usdValueForDecimal } from '@/lib/prices';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { groupDigits } from '@/lib/amount';
import { readableReviewAmount } from './reviewHierarchy';
import styles from './ActionReviewPresentation.module.css';

export function ReviewAmount({ fact, trade = false }: { fact: ReviewFact; trade?: boolean }) {
  const quote = useUsdPrices();
  const [, tick] = useState(0);
  const parts = /^(\d[\d,.]*)\s+(\S+)$/.exec(fact.value);
  const figure = parts?.[1];
  const unit = parts?.[2];
  const display = figure ? readableReviewAmount(figure) : null;
  const key = unit ? priceKeyForSymbol(unit) : null;
  const price = key ? quote.prices[key] : undefined;
  const timestamp = key ? quote.updatedAts?.[key] ?? quote.updatedAt : null;
  const now = Date.now();
  const fresh = timestamp && timestamp > 0 && timestamp <= now + 30_000 && now - timestamp <= USD_PRICE_MAX_AGE_MS;
  const usd = figure && fresh ? usdValueForDecimal(figure.replace(/,/g, ''), price) : null;
  useEffect(() => {
    if (!timestamp || timestamp > Date.now() + 30_000) return;
    const timer = window.setTimeout(() => tick(value => value + 1), Math.max(0, timestamp + USD_PRICE_MAX_AGE_MS - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [timestamp]);
  return <div data-review-fact={fact.label} className={styles.amountSummary}>
    <div className={styles.amountCaption}>{trade ? 'You pay' : fact.label}</div>
    <div className={styles.amountLine}>
      <div className={styles.amountValue}>
        {display && unit ? <details className={styles.exactAmount}>
          <summary aria-label={`Show exact amount: ${fact.value}`}><span>{display.shortened ? '≈ ' : ''}{groupDigits(display.value.replace(/,/g, ''))} <span className={styles.amountUnit}>{unit}</span></span></summary>
          <p><span>Exact amount</span>{fact.value}</p>
        </details> : <ValueOrSkeleton value={fact.value} width="lg" announce={false} label="Loading amount" />}
        {usd !== null && <span className={styles.amountUsd}>{usd > 0 && usd < 0.01 ? formatUsd(usd) : `≈ ${formatUsd(usd)}`}</span>}
      </div>
      {unit && <TokenIcon symbol={unit} size={36} />}
    </div>
  </div>;
}
