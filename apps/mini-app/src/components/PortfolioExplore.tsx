'use client';

import ConnectWalletButton from './ConnectWalletButton';
import { MarketMiniCard } from './MarketChart';
import { PortfolioExploreView } from './PortfolioExploreView';
import styles from './PortfolioExplore.module.css';

/** Public discovery stays available while wallet restoration completes. */
export default function PortfolioExplore() {
  return <PortfolioExploreView
    connect={<ConnectWalletButton className={`button button-primary ${styles.connect}`}>Connect wallet</ConnectWalletButton>}
    markets={<><MarketMiniCard market="ETH" /><MarketMiniCard market="BTC" /></>}
  />;
}
