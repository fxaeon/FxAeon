import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { configuredBrowserChannel } from './e2e_browser_channel.cjs';

// Development-only: render the same assembled pose used for reduced motion.
// The deployed landing has no Playwright or other package dependency.
const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, 'apps/mini-app/package.json'));
const { chromium } = require('@playwright/test');
const channel = configuredBrowserChannel();
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
try {
  const page = await browser.newPage({ reducedMotion: 'reduce', deviceScaleFactor: 1.5 });
  for (const [name, viewportWidth, width, height] of [['desktop', 1280, 1000, 440], ['mobile', 390, 366, 320]]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    await page.setContent(`<style>body{margin:0;background:transparent}.capital-art{position:relative;width:${width}px;height:${height}px}canvas{width:100%;height:100%}</style><div class="capital-art"><canvas></canvas></div>`);
    await page.addScriptTag({ path: resolve(root, 'apps/landing/sculpture.js') });
    await page.waitForFunction(() => document.querySelector('.capital-art').dataset.rendered === 'true');
    await page.locator('.capital-art').screenshot({
      path: resolve(root, `apps/landing/assets/capital-sculpture-${name}.png`),
      omitBackground: true,
    });
    console.log(`Rendered ${name} sculpture fallback`);
  }
} finally {
  await browser.close();
}
