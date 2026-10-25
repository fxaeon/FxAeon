'use client';

import { TradeContext, RouteDelivery } from './TradeContext';

import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';


import { ValueOrSkeleton } from '@/components/MissingValue';

import type { MarketSymbol } from '@/lib/marketData';
import { Callout, PageSections, Section, StatGrid } from '@/components/PageSections';
import { YieldFlow } from '@/components/YieldFlow';

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
export function TradeSections(props: {
  market: MarketSymbol; side: 'long' | 'short'; leverage: { min: number; max: number }; selectedLeverage: number;
  openPositions: number | null;
  positionsStatus: 'disconnected' | 'loading' | 'unavailable' | 'ready';
}) {
  return <TradeContext market={props.market} side={props.side} leverage={props.selectedLeverage} openPositions={props.openPositions} positionsStatus={props.positionsStatus} />;
}

/** Below the fxSAVE form: vault facts and where its yield comes from. */
export function EarnSections({ cooldown, instantFee, vaultStatus, showWithdrawalTerms = true, termsNotice }: {
  cooldown: string | null;
  instantFee: string | null;
  /** How the vault configuration read stands while its values are missing. */
  vaultStatus: 'loading' | 'unavailable';
  showWithdrawalTerms?: boolean;
  termsNotice?: ReactNode;
}) {
  return <PageSections label="fxSAVE details">
    {showWithdrawalTerms && <Section id="earn-glance" title="Withdrawal terms" expandable>
      {!cooldown && !instantFee && termsNotice ? termsNotice : <StatGrid stats={[
        { label: 'Withdrawal cooldown', value: <ValueOrSkeleton value={cooldown ?? '—'} width="md" status={vaultStatus} label="Withdrawal cooldown" />, hint: 'For queued withdrawals' },
        { label: 'Instant withdrawal fee', value: <ValueOrSkeleton value={instantFee ?? '—'} width="md" status={vaultStatus} label="Instant withdrawal fee" />, hint: 'Skip the cooldown' },
      ]} />}
      <p className={styles.lede}>Queued withdrawals require a separate claim transaction and may pay out both fxUSD and USDC.</p>
    </Section>}
    <Section id="earn-yield" title="How fxSAVE earns yield" expandable action={howItWorks('earn')}>
      <p className={styles.lede}>fxSAVE holds f(x) Protocol stability pool shares and compounds what they earn, so its value per share follows the vault. The APY is variable.</p>
      <YieldFlow />
    </Section>
  </PageSections>;
}

/** Below the Borrow form: the pool's terms and the brake to keep in mind. */
export function BorrowSections({ ltvLimit }: { ltvLimit: string }) {
  return <PageSections label="Borrowing details">
    <Section id="borrow-glance" title="Borrowing terms & risk" expandable action={{ label: 'Borrowing details', href: FX_BORROWING_DOCS, external: true }}>
      <StatGrid stats={[
        // The displayed pool maximum is distinct from the guarded form ceiling.
        { label: 'Pool maximum LTV', value: ltvLimit, hint: 'The form keeps a buffer below this limit' },
        { label: 'Action fees', value: 'Opening · repayment', hint: 'Funding charges are shown separately' },
        { label: 'Collateral', value: 'ETH · BTC', hint: 'ETH, WETH, stETH, wstETH, or WBTC' },
        { label: 'You borrow', value: 'fxUSD', hint: 'On Ethereum' },
      ]} />
      {rebalancingNote}
    </Section>
  </PageSections>;
}

/** Below Move: the supported routes. */
export function MoveSections({ sourceChainId, custom }: { sourceChainId?: 1 | 8453; custom?: boolean }) {
  return <RouteDelivery sourceChainId={sourceChainId} custom={custom} />;
}
