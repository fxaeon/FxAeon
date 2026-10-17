import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { configuredBrowserChannel } from './e2e_browser_channel.cjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, 'apps/mini-app/package.json'));
const { chromium, expect } = require('@playwright/test');
const browserChannel = configuredBrowserChannel();
const port = process.env.LANDING_TEST_PORT || '4319';
const origin = `http://127.0.0.1:${port}`;
const TELEGRAM = 'https://t.me/FxAeonBot';
const WEB = 'https://fxaeon.com/';
const routes = ['trade', 'earn', 'borrow', 'move'];
const captures = resolve(root, 'artifacts/landing-review');

function marketFixture(mode = 'ready') {
  const now = Date.now() - (mode === 'stale' ? 360_000 : mode === 'expiring' ? 299_000 : 0);
  const metric = (value, source, sourceUrl, price = false) => ({ value, status: 'fresh', fetchedAt: now, source, sourceUrl, ...(price ? { sourceAt: now - (mode === 'expiring' ? 0 : 15_000) } : {}) });
  const result = { status: 'ready',
    fxSaveTvlUsd: metric(12_345_678, 'aladdin', 'https://fx.aladdin.club/earn'),
    fxSaveApy: metric(6.5, 'aladdin', 'https://fx.aladdin.club/earn'),
    ethUsd: metric(2_500, 'defillama', 'https://defillama.com/prices', true),
    btcUsd: metric(80_000, 'defillama', 'https://defillama.com/prices', true),
  };
  if (mode === 'partial') for (const key of ['fxSaveTvlUsd', 'fxSaveApy']) result[key] = { ...result[key], value: null, status: 'unavailable' };
  return result;
}

const server = spawn(process.execPath, ['apps/landing/serve.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let browser;

function parseRgb(value) {
  const wideGamut = value.match(/color\(srgb ([^)]+)\)/);
  if (wideGamut) {
    const channels = wideGamut[1].split(/[ /]+/).filter(Boolean).map(Number);
    if (channels.length >= 3 && (channels[3] ?? 1) >= 0.99) return channels.slice(0, 3).map((channel) => channel * 255);
    return null;
  }
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const channels = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  if (channels.length < 3 || (channels[3] ?? 1) < 0.99) return null;
  return channels.slice(0, 3);
}

function luminance([red, green, blue]) {
  const linear = (channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

async function assertTextContrast(page, selector, label) {
  const samples = await page.locator(selector).evaluateAll((elements) => elements.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden') return [];
    const foreground = getComputedStyle(element).color;
    const label = `${element.tagName.toLowerCase()}.${typeof element.className === 'string' ? element.className : ''} ${element.textContent.trim().slice(0, 40)}`;
    for (let background = element; background; background = background.parentElement) {
      const color = getComputedStyle(background).backgroundColor;
      if (!/rgba?\([^)]*[, /] *0(?:\.0+)?\s*\)/.test(color)) return [{ foreground, background: color, label }];
      if (background === document.body) break;
    }
    return [];
  }));
  assert.ok(samples.length > 0, `Expected visible ${label} text for contrast check`);
  for (const { foreground, background, label } of samples) {
    const text = parseRgb(foreground);
    const surface = parseRgb(background);
    assert.ok(text && surface, `Could not resolve ${label} colors: ${foreground} on ${background}`);
    const [high, low] = [luminance(text), luminance(surface)].sort((a, b) => b - a);
    assert.ok((high + 0.05) / (low + 0.05) >= 4.5, `${label} contrast is below 4.5:1 for ${label}: ${foreground} on ${background}`);
  }
}

async function visibleRoutes(page, selector) {
  return page.locator(selector).evaluateAll((elements) => elements.filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }).map((element) => element.getAttribute('href')));
}

async function checkNoOverflow(page, width) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    overflowing: [...document.body.querySelectorAll('*')].map((element) => ({
      name: `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.trim().replace(/\s+/g, '.')}` : ''}`,
      left: Math.round(element.getBoundingClientRect().left),
      right: Math.round(element.getBoundingClientRect().right),
      width: Math.round(element.getBoundingClientRect().width),
    })).filter((element) => element.right > document.documentElement.clientWidth || element.left < 0).slice(0, 12),
  }));
  assert.ok(dimensions.document <= dimensions.viewport && dimensions.body <= dimensions.viewport,
    `Horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`);
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Landing server exited with ${server.exitCode}`);
    try {
      const response = await fetch(origin);
      if (response.ok) { ready = true; break; }
    } catch { /* The child has not bound its port yet. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.ok(ready, `Landing server did not become ready at ${origin}`);
  assert.equal((await fetch(`${origin}/api/market-data?source=untrusted`)).status, 400, 'Local preview invokes the same closed-source API handler');
  assert.equal((await fetch(`${origin}/api/market-data`, { method: 'POST' })).status, 405);

  browser = await chromium.launch({ headless: true, ...(browserChannel ? { channel: browserChannel } : {}) });
  const errors = [];
  const externalRequests = [];
  const failedResponses = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  let feedMode = 'ready';
  await context.route('**/api/market-data', route => feedMode === 'offline'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    : route.fulfill({ json: marketFixture(feedMode) }));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin) externalRequests.push(url.href);
  });
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/api/market-data')) failedResponses.push(response.url()); });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('.outcome-panel').count(), 3);
  assert.equal(await page.locator('.site-header a[href="https://fxaeon.com/"]').count(), 0, 'The header does not repeat the hero launch action');
  await expect(page.locator('.hero .lede + .hero-credit')).toHaveText('Powered By f(x) SDK');
  assert.equal(await page.locator('.hero').getByText('Built on f(x) Protocol', { exact: true }).count(), 0);
  const productCards = page.locator('#products .product-card');
  assert.equal(await productCards.count(), 4);
  assert.equal(await page.locator('#products details').count(), 0, 'Products retain the compact artwork cards from the live site');
  for (const route of routes) {
    const card = page.locator(`#products .${route}-card`);
    const link = card.locator(`a[href="https://fxaeon.com/${route}"]`);
    await expect(link).toBeVisible();
    await link.focus();
    await expect(link).toBeFocused();
    assert.equal(await card.locator('.product-link').count(), 1, 'Each card has one full-card launch target');
  }
  await expect(page.locator('[data-market-value="fxSaveApy"]')).toHaveText('6.5%');
  await expect(page.locator('[data-market-value="fxSaveTvlUsd"]')).toHaveText('$12.35M');
  for (const route of ['earn', 'borrow', 'trade']) {
    await page.getByRole('tab', { name: route, exact: false }).click();
    const panel = page.locator(`#outcome-${route}`);
    await expect(panel).toBeVisible();
    await assertTextContrast(page, `#outcome-${route} h3, #outcome-${route} p`, `${route} text`);
    assert.deepEqual(await visibleRoutes(panel, 'a[href]'), [
      `https://fxaeon.com/${route}${route === 'trade' ? '?market=ETH' : ''}`,
    ], `${route} opens the real web app on a phone`);
  }
  assert.ok(await page.locator('a[href="https://fxaeon.com/move"]').count());
  await assertTextContrast(page, 'main h1, summary, footer .footer-invite h2', 'dark theme');
  await checkNoOverflow(page, 390);

  const amount = page.getByRole('textbox', { name: 'Amount in US dollars' });
  await page.getByRole('tab', { name: 'Earn', exact: true }).click();
  await expect(page.locator('[data-earn-projection]')).toHaveText('$1,065.00');
  await expect(page.locator('[data-earn-gain]')).toHaveText('+$65.00');
  await expect(amount).toHaveAttribute('aria-describedby', 'amount-context');
  await page.getByRole('button', { name: '$10,000', exact: true }).click();
  await expect(page.locator('[data-earn-projection]')).toHaveText('$10,650.00');
  await page.getByRole('tab', { name: 'Earn', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Borrow', exact: true })).toBeFocused();
  await expect(page.locator('[data-borrow-output]')).toHaveText('$5,000.00');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Trade', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '$1,000', exact: true }).click();
  await expect(page.locator('[data-trade-exposure]')).toHaveText('$2,000.00');
  await expect(page.locator('[data-trade-up]')).toHaveText('+$200.00');
  await expect(page.locator('[data-trade-down]')).toHaveText('−$200.00');
  await page.getByRole('slider', { name: 'Leverage' }).fill('5');
  await expect(page.locator('[data-trade-exposure]')).toHaveText('$5,000.00');
  await expect(page.locator('[data-trade-down]')).toHaveText('−$500.00');
  for (const invalid of ['', '0', '-1', '1e6', '1000001', '12.345', '12,34']) {
    await amount.fill(invalid);
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#amount-error')).toBeVisible();
    await expect(page.locator('[data-trade-exposure]')).toHaveText('—');
  }
  await amount.fill('1000.50');
  await expect(amount).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('[data-trade-exposure]')).toHaveText('$5,002.50');
  await page.getByRole('button', { name: '$1,000', exact: true }).click();

  const refresh = page.locator('[data-market-refresh]');
  await expect(refresh).toBeHidden();
  for (const mode of ['partial', 'stale', 'offline', 'ready']) {
    feedMode = mode;
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-market-value="fxSaveApy"]')).toHaveText(mode === 'ready' ? '6.5%' : '—');
    await expect(page.locator('[data-earn-projection]')).toHaveText(mode === 'ready' ? '$1,065.00' : '—');
    if (mode === 'partial') await expect(page.locator('[data-market-value="ethUsd"]')).toHaveText('$2,500.00');
    if (mode === 'ready') await expect(refresh).toBeHidden();
    else await expect(refresh).toBeEnabled();
  }
  await page.clock.install({ time: new Date() });
  feedMode = 'expiring';
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-market-value="fxSaveApy"]')).toHaveText('6.5%');
  await page.clock.fastForward(2_000);
  await expect(page.locator('[data-market-value="fxSaveApy"]')).toHaveText('—');
  await expect(page.locator('[data-earn-projection]')).toHaveText('—');
  await expect(page.locator('[data-trade-units]')).toContainText('unavailable');
  feedMode = 'ready';
  await refresh.click();
  await expect(page.locator('[data-market-value="fxSaveApy"]')).toHaveText('6.5%');
  await expect(refresh).toBeHidden();
  await expect(page.locator('[data-market-value="fxSaveApy"]')).toHaveAttribute('title', /Aladdin.*Checked.*UTC/);
  await amount.focus();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fxaeon:market-data', { detail: window.__fxaeonMarketData })));
  await expect(amount).toBeFocused();

  // The native dialog contains focus and closes on Escape, restoring the opener.
  const opener = page.locator('.site-header button[aria-haspopup="dialog"]');
  assert.ok(await opener.getAttribute('aria-label'));
  await opener.click();
  const dialog = page.locator('dialog[open]');
  assert.equal(await dialog.count(), 1);
  assert.ok(await dialog.getAttribute('aria-label'));
  await assertTextContrast(page, 'dialog a', 'dark menu');
  assert.equal(await dialog.evaluate((element) => element.open), true);
  assert.equal(await opener.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
  // Confirm forward and reverse keyboard navigation reaches dialog controls.
  // After the final control Chromium may expose body as activeElement while
  // the modal remains open, so do not assume every browser keeps a descendant
  // as document.activeElement at the tab-order boundary.
  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true, 'Tab reaches menu controls');
  }
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true, 'Shift+Tab returns through menu controls');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.site-menu').open);
  await page.waitForFunction(() => document.querySelector('.menu-toggle').getAttribute('aria-expanded') === 'false');
  assert.equal(await opener.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.menu-toggle')), true);
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
  await opener.click();
  const sectionLink = dialog.locator('a[href^="#"]').first();
  const destination = await sectionLink.getAttribute('href');
  assert.ok(destination);
  await sectionLink.click();
  await page.waitForFunction((hash) => !document.querySelector('dialog').open && location.hash === hash, destination);
  await checkNoOverflow(page, 390);

  // Old light-theme preferences are cleared and the landing stays dark-only.
  assert.equal(await page.locator('.theme-toggle').count(), 0);
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#101214');
  await page.evaluate(() => localStorage.setItem('fxaeon-theme', 'light'));
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'The landing remains dark-only after reload');
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#101214');
  assert.equal(await page.evaluate(() => localStorage.getItem('fxaeon-theme')), null, 'Legacy theme preference is removed');

  // Device routing depends on CSS capability, and narrow screens remain usable.
  for (const width of [320, 360, 390, 430, 760, 860, 861, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await checkNoOverflow(page, width);
    assert.deepEqual(await visibleRoutes(page, '.hero .actions a'), [WEB, TELEGRAM], `Web app and Mini App remain visible at ${width}px`);
    assert.equal(await page.locator('.site-header button[aria-haspopup="dialog"]').isVisible(), width <= 760, `Menu breakpoint at ${width}px`);
    const visibleNavigationCount = await page.locator('.site-header .nav-side').evaluateAll((elements) => elements.filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getBoundingClientRect().width > 0;
    }).length);
    assert.equal(visibleNavigationCount > 0, width > 760, `Desktop navigation breakpoint at ${width}px`);
    await amount.fill('1000000');
    await expect(amount).toHaveAttribute('aria-invalid', 'false');
    await page.getByRole('tab', { name: 'Trade', exact: true }).click();
    await page.getByRole('slider', { name: 'Leverage' }).fill('5');
    await expect(page.locator('[data-trade-exposure]')).toHaveText('$5,000,000.00');
    await checkNoOverflow(page, width);
    await amount.fill('1000');
    assert.deepEqual((await visibleRoutes(page, '#products .product-link')).sort(), routes.map(route => `https://fxaeon.com/${route}`).sort(), `All four product links remain reachable at ${width}px`);
    const smallTargets = await page.locator('button:visible, .actions a:visible, .outcome-cta:visible, summary').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height < 44).map(node => node.textContent));
    assert.deepEqual(smallTargets, [], `Touch targets remain44px at ${width}px`);
  }

  const reduced = await page.evaluate(() => ({
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
    transition: getComputedStyle(document.querySelector('.button')).transitionDuration,
    animations: document.getAnimations().length,
  }));
  assert.equal(reduced.scroll, 'auto');
  assert.equal(reduced.transition, '0s');
  assert.equal(reduced.animations, 0, 'Reduced motion starts no CSS animations');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'on');
  assert.equal(await page.locator('.hero').evaluate((element) => element.getAnimations({ subtree: true }).length), 0, 'Hero stays still while later sections animate');
  assert.equal(await page.locator('.motion-toggle').count(), 0, 'The footer has no animation control');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'off');
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'off');
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'The system preference stops decorative motion');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'off', 'Reduced motion is respected after reload');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'on');
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'on');

  // Reduced motion must not touch WebGL, and changing the system preference
  // must work without a page-specific settings control.
  const motionContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await motionContext.route('**/api/market-data', route => route.fulfill({ json: marketFixture() }));
  await motionContext.addInitScript(() => {
    window.__landingProbe = { webglAttempts: 0, webglAvailable: false, pendingFrames: new Set() };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (kind === 'webgl2') window.__landingProbe.webglAttempts += 1;
      const result = getContext.call(this, kind, ...args);
      if (kind === 'webgl2') window.__landingProbe.webglAvailable = Boolean(result);
      return result;
    };
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      let id;
      id = request((time) => {
        window.__landingProbe.pendingFrames.delete(id);
        callback(time);
      });
      window.__landingProbe.pendingFrames.add(id);
      return id;
    };
    const cancel = window.cancelAnimationFrame.bind(window);
    window.cancelAnimationFrame = (id) => {
      window.__landingProbe.pendingFrames.delete(id);
      cancel(id);
    };
  });
  const motionPage = await motionContext.newPage();
  await motionPage.goto(origin, { waitUntil: 'networkidle' });
  assert.equal(await motionPage.locator('html').getAttribute('data-motion'), 'off');
  assert.equal(await motionPage.evaluate(() => window.__landingProbe.webglAttempts), 0, 'Reduced motion avoids WebGL initialization');
  await motionPage.emulateMedia({ reducedMotion: 'no-preference' });
  await motionPage.waitForFunction(() => document.documentElement.dataset.motion === 'on');
  assert.equal(await motionPage.locator('html').getAttribute('data-motion'), 'on');
  await motionPage.waitForFunction(() => window.__landingProbe.webglAttempts === 1);
  await motionPage.locator('.hero').scrollIntoViewIfNeeded();
  if (await motionPage.evaluate(() => window.__landingProbe.webglAvailable)) {
    await motionPage.waitForFunction(() => window.__landingProbe.pendingFrames.size > 0);
  }
  await motionPage.emulateMedia({ reducedMotion: 'reduce' });
  await motionPage.waitForFunction(() => document.documentElement.dataset.motion === 'off');
  await motionPage.waitForTimeout(80);
  assert.equal(await motionPage.evaluate(() => window.__landingProbe.pendingFrames.size), 0, 'System reduced-motion preference stops hero frames');
  await motionPage.emulateMedia({ reducedMotion: 'no-preference' });
  await motionPage.waitForFunction(() => document.documentElement.dataset.motion === 'on');
  await motionPage.waitForTimeout(80);
  await motionPage.emulateMedia({ reducedMotion: 'reduce' });
  await motionPage.waitForTimeout(80);
  assert.equal(await motionPage.evaluate(() => window.__landingProbe.pendingFrames.size), 0, 'Reducing motion cancels any scheduled hero frame');
  await motionContext.close();

  // Simulate a browser without WebGL2; the static contour artwork remains
  // visible and the shader failure does not produce runtime errors.
  const fallbackContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
  await fallbackContext.route('**/api/market-data', route => route.fulfill({ json: marketFixture() }));
  await fallbackContext.addInitScript(() => {
    window.__landingProbe = { webglAttempts: 0 };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (kind === 'webgl2') {
        window.__landingProbe.webglAttempts += 1;
        return null;
      }
      return getContext.call(this, kind, ...args);
    };
  });
  const fallbackPage = await fallbackContext.newPage();
  const fallbackErrors = [];
  fallbackPage.on('pageerror', (error) => fallbackErrors.push(error.message));
  await fallbackPage.goto(origin, { waitUntil: 'networkidle' });
  assert.equal(await fallbackPage.evaluate(() => window.__landingProbe.webglAttempts), 1);
  assert.equal(await fallbackPage.locator('.hero-contours').evaluate((element) => getComputedStyle(element).display !== 'none' && getComputedStyle(element).opacity !== '0'), true, 'Static contour fallback remains visible without WebGL2');
  assert.deepEqual(fallbackErrors, [], 'Missing WebGL2 does not throw');
  await fallbackContext.close();

  assert.deepEqual(errors, [], 'Landing threw browser errors');
  assert.deepEqual(failedResponses, [], 'No missing page assets');
  assert.deepEqual(externalRequests, [], 'Landing requested no external services');

  await mkdir(captures, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.telegram-qr').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await page.locator('.hero').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(captures, `landing-${width}px.png`), fullPage: true });
    for (const section of ['hero', 'products', 'faq', 'footer-frame']) {
      await page.locator(`.${section}`).screenshot({ path: resolve(captures, `${section}-${width}px.png`) });
    }
    await page.getByRole('tab', { name: 'Trade', exact: true }).click();
    await page.locator('#outcomes').screenshot({ path: resolve(captures, `calculator-trade-${width}px.png`) });
  }
  await writeFile(resolve(captures, 'fixture-note.txt'), 'Screenshots use deterministic test data: TVL$12,345,678, APY6.5%, ETH$2,500, BTC$80,000. These are test fixtures, not current market claims.\n');

console.log('Landing browser checks passed: USD scenarios, validation, feed failure/recovery, keyboard tabs/menu, web routes on every device,44px targets, dark theme, contrast, reduced motion, responsive overflow and local-only browser requests.');
} finally {
  await browser?.close();
  server.kill();
}
