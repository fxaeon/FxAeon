import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configuredBrowserChannel } from '../../../../scripts/e2e_browser_channel.cjs';

const directory = import.meta.dirname;
const root = resolve(directory, '../../../..');
const require = createRequire(resolve(root, 'apps/mini-app/package.json'));
const { chromium } = require('@playwright/test');
const channel = configuredBrowserChannel();
const exports = [
  { source: 'fxaeon-x-profile.svg', output: 'fxaeon-x-profile.png', width: 400, height: 400 },
  { source: 'fxaeon-x-banner.svg', output: 'fxaeon-x-banner.png', width: 1500, height: 500 },
];

const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
try {
  for (const asset of exports) {
    const page = await browser.newPage({ viewport: { width: asset.width, height: asset.height }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(resolve(directory, asset.source)).href);
    const output = resolve(directory, asset.output);
    await page.screenshot({ path: output });
    await page.close();
    const png = await readFile(output);
    if (png.toString('ascii', 1, 4) !== 'PNG' || png.readUInt32BE(16) !== asset.width || png.readUInt32BE(20) !== asset.height) {
      throw new Error(`${asset.output} did not render at ${asset.width}×${asset.height}`);
    }
    console.log(`${asset.output}: ${asset.width}×${asset.height}, ${Math.ceil(png.length / 1024)} KiB`);
  }

  const profile = (await readFile(resolve(directory, 'fxaeon-x-profile.png'))).toString('base64');
  const banner = (await readFile(resolve(directory, 'fxaeon-x-banner.png'))).toString('base64');
  const page = await browser.newPage({ viewport: { width: 1120, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;padding:28px;background:#151515;color:#f5f6f8;font:14px/1.4 Arial,sans-serif}
    h1{font-size:16px;font-weight:600;margin:0 0 16px}h2{font-size:12px;font-weight:500;color:#b3b3b3;margin:0 0 9px}
    .profiles{display:flex;align-items:center;gap:20px;height:116px;margin-bottom:24px}
    .circle{border-radius:50%;overflow:hidden;background:#080808;flex:none}.tiny{width:32px;height:32px}.large{width:96px;height:96px}
    .desktop{position:relative;width:1064px;height:269px;overflow:visible;margin-bottom:34px}
    .desktop>img,.phone>img{display:block;width:100%;height:100%;object-fit:cover;border-radius:8px}
    .avatar{position:absolute;left:42px;bottom:-64px;width:142px;height:142px;border:5px solid #151515;border-radius:50%;overflow:hidden;background:#080808}
    .phone{position:relative;width:390px;height:99px;margin-bottom:68px;overflow:visible}
    .phone .avatar{left:14px;bottom:-35px;width:78px;height:78px;border-width:3px}
  </style><h1>FxAeon · X artwork crop review</h1>
  <h2>Profile photo circle crops at 32px and 96px</h2><div class="profiles"><div class="circle tiny"><img width="32" height="32" src="data:image/png;base64,${profile}"></div><div class="circle large"><img width="96" height="96" src="data:image/png;base64,${profile}"></div></div>
  <h2>Desktop profile header with conservative avatar overlay</h2><div class="desktop"><img src="data:image/png;base64,${banner}"><div class="avatar"><img width="132" height="132" src="data:image/png;base64,${profile}"></div></div>
  <h2>Phone-width 3:1 header with avatar overlay</h2><div class="phone"><img src="data:image/png;base64,${banner}"><div class="avatar"><img width="72" height="72" src="data:image/png;base64,${profile}"></div></div>`);
  const review = resolve(tmpdir(), 'fxaeon-x-social-review.png');
  await mkdir(tmpdir(), { recursive: true });
  await page.screenshot({ path: review, fullPage: true });
  await page.close();
  console.log(`Crop review: ${review}`);
} finally {
  await browser.close();
}
