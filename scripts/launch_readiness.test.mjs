import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const publicRoot = resolve(root, 'apps/mini-app/public');

test('app sitemap URLs resolve to public app pages and omit compatibility/login routes', async () => {
  const sitemap = await readFile(resolve(publicRoot, 'sitemap.xml'), 'utf8');
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => new URL(match[1]));
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.equal(url.origin, 'https://fxaeon.com');
    assert.ok(!['/portfolio', '/login', '/activity'].includes(url.pathname));
    await access(url.pathname.endsWith('.html')
      ? resolve(publicRoot, '.' + url.pathname)
      : resolve(root, 'apps/mini-app/src/app', '.' + url.pathname, 'page.tsx'));
  }
  const robots = await readFile(resolve(publicRoot, 'robots.txt'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/fxaeon\.com\/sitemap\.xml/);
});

test('privacy disclosure remains reachable and accurately separates device and provider data', async () => {
  const privacy = await readFile(resolve(publicRoot, 'privacy.html'), 'utf8');
  const docsHome = await readFile(resolve(root, 'apps/mini-app/src/app/docs/page.tsx'), 'utf8');
  const docs = await readFile(resolve(root, 'apps/mini-app/src/app/docs/guide/page.tsx'), 'utf8');
  const article = await readFile(resolve(root, 'apps/mini-app/src/app/docs/ProductArticle.tsx'), 'utf8');
  assert.ok(docsHome.includes('href={`/docs/guide#${id}`}'));
  assert.match(docs, /import ProductArticle[^;]+['"]\.\.\/ProductArticle['"]/);
  assert.match(docs, /<ProductArticle\s*\/>/);
  assert.match(article, /href="\/privacy\.html"/);
  assert.match(privacy, /browser storage/);
  assert.match(privacy, /public blockchains are publicly visible/);
  assert.doesNotMatch(privacy, /never collect|fully anonymous|GDPR compliant|CCPA compliant/i);
  for (const file of ['document.css', 'icon.svg']) await access(resolve(publicRoot, file));
});
