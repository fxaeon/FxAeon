'use client';

import { useLayoutEffect, type CSSProperties } from 'react';
import { usePathname } from 'next/navigation';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  CandlestickChart,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Home,
  LayoutGrid,
  PiggyBank,
  RefreshCw,
  Search,
  type LucideIcon,
} from 'lucide-react';
import FxLogo from '@/components/FxLogo';
import TokenIcon from '@/components/TokenIcon';
import { useT } from '@/lib/i18n';
import styles from './ProviderLoadingState.module.css';
import control from './HeaderWalletControl.module.css';
import layout from './ProductLayout.module.css';
import ui from './ProductUI.module.css';
import portfolio from './PortfolioWorkspace.module.css';
import balance from './BalanceSummary.module.css';
import assets from './PortfolioAssets.module.css';
import assetRows from './AssetPresentation.module.css';
import activity from './WalletActivity.module.css';
import account from '@/app/AccountWorkspace.module.css';

/*
 * The first paint, before the wallet providers load. It draws the app shell
 * (top bar and dock) and, on Portfolio, the page itself with the same classes
 * as the real page: fixed labels and controls as they will be, and every value
 * that still has to be read as a placeholder in its final place. Nothing here
 * can be focused or read out; the live page replaces it in place.
 *
 * Presentation only: wallet initialization must not be needed to paint it, so
 * it imports styles and icons, never the page or its data modules.
 */
const TABS: { href: string; labelKey: string; icon: LucideIcon; also?: string[] }[] = [
  // Mirrors the dock in ui.tsx.
  { href: '/', labelKey: 'nav.home', icon: Home, also: ['/portfolio'] },
  { href: '/trade', labelKey: 'nav.trade', icon: CandlestickChart, also: ['/positions'] },
  { href: '/earn', labelKey: 'nav.earn', icon: PiggyBank, also: ['/borrow'] },
  { href: '/move', labelKey: 'nav.move', icon: ArrowLeftRight, also: ['/qr'] },
  { href: '/more', labelKey: 'nav.more', icon: LayoutGrid, also: ['/settings', '/history', '/docs'] },
];

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
  return <>
    {/* The live title arrives lit; this one stays plain so the sweep plays once. */}
    <h1 className="sr-only">History</h1>
    <div className={`${account.workspace} ${account.activitySection} ${account.activityCompactWorkspace}`}>
      <section className={activity.section}>
        <div className={activity.filters}>
          <select tabIndex={-1} defaultValue="all"><option value="all">All activity</option></select>
          <select tabIndex={-1} defaultValue="all"><option value="all">All networks</option></select>
          <button type="button" tabIndex={-1} className={activity.refresh}><RefreshCw size={16} aria-hidden="true" /></button>
          <label className={activity.search}><Search size={16} aria-hidden="true" /><input tabIndex={-1} placeholder="Search activity" readOnly /></label>
        </div>
        <span className={`skeleton ${activity.skeletonDay}`} />
        <ActivityRows count={5} />
      </section>
    </div>
  </>;
}

function isActive(pathname: string, href: string, also?: string[]) {
  return pathname === href || Boolean(also?.some((prefix) => pathname.startsWith(prefix)));
}

/** The real top bar's geometry: mark and wordmark, the network and wallet control, the theme button. */
function ShellTopBar({ pathname }: { pathname: string }) {
  const t = useT();
  return <div className="app-topbar">
    <a className="flex items-center gap-2.5"><FxLogo size={32} /><span className="brand-wordmark">FxAeon</span></a>
    <nav className="desktop-navigation">
      {TABS.map(({ href, labelKey, also }) => <a key={href} aria-current={isActive(pathname, href, also) ? 'page' : undefined}>{t(labelKey)}</a>)}
    </nav>
    <span className="app-topbar-actions">
      <span className={control.control}>
        <span className="network-selector-wrap"><span className="network-selector">
          <span className={`skeleton ${styles.chainMark}`} /><span className={`network-selector-visual-label skeleton ${styles.networkLabel}`} />
        </span></span>
        <span className={`${control.trigger} ${control.identityTrigger}`}>
          <span className={`skeleton ${styles.avatar}`} /><span className={`skeleton ${styles.identity}`} />
        </span>
      </span>
      <button type="button" tabIndex={-1} className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-full bg-[var(--surface)] text-mut">
        <span className={`skeleton ${styles.themeMark}`} />
      </button>
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

const QUICK_ACTIONS: { label: string; icon: LucideIcon }[] = [
  { label: 'Receive', icon: ArrowDownToLine },
  { label: 'Trade', icon: CandlestickChart },
  { label: 'Move', icon: ArrowLeftRight },
  { label: 'Earn', icon: PiggyBank },
];

/**
 * Portfolio as the connected page draws it while its reads are in flight,
 * built from the same classes: the hero (label, figure placeholder, four
 * round actions, Value breakdown), Assets with network tabs and three rows,
 * the Positions and fxSAVE cards, History, Markets and Borrow.
 */
function PortfolioSilhouette() {
  return <div className={`${layout.workspace} ${layout.portfolio} ${portfolio.workspace}`}>
    <h1 className="sr-only">Portfolio</h1>
    <div className={portfolio.dashboard}>
      <div className={portfolio.primary}>
        <section className={`${portfolio.valueCard} ${balance.hero}`}>
          <div className={portfolio.valueTop}>
            <span className={portfolio.valueLabel}>Total value</span>
            <button type="button" tabIndex={-1}><RefreshCw size={18} aria-hidden="true" /></button>
          </div>
          <p className={`${portfolio.valueNumber} ${balance.value}`}><span className="missing-value missing-value-xl"><span className="missing-value-bar" /></span></p>
          <div className={portfolio.quickActions}>
            {QUICK_ACTIONS.map(({ label, icon: Icon }) => <a key={label} className={portfolio.quickAction}>
              <span><Icon className="h-5 w-5" aria-hidden="true" /></span><strong>{label}</strong>
            </a>)}
          </div>
          <details className={ui.disclosure}><summary tabIndex={-1}><span>Value breakdown</span><ChevronDown size={17} aria-hidden="true" /></summary></details>
        </section>
        <section className={`${assets.assets} ${assets.ledgerSurface}`}>
          <div className={assets.sectionHeading}>
            <h2>Assets</h2>
            <div className={assets.networkTabs} style={{ '--seg-index': 0, '--seg-count': 3 } as CSSProperties}>
              <button type="button" tabIndex={-1} aria-pressed="true">All</button><button type="button" tabIndex={-1}>Ethereum</button><button type="button" tabIndex={-1}>Base</button>
            </div>
          </div>
          <div className={assetRows.loadingList}>
            {[0, 1, 2].map((row) => <div key={row} className={assetRows.loadingRow}>
              <span className={`${assetRows.loadingIcon} skeleton`} />
              <span className={assetRows.loadingName}><span className="skeleton" /><span className="skeleton" /></span>
              <span className={assetRows.loadingWorth}><span className="skeleton" /><span className="skeleton" /></span>
            </div>)}
          </div>
        </section>
        {['Positions', 'fxSAVE'].map((title) => <section key={title} className={title === 'fxSAVE' ? portfolio.earnSection : portfolio.positionsSection}>
          <details className={ui.disclosure}><summary tabIndex={-1}><span>{title}</span>
            <span className={ui.disclosureHint}><span className={`missing-value ${title === 'fxSAVE' ? 'missing-value-md' : 'missing-value-sm'}`}><span className="missing-value-bar" /></span></span>
            <ChevronDown size={17} aria-hidden="true" />
          </summary></details>
        </section>)}
        <section className={activity.section}>
          <div className="section-heading mb-2 flex items-center justify-between">
            <h2 className="text-[length:var(--fs-title)] font-semibold tracking-tight text-[var(--text)]">History</h2>
            <div className={activity.toolbar}><a>View all<ChevronRight size={14} aria-hidden="true" /></a><button type="button" tabIndex={-1} className={activity.refresh}><RefreshCw size={16} aria-hidden="true" /></button></div>
          </div>
          <ActivityRows count={3} />
        </section>
      </div>
      <aside className={portfolio.secondary}>
        <section>
          <div className="section-heading mb-2 flex items-center justify-between">
            <h2 className="text-[length:var(--fs-title)] font-semibold tracking-tight text-[var(--text)]">Markets</h2>
            <a className="glass-press flex min-h-11 items-center gap-0.5 px-1.5 text-[13px] font-semibold text-mint">Open trade<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></a>
          </div>
          <div className={`${account.market} grid grid-cols-2 gap-2.5`}>
            {(['ETH', 'BTC'] as const).map((market) => <a key={market} className={styles.marketCard}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><TokenIcon symbol={market === 'BTC' ? 'WBTC' : 'ETH'} size={28} /><strong className="text-[13px]">{market}</strong></span>
                <span className="text-[11px] font-semibold"><span className="missing-value missing-value-md"><span className="missing-value-bar" /></span></span>
              </div>
              <p className="mt-3 text-display text-[20px] font-semibold tabular-nums"><span className="missing-value missing-value-lg"><span className="missing-value-bar" /></span></p>
              <div className="market-chart-compact mt-2 h-[54px]"><div className="market-chart-skeleton h-full" /></div>
            </a>)}
          </div>
        </section>
        <section className={ui.group}>
          <h2>Borrow</h2>
          <div className={ui.rowGroup}><a className={ui.actionRow}>
            <CircleDollarSign className={ui.rowIcon} size={20} aria-hidden="true" />
            <span className={ui.rowCopy}><strong>Borrow fxUSD</strong><small>Manage collateral and debt</small></span>
            <ChevronRight size={18} aria-hidden="true" />
          </a></div>
        </section>
      </aside>
    </div>
  </div>;
}
