import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configuredBrowserChannel } from './e2e_browser_channel.cjs';

// Development-only, synthetic fixtures. No env credentials, server or live API.
// Email HTML/text/captures stay in the user's private directory, outside Git.
const root = resolve(import.meta.dirname, '..');
const output = resolve(homedir(), '.codex/private/fxaeon-messaging-polish');
const assets = resolve(root, 'docs/assets/brand');
const require = createRequire(resolve(root, 'apps/mini-app/package.json'));
const { chromium } = require('@playwright/test');
const { tsImport } = require('tsx/esm/api');
const { renderNotificationEmailV2, escapeEmailHtml } = await tsImport(pathToFileURL(resolve(root, 'server/miniapp-access/notifications.ts')).href, import.meta.url);
const { TELEGRAM_REPLIES } = await tsImport(pathToFileURL(resolve(root, 'server/miniapp-access/bot.ts')).href, import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(assets, { recursive: true });
const icon = await readFile(resolve(root, 'apps/mini-app/public/icon.svg'), 'utf8');
const paths = [...icon.matchAll(/<path\b[^>]*\/>/g)].map(match => match[0].replaceAll('url(#ribbon)', '#2973ff')).join('\n    ');
if ((paths.match(/<path/g) ?? []).length !== 3) throw new Error('Expected the three canonical ribbon paths');
const avatar = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-labelledby="title desc">
  <title id="title">FxAeon</title><desc id="desc">The original FxAeon blue ribbon on a neutral dark background, padded for a circular profile crop.</desc>
  <rect width="1024" height="1024" fill="#080808"/>
  <g transform="translate(64 64) scale(14)">
    ${paths}
  </g>
</svg>\n`;
await writeFile(resolve(assets, 'fxaeon-bot-avatar.svg'), avatar);
const channel = configuredBrowserChannel();
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.route('**/*', route => route.abort());
  await page.setContent(`<style>html,body{margin:0;width:1024px;height:1024px}svg{display:block}</style>${avatar}`);
  await page.screenshot({ path: resolve(assets, 'fxaeon-bot-avatar-1024.png') });
  const png = await readFile(resolve(assets, 'fxaeon-bot-avatar-1024.png'));
  if (png.readUInt32BE(16) !== 1024 || png.readUInt32BE(20) !== 1024) throw new Error('Unexpected avatar dimensions');
  const data = `data:image/png;base64,${png.toString('base64')}`;
  const e = escapeEmailHtml;
  await page.setViewportSize({ width: 800, height: 550 });
  await page.setContent(`<html><style>body{margin:0;padding:40px;background:#151515;color:white;font:16px Arial}h1{font-size:24px;font-weight:500}main{display:flex;align-items:center;gap:48px;margin-top:36px}figure{margin:0;text-align:center}img{display:block;border-radius:50%;margin:0 auto 16px}p{color:#b3b3b3;line-height:1.6}</style><h1>FxAeon · profile crop review</h1><p>Original ribbon paths · #2973FF · neutral #080808 canvas<br>Actual display sizes; no new symbol or lettering.</p><main>${[32, 48, 128].map(size => `<figure><img src="${data}" width="${size}" height="${size}" alt="FxAeon circle crop"><figcaption>${size}px</figcaption></figure>`).join('')}<figure><img src="${data}" width="224" height="224" style="border-radius:0" alt="Square export"><figcaption>Square master</figcaption></figure></main></html>`);
  await page.screenshot({ path: resolve(output, 'avatar-circle-review.png') });
  for (const size of [32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>body{margin:0;background:transparent}img{display:block;border-radius:50%}</style><img src="${data}" width="${size}" height="${size}" alt="FxAeon">`);
    await page.screenshot({ path: resolve(output, `avatar-circle-${size}.png`), omitBackground: true });
  }
  const fixtures = [
    { kind: 'verification', url: `https://fxaeon.com/invite#token=${'0'.repeat(64)}`, expiresAt: Date.UTC(2026, 10, 3, 11) },
    { kind: 'invitation', url: 'https://t.me/FxAeonBot?startapp' },
  ];
  for (const fixture of fixtures) {
    const mail = renderNotificationEmailV2(fixture);
    await writeFile(resolve(output, `${fixture.kind}.html`), mail.html);
    await writeFile(resolve(output, `${fixture.kind}.txt`), `${mail.subject}\n\n${mail.text}\n`);
    for (const width of [320, 390, 560]) {
      await page.setViewportSize({ width, height: 844 });
      await page.setContent(mail.html);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) throw new Error(`${fixture.kind} overflows at ${width}px`);
      await page.screenshot({ path: resolve(output, `${fixture.kind}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<html><style>body{margin:0;padding:24px;background:#fff;color:#171717;font:16px/1.6 Arial}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>${e(mail.text)}</pre></html>`);
    await page.screenshot({ path: resolve(output, `${fixture.kind}-plaintext-phone.png`), fullPage: true });
    // Side-by-side phone mockups keep the real email body and plain text visible.
    await page.setViewportSize({ width: 860, height: 1280 });
    await page.setContent(`<html><style>body{margin:0;padding:28px;background:#202020;color:#fff;font:14px Arial}h1{font-size:22px;font-weight:500}main{display:flex;gap:24px}section{width:390px;flex-shrink:0}iframe{width:390px;height:1160px;border:0;background:#080808;border-radius:24px}pre{box-sizing:border-box;margin:0;padding:24px;background:white;color:#171717;min-height:1160px;border-radius:24px;font:16px/1.6 Arial;white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>FxAeon · ${fixture.kind} · synthetic fixture</h1><main><section><p>HTML · 390px</p><iframe title="HTML email" srcdoc="${e(mail.html)}"></iframe></section><section><p>Plain text · 390px</p><pre>${e(mail.text)}</pre></section></main></html>`);
    await page.screenshot({ path: resolve(output, `${fixture.kind}-phone-review.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1150, height: 780 });
  await page.setContent(`<html><style>body{margin:0;padding:36px;background:#080808;color:white;font:16px/1.5 Arial}h1{font-size:24px;font-weight:500}main{display:flex;gap:24px}section{width:330px}article{padding:24px;background:#202020;border-radius:16px}p{white-space:pre-line;margin:0}button{display:block;width:100%;background:#2563eb;border:0;border-radius:12px;padding:16px;color:white;font:600 16px Arial;margin-top:8px}small{color:#b3b3b3}</style><h1>FxAeon · Telegram reply review</h1><small>Synthetic rendering; native Telegram typography may differ.</small><main>${Object.entries(TELEGRAM_REPLIES).map(([command, text]) => { const [title, ...rest] = text.split('\n\n'); return `<section><h2>/${command}</h2><article><p><strong>${e(title)}</strong>\n\n${e(rest.join('\n\n'))}</p></article><button>Open FxAeon</button></section>`; }).join('')}</main></html>`);
  await page.screenshot({ path: resolve(output, 'telegram-replies-review.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [command, text] of Object.entries(TELEGRAM_REPLIES)) {
    const [title, ...rest] = text.split('\n\n');
    await page.setContent(`<html><style>body{margin:0;background:#080808;color:white;font:16px/1.5 Arial}header{display:flex;align-items:center;gap:12px;padding:16px;background:#151515}header img{border-radius:50%}small{display:block;color:#b3b3b3;font-size:13px}main{padding:24px 16px}article{background:#202020;border-radius:16px;padding:20px}p{white-space:pre-line;margin:0}button{display:block;width:100%;background:#2563eb;border:0;border-radius:12px;padding:16px;color:white;font:600 16px Arial;margin-top:8px}footer{padding:16px;color:#b3b3b3;font-size:12px}</style><header><img src="${data}" width="44" height="44" alt="FxAeon"><div>FxAeon<small>bot</small></div></header><main><small>/${command}</small><article><p><strong>${e(title)}</strong>\n\n${e(rest.join('\n\n'))}</p></article><button>Open FxAeon</button></main><footer>390px synthetic preview · native Telegram may differ</footer></html>`);
    await page.screenshot({ path: resolve(output, `telegram-${command}-phone.png`), fullPage: true });
  }
  const brandGuide = (await readFile(resolve(root, 'docs/brand-assets.md'), 'utf8')).replaceAll('\r\n', '\n');
  const about = /\*\*About \/ short description:\*\* (.+)/.exec(brandGuide)?.[1];
  const description = /\*\*Description:\*\*[\s\S]*?```text\n([\s\S]*?)\n {2}```/.exec(brandGuide)?.[1].replace(/^ {2}/gm, '');
  if (!about || !description) throw new Error('Profile copy is missing from the brand guide');
  await page.setContent(`<html><style>body{margin:0;padding:32px 24px;background:#080808;color:white;font:16px/1.6 Arial}header{text-align:center}img{border-radius:50%}h1{margin:12px 0 0;font-size:28px;font-weight:600}small{color:#b3b3b3;font-size:13px}h2{margin:28px 0 8px;font-size:14px;color:#b3b3b3;font-weight:400}p{margin:0;white-space:pre-line;overflow-wrap:anywhere}footer{margin-top:28px;color:#b3b3b3;font-size:12px}</style><header><img src="${data}" width="128" height="128" alt="FxAeon"><h1>FxAeon</h1><small>bot · proposed profile</small></header><h2>About</h2><p>${e(about)}</p><h2>Description</h2><p>${e(description)}</p><footer>390px synthetic preview · profile has not been changed</footer></html>`);
  await page.screenshot({ path: resolve(output, 'telegram-profile-phone.png'), fullPage: true });
  console.log(`Avatar: ${resolve(assets, 'fxaeon-bot-avatar-1024.png')}`);
  console.log(`Private synthetic previews: ${output}`);
} finally {
  await browser.close();
}
