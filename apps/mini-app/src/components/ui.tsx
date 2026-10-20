'use client';

/**
 * FxAeon shared UI kit — every screen composes these so the app feels like
 * one product instead of disconnected pages.
 */
import { forwardRef, lazy, ReactNode, Suspense, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type MouseEventHandler } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  CandlestickChart,
  PiggyBank,
  ArrowLeftRight,
  CircleDollarSign,
  Copy,
  Check,
  LucideIcon,
} from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { useT } from '@/lib/i18n';
import FxLogo from '@/components/FxLogo';
import WalletProfile from '@/components/WalletProfile';
import NetworkSelector from '@/components/NetworkSelector';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { compactAddress } from '@/lib/addressPresentation';
import { copyText } from '@/lib/clipboard';
import { usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import headerWalletControl from '@/components/HeaderWalletControl.module.css';
import navigation from '@/components/ShellNavigation.module.css';

/* Load the directory only when requested; the underlying action page stays
   mounted so opening navigation cannot discard a form or review draft. */
const MobileMoreMenu = lazy(() => import('@/components/MobileMoreMenu'));

/* ------------------------------------------------------------------ shell */

const PAGE_TITLES: Record<string, string> = {
  '/': 'Portfolio',
  '/portfolio': 'Portfolio',
  '/trade': 'Trade',
  '/positions': 'Positions',
  '/earn': 'Earn',
  '/borrow': 'Borrow',
  '/move': 'Move',
  '/qr': 'Receive',
  '/more': 'More',
  '/settings': 'Settings',
  '/history': 'History',
  '/docs': 'Docs',
  '/login': 'Sign in',
};

export function AppShell({
  title,
  subtitle,
  children,
  tabs = true,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  tabs?: boolean;
}) {
  const pathname = usePathname();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileMoreTriggerRef = useRef<HTMLButtonElement>(null);
  const contentScrollRef = useRef({ top: 0, left: 0 });
  const shellRef = useOverlayDialog<HTMLDivElement>({
    open: mobileMoreOpen,
    onClose: () => setMobileMoreOpen(false),
    triggerRef: mobileMoreTriggerRef,
    initialFocusRef: mobileMoreTriggerRef,
  });

  const toggleMobileMore = () => {
    if (!mobileMoreOpen && contentRef.current) {
      contentScrollRef.current = { top: contentRef.current.scrollTop, left: contentRef.current.scrollLeft };
    }
    haptic('selection');
    setMobileMoreOpen(open => !open);
  };

  useLayoutEffect(() => {
    if (!mobileMoreOpen && contentRef.current) {
      contentRef.current.scrollTop = contentScrollRef.current.top;
      contentRef.current.scrollLeft = contentScrollRef.current.left;
    }
  }, [mobileMoreOpen]);

  // The mobile trigger disappears at the desktop breakpoint. Never leave an
  // invisible modal (or its keyboard/history ownership) behind after resizing.
  useEffect(() => {
    if (!mobileMoreOpen) return;
    const desktop = window.matchMedia('(min-width: 840px)');
    const closeOnDesktop = () => {
      if (!desktop.matches) return;
      setMobileMoreOpen(false);
      window.requestAnimationFrame(() => contentRef.current?.focus({ preventScroll: true }));
    };
    closeOnDesktop();
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, [mobileMoreOpen]);
  // Keep browser/tab titles correct for routes that own their heading inside
  // the workspace (Portfolio and Trade). The visual shell heading remains
  // opt-in via `title`, so action pages do not get a second large title.
  const documentTitle = title ?? PAGE_TITLES[pathname ?? '/'];

  useEffect(() => {
    const target = headingRef.current ?? contentRef.current;
    target?.focus({ preventScroll: true });
  }, [pathname]);

  useEffect(() => {
    if (documentTitle) document.title = `${documentTitle} · FxAeon`;
  }, [documentTitle]);

  // The top bar earns a hairline only once content scrolls beneath it.
  useEffect(() => {
    const content = contentRef.current;
    const shell = shellRef.current;
    if (!content || !shell) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      shell.dataset.scrolled = content.scrollTop > 4 ? 'true' : 'false';
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    content.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      content.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [shellRef]);

  return (
    <div
      ref={shellRef}
      role={mobileMoreOpen ? 'dialog' : undefined}
      aria-modal={mobileMoreOpen || undefined}
      aria-label={mobileMoreOpen ? 'More menu' : undefined}
      data-product-ui="v2"
      data-shell-tabs={tabs ? 'true' : 'false'}
      className={`app-shell mx-auto w-full ${tabs ? 'app-shell-tabs' : 'app-shell-no-tabs pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]'}`}
    >
      {mobileMoreOpen
        ? <button type="button" className="skip-link" onClick={() => document.getElementById('mobile-more-menu')?.focus()}>Skip to main content</button>
        : <a href="#main-content" className="skip-link">Skip to main content</a>}
      <div className="app-workspace" data-route={pathname ?? ''}>
        {tabs && (
          <header className="app-topbar">
            <Link href="/" aria-label="FxAeon portfolio" className="flex items-center gap-2.5">
              <FxLogo size={32} />
              <span className="brand-wordmark">FxAeon</span>
            </Link>
            <DesktopNavigation />
            <span className="app-topbar-actions">
              <HeaderWalletControl />
              <MobileMoreToggle ref={mobileMoreTriggerRef} open={mobileMoreOpen} onToggle={toggleMobileMore} />
            </span>
          </header>
        )}
        <main
          ref={contentRef}
          id="main-content"
          data-shell-content="true"
          hidden={mobileMoreOpen}
          inert={mobileMoreOpen}
          style={mobileMoreOpen ? { display: 'none' } : undefined}
          tabIndex={-1}
          className={`app-content ${tabs ? 'app-content-tabs' : ''} flex-1 outline-none ${['/more', '/settings', '/history', '/qr', '/send'].includes(pathname) ? 'utility-content' : ''}`}
        >
          {title && (
            <>
              <h1 ref={headingRef} tabIndex={-1} className="sr-only">{title}</h1>
              {subtitle && <p className="sr-only">{subtitle}</p>}
            </>
          )}
          {children}
        </main>
        {mobileMoreOpen && <main id="mobile-more-menu" tabIndex={-1}
          className={`app-content app-content-tabs utility-content flex-1 outline-none ${navigation.mobileMenu}`}>
          <Suspense fallback={<p role="status">Loading menu…</p>}><MobileMoreMenu /></Suspense>
        </main>}
      </div>
      {tabs && <TabBar />}
    </div>
  );
}

/* Until the wallet provider is ready, hold a compact entry placeholder.
   It stops shimmering once the provider has timed out;
   the page itself names the problem and offers a retry. */
function HeaderWalletControl() {
  const wallet = usePrivyWallet();
  const connected = Boolean(wallet.ready && wallet.authenticated && wallet.address);
  return (
    <span className={headerWalletControl.control} data-header-wallet-control="true" data-connected={connected || undefined} role="group" aria-label="Wallet and network controls">
      {connected && <NetworkSelector />}
      <HeaderWallet />
    </span>
  );
}

function HeaderWallet() {
  const wallet = usePrivyWallet();
  const timedOut = useWalletReadyTimeout(wallet.ready);
  if (wallet.ready) return <WalletProfile />;
  return (
    <span role="status" className={headerWalletControl.identityPlaceholder} data-settled={timedOut || undefined}>
      <span className={`skeleton ${headerWalletControl.placeholderName}`} aria-hidden="true" />
      <span className="sr-only">{timedOut ? 'Wallet unavailable' : 'Loading wallet'}</span>
    </span>
  );
}

const TABS: { href: string; labelKey: string; icon: LucideIcon; also?: string[] }[] = [
  { href: '/', labelKey: 'nav.home', icon: Home, also: ['/portfolio'] },
  { href: '/trade', labelKey: 'nav.trade', icon: CandlestickChart, also: ['/positions'] },
  { href: '/earn', labelKey: 'nav.earn', icon: PiggyBank },
  { href: '/borrow', labelKey: 'nav.borrow', icon: CircleDollarSign },
  { href: '/move', labelKey: 'nav.move', icon: ArrowLeftRight },
];
const MORE_TAB = { href: '/more', labelKey: 'nav.more', also: ['/settings', '/history', '/qr', '/send', '/docs'] };

function isTabActive(pathname: string | null, href: string, also?: string[]) {
  return pathname === href || Boolean(also?.some((prefix) => pathname?.startsWith(prefix)));
}

const MobileMoreToggle = forwardRef<HTMLButtonElement, { open: boolean; onToggle: () => void }>(function MobileMoreToggle({ open, onToggle }, ref) {
  const pathname = usePathname();
  return <button ref={ref} type="button" data-mobile-more
    aria-label={open ? 'Close menu' : 'Open menu'} title={open ? 'Close menu' : 'Open menu'}
    aria-expanded={open} aria-controls={open ? 'mobile-more-menu' : undefined} aria-haspopup="dialog"
    data-active={isTabActive(pathname, MORE_TAB.href, MORE_TAB.also) || open || undefined}
    className={navigation.mobileMore} onClick={onToggle}>
    <svg className={navigation.menuIcon} width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" />
    </svg>
  </button>;
});

/* Routes remount the shell, so the dock remembers where its highlight was and
   travels from there instead of reappearing in place. */
let lastActiveTabIndex: number | null = null;

export function TabBar() {
  const pathname = usePathname();
  const t = useT();
  const barRef = useRef<HTMLDivElement>(null);
  const activeIndex = TABS.findIndex(({ href, also }) => isTabActive(pathname, href, also));

  useLayoutEffect(() => {
    const bar = barRef.current;
    const from = lastActiveTabIndex;
    lastActiveTabIndex = activeIndex;
    if (!bar || from === null || from < 0 || activeIndex < 0 || from === activeIndex) return;
    bar.style.setProperty('--tab-index', String(from));
    // Commit the starting position before travelling to the current tab.
    void window.getComputedStyle(bar, '::before').transform;
    bar.style.setProperty('--tab-index', String(activeIndex));
  }, [activeIndex]);
  const links = TABS.map(({ href, labelKey, icon: Icon, also }) => {
    const active = isTabActive(pathname, href, also);
    return (
      <Link
        key={href}
        href={href}
        onClick={() => haptic('selection')}
        aria-current={active ? 'page' : undefined}
        className={`nav-item nav-item-mobile ${
          active ? 'nav-item-active text-mint' : 'text-mut'
        }`}
      >
        <span className="nav-icon">
          <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} />
        </span>
        <span className="nav-label">{t(labelKey)}</span>
      </Link>
    );
  });

  return (
    <>
      <nav data-fixed-navigation="true" className="mobile-tabbar pointer-events-none fixed inset-x-0 bottom-0 z-40" aria-label="Primary navigation">
        <div className="tabbar-safe mx-auto w-full max-w-[520px]">
          <div
            ref={barRef}
            className="tabbar pointer-events-auto"
            data-active-tab={activeIndex < 0 ? 'none' : String(activeIndex)}
            style={{ '--tab-index': Math.max(activeIndex, 0), '--tab-count': TABS.length } as CSSProperties}
          >{links}</div>
        </div>
      </nav>
    </>
  );
}

function DesktopNavigation() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav className="desktop-navigation" aria-label="Primary navigation">
      {[...TABS, MORE_TAB].map(({ href, labelKey, also }) => {
        const active = isTabActive(pathname, href, also);
        return <Link key={href} href={href} aria-current={active ? 'page' : undefined} onClick={() => haptic('selection')}>
          {t(labelKey)}
        </Link>;
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ atoms */

export function Card({ children, className = '', glow = false, elevation = 1, ...props }: HTMLAttributes<HTMLDivElement> & { glow?: boolean; elevation?: 1 | 2 | 3 }) {
  const elevationClass = elevation === 2 || elevation === 3 ? 'astryx-card-elevated' : 'astryx-card';
  return <div {...props} className={`ui-card ${elevationClass} p-5 ${glow ? 'card-glow' : ''} ${className}`}>{children}</div>;
}

function buttonClasses(variant: 'primary' | 'ghost' | 'danger' | 'outline' | 'glass', className = ''): string {
  const styles =
    variant === 'primary'
      ? 'button-primary font-semibold'
      : variant === 'danger'
        ? 'button-danger text-danger'
        : variant === 'outline'
          ? 'border border-[var(--astryx-border-default)] bg-[rgba(255,255,255,0.03)] text-[var(--text)] hover:border-[var(--astryx-border-strong)]'
          : variant === 'glass'
            ? 'astryx-card text-[var(--text)] hover:border-[var(--astryx-border-strong)]'
            : 'button-ghost text-[var(--text)]';
  // `.button` sets the body size and the disabled look (globals.css). No
  // disabled: utility here: Tailwind appends variants after every custom rule,
  // so one would override that look, and fading a label breaks its contrast.
  return `button glass-press astryx-interactive flex min-h-12 w-full items-center justify-center gap-2 px-5 py-3 ${styles} ${className}`;
}

export const Button = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick' | 'disabled' | 'className'> & {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  variant?: 'primary' | 'ghost' | 'danger' | 'outline' | 'glass';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}>(function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  loading = false,
  className = '',
  type = 'button',
  ...nativeProps
}, ref) {
  return (
    <button
      ref={ref}
      {...nativeProps}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={(event) => {
        haptic('medium');
        onClick?.(event);
      }}
      className={buttonClasses(variant, className)}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      )}
      {children}
    </button>
  );
});

export function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="stat-card glass flex flex-col gap-1.5 p-4">
      <span className="micro-label">{label}</span>
      <span
        className={`text-display text-[length:var(--fs-heading)] font-semibold leading-none ${accent ? 'text-mint' : ''}`}
      >
        <ValueOrSkeleton value={value} width="md" />
      </span>
      {sub && <span className="text-[length:var(--fs-micro)] text-mut">{sub}</span>}
    </div>
  );
}

export { copyText };

export function AddressChip({ address, iconOnly = false }: { address: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);
  const short = compactAddress(address);
  return (
    <button
      type="button"
      aria-label={copied ? 'Address copied' : `Copy wallet address ${short}`}
      title={address}
      onClick={async () => {
        if (await copyText(address)) {
          haptic('success');
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } else {
          haptic('error');
        }
      }}
      className={`address-chip glass glass-press inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[length:var(--fs-caption)] text-mut${iconOnly ? ' min-w-11' : ''}`}
    >
      {!iconOnly && short}
      {copied ? (
        <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" />
      ) : (
        <Copy aria-hidden="true" className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state glass anim-scale-in flex flex-col items-center gap-2 px-6 py-9 text-center">
      <span className="empty-icon flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--mint-dim)]">
        <Icon aria-hidden="true" className="h-6 w-6 text-mint" strokeWidth={1.8} />
      </span>
      <p className="mt-1 text-[length:var(--fs-title)] font-semibold tracking-tight">{title}</p>
      {body && <p className="max-w-[340px] text-[length:var(--fs-small)] leading-relaxed text-mut">{body}</p>}
      {action && <div className="mt-3 w-full">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, right, level = 2 }: { children: ReactNode; right?: ReactNode; level?: 2 | 3 }) {
  // Nested surfaces (for example the wallet dialog) keep a single level-2 heading.
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <div className="section-heading mb-2 flex items-center justify-between">
      <Heading className="text-[length:var(--fs-title)] font-semibold tracking-tight text-[var(--text)]">
        {children}
      </Heading>
      {right}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function LoadingRegion({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function FullScreenSpinner({ asMain = false }: { asMain?: boolean } = {}) {
  const t = useT();
  // Contentful loading state: the brand text paints pre-hydration, so slow
  // cold starts show content instead of a blank screen. A border-only
  // spinner does NOT count as a contentful paint (Lighthouse NO_FCP).
  const Element = asMain ? 'main' : 'div';
  return (
    <Element role="status" aria-live="polite" aria-label={t('common.loading')} className="flex min-h-[var(--tg-viewport-height,var(--tg-viewport-stable-height))] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="brand-orbit anim-scale-in">
        <FxLogo size={56} />
      </div>
      <div>
        <h1 className="text-display text-[length:var(--fs-heading)] font-semibold">
          Fx<span className="text-gradient">Aeon</span>
        </h1>
        <p className="mt-1.5 text-[length:var(--fs-small)] text-mut">{t('common.loading')}</p>
      </div>
      <span className="loading-line" aria-hidden="true" />
    </Element>
  );
}
