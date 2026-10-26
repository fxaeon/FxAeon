'use client';

import { useLayoutEffect, type CSSProperties } from 'react';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftRight,
  CandlestickChart,
  ChevronDown,
  CircleDollarSign,
  Home,
  Menu,
  PiggyBank,
  RefreshCw,
  Search,
  type LucideIcon,
} from 'lucide-react';
import FxLogo from '@/components/FxLogo';
import { PageHeading } from '@/components/ProductUI';
import { useT } from '@/lib/i18n';
import styles from './ProviderLoadingState.module.css';
import control from './HeaderWalletControl.module.css';
import navigation from './ShellNavigation.module.css';
import layout from './ProductLayout.module.css';
import portfolio from './PortfolioWorkspace.module.css';
import { PortfolioExploreView } from './PortfolioExploreView';
import explore from './PortfolioExplore.module.css';
import market from './MarketMiniCard.module.css';
import TokenIcon from './TokenIcon';
import { MissingValue } from './MissingValue';
import activity from './WalletActivity.module.css';
import account from '@/app/AccountWorkspace.module.css';
import history from '@/app/history/History.module.css';
import filter from './FilterSelect.module.css';
import { DesktopSidebar } from './DesktopSidebar';

/*
 * The first paint, before the wallet providers load. It draws the app shell
 * (top bar and dock) and, on Portfolio, public discovery with the same classes
 * as the live page. Only public market values wait in their final places. Nothing here
 * can be focused or read out; the live page replaces it in place.
 *
 * Presentation only: wallet initialization must not be needed to paint it, so
 * it imports styles and icons, never the page or its data modules.
 */
const TABS: { href: string; labelKey: string; icon: LucideIcon; also?: string[] }[] = [
  // Mirrors the dock in ui.tsx.
  { href: '/', labelKey: 'nav.home', icon: Home, also: ['/portfolio'] },
  { href: '/trade', labelKey: 'nav.trade', icon: CandlestickChart, also: ['/positions'] },
  { href: '/earn', labelKey: 'nav.earn', icon: PiggyBank },
  { href: '/borrow', labelKey: 'nav.borrow', icon: CircleDollarSign },
  { href: '/move', labelKey: 'nav.move', icon: ArrowLeftRight },
];
const MORE_TAB = { href: '/more', labelKey: 'nav.more', also: ['/settings', '/history', '/qr', '/send', '/docs'] };

const UTILITY_ROUTES = ['/more', '/settings', '/history', '/qr', '/send'];

let fallbackOnScreen = false;
/**
 * True while this fallback is on screen, including during the render of the
 * page that replaces it (its cleanup runs after that render). That page has
 * already been drawn here, so it can continue instead of fading in again.
 */
export function providerFallbackOnScreen(): boolean {
  return fallbackOnScreen;
}

export function ProviderLoadingState() {
  const pathname = (usePathname() ?? '/').replace(/(.)\/$/, '$1');
  const portfolioRoute = pathname === '/' || pathname === '/portfolio';
  useLayoutEffect(() => {
    fallbackOnScreen = true;
    return () => { fallbackOnScreen = false; };
  }, []);
  return <div data-product-ui="v2" className="app-shell app-shell-tabs" role="status" aria-label="Loading FxAeon" aria-busy="true">
    <span className="sr-only">Loading FxAeon</span>
    <DesktopSidebar pathname={pathname} loading />
    <div className="app-workspace" data-route={pathname} aria-hidden="true" inert>
      <ShellTopBar pathname={pathname} />
      {/* Shares .app-content's geometry but not the live page's scroll or card class names, which tests and scripts look up. */}
      <div className={`app-content ${styles.content} ${UTILITY_ROUTES.includes(pathname) ? 'utility-content' : ''}`}>
        {portfolioRoute ? <PortfolioSilhouette /> : pathname === '/history' ? <HistorySilhouette /> : <>
          <div className={`skeleton ${styles.heading}`} />
          <div className={styles.workspace}>
            <div className={styles.overview}><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
            <div className={styles.form}><span className="skeleton" /><div className="skeleton" /><div className="skeleton" /><span className="skeleton" /></div>
          </div>
        </>}
      </div>
    </div>
    <ShellDock pathname={pathname} />
  </div>;
}

/** Waiting history rows in the feed's own list classes. */
function ActivityRows({ count }: { count: number }) {
  return <ul className={activity.list}>{Array.from({ length: count }, (_, row) => <li key={row}><span className={activity.skeletonRow}>
    <span className={`skeleton ${activity.skeletonMark}`} />
    <span className={activity.skeletonLines}><span className="skeleton" /><span className="skeleton" /></span>
    <span className={`${activity.skeletonLines} ${activity.skeletonOutcome}`}><span className="skeleton" /><span className="skeleton" /></span>
  </span></li>)}</ul>;
}

/** History as its feed draws it while the first read is in flight: title, filters, search, a day and rows. */
function HistorySilhouette() {
  return <div className={history.workspace}>
    {/* The live title arrives lit; this one stays plain so the sweep plays once. */}
    <PageHeading title="History" backHref="/more" visible />
    <div className={`${account.workspace} ${account.activitySection} ${account.activityCompactWorkspace}`}>
      <section className={activity.section} data-full-history>
        <div className={activity.filters}>
          {['All activity', 'All networks'].map(label => <div key={label} className={filter.root}><button type="button" role="combobox" aria-expanded="false" tabIndex={-1} className={filter.trigger}><span>{label}</span><ChevronDown size={16} aria-hidden="true" /></button></div>)}
          <button type="button" tabIndex={-1} className={activity.refresh}><RefreshCw size={16} aria-hidden="true" /></button>
          <label className={activity.search}><Search size={16} aria-hidden="true" /><input tabIndex={-1} placeholder="Search activity" readOnly /></label>
        </div>
        <span className={`skeleton ${activity.skeletonDay}`} />
        <ActivityRows count={5} />
      </section>
    </div>
  </div>;
}

function isActive(pathname: string, href: string, also?: string[]) {
  return pathname === href || Boolean(also?.some((prefix) => pathname.startsWith(prefix)));
}

/** The real top bar's geometry: mark, wordmark, and wallet control. */
function ShellTopBar({ pathname }: { pathname: string }) {
  return <div className="app-topbar">
    <a className="mobile-brand flex items-center gap-2.5"><FxLogo size={32} /><span className="brand-wordmark">FxAeon</span></a>
    <span className="app-topbar-actions">
      <span className={control.control}>
        <span className={control.identityPlaceholder}>
          <span className={`skeleton ${control.placeholderName}`} />
        </span>
      </span>
      <span data-mobile-more className={navigation.mobileMore} aria-current={isActive(pathname, MORE_TAB.href, MORE_TAB.also) ? 'page' : undefined}><Menu size={21} aria-hidden="true" /></span>
    </span>
  </div>;
}

/** The phone dock, with its highlight already on the current route. */
function ShellDock({ pathname }: { pathname: string }) {
  const t = useT();
  const activeIndex = TABS.findIndex(({ href, also }) => isActive(pathname, href, also));
  return <div className="mobile-tabbar pointer-events-none fixed inset-x-0 bottom-0 z-40" aria-hidden="true" inert>
    <div className="tabbar-safe mx-auto w-full max-w-[520px]">
      <div className="tabbar" data-active-tab={activeIndex < 0 ? 'none' : String(activeIndex)}
        style={{ '--tab-index': Math.max(activeIndex, 0), '--tab-count': TABS.length } as CSSProperties}>
        {TABS.map(({ href, labelKey, icon: Icon }, index) => <span key={href}
          className={`nav-item nav-item-mobile ${index === activeIndex ? 'nav-item-active text-mint' : 'text-mut'}`}>
          <span className="nav-icon"><Icon aria-hidden="true" className="h-5 w-5" strokeWidth={index === activeIndex ? 2.2 : 1.8} /></span>
          <span className="nav-label">{t(labelKey)}</span>
        </span>)}
      </div>
    </div>
  </div>;
}

/** Unknown wallet state never implies account holdings. */
function PortfolioSilhouette() {
  return <div className={`${layout.workspace} ${layout.portfolio} ${portfolio.workspace}`}>
    <h1 className="sr-only">Portfolio</h1>
    <PortfolioExploreView connect={<button type="button" tabIndex={-1} className={`button button-primary ${explore.connect}`}>Connect wallet</button>}
      markets={<>{['ETH', 'BTC'].map(symbol => <div key={symbol} className={`${market.marketMiniCard} portfolio-market-card`} data-market-placeholder={symbol}><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><TokenIcon symbol={symbol === 'BTC' ? 'WBTC' : 'ETH'} size={28} /><strong className="text-[13px]">{symbol}</strong></span><span className="text-[11px] font-semibold text-mut"><MissingValue width="md" /></span></div><p className="mt-3 text-display text-[20px] font-semibold tabular-nums"><MissingValue width="lg" /></p><div className="market-chart-compact mt-2 h-[54px]"><div className="market-chart-skeleton h-full" /></div></div>)}</>} />
  </div>;
}
