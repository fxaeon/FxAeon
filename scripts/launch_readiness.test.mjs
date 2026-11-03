import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createExportManifest } from '../apps/mini-app/e2e/serve.mjs';

const root = resolve(import.meta.dirname, '..');
const publicRoot = resolve(root, 'apps/mini-app/public');

test('app sitemap URLs resolve to public app pages and omit compatibility/login routes', async () => {
  const sitemap = await readFile(resolve(publicRoot, 'sitemap.xml'), 'utf8');
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => new URL(match[1]));
  const navigation = await readFile(resolve(root, 'apps/mini-app/src/app/docs/productNavigation.ts'), 'utf8');
  const topics = new Set([...navigation.matchAll(/id: '([^']+)'/g)].map(match => match[1]));
  const sdkNavigation = await readFile(resolve(root, 'apps/mini-app/src/app/docs/sdkNavigation.ts'), 'utf8');
  const sdkTopics = new Set([...sdkNavigation.matchAll(/id: 'sdk-([^']+)'/g)].map(match => match[1]));
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.equal(url.origin, 'https://fxaeon.com');
    assert.ok(!['/portfolio', '/login', '/activity'].includes(url.pathname));
    if (url.pathname.startsWith('/docs/guide/')) {
      assert.ok(topics.has(url.pathname.slice('/docs/guide/'.length)), 'Sitemap topic must be statically generated');
      await access(resolve(root, 'apps/mini-app/src/app/docs/guide/[topic]/page.tsx'));
      continue;
    }
    if (url.pathname.startsWith('/docs/sdk/')) {
      assert.ok(sdkTopics.has(url.pathname.slice('/docs/sdk/'.length)), 'Sitemap SDK topic must be statically generated');
      await access(resolve(root, 'apps/mini-app/src/app/docs/sdk/[topic]/page.tsx'));
      continue;
    }
    // Pages serves the exported public HTML file through its clean URL.
    if (url.pathname === '/privacy') {
      await access(resolve(publicRoot, 'privacy.html'));
      continue;
    }
    await access(url.pathname.endsWith('.html')
      ? resolve(publicRoot, '.' + url.pathname)
      : resolve(root, 'apps/mini-app/src/app', '.' + url.pathname, 'page.tsx'));
  }
  const robots = await readFile(resolve(publicRoot, 'robots.txt'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/fxaeon\.com\/sitemap\.xml/);
});

test('privacy disclosure remains reachable and accurately separates device and provider data', async () => {
  const exported = await createExportManifest(publicRoot);
  assert.equal(exported.get('/privacy')?.path, resolve(publicRoot, 'privacy.html'));
  assert.equal(exported.get('/privacy.html')?.path, exported.get('/privacy')?.path);
  const privacy = await readFile(resolve(publicRoot, 'privacy.html'), 'utf8');
  const docs = await readFile(resolve(root, 'apps/mini-app/src/app/docs/guide/page.tsx'), 'utf8');
  const article = await readFile(resolve(root, 'apps/mini-app/src/app/docs/ProductArticle.tsx'), 'utf8');
  const navigation = await readFile(resolve(root, 'apps/mini-app/src/app/docs/productNavigation.ts'), 'utf8');
  const topic = await readFile(resolve(root, 'apps/mini-app/src/app/docs/guide/[topic]/page.tsx'), 'utf8');
  // The compact guide links to the privacy topic; the topic renders its
  // shared article content. Browser tests verify the complete reachable path.
  assert.match(docs, /productNavigation\.map\(/);
  assert.match(docs, /href=\{productHref\(item\.id\)\}/);
  assert.match(navigation, /id: 'privacy'/);
  assert.match(topic, /productSections\.find\(\(\{ id \}\) => id === topic\)/);
  assert.match(topic, /topicContent\(section\.content\)/);
  assert.match(article, /href="\/privacy"/);
  assert.match(privacy, /browser storage/);
  assert.match(privacy, /public blockchains are publicly visible/);
  assert.doesNotMatch(privacy, /never collect|fully anonymous|GDPR compliant|CCPA compliant/i);
  for (const file of ['document.css', 'icon.svg']) await access(resolve(publicRoot, file));
});

// Font bytes belong to the release artifact, rather than a mocked API response.
test('the complete English interface ships its licensed variable font locally', async () => {
  const layout = await readFile(resolve(root, 'apps/mini-app/src/app/layout.tsx'), 'utf8');
  assert.match(layout, /from 'next\/font\/local'/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  const font = await readFile(resolve(root, 'apps/mini-app/src/app/fonts/inter-latin.woff2'));
  assert.equal(font.subarray(0, 4).toString(), 'wOF2');
  const license = await readFile(resolve(publicRoot, 'fonts/Inter-LICENSE.txt'), 'utf8');
  assert.match(license, /SIL OPEN FONT LICENSE/);
});
