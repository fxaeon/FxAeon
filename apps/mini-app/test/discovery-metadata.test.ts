import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CAPABILITY_ROBOTS, DEFAULT_ROBOTS, pageMetadata, routeMetadata, SOCIAL_IMAGE_URL } from '../src/app/routeMetadata';
import { productHref, productNavigation } from '../src/app/docs/productNavigation';
import { sdkHref, sdkNavigation } from '../src/app/docs/sdkNavigation';
import { structuredData } from '../src/app/docs/structuredData';
import { discoveryArtifacts, generateDiscovery } from '../../../scripts/generate_discovery.mjs';

test('maintained discovery guidance excludes machine paths and implementation-session history', async () => {
  const guidance = await readFile(new URL('../../../docs/discovery-seo-research.md', import.meta.url), 'utf8');
  // Boolean assertions keep any future accidentally included value out of diagnostics.
  assert.equal(/\b[A-Za-z]:[\\/]|\/(?:Users|home)\/[^/\s]+\/|file:\/\/\//.test(guidance), false, 'Guidance must not contain local machine paths');
  assert.equal(/\bcodex\/[a-z0-9-]+|^## (?:Evidence|Changed paths|PR \d+ integration evidence)\b|\b(?:worktree|shell pnpm|test development)\b/im.test(guidance), false, 'Keep implementation-session history in local evidence');
  assert.ok(guidance.includes('## Official guidance'));
  assert.ok(guidance.includes('## External launch checklist'));
});

test('index policy separates public documentation from interactive and capability routes', () => {
  assert.deepEqual(DEFAULT_ROBOTS, { index: false, follow: true });
  for (const route of ['trade', 'earn', 'borrow', 'move'] as const) {
    assert.deepEqual(routeMetadata(route).robots, { index: true, follow: true }, route);
    assert.equal(routeMetadata(route).alternates?.canonical, `https://fxaeon.com/${route}`);
  }
  for (const route of ['portfolio', 'send', 'more', 'history', 'positions', 'qr', 'settings', 'login'] as const) {
    assert.deepEqual(routeMetadata(route).robots, DEFAULT_ROBOTS, route);
  }
  for (const route of ['docs', 'docsGuide', 'docsSdk'] as const) {
    assert.deepEqual(routeMetadata(route).robots, { index: true, follow: true }, route);
  }
  assert.equal(routeMetadata('docsGuide').alternates?.canonical, 'https://fxaeon.com/docs/guide');
});

test('secret-link metadata stays noindex with a clean canonical and no referrer', async () => {
  for (const [key, path] of [['invite', 'invite'], ['walletApproval', 'wallet-approval']] as const) {
    const metadata = routeMetadata(key);
    assert.deepEqual(metadata.robots, CAPABILITY_ROBOTS);
    assert.equal(metadata.referrer, 'no-referrer');
    assert.equal(metadata.alternates?.canonical, `https://fxaeon.com/${path}`);
    assert.equal(metadata.openGraph?.url, `https://fxaeon.com/${path}`);
    const layout = await readFile(new URL(`../src/app/${path}/layout.tsx`, import.meta.url), 'utf8');
    assert.ok(layout.includes(`routeMetadata('${key}')`));
  }
  const root = await readFile(new URL('../src/app/layout.tsx', import.meta.url), 'utf8');
  assert.match(root, /robots: DEFAULT_ROBOTS/);
});

test('all public route and docs-topic metadata have unique accurate titles, descriptions, and complete share cards', () => {
  const pages = [
    ...(['trade', 'earn', 'borrow', 'move', 'docs', 'docsGuide', 'docsSdk'] as const).map(routeMetadata),
    ...productNavigation.map(({ id, title, description }) => pageMetadata(`${title} · FxAeon Docs`, description, productHref(id))),
    ...sdkNavigation.map(({ id, title, description }) => pageMetadata(`${title} · FxAeon SDK`, description, sdkHref(id))),
  ];
  const titles = pages.map(page => (page.title as { absolute: string }).absolute);
  assert.equal(new Set(titles).size, titles.length);
  assert.equal(new Set(pages.map(page => page.description)).size, pages.length);
  for (const page of pages) {
    const title = (page.title as { absolute: string }).absolute;
    assert.ok(page.description && page.description.length > 30);
    assert.equal(page.openGraph?.url, page.alternates?.canonical);
    assert.equal(page.openGraph?.title, title);
    assert.equal(page.twitter?.title, title);
    assert.equal(page.openGraph?.description, page.description);
    assert.equal(page.twitter?.description, page.description);
    assert.deepEqual(page.openGraph?.images, [{ url: SOCIAL_IMAGE_URL, width: 1200, height: 630, type: 'image/png', alt: 'FxAeon. Your DeFi, in motion. Trade, earn, borrow, and move with f(x) Protocol.' }]);
    const url = new URL(String(page.alternates?.canonical));
    assert.equal(url.origin, 'https://fxaeon.com');
    assert.equal(url.search + url.hash, '');
    assert.ok(!url.pathname.endsWith('/'));
  }
});

test('generated discovery artifacts are current and expose only known public pages', async () => {
  await generateDiscovery();
  const artifacts = discoveryArtifacts();
  const sitemap = artifacts.get('apps/mini-app/public/sitemap.xml')!;
  const llms = artifacts.get('apps/landing/llms.txt')!;
  assert.equal(llms, artifacts.get('apps/mini-app/public/llms.txt'));
  const allowed = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url));
  const extra = new Set(['https://fxaeon.xyz/', 'https://fxaeon.com/', 'https://t.me/FxAeonBot', 'https://fxprotocol.gitbook.io/fx-docs']);
  const links = [...llms.matchAll(/\]\((https:[^)]+)\)/g)].map(([, url]) => url);
  for (const url of links) assert.ok(allowed.has(url) || extra.has(url), url);
  for (const { id } of productNavigation) assert.ok(links.includes(`https://fxaeon.com${productHref(id)}`));
  for (const { id } of sdkNavigation) assert.ok(links.includes(`https://fxaeon.com${sdkHref(id)}`));
  for (const source of artifacts.values()) {
    assert.doesNotMatch(source, /https:\/\/fxaeon\.(?:com|xyz)\/(?:api|admin|operator|invite|wallet-approval|login|portfolio|positions|history|send|qr|more|settings)(?:[/?#"<\s)]|$)/);
    assert.doesNotMatch(source, /<lastmod>|<priority>|<changefreq>/, 'Do not invent change times or ranking signals');
  }
});

test('the discovery check fails on missing or stale files without silently rewriting them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fxaeon-discovery-'));
  try {
    await assert.rejects(generateDiscovery({ root }), /sitemap.xml is stale/);
    // The checker stops at the first missing file; it must not create it.
    await assert.rejects(readFile(join(root, 'apps/landing/sitemap.xml')), { code: 'ENOENT' });
    for (const [path, content] of discoveryArtifacts()) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    await generateDiscovery({ root });
    const file = join(root, 'apps/landing/llms.txt');
    await writeFile(file, 'stale');
    await assert.rejects(generateDiscovery({ root }), /llms.txt is stale/);
    assert.equal(await readFile(file, 'utf8'), 'stale');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('sitemaps resolve to real public sources and public docs explicitly inherit indexing', async () => {
  for (const route of ['trade', 'earn', 'borrow', 'move', 'docs', 'docs/guide', 'docs/sdk']) {
    await readFile(new URL(`../src/app/${route}/page.tsx`, import.meta.url));
  }
  const docsLayout = await readFile(new URL('../src/app/docs/layout.tsx', import.meta.url), 'utf8');
  assert.match(docsLayout, /routeMetadata\('docs'\)/);
  for (const section of ['guide', 'sdk']) {
    const page = await readFile(new URL(`../src/app/docs/${section}/[topic]/page.tsx`, import.meta.url), 'utf8');
    assert.match(page, /generateStaticParams/);
    assert.match(page, /dynamicParams = false/);
    assert.ok(page.includes(section === 'guide' ? ' · FxAeon Docs' : ' · FxAeon SDK'));
    assert.doesNotMatch(page, /noindex|index: false/);
  }
  const landing = await readFile(new URL('../../landing/sitemap.xml', import.meta.url), 'utf8');
  assert.deepEqual([...landing.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url), ['https://fxaeon.xyz/']);
});

test('public privacy policy has its own complete social card and one H1', async () => {
  const html = await readFile(new URL('../public/privacy.html', import.meta.url), 'utf8');
  const tags = [...html.matchAll(/<meta\s[^>]+>/gi)].map(match => Object.fromEntries([...match[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(value => [value[1], value[2]])));
  const meta = (key: string) => tags.find(tag => tag.property === key || tag.name === key)?.content;
  assert.equal(meta('og:title'), 'Privacy · FxAeon');
  assert.equal(meta('twitter:title'), meta('og:title'));
  assert.equal(meta('og:description'), meta('description'));
  assert.equal(meta('twitter:description'), meta('description'));
  assert.equal(meta('og:url'), 'https://fxaeon.com/privacy.html');
  assert.equal(meta('twitter:card'), 'summary_large_image');
  assert.equal(meta('og:image'), SOCIAL_IMAGE_URL);
  assert.equal(meta('twitter:image'), SOCIAL_IMAGE_URL);
  assert.equal(meta('og:image:width'), '1200');
  assert.equal(meta('og:image:height'), '630');
  assert.equal(meta('og:image:alt'), meta('twitter:image:alt'));
  assert.ok(meta('og:image:alt'));
  assert.equal(meta('robots'), undefined);
  assert.equal(html.match(/<h1\b/g)?.length, 1);
});

test('sitemap follows generated public docs routes and excludes action/capability URLs', async () => {
  const sitemap = await readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  const robots = await readFile(new URL('../public/robots.txt', import.meta.url), 'utf8');
  const actual = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
  const expected = [
    'https://fxaeon.com/trade', 'https://fxaeon.com/earn', 'https://fxaeon.com/borrow', 'https://fxaeon.com/move',
    'https://fxaeon.com/docs', 'https://fxaeon.com/docs/guide', 'https://fxaeon.com/docs/sdk',
    ...productNavigation.map(({ id }) => `https://fxaeon.com${productHref(id)}`),
    ...sdkNavigation.map(({ id }) => `https://fxaeon.com${sdkHref(id)}`),
    'https://fxaeon.com/privacy.html',
  ];
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  assert.ok(actual.every((url) => !/^https:\/\/fxaeon\.com\/(?:login|invite|wallet-approval|portfolio|history|positions|send|qr|settings|more)(?:\/|$)/.test(url)));
  assert.match(robots, /User-agent: \*[\s\S]*?Allow: \/[\s\S]*?Disallow: \/api\//);
  assert.doesNotMatch(robots, /Disallow: \/(?:login|invite|wallet-approval)/);
});

test('docs structured data describes the actual FxAeon sites without invented offers', () => {
  assert.deepEqual(structuredData, {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'FxAeon',
    url: 'https://fxaeon.com/',
    publisher: { '@type': 'Organization', name: 'FxAeon', url: 'https://fxaeon.xyz/' },
  });
});
