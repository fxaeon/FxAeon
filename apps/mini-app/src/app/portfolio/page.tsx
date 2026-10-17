'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  CandlestickChart,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Layers2,
  PiggyBank,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { formatUnits, type Address } from 'viem';
import { MarketMiniCard } from '@/components/MarketChart';
import { useUsdPrices } from '@/components/PriceProvider';
import { useFxSaveClaimable, useWalletBalances } from '@/components/WalletDataProvider';
import { useWalletAssets, useRealtimeChainState } from '@/components/WalletDataProvider';
import {
  positionIsStale,
  ProtocolPositionCard,
  ProtocolPositionList,
  ProtocolPositionNotice,
  ProtocolPositionSkeleton,
} from '@/components/ProtocolPositionCard';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import RecentActivityPreview from '@/components/RecentActivityPreview';
import { RecentActivitySkeleton } from '@/components/WalletActivity';
import TokenIcon from '@/components/TokenIcon';
import { AppShell, SectionTitle } from '@/components/ui';
import { PageHeading, StatusNotice } from '@/components/ProductUI';
import { formatExactDecimal } from '@/lib/amount';
import { freshDisplayPrices } from '@/lib/displayPrices';
import presentation from '@/components/PortfolioWorkspace.module.css';
import balancePresentation from '@/components/BalanceSummary.module.css';
import {
  assertConfiguredPublicClientChain,
  getFxReadFacade,
  withReadDeadline,
  type WalletBalancesResult,
} from '@/lib/fx';
import { positionTokenDecimals, type UiPosition } from '@/app/trade/fxUi';
import { formatUsd, priceKeyForSymbol, usdValueForUnits, type UsdPriceMap } from '@/lib/prices';
import { walletAssetValuation } from '@/lib/walletAssets';
import { canonicalWalletBalancesSnapshot, knownFreshPortfolioSubtotal, mergeFreshCanonicalWalletBalances, portfolioHeadlineTotal, type VerifiedPortfolioTotal } from '@/lib/portfolioValuation';
import { calculatePositionUsdValuation } from '@/lib/positionValuation';
import { fxSaveUsdValue, normalizedFxSaveAssetsWei } from '@/lib/fxSaveUnits';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';
import { claimAvailability, type ClaimableLike } from '@/lib/earnState';
import { selectWalletTasks } from '@/lib/taskState';
import styles from '@/app/AccountWorkspace.module.css';
import { MissingValue, ValueOrSkeleton } from '@/components/MissingValue';
import { PortfolioAssets, type PortfolioNetwork } from '@/components/PortfolioAssets';
import { PortfolioWorkspace } from '@/components/ProductLayout';
import { providerFallbackOnScreen } from '@/components/ProviderLoadingState';
import { SplitFigure } from '@/components/SplitFigure';
import { useRefreshAction } from '@/lib/useRefreshAction';
import { fetchFxSaveApy, type FxSaveApyResponse } from '@/lib/fxSaveApy';

const EMPTY_FX_SAVE: FxSaveSnapshot = {
  status: 'idle',
  fxSaveShares: null,
  fxSaveAssets: null,
  claimable: null,
};

/**
 * Portfolio deliberately reports only state that FxAeon can verify. Wallet
 * value uses complete fresh reads. Individual holdings remain visible while
 * the total is loading, without presenting a subtotal as the portfolio value.
 */
export default function PortfolioPage() {
  // When the first-paint fallback already drew this page, take its place without fading in a second time.
  const [continued] = useState(providerFallbackOnScreen);
  return (
    <AppShell tabs>
      <PortfolioWorkspace className={`${presentation.workspace} ${continued ? presentation.continued : ''}`}>
        <PageHeading title="Portfolio" />
        <PortfolioWallet />
      </PortfolioWorkspace>
    </AppShell>
  );
}

function PortfolioWallet() {
  const walletState = usePrivyWallet();
  const positionState = useProtocolPositions();
  const { ready, authenticated } = walletState;
  const wallet = walletState.selectedWallet;
  const walletTimedOut = useWalletReadyTimeout(ready && walletState.ready);
  const priceSnapshot = useUsdPrices();
  const displayPrices = freshDisplayPrices(priceSnapshot);
  const walletAddress = authenticated && ready && walletState.ready ? wallet?.address : undefined;
  const identity = walletAddress?.toLowerCase() ?? '';
  const manualRefresh = useRefreshAction(identity);
  const walletBalances = useWalletBalances({ address: walletAddress, chainId: 1, enabled: Boolean(walletAddress) });
  const claimableQuery = useFxSaveClaimable({ address: walletAddress, enabled: Boolean(walletAddress) });
  const liveAssets = useWalletAssets({ address: walletAddress, enabled: Boolean(walletAddress) });
  const [network, setNetwork] = useState<PortfolioNetwork>('all');
  const [fxSaveState, setFxSaveState] = useState<{ identity: string; snapshot: FxSaveSnapshot }>({ identity: '', snapshot: EMPTY_FX_SAVE });
  const [fxSaveRefreshing, setFxSaveRefreshing] = useState<{ identity: string; active: boolean }>({ identity: '', active: false });
  const fxSaveStateRef = useRef(fxSaveState);
  fxSaveStateRef.current = fxSaveState;
  const fxSaveSnapshot = fxSaveState.identity === identity ? fxSaveState.snapshot : EMPTY_FX_SAVE;
  const requestId = useRef(0);
  const realtime = useRealtimeChainState(1) as import('@/lib/realtimeChain').RealtimeChainState;
  const protocolBlockRef = useRef('');
  const protocolRequest = useRef<{ identity: string; promise: Promise<void> } | null>(null);
  const verifiedPortfolioTotalRef = useRef<VerifiedPortfolioTotal | null>(null);

  const loadProtocol = useCallback(() => {
    if (!walletAddress) return Promise.resolve();
    if (protocolRequest.current?.identity === identity) return protocolRequest.current.promise;
    const promise = (async () => {
    const activeRequest = ++requestId.current;
    const previousState = fxSaveStateRef.current;
    const previous = previousState.identity === identity ? previousState.snapshot : EMPTY_FX_SAVE;
    const hasVerifiedSnapshot = previous.status !== 'idle' && previous.status !== 'loading';
    setFxSaveRefreshing({ identity, active: true });
    // Keep a verified same-wallet snapshot visible while a block-triggered
    // refresh is pending. Reset only when this is the first read for a new
    // wallet identity, so the headline never flickers during background work.
    if (!hasVerifiedSnapshot) setFxSaveState({ identity, snapshot: { ...EMPTY_FX_SAVE, status: 'loading' } });
    try {
      await withReadDeadline(assertConfiguredPublicClientChain(1));
      if (requestId.current !== activeRequest) return;
      const sdk = getFxReadFacade();
      const fxSave = await withReadDeadline(sdk.getFxSaveBalance({ userAddress: walletAddress }));
      if (requestId.current !== activeRequest) return;

      setFxSaveState({
        identity,
        snapshot: {
          status: 'ready',
          fxSaveShares: formatProtocolAmount(fxSave.balanceWei),
          fxSaveAssets: normalizedFxSaveAssetsWei(fxSave.balanceWei, fxSave.assetsWei) !== undefined
            ? formatProtocolAmount(normalizedFxSaveAssetsWei(fxSave.balanceWei, fxSave.assetsWei)!)
            : null,
          claimable: null,
        },
      });
    } catch {
      if (requestId.current === activeRequest) {
        setFxSaveState({ identity, snapshot: hasVerifiedSnapshot
          ? { ...previous, status: 'unavailable', claimable: null }
          : { ...EMPTY_FX_SAVE, status: 'unavailable' } });
      }
    } finally {
      if (requestId.current === activeRequest) setFxSaveRefreshing({ identity, active: false });
    }
    })().finally(() => {
      if (protocolRequest.current?.promise === promise) protocolRequest.current = null;
    });
    protocolRequest.current = { identity, promise };
    return promise;
  }, [identity, walletAddress]);

  useEffect(() => {
    if (walletAddress) void loadProtocol();
    return () => { requestId.current += 1; protocolRequest.current = null; };
  }, [loadProtocol, walletAddress]);

  useEffect(() => {
    if (!walletAddress || realtime.status !== 'live' || realtime.latestBlockNumber === null) return;
    const key = `${identity}:${realtime.latestBlockNumber}`;
    if (protocolBlockRef.current === key) return;
    protocolBlockRef.current = key;
    void loadProtocol();
  }, [identity, loadProtocol, realtime.latestBlockNumber, realtime.status, walletAddress]);

  // A view of this same tree, not a separate component: when the wallet settles,
  // React keeps its controls (the actions, the network choice) instead of remounting them.
  if (!ready || !walletState.ready) return portfolioLoadingView({ timedOut: walletTimedOut, network, onNetworkChange: setNetwork });

  if (!authenticated || !wallet) {
    return <DisconnectedPortfolio />;
  }

  const loading = walletBalances.status === 'idle' || walletBalances.status === 'loading';
  const liveLoading = liveAssets.status === 'idle' || liveAssets.status === 'loading';
  const fxSaveLoading = fxSaveSnapshot.status === 'idle' || fxSaveSnapshot.status === 'loading';
  const failedReads = walletBalances.status === 'unavailable'
    || Boolean(walletBalances.data?.failedTokens.length)
    || fxSaveSnapshot.status === 'partial'
    || fxSaveSnapshot.status === 'unavailable';
  const hasVerifiedReads = walletBalances.data !== null
    || fxSaveSnapshot.status === 'ready'
    || fxSaveSnapshot.status === 'partial';
  const protocol: ProtocolSnapshot = {
    ...fxSaveSnapshot,
    claimable: claimableQuery.status === 'ready' ? claimableQuery.data : null,
    balances: walletBalances.data,
    status: failedReads
      ? hasVerifiedReads ? 'partial' : 'unavailable'
      : loading || fxSaveLoading ? 'loading' : 'ready',
  };
  const refreshing = manualRefresh.refreshing || priceSnapshot.refreshing || walletBalances.isFetching || liveAssets.isFetching || claimableQuery.isFetching || fxSaveLoading || (fxSaveRefreshing.identity === identity && fxSaveRefreshing.active) || positionState.refreshing;
  const fallbackValuation = walletValuation(protocol.balances, displayPrices, liveAssets.status === 'ready');
  const valuationNow = Date.now();
  const displayAssets = liveAssets.data
    ? mergeFreshCanonicalWalletBalances(liveAssets.data, walletBalances.data, walletBalances.updatedAt, priceSnapshot, valuationNow)
    : canonicalWalletBalancesSnapshot(wallet.address, walletBalances.data, walletBalances.updatedAt, priceSnapshot, liveAssets.status === 'unavailable' ? 'unavailable' : 'pending', valuationNow);
  const valuation = displayAssets ? walletAssetValuation(displayAssets) : fallbackValuation;
  const pricedWalletRows = displayAssets?.assets.filter((asset) => asset.balanceWei > 0n && asset.usdValue !== null && asset.priceStatus === 'fresh') ?? [];
  const allWalletRowsPriced = displayAssets
    ? pricedWalletRows.length === displayAssets.assets.filter((asset) => asset.balanceWei > 0n).length
    : true;
  const knownWalletSubtotal = knownFreshPortfolioSubtotal(displayAssets, walletBalances.data, walletBalances.updatedAt, priceSnapshot, valuationNow);
  const positionValues = positionState.positions.map((position) =>
    positionIsStale(position, positionState.failedGroups)
      ? null : positionNetEquityUsd(position, displayPrices));
  const missingPositions = positionValues.filter((value) => value === null).length;
  const protocolEquityUsd = positionValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const knownPositionCount = positionValues.filter((value) => value !== null).length;
  const positionsComplete = positionState.status === 'ready'
    && positionState.pendingPositions.length === 0 && missingPositions === 0;
  const portfolioComplete = valuation.complete && allWalletRowsPriced && positionsComplete;
  const portfolioValuation = {
    ...valuation,
    complete: portfolioComplete,
    totalUsd: portfolioComplete && valuation.totalUsd !== null
      ? valuation.totalUsd + protocolEquityUsd : null,
    reason: '',
  };
  const headline = portfolioHeadlineTotal(portfolioValuation.totalUsd, verifiedPortfolioTotalRef.current,
    wallet.address, valuationNow);
  verifiedPortfolioTotalRef.current = headline.verified;
  const walletTasks = selectWalletTasks({ walletAddress: wallet.address, transactions: [], claimable: protocol.claimable,
    valuation: (!valuation.complete || !allWalletRowsPriced) && Boolean(displayAssets?.assets.some((asset) => asset.balanceWei > 0n))
      ? knownWalletSubtotal.hasKnownValue ? 'partial' : 'unavailable' : 'complete' });

  const refreshAll = () => {
    haptic('light');
    void manualRefresh.run([priceSnapshot.refresh, liveAssets.refresh, walletBalances.refresh, claimableQuery.refresh, loadProtocol, positionState.refresh]);
  };
  return <div id="overview" className={presentation.dashboard}>
    <div className={presentation.primary}>
      <SupportedValueCard displayTotalUsd={headline.displayTotalUsd}
        // The total waits for verified positions and first prices; until then it is loading, not unavailable.
        loading={loading || liveLoading || priceSnapshot.status === 'loading' || priceSnapshot.refreshing || positionState.status === 'loading' || positionState.refreshing} refreshing={manualRefresh.refreshing} onRefresh={refreshAll}
        walletValue={knownWalletSubtotal.totalUsd} positionEquity={positionsComplete || knownPositionCount > 0 ? protocolEquityUsd : null}
        walletComplete={valuation.complete && allWalletRowsPriced} positionsComplete={positionsComplete} />
      {walletTasks.filter((task) => task.kind !== 'transaction' && (task.kind !== 'valuation' || !refreshing)).map((task) => <StatusNotice key={task.id} title={task.title}
        tone={task.state === 'ready' ? 'success' : 'neutral'} action={<Link href={task.href}>{task.kind === 'withdrawal' && task.state === 'ready' ? 'Review claim' : task.kind === 'valuation' ? 'View affected assets' : 'View details'}</Link>}>
        {task.kind !== 'valuation' && task.detail}
      </StatusNotice>)}
      <PortfolioAssets snapshot={displayAssets} loading={loading || liveLoading}
        network={network} onNetworkChange={setNetwork} onRefresh={refreshAll} refreshing={manualRefresh.refreshing} />
      <PositionsSection summary={positionsSummary(positionState.status, positionState.positions.length, positionState.pendingPositions.length)} empty={positionState.status === 'ready' && positionState.positions.length === 0 && positionState.pendingPositions.length === 0}>
          <div className={presentation.disclosureActions}>{positionState.positions.length > 0 && <Link href="/positions">Manage all <ChevronRight size={15} aria-hidden="true" /></Link>}</div>
          <ProtocolPositionNotice status={positionState.status} failedGroups={positionState.failedGroups}
            hasPositions={positionState.positions.length + positionState.pendingPositions.length > 0} refreshing={positionState.refreshing}
            onRefresh={() => void positionState.refresh()} compact />
          <ConfirmedPositionCards />
          {(positionState.status === 'loading' || positionState.status === 'idle') && !positionState.positions.length && !positionState.pendingPositions.length ? <ProtocolPositionSkeleton />
            // Each row opens its position, where its actions and figures are.
            : positionState.positions.length > 0 ? <ProtocolPositionList label="Open positions">{positionState.positions.slice(0, 2).map((position) => {
            const key = encodeURIComponent(`${position.market}:${position.side}:${position.info.positionId}`);
            return <ProtocolPositionCard key={key} position={position} href={`/positions?position=${key}`} />;
            })}</ProtocolPositionList> : positionState.status === 'ready' && !positionState.pendingPositions.length ? <div className={presentation.emptyState}><span className={presentation.emptyIcon}><Layers2 size={22} aria-hidden="true" /></span><p><span>No open positions</span></p><Link href="/trade">Open trade <ChevronRight size={14} aria-hidden="true" /></Link></div> : null}
      </PositionsSection>
      <EarnPositionCard protocol={protocol} loading={fxSaveLoading} prices={displayPrices}
        pricesLoading={priceSnapshot.status === 'loading'} onRetry={() => void loadProtocol()} />
      <RecentActivityPreview walletAddress={wallet.address as Address} />
    </div>
    <aside className={presentation.secondary}>
      <MarketOverview />
    </aside>
  </div>;
}

function PositionsSection({ summary, children, empty = false }: { summary: React.ReactNode; children: React.ReactNode; empty?: boolean }) {
  return <section aria-label="Positions" className={presentation.positionsSection}>
    <div className={presentation.sectionTitle}><h2>Positions</h2><span>{empty ? 'No open positions' : summary}</span></div>
    {!empty && children}
  </section>;
}

/** A disclosure summary that has to say a read failed says it in words, not with a lone mark. */
function SummaryUnavailable({ label, children = 'Unavailable' }: { label: string; children?: React.ReactNode }) {
  return <span className={presentation.summaryUnavailable} role="status" aria-label={label} title={label}>
    <CircleAlert size={14} aria-hidden="true" />{children}
  </span>;
}

function positionsSummary(status: 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable', count: number, syncing = 0): React.ReactNode {
  if (status === 'ready') return syncing > 0 ? `${count > 0 ? `${count} open · ` : ''}${syncing} syncing` : `${count} open`;
  if (status === 'idle' || status === 'loading') return <MissingValue width="sm" status="loading" label="Loading open positions" />;
  // A partial read still names the positions it verified; the notice inside says which groups failed.
  return status === 'partial' && count > 0
    ? <SummaryUnavailable label={`${count} open; some positions could not be checked`}>{count} open</SummaryUnavailable>
    : <SummaryUnavailable label="Positions unavailable" />;
}

/**
 * Until the wallet provider is ready the page keeps its real layout: values
 * wait as placeholders in their final places while the actions, network tabs
 * and markets already work, so nothing moves when the wallet arrives. It is a
 * plain view, not a component, and its children sit in the same slots as the
 * ready page's, so React updates them in place: a tapped action or a chosen
 * network survives the handoff.
 */
function portfolioLoadingView({ timedOut, network, onNetworkChange }: {
  timedOut: boolean; network: PortfolioNetwork; onNetworkChange: (network: PortfolioNetwork) => void;
}) {
  if (timedOut) {
    return <div id="overview" className={presentation.dashboard}>
      <div className={presentation.primary}>
        <StatusNotice tone="warning" title="Your wallet didn’t load"
          action={<button type="button" onClick={() => window.location.reload()}>Try again</button>}>
          Check your connection and try again. Your funds are unaffected.
        </StatusNotice>
      </div>
      <aside className={presentation.secondary}><MarketOverview /></aside>
    </div>;
  }
  return <div id="overview" className={presentation.dashboard} aria-busy="true">
    <div className={presentation.primary}>
      <SupportedValueCard displayTotalUsd={null} loading refreshing={false}
        walletValue={null} positionEquity={null} walletComplete positionsComplete />
      {/* The ready page's wallet notices take this slot. */}
      {null}
      <PortfolioAssets snapshot={null} loading network={network} onNetworkChange={onNetworkChange} />
      <PositionsSection summary={positionsSummary('loading', 0)}><ProtocolPositionSkeleton /></PositionsSection>
      <EarnPositionCard protocol={{ ...EMPTY_FX_SAVE, balances: null }} loading prices={{}} pricesLoading />
      <RecentActivitySkeleton />
    </div>
    <aside className={presentation.secondary}>
      <MarketOverview />
    </aside>
  </div>;
}

function DisconnectedPortfolio() {
  return <div id="overview" className={presentation.dashboard}>
    <div className={`${presentation.primary} ${presentation.disconnectedPrimary}`}>
      <section className={presentation.welcome} aria-label="Portfolio overview">
        <div><h2>Your portfolio</h2><p>Ethereum and Base</p></div>
      </section>
      <QuickActions disconnected />
      <ProductOverview />
    </div>
    <aside className={presentation.secondary}><MarketOverview /></aside>
  </div>;
}

/** Public, display-only APY; a failed or expired read never becomes a promised yield. */
function ProductOverview() {
  const [apy, setApy] = useState<FxSaveApyResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  useEffect(() => {
    const maxAge = 5 * 60_000;
    let active = true;
    let controller: AbortController | null = null;
    let observedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      if (active && observedAt > 0 && Date.now() - observedAt >= maxAge) {
        observedAt = 0;
        setApy(null);
        setStatus('unavailable');
      }
      if (!active || controller || document.visibilityState !== 'visible' || !navigator.onLine) return;
      clearTimeout(timer);
      const request = new AbortController();
      controller = request;
      setApy(null);
      setStatus('loading');
      void fetchFxSaveApy(request.signal).then((snapshot) => {
        if (!active || request.signal.aborted) return;
        observedAt = snapshot.observedAt;
        setApy(snapshot);
        setStatus('ready');
      }).catch(() => {
        if (!active) return;
        observedAt = 0;
        setApy(null);
        setStatus('unavailable');
      }).finally(() => {
        controller = null;
        if (active) {
          const recovered = request.signal.aborted && navigator.onLine && document.visibilityState === 'visible';
          timer = setTimeout(load, recovered ? 0 : observedAt > 0 ? Math.max(1, maxAge - (Date.now() - observedAt)) : maxAge);
        }
      });
    };
    const recover = () => {
      if (!navigator.onLine) {
        controller?.abort();
        observedAt = 0;
        setApy(null);
        setStatus('unavailable');
      } else if (Date.now() - observedAt >= maxAge) load();
    };
    recover();
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('online', recover);
    window.addEventListener('offline', recover);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('online', recover);
      window.removeEventListener('offline', recover);
    };
  }, []);
  return <section className={presentation.productOverview} aria-label="Savings and borrowing">
    <Link href="/earn" className={presentation.productCard}>
      <div><TokenIcon symbol="fxSAVE" size={28} /><strong>Earn with fxSAVE</strong><ChevronRight size={15} aria-hidden="true" /></div>
      <p>{apy && status === 'ready' ? <><strong>{apy.apy.toFixed(2)}%</strong> APY</>
        : status === 'loading' ? <MissingValue width="sm" status="loading" label="Loading fxSAVE APY" /> : <span>APY unavailable</span>}</p>
    </Link>
    <Link href="/borrow" className={presentation.productCard}>
      <div><TokenIcon symbol="fxUSD" size={28} /><strong>Borrow fxUSD</strong><ChevronRight size={15} aria-hidden="true" /></div>
      <p>ETH, WETH, stETH, wstETH or WBTC collateral</p>
    </Link>
  </section>;
}

/**
 * The fxSAVE card keeps one shape through every state, so it never trades
 * places with a different row when the read settles: loading, unavailable
 * (with a retry inside), none on Ethereum, or the position itself.
 */
function EarnPositionCard({ protocol, loading, prices, pricesLoading = false, onRetry }: {
  protocol: ProtocolSnapshot; loading: boolean; prices: UsdPriceMap; pricesLoading?: boolean; onRetry?: () => void;
}) {
  const earnSection = (content: React.ReactNode, summary: React.ReactNode) => <section aria-labelledby="portfolio-earn-heading" className={presentation.earnSection}>
    <div className={presentation.sectionTitle}><h2 id="portfolio-earn-heading">fxSAVE</h2><span>{summary}</span></div>
    {content}
  </section>;
  if (protocol.fxSaveShares === null) {
    if (loading) {
      return earnSection(<div className={presentation.earnLoading} role="status" aria-label="Loading fxSAVE">
        <span className="skeleton" /><span><span className="skeleton" /><span className="skeleton" /></span><span className="skeleton" />
      </div>, <MissingValue width="md" status="loading" label="Loading fxSAVE" />);
    }
    return earnSection(<div className={presentation.emptyEarn}><p><TokenIcon symbol="fxSAVE" size={32} />
      <span><strong>Couldn’t load fxSAVE</strong></span>
      {onRetry ? <button type="button" onClick={onRetry}>Try again</button> : <Link href="/earn">Open Earn</Link>}</p></div>,
    <SummaryUnavailable label="fxSAVE balance unavailable" />);
  }
  // The card reads fxSAVE on Ethereum, where deposits and withdrawals happen;
  // fxSAVE held on Base is listed with the assets above, so its zero says where.
  if (!/[1-9]/.test(protocol.fxSaveShares) && claimAvailability(protocol.claimable).status !== 'ready') {
    return earnSection(<div className={presentation.emptyEarn}><p><TokenIcon symbol="fxSAVE" size={32} />
      <span><strong>No fxSAVE on Ethereum yet</strong></span>
      <Link href="/earn?mode=deposit">Deposit</Link></p></div>, '0 fxSAVE on Ethereum');
  }
  const value = fxSaveUsdValue('assetsWei', protocol.fxSaveAssets, prices);
  const valueStatus = pricesLoading ? 'loading' : 'unavailable';
  return earnSection(
    <div className={presentation.earnCard}>
      <div className={presentation.earnTop}><TokenIcon symbol="fxSAVE" size={32} /><div><h3>{formatExactDecimal(protocol.fxSaveShares, 6)} fxSAVE</h3><p>Ethereum</p></div></div>
      <div className={presentation.earnActions}><Link href="/earn?mode=deposit">Deposit</Link><Link href="/earn?mode=withdraw">Withdraw</Link>
        {claimAvailability(protocol.claimable).status === 'ready' && <Link href="/earn?mode=claim">Review claim</Link>}</div>
      <div className={presentation.underlying}><span>Underlying holdings</span><strong><ValueOrSkeleton value={protocol.fxSaveAssets === null ? '—' : `${formatExactDecimal(protocol.fxSaveAssets, 6)} fxSP`} status={loading ? 'loading' : 'unavailable'} label="Underlying holdings" /></strong></div>
    </div>,
    <ValueOrSkeleton value={formatUsd(value)} width="md" status={valueStatus} label="fxSAVE position value" />,
  );
}

function SupportedValueCard({ displayTotalUsd, loading, refreshing, onRefresh,
  walletValue, positionEquity, walletComplete, positionsComplete,
}: {
  displayTotalUsd: number | null; loading: boolean; refreshing: boolean; onRefresh?: () => void;
  walletValue: number | null; positionEquity: number | null; walletComplete: boolean; positionsComplete: boolean;
}) {
  // A breakdown row is loading while the total is, and unavailable only once its read has settled.
  const breakdownValue = (value: number | null, label: string) => value === null
    ? <MissingValue width="md" status={loading ? 'loading' : 'unavailable'} label={loading ? `Loading ${label.toLowerCase()}` : `${label} unavailable`} />
    : formatUsd(value);
  return <section aria-label="Portfolio balance" className={`${presentation.valueCard} ${balancePresentation.hero}`}>
    <div className={presentation.valueTop}>
      <span className={presentation.valueLabel}>Total value</span>
      <button type="button" aria-label="Refresh portfolio balances and positions" aria-busy={refreshing} title="Refresh balances and positions" disabled={refreshing || !onRefresh} onClick={onRefresh}>
        <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
      </button>
    </div>
    <p className={`${presentation.valueNumber} ${balancePresentation.value}`} data-portfolio-value>{displayTotalUsd !== null
      ? <SplitFigure value={formatUsd(displayTotalUsd)} fractionClassName={balancePresentation.fraction} />
      : loading ? <MissingValue width="xl" status="loading" label="Loading portfolio value" />
        : <span className={presentation.valueUnavailable}>
          <span role="status" aria-label="Portfolio value unavailable"><CircleAlert size={16} aria-hidden="true" />Total unavailable</span>
          {onRefresh && <button type="button" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>{refreshing ? 'Trying…' : 'Try again'}</button>}
        </span>}</p>
    <QuickActions />
    <dl className={presentation.valueBreakdown}>
      <div><dt>{walletComplete || walletValue === null ? 'Wallet assets' : 'Known wallet assets'}</dt><dd>{breakdownValue(walletValue, 'Wallet assets')}</dd></div>
      <div><dt>{positionsComplete || positionEquity === null ? 'Position value' : 'Known position value'}</dt><dd>{breakdownValue(positionEquity, 'Position value')}</dd></div>
    </dl>
    <details className={presentation.valueDetails}><summary>Balance details</summary>
      <p>Position value is collateral minus debt. Pending transfers and withdrawal claims are excluded.</p>
    </details>
  </section>;
}

function QuickActions({ disconnected = false }: { disconnected?: boolean }) {
  const actions: { href: string; label: string; icon: LucideIcon }[] = disconnected ? [
    { href: '/trade', label: 'Trade', icon: CandlestickChart },
    { href: '/earn', label: 'Earn', icon: PiggyBank },
    { href: '/borrow', label: 'Borrow', icon: CircleDollarSign },
  ] : [
    { href: '/qr', label: 'Receive', icon: ArrowDownToLine },
    { href: '/trade', label: 'Trade', icon: CandlestickChart },
    { href: '/borrow', label: 'Borrow', icon: CircleDollarSign },
    { href: '/earn', label: 'Earn', icon: PiggyBank },
  ];
  return (
    <section aria-labelledby="portfolio-actions-title">
      <h2 id="portfolio-actions-title" className="sr-only">Actions</h2>
      <div className={`${presentation.quickActions} ${disconnected ? presentation.productActions : ''}`}>
        {actions.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} onClick={() => haptic('light')} className={presentation.quickAction}>
            <span><Icon className="h-5 w-5" aria-hidden="true" /></span>
            <strong>{label}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}

function MarketOverview() {
  return (
    <section aria-labelledby="market-overview-title">
      <SectionTitle right={<span className={presentation.marketTimeframe}>24h change</span>}>
        <span id="market-overview-title">Markets</span>
      </SectionTitle>
      <div className={`${styles.market} grid grid-cols-2 gap-2.5`}>
        <MarketMiniCard market="ETH" />
        <MarketMiniCard market="BTC" />
      </div>
    </section>
  );
}

type FxSaveSnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';
  fxSaveShares: string | null;
  fxSaveAssets: string | null;
  claimable: ClaimableLike | null;
};

type ProtocolSnapshot = FxSaveSnapshot & { balances: WalletBalancesResult | null };

type WalletValuation = {
  complete: boolean;
  totalUsd: number | null;
  knownSubtotalUsd: number | null;
  knownAssetCount: number;
  assetCount: number;
  reason: string;
};

function walletValuation(balances: WalletBalancesResult | null, prices: UsdPriceMap, completeAllowed = true): WalletValuation {
  if (!balances) return { complete: false, totalUsd: null, knownSubtotalUsd: null, knownAssetCount: 0, assetCount: 0, reason: '' };
  const nonZero = balances.balances.filter((balance) => balance.amountWei > 0n);
  const values = nonZero.map((balance) => {
    const key = priceKeyForSymbol(balance.key);
    return usdValueForUnits(balance.amountWei, balance.decimals, key ? prices[key] : undefined);
  });
  const pricedValues = values.filter((value): value is number => value !== null);
  const unpricedCount = values.length - pricedValues.length;
  const failedCount = balances.failedTokens.length;
  const missingCount = unpricedCount + failedCount;
  if (missingCount > 0) {
    return {
      complete: false,
      totalUsd: null,
      knownSubtotalUsd: pricedValues.length > 0 ? pricedValues.reduce((total, value) => total + value, 0) : null,
      knownAssetCount: pricedValues.length,
      assetCount: nonZero.length,
      reason: '',
    };
  }
  if (!completeAllowed) {
    return {
      complete: false,
      totalUsd: null,
      knownSubtotalUsd: pricedValues.length > 0 ? pricedValues.reduce((total, value) => total + value, 0) : null,
      knownAssetCount: pricedValues.length,
      assetCount: nonZero.length,
      reason: '',
    };
  }
  return {
    complete: true,
    totalUsd: values.reduce<number>((total, value) => total + (value ?? 0), 0),
    knownSubtotalUsd: values.reduce<number>((total, value) => total + (value ?? 0), 0),
    knownAssetCount: pricedValues.length,
    assetCount: nonZero.length,
    reason: '',
  };
}

function positionNetEquityUsd(position: UiPosition, prices: UsdPriceMap): number | null {
  const collateralKey = priceKeyForSymbol(position.info.rawCollsToken);
  const debtKey = priceKeyForSymbol(position.info.rawDebtsToken);
  const valuation = calculatePositionUsdValuation({
    collateralRaw: position.info.rawColls,
    collateralDecimals: positionTokenDecimals(position, 'collateral'),
    collateralPrice: collateralKey ? prices[collateralKey] : undefined,
    debtRaw: position.info.rawDebts,
    debtDecimals: positionTokenDecimals(position, 'debt'),
    debtPrice: debtKey ? prices[debtKey] : undefined,
  });
  if (valuation.netEquityUsdCents === null) return null;
  const value = Number(valuation.netEquityUsdCents) / 100;
  return Number.isFinite(value) ? value : null;
}

function formatProtocolAmount(value: bigint): string {
  const formatted = formatUnits(value, 18).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return formatted || '0';
}
