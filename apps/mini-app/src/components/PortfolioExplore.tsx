'use client';

import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import ConnectWalletButton from './ConnectWalletButton';
import { MarketMiniCard } from './MarketChart';
import TokenIcon, { ChainIcon } from './TokenIcon';
import styles from './PortfolioExplore.module.css';

/** Discovery is public. No account balances or hypothetical returns stand in for a wallet. */
export default function PortfolioExplore() {
  return <div id="overview" data-portfolio-explore className={styles.explore}>
    <section className={styles.intro} aria-labelledby="portfolio-explore-heading">
      <h2 id="portfolio-explore-heading">DeFi that<br /><em>moves with you.</em></h2>
      <p>Trade, earn and borrow with f(x).<br />Bridge between Ethereum and Base.</p>
      <div className={styles.entryActions}>
        <ConnectWalletButton className={`button button-primary ${styles.connect}`}>Connect wallet</ConnectWalletButton>
        <Link href="/trade">Explore Trade <ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </section>

    <section className={styles.productSection} aria-labelledby="portfolio-products-heading" aria-label="Explore FxAeon">
      <div className={styles.sectionHeading}>
        <h2 id="portfolio-products-heading">Explore FxAeon</h2>
      </div>
      <div className={styles.products}>
        <Link href="/trade" className={styles.product} data-product="trade">
          <div className={styles.productTop}><h3>Trade</h3><ArrowUpRight size={19} aria-hidden="true" /></div>
          <div className={`${styles.art} ${styles.tradeArt}`} aria-hidden="true"><TokenIcon symbol="ETH" size={56} /><TokenIcon symbol="WBTC" size={48} /></div>
          <p>Trade long or short on ETH and BTC.</p>
        </Link>
        <Link href="/earn" className={styles.product} data-product="earn">
          <div className={styles.productTop}><h3>Earn</h3><ArrowUpRight size={19} aria-hidden="true" /></div>
          <div className={styles.art} aria-hidden="true"><TokenIcon symbol="fxSAVE" size={58} /></div>
          <p>Save in fxSAVE with variable yield.</p>
        </Link>
        <Link href="/borrow" className={styles.product} data-product="borrow">
          <div className={styles.productTop}><h3>Borrow</h3><ArrowUpRight size={19} aria-hidden="true" /></div>
          <div className={`${styles.art} ${styles.borrowArt}`} aria-hidden="true"><TokenIcon symbol="ETH" size={32} /><TokenIcon symbol="WBTC" size={32} /><TokenIcon symbol="fxUSD" size={52} /></div>
          <p>Access fxUSD against collateral.</p>
        </Link>
        <Link href="/move" className={styles.product} data-product="move">
          <div className={styles.productTop}><h3>Move</h3><ArrowUpRight size={19} aria-hidden="true" /></div>
          <div className={`${styles.art} ${styles.moveArt}`} aria-hidden="true"><ChainIcon chainId={1} size={40} /><ChainIcon chainId={8453} size={40} /></div>
          <p>Bridge between Ethereum and Base.</p>
        </Link>
      </div>
    </section>

    <section className={styles.markets} aria-labelledby="portfolio-markets-heading">
      <div className={styles.sectionHeading}><h2 id="portfolio-markets-heading">Markets</h2><span className={styles.marketPeriod}>24h</span></div>
      <div className={styles.marketGrid}><MarketMiniCard market="ETH" /><MarketMiniCard market="BTC" /></div>
    </section>
  </div>;
}
