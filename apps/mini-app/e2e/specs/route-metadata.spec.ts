import { expect, test } from '../fixtures/test';
import { productNavigation, productHref } from '../../src/app/docs/productNavigation';
import { sdkNavigation, sdkHref } from '../../src/app/docs/sdkNavigation';

const BRAND_TITLE = 'FxAeon · Your DeFi, in motion.';
const IMAGE_ALT = 'FxAeon. Your DeFi, in motion. Trade, earn, borrow, and move with f(x) Protocol.';
const IMAGE_URL = 'https://fxaeon.com/social-preview.png';
const ROUTE_METADATA = [
  ['/', BRAND_TITLE, 'Ethereum and Base', '/'],
  ['/trade', 'Trade · FxAeon', 'Trade', '/trade'],
  ['/earn', 'Earn · FxAeon', 'fxSAVE', '/earn'],
  ['/borrow', 'Borrow fxUSD · FxAeon', 'fxUSD', '/borrow'],
  ['/move', 'Move · FxAeon', 'Ethereum and Base', '/move'],
  ['/send', 'Send · FxAeon', 'wallet', '/send'],
  ['/portfolio', 'Portfolio · FxAeon', 'wallet', '/'],
  ['/docs', 'Docs · FxAeon', 'product guides', '/docs'],
  ['/docs/guide', 'Product guide · FxAeon', 'transaction reviews', '/docs/guide'],
  ['/docs/sdk', 'f(x) SDK reference · FxAeon', '15-method', '/docs/sdk'],
  ['/settings', 'Wallet & account · FxAeon', 'wallet', '/settings'],
  ['/positions', 'Positions · FxAeon', 'positions', '/positions'],
  ['/history', 'History · FxAeon', 'transactions', '/history'],
  ['/activity', 'History · FxAeon', 'transactions', '/history'],
  ['/qr', 'Receive · FxAeon', 'wallet', '/qr'],
  ['/more', 'More · FxAeon', 'wallet', '/more'],
  ...productNavigation.map(article => [productHref(article.id), article.title + ' · FxAeon', article.description, productHref(article.id)]),
  ...sdkNavigation.map(article => [sdkHref(article.id), article.title + ' · FxAeon', article.description, sdkHref(article.id)]),
] as const;

function decodeHtmlText(text: string): string {
  return text.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&#39;', "'");
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g)].map(match => [match[1], decodeHtmlText(match[2] ?? match[3])]));
}

function metaContent(html: string, attribute: 'name' | 'property', value: string): string {
  const tags = [...html.matchAll(/<meta\s[^>]+>/gi)].map(match => attributes(match[0]));
  return tags.find(tag => tag[attribute] === value)?.content ?? '';
}

test.describe('server-rendered route metadata', () => {
  for (const [route, title, descriptionKeyword, canonicalPath] of ROUTE_METADATA) {
    test(route + ' exposes complete route-specific share metadata before hydration', async ({ request }) => {
      const response = await request.get(route);
      expect(response.ok()).toBeTruthy();
      const html = await response.text();
      const documentTitle = decodeHtmlText(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? '');
      const description = metaContent(html, 'name', 'description');
      const links = [...html.matchAll(/<link\s[^>]+>/gi)].map(match => attributes(match[0]));
      const canonical = new URL(canonicalPath, 'https://fxaeon.com').href;

      expect(documentTitle).toBe(title);
      expect(description).toContain(descriptionKeyword);
      const canonicalHref = links.find(link => link.rel === 'canonical')?.href;
      expect(canonicalHref).toBeTruthy();
      // Next omits the origin's trailing slash. Both strings identify the
      // same URL; preserve exact path checks after standards-based parsing.
      expect(new URL(canonicalHref!).href).toBe(canonical);
      expect(links.find(link => link.rel === 'icon')?.href).toBe('/icon.svg');
      for (const [property, value] of Object.entries({
        'og:type': 'website', 'og:site_name': 'FxAeon', 'og:url': canonicalHref!,
        'og:title': title, 'og:description': description, 'og:image': IMAGE_URL,
        'og:image:width': '1200', 'og:image:height': '630', 'og:image:type': 'image/png', 'og:image:alt': IMAGE_ALT,
      })) expect(metaContent(html, 'property', property), property).toBe(value);
      for (const [name, value] of Object.entries({
        'twitter:card': 'summary_large_image', 'twitter:site': '@FxAeonxyz',
        'twitter:title': title, 'twitter:description': description, 'twitter:image': IMAGE_URL, 'twitter:image:alt': IMAGE_ALT,
      })) expect(metaContent(html, 'name', name), name).toBe(value);
      expect(html).not.toContain('fxaeon-banner.png');
    });
  }

  test('serves the share image to crawlers as a 1200 by 630 PNG', async ({ request }) => {
    const response = await request.get('/social-preview.png');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('image/png');
    const png = await response.body();
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toMatch(/User-agent: \*\s+Allow: \//);
    expect(robots).not.toMatch(/Disallow: \/(?:social-preview|docs)/);
  });
});
