'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import ConnectWalletButton from './ConnectWalletButton';
import { MarketMiniCard } from './MarketChart';
import { MissingValue } from './MissingValue';
import TokenIcon, { ChainIcon } from './TokenIcon';
import { fetchFxSaveApy, type FxSaveApyResponse } from '@/lib/fxSaveApy';
import styles from './PortfolioExplore.module.css';

/** Discovery is public. No account balances or hypothetical returns stand in for a wallet. */
export default function PortfolioExplore() {
  const { apy, status } = usePublicFxSaveApy();
  return <div id="overview" data-portfolio-explore className={styles.explore}>
    <section className={styles.intro} aria-labelledby="portfolio-explore-heading">
      <h2 id="portfolio-explore-heading">Find your<br /> next move.</h2>
      <p>Trade, earn, borrow and move with f(x) Protocol.</p>
      <div className={styles.entryActions}>
        <ConnectWalletButton className={`button button-primary ${styles.connect}`}>Connect wallet</ConnectWalletButton>
        <Link href="/docs/guide/getting-started">How it works <ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </section>

    <section className={styles.productSection} aria-labelledby="portfolio-products-heading" aria-label="Explore FxAeon">
      <h2 id="portfolio-products-heading" className="sr-only">Explore FxAeon</h2>
      <div className={styles.products}>
        <Link href="/trade" className={styles.product}>
          <div className={styles.productTop}><h3>Trade</h3><ArrowUpRight size={19} aria-hidden="true" /></div>
          <div className={`${styles.art} ${styles.tradeArt}`} aria-hidden="true"><TokenIcon symbol="ETH" size={56} /><TokenIcon symbol="WBTC" size={48} /></div>
          <p>Go long or short on ETH and BTC.</p>
          <span className={styles.productMeta}>Ethereum</span>
        </Link>
        <Link href="/earn" className={styles.product}>
          <div className={styles.productTop}><h3>Earn</h3><ArrowUpRight size={19} aria-hidden="true" /></div>
          <div className={styles.art} aria-hidden="true"><TokenIcon symbol="fxSAVE" size={58} /></div>
          <p>Save in stablecoins with fxSAVE.</p>
          <span className={styles.apy}>
            {apy && status === 'ready' ? <><strong>{apy.apy.toFixed(2)}%</strong> variable APY</>
              : status === 'loading' ? <><MissingValue width="sm" label="Loading fxSAVE APY" /> <span>variable APY</span></>
                : <span role="status">APY unavailable</span>}
          </span>
        </Link>
        <Link href="/borrow" className={styles.product}>
          <div className={styles.productTop}><h3>Borrow</h3><ArrowUpRight size={19} aria-hidden="true" /></div>
          <div className={`${styles.art} ${styles.borrowArt}`} aria-hidden="true"><TokenIcon symbol="ETH" size={32} /><TokenIcon symbol="WBTC" size={32} /><TokenIcon symbol="fxUSD" size={52} /></div>
          <p>Borrow fxUSD against your collateral.</p>
          <span className={styles.productMeta}>Ethereum</span>
        </Link>
        <Link href="/move" className={styles.product}>
          <div className={styles.productTop}><h3>Move</h3><ArrowUpRight size={19} aria-hidden="true" /></div>
          <div className={`${styles.art} ${styles.moveArt}`} aria-hidden="true"><ChainIcon chainId={1} size={40} /><ChainIcon chainId={8453} size={40} /></div>
          <p>Bridge fxUSD and fxSAVE between networks.</p>
          <span className={styles.productMeta}>Ethereum ↔ Base</span>
        </Link>
      </div>
    </section>

    <section className={styles.markets} aria-labelledby="portfolio-markets-heading">
      <div className={styles.sectionHeading}><h2 id="portfolio-markets-heading">Markets</h2></div>
      <div className={styles.marketGrid}><MarketMiniCard market="ETH" /><MarketMiniCard market="BTC" /></div>
    </section>
  </div>;
}

/** The same bounded official feed used by Earn, with no signing or protocol authority. */
function usePublicFxSaveApy() {
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
  return { apy, status };
}
