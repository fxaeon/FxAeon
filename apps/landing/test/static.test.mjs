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
const dollarOutcomes = await readFile(resolve(root, 'dollar-outcomes.js'), 'utf8');
const heroField = await readFile(resolve(root, 'hero-field.js'), 'utf8');
const cssCompact = css.replace(/\s+/g, '');
const scriptCompact = script.replace(/\s+/g, '');
const builtHtml = await readFile(resolve(root, 'dist/index.html'), 'utf8');
const headers = await readFile(resolve(root, 'dist/_headers'), 'utf8');
const appRequire = createRequire(resolve(root, '../mini-app/package.json'));

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
  assert.match(css, /font-family:\s*Inter;[\s\S]*?src:\s*url\("assets\/inter-latin\.woff2"\)/);
  assert.match(css, /font-family:\s*Manrope;[\s\S]*?src:\s*url\("assets\/manrope-variable\.ttf"\)/);
  assert.match(css, /font-family:\s*Poppins;[\s\S]*?src:\s*url\("assets\/poppins-regular\.ttf"\)/);
  assert.match(css, /font-family:\s*Poppins;[\s\S]*?src:\s*url\("assets\/poppins-medium\.ttf"\)/);
  assert.match(await readFile(resolve(root, 'assets/Manrope-LICENSE.txt'), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(await readFile(resolve(root, 'assets/Poppins-LICENSE.txt'), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(html, /<script src="hero-field\.js" defer><\/script>/);
  assert.deepEqual(
    await readFile(resolve(root, '../mini-app/public/brand/fx-official-mark.svg')),
    await readFile(resolve(root, 'dist/assets/fx-protocol.svg')),
    'The landing reuses the official protocol logo without altering its source',
  );
});

test('the four product cards link to their web routes and the three-use calculator', async () => {
  assert.equal(html.match(/<h1\b/g)?.length, 1, 'There should be one page heading');
  const productSection = elementSource(html, /<section\s+class="products section"/, 'section');
  const cards = [...productSection.matchAll(/<article class="product-card ([^"]+)">([\s\S]*?)<\/article>/g)];
  assert.equal(cards.length, 4);
  const routes = ['trade', 'earn', 'borrow', 'move'];
  for (const [, className, card] of cards) {
    const route = className.replace(/-card$/, '');
    assert.ok(routes.includes(route), `Unexpected product ${route}`);
    assert.match(card, new RegExp(`href="https:\\/\\/fxaeon\\.com\\/${route}"`));
    assert.match(card, /<h3\b[^>]*>[\s\S]*?<\/h3>/, `${route} has a product heading`);
    assert.match(card, /<p\b[^>]*>[\s\S]*?<\/p>/, `${route} has a product description`);
    assert.match(card, new RegExp(`aria-label="Open ${route[0].toUpperCase()}${route.slice(1)}"`));
  }
  assert.doesNotMatch(productSection, /<details\b|<summary\b/, 'Product cards avoid added disclosure controls');
  const panels = [...html.matchAll(/<section class="outcome-panel" id="outcome-([^"]+)"/g)].map(([, name]) => name);
  assert.deepEqual(panels, ['earn', 'borrow', 'trade']);
  assert.match(html, /<section class="outcomes section" id="outcomes"/);
  for (const route of ['earn', 'borrow', 'trade']) assert.match(html, new RegExp(`href="#outcomes" data-open-outcome="${route}"`));
  assert.doesNotMatch(html, /class="hero-networks"|Also in Telegram/);
  assert.match(textOf(html), /Four ways to use FxAeon/);
  const telegramSource = await readFile(resolve(root, '../mini-app/src/lib/telegram.ts'), 'utf8');
  const routeTable = telegramSource.match(/const START_PARAM_ROUTES[^=]*=\s*new Map\(\[([\s\S]*?)\]\);/)?.[1];
  assert.ok(routeTable, 'The app declares an allowlisted Telegram start route map');
  const appRoutes = new Map([...routeTable.matchAll(/\['([a-z-]+)',\s*'([^']+)'\]/g)].map(([, startParam, path]) => [startParam, path]));
  for (const route of routes) assert.equal(appRoutes.get(route), `/${route}`, `startapp=${route} resolves to its product screen`);
  const startParams = [...html.matchAll(/href="https:\/\/t\.me\/FxAeonBot\?startapp=([^"&]+)"/g)].map(([, value]) => value);
  for (const startParam of startParams) assert.ok(appRoutes.has(startParam), `The app explicitly handles startapp=${startParam}`);
  const copy = textOf(html);
  assert.match(copy, /Leveraged positions and borrowing can be rebalanced or liquidated/);
  assert.match(copy, /Your wallet approves each transaction/);
  assert.match(copy, /Smart contracts, tokens, wallets, bridges, and networks carry risk/);
  assert.match(html, /id="products"/);
  assert.match(html, /id="protocol"/);
  assert.match(html, /id="telegram"/);
  assert.match(html, /id="faq"/);
  assert.match(html, /<footer class="site-footer">/);
});

test('calculator figures start blank where live data is required, use concise labels, and preserve their math', () => {
  const outcomes = elementSource(html, /<section class="outcomes section"/, 'section');
  assert.match(html, /id="dollar-amount"[^>]*aria-label="Amount in US dollars"/);
  assert.match(html, /id="example-leverage"[^>]*min="1\.1"[^>]*max="5"/);
  for (const key of ['fxSaveTvlUsd', 'fxSaveApy', 'ethUsd', 'btcUsd']) {
    assert.match(html, new RegExp(`data-market-value="${key}">—<`), 'Live metrics start without invented values');
  }
  assert.match(html, /data-earn-projection>—</);
  assert.match(html, /data-borrow-output>\$500\.00</);
  assert.match(html, /data-earn-caption>Waiting for a fresh APY</);
  assert.match(outcomes, /<h2 id="outcomes-title">What your crypto can do\.<\/h2>/);
  assert.match(outcomes, /<label id="amount-context" for="dollar-amount">Starting value<\/label>/);
  assert.match(outcomes, /<span class="amount-currency">USD<\/span>/);
  assert.match(outcomes, /<div class="amount-presets" role="group" aria-label="Starting amount">/);
  for (const amount of ['100', '1000', '10000']) assert.match(outcomes, new RegExp(`data-dollar-preset="${amount}"`));
  assert.match(html, /Loan-to-value<\/span><strong>50%<\/strong>/);
  assert.match(html, /<label for="example-leverage">Leverage<\/label>/);
  assert.match(html, /class="visual-label">After 1 year<\/span>/);
  assert.match(html, /<dt>Earnings<\/dt>/);
  assert.match(html, /Base annual interest<\/dt><dd>0%<\/dd>/);
  assert.match(html, /±10% price move/);
  assert.doesNotMatch(textOf(outcomes), /illustrative|example/i, 'Scenario wording stays direct');
  assert.doesNotMatch(outcomes, /aria-label="[^"]*(?:illustrative|example)/i, 'Accessible names stay concise');
  assert.match(dollarOutcomes, /amount \* \(1 \+ apy \/ 100\)/);
  assert.match(dollarOutcomes, /amount \* \.5/);
  assert.match(dollarOutcomes, /exposure \* \.1/);
  assert.match(dollarOutcomes, /Fresh APY unavailable/);
  assert.match(dollarOutcomes, /fresh ETH price unavailable/);
});

test('web app actions work on every device and Telegram remains an explicit choice', () => {
  assert.equal(links(html).filter(({ device }) => device !== 'all').length, 0);
  const actions = elementSource(html, /<div class="actions"/, 'div');
  assert.deepEqual(links(actions).map(link => link.href), ['https://fxaeon.com/', 'https://t.me/FxAeonBot']);
  assert.match(html, /https:\/\/t\.me\/FxAeonBot/);
  assert.match(html, /Open in Telegram/);
  assert.match(html, /Prefer the browser\? Open web app/);
  assert.match(html, /https:\/\/fxaeon\.com\/move/);
  assert.doesNotMatch(script, /userAgent|maxTouchPoints|ontouchstart/);
  for (const tag of html.match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? []) assert.match(tag, /rel="[^"]*noreferrer/);
});

test('hero credit, market metadata, and retry affordance stay quiet until needed', () => {
  const hero = elementSource(html, /<section class="hero"/, 'section');
  assert.ok(hero.indexOf('class="lede"') < hero.indexOf('class="hero-credit"'), 'Protocol credit follows the hero lede');
  assert.match(hero, /Powered By f\(x\) SDK/);
  assert.doesNotMatch(hero, /Built on f\(x\) Protocol/);
  assert.match(html, /<button class="market-refresh"[^>]*hidden>Retry live data<\/button>/);
  assert.doesNotMatch(html, /Data sources|data-market-sources/i, 'No visible data-sources disclosure is added');
  assert.match(dollarOutcomes, /refreshButton\.hidden = !unavailable && !refreshingData/);
  assert.match(dollarOutcomes, /refreshButton\.disabled = checkingData/);
  assert.match(dollarOutcomes, /node\.title = \[source/);
  assert.match(dollarOutcomes, /\? 'Price updated ' : 'Checked '\)/);
  assert.match(dollarOutcomes, /Price updated/);
  assert.doesNotMatch(dollarOutcomes, /Variable yield|variable APY/i);
});

test('the menu stays keyboard accessible and the page enforces its single dark theme', () => {
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
  assert.match(html, /<html lang="en" data-theme="dark">/);
  assert.doesNotMatch(html, /theme-toggle|data-theme-label|Light mode|Dark mode/);
  assert.doesNotMatch(css, /data-theme\s*=\s*["']light["']/);
  assert.match(html, /name="theme-color" content="#101214"/);
  assert.ok(scriptCompact.includes('root.dataset.theme="dark"'));
  assert.ok(scriptCompact.includes('localStorage.removeItem("fxaeon-theme")'));
  assert.doesNotMatch(script, /setItem\("fxaeon-theme"|data-theme="light"/);
  assert.ok(scriptCompact.includes('localStorage.removeItem("fxaeon-motion")'));
  assert.ok(scriptCompact.includes('window.matchMedia("(prefers-reduced-motion:reduce)")'));
  assert.ok(scriptCompact.includes('root.dataset.motion=reducedMotion.matches?"off":"on"'));
  assert.ok(scriptCompact.includes('reducedMotion.addEventListener("change",applyMotion)'));
  assert.doesNotMatch(html, /motion-toggle|motion-control|Reduce motion|Enable motion/);
  assert.ok(cssCompact.includes('@media(prefers-reduced-motion:reduce)'));
  assert.ok(cssCompact.includes('scroll-behavior:auto'));
  assert.ok(cssCompact.includes('transition:none!important'));
  assert.match(css, /\.protocol-principles/);
  assert.match(html, /class="protocol-principles"/);
  assert.match(heroField, /webgl2/);
  assert.match(heroField, /1000\s*\/\s*30/);
  assert.match(heroField, /saveData/);
  assert.match(heroField, /IntersectionObserver/);
  assert.match(heroField, /ResizeObserver/);
  assert.match(heroField, /prefers-reduced-motion/);
  assert.match(heroField, /retryWhenEnabled/);
  assert.match(heroField, /const dispose = \(contextLost = false\)/);
  assert.match(heroField, /resizeObserver\.disconnect\(\)/);
  assert.match(heroField, /settingsObserver\.disconnect\(\)/);
  assert.ok(Buffer.byteLength(heroField) < 12 * 1024, 'The hero field runtime stays within a 12 KB source budget');
  assert.doesNotMatch(heroField, /fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|eval\(|new Function/);
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
  assert.equal(html.toLowerCase().split('<script').length - 1, 3);
  assert.match(html, /<script type="module" src="dollar-outcomes\.js"><\/script>/);
  assert.match(html, /<script src="script\.js"><\/script>/);
  assert.match(html, /<script src="hero-field\.js" defer><\/script>/);
  assert.doesNotMatch(html, /aurora\.js/);
  assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b|\bimport\(|\beval\(|new Function/);

  for (const [, value] of builtHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (/^(?:https?:|#|mailto:|data:)/.test(value) || value === '/') continue;
    await access(resolve(root, 'dist', value.replace(/^\//, '').split(/[?#]/)[0]));
  }
  assert.match(headers, /Content-Security-Policy: default-src 'self'/);
  assert.match(headers, /script-src 'self'/);
  assert.match(headers, /style-src 'self'/);
  assert.match(headers, /connect-src 'self'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
});

test('built output includes safe Telegram routes, the exact QR, font licenses, crawl metadata, and static 404', async () => {
  const launcher = telegramLauncher(process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || undefined);
  assert.ok(builtHtml.includes(`href="${escapeAttribute(launcher)}"`));
  for (const route of ['trade', 'earn', 'borrow', 'move']) assert.ok(builtHtml.includes(`href="https://fxaeon.com/${route}"`), `${route} web route`);
  assert.equal(await readFile(resolve(root, 'dist/assets/telegram-qr.svg'), 'utf8'), qrSvg(launcher));
  for (const file of ['script.js', 'hero-field.js', 'dollar-outcomes.js', 'market-data-client.mjs', 'market-data.mjs', '_routes.json', 'styles.css', 'assets/manrope-variable.ttf', 'assets/Manrope-LICENSE.txt', 'assets/Inter-LICENSE.txt', 'assets/poppins-regular.ttf', 'assets/poppins-medium.ttf', 'assets/Poppins-LICENSE.txt']) await access(resolve(root, 'dist', file));
  assert.deepEqual(JSON.parse(await readFile(resolve(root, 'dist/_routes.json'), 'utf8')), { version: 1, include: ['/api/market-data'], exclude: [] });
  await assert.rejects(access(resolve(root, 'dist/functions')));
  assert.ok((await readFile(resolve(root, 'dist/hero-field.js'))).byteLength < 12 * 1024);
  for (const license of ['Inter-LICENSE.txt', 'Manrope-LICENSE.txt']) assert.deepEqual(await readFile(resolve(root, 'assets', license)), await readFile(resolve(root, 'dist/assets', license)));
  await assert.rejects(access(resolve(root, 'dist/assets/tokens/usdc.png')));
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
    for (const file of ['script.js', 'hero-field.js', 'styles.css', 'assets/manrope-variable.ttf', 'assets/Manrope-LICENSE.txt', 'assets/Inter-LICENSE.txt', 'assets/poppins-regular.ttf', 'assets/poppins-medium.ttf', 'assets/Poppins-LICENSE.txt', 'assets/telegram-qr.svg']) await access(resolve(tempLanding, 'dist', file));
    await assert.rejects(access(resolve(tempLanding, 'dist/assets/tokens/usdc.png')));
    await assert.rejects(access(resolve(tempLanding, 'dist/aurora.js')));
    const built = await readFile(resolve(tempLanding, 'dist/index.html'), 'utf8');
    const destinations = [...built.matchAll(/href="(https:\/\/t\.me\/[^\"]*)"/g)].map(([, href]) => href);
    assert.ok(destinations.includes('https://t.me/FxAeonBot/app?startapp=launch_1'));
    for (const route of ['trade', 'earn', 'borrow', 'move']) assert.ok(built.includes(`https://fxaeon.com/${route}`));
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
  const icons = { receive: lucide.ArrowDownToLine, trade: lucide.CandlestickChart, earn: lucide.PiggyBank };
  for (const [name, Icon] of Object.entries(icons)) {
    const rendered = renderToStaticMarkup(react.createElement(Icon, { size: 24, color: '#2973ff', strokeWidth: 2 }));
    assert.equal(await readFile(resolve(root, 'assets/icons', `${name}.svg`), 'utf8'), rendered);
  }
  const normalize = (value) => value.replace(/\r\n?/g, '\n');
  assert.equal(normalize(await readFile(resolve(root, 'assets/icons/LICENSE.txt'), 'utf8')), normalize(await readFile(resolve(licensePath, '../LICENSE'), 'utf8')));
});
