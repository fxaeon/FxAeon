'use client';

import { ShieldAlert } from 'lucide-react';
import { useLiveMarketQuote } from '@/components/PriceProvider';
import { liveQuotePending } from '@/lib/liveMarket';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { formatUsdPrice } from '@/lib/prices';
import type { MarketSymbol } from '@/lib/marketData';
import { Callout, PageSections, Section, StatGrid } from '@/components/PageSections';
import { YieldFlow } from '@/components/YieldFlow';
import { LeverageSplit } from '@/components/LeverageSplit';
import { leverageDebtLabel } from '@/lib/leverageShare';
import styles from '@/components/PageSections.module.css';

// Reviewed f(x) Protocol references, the same ones the landing page links.
const FX_REBALANCING_DOCS = 'https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/rebalancing-the-position-liquidation-brake';
const FX_BORROWING_DOCS = 'https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/fxmint-borrowing-fxusd-against-your-btc-and-eth';

// Each action page keeps its live facts, its f(x) explainer and what it needs
// to act safely; the general steps and questions live in the Docs guide, one
// quiet in-app link away.
const howItWorks = (section: 'trade' | 'earn' | 'borrow' | 'move') => ({ label: 'How it works', href: `/docs/guide/${section}` });

const rebalancingNote = <Callout icon={ShieldAlert} title="A brake before liquidation" link={{ label: 'How rebalancing works', href: FX_REBALANCING_DOCS }}>
  Automatic rebalancing can reduce leverage at protocol thresholds. Liquidation remains possible, so keep room between your position and the limits.
</Callout>;

/** Below the Trade ticket: the market's live facts and how leverage is built for the side chosen above. */
export function TradeSections({ market, side, leverage, openPositions, positionsStatus }: {
  market: MarketSymbol;
  side: 'long' | 'short';
  leverage: { min: number; max: number };
  /** Open positions in this market, the section's subject. */
  openPositions: number | null;
  positionsStatus: 'disconnected' | 'loading' | 'unavailable' | 'ready';
}) {
  const live = useLiveMarketQuote(market);
  // The live ticker carries the 24h range. Chart history stays cold until the
  // chart itself is opened, so a stale ticker shows the range as unavailable.
  const low = live.isFresh ? live.quote?.low24h : undefined;
  const high = live.isFresh ? live.quote?.high24h : undefined;
  const rangeStatus = liveQuotePending(live.status) ? 'loading' : 'unavailable';
  return <PageSections label={`${market} market details`}>
    <Section id="trade-market" title="Market details" action={{ label: 'Manage positions', href: '/positions' }}>
      <StatGrid stats={[
        { label: '24h low', value: <ValueOrSkeleton value={formatUsdPrice(low)} width="lg" status={rangeStatus} label="24 hour low" />, hint: 'Live market feed' },
        { label: '24h high', value: <ValueOrSkeleton value={formatUsdPrice(high)} width="lg" status={rangeStatus} label="24 hour high" />, hint: 'Live market feed' },
        { label: 'Leverage', value: `${leverage.min.toFixed(1)}×–${leverage.max.toFixed(1)}×`, hint: `${side === 'long' ? 'Long' : 'Short'} pool, live limit` },
        // Without a wallet there is nothing of yours to count, so the tile names the network instead.
        positionsStatus === 'disconnected'
          ? { label: 'Network', value: 'Ethereum', hint: 'f(x) Protocol pools' }
          : { label: 'Your positions', value: <ValueOrSkeleton value={positionsStatus === 'ready' && openPositions !== null ? `${openPositions} open` : '—'} width="md" status={positionsStatus === 'loading' ? 'loading' : 'unavailable'} label={`Your open ${market} positions`} />, hint: `${market}, long and short` },
      ]} />
    </Section>
    {rebalancingNote}
    <Section id="trade-leverage" title="How leverage works" expandable action={howItWorks('trade')}>
      {/* The ticket's slider states the chosen leverage live; these examples follow its side. */}
      <p className={styles.lede}>{side === 'long'
        ? 'On f(x) Protocol, a long’s leverage is fxUSD minted against its collateral. Before fees, a 3× long is two thirds minted fxUSD and one third yours.'
        : `A short deposits fxUSD and borrows ${market === 'ETH' ? 'wstETH' : 'WBTC'} from f(x) Protocol’s long-side reserve. Before fees, a 3× short is three quarters borrowed and one quarter yours.`}</p>
      <LeverageSplit side={side} debtLabel={leverageDebtLabel(side, market)} />
    </Section>
  </PageSections>;
}

/** Below the fxSAVE form: vault facts and where its yield comes from. */
export function EarnSections({ cooldown, instantFee, vaultStatus }: {
  cooldown: string | null;
  instantFee: string | null;
  /** How the vault configuration read stands while its values are missing. */
  vaultStatus: 'loading' | 'unavailable';
}) {
  return <PageSections label="fxSAVE details">
    <Section id="earn-glance" title="Withdrawal terms">
      <StatGrid stats={[
        { label: 'Withdrawal cooldown', value: <ValueOrSkeleton value={cooldown ?? '—'} width="md" status={vaultStatus} label="Withdrawal cooldown" />, hint: 'For queued withdrawals' },
        { label: 'Instant withdrawal fee', value: <ValueOrSkeleton value={instantFee ?? '—'} width="md" status={vaultStatus} label="Instant withdrawal fee" />, hint: 'Skip the cooldown' },
      ]} />
    </Section>
    <Section id="earn-yield" title="How fxSAVE earns yield" expandable action={howItWorks('earn')}>
      <p className={styles.lede}>fxSAVE holds f(x) Protocol stability pool shares and compounds what they earn, so its value per share follows the vault. The APY is variable.</p>
      <YieldFlow />
    </Section>
  </PageSections>;
}

/** Below the Borrow form: the pool's terms and the brake to keep in mind. */
export function BorrowSections({ ltvLimit }: { ltvLimit: string }) {
  return <PageSections label="Borrowing details">
    <Section id="borrow-glance" title="Borrowing terms" action={{ label: 'Borrowing details', href: FX_BORROWING_DOCS, external: true }}>
      <StatGrid stats={[
        // The form's meter stops a little lower; this names why the two figures differ.
        { label: 'Loan-to-value limit', value: ltvLimit, hint: 'Pool maximum; FxAeon keeps a small margin' },
        { label: 'Annual interest', value: '0%', hint: 'In normal conditions; protocol fees apply' },
        { label: 'Collateral', value: 'ETH · BTC', hint: 'ETH, WETH, stETH, wstETH, or WBTC' },
        { label: 'You borrow', value: 'fxUSD', hint: 'On Ethereum' },
      ]} />
    </Section>
    <Section id="borrow-safety" title="Before you borrow" action={howItWorks('borrow')}>
      {rebalancingNote}
    </Section>
  </PageSections>;
}

/** Below Move: the supported routes. */
export function MoveSections() {
  return <PageSections label="Move details">
    <Section id="move-glance" title="Transfer details" action={howItWorks('move')}>
      <StatGrid stats={[
        { label: 'Bridge', value: 'LayerZero', hint: 'Delivery verified by events' },
        { label: 'Fee', value: 'At review', hint: 'Paid in ETH on the source network' },
      ]} />
    </Section>
  </PageSections>;
}
