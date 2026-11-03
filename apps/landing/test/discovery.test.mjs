import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the deployable landing artifact ships readable discovery files and keeps real missing-page HTML', async () => {
  for (const file of ['robots.txt', 'sitemap.xml', 'llms.txt']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const built = await readFile(new URL(`../dist/${file}`, import.meta.url), 'utf8');
    assert.equal(built, source, file);
    assert.doesNotMatch(built, /https:\/\/fxaeon\.(?:com|xyz)\/(?:api|admin|operator|invite|wallet-approval)(?:[/?#<\s)]|$)/);
  }
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  assert.match(html, /href="https:\/\/fxaeon\.com\/docs"/);
  assert.match(html, /href="https:\/\/fxaeon\.com\/privacy"/);
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(jsonLd);
  assert.deepEqual(JSON.parse(jsonLd)['@graph'].map(node => node['@type']), ['Organization', 'WebSite']);
  assert.doesNotMatch(html, /name="robots" content="noindex/);
  const missing = await readFile(new URL('../dist/404.html', import.meta.url), 'utf8');
  assert.match(missing, /name="robots" content="noindex/);
});
