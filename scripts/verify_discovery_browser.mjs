import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { telegramLauncher } from '../apps/landing/config.mjs';

const require = createRequire(new URL('../apps/mini-app/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const origin = new URL(process.env.DISCOVERY_LANDING_URL || 'http://127.0.0.1:4197/');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Use a local landing preview');
const browser = await chromium.launch({ headless: true });
try {
  const bodies = new Map();
  for (const [path, type] of [['/', 'text/html'], ['/robots.txt', 'text/plain'], ['/sitemap.xml', 'application/xml'], ['/llms.txt', 'text/plain'], ['/assets/social-preview.png', 'image/png'], ['/assets/fxaeon-mark.svg', 'image/svg+xml']]) {
    const response = await fetch(new URL(path, origin));
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type')?.startsWith(type), path);
    assert.ok(!response.headers.get('x-robots-tag')?.includes('noindex'), path);
    if (!path.startsWith('/assets/')) bodies.set(path, await response.text());
  }
  const missing = await fetch(new URL('/missing-discovery-test', origin));
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /name="robots" content="noindex/);

  for (const width of [320, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, javaScriptEnabled: false });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort());
    await page.goto(origin.href, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), 'https://fxaeon.xyz/');
    assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), 'https://fxaeon.xyz/');
    assert.equal(await page.locator('a[href="https://fxaeon.com/docs"]').count() > 0, true);
    const telegramLinks = await page.locator('a[href^="https://t.me/"]').evaluateAll(nodes => nodes.map(node => node.href));
    assert.ok(telegramLinks.length > 0);
    for (const href of telegramLinks) assert.equal(telegramLauncher(href), href);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px overflow`);
    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    assert.deepEqual(JSON.parse(jsonLd)['@graph'].map(node => node['@type']), ['Organization', 'WebSite']);
    for (const [, href] of bodies.get('/').matchAll(/href="#([^"]+)"/g)) {
      assert.equal(await page.locator(`[id="${href}"]`).count(), 1, `broken fragment #${href}`);
    }
    const sitemapUrls = await page.evaluate(xml => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('Invalid sitemap XML');
      return [...doc.querySelectorAll('loc')].map(node => node.textContent);
    }, bodies.get('/sitemap.xml'));
    assert.deepEqual(sitemapUrls, ['https://fxaeon.xyz/']);
    const image = await page.evaluate(async () => {
      const img = new Image();
      img.src = '/assets/social-preview.png';
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    });
    assert.deepEqual(image, [1200, 630]);
    await page.close();
    console.log(`Discovery browser: ${width}px, JavaScript disabled, canonical/share/schema/links/XML/image passed.`);
  }
  console.log('Local HTTP: public HTML, robots, sitemap, llms.txt, favicon and social image return 200 with correct MIME types; missing page returns 404/noindex.');
} finally {
  await browser.close();
}
