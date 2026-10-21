'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import DocsIcon, { type DocsIconName } from './DocsIcon';
import { ExternalLink } from './ExternalLink';
import FxLogo from '@/components/FxLogo';
import { searchDocs, searchExcerpt, type DocsEntry } from './docsSearch';
import styles from './Docs.module.css';
import { productHref, productNavigation } from './productNavigation';
import { sdkHref, sdkNavigation } from './sdkNavigation';

type Page = 'Product guide' | 'SDK reference';
const PAGE_ICONS: Record<string, DocsIconName> = { overview: 'Globe', 'getting-started': 'Rocket', access: 'MessageCircle', wallets: 'Wallet', trade: 'CandlestickChart', positions: 'List', earn: 'Sprout', borrow: 'Landmark', move: 'ArrowLeftRight', fees: 'Settings2', history: 'History', privacy: 'ShieldCheck', troubleshooting: 'CircleHelp' };

let searchIndex: Promise<DocsEntry[]> | undefined;
function fetchSearchIndex() {
  return searchIndex ??= fetch('/docs/search-index.json').then(async response => {
    if (!response.ok) throw new Error('Search index unavailable');
    return await response.json() as DocsEntry[];
  }).catch(error => { searchIndex = undefined; throw error; });
}

export default function DocsShell({ page, children, home = false, articleId }: { page: Page; children: ReactNode; home?: boolean; articleId?: string }) {
  const [query, setQuery] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(true);
  const [activeId, setActiveId] = useState(page === 'Product guide' ? 'overview' : 'sdk-overview');
  const [outline, setOutline] = useState<{ id: string; title: string }[]>([]);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileLinksOpen, setMobileLinksOpen] = useState(false);
  const [searchEntries, setSearchEntries] = useState<DocsEntry[] | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [mobile, setMobile] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelOpenerRef = useRef<HTMLElement | null>(null);
  const chromeRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const mobileOptionsRef = useRef<HTMLButtonElement>(null);
  const results = useMemo(() => searchDocs(searchEntries ?? [], query), [searchEntries, query]);
  const searching = query.trim().length > 0;
  const navigation = page === 'Product guide' ? productNavigation : sdkNavigation;
  const article = navigation.find(item => item.id === articleId);
  const articleHref = page === 'Product guide' ? productHref : sdkHref;
  const groups = [...new Set(navigation.map(item => item.group))].map(label => ({ label, ids: navigation.filter(item => item.group === label).map(item => item.id) }));
  const articleIndex = navigation.findIndex(item => item.id === article?.id);
  const previousArticle = navigation[articleIndex - 1];
  const nextArticle = navigation[articleIndex + 1];
  const mobilePanelOpen = mobile && (contentsOpen || mobileSearchOpen || mobileLinksOpen);

  useEffect(() => {
    const chrome = chromeRef.current;
    if (!chrome) return;
    const resize = () => rootRef.current?.style.setProperty('--docs-chrome-height', `${chrome.getBoundingClientRect().height}px`);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(chrome);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!mobilePanelOpen) return;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('a[href], button, input, summary, [tabindex="0"]') ?? [])
        .filter(node => !node.closest('[inert]') && !node.matches(':disabled, .skip-link') && node.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', trapFocus);
    return () => window.removeEventListener('keydown', trapFocus);
  }, [mobilePanelOpen]);

  function prepareSearch() {
    if (searchEntries) return;
    setSearchError(false);
    void fetchSearchIndex().then(setSearchEntries).catch(() => setSearchError(true));
  }

  useEffect(() => {
    if (mobileSearchOpen && hydrated) inputRef.current?.focus();
  }, [mobileSearchOpen, hydrated]);

  useEffect(() => {
    if (!article) return;
    setMobileSearchOpen(false);
    setMobileLinksOpen(false);
    setQuery('');
    setOutline(Array.from(document.querySelectorAll<HTMLElement>(`[data-docs-article] h2[id], [data-docs-article] h3[id]`)).map(node => {
      node.tabIndex = -1;
      const label = node.cloneNode(true) as HTMLElement;
      label.querySelectorAll('[aria-hidden="true"]').forEach(mark => mark.remove());
      return { id: node.id, title: label.textContent?.trim() ?? '' };
    }));
  }, [article]);

  useEffect(() => {
    setHydrated(true);
    const media = window.matchMedia('(max-width: 760px)');
    const syncContents = () => { setMobile(media.matches); setContentsOpen(!media.matches); };
    syncContents();
    media.addEventListener('change', syncContents);
    const root = document.querySelector<HTMLElement>(`.${styles.docsPage}`);
    const scrollRoot = root && getComputedStyle(root).overflowY === 'auto' ? root : undefined;
    let frame = 0;
    let cancelled = false;
    const updateActive = () => {
      frame = 0;
      const top = (scrollRoot?.getBoundingClientRect().top ?? 0) + (media.matches ? 96 : 144);
      const headings = Array.from(document.querySelectorAll<HTMLElement>('[data-docs-article] h2[id], [data-docs-article] h3[id]'));
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
          const heading = target.matches('h1, h2, h3') ? target
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
        if (media.matches) { panelOpenerRef.current = mobileSearchRef.current; setMobileSearchOpen(true); setMobileLinksOpen(false); setContentsOpen(true); }
        else inputRef.current?.focus();
      }
      if (event.key === 'Escape' && !media.matches && document.activeElement === inputRef.current) {
        setQuery('');
      }
      if (event.key === 'Escape' && media.matches) {
        setQuery(''); setMobileSearchOpen(false); setMobileLinksOpen(false); setContentsOpen(false);
        panelOpenerRef.current?.focus();
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
  }, [article]);

  const count = searching ? results.length : navigation.length;
  return (
    <div ref={rootRef} className={`${styles.docsPage} ${article ? styles.articlePage : ''}`} data-searching={searching || undefined} data-mobile-search={mobileSearchOpen || undefined} data-navigation-open={(hydrated && contentsOpen) || undefined} data-mobile-options={mobileLinksOpen || undefined}>
        <a href="#main-content" className="skip-link" inert={mobilePanelOpen || undefined}>Skip to main content</a>
        <header ref={chromeRef} className={styles.docsChrome}>
          <div className={styles.docsTopbar}>
            <div className={styles.mobileMenu}><button ref={mobileMenuRef} type="button" aria-label={contentsOpen ? 'Close documentation menu' : 'Open documentation menu'} aria-expanded={contentsOpen} aria-controls="docs-contents" onClick={() => { panelOpenerRef.current = mobileMenuRef.current; setContentsOpen(!contentsOpen); setMobileSearchOpen(false); setMobileLinksOpen(false); setQuery(''); }}><DocsIcon name="Menu" size={18} /></button></div>
            <Link href="/docs" className={styles.docsBrand} aria-label="FxAeon docs home">
              <FxLogo size={29} />
              <span>FxAeon Docs</span>
            </Link>
            <div data-focus-field className={styles.searchRow}>
              <DocsIcon name="Search" className={styles.searchIcon} />
              <label className={styles.srOnly} htmlFor="docs-search">Search docs</label>
              <input id="docs-search" ref={inputRef} type="search" value={query} disabled={!hydrated} onFocus={prepareSearch}
                onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim()) setContentsOpen(true); }}
                placeholder="Search docs…" className={styles.searchInput} autoComplete="off" aria-controls="docs-contents" />
              {query
                ? <button type="button" className={styles.clearSearch} onClick={() => { setQuery(''); inputRef.current?.focus(); }}>Clear</button>
                : <kbd className={styles.searchShortcut}>Ctrl K</kbd>}
            </div>
            <nav className={styles.chromeLinks} aria-label="FxAeon links">
              <ExternalLink href="https://fxaeon.xyz/">Website</ExternalLink>
              <span className={styles.supportLink}><ExternalLink href="https://x.com/FxAeonxyz">Support</ExternalLink></span>
              <Link href="/" prefetch={false} className={styles.openApp}>Open app <DocsIcon name="ArrowUpRight" size={14} /></Link>
            </nav>
            <div className={styles.mobileActions}>
              <button ref={mobileSearchRef} type="button" aria-label="Search documentation" aria-expanded={mobileSearchOpen} onClick={() => { panelOpenerRef.current = mobileSearchRef.current; setMobileSearchOpen(!mobileSearchOpen); setMobileLinksOpen(false); setContentsOpen(!mobileSearchOpen); if (mobileSearchOpen) setQuery(''); }}><DocsIcon name="Search" size={20} /></button>
              <button ref={mobileOptionsRef} type="button" aria-label="More documentation options" aria-expanded={mobileLinksOpen} onClick={() => { panelOpenerRef.current = mobileOptionsRef.current; setMobileLinksOpen(!mobileLinksOpen); setMobileSearchOpen(false); setContentsOpen(false); setQuery(''); }}><DocsIcon name="EllipsisVertical" size={20} /></button>
              {mobileLinksOpen && <nav className={styles.mobileLinks} aria-label="Documentation options"><ExternalLink href="https://fxaeon.xyz/">Website</ExternalLink><ExternalLink href="https://x.com/FxAeonxyz">Support</ExternalLink><Link href="/" prefetch={false}>Open app</Link></nav>}
            </div>
          </div>

        </header>
        <div className={styles.docsLayout}>
          <nav className={styles.docsNav} aria-label="Pages" aria-busy={!hydrated}>
            <div className={styles.railTitle}><DocsIcon name="BookOpen" size={16} />On this page</div>
            <p className={styles.srOnly} role="status">{searching ? searchEntries ? `${count} documentation ${count === 1 ? 'result' : 'results'} found` : searchError ? 'Documentation search unavailable' : 'Loading documentation search' : ''}</p>
            <details className={styles.contentsDisclosure} open={contentsOpen} onToggle={(event) => setContentsOpen(event.currentTarget.open)}>
              <summary className={styles.contentsSummary}>
                <span>Contents</span>
                <span aria-live="polite">{count ? `${count} ${searching ? (count === 1 ? 'result' : 'results') : 'sections'}` : 'No matches'}</span>
                <DocsIcon name="ChevronDown" size={16} />
              </summary>
              <div className={styles.navLinks} id="docs-contents" onClick={event => {
                if (mobile && (event.target as HTMLElement).closest('a[href]')) { setContentsOpen(false); setMobileSearchOpen(false); }
              }}>
                {!searching && <Link href="/docs" className={styles.navLink} aria-current={home ? 'location' : undefined}>FxAeon Documentation</Link>}
                {searching ? <>
                  <p className={styles.navGroupLabel}>Search all documentation</p>
                  {results.map((entry) => <Link key={entry.href} href={entry.href}
                    className={styles.searchResult} onClick={() => { setQuery(''); setMobileSearchOpen(false); if (mobile) setContentsOpen(false); }}>
                    <span className={styles.resultTitle}>{entry.title}<DocsIcon name="ArrowRight" size={13} /></span>
                    <span className={styles.resultPage}>{entry.page}</span>
                    <span className={styles.resultExcerpt}>{searchExcerpt(entry.text, query)}</span>
                  </Link>)}
                  {!searchEntries ? <p className={styles.emptySearch}>{searchError ? <>Search could not load. <button type="button" onClick={prepareSearch}>Try again</button></> : 'Loading search…'}</p> : !results.length && <p className={styles.emptySearch}>Nothing found for “{query}”. Try wallet, cooldown, bridge, or a method name.</p>}
                </> : <>
                  {groups.map((group) => <div key={group.label} className={styles.navGroup}>
                    <p className={styles.navGroupLabel}>{group.label}</p>
                    {group.ids.map((id) => {
                      const entry = navigation.find((item) => item.id === id);
                      const icon = PAGE_ICONS[id] ?? 'BookOpen';
                      return entry && <Link key={id} href={articleHref(id)} className={styles.navLink}
                        aria-current={article?.id === id ? 'location' : undefined}>
                        <DocsIcon name={icon} />{entry.title}
                      </Link>;
                    })}
                  </div>)}
                  <Link href={page === 'SDK reference' ? productHref('getting-started') : '/docs/sdk/overview'} className={styles.navLink}><DocsIcon name="BookOpen" size={16} />{page === 'SDK reference' ? 'Product guide' : 'SDK reference'}</Link>
                </>}
              </div>
            </details>
          </nav>
          <main id="main-content" tabIndex={-1} className={styles.docsContent} inert={mobilePanelOpen || undefined}>
          <article className={styles.readingArticle}>
            <header className={styles.docsIntro}>
              {!home && <p className={styles.breadcrumb}><Link href="/docs">Docs</Link><span aria-hidden="true">/</span><span>{article ? article.group : page}</span></p>}
              <h1 id="docs-page-heading" tabIndex={-1}>{article?.title ?? (home ? 'FxAeon Documentation' : page === 'Product guide' ? 'Product guide' : 'The f(x) SDK in FxAeon')}</h1>
              {article ? <p className={styles.lead}>{article.description}</p> : home ? <p className={styles.lead}>Understand the products, use the app, and know what you are signing.</p> : page === 'Product guide'
                ? <p className={styles.lead}>Your guide to Trade, Earn, Borrow, and Move. Understand the action before you sign.</p>
                : <>
                  <p className={styles.lead}>The methods, units, and safeguards behind the app. Start with a read, then explore how a reviewed transaction reaches the chain.</p>
                  <p className={styles.versionLine}><span className={styles.versionBadge}>SDK 1.0.5</span>15 supported methods<span aria-hidden="true">·</span>Local patches documented</p>
                </>}
            </header>
            <div data-docs-article className={styles.articleBody}>{children}</div>
            {article && <nav className={styles.articlePagination} aria-label="Pagination">
              {previousArticle ? <Link href={articleHref(previousArticle.id)}><DocsIcon name="ArrowLeft" size={16} /><span><small>Previous</small>{previousArticle.title}</span></Link> : <span />}
              {nextArticle ? <Link href={articleHref(nextArticle.id)}><span><small>Next</small>{nextArticle.title}</span><DocsIcon name="ArrowRight" size={16} /></Link> : <Link href={page === 'Product guide' ? '/docs/sdk/overview' : '/docs'}><span><small>Next</small>{page === 'Product guide' ? 'SDK reference' : 'Documentation home'}</span><DocsIcon name="ArrowRight" size={16} /></Link>}
            </nav>}
            <>{!home && !article && <Link href={page === 'Product guide' ? '/docs/sdk/overview' : '/docs/guide/getting-started'} className={styles.nextPage}>
              <span><span className={styles.nextLabel}>{page === 'Product guide' ? 'For developers' : 'Back to the guide'}</span>
                <strong>{page === 'Product guide' ? 'Explore the SDK integration' : 'Get started with FxAeon'}</strong></span>
              <DocsIcon name="ArrowRight" size={21} />
            </Link>}
            <footer className={styles.docsFooter}>
              <p>FxAeon is an independent interface. These docs describe its supported integration, not the full f(x) Protocol.</p>
              <div className={styles.footerLinks}>
                <ExternalLink href="https://fxprotocol.gitbook.io/fx-docs">f(x) Protocol docs</ExternalLink>

                <Link href="/">Open FxAeon <DocsIcon name="ArrowRight" size={13} /></Link>
              </div>
            </footer></>
          </article>
          {article && outline.length > 0 && <nav className={styles.articleOutline} aria-label="On this page"><p><DocsIcon name="List" size={14} />On this page</p>{outline.map(item => <a key={item.id} href={`#${item.id}`} aria-current={activeId === item.id ? 'location' : undefined}>{item.title}</a>)}</nav>}
          </main>
        </div>
    </div>
  );
}
