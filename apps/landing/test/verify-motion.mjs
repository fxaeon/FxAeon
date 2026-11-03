import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const require = createRequire(resolve(import.meta.dirname, '../../mini-app/package.json'));
const { chromium, expect } = require('@playwright/test');
const url = process.env.LANDING_URL || 'http://127.0.0.1:4355/';
const captures = resolve(import.meta.dirname, '../review/motion');
await mkdir(captures, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [820, 1180], [1024, 768], [1440, 900]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true,
      reducedMotion: 'no-preference', ...(width === 390 ? { recordVideo: { dir: captures, size: { width, height } } } : {}) });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/market-data', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.goto(url, { waitUntil: 'networkidle' });
    await expect.poll(() => page.locator('.hero-line > span').first().evaluate(node => node.getAnimations().some(animation => animation.playState === 'running'))).toBe(false);
    await expect(page.locator('[data-scene-toggle]')).toHaveCount(0);
    const motionTimings = await page.locator('.journey-scene').evaluate(node => node.getAnimations({ subtree: true }).map(animation => animation.effect.getComputedTiming()));
    assert.ok(motionTimings.length > 0);
    assert.ok(motionTimings.every(timing => timing.iterations === 1 && timing.endTime <= 5000), 'Decorative motion finishes within five seconds without requiring a pause control');
    await expect.poll(() => page.locator('.journey-scene').evaluate(node => node.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')), { timeout: 6000 }).toBe(false);
    await expect(page.locator('.hero-copy')).toBeVisible();
    await expect.poll(() => page.locator('.hero-copy').evaluate(node => node.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')), { timeout: 6000 }).toBe(false);
    const heroGeometry = await page.evaluate(() => {
      // DOM rectangles include the final CSS transforms, including rotation.
      const rectangle = node => {
        const { left, top, right, bottom } = node.getBoundingClientRect();
        return { left, top, right, bottom };
      };
      return {
        copy: rectangle(document.querySelector('.hero-copy')),
        prints: [...document.querySelectorAll('.motion-print')].map(node => ({
          name: node.className, ...rectangle(node),
        })),
      };
    });
    assert.ok(heroGeometry.prints.length > 0, 'Hero decorations are present');
    const inflate = box => ({ left: box.left - 8, top: box.top - 8, right: box.right + 8, bottom: box.bottom + 8 });
    const copy = inflate(heroGeometry.copy);
    for (const print of heroGeometry.prints) {
      const decoration = inflate(print);
      const intersects = decoration.left < copy.right && decoration.right > copy.left
        && decoration.top < copy.bottom && decoration.bottom > copy.top;
      assert.equal(intersects, false, `${width}x${height}: ${print.name} overlaps hero copy with 8px inflated bounds: ${JSON.stringify({ copy: heroGeometry.copy, print })}`);
    }
    await page.screenshot({ path: resolve(captures, `hero-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (width < 760) {
      const opener = page.getByRole('button', { name: 'Open menu' });
      await opener.click();
      await expect(page.locator('dialog')).toBeVisible();
      await page.screenshot({ path: resolve(captures, `menu-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
      await opener.click();
      await page.setViewportSize({ width: 900, height });
      await expect(page.locator('dialog')).not.toBeVisible();
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
      await page.setViewportSize({ width, height });
      const rail = page.locator('.product-grid');
      await rail.scrollIntoViewIfNeeded();
      for (const index of [0, 3, 1, 2, 0]) {
        await page.locator(`[data-product="${index}"]`).click();
        await expect(page.locator(`[data-product="${index}"]`)).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => rail.evaluate((node, index) => {
          const left = node.getBoundingClientRect().left + parseFloat(getComputedStyle(node).paddingLeft);
          return Math.abs(node.querySelectorAll('.product-card')[index].getBoundingClientRect().left - left);
        }, index)).toBeLessThan(2);
      }
      await page.screenshot({ path: resolve(captures, `products-${width}.png`) });
      // Native touch scrolling must still work in both directions over the rail.
      const cdp = await context.newCDPSession(page);
      const box = await rail.boundingBox();
      const y = Math.min(height - 90, box.y + 160);
      const swipe = async (from, to) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] });
        for (let step = 1; step <= 10; step++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from[0] + (to[0] - from[0]) * step / 10, y: from[1] + (to[1] - from[1]) * step / 10 }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      await swipe([width - 40, y], [45, y]);
      await expect.poll(() => rail.evaluate(node => node.scrollLeft)).toBeGreaterThan(40);
      const before = await page.evaluate(() => scrollY);
      await swipe([width / 2, y], [width / 2, Math.max(80, y - 140)]);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 25);
      await cdp.detach();
    }
    // Focus reveals an offscreen section before any observer entrance completes.
    await page.locator('.move-card .product-link').focus();
    assert.equal(await page.locator('.product-grid').evaluate(node => getComputedStyle(node).opacity), '1');
    await page.locator('#tab-borrow').click();
    await page.locator('#tab-trade').click();
    await page.locator('#tab-earn').click();
    await expect(page.locator('#tab-earn')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.outcome-panel:visible')).toHaveCount(1);
    await expect.poll(() => page.locator('.outcome-frame').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
    await page.locator('#tab-borrow').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    await expect(page.locator('[data-reveal="waiting"]')).toHaveCount(0);
    await page.locator('#dollar-amount').fill('2000');
    await expect(page.locator('[data-borrow-output]')).toHaveText(/1,000/);
    await page.screenshot({ path: resolve(captures, `calculator-${width}.png`) });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    });
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect.poll(() => page.evaluate(() => document.getAnimations().some(animation => animation.playState === 'running'))).toBe(false);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: resolve(captures, `full-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    const video = page.video();
    await context.close();
    if (video) await video.saveAs(resolve(captures, 'phone-interactions.webm'));
    console.log(`${width}px: menu, focus, interruption, reduced motion${width < 760 ? ', rail and native touch' : ''} passed`);
  }
  const page = await browser.newPage();
  await page.addInitScript(() => { window.IntersectionObserver = undefined; });
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-reveal="waiting"]')).toHaveCount(0);
  assert.equal(await page.locator('.product-grid').evaluate(node => getComputedStyle(node).opacity), '1');
} finally { await browser.close(); }
