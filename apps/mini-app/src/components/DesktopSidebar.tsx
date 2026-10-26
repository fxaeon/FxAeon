'use client';

import { useId, useLayoutEffect, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import styles from './DesktopSidebar.module.css';

const preferenceKey = 'fxaeon:sidebar-expanded';
const destinations = [
  { href: '/', key: 'nav.home', icon: 'Home', also: ['/portfolio'] },
  { href: '/trade', key: 'nav.trade', icon: 'CandlestickChart', also: ['/positions'] },
  { href: '/earn', key: 'nav.earn', icon: 'PiggyBank', also: [] },
  { href: '/borrow', key: 'nav.borrow', icon: 'CircleDollarSign', also: [] },
  { href: '/move', key: 'nav.move', icon: 'ArrowLeftRight', also: [] },
  { href: '/more', key: 'nav.more', icon: 'MoreHorizontal', also: ['/settings', '/history', '/qr', '/send', '/docs'] },
];

/** Desktop navigation only. The provider fallback uses the same geometry. */
export function DesktopSidebar({ pathname, loading = false }: { pathname: string | null; loading?: boolean }) {
  const t = useT();
  const navigationId = useId();
  const [wide, setWide] = useState(false);
  const [choice, setChoice] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const media = window.matchMedia('(min-width: 1200px)');
    const update = () => setWide(media.matches);
    update();
    try {
      const stored = window.sessionStorage.getItem(preferenceKey);
      if (stored === 'true' || stored === 'false') setChoice(stored === 'true');
    } catch { /* A blocked preference store must not prevent navigation. */ }
    setReady(true);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const expanded = wide && choice !== false;
  const toggle = () => {
    setChoice(!expanded);
    try { window.sessionStorage.setItem(preferenceKey, String(!expanded)); } catch { /* Optional preference only. */ }
  };
  return <aside className={styles.sidebar} data-desktop-sidebar data-sidebar-expanded={ready ? String(expanded) : undefined} aria-hidden={loading || undefined} inert={loading || undefined}>
    <div className={styles.brandRow}>
      <Link href="/" aria-label="FxAeon portfolio" className={styles.brand}><svg width="30" height="30" viewBox="0 0 64 64" fill="none" aria-hidden="true"><use href="/brand/navigation.svg#FxAeon" /></svg><span>FxAeon</span></Link>
      <button className={styles.toggle} type="button" onClick={toggle} aria-expanded={expanded} aria-controls={navigationId} aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'} title={expanded ? 'Collapse navigation' : 'Expand navigation'}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><use href={`/brand/navigation.svg#${expanded ? 'PanelLeftClose' : 'PanelLeftOpen'}`} /></svg>
      </button>
    </div>
    <nav id={navigationId} className={`desktop-navigation ${styles.links}`} aria-label="Primary navigation">
      {destinations.map(({ href, key, icon, also }) => {
        const active = pathname === href || also.some(prefix => pathname?.startsWith(prefix));
        return <Link key={href} href={href} aria-label={t(key)} title={expanded ? undefined : t(key)} aria-current={active ? 'page' : undefined} className={href === '/more' ? styles.utility : undefined}>
          {/* One cacheable sprite avoids repeating six path sets in every exported route. */}
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><use href={`/brand/navigation.svg#${icon}`} /></svg><span>{t(key)}</span>
        </Link>;
      })}
    </nav>
  </aside>;
}
