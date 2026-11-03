import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { productHref, productNavigation } from '../src/app/docs/productNavigation';
import { sdkHref, sdkNavigation } from '../src/app/docs/sdkNavigation';

// Render the real public article/shell graph without a Next build or a wallet.
const testRequire = createRequire(import.meta.url);
const previousCssLoader = testRequire.extensions['.css'];
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
testRequire.extensions['.css'] = (loadedModule, filename) => {
  const names = [...readFileSync(filename, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(([, name]) => name);
  loadedModule.exports = Object.fromEntries(names.map(name => [name, `test-${name}`]));
};
after(() => {
  if (previousCssLoader) testRequire.extensions['.css'] = previousCssLoader;
  else delete testRequire.extensions['.css'];
  if (previousReact) globalReact.React = previousReact;
  else Reflect.deleteProperty(globalThis, 'React');
});

test('all 24 public topics render useful text, one H1, semantic sections, and valid internal links without hydration', async () => {
  const DocsShell = testRequire('../src/app/docs/DocsShell.tsx').default;
  const { topicContent } = testRequire('../src/app/docs/DocsPrimitives.tsx');
  const { productSections } = testRequire('../src/app/docs/ProductArticle.tsx');
  const { sdkSections } = testRequire('../src/app/docs/sdk/SdkArticle.tsx');
  const guideMetadata = testRequire('../src/app/docs/guide/[topic]/page.tsx').generateMetadata;
  const sdkMetadata = testRequire('../src/app/docs/sdk/[topic]/page.tsx').generateMetadata;
  const pages = new Map<string, string>();
  for (const [navigation, sections, href, page] of [
    [productNavigation, productSections, productHref, 'Product guide'],
    [sdkNavigation, sdkSections, sdkHref, 'SDK reference'],
  ] as const) {
    for (const article of navigation) {
      const section = sections.find((item: { id: string }) => item.id === article.id);
      assert.ok(section, article.id);
      const html = renderToStaticMarkup(React.createElement(DocsShell, { page, articleId: article.id }, topicContent(section.content)));
      const metadata = await (page === 'Product guide' ? guideMetadata : sdkMetadata)({ params: Promise.resolve({ topic: article.id.replace(/^sdk-/, '') }) });
      assert.equal(metadata.title.absolute, `${article.title} · FxAeon ${page === 'Product guide' ? 'Docs' : 'SDK'}`);
      assert.equal(metadata.alternates.canonical, `https://fxaeon.com${href(article.id)}`);
      assert.equal(html.match(/<h1\b/g)?.length, 1, article.id);
      assert.ok(!html.includes('<h3') || html.includes('<h2'), `${article.id}: no skipped heading level`);
      assert.ok(html.includes('<p>'), `${article.id}: readable paragraphs`);
      assert.ok(html.includes(article.title.replaceAll('&', '&amp;').replaceAll('’', '&#x27;')) || html.includes(article.title.replaceAll('&', '&amp;')), article.id);
      pages.set(href(article.id), html);
    }
  }
  assert.equal(pages.size, 24);
  const known = new Set(['/', '/docs', '/docs/guide', '/docs/sdk', '/trade', '/earn', '/borrow', '/move', '/qr', '/history', '/positions', '/send', '/more', '/settings', '/login', '/privacy', ...pages.keys()]);
  let checked = 0;
  for (const [path, html] of pages) {
    for (const [, href] of html.matchAll(/href="([^"<>]+)"/g)) {
      if (!href.startsWith('/') && !href.startsWith('#')) continue;
      const url = new URL(href.replaceAll('&amp;', '&'), `https://fxaeon.com${path}`);
      assert.ok(known.has(url.pathname), `${path} links to unknown ${href}`);
      const target = pages.get(url.pathname);
      if (url.hash && target) assert.ok(target.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `${path}: broken fragment ${href}`);
      assert.doesNotMatch(url.pathname, /^\/(?:api|admin|operator|invite|wallet-approval)(?:\/|$)/);
      checked++;
    }
  }
  assert.ok(checked > 100, 'checked the rendered navigation and article links');
  assert.match(pages.get('/docs/guide/overview')!, /independent interface for f\(x\) Protocol/);
  assert.match(pages.get('/docs/guide/risks')!, /liquidation/i);
  assert.match(pages.get('/docs/sdk/setup')!, /FxSdk/);
  await assert.rejects(guideMetadata({ params: Promise.resolve({ topic: 'unknown' }) }), /NEXT_HTTP_ERROR_FALLBACK;404/);
  await assert.rejects(sdkMetadata({ params: Promise.resolve({ topic: 'unknown' }) }), /NEXT_HTTP_ERROR_FALLBACK;404/);
});
