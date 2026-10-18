'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpFromLine,
  ArrowDownToLine,
  CandlestickChart,
  Clock3,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Layers2,
  MoreHorizontal,
  PiggyBank,
  RefreshCw,
  Wallet,
  X,
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
  ProtocolPositionNotice,
} from '@/components/ProtocolPositionCard';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import RecentActivityPreview from '@/components/RecentActivityPreview';
import { RecentActivitySkeleton } from '@/components/WalletActivity';
import TokenIcon from '@/components/TokenIcon';
import ConnectWalletButton from '@/components/ConnectWalletButton';
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
import { canonicalWalletBalancesSnapshot, mergeFreshCanonicalWalletBalances, portfolioHeadlineTotal, type VerifiedPortfolioTotal } from '@/lib/portfolioValuation';
import { calculatePositionUsdValuation } from '@/lib/positionValuation';
import { fxSaveUsdValue, normalizedFxSaveAssetsWei } from '@/lib/fxSaveUnits';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import { claimAvailability, type ClaimableLike } from '@/lib/earnState';
import { selectWalletTasks } from '@/lib/taskState';
import styles from '@/app/AccountWorkspace.module.css';
import { MissingValue, ValueOrSkeleton } from '@/components/MissingValue';
import { PortfolioAssets, PortfolioNetworkTabs, type PortfolioNetwork } from '@/components/PortfolioAssets';
import { PortfolioWorkspace } from '@/components/ProductLayout';
import { PortfolioPositionRows } from '@/components/PortfolioPositionRows';
import { PortfolioPositionSkeleton } from '@/components/PortfolioPositionSkeleton';
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
  const [viewState, setViewState] = useState<{ identity: string; tab: PortfolioTab; network: PortfolioNetwork }>({ identity: '', tab: 'tokens', network: 'all' });
  const settledIdentity = useRef('');
  const firstWalletSettling = Boolean(identity) && settledIdentity.current === '';
  const stateIdentity = identity || settledIdentity.current;
  const stateApplies = !identity ? viewState.identity === settledIdentity.current
    : firstWalletSettling ? viewState.identity === '' : viewState.identity === identity;
  const selectedTab = stateApplies ? viewState.tab : 'tokens';
  const network = stateApplies ? viewState.network : 'all';
  const selectTab = useCallback((tab: PortfolioTab) => setViewState({ identity: stateIdentity, tab, network }), [stateIdentity, network]);
  const selectNetwork = useCallback((next: PortfolioNetwork) => setViewState({ identity: stateIdentity, tab: selectedTab, network: next }), [stateIdentity, selectedTab]);
  useEffect(() => {
    if (!identity) return;
    const initialWallet = settledIdentity.current === '';
    settledIdentity.current = identity;
    if (initialWallet) setViewState((current) => current.identity === '' ? { ...current, identity } : current);
    else setViewState((current) => current.identity === identity ? current : { identity, tab: 'tokens', network: 'all' });
  }, [identity]);
  const [fxSaveState, setFxSaveState] = useState<{ identity: string; snapshot: FxSaveSnapshot }>({ identity: '', snapshot: EMPTY_FX_SAVE });
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
  if (!ready || !walletState.ready) return portfolioLoadingView({ timedOut: walletTimedOut, network, onNetworkChange: selectNetwork, selectedTab, onTabChange: selectTab });

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
  const positionValues = positionState.positions.map((position) =>
    positionIsStale(position, positionState.failedGroups)
      ? null : positionNetEquityUsd(position, displayPrices));
  const missingPositions = positionValues.filter((value) => value === null).length;
  const protocolEquityUsd = positionValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
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
  const walletTasks = selectWalletTasks({ walletAddress: wallet.address, transactions: [], claimable: protocol.claimable });

  const refreshAll = () => {
    haptic('light');
    void manualRefresh.run([priceSnapshot.refresh, liveAssets.refresh, walletBalances.refresh, claimableQuery.refresh, loadProtocol, positionState.refresh]);
  };
  return <div id="overview" className={presentation.dashboard}>
    <div className={presentation.primary}>
      <SupportedValueCard displayTotalUsd={headline.displayTotalUsd}
        // The total waits for verified positions and first prices; until then it is loading, not unavailable.
        loading={loading || liveLoading || priceSnapshot.status === 'loading' || priceSnapshot.refreshing || positionState.status === 'loading' || positionState.refreshing} refreshing={manualRefresh.refreshing} onRefresh={refreshAll}
        onSelectActivity={() => selectTab('activity')} />
      {walletTasks.filter((task) => task.kind === 'withdrawal').map((task) => <StatusNotice key={task.id} title={task.title}
        tone={task.state === 'ready' ? 'success' : 'neutral'} action={<Link href={task.href}>{task.state === 'ready' ? 'Review claim' : 'View details'}</Link>}>
        {task.detail}
      </StatusNotice>)}
      <PortfolioToolbar value={selectedTab} onChange={selectTab} network={network} onNetworkChange={selectNetwork} />
      <div className={presentation.tabPanel} role="tabpanel" id="portfolio-tab-panel" aria-labelledby={`portfolio-tab-${selectedTab}`} tabIndex={selectedTab === 'activity' ? 0 : -1}>
        {selectedTab === 'tokens' && <PortfolioAssets snapshot={displayAssets} loading={loading || liveLoading} pricesLoading={priceSnapshot.status === 'loading' || priceSnapshot.refreshing}
          network={network} onRefresh={refreshAll} refreshing={manualRefresh.refreshing} />}
        {selectedTab === 'defi' && <ProtocolHoldings key={identity}>
          <PositionsSection>
            <ProtocolPositionNotice status={positionState.status} failedGroups={positionState.failedGroups}
              hasPositions={positionState.positions.length + positionState.pendingPositions.length > 0} refreshing={positionState.refreshing}
              onRefresh={() => void positionState.refresh()} compact />
            <ConfirmedPositionCards />
            {(positionState.status === 'loading' || positionState.status === 'idle') && !positionState.positions.length && !positionState.pendingPositions.length ? <PortfolioPositionSkeleton />
              : positionState.positions.length > 0 ? <PortfolioPositionRows positions={positionState.positions} failedGroups={positionState.failedGroups} />
                : positionState.status === 'ready' && !positionState.pendingPositions.length ? <div className={presentation.emptyState}><span className={presentation.emptyIcon}><Layers2 size={22} aria-hidden="true" /></span><p><span>No open positions</span></p><Link href="/trade">Open trade <ChevronRight size={14} aria-hidden="true" /></Link></div> : null}
          </PositionsSection>
          <EarnPositionCard protocol={protocol} loading={fxSaveLoading} prices={displayPrices}
            pricesLoading={priceSnapshot.status === 'loading'} onRetry={() => void loadProtocol()} />
        </ProtocolHoldings>}
        {selectedTab === 'activity' && <div className={presentation.activitySection}><RecentActivityPreview walletAddress={wallet.address as Address} /></div>}
      </div>
    </div>
  </div>;
}

function PositionsSection({ children }: { children: React.ReactNode }) {
  return <section aria-label="Positions" className={presentation.positionsSection}>
    {children}
  </section>;
}

type PortfolioTab = 'tokens' | 'defi' | 'activity';

function PortfolioToolbar({ value, onChange, network, onNetworkChange }: {
  value: PortfolioTab; onChange: (value: PortfolioTab) => void;
  network: PortfolioNetwork; onNetworkChange: (value: PortfolioNetwork) => void;
}) {
  return <div className={presentation.sectionToolbar}>
    <PortfolioTabs value={value} onChange={onChange} />
    {value === 'tokens' && <div className={presentation.sectionFilter}><PortfolioNetworkTabs value={network} onChange={onNetworkChange} /></div>}
  </div>;
}

function PortfolioTabs({ value, onChange }: { value: PortfolioTab; onChange: (value: PortfolioTab) => void }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const tabs: { id: PortfolioTab; label: string }[] = [
    { id: 'tokens', label: 'Tokens' }, { id: 'defi', label: 'DeFi' }, { id: 'activity', label: 'Activity' },
  ];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === value);
    const nextIndex = event.key === 'ArrowRight' ? (currentIndex + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (currentIndex - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    onChange(tabs[nextIndex].id);
    document.getElementById(`portfolio-tab-${tabs[nextIndex].id}`)?.focus();
  };
  return <div className={presentation.sectionNav} role="tablist" aria-label="Portfolio views" onKeyDown={onKeyDown}>
    {tabs.map((tab) => <button key={tab.id} id={`portfolio-tab-${tab.id}`} type="button" role="tab"
      disabled={!hydrated}
      aria-selected={value === tab.id} aria-controls="portfolio-tab-panel" tabIndex={value === tab.id ? 0 : -1}
      onClick={() => onChange(tab.id)}>{tab.label}</button>)}
  </div>;
}

function ProtocolHoldings({ children }: { children: React.ReactNode }) {
  return <section id="portfolio-defi" className={presentation.protocolSection} aria-label="DeFi positions and savings">
    <div className={presentation.protocolBody}>{children}</div>
  </section>;
}

/**
 * Until the wallet provider is ready the page keeps its real layout: values
 * wait as placeholders in their final places while the actions and network
 * filter remain available, so nothing moves when the wallet arrives. It is a
 * plain view, not a component, and its children sit in the same slots as the
 * ready page's, so React updates them in place: a tapped action or a chosen
 * network survives the handoff.
 */
function portfolioLoadingView({ timedOut, network, onNetworkChange, selectedTab, onTabChange }: {
  timedOut: boolean; network: PortfolioNetwork; onNetworkChange: (network: PortfolioNetwork) => void; selectedTab: PortfolioTab; onTabChange: (tab: PortfolioTab) => void;
}) {
  if (timedOut) {
    return <div id="overview" className={presentation.dashboard}>
      <div className={presentation.primary}>
        <StatusNotice tone="warning" title="Your wallet didn’t load"
          action={<button type="button" onClick={() => window.location.reload()}>Try again</button>}>
          Check your connection and try again. Your funds are unaffected.
        </StatusNotice>
      </div>
    </div>;
  }
  return <div id="overview" className={presentation.dashboard} aria-busy="true">
    <div className={presentation.primary}>
      <SupportedValueCard displayTotalUsd={null} loading refreshing={false} onSelectActivity={() => onTabChange('activity')} />
      {/* The ready page's wallet notices take this slot. */}
      {null}
      <PortfolioToolbar value={selectedTab} onChange={onTabChange} network={network} onNetworkChange={onNetworkChange} />
      <div className={presentation.tabPanel} role="tabpanel" id="portfolio-tab-panel" aria-labelledby={`portfolio-tab-${selectedTab}`} tabIndex={selectedTab === 'activity' ? 0 : -1}>
        {selectedTab === 'tokens' && <PortfolioAssets snapshot={null} loading network={network} />}
        {selectedTab === 'defi' && <ProtocolHoldings>
          <PositionsSection><PortfolioPositionSkeleton /></PositionsSection>
          <EarnPositionCard protocol={{ ...EMPTY_FX_SAVE, balances: null }} loading prices={{}} pricesLoading />
        </ProtocolHoldings>}
        {selectedTab === 'activity' && <div className={presentation.activitySection}><RecentActivitySkeleton /></div>}
      </div>
    </div>
  </div>;
}

function DisconnectedPortfolio() {
  return <div id="overview" className={presentation.dashboard}>
    <div className={`${presentation.primary} ${presentation.disconnectedPrimary}`}>
      <section className={presentation.welcome} aria-label="Portfolio overview">
        <span className={presentation.welcomeIcon} aria-hidden="true"><Wallet size={30} strokeWidth={1.5} /></span>
        <div><h2>Your portfolio</h2><p>Connect your wallet to see your tokens and positions.</p></div>
        <ConnectWalletButton className={`button button-primary ${presentation.welcomeConnect}`}>Connect wallet</ConnectWalletButton>
      </section>
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
  return <section className={presentation.productOverview} aria-label="Explore FxAeon">
    <Link href="/trade" className={presentation.productCard}>
      <div><span className={presentation.productIcon}><CandlestickChart size={24} strokeWidth={1.6} aria-hidden="true" /></span><strong>Trade</strong><ChevronRight size={16} aria-hidden="true" /></div>
      <p>Go long or short on ETH and BTC.</p>
    </Link>
    <Link href="/earn" className={presentation.productCard}>
      <div><TokenIcon symbol="fxSAVE" size={36} /><strong>Earn</strong><ChevronRight size={16} aria-hidden="true" /></div>
      <p>{apy && status === 'ready' ? <><strong>{apy.apy.toFixed(2)}%</strong> variable APY</>
        : status === 'loading' ? <MissingValue width="sm" status="loading" label="Loading fxSAVE APY" /> : <span>Save with fxSAVE.</span>}</p>
    </Link>
    <Link href="/borrow" className={presentation.productCard}>
      <div><TokenIcon symbol="fxUSD" size={36} /><strong>Borrow</strong><ChevronRight size={16} aria-hidden="true" /></div>
      <p>Get fxUSD against your ETH or BTC.</p>
    </Link>
  </section>;
}

/** Savings use the same holding-row hierarchy as open positions. */
function EarnPositionCard({ protocol, loading, prices, pricesLoading = false, onRetry }: {
  protocol: ProtocolSnapshot; loading: boolean; prices: UsdPriceMap; pricesLoading?: boolean; onRetry?: () => void;
}) {
  const earnSection = (content: React.ReactNode) => <section aria-label="Savings" className={presentation.earnSection}>
    {content}
  </section>;
  if (protocol.fxSaveShares === null) {
    if (loading) {
      return earnSection(<div className={presentation.earnLoading} role="status" aria-label="Loading fxSAVE">
        <span className="skeleton" /><span><span className="skeleton" /><span className="skeleton" /></span><span className="skeleton" />
      </div>);
    }
    return earnSection(<div className={presentation.emptyEarn}><p><TokenIcon symbol="fxSAVE" size={32} />
      <span><strong>Couldn’t load fxSAVE</strong></span>
      {onRetry ? <button type="button" onClick={onRetry}>Try again</button> : <Link href="/earn">Open Earn</Link>}</p></div>);
  }
  // The card reads fxSAVE on Ethereum, where deposits and withdrawals happen;
  // fxSAVE held on Base is listed with the assets above, so its zero says where.
  if (!/[1-9]/.test(protocol.fxSaveShares) && claimAvailability(protocol.claimable).status !== 'ready') {
    return earnSection(<div className={presentation.emptyEarn}><p><TokenIcon symbol="fxSAVE" size={32} />
      <span><strong>fxSAVE</strong></span>
      <Link href="/earn?mode=deposit">Deposit</Link></p></div>);
  }
  const value = fxSaveUsdValue('assetsWei', protocol.fxSaveAssets, prices);
  const valueStatus = pricesLoading ? 'loading' : 'unavailable';
  return earnSection(
    <details className={presentation.earnCard}>
      <summary className={presentation.earnTop} aria-label="fxSAVE savings details"><TokenIcon symbol="fxSAVE" size={42} /><div><h3>fxSAVE</h3><p>{formatExactDecimal(protocol.fxSaveShares, 6)} fxSAVE</p></div><strong className={presentation.earnValue}><ValueOrSkeleton value={formatUsd(value)} width="md" status={valueStatus} label="fxSAVE position value" /></strong><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className={presentation.earnActions}><Link href="/earn?mode=deposit">Deposit</Link><Link href="/earn?mode=withdraw">Withdraw</Link>
        {claimAvailability(protocol.claimable).status === 'ready' && <Link href="/earn?mode=claim">Review claim</Link>}</div>
    </details>,
  );
}

function SupportedValueCard({ displayTotalUsd, loading, refreshing, onRefresh, onSelectActivity,
}: {
  displayTotalUsd: number | null; loading: boolean; refreshing: boolean; onRefresh?: () => void;
  onSelectActivity?: () => void;
}) {
  const formattedTotal = displayTotalUsd === null ? null : formatUsd(displayTotalUsd);
  return <section aria-label="Portfolio balance" className={`${presentation.valueCard} ${balancePresentation.hero}`}>
    <div className={presentation.valueTop}>
      <p className={`${presentation.valueNumber} ${balancePresentation.value}`} data-portfolio-value data-value-size={formattedTotal && formattedTotal.length > 16 ? 'extended' : formattedTotal && formattedTotal.length > 12 ? 'long' : undefined}>{formattedTotal !== null
        ? <SplitFigure value={formattedTotal} fractionClassName={balancePresentation.fraction} />
        : loading ? <MissingValue width="xl" status="loading" label="Loading portfolio value" />
          : <span className={presentation.valueUnavailable} role="status" aria-label="Portfolio value unavailable"><CircleAlert size={16} aria-hidden="true" />Unavailable</span>}</p>
      <button type="button" aria-label="Refresh portfolio balances and positions" aria-busy={refreshing} title="Refresh balances and positions" disabled={refreshing || !onRefresh} onClick={onRefresh}>
        <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
      </button>
    </div>
    <QuickActions onActivity={onSelectActivity} />
  </section>;
}

function QuickActions({ onActivity }: { onActivity?: () => void }) {
  const actions: { href: string; label: string; icon: LucideIcon }[] = [
    { href: '/send', label: 'Send', icon: ArrowUpFromLine },
    { href: '/qr', label: 'Receive', icon: ArrowDownToLine },
    { href: '/trade', label: 'Trade', icon: CandlestickChart },
  ];
  return (
    <section aria-labelledby="portfolio-actions-title">
      <h2 id="portfolio-actions-title" className="sr-only">Actions</h2>
      <div className={presentation.quickActions}>
        {actions.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} onClick={() => haptic('light')} className={presentation.quickAction}>
            <span><Icon className="h-5 w-5" aria-hidden="true" /></span>
            <strong>{label}</strong>
          </Link>
        ))}
        <MoreActions onActivity={onActivity} />
      </div>
    </section>
  );
}

function MoreActions({ onActivity }: { onActivity?: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useOverlayDialog<HTMLDivElement>({ open, onClose: () => setOpen(false), triggerRef, initialFocusRef: closeRef });
  const actions = [
    { href: '/earn', label: 'Earn', icon: PiggyBank },
    { href: '/borrow', label: 'Borrow', icon: CircleDollarSign },
    { href: '/move', label: 'Move', icon: ArrowDownToLine },
  ];
  return <>
    <button ref={triggerRef} type="button" className={presentation.quickAction} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
      <span><MoreHorizontal size={21} aria-hidden="true" /></span><strong>More</strong>
    </button>
    {open && typeof document !== 'undefined' && createPortal(<div className={presentation.moreBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div ref={dialogRef} className={presentation.moreDialog} role="dialog" aria-modal="true" aria-labelledby="portfolio-more-title" tabIndex={-1}>
        <div className={presentation.moreHeading}><h2 id="portfolio-more-title">More actions</h2><button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Close more actions"><X size={19} aria-hidden="true" /></button></div>
        <div className={presentation.moreLinks}>{actions.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => haptic('light')}><span className={presentation.moreIcon}><Icon size={21} aria-hidden="true" /></span><span>{label}</span><ChevronRight size={16} aria-hidden="true" /></Link>)}
          <button type="button" onClick={() => { setOpen(false); onActivity?.(); }}><span className={presentation.moreIcon}><Clock3 size={21} aria-hidden="true" /></span><span>Activity</span><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      </div>
    </div>, document.body)}
  </>;
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
