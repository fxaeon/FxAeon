'use client';

// Static export: small allowlisted token logos use native lazy loading and a
// local fallback, without an image-optimization server.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, ChevronRight, Coins, Layers2, Search } from 'lucide-react';
import { AssetListSkeleton, AssetNetworkIcon, AssetQuantity, displayAssetSymbol, networkLabel } from '@/components/AssetPresentation';
export { AssetIcon, AssetNetworkIcon, AssetQuantity, displayAssetSymbol, networkLabel } from '@/components/AssetPresentation';
import { filterSupportedWalletAssets, summarizeWalletAssets, type WalletAsset, type WalletAssetSnapshot } from '@/lib/walletAssets';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { formatUsd } from '@/lib/prices';
import { WalletAssetModal } from '@/components/WalletAssetDetails';
import { ChainIcon } from '@/components/TokenIcon';
import { isLowValuePortfolioAsset } from './portfolioAssetGroups';
import { useInitialReadPending } from '@/lib/useInitialReadPending';
import styles from './PortfolioAssets.module.css';

export type PortfolioNetwork = 'all' | 1 | 8453;

const PORTFOLIO_NETWORKS: readonly { value: PortfolioNetwork; label: string }[] = [
  { value: 'all', label: 'All networks' }, { value: 1, label: 'Ethereum' }, { value: 8453, label: 'Base' },
];

export function PortfolioNetworkTabs({ value, onChange }: { value: PortfolioNetwork; onChange: (value: PortfolioNetwork) => void }) {
  const [interactive, setInteractive] = useState(false);
  const [open, setOpen] = useState(false);
  const [menuLayout, setMenuLayout] = useState({ above: false, maxHeight: 260 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const label = PORTFOLIO_NETWORKS.find((network) => network.value === value)!.label;
  useEffect(() => setInteractive(true), []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const root = rootRef.current;
      const menu = menuRef.current;
      if (!root || !menu) return;
      const anchor = root.getBoundingClientRect();
      const content = root.closest('.app-content')?.getBoundingClientRect();
      const dock = document.querySelector('nav.mobile-tabbar')?.getBoundingClientRect();
      const top = Math.max(0, content?.top ?? 0) + 8;
      const bottom = Math.min(window.innerHeight, content?.bottom ?? window.innerHeight, dock?.height ? dock.top : window.innerHeight) - 8;
      const below = bottom - anchor.bottom - 8;
      const above = anchor.top - top - 8;
      const placeAbove = below < menu.scrollHeight && above > below;
      setMenuLayout({ above: placeAbove, maxHeight: Math.max(48, Math.min(260, placeAbove ? above : below)) });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  return <div ref={rootRef} className={styles.networkSelect} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={triggerRef} type="button" className={styles.networkTrigger} disabled={!interactive}
      aria-label={`Portfolio network: ${label}`} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
      onClick={() => setOpen((current) => !current)} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}>
      {value !== 'all' && <ChainIcon chainId={value} size={18} />}<span>{label}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div ref={menuRef} id={menuId} className={styles.networkMenu} data-placement={menuLayout.above ? 'above' : 'below'} style={{ maxHeight: menuLayout.maxHeight }} role="menu" aria-label="Filter by network" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (index + 1) % items.length
          : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
            : event.key.length === 1 && /[a-z]/i.test(event.key)
              ? PORTFOLIO_NETWORKS.findIndex((network) => network.label.toLowerCase().startsWith(event.key.toLowerCase())) : -1;
      if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
    }}>
      {PORTFOLIO_NETWORKS.map((network) => <button key={network.value} type="button" role="menuitemradio" className={styles.networkOption}
        aria-label={network.label} aria-checked={network.value === value} tabIndex={-1}
        onClick={() => { onChange(network.value); close(); }}>
        <span className={styles.networkIcon}>{network.value === 'all' ? <Layers2 size={19} aria-hidden="true" /> : <ChainIcon chainId={network.value} size={24} />}</span>
        <span className={styles.optionLabel}>{network.label}</span>{network.value === value && <Check size={18} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}

export function PortfolioAssets({ snapshot, loading, pricesLoading = false, network = 'all', onNetworkChange, onRefresh, refreshing = false }: {
  snapshot: WalletAssetSnapshot | null;
  loading: boolean;
  pricesLoading?: boolean;
  network?: PortfolioNetwork;
  onNetworkChange?: (value: PortfolioNetwork) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [search, setSearch] = useState('');
  const assetDescriptionId = useId();
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<{ wallet: string; id: string } | null>(null);
  const displaySnapshot = snapshot ? summarizeWalletAssets(filterSupportedWalletAssets(snapshot)) : null;
  const selected = selection?.wallet === displaySnapshot?.walletAddress ? displaySnapshot?.assets.find((asset) => asset.id === selection?.id) : undefined;
  useEffect(() => { setSelection(null); setSearch(''); setExpanded(false); }, [snapshot?.walletAddress]);
  useEffect(() => { setExpanded(false); }, [network]);
  const query = search.trim().toLowerCase();
  const assets = (displaySnapshot?.assets ?? []).filter((asset) => asset.balanceWei > 0n && (network === 'all' || asset.chainId === network)
    && (!query || [asset.symbol, asset.name, asset.tokenAddress ?? '', networkLabel(asset.chainId)].some((text) => text.toLowerCase().includes(query))))
    .sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1) || a.symbol.localeCompare(b.symbol) || a.chainId - b.chainId);
  const networks = network === 'all' ? [1, 8453] as const : [network];
  const incomplete = Boolean(displaySnapshot && networks.some((chain) => displaySnapshot.networks[chain].status !== 'ready'));
  const countState = !displaySnapshot
    ? loading ? 'loading' : 'unavailable'
    : !incomplete ? 'ready'
      : networks.some((chain) => displaySnapshot.networks[chain].status === 'pending') ? 'loading'
        : networks.some((chain) => displaySnapshot.networks[chain].status === 'unavailable') ? 'unavailable' : 'partial';

  const showSearch = search.length > 0 || (displaySnapshot?.assets.filter((asset) => asset.balanceWei > 0n).length ?? 0) > 6;
  // Unknown/stale values always stay in the main list. A failed price is never dust.
  const groupingNow = Date.now();
  const lowValueAssets = query ? [] : assets.filter((asset) => isLowValuePortfolioAsset(asset, groupingNow));
  const mainAssets = query ? assets : assets.filter((asset) => !isLowValuePortfolioAsset(asset, groupingNow));
  const visibleAssets = expanded || query ? mainAssets : mainAssets.slice(0, 6);
  const balancesPending = countState === 'loading' && (!displaySnapshot || networks.some(chain => displaySnapshot.networks[chain].status === 'pending'
    && !displaySnapshot.assets.some(asset => asset.chainId === chain && asset.source === 'canonical' && asset.balanceUpdatedAt !== null)));
  const showAssetLoading = useInitialReadPending(`${snapshot?.walletAddress ?? ''}:${network}`,
    balancesPending || pricesLoading && assets.some(asset => asset.usdValue === null));
  const needsStatus = assets.length > 0 && (countState === 'unavailable' || countState === 'partial');
  const statusLabel = countState === 'partial' ? 'Some balances incomplete.' : 'Some balances unavailable.';
  const retryAction = onRefresh && <button type="button" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>{refreshing ? 'Refreshing…' : 'Try again'}</button>;
  const unavailableState = <div className={styles.empty}><Coins size={24} aria-hidden="true" /><p><strong>Couldn’t load balances</strong></p>{retryAction}</div>;
  const where = network === 'all' ? '' : ` on ${networkLabel(network)}`;
  const assetRows = (rows: readonly WalletAsset[]) => <ul className={styles.assetList}>{rows.map((asset) => <li key={asset.id}>
    <button type="button" className={styles.assetRow} onClick={() => { if (snapshot) setSelection({ wallet: snapshot.walletAddress, id: asset.id }); }} aria-label={`View ${displayAssetSymbol(asset.symbol)} on ${networkLabel(asset.chainId)}`}
      aria-describedby={`${assetDescriptionId}-${encodeURIComponent(asset.id)}-quantity ${assetDescriptionId}-${encodeURIComponent(asset.id)}-value`}>
      <AssetNetworkIcon asset={asset} size={42} />
      <span className={styles.assetIdentity}><strong>{displayAssetSymbol(asset.symbol)}</strong><span id={`${assetDescriptionId}-${encodeURIComponent(asset.id)}-quantity`}><AssetQuantity asset={asset} compact /></span></span>
      <span className={styles.assetValue} id={`${assetDescriptionId}-${encodeURIComponent(asset.id)}-value`}><ValueOrSkeleton value={formatUsd(asset.usdValue)} width="sm" status={loading || pricesLoading ? 'loading' : 'unavailable'} label={loading || pricesLoading ? 'Loading holding value' : 'Holding value unavailable'} /></span>
      <ChevronRight className={styles.rowArrow} size={15} aria-hidden="true" />
    </button>
  </li>)}</ul>;
  return <section className={`${styles.assets} ${styles.ledgerSurface}`} aria-labelledby="portfolio-assets-heading">
    <h2 id="portfolio-assets-heading" className="sr-only">Wallet assets</h2>
    {onNetworkChange && <div className={styles.sectionHeading}><PortfolioNetworkTabs value={network} onChange={onNetworkChange} /></div>}
    {!showAssetLoading && showSearch && <label data-focus-field className={styles.search}><Search size={18} aria-hidden="true" /><span className="sr-only">Search assets</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets" autoComplete="off" /></label>}
    {!showAssetLoading && needsStatus && <div className={styles.status} role="status"><span>{statusLabel}</span>{!loading && assets.length > 0 && retryAction}</div>}
    {loading && !snapshot ? <AssetListSkeleton />
      : !snapshot ? unavailableState
      : showAssetLoading ? <AssetListSkeleton />
      : assets.length === 0 && incomplete && !search ? unavailableState
        : assets.length === 0 ? <div className={styles.empty}><Coins size={24} aria-hidden="true" />
          {search ? <><p><strong>No matching assets{where}</strong></p><button type="button" onClick={() => setSearch('')}>Clear search</button></>
            : <><p><strong>No assets{where} yet</strong></p><Link href="/qr">Receive assets</Link></>}</div>
      : assetRows(visibleAssets)}
    {!showAssetLoading && !query && mainAssets.length > 6 && <button type="button" className={styles.showAll} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show fewer assets' : `View all ${mainAssets.length} assets`}</button>}
    {!showAssetLoading && lowValueAssets.length > 0 && <details className={styles.lowValueGroup} open={mainAssets.length === 0 || undefined}>
      <summary><span><strong>Low-value assets ({lowValueAssets.length})</strong></span><span className={styles.lowValueTotal}>{formatUsd(lowValueAssets.reduce((sum, asset) => sum + asset.usdValue!, 0))}</span><ChevronDown size={16} aria-hidden="true" /></summary>
      {assetRows(lowValueAssets)}
    </details>}
    {selected && <WalletAssetModal asset={selected} walletAddress={displaySnapshot?.walletAddress} onClose={() => setSelection(null)} />}
  </section>;
}
