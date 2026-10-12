import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { configuredBrowserChannel } from './e2e_browser_channel.cjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, 'apps/mini-app/package.json'));
let chromium;
try {
  ({ chromium } = require('@playwright/test'));
} catch (testPackageError) {
  try { ({ chromium } = require('playwright')); }
  catch { throw testPackageError; }
}
const browserChannel = configuredBrowserChannel();
const port = process.env.LANDING_TEST_PORT || '4319';
const origin = `http://127.0.0.1:${port}`;
const TELEGRAM = 'https://t.me/FxAeonBot';
const WEB = 'https://fxaeon.com/';
const routes = ['trade', 'earn', 'borrow', 'move'];

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

  browser = await chromium.launch({ headless: true, ...(browserChannel ? { channel: browserChannel } : {}) });
  const errors = [];
  const externalRequests = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin) externalRequests.push(url.href);
  });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('.product-card').count(), 4);
  await assertTextContrast(page, '.product-card h3', 'product headings');
  for (const [index, route] of routes.entries()) {
    const card = page.locator('.product-card').nth(index);
    assert.ok(await card.locator('h3').count(), `${route} has a product heading`);
    assert.ok(await card.locator('p').count(), `${route} has a product description`);
    assert.deepEqual(await visibleRoutes(card, 'a[href]'), [
      `https://t.me/FxAeonBot?startapp=${route}`,
    ], `${route} opens the matching Telegram screen on a phone`);
  }
  await assertTextContrast(page, 'main h1, .product-card p, summary, footer .theme-toggle', 'dark theme');
  await checkNoOverflow(page, 390);

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

  // Theme choice is accessible, changes the browser chrome, and survives reload.
  const theme = page.locator('footer .theme-toggle');
  assert.ok(await theme.getAttribute('aria-label'));
  await theme.click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#ffffff');
  assert.ok(await theme.getAttribute('aria-label'));
  await assertTextContrast(page, 'main h1, .product-card p, summary, footer .theme-toggle', 'light theme');
  await checkNoOverflow(page, 390);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'Theme persists across reload');
  await page.locator('footer .theme-toggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');

  // Device routing depends on CSS capability, and narrow screens remain usable.
  for (const width of [320, 360, 390, 430, 760, 860, 861, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await checkNoOverflow(page, width);
    const desktop = width >= 861;
    assert.deepEqual(await visibleRoutes(page, '.hero .actions a'), [TELEGRAM, WEB], `Both explicit app choices remain visible at ${width}px`);
    assert.equal(await page.locator('.site-header button[aria-haspopup="dialog"]').isVisible(), width <= 760, `Menu breakpoint at ${width}px`);
    const visibleNavigationCount = await page.locator('.site-header .nav-side').evaluateAll((elements) => elements.filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getBoundingClientRect().width > 0;
    }).length);
    assert.equal(visibleNavigationCount > 0, width > 760, `Desktop navigation breakpoint at ${width}px`);
  }

  const reduced = await page.evaluate(() => ({
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
    transition: getComputedStyle(document.querySelector('.product-card')).transitionDuration,
    animations: document.getAnimations().length,
  }));
  assert.equal(reduced.scroll, 'auto');
  assert.equal(reduced.transition, '0s');
  assert.equal(reduced.animations, 0, 'Reduced motion starts no CSS animations');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'on');
  assert.equal(await page.locator('.chart-line').evaluate((element) => getComputedStyle(element).animationName), 'chart-draw');
  await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'off');
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'Pause stops all decorative motion');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'off', 'Motion preference persists');
  await page.getByRole('button', { name: 'Resume animations', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'on');
  assert.deepEqual(errors, [], 'Landing threw browser errors');
  assert.deepEqual(externalRequests, [], 'Landing requested no external services');

  console.log('Landing browser checks passed: product coverage and links, keyboard menu behavior, theme and motion preferences, text contrast in both themes, reduced motion, responsive device routing, no horizontal overflow, and no external requests.');
} finally {
  await browser?.close();
  server.kill();
}
