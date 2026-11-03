import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRAND_DESCRIPTION, BRAND_TITLE, DEFAULT_ROBOTS, pageMetadata, routeMetadata, SOCIAL_IMAGE_ALT, SOCIAL_IMAGE_URL } from '../src/app/routeMetadata';
import { structuredData } from '../src/app/docs/structuredData';
import { productHref, productNavigation } from '../src/app/docs/productNavigation';
import { sdkHref, sdkNavigation } from '../src/app/docs/sdkNavigation';

test('share metadata preserves page identity and supplies a complete crawler image', () => {
  const pages = [pageMetadata(BRAND_TITLE, BRAND_DESCRIPTION, '/'), routeMetadata('send'), routeMetadata('docsGuide'), routeMetadata('docsSdk'),
    ...productNavigation.map(page => pageMetadata(page.title, page.description, productHref(page.id))),
    ...sdkNavigation.map(page => pageMetadata(page.title, page.description, sdkHref(page.id)))];
  assert.equal(productNavigation.length, 16);
  assert.equal(sdkNavigation.length, 8);
  for (const page of pages) {
    const title = (page.title as { absolute: string }).absolute;
    const og = page.openGraph as { type: string; siteName: string; url: string; title: string; description: string; images: unknown[] };
    const twitter = page.twitter as { card: string; site: string; title: string; description: string; images: unknown[] };
    const image = { url: SOCIAL_IMAGE_URL, width: 1200, height: 630, type: 'image/png', alt: SOCIAL_IMAGE_ALT };
    assert.equal(og.type, 'website');
    assert.equal(og.siteName, 'FxAeon');
    assert.equal(og.url, page.alternates?.canonical);
    assert.equal(og.title, title);
    assert.equal(twitter.title, title);
    assert.equal(og.description, page.description);
    assert.equal(twitter.description, page.description);
    assert.equal(twitter.card, 'summary_large_image');
    assert.equal(twitter.site, '@FxAeonxyz');
    assert.deepEqual(og.images, [image]);
    assert.deepEqual(twitter.images, [{ url: image.url, alt: image.alt }]);
  }
});

test('topic metadata uses distinct canonical URLs and portfolio keeps its home alias', () => {
  const paths = [...productNavigation.map(page => productHref(page.id)), ...sdkNavigation.map(page => sdkHref(page.id))];
  assert.equal(new Set(paths).size, 24);
  for (const path of paths) assert.equal(pageMetadata('Topic', 'Description', path).alternates?.canonical, 'https://fxaeon.com' + path);
  assert.equal(routeMetadata('portfolio').alternates?.canonical, 'https://fxaeon.com/');
  assert.equal(routeMetadata('send').alternates?.canonical, 'https://fxaeon.com/send');
});

test('public product and documentation routes are indexable while account routes are noindex', () => {
  for (const route of ['trade', 'earn', 'borrow', 'move'] as const) {
    assert.deepEqual(routeMetadata(route).robots, { index: true, follow: true }, route);
    assert.equal(routeMetadata(route).alternates?.canonical, `https://fxaeon.com/${route}`);
  }
  for (const route of ['portfolio', 'send', 'more', 'history', 'positions', 'qr', 'settings', 'login'] as const) {
    assert.deepEqual(routeMetadata(route).robots, { index: false, follow: true }, route);
  }
  for (const route of ['docs', 'docsGuide', 'docsSdk'] as const) {
    assert.deepEqual(routeMetadata(route).robots, { index: true, follow: true }, route);
  }
  assert.deepEqual(DEFAULT_ROBOTS, { index: false, follow: true }, 'invitation and wallet-approval routes inherit the app default');
  assert.deepEqual(structuredData, {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'FxAeon',
    url: 'https://fxaeon.com/',
    publisher: { '@type': 'Organization', name: 'FxAeon', url: 'https://fxaeon.xyz/' },
  });
});

test('mini-app sitemap contains only public docs and policy pages', () => {
  const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
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
  assert.match(robots, /User-agent: \*[\s\S]*?Allow: \//);
  assert.doesNotMatch(robots, /Disallow: \/(?:login|invite|wallet-approval)/);
  assert.match(robots, /Sitemap: https:\/\/fxaeon\.com\/sitemap\.xml/);
});
