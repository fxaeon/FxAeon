import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_DESCRIPTION, BRAND_TITLE, pageMetadata, routeMetadata, SOCIAL_IMAGE_ALT, SOCIAL_IMAGE_URL } from '../src/app/routeMetadata';
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
