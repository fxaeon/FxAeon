'use client';

// Static export: small allowlisted token logos use native lazy loading and a
// local fallback, without an image-optimization server.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Coins, Search } from 'lucide-react';
import { AssetListSkeleton, AssetRowContent, displayAssetSymbol, networkLabel } from '@/components/AssetPresentation';
export { AssetIcon, AssetNetworkIcon, AssetQuantity, displayAssetSymbol, networkLabel } from '@/components/AssetPresentation';
import { filterSupportedWalletAssets, summarizeWalletAssets, type WalletAssetSnapshot } from '@/lib/walletAssets';
import { WalletAssetModal } from '@/components/WalletAssetDetails';
import styles from './PortfolioAssets.module.css';

export type PortfolioNetwork = 'all' | 1 | 8453;

export function PortfolioNetworkTabs({ value, onChange }: { value: PortfolioNetwork; onChange: (value: PortfolioNetwork) => void }) {
  // Native controls can accept input before hydration attaches onChange.
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  return <label className={styles.networkSelect}>
    <span className="sr-only">Portfolio network</span>
    <select disabled={!interactive} value={value} onChange={(event) => onChange(event.target.value === 'all' ? 'all' : event.target.value === '8453' ? 8453 : 1)}>
      <option value="all">All networks</option>
      <option value={1}>{networkLabel(1)}</option>
      <option value={8453}>{networkLabel(8453)}</option>
    </select>
    <ChevronDown size={15} aria-hidden="true" />
  </label>;
}

export function PortfolioAssets({ snapshot, loading, network = 'all', onNetworkChange, onRefresh, refreshing = false }: {
  snapshot: WalletAssetSnapshot | null;
  loading: boolean;
  network?: PortfolioNetwork;
  onNetworkChange?: (value: PortfolioNetwork) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [search, setSearch] = useState('');
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

  const missingFreshValues = assets.some((asset) => asset.usdValue === null);
  const showSearch = search.length > 0 || (displaySnapshot?.assets.filter((asset) => asset.balanceWei > 0n).length ?? 0) > 6;
  const visibleAssets = expanded || query ? assets : assets.slice(0, 6);
  const hasNetworkAssets = Boolean(displaySnapshot?.assets.some((asset) => asset.balanceWei > 0n && (network === 'all' || asset.chainId === network)));
  const showAssetLoading = countState === 'loading' && !hasNetworkAssets;
  const needsStatus = countState !== 'ready' || missingFreshValues;
  const statusLabel = [
    countState === 'loading' ? 'Balances loading.' : countState === 'unavailable' ? 'Some balances unavailable.' : countState === 'partial' ? 'Some balances incomplete.' : null,
    missingFreshValues ? 'Some prices unavailable.' : null,
  ].filter(Boolean).join(' ');
  const retryAction = onRefresh && <button type="button" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>{refreshing ? 'Refreshing…' : 'Try again'}</button>;
  const unavailableState = <div className={styles.empty}><Coins size={24} aria-hidden="true" /><p><strong>Couldn’t load balances</strong></p>{retryAction}</div>;
  const where = network === 'all' ? '' : ` on ${networkLabel(network)}`;
  return <section className={`${styles.assets} ${styles.ledgerSurface}`} aria-labelledby="portfolio-assets-heading">
    <div className={styles.sectionHeading}>
      <h2 id="portfolio-assets-heading">Assets</h2>
        {onNetworkChange && <PortfolioNetworkTabs value={network} onChange={onNetworkChange} />}
      </div>
    {showSearch && <label className={styles.search}><Search size={18} aria-hidden="true" /><span className="sr-only">Search assets</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets" autoComplete="off" /></label>}
    {needsStatus && <div className={styles.status} role="status"><span>{statusLabel}</span>{!loading && assets.length > 0 && retryAction}</div>}
    {assets.length > 0 && <div className={styles.columnLabels} aria-hidden="true"><span>Asset</span><span>Value</span></div>}
    {loading && !snapshot ? <AssetListSkeleton />
      : !snapshot ? unavailableState
      : showAssetLoading ? <AssetListSkeleton />
      : assets.length === 0 && incomplete && !search ? unavailableState
        : assets.length === 0 ? <div className={styles.empty}><Coins size={24} aria-hidden="true" />
          {search ? <><p><strong>No matching assets{where}</strong></p><button type="button" onClick={() => setSearch('')}>Clear search</button></>
            : <><p><strong>No assets{where} yet</strong></p><Link href="/qr">Receive assets</Link></>}</div>
      : <ul className={styles.assetList}>{visibleAssets.map((asset) => <li key={asset.id}><button type="button" className={styles.assetRow} onClick={() => setSelection({ wallet: snapshot.walletAddress, id: asset.id })} aria-label={`View ${displayAssetSymbol(asset.symbol)} on ${networkLabel(asset.chainId)}`}>
        <AssetRowContent asset={asset} loading={loading} />
      </button></li>)}</ul>}
    {!query && assets.length > 6 && <button type="button" className={styles.showAll} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show fewer assets' : `View all ${assets.length} assets`}</button>}
    {selected && <WalletAssetModal asset={selected} walletAddress={displaySnapshot?.walletAddress} onClose={() => setSelection(null)} />}
  </section>;
}
