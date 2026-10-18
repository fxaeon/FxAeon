'use client';

import { useLayoutEffect, type CSSProperties } from 'react';
import { usePathname } from 'next/navigation';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  CandlestickChart,
  ChevronDown,
  CircleDollarSign,
  Home,
  Ellipsis,
  MoreHorizontal,
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
import balance from './BalanceSummary.module.css';
import assets from './PortfolioAssets.module.css';
import assetRows from './AssetPresentation.module.css';
import activity from './WalletActivity.module.css';
import account from '@/app/AccountWorkspace.module.css';
import history from '@/app/history/History.module.css';
import filter from './FilterSelect.module.css';

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
  const t = useT();
  return <div className="app-topbar">
    <a className="flex items-center gap-2.5"><FxLogo size={32} /><span className="brand-wordmark">FxAeon</span></a>
    <nav className="desktop-navigation">
      {[...TABS, MORE_TAB].map(({ href, labelKey, also }) => <a key={href} aria-current={isActive(pathname, href, also) ? 'page' : undefined}>{t(labelKey)}</a>)}
    </nav>
    <span className="app-topbar-actions">
      <span className={control.control}>
        <span className={control.identityPlaceholder}>
          <span className={`skeleton ${control.placeholderName}`} />
        </span>
      </span>
      <span data-mobile-more className={navigation.mobileMore} aria-current={isActive(pathname, MORE_TAB.href, MORE_TAB.also) ? 'page' : undefined}><Ellipsis size={21} aria-hidden="true" /></span>
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
  { label: 'Send', icon: ArrowUpFromLine },
  { label: 'Receive', icon: ArrowDownToLine },
  { label: 'Trade', icon: CandlestickChart },
  { label: 'More', icon: MoreHorizontal },
];

/** Portfolio first paint mirrors the account balance and selected Tokens view. */
function PortfolioSilhouette() {
  return <div className={`${layout.workspace} ${layout.portfolio} ${portfolio.workspace}`}>
    <h1 className="sr-only">Portfolio</h1>
    <div className={portfolio.dashboard}>
      <div className={portfolio.primary}>
        <section className={`${portfolio.valueCard} ${balance.hero}`}>
          <div className={portfolio.valueTop}>
            <p className={`${portfolio.valueNumber} ${balance.value}`}><span className="missing-value missing-value-xl"><span className="missing-value-bar" /></span></p>
            <button type="button" tabIndex={-1}><RefreshCw size={18} aria-hidden="true" /></button>
          </div>
          <section aria-labelledby="portfolio-fallback-actions-title">
            <h2 id="portfolio-fallback-actions-title" className="sr-only">Actions</h2>
            <div className={portfolio.quickActions}>
              {QUICK_ACTIONS.map(({ label, icon: Icon }) => <button key={label} type="button" tabIndex={-1} className={portfolio.quickAction}>
                <span><Icon className="h-5 w-5" aria-hidden="true" /></span><strong>{label}</strong>
              </button>)}
            </div>
          </section>
        </section>
        <div className={portfolio.sectionToolbar}>
          <div className={portfolio.sectionNav} role="tablist" aria-label="Portfolio views">
          <button id="portfolio-tab-tokens" type="button" role="tab" aria-selected="true" aria-controls="portfolio-tab-panel" tabIndex={-1}>Tokens</button>
          <button id="portfolio-tab-defi" type="button" role="tab" aria-selected="false" aria-controls="portfolio-tab-panel" tabIndex={-1}>DeFi</button>
          <button id="portfolio-tab-activity" type="button" role="tab" aria-selected="false" aria-controls="portfolio-tab-panel" tabIndex={-1}>Activity</button>
          </div>
          <div className={portfolio.sectionFilter}>
            <div className={assets.networkSelect}>
              <button type="button" className={assets.networkTrigger} disabled tabIndex={-1} aria-label="Portfolio network: All networks" aria-haspopup="menu" aria-expanded="false">
                <span>All networks</span><ChevronDown size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        <div className={portfolio.tabPanel} role="tabpanel" id="portfolio-tab-panel" aria-labelledby="portfolio-tab-tokens" tabIndex={-1}>
          <section className={`${assets.assets} ${assets.ledgerSurface}`}>
            <h2 id="portfolio-assets-heading" className="sr-only">Wallet assets</h2>
            <div className={`${assetRows.loadingList} ${assets.loadingList}`}>
              {[0, 1, 2].map((row) => <div key={row} className={assetRows.loadingRow}>
                <span className={`${assetRows.loadingIcon} skeleton`} />
                <span className={assetRows.loadingName}><span className="skeleton" /><span className="skeleton" /></span>
                <span className={assetRows.loadingWorth}><span className="skeleton" /><span className="skeleton" /></span>
              </div>)}
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>;
}
