import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { configuredBrowserChannel } from './e2e_browser_channel.cjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, 'apps/mini-app/package.json'));
const { chromium } = require('@playwright/test');
const port = process.env.LANDING_CAPTURE_PORT || '4348';
const origin = `http://127.0.0.1:${port}`;
const output = resolve(process.env.LANDING_CAPTURE_DIR || resolve(root, 'artifacts/landing-review'));
const captureWidths = process.env.LANDING_CAPTURE_WIDTHS
  ? process.env.LANDING_CAPTURE_WIDTHS.split(',').map(Number)
  : [390, 1280, 1440];
const server = spawn(process.execPath, ['apps/landing/serve.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let browser;

try {
  await mkdir(output, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Landing server exited with ${server.exitCode}`);
    try {
      const response = await fetch(origin);
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for the local static server to bind. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!ready) throw new Error(`Landing server did not become ready at ${origin}`);

  browser = await chromium.launch({ headless: true, ...(configuredBrowserChannel() ? { channel: configuredBrowserChannel() } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', (error) => { throw error; });
  for (const width of captureWidths) {
    const height = width === 390 ? 844 : width === 1280 ? 900 : 1000;
    await page.setViewportSize({ width, height });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
      const images = [...document.images];
      for (const image of images) image.loading = 'eager';
      await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    });
    await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
    if (!(await page.locator('.telegram-qr img').evaluate((image) => image.naturalWidth > 0))) {
      throw new Error('The generated Telegram QR image did not load before capture.');
    }
    if (width === 390) {
      const geometry = await page.locator('.earn-card').evaluate((card) => {
        const cardRect = card.getBoundingClientRect();
        const box = (selector) => {
          const element = card.querySelector(selector);
          const rect = element.getBoundingClientRect();
          return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) };
        };
        return {
          card: { top: Math.round(cardRect.top), bottom: Math.round(cardRect.bottom), height: Math.round(cardRect.height) },
          art: box('.earn-art'),
          token: box('.vault-token'),
          layerFront: box('.layer-front'),
        };
      });
      if (geometry.token.top < geometry.art.top || geometry.token.bottom > geometry.art.bottom) {
        throw new Error(`Earn vault token is clipped by its art frame: ${JSON.stringify(geometry)}`);
      }
      process.stdout.write(`Earn mobile geometry: ${JSON.stringify(geometry)}\n`);
    }
    await page.waitForTimeout(1200);
    const file = resolve(output, `landing-${width}px.png`);
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    process.stdout.write(`${file}\n`);
  }
  await context.close();
} finally {
  await browser?.close();
  server.kill();
}
