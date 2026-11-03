import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_ROBOTS, routeMetadata } from '../src/app/routeMetadata.ts';
import { productHref, productNavigation } from '../src/app/docs/productNavigation.ts';
import { sdkHref, sdkNavigation } from '../src/app/docs/sdkNavigation.ts';
import { structuredData } from '../src/app/docs/structuredData.ts';

test('index policy separates public documentation from interactive and capability routes', () => {
  assert.deepEqual(DEFAULT_ROBOTS, { index: false, follow: true });
  for (const route of ['trade', 'earn', 'borrow', 'move']) {
    assert.deepEqual(routeMetadata(route).robots, { index: true, follow: true }, route);
    assert.equal(routeMetadata(route).alternates.canonical, `https://fxaeon.com/${route}`);
  }
  for (const route of ['portfolio', 'send', 'more', 'history', 'positions', 'qr', 'settings', 'login']) {
    assert.deepEqual(routeMetadata(route).robots, DEFAULT_ROBOTS, route);
  }
  for (const route of ['docs', 'docsGuide', 'docsSdk']) {
    assert.deepEqual(routeMetadata(route).robots, { index: true, follow: true }, route);
  }
  assert.equal(routeMetadata('docsGuide').alternates.canonical, 'https://fxaeon.com/docs/guide');
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
