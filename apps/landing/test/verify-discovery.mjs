import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../../mini-app/package.json'));
const { chromium } = require('@playwright/test');
const url = process.env.LANDING_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1440, 900]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/market-data', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.goto(url, { waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px overflow`);
    assert.equal(await page.locator('.hero input, .hero form').count(), 0);
    for (const route of ['trade', 'earn', 'borrow', 'move']) {
      const tile = page.locator(`.${route}-card`), link = tile.locator('.product-link');
      await link.focus();
      assert.equal(await link.evaluate(node => node === document.activeElement), true);
      assert.equal(await link.getAttribute('href'), `https://fxaeon.com/${route}`);
      assert.equal(await tile.evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
      const box = await link.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
      for (const img of await tile.locator('img').all()) assert.ok(await img.evaluate(node => node.complete && node.naturalWidth > 0));
    }
    assert.equal(await page.locator('.hero-copy').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.locator('#dollar-amount').fill('2000');
    await page.locator('#tab-borrow').click();
    assert.match(await page.locator('[data-borrow-output]').innerText(), /1,000/);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${width}px passed`);
  }
  const staticPage = await browser.newPage({ viewport: { width: 320, height: 568 }, javaScriptEnabled: false });
  await staticPage.goto(url, { waitUntil: 'domcontentloaded' });
  assert.equal(await staticPage.locator('.calculator-controls').isVisible(), false);
  assert.equal(await staticPage.locator('.menu-toggle').isVisible(), false);
  assert.equal(await staticPage.locator('.trade-card .product-link').getAttribute('href'), 'https://fxaeon.com/trade');
  await staticPage.close();
} finally {
  await browser.close();
}
