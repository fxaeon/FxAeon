import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tags = [...html.matchAll(/<meta\s[^>]+>/gi)].map(match => Object.fromEntries([...match[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(value => [value[1], value[2]])));
const meta = key => tags.find(tag => tag.property === key || tag.name === key)?.content;

test('landing shares the complete branded 1200 by 630 card', () => {
  const title = 'FxAeon · Your DeFi, in motion.';
  const description = 'Trade ETH and BTC, earn with fxSAVE, borrow fxUSD, and move assets between Ethereum and Base. On the web and in Telegram.';
  const image = 'https://fxaeon.xyz/assets/social-preview.png';
  const alt = 'FxAeon. Your DeFi, in motion. Trade, earn, borrow, and move with f(x) Protocol.';
  for (const [key, value] of Object.entries({
    description, 'og:type': 'website', 'og:site_name': 'FxAeon', 'og:url': 'https://fxaeon.xyz/',
    'og:title': title, 'og:description': description, 'og:image': image, 'og:image:width': '1200', 'og:image:height': '630', 'og:image:type': 'image/png', 'og:image:alt': alt,
    'twitter:card': 'summary_large_image', 'twitter:site': '@FxAeonxyz', 'twitter:title': title, 'twitter:description': description, 'twitter:image': image, 'twitter:image:alt': alt,
  })) assert.equal(meta(key), value, key);
  assert.ok(html.includes('<title>' + title + '</title>'));
  assert.ok(html.includes('rel="canonical" href="https://fxaeon.xyz/"'));
  assert.ok(!html.includes('fxaeon-banner.png'));
  const robots = readFileSync(new URL('../robots.txt', import.meta.url), 'utf8');
  assert.match(robots, /User-agent: \*\s+Allow: \//);
  assert.doesNotMatch(robots, /Disallow:/);
});
