'use client';

import { Fragment, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, ChevronDown, ChevronRight, Code, Copy, ExternalLink,
  CircleAlert, History, Landmark, PiggyBank, RefreshCw, Search, ShieldCheck, TrendingDown, TrendingUp, X, type LucideIcon,
} from 'lucide-react';
import { formatUnits, type Address, type Hex } from 'viem';
import { useQuery } from '@tanstack/react-query';
import TokenIcon, { ChainIcon } from './TokenIcon';
import { SectionTitle } from './ui';
import { FilterSelect } from './FilterSelect';
import { BridgeTracker } from './BridgeTracker';
import { AmountUsd } from '@/components/review/AmountUsd';
import { useUsdPrices } from '@/components/PriceProvider';
import { useWalletActivity } from '@/lib/useWalletActivity';
import { mergeWalletActivity, operationTitle, type WalletActivity as Activity } from '@/lib/walletActivity';
import {
  activityLegs, flowSymbolText, formatActivityAmount, networkName, UNVERIFIED_TOKEN_ICON,
  type ActivityClassification, type ActivityFlow, type ActivityGlyph, type ActivityLeg,
} from '@/lib/activityClassification';
import { activityDayKey, activityDayLabel, activityRelativeTime } from '@/lib/activityTime';
import { cancelSignatureRequiredDraft, signatureDraftResumePath } from '@/lib/fx/drafts';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import { useExitPresence } from '@/lib/useExitPresence';
import { compactAddress } from '@/lib/addressPresentation';
import { openExternalLink } from '@/lib/telegram';
import { copyText } from '@/lib/clipboard';
import { formatUsd, usdValueForUnits, type UsdPriceMap } from '@/lib/prices';
import type { FxTokenKey } from '@/lib/fx/tokens';
import { loadActivityReceipt } from '@/lib/activityReceipt';
import { readableReviewAmount } from './review/reviewHierarchy';
import { useTransactionEvidence } from './review/TransactionEvidenceContext';
import styles from './WalletActivity.module.css';
import filterStyles from './FilterSelect.module.css';

const GLYPHS: Record<ActivityGlyph, LucideIcon> = {
  send: ArrowUpRight, receive: ArrowDownLeft, swap: ArrowLeftRight, move: ArrowLeftRight, long: TrendingUp,
  short: TrendingDown, earn: PiggyBank, borrow: Landmark, approve: ShieldCheck, contract: Code,
};

export default function WalletActivity({ walletAddress, compact = false, inDialog = false }: { walletAddress: Address; compact?: boolean; inDialog?: boolean }) {
  // A new account owns a new selection/filter state as well as a separate query cache.
  return <ActivityFeed key={walletAddress.toLowerCase()} walletAddress={walletAddress} compact={compact || inDialog} inDialog={inDialog} />;
}

/** Rows in the shape of the activity they stand in for: mark, title and place, amount. */
function ActivityRowsSkeleton({ count, label }: { count: number; label: string }) {
  return <div role="status" aria-label={label} className={styles.loading}>
    <ul className={styles.list} aria-hidden="true">{Array.from({ length: count }, (_, index) => <li key={index}><span className={styles.skeletonRow}>
      <span className={`skeleton ${styles.skeletonMark}`} />
      <span className={styles.skeletonLines}><span className="skeleton" /><span className="skeleton" /></span>
      <span className={`${styles.skeletonLines} ${styles.skeletonOutcome}`}><span className="skeleton" /><span className="skeleton" /></span>
    </span></li>)}</ul>
  </div>;
}

/**
 * The History page before the wallet is known: the feed's filters and search
 * in place (inactive), a day and five waiting rows, exactly as the live feed
 * draws its first read, so the page does not change shape when it arrives.
 */
export function HistoryFeedSkeleton() {
  return <section className={styles.section} data-full-history aria-label="Transaction history" aria-busy="true">
    <h2 className="sr-only">History</h2>
    <div className={styles.filters} aria-hidden="true" inert>
      {['All activity', 'All networks'].map(label => <div key={label} className={filterStyles.root}><button type="button" role="combobox" aria-expanded="false" tabIndex={-1} className={filterStyles.trigger}><span>{label}</span><ChevronDown size={16} aria-hidden="true" /></button></div>)}
      <button type="button" tabIndex={-1} className={styles.refresh}><RefreshCw size={16} aria-hidden="true" /></button>
      <label data-focus-field className={styles.search}><Search size={16} aria-hidden="true" /><input tabIndex={-1} placeholder="Search activity" readOnly /></label>
    </div>
    <span className={`skeleton ${styles.skeletonDay}`} aria-hidden="true" />
    <ActivityRowsSkeleton count={5} label="Loading history" />
  </section>;
}

/** Portfolio's history preview before the wallet is known: its heading, links and three waiting rows. */
export function RecentActivitySkeleton() {
  return <section className={styles.section} aria-label="Recent history" aria-busy="true">
    <SectionTitle right={<div className={styles.toolbar}>
      <Link href="/history" aria-label="View all history">View all<ChevronRight size={14} aria-hidden="true" /></Link>
      <button type="button" className={styles.refresh} aria-label="Refresh history" title="Refresh history" disabled><RefreshCw size={16} aria-hidden="true" /></button>
    </div>}>History</SectionTitle>
    <ActivityRowsSkeleton count={3} label="Loading history" />
  </section>;
}

function searchText(item: Activity): string {
  const { classification } = item;
  return [item.title, classification.summary, item.hash, classification.counterparty?.label, classification.counterparty?.address,
    ...[...classification.flowsIn, ...classification.flowsOut].flatMap((flow) => [flow.symbol, flowSymbolText(flow)])].join(' ').toLowerCase();
}

/** Rows grouped under local day headers, newest first. */
function byDay(rows: readonly Activity[]): { key: string; label: string; rows: Activity[] }[] {
  const groups: { key: string; label: string; rows: Activity[] }[] = [];
  for (const row of rows) {
    const key = activityDayKey(row.timestamp);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.rows.push(row);
    else groups.push({ key, label: activityDayLabel(row.timestamp), rows: [row] });
  }
  return groups;
}

function ActivityFeed({ walletAddress, compact, inDialog }: { walletAddress: Address; compact: boolean; inDialog: boolean }) {
  const activity = useWalletActivity(walletAddress);
  const { prices } = useUsdPrices();
  const [search, setSearch] = useState('');
  const [chain, setChain] = useState('all');
  const [filter, setFilter] = useState('all');
  const [showUnverified, setShowUnverified] = useState(false);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { data } = activity;
  // Each source keeps its identity between renders, so typing in search never re-explains the feed.
  const rows = useMemo(() => mergeWalletActivity(data.views, data.protocol?.items ?? [], data.transfers, walletAddress, {
    positionTransfers: data.positionTransfers ?? [], calls: data.calls ?? {},
  }), [data.views, data.protocol, data.transfers, data.positionTransfers, data.calls, walletAddress]);
  const query = search.trim().toLowerCase();
  const filtered = rows.filter((item) => (chain === 'all' || String(item.chainId) === chain)
    // Indexed rows are mined transfers; they belong with confirmed activity.
    && (filter === 'all' || item.status === filter || (filter === 'confirmed' && item.status === 'indexed'))
    && (!query || searchText(item).includes(query)));
  const verified = filtered.filter((item) => !item.spamSuspect);
  const unverified = filtered.filter((item) => item.spamSuspect);
  const visible = compact ? verified.slice(0, 3) : verified;
  const drafts = data.drafts ?? [];
  const unavailable = !activity.isPending && rows.length === 0 && data.partial;
  const narrowed = Boolean(query) || filter !== 'all' || chain !== 'all';
  // The wallet dialog keeps its own History row, so it only previews rows that exist.
  if (inDialog && !activity.isPending && verified.length === 0) return null;
  const open = (item: Activity) => (event: React.MouseEvent<HTMLButtonElement>) => { triggerRef.current = event.currentTarget; setSelected(item); setDetailOpen(true); };
  const retry = () => void activity.refetch();
  const refresh = <button type="button" className={styles.refresh} aria-label="Refresh history" title="Refresh history" disabled={activity.isFetching} onClick={retry}>
    <RefreshCw size={16} className={activity.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
  </button>;
  const list = (items: readonly Activity[]) => compact
    ? <ul className={styles.list}>{items.map((item) => <li key={item.id}><ActivityRow item={item} prices={prices} grouped={false} onOpen={open(item)} /></li>)}</ul>
    : byDay(items).map((day) => <Fragment key={day.key}>
      <h3 className={styles.day}>{day.label}</h3>
      <ul className={styles.list}>{day.rows.map((item) => <li key={item.id}><ActivityRow item={item} prices={prices} grouped onOpen={open(item)} /></li>)}</ul>
    </Fragment>);
  return <section className={styles.section} data-full-history={!compact || undefined} aria-label={compact ? 'Recent history' : 'Transaction history'}>
    {compact ? <SectionTitle level={inDialog ? 3 : 2} right={<div className={styles.toolbar}>
      {!inDialog && <Link href="/history" aria-label="View all history">View all<ChevronRight size={14} aria-hidden="true" /></Link>}
      {refresh}
    </div>}>History</SectionTitle> : <h2 className="sr-only">History</h2>}
    {!compact && <div className={styles.filters}>
      <FilterSelect label="Activity status" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All activity' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'pending', label: 'Pending' }, { value: 'failed', label: 'Failed' }]} />
      <FilterSelect label="Activity network" value={chain} onChange={setChain} options={[{ value: 'all', label: 'All networks' }, { value: '1', label: 'Ethereum' }, { value: '8453', label: 'Base' }]} />
      {refresh}
      <label data-focus-field className={styles.search}><Search size={16} aria-hidden="true" /><input aria-label="Search activity" placeholder="Search activity" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    </div>}
    {!compact && drafts.length > 0 && <details className={styles.drafts}><summary>Drafts <span>({drafts.length})</span></summary>
      {drafts.map((draft) => <div key={draft.id}><span>{operationTitle(draft.operation)}</span><small>Unsubmitted</small>
        <Link href={signatureDraftResumePath(draft)}>Continue</Link><button type="button" aria-label="Dismiss" title="Dismiss draft" onClick={() => { cancelSignatureRequiredDraft(draft.id); void activity.refetch(); }}><X size={16} aria-hidden="true" /></button></div>)}
    </details>}
    {!activity.isPending && rows.length > 0 && data.partial && <p role="status" className={styles.notice}>
      <span>Some activity could not be loaded.</span>
      <button type="button" disabled={activity.isFetching} onClick={retry}>Retry</button>
    </p>}
    {activity.isPending ? <>{!compact && <span className={`skeleton ${styles.skeletonDay}`} aria-hidden="true" />}<ActivityRowsSkeleton count={compact ? 3 : 5} label="Loading history" /></>
      : unavailable ? <div role="status" className={styles.unavailable} data-full={!compact || undefined}>
        {!compact && <CircleAlert size={24} aria-hidden="true" />}
        <span><strong>Couldn’t load history</strong><small>Your transactions are unaffected. Try loading them again.</small></span>
        <button type="button" disabled={activity.isFetching} onClick={retry}><RefreshCw size={15} aria-hidden="true" />{activity.isFetching ? 'Loading…' : 'Retry'}</button></div>
      : verified.length > 0 ? list(visible)
      : rows.length === 0 ? <div className={styles.empty} data-compact={compact || undefined}>
        {!compact && <History size={24} aria-hidden="true" />}
        <strong>No activity yet</strong><span>Trades, deposits, moves and transfers from this wallet appear here.</span>
        {!compact && <Link href="/qr">Receive assets</Link>}
      </div>
      : narrowed ? <div className={styles.empty}>
        <strong>No matching activity</strong><span>Nothing in this wallet’s history matches these filters.</span>
        <button type="button" onClick={() => { setSearch(''); setFilter('all'); setChain('all'); }}>Clear filters</button>
      </div>
      : <div className={styles.empty} data-compact={compact || undefined}>
        <strong>Only unverified tokens so far</strong>
        <span>{compact ? 'Tokens FxAeon doesn’t recognize stay in the full history.' : 'Tokens FxAeon doesn’t recognize are kept below and may be spam.'}</span>
      </div>}
    {!compact && loadMoreFailed && !loadingMore && <p role="status" className={styles.loadMoreError}>Older activity couldn’t load. Nothing above changed.</p>}
    {!compact && activity.hasMore && <button type="button" className={styles.more} disabled={loadingMore} onClick={() => {
      setLoadingMore(true); setLoadMoreFailed(false);
      void activity.loadMore().catch(() => setLoadMoreFailed(true)).finally(() => setLoadingMore(false));
    }} aria-busy={loadingMore}>{loadingMore ? <><RefreshCw size={16} className="animate-spin" aria-hidden="true" />Loading more…</> : loadMoreFailed ? 'Try again' : 'Load more'}</button>}
    {!compact && unverified.length > 0 && <>
      <button type="button" className={styles.unverifiedToggle} aria-expanded={showUnverified} onClick={() => setShowUnverified((value) => !value)}>
        {showUnverified ? 'Hide' : 'Show'} unverified ({unverified.length})<ChevronDown size={16} aria-hidden="true" data-open={showUnverified || undefined} />
      </button>
      {showUnverified && <div className={styles.unverifiedList}>
        <p>Tokens FxAeon does not recognize. They may be spam; never interact with links in their names.</p>
        {list(unverified)}
      </div>}
    </>}
    {selected && <ActivityDetail key={selected.id} item={rows.find((item) => item.id === selected.id) ?? selected} open={detailOpen}
      onClose={() => setDetailOpen(false)} triggerRef={triggerRef} prices={prices} />}
  </section>;
}

function priceFor(flow: ActivityFlow, prices: UsdPriceMap): number | null {
  if (!flow.verified || flow.decimals === null) return null;
  return usdValueForUnits(flow.amountRaw, flow.decimals, prices[flow.symbol as FxTokenKey]);
}

/** A leg's text with an "unverified" marker whenever its symbol is not canonical. */
function legText(leg: ActivityLeg): string {
  return leg.flow.verified ? displayLegText(leg) : `${displayLegText(leg)} (unverified)`;
}

/** Display-only rounding matches review/receipts; original exact values stay available. */
function displayLegAmount(leg: ActivityLeg): string {
  if (leg.flow.amount === null) return 'Amount unknown';
  const display = readableReviewAmount(leg.flow.exact ?? leg.flow.amount);
  return `${display.shortened ? '≈ ' : ''}${leg.direction === 'in' ? '+' : '−'}${display.value}`;
}

function displayLegText(leg: ActivityLeg): string {
  return `${displayLegAmount(leg)} ${flowSymbolText(leg.flow)}`;
}

type Secondary = { text: string; tone?: 'warn' | 'danger'; title?: string };

/** Exact signed amount for a title tooltip. */
const exactLegText = (leg: ActivityLeg) => `${leg.direction === 'in' ? '+' : '−'}${leg.flow.exact ?? leg.flow.amount ?? '?'} ${flowSymbolText(leg.flow)}${leg.flow.verified ? '' : ' (unverified)'}`;

/** The right side of a row: a signed headline amount and one quiet line beneath it. Never blank. */
function rowOutcome(item: Activity, prices: UsdPriceMap): { primary?: ActivityLeg; secondary?: Secondary } {
  const { classification } = item;
  const { primary, others } = activityLegs(classification);
  if (item.status === 'pending') return { primary, secondary: { text: item.statusLabel || 'Pending', tone: 'warn' } };
  if (item.status === 'failed') return { primary, secondary: { text: 'Failed', tone: 'danger' } };
  if (primary && !primary.flow.verified) return { primary, secondary: { text: 'Unverified token', tone: 'warn' } };
  if (item.statusLabel === 'Source confirmed') return { primary, secondary: { text: 'Source confirmed' } };
  if (others.length) {
    const shown = others.slice(0, 2).map(legText);
    return { primary, secondary: {
      text: others.length > 2 ? `${shown.join(' · ')} · +${others.length - 2} more` : shown.join(' · '),
      title: others.map(exactLegText).join(' · '),
    } };
  }
  const usd = primary ? priceFor(primary.flow, prices) : null;
  if (usd !== null) return { primary, secondary: { text: formatUsd(usd) } };
  if (classification.approval?.unlimited) return { primary, secondary: { text: 'Unlimited' } };
  if (primary) return { primary };
  return { secondary: { text: item.statusLabel || (item.status === 'indexed' ? 'No tokens moved' : 'Confirmed') } };
}

function TokenMark({ symbol, size }: { symbol: string; size: number }) {
  if (symbol === UNVERIFIED_TOKEN_ICON) return <span className={styles.unverifiedMark} style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}>?</span>;
  return <TokenIcon symbol={symbol} size={size} />;
}

/** One or two token marks with a small badge naming the action. Decorative: the row text says it all. */
function ActivityIcon({ classification, size = 40 }: { classification: ActivityClassification; size?: number }) {
  const Glyph = GLYPHS[classification.glyph];
  const [first, second] = classification.icons;
  const pair = Math.round(size * 0.72);
  return <span className={styles.icon} style={{ width: size, height: size }} aria-hidden="true">
    {!first ? <span className={styles.glyphOnly} data-tone={classification.kind === 'failed' ? 'danger' : undefined}><Glyph size={Math.round(size * 0.45)} strokeWidth={2} /></span>
      : !second ? <TokenMark symbol={first} size={size} />
      : <><span className={styles.pairBack}><TokenMark symbol={first} size={pair} /></span><span className={styles.pairFront}><TokenMark symbol={second} size={pair} /></span></>}
    {first && <span className={styles.badge} data-tone={classification.kind === 'failed' ? 'danger' : undefined}><Glyph size={11} strokeWidth={2.6} /></span>}
  </span>;
}

function ActivityRow({ item, prices, grouped, onOpen }: { item: Activity; prices: UsdPriceMap; grouped: boolean; onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
  const { classification } = item;
  const { primary, secondary } = rowOutcome(item, prices);
  const network = networkName(item.chainId);
  const where = classification.counterparty
    ? [classification.counterparty.label, item.chainId === 8453 ? network : null] : [network];
  const subtitle = [...where, activityRelativeTime(item.timestamp, Date.now(), grouped)].filter(Boolean).join(' · ');
  return <button type="button" className={styles.row} onClick={onOpen}>
    <ActivityIcon classification={classification} />
    <span className={styles.label}><strong>{item.title}</strong><span title={subtitle}>{subtitle}</span></span>
    <span className={styles.outcome}>
      {primary && <strong className={styles.amount} data-direction={primary.direction} title={exactLegText(primary)}>{displayLegText(primary)}</strong>}
      {secondary && <span className={styles.secondary} data-tone={secondary.tone} title={secondary.title ?? secondary.text}>{secondary.text}</span>}
    </span>
    <ChevronRight size={15} className={styles.chevron} aria-hidden="true" />
  </button>;
}

const explorerHost = (chainId: 1 | 8453) => chainId === 1 ? 'https://etherscan.io' : 'https://basescan.org';

function ExplorerLink({ href, children, label }: { href: string; children: React.ReactNode; label?: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}
    onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && openExternalLink(href)) event.preventDefault(); }}>
    {children}<ExternalLink size={14} aria-hidden="true" />
  </a>;
}

function FlowList({ label, legs, prices }: { label: string; legs: ActivityLeg[]; prices: UsdPriceMap }) {
  return <section className={styles.flows} aria-label={label}>
    <h3>{label}</h3>
    <ul>{legs.map((leg) => {
      const usd = priceFor(leg.flow, prices);
      return <li key={`${leg.direction}:${leg.flow.token ?? 'native'}`} className={styles.flow}>
        <span className={styles.flowMark} aria-hidden="true"><TokenMark symbol={leg.flow.verified ? leg.flow.symbol : UNVERIFIED_TOKEN_ICON} size={40} /></span>
        <span className={styles.flowAmount}>
          <strong data-direction={leg.direction} title={leg.flow.exact ?? undefined}>{displayLegAmount(leg)} <span className={styles.flowUnit} title={leg.flow.token ?? undefined}>{flowSymbolText(leg.flow)}</span></strong>
          <span className={styles.flowMeta}>
            {usd !== null && <small>{formatUsd(usd)}</small>}
            {!leg.flow.verified && <span className={styles.unverified}>Unverified</span>}
          </span>
        </span>
      </li>;
    })}</ul>
  </section>;
}

function counterpartyTerm(classification: ActivityClassification): string {
  const kind = classification.kind === 'failed' ? classification.attempted : classification.kind;
  if (kind === 'send') return 'To';
  if (kind === 'receive' || kind === 'bridgeIn') return 'From';
  if (kind === 'approve') return 'Spender';
  return 'With';
}

function ActivityDetail({ item, open, onClose, triggerRef, prices }: { item: Activity; open: boolean; onClose: () => void; triggerRef: React.RefObject<HTMLButtonElement | null>; prices: UsdPriceMap }) {
  const simulation = useTransactionEvidence() === 'simulation';
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const ref = useOverlayDialog<HTMLDivElement>({ open, onClose, triggerRef, initialFocusRef: closeRef });
  const present = useExitPresence(open, item.id);
  const view = item.recovery;
  const { classification } = item;
  const receipt = useQuery({ queryKey: ['activity-receipt', item.chainId, item.hash],
    enabled: open && !view, staleTime: 300_000, gcTime: 600_000, retry: false, refetchOnWindowFocus: false,
    queryFn: () => loadActivityReceipt(item.chainId, item.hash as Hex),
  });
  const indexedReceipt = !view ? receipt.data : undefined;
  const failed = indexedReceipt?.status === 'failed' || item.status === 'failed';
  const legs = activityLegs(classification);
  const all = [...(legs.primary ? [legs.primary] : []), ...legs.others];
  const sent = failed ? [] : all.filter((leg) => leg.direction === 'out');
  const received = failed ? [] : all.filter((leg) => leg.direction === 'in');
  const costWei = view?.receiptExecutionCostWei ?? indexedReceipt?.executionCost;
  const cost = costWei !== undefined ? formatActivityAmount(costWei, 18) : null;
  const status = indexedReceipt ? indexedReceipt.status === 'confirmed' ? 'Confirmed' : 'Failed'
    : view || item.statusLabel ? item.statusLabel
      : receipt.isFetching ? 'Checking…' : null;
  const statusTone = indexedReceipt?.status ?? item.status;
  // Only amounts that rounding changed need their exact value spelled out.
  const rounded = [...sent, ...received].filter((leg) => leg.flow.exact !== null && (leg.flow.exact !== leg.flow.amount?.replace(/,/g, '') || readableReviewAmount(leg.flow.exact).shortened));
  const exactLine = rounded.map((leg) => `${leg.direction === 'in' ? '+' : '−'}${leg.flow.exact} ${flowSymbolText(leg.flow)}${leg.flow.verified ? '' : ' (unverified)'}`).join(', ');
  const counterparty = classification.counterparty;
  const bridge = view?.record.bridge;
  const explorer = `${explorerHost(item.chainId)}/tx/${item.hash}`;
  const showSummary = failed || (item.status === 'indexed' && indexedReceipt?.status !== 'confirmed') || item.status === 'pending' || item.statusLabel === 'Source confirmed'
    || (sent.length === 0 && received.length === 0)
    || (view !== undefined && view.verification !== 'receipt');
  if (!present || typeof document === 'undefined') return null;
  return createPortal(<div className={styles.backdrop} data-state={open ? 'open' : 'closed'} inert={!open} aria-hidden={!open || undefined} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Transaction details" className={styles.sheet}>
      <span className={styles.handle} aria-hidden="true" />
      <header>
        <ActivityIcon classification={classification} size={44} />
        <div><h2>{classification.title}</h2>{showSummary && <p>{failed && !view ? `This transaction failed on ${networkName(item.chainId)}. Nothing moved except the network fee.` : classification.summary}</p>}</div>
        <button ref={closeRef} type="button" aria-label="Close transaction details" onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </header>
      <div className={styles.detailBody}>
        {sent.length > 0 && <FlowList label={item.status === 'pending' ? 'Sending' : 'You sent'} legs={sent} prices={prices} />}
        {received.length > 0 && <FlowList label={item.status === 'pending' ? 'Receiving' : 'You received'} legs={received} prices={prices} />}
        {(sent.length > 0 || received.length > 0) && Object.keys(prices).length > 0 && <p className={styles.caption}>USD values use current prices.</p>}
        <dl className={styles.facts}>
          {classification.approval && <div><dt>Allowance</dt><dd>{classification.approval.unlimited ? 'Unlimited'
            : classification.approval.amount !== null ? `${classification.approval.amount} ${classification.approval.verified ? classification.approval.token : 'tokens'}` : 'Not shown'}</dd></div>}
          {counterparty && <div><dt>{counterpartyTerm(classification)}</dt><dd className={styles.party}>
            {counterparty.known && <span>{counterparty.label}</span>}
            <ExplorerLink href={`${explorerHost(item.chainId)}/address/${counterparty.address}`} label={`View ${counterparty.known ? counterparty.label : compactAddress(counterparty.address)} on ${item.chainId === 1 ? 'Etherscan' : 'Basescan'}`}>
              <span title={counterparty.address}>{compactAddress(counterparty.address)}</span>
            </ExplorerLink>
          </dd></div>}
          <div><dt>Network</dt><dd><span className={styles.factIcon} aria-hidden="true"><ChainIcon chainId={item.chainId} size={18} /></span>{networkName(item.chainId)}</dd></div>
          {cost && costWei !== undefined && <div><dt>{item.chainId === 8453 ? 'Execution cost' : 'Network cost'}</dt><dd title={`${formatUnits(costWei, 18)} ETH`}><span>{cost} ETH<AmountUsd amount={formatUnits(costWei, 18)} symbol="ETH" receipt /></span></dd></div>}
          {status && <div><dt>Status</dt><dd data-status={statusTone}>{status}</dd></div>}
          <div><dt>Date</dt><dd>{new Date(item.timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
          <div><dt>Transaction</dt><dd>{simulation ? <span>Simulated receipt</span> : <ExplorerLink href={explorer} label={`View transaction ${compactAddress(item.hash)} on ${item.chainId === 1 ? 'Etherscan' : 'Basescan'}`}>{compactAddress(item.hash)}</ExplorerLink>}</dd></div>
        </dl>
        {exactLine && <div className={styles.exact}>
          <div><small>Exact amounts</small><code>{exactLine}</code></div>
          <button type="button" aria-label={copied ? 'Exact amounts copied' : 'Copy exact amounts'} title="Copy exact amounts" onClick={async () => {
            if (await copyText(exactLine)) { setCopied(true); setTimeout(() => setCopied(false), 1_800); }
          }}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button>
        </div>}
        {item.positions.length > 0 && <div className={styles.positionLinks}>{item.positions.map((position) => <Link key={`${position.poolAddress}:${position.positionId}`} href={`/positions?position=${encodeURIComponent(`${position.market}:${position.side}:${position.positionId}`)}`}>{position.market} {position.side} #{position.positionId}<ChevronRight size={16} aria-hidden="true" /></Link>)}</div>}
        {view && <details className={styles.technical}><summary>Show more</summary>
          <dl className={styles.facts}><div><dt>To</dt><dd title={view.record.to}>{compactAddress(view.record.to)}</dd></div>
            {view.receiptBlockNumber !== undefined && <div><dt>Block</dt><dd>{view.receiptBlockNumber.toString()}</dd></div>}</dl>
          {view.verification !== 'receipt' && <p>{view.message}</p>}
          {item.chainId === 8453 && cost && <p>The execution cost covers Base gas only; the L1 data and operator fees are not included.</p>}
        </details>}
        {open && bridge && view?.status === 'confirmed' && <BridgeTracker sourceChain={item.chainId === 1 ? 'Ethereum' : 'Base'} destinationChain={bridge.destinationChainId === 1 ? 'Ethereum' : 'Base'}
          token={bridge.bridgeToken ?? 'Bridge asset'} amount={formatActivityAmount(BigInt(bridge.amountLD), 18) ?? ''} sourceTxHash={view.record.hash} status="source_confirmed" sourceOftAddress={bridge.sourceOftAddress} destinationOftAddress={bridge.destinationOftAddress}
          recipient={bridge.recipient} sourceSender={view.record.walletAddress} amountLD={BigInt(bridge.amountLD)} minAmountLD={BigInt(bridge.minAmountLD)} destinationBaselineBlock={BigInt(bridge.destinationBaselineBlock)} autoStart />}
      </div>
      <footer><button type="button" onClick={onClose}>Close</button></footer>
    </div>
  </div>, document.body);
}
