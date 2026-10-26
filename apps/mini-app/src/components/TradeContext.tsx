'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronRight, ChartNoAxesCombined, ShieldCheck, TrendingDown, Globe } from 'lucide-react';
import { useLiveMarketQuote, useUsdPrices } from './PriceProvider';
import { MissingValue } from './MissingValue';
import { MetricLabel } from './InfoHelp';
import { useTradeFundingRate } from '@/lib/fx/useTradeFundingRate';
import { poolCapacityUnits } from '@/lib/fx/poolCapacity';
import { usePoolCapacity } from '@/lib/fx/usePoolCapacity';
import { useOracleObservation } from '@/lib/fx/useOracleObservation';
import { useOracleMarketDifference } from '@/lib/fx/useOracleMarketDifference';
import { formatUnits } from 'viem';
import { formatBalanceDecimal } from '@/lib/amount';
import { tradeFundingDisplay } from '@/lib/fx/tradeFunding';
import { formatUsdPrice, USD_PRICE_MAX_AGE_MS } from '@/lib/prices';
import { tradeSensitivity, tradeScenarioPrice, tradeMarketReference } from '@/lib/tradeSensitivity';
import { ChainIcon } from './TokenIcon';
import styles from './TradeContext.module.css';

/** Display-only, truncated capacity; the original units remain in the title. */
export function formatCapacityDisplay(amount: bigint, decimals: number): string {
  const scale = amount >= 10n ** BigInt(decimals + 9) ? 9 : amount >= 10n ** BigInt(decimals + 6) ? 6 : amount >= 10n ** BigInt(decimals + 3) ? 3 : 0;
  const exact = formatUnits(amount, decimals + scale);
  const shown = formatBalanceDecimal(exact, scale || amount >= 10n ** BigInt(decimals) ? 2 : 4);
  const approximate = !shown.startsWith('<') && shown.replaceAll(',', '') !== exact;
  return `${approximate ? '≈ ' : ''}${shown}${scale === 9 ? 'B' : scale === 6 ? 'M' : scale === 3 ? 'K' : ''}`;
}

export function TradeContext({ market, side, leverage, openPositions, positionsStatus }: {
  market: 'ETH' | 'BTC'; side: 'long' | 'short'; leverage: number; openPositions: number | null;
  positionsStatus: 'disconnected' | 'loading' | 'unavailable' | 'ready';
}) {
  const [change, setChange] = useState(-10);
  const live = useLiveMarketQuote(market);
  const prices = useUsdPrices();
  const funding = useTradeFundingRate(market, side);
  const capacity = usePoolCapacity(market, side);
  const capacityUnits = poolCapacityUnits(market, side);
  const oracle = useOracleObservation(market, side);
  const oracleDifference = useOracleMarketDifference(oracle.value, prices);
  const fundingDisplay = funding.rate ? tradeFundingDisplay(funding.rate) : null;
  const price = tradeScenarioPrice(live.isFresh ? live.quote?.price : tradeMarketReference(prices, market), change);
  const sensitivity = tradeSensitivity(change, leverage, side);
  const observed = prices.updatedAts?.fxUSD ?? prices.updatedAt;
  const fxUSD = prices.status !== 'stale' && prices.status !== 'unavailable' && observed && Date.now() >= observed && Date.now() - observed < USD_PRICE_MAX_AGE_MS && typeof prices.prices.fxUSD === 'number' && Number.isFinite(prices.prices.fxUSD) && prices.prices.fxUSD > 0 ? prices.prices.fxUSD : undefined;
  return <div className={styles.context}>
    <section className={styles.surface} aria-labelledby="trade-sensitivity-title">
      <header className={styles.heading}><h2 id="trade-sensitivity-title">What if {market} moves?</h2></header>
      <p className={styles.note}>{side === 'long' ? 'Long' : 'Short'}{Number.isFinite(leverage) && leverage > 0 ? ` · ${leverage}× initial leverage` : ''}</p>
      <div className={styles.reading}><label htmlFor="trade-scenario-change">Market change</label><output htmlFor="trade-scenario-change" data-tone={change < 0 ? 'negative' : change > 0 ? 'positive' : undefined}>{change > 0 ? '+' : ''}{change}%</output></div>
      <input id="trade-scenario-change" className={`lever ${styles.slider}`} style={{ '--fill': `${(change + 30) / 60 * 100}%` } as CSSProperties} type="range" min={-30} max={30} step={1} value={change} onChange={event => setChange(Number(event.target.value))} aria-valuetext={`${change}% market change`} />
      <div className={styles.scale}><span>−30%</span><span>0%</span><span>+30%</span></div>
      <dl className={styles.results} aria-live="polite"><div><dt>{market} at scenario price</dt><dd>{price !== null ? formatUsdPrice(price) : <MissingValue width="lg" status={live.status === 'connecting' || prices.status === 'loading' ? 'loading' : 'unavailable'} label="Scenario price" />}</dd></div><div><dt>Initial exposure sensitivity</dt><dd data-tone={sensitivity !== null && sensitivity < 0 ? 'negative' : sensitivity !== null && sensitivity > 0 ? 'positive' : undefined}>{sensitivity === null ? <MissingValue width="md" status="unavailable" label="Initial exposure sensitivity unavailable" /> : `${sensitivity > 0 ? '+' : ''}${sensitivity.toFixed(1)}%`}</dd></div></dl>
      <p className={styles.caption}>Sensitivity is not projected PnL. It excludes fees, changing leverage, rebalancing and liquidation. Actual outcomes depend on the price path.</p>
    </section>
    <section className={styles.surface} aria-labelledby="trade-conditions-title">
      <header className={styles.heading}><h2 id="trade-conditions-title">Protocol conditions</h2><span className={styles.caption}>Ethereum</span></header>
      <dl className={styles.conditions}>
        <div><dt><MetricLabel minimalHelp label="Gross funding charge" help={fundingDisplay?.title ?? `Current gross ${side}-pool collateral charge per eight hours. The earnings offset is unverified. Variable; separate from protocol and network fees.`} /></dt><dd title={fundingDisplay?.title}>{fundingDisplay?.value ?? <MissingValue width="lg" status={funding.status === 'loading' ? 'loading' : 'unavailable'} label={`${side === 'long' ? 'Long' : 'Short'} pool gross funding charge`} />}</dd></div>
        <div><dt><MetricLabel minimalHelp label="fxUSD reference" help="A display-only token market price from the app's price feed. It is not the protocol oracle price or an executable redemption value." /></dt><dd>{fxUSD !== undefined ? formatUsdPrice(fxUSD) : <MissingValue width="md" status={prices.status === 'loading' ? 'loading' : 'unavailable'} label="fxUSD reference price" />}</dd><small>Token market price</small></div>
        <div><dt><MetricLabel minimalHelp label="Pool capacity" help="Remaining collateral and debt capacity from the selected pool manager. These are separate protocol ceilings, not a maximum trade amount. K, M and B mean thousand, million and billion; approximate values are rounded down. Short debt room uses normalized 18-decimal accounting units; ETH shorts are shown in stETH equivalent. Review checks the route, balances and current limits." /></dt><dd title={capacity.value ? `${formatUnits(capacity.value.collateralRemaining, capacityUnits.collateralDecimals)} ${capacityUnits.collateralSymbol}` : undefined}>{capacity.value ? <>{formatCapacityDisplay(capacity.value.collateralRemaining, capacityUnits.collateralDecimals)} {capacityUnits.collateralSymbol}</> : <MissingValue width="lg" status={capacity.status === 'loading' ? 'loading' : 'unavailable'} label="Remaining pool collateral capacity" />}</dd><small>Collateral room · {side} pool</small>{capacity.value && <small title={`${formatUnits(capacity.value.debtRemaining, capacityUnits.debtDecimals)} ${capacityUnits.debtSymbol}`}>Debt room: {formatCapacityDisplay(capacity.value.debtRemaining, capacityUnits.debtDecimals)} {capacityUnits.debtSymbol}</small>}</div>
        <div><dt><MetricLabel minimalHelp label="Oracle difference" help="The selected pool's anchor oracle price relative to the market USD quote for the same token: (oracle ÷ market − 1) × 100. ETH long compares stETH; ETH short inverts its oracle to USD/wstETH. BTC compares WBTC. Oracle reads expire after 60 seconds; market quotes and observation times must be within five minutes. This comparison is separate from the pool's liquidation price." /></dt><dd>{oracleDifference ? `${oracleDifference.percent > 0 ? '+' : ''}${oracleDifference.percent.toFixed(2)}%` : <MissingValue width="md" status={oracle.status === 'loading' || prices.status === 'loading' ? 'loading' : 'unavailable'} label="Oracle and token market price difference" />}</dd>{oracleDifference && <small>{`${oracleDifference.token} · oracle vs market`}</small>}</div>
      </dl>
    </section>
    {positionsStatus !== 'disconnected' && <section className={styles.surface} aria-labelledby="trade-exposure-title"><header className={styles.heading}><h2 id="trade-exposure-title">Your existing exposure</h2><Link href="/positions">View positions <ChevronRight size={15} /></Link></header><p className={styles.note}>{positionsStatus === 'ready' && openPositions !== null ? `${openPositions} open ${market} position${openPositions === 1 ? '' : 's'}, across long and short. Review your positions before adding exposure.` : positionsStatus === 'loading' ? <MissingValue width="md" status="loading" label="Loading existing exposure" /> : 'Positions unavailable. Refresh your positions to check existing exposure.'}</p></section>}
    <details className={styles.protection}><summary><ShieldCheck size={19} />How protection works<ChevronRight size={17} /></summary><div className={styles.protectionBody}><p className={styles.note}>As risk increases, f(x) can rebalance positions at protocol thresholds, reducing exposure before liquidation. Rebalancing does not guarantee capital protection; losses and liquidation remain possible.</p><div className={styles.flow}><span><i><ChartNoAxesCombined /></i>Position</span><ArrowRight /><span><i><ShieldCheck /></i>Rebalance</span><ArrowRight /><span><i><TrendingDown /></i>Exposure reduced</span></div><Link href="/docs/guide/trade">How rebalancing works <ChevronRight size={15} /></Link></div></details>
  </div>;
}

export function RouteDelivery({ sourceChainId = 1, custom = false }: { sourceChainId?: 1 | 8453; custom?: boolean }) {
  const destination = sourceChainId === 1 ? 8453 : 1;
  const name = (id: number) => id === 1 ? 'Ethereum' : 'Base';
  return <details className={styles.protection}><summary><Globe size={19} />Route and delivery<ChevronRight size={17} /></summary><div className={styles.protectionBody}><p className={styles.note}>{custom ? 'Custom tokens use the configured cross-chain messaging route.' : 'fxUSD and fxSAVE bridge between Ethereum and Base using LayerZero.'} A source-chain confirmation and destination delivery are different events.</p><div className={styles.flow} role="img" aria-label={`${name(sourceChainId)} to ${name(destination)} via LayerZero`}><span><i><ChainIcon chainId={sourceChainId} size={28} /></i>{name(sourceChainId)}</span><ArrowRight /><span><i><Globe /></i>LayerZero</span><ArrowRight /><span><i><ChainIcon chainId={destination} size={28} /></i>{name(destination)}</span></div><div className={styles.links}><a href="https://layerzeroscan.com/" target="_blank" rel="noopener noreferrer">LayerZero Scan ↗</a><a href="https://docs.layerzero.network/" target="_blank" rel="noopener noreferrer">How messaging works ↗</a></div></div></details>;
}
