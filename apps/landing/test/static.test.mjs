import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { relative, resolve, sep } from 'node:path';
import { escapeAttribute, telegramLauncher, telegramStartLink } from '../config.mjs';
import { qrModules, qrSvg } from '../qr.mjs';

const root = resolve(import.meta.dirname, '..');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const css = await readFile(resolve(root, 'styles.css'), 'utf8');
const script = await readFile(resolve(root, 'script.js'), 'utf8');
const cssCompact = css.replace(/\s+/g, '');
const scriptCompact = script.replace(/\s+/g, '');
const builtHtml = await readFile(resolve(root, 'dist/index.html'), 'utf8');
const headers = await readFile(resolve(root, 'dist/_headers'), 'utf8');
const appRequire = createRequire(resolve(root, '../mini-app/package.json'));
const DESKTOP = '(hover:hover) and (pointer:fine) and (min-width:861px)';

function textOf(markup) {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function elementSource(source, open, tag) {
  const start = source.search(open);
  assert.ok(start >= 0, `Missing element ${open}`);
  let depth = 0;
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  pattern.lastIndex = start;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return source.slice(start, match.index + match[0].length);
  }
  throw new Error(`Unclosed element ${open}`);
}

function links(source) {
  return [...source.matchAll(/<a\b([^>]*)>/g)].map(([, attributes]) => ({
    href: attributes.match(/\bhref="([^"]*)"/)?.[1],
    device: attributes.match(/\bdata-device="([^"]*)"/)?.[1] ?? 'all',
  }));
}

function modulesFromPath(path, size, offset = 0) {
  const grid = Array.from({ length: size }, () => new Array(size).fill(false));
  for (const [, x, y, width] of path.matchAll(/M(\d+)[ ,](\d+) ?h(\d+)/g)) {
    for (let step = 0; step < Number(width); step += 1) grid[Number(y) - offset][Number(x) - offset + step] = true;
  }
  return grid;
}

function referenceQr(value, level, boostLevel) {
  const react = appRequire('react');
  const { renderToStaticMarkup } = appRequire('react-dom/server');
  const { QRCodeSVG } = appRequire('qrcode.react');
  const svg = renderToStaticMarkup(react.createElement(QRCodeSVG, { value, level, boostLevel, marginSize: 0 }));
  return modulesFromPath(svg.match(/<path fill="#000000" d="([^"]*)"/)[1], Number(svg.match(/viewBox="0 0 (\d+) \1"/)[1]));
}

test('brand metadata and the official protocol mark stay in sync', async () => {
  for (const asset of ['assets/fxaeon-mark.svg', 'assets/fxaeon-banner.png', 'assets/inter-latin.woff2', 'assets/Inter-LICENSE.txt', 'assets/manrope-variable.ttf', 'assets/Manrope-LICENSE.txt', 'assets/poppins-regular.ttf', 'assets/poppins-medium.ttf', 'assets/Poppins-LICENSE.txt']) {
    await access(resolve(root, asset));
  }
  assert.match(html, /<html lang="en" data-theme="dark">/);
  assert.match(html, /rel="canonical" href="https:\/\/fxaeon\.xyz\//);
  assert.match(html, /property="og:image"/);
  assert.match(html, /name="twitter:image"/);
  assert.match(html, /assets\/manrope-variable\.ttf/);
  assert.match(css, /font-family:\s*Poppins;[\s\S]*?src:\s*url\("assets\/poppins-regular\.ttf"\)/);
  assert.match(css, /font-family:\s*Poppins;[\s\S]*?src:\s*url\("assets\/poppins-medium\.ttf"\)/);
  assert.match(css, /font-family:\s*Manrope;[\s\S]*?src:\s*url\("assets\/manrope-variable\.ttf"\)/);
  assert.match(await readFile(resolve(root, 'assets/Poppins-LICENSE.txt'), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(await readFile(resolve(root, 'assets/Manrope-LICENSE.txt'), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.deepEqual(
    await readFile(resolve(root, '../mini-app/public/brand/fx-official-mark.svg')),
    await readFile(resolve(root, 'dist/assets/fx-protocol.svg')),
    'The landing reuses the official protocol logo without altering its source',
  );
});

test('the page presents all four products and routes Telegram launches to matching app screens', async () => {
  assert.equal(html.match(/<h1\b/g)?.length, 1, 'There should be one page heading');
  const cards = [...html.matchAll(/<article class="product-card ([^"]+)"[\s\S]*?<\/article>/g)];
  assert.equal(cards.length, 4);
  const routes = ['trade', 'earn', 'borrow', 'move'];
  for (const route of routes) {
    const card = cards.find(([, className]) => className.startsWith(`${route}-card`))?.[0];
    assert.ok(card, `Missing ${route} product card`);
    assert.match(card, new RegExp(`href="https:\\/\\/fxaeon\\.com\\/${route}"`));
    assert.match(card, new RegExp(`href="https:\\/\\/t\\.me\\/FxAeonBot\\?startapp=${route}"`));
    assert.match(card, /<h3\b[^>]*>[\s\S]*?<\/h3>/, `${route} has a product heading`);
    assert.match(card, /<p\b[^>]*>[\s\S]*?<\/p>/, `${route} has a product description`);
  }
  const telegramSource = await readFile(resolve(root, '../mini-app/src/lib/telegram.ts'), 'utf8');
  const routeTable = telegramSource.match(/const START_PARAM_ROUTES[^=]*=\s*new Map\(\[([\s\S]*?)\]\);/)?.[1];
  assert.ok(routeTable, 'The app declares an allowlisted Telegram start route map');
  const appRoutes = new Map([...routeTable.matchAll(/\['([a-z-]+)',\s*'([^']+)'\]/g)].map(([, startParam, path]) => [startParam, path]));
  for (const route of routes) assert.equal(appRoutes.get(route), `/${route}`, `startapp=${route} resolves to its product screen`);
  const startParams = [...html.matchAll(/href="https:\/\/t\.me\/FxAeonBot\?startapp=([^"&]+)"/g)].map(([, value]) => value);
  assert.ok(startParams.length >= routes.length);
  for (const startParam of startParams) assert.ok(appRoutes.has(startParam), `The app explicitly handles startapp=${startParam}`);
  const copy = textOf(html);
  assert.match(copy, /Leverage and borrowing involve liquidation risk\. Savings yields vary\./);
  assert.match(copy, /Your wallet approves each transaction/);
  assert.match(copy, /Smart contracts, tokens, wallets, bridges, and networks carry risk/);
  assert.match(html, /id="products"/);
  assert.match(html, /id="protocol"/);
  assert.match(html, /id="telegram"/);
  assert.match(html, /id="faq"/);
});

test('device actions use the reviewed CSS capability query and safe destinations', () => {
  const actions = links(html).filter(({ device }) => device !== 'all');
  assert.ok(actions.some(({ href, device }) => href === 'https://fxaeon.com/' && device === 'desktop'));
  assert.ok(actions.some(({ href, device }) => href === 'https://t.me/FxAeonBot' && device === 'mobile'));
  assert.ok(cssCompact.includes(`@media${DESKTOP.replaceAll(' ', '')}{`), 'The original fine-pointer desktop query remains the device breakpoint');
  assert.match(css, /\[data-device="desktop"\]\s*\{\s*display:\s*none\s*!important\s*;/);
  assert.match(html, /https:\/\/t\.me\/FxAeonBot\?startapp=trade/);
  assert.match(html, /https:\/\/fxaeon\.com\/move/);
  assert.doesNotMatch(script, /userAgent|maxTouchPoints|ontouchstart/);
  for (const tag of html.match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? []) assert.match(tag, /rel="noreferrer"/);
});

test('the menu and theme controls preserve native keyboard and reduced-motion behavior', () => {
  assert.equal(html.match(/<dialog\b/g)?.length, 1);
  const menu = elementSource(html, /<dialog\b/, 'dialog');
  assert.match(menu, /aria-label="[^"]+"/);
  assert.match(menu, /<button\b[^>]*aria-label="[^"]+"[^>]*>/, 'The modal has a named close control');
  assert.match(html, /<button\b[^>]*aria-controls="[^"]+"[^>]*aria-expanded="false"[^>]*>/);
  const menuLinks = links(menu);
  assert.ok(menuLinks.some(({ href }) => href?.startsWith('#')));
  for (const { href } of menuLinks.filter(({ href }) => href?.startsWith('#'))) assert.match(html, new RegExp(`id="${href.slice(1)}"`), `Menu anchor ${href} has a target`);
  assert.ok(scriptCompact.includes('menu.showModal()'));
  assert.ok(scriptCompact.includes('menu.querySelector(".menu-close").addEventListener("click",close)'));
  assert.ok(scriptCompact.includes('menu.querySelectorAll("a").forEach((link)=>link.addEventListener("click",close))'));
  assert.ok(scriptCompact.includes('menu.addEventListener("close",()=>'));
  assert.ok(scriptCompact.includes('opener.setAttribute("aria-expanded","false")'));
  assert.ok(html.includes('class="theme-toggle"'), 'The footer includes a theme control');
  assert.match(html, /aria-label="[^"]+theme"/);
  assert.ok(scriptCompact.includes('localStorage.getItem("fxaeon-theme")'));
  assert.ok(scriptCompact.includes('localStorage.setItem("fxaeon-theme",root.dataset.theme)'));
  assert.match(script, /theme-color/);
  assert.ok(cssCompact.includes('@media(prefers-reduced-motion:reduce)'));
  assert.ok(cssCompact.includes('scroll-behavior:auto'));
  assert.ok(cssCompact.includes('transition:none!important'));
});

test('markup, local assets, and built headers meet accessibility and CSP requirements', async () => {
  assert.match(html, /<a class="skip-link" href="#main">Skip to content<\/a>/);
  assert.match(html, /<main id="main">/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline/);
  for (const image of html.match(/<img\b[^>]*>/g) ?? []) assert.match(image, /\balt="[^"]*"/);
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.ok(buttons.length > 0);
  for (const [, attributes, content] of buttons) {
    const name = attributes.match(/\baria-label="([^"]+)"/)?.[1] ?? textOf(content.replace(/<svg[\s\S]*?<\/svg>/g, ''));
    assert.ok(name, `Button needs an accessible name: ${attributes}`);
  }
  assert.doesNotMatch(html, /\sstyle=/);
  assert.doesNotMatch(html, /<style\b/);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.equal(html.toLowerCase().split('<script').length - 1, 1);
  assert.match(html, /<script src="script\.js"><\/script>/);
  assert.doesNotMatch(html, /aurora\.js/);
  assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b|\bimport\(|\beval\(|new Function/);

  for (const [, value] of builtHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (/^(?:https?:|#|mailto:|data:)/.test(value) || value === '/') continue;
    await access(resolve(root, 'dist', value.replace(/^\//, '').split(/[?#]/)[0]));
  }
  assert.match(headers, /Content-Security-Policy: default-src 'self'/);
  assert.match(headers, /script-src 'self'/);
  assert.match(headers, /style-src 'self'/);
  assert.match(headers, /connect-src 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
});

test('built output includes safe Telegram routes, the exact QR, font licenses, crawl metadata, and static 404', async () => {
  const launcher = telegramLauncher(process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || undefined);
  assert.ok(builtHtml.includes(`href="${escapeAttribute(launcher)}"`));
  for (const route of ['trade', 'earn', 'borrow', 'move']) assert.ok(builtHtml.includes(`href="${escapeAttribute(telegramStartLink(launcher, route))}"`), `${route} start link`);
  assert.equal(await readFile(resolve(root, 'dist/assets/telegram-qr.svg'), 'utf8'), qrSvg(launcher));
  for (const file of ['script.js', 'styles.css', 'assets/manrope-variable.ttf', 'assets/Manrope-LICENSE.txt', 'assets/poppins-regular.ttf', 'assets/poppins-medium.ttf', 'assets/Poppins-LICENSE.txt', 'assets/Inter-LICENSE.txt']) await access(resolve(root, 'dist', file));
  for (const license of ['Inter-LICENSE.txt', 'Manrope-LICENSE.txt', 'Poppins-LICENSE.txt']) assert.deepEqual(await readFile(resolve(root, 'assets', license)), await readFile(resolve(root, 'dist/assets', license)));
  const robots = await readFile(resolve(root, 'dist/robots.txt'), 'utf8');
  const sitemap = await readFile(resolve(root, 'dist/sitemap.xml'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/fxaeon\.xyz\/sitemap\.xml/);
  assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]), ['https://fxaeon.xyz/']);
  const missing = await readFile(resolve(root, 'dist/404.html'), 'utf8');
  assert.match(missing, /name="robots" content="noindex"/);
  assert.match(missing, /<h1>Page not found<\/h1>/);
  assert.match(missing, /href="\/"/);
});

test('launcher accepts reviewed Telegram URLs and rejects unsafe or ambiguous destinations', () => {
  assert.equal(telegramLauncher('https://t.me/FxAeonBot/app?startapp=launch_1'), 'https://t.me/FxAeonBot/app?startapp=launch_1');
  for (const value of ['https://evil.test/FxAeonBot', 'http://t.me/FxAeonBot',
    'https://user:password@t.me/FxAeonBot', 'https://t.me:444/FxAeonBot',
    'https://t.me/FxAeonBot#payload', 'https://t.me/FxAeonBot?other=1',
    'https://t.me/FxAeonBot?startapp=one&startapp=two',
    'https://t.me/FxAeonBot?startapp=%22onclick=alert(1)']) assert.throws(() => telegramLauncher(value), value);
  assert.equal(telegramStartLink(undefined, 'trade'), 'https://t.me/FxAeonBot?startapp=trade');
  assert.equal(telegramStartLink('https://t.me/FxAeonBot/app?startapp=launch_1', 'trade-btc'), 'https://t.me/FxAeonBot/app?startapp=trade-btc');
  for (const value of ['', 'Trade', 'trade/earn', 'trade?x=1', '../trade', 'trade earn', '"trade"', 'x'.repeat(33)]) assert.throws(() => telegramStartLink(undefined, value), value);
});

test('the Telegram QR encoder matches the app renderer module for module', () => {
  for (const launcher of [telegramLauncher(), 'https://t.me/FxAeonBot/app?startapp=launch_1']) {
    assert.deepEqual(qrModules(launcher), referenceQr(launcher, 'M', true), launcher);
  }
  const text = (length) => 'https://t.me/FxAeonBot?startapp=trade-btc&FxAeon/0123456789'.repeat(40).slice(0, length);
  for (const level of ['L', 'M', 'Q', 'H']) {
    for (let length = 1; ; length += 7) {
      const modules = qrModules(text(length), { level, boost: false });
      if (modules.length > 57) break;
      assert.deepEqual(modules, referenceQr(text(length), level, false), `${level}, ${length} bytes`);
    }
  }
  for (const length of [300, 700, 1200, 2300]) assert.deepEqual(qrModules(text(length), { boost: false }), referenceQr(text(length), 'M', false), `M, ${length} bytes`);
  const svg = qrSvg(telegramLauncher());
  const modules = qrModules(telegramLauncher());
  assert.match(svg, new RegExp(`^<svg xmlns="http://www\\.w3\\.org/2000/svg" viewBox="0 0 ${modules.length + 8} ${modules.length + 8}"`));
  assert.deepEqual(modulesFromPath(svg.match(/<path fill="#130e24" d="([^"]*)"/)[1], modules.length, 4), modules);
  assert.match(svg, new RegExp(`<rect width="${modules.length + 8}" height="${modules.length + 8}" fill="#ffffff"/>`));
  assert.doesNotMatch(svg, /<script|<style|\sstyle=|\son[a-z]+=|href=/i);
});

test('the standalone build needs no node_modules and ships only referenced assets', async () => {
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'fxaeon-landing-build-'));
  const tempLanding = resolve(tempRoot, 'apps', 'landing');
  try {
    const excluded = new Set(['dist', 'node_modules', 'test']);
    await mkdir(resolve(tempRoot, 'apps'), { recursive: true });
    await cp(root, tempLanding, {
      recursive: true,
      filter(source) {
        const path = relative(root, source).split(sep).join('/');
        return path === '' || ![...excluded].some((name) => path === name || path.startsWith(`${name}/`));
      },
    });
    const brandPath = resolve(tempRoot, 'apps/mini-app/public/brand');
    await mkdir(brandPath, { recursive: true });
    await cp(resolve(root, '../mini-app/public/brand/fx-official-mark.svg'), resolve(brandPath, 'fx-official-mark.svg'));
    const launcher = 'https://t.me/FxAeonBot/app?startapp=launch_1';
    execFileSync(process.execPath, ['build.mjs'], { cwd: tempLanding, stdio: 'pipe', env: { ...process.env, NEXT_PUBLIC_TELEGRAM_APP_URL: launcher } });
    await assert.rejects(access(resolve(tempRoot, 'node_modules')));
    await assert.rejects(access(resolve(tempLanding, 'node_modules')));
    for (const file of ['script.js', 'styles.css', 'assets/manrope-variable.ttf', 'assets/Manrope-LICENSE.txt', 'assets/poppins-regular.ttf', 'assets/poppins-medium.ttf', 'assets/Poppins-LICENSE.txt', 'assets/Inter-LICENSE.txt', 'assets/telegram-qr.svg']) await access(resolve(tempLanding, 'dist', file));
    await assert.rejects(access(resolve(tempLanding, 'dist/aurora.js')));
    const built = await readFile(resolve(tempLanding, 'dist/index.html'), 'utf8');
    const destinations = [...built.matchAll(/href="(https:\/\/t\.me\/[^\"]*)"/g)].map(([, href]) => href);
    assert.ok(destinations.includes('https://t.me/FxAeonBot/app?startapp=launch_1'));
    for (const route of ['trade', 'earn', 'borrow', 'move']) assert.ok(destinations.includes(`https://t.me/FxAeonBot/app?startapp=${route}`));
    assert.equal(await readFile(resolve(tempLanding, 'dist/assets/telegram-qr.svg'), 'utf8'), qrSvg(launcher));

    const site = await Promise.all(['index.html', 'styles.css', 'script.js', '404.html', 'document.css'].map((file) => readFile(resolve(tempLanding, 'dist', file), 'utf8')));
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(resolve(tempLanding, 'dist/assets'), { recursive: true, withFileTypes: true });
    for (const entry of files.filter((item) => item.isFile())) {
      const file = relative(resolve(tempLanding, 'dist'), resolve(entry.parentPath, entry.name)).split(sep).join('/');
      if (/LICENSE\.txt$/.test(file)) continue;
      assert.ok(site.some((source) => source.includes(file)), `${file} ships but no page, style, script, or metadata references it`);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('checked-in icons match the app renderer and preserve their license', async () => {
  const react = appRequire('react');
  const { renderToStaticMarkup } = appRequire('react-dom/server');
  const lucide = appRequire('lucide-react');
  const licensePath = appRequire.resolve('lucide-react/package.json');
  const icons = { receive: lucide.ArrowDownToLine, trade: lucide.CandlestickChart, move: lucide.ArrowLeftRight, earn: lucide.PiggyBank };
  for (const [name, Icon] of Object.entries(icons)) {
    const rendered = renderToStaticMarkup(react.createElement(Icon, { size: 24, color: '#2973ff', strokeWidth: 2 }));
    assert.equal(await readFile(resolve(root, 'assets/icons', `${name}.svg`), 'utf8'), rendered);
  }
  const normalize = (value) => value.replace(/\r\n?/g, '\n');
  assert.equal(normalize(await readFile(resolve(root, 'assets/icons/LICENSE.txt'), 'utf8')), normalize(await readFile(resolve(licensePath, '../LICENSE'), 'utf8')));
});
