'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowUpRight, BookOpen, ChevronDown, Search } from 'lucide-react';
import { ExternalLink } from './ExternalLink';
import FxLogo from '@/components/FxLogo';
import ThemeToggle from '@/components/ThemeToggle';
import { searchDocs, searchExcerpt, type DocsEntry } from './docsSearch';
import styles from './Docs.module.css';

type Page = 'Product guide' | 'SDK reference';
const PRODUCT_GROUPS = [
  { label: 'Start here', ids: ['overview', 'getting-started', 'access', 'wallets'] },
  { label: 'Use FxAeon', ids: ['trade', 'positions', 'earn', 'borrow', 'move'] },
  { label: 'Know before you sign', ids: ['fees', 'history', 'privacy', 'troubleshooting'] },
];

export default function DocsShell({ page, entries, children, home = false }: { page: Page; entries: DocsEntry[]; children: ReactNode; home?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(true);
  const [activeId, setActiveId] = useState(page === 'Product guide' ? 'overview' : 'sdk-overview');
  const inputRef = useRef<HTMLInputElement>(null);
  const currentEntries = useMemo(() => entries.filter((entry) => entry.page === page), [entries, page]);
  const results = useMemo(() => searchDocs(entries, query), [entries, query]);
  const searching = query.trim().length > 0;
  const groups = page === 'Product guide'
    ? PRODUCT_GROUPS
    : [{ label: 'In this reference', ids: currentEntries.map(({ id }) => id) }];

  useEffect(() => {
    if (!home) return;
    const followLegacyHash = () => {
      if (window.location.hash) router.replace(`/docs/guide${window.location.hash}`);
    };
    followLegacyHash();
    window.addEventListener('hashchange', followLegacyHash);
    return () => window.removeEventListener('hashchange', followLegacyHash);
  }, [home, router]);

  useEffect(() => {
    setHydrated(true);
    const media = window.matchMedia('(max-width: 760px)');
    const syncContents = () => setContentsOpen(!media.matches);
    syncContents();
    media.addEventListener('change', syncContents);
    const root = document.querySelector<HTMLElement>(`.${styles.docsPage}`);
    const scrollRoot = root && getComputedStyle(root).overflowY === 'auto' ? root : undefined;
    let frame = 0;
    let cancelled = false;
    const updateActive = () => {
      frame = 0;
      const top = (scrollRoot?.getBoundingClientRect().top ?? 0) + (media.matches ? 185 : 144);
      const headings = currentEntries.map(({ id }) => document.getElementById(id)).filter((node): node is HTMLElement => Boolean(node));
      const current = headings.filter((node) => node.getBoundingClientRect().top <= top).at(-1) ?? headings[0];
      if (current) setActiveId(current.id);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(updateActive); };
    const scrollToHash = (focusHeading: boolean) => {
      let id = window.location.hash.slice(1);
      try { id = decodeURIComponent(id); } catch { /* A malformed fragment must not break reading. */ }
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      if (media.matches) setContentsOpen(false);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (cancelled) return;
        target.scrollIntoView({ block: 'start' });
        if (focusHeading) {
          const heading = target.matches('h2, h3') ? target
            : target.querySelector<HTMLElement>('h2, h3') ?? target.parentElement?.querySelector<HTMLElement>('h2');
          heading?.focus({ preventScroll: true });
        }
        updateActive();
      }));
    };
    const restoreHash = () => scrollToHash(true);
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === inputRef.current) {
        setQuery('');
        if (media.matches) setContentsOpen(false);
      }
    };
    (scrollRoot ?? window).addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', restoreHash);
    window.addEventListener('keydown', onShortcut);
    restoreHash();
    void document.fonts.ready.then(() => { if (!cancelled) scrollToHash(false); });
    updateActive();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      media.removeEventListener('change', syncContents);
      (scrollRoot ?? window).removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', restoreHash);
      window.removeEventListener('keydown', onShortcut);
    };
  }, [currentEntries]);

  function followSection(id: string) {
    setActiveId(id);
    if (window.matchMedia('(max-width: 760px)').matches) setContentsOpen(false);
    // The current hash may be clicked again after scrolling away. Native hash
    // navigation alone does not consistently restore that location.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = document.getElementById(id);
      target?.scrollIntoView({ block: 'start' });
      target?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    }));
  }

  const count = searching ? results.length : currentEntries.length;
  return (
    <div className={`${styles.docsPage} ${home ? styles.homePage : ''}`} data-searching={searching || undefined}>
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <header className={styles.docsChrome}>
          <div className={styles.docsTopbar}>
            <Link href="/docs" className={styles.docsBrand} aria-label="FxAeon docs home">
              <FxLogo size={29} />
              <span className={styles.srOnly}>FxAeon documentation</span>
            </Link>
            <div className={styles.searchRow}>
              <Search className={styles.searchIcon} aria-hidden="true" />
              <label className={styles.srOnly} htmlFor="docs-search">Search docs</label>
              <input id="docs-search" ref={inputRef} type="search" value={query} disabled={!hydrated}
                onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim()) setContentsOpen(true); }}
                placeholder="Search docs…" className={styles.searchInput} autoComplete="off" aria-controls="docs-contents" />
              {query
                ? <button type="button" className={styles.clearSearch} onClick={() => { setQuery(''); inputRef.current?.focus(); }}>Clear</button>
                : <kbd className={styles.searchShortcut}>Ctrl K</kbd>}
            </div>
            <nav className={styles.chromeLinks} aria-label="FxAeon links">
              <ExternalLink href="https://fxaeon.xyz/">Website</ExternalLink>
              <Link href="/" className={styles.openApp}>Open app <ArrowUpRight size={14} aria-hidden="true" /></Link>
              <ThemeToggle className={styles.docsTheme} />
            </nav>
          </div>
          <div className={styles.docsSubnav} role="group" aria-label="Documentation guides">
            <span className={styles.subnavLabel}>Documentation</span>
            <Link href="/docs/guide#getting-started" aria-current={!home && page === 'Product guide' ? 'page' : undefined}>Start here</Link>
            <Link href="/docs/guide#trade">Products</Link>
            <Link href="/docs/guide#wallets">Wallets</Link>
            <Link href="/docs/guide#troubleshooting">Help</Link>
            <Link href="/docs/sdk" aria-current={page === 'SDK reference' ? 'page' : undefined}>SDK reference</Link>
            <span className={styles.subnavCurrent} aria-current="location">{page}</span>
          </div>
        </header>
        <div className={styles.docsLayout}>
          <nav className={styles.docsNav} aria-label="Documentation sections" aria-busy={!hydrated}>
            <div className={styles.railTitle}><BookOpen size={16} aria-hidden="true" />On this page</div>
            <p className={styles.srOnly} role="status">{searching ? `${count} documentation ${count === 1 ? 'result' : 'results'} found` : ''}</p>
            <details className={styles.contentsDisclosure} open={contentsOpen} onToggle={(event) => setContentsOpen(event.currentTarget.open)}>
              <summary className={styles.contentsSummary}>
                <span>Contents</span>
                <span className={styles.contentsCount} aria-live="polite">{count ? `${count} ${searching ? (count === 1 ? 'result' : 'results') : 'sections'}` : 'No matches'}</span>
                <ChevronDown size={16} className={styles.contentsChevron} aria-hidden="true" />
              </summary>
              <div className={styles.navLinks} id="docs-contents">
                {searching ? <>
                  <p className={styles.navGroupLabel}>Search all documentation</p>
                  {results.map((entry) => <Link key={entry.href} href={!home && entry.page === page ? `#${entry.id}` : entry.href}
                    className={styles.searchResult} onClick={() => { setQuery(''); if (!home && entry.page === page) followSection(entry.id); }}>
                    <span className={styles.resultTitle}>{entry.title}<ArrowRight size={13} aria-hidden="true" /></span>
                    <span className={styles.resultPage}>{entry.page}</span>
                    <span className={styles.resultExcerpt}>{searchExcerpt(entry.text, query)}</span>
                  </Link>)}
                  {!results.length && <p className={styles.emptySearch}>Nothing found for “{query}”. Try wallet, cooldown, bridge, or a method name.</p>}
                </> : <>
                  {groups.map((group) => <div key={group.label} className={styles.navGroup}>
                    <p className={styles.navGroupLabel}>{group.label}</p>
                    {group.ids.map((id) => {
                      const entry = currentEntries.find((item) => item.id === id);
                      return entry && <a key={id} href={`#${id}`} className={styles.navLink}
                        aria-current={activeId === id ? 'location' : undefined} onClick={() => followSection(id)}>{entry.title}</a>;
                    })}
                  </div>)}
                </>}
              </div>
            </details>
          </nav>
          <main id="main-content" tabIndex={-1} className={styles.docsContent}>
          <article>
            <header className={styles.docsIntro}>
              {!home && <p className={styles.breadcrumb}><Link href="/docs">Docs</Link><span aria-hidden="true">/</span><span>{page}</span></p>}
              <h1 id="docs-page-heading" tabIndex={-1}>{home ? 'Welcome to FxAeon' : page === 'Product guide' ? 'Product guide' : 'The f(x) SDK in FxAeon'}</h1>
              {home ? <p className={styles.lead}>FxAeon brings <strong>trading, savings, borrowing, and bridging</strong> to your browser and Telegram. Use f(x) Protocol on <strong>Ethereum</strong>, and move supported assets between <strong>Ethereum and Base</strong>.</p> : page === 'Product guide'
                ? <p className={styles.lead}>Your guide to Trade, Earn, Borrow, and Move. Understand the action before you sign.</p>
                : <>
                  <p className={styles.lead}>The methods, units, and safeguards behind the app. Start with a read, then explore how a reviewed transaction reaches the chain.</p>
                  <p className={styles.versionLine}><span className={styles.versionBadge}>SDK 1.0.5</span>15 supported methods<span aria-hidden="true">·</span>Local patches documented</p>
                </>}
            </header>
            {children}
            {!home && <><Link href={page === 'Product guide' ? '/docs/sdk' : '/docs/guide#getting-started'} className={styles.nextPage}>
              <span><span className={styles.nextLabel}>{page === 'Product guide' ? 'For developers' : 'Back to the guide'}</span>
                <strong>{page === 'Product guide' ? 'Explore the SDK integration' : 'Get started with FxAeon'}</strong></span>
              <ArrowRight size={21} aria-hidden="true" />
            </Link>
            <footer className={styles.docsFooter}>
              <p>FxAeon is an independent interface. These docs describe its supported integration, not the full f(x) Protocol.</p>
              <div className={styles.footerLinks}>
                <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs">f(x) Protocol docs</ExternalLink>

                <Link href="/">Open FxAeon <ArrowRight size={13} aria-hidden="true" /></Link>
              </div>
            </footer></>}
          </article>
          </main>
        </div>
    </div>
  );
}
