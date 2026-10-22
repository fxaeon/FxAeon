import { createRequire } from 'node:module';
import { copyFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configuredBrowserChannel } from './e2e_browser_channel.cjs';

// Development-only. Both public sites serve the same checked-in PNG without
// needing a browser, font service, or dynamic image endpoint at request time.
const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, 'apps/mini-app/package.json'));
const { chromium } = require('@playwright/test');
const channel = configuredBrowserChannel();
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(root, 'apps/landing/design/social-preview.html')).href);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, image => image.decode()));
  });
  const output = resolve(root, 'apps/landing/assets/social-preview.png');
  await page.screenshot({ path: output });
  const png = await readFile(output);
  if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) throw new Error('Unexpected social-preview dimensions');
  await copyFile(output, resolve(root, 'apps/mini-app/public/social-preview.png'));
  console.log(`Rendered shared 1200×630 social preview (${Math.round(png.length / 1024)} KiB)`);
} finally {
  await browser.close();
}
