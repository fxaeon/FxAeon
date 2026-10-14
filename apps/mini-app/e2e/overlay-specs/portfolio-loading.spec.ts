import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildPortfolioStatesLab, type PortfolioStatesLab } from '../harness/portfolio-states-build';

/*
 * Portfolio's first load against inline mock providers (see
 * e2e/harness/portfolio-states-build.ts): the provider fallback, the live page
 * while the wallet starts, every read in flight, and settled reads. Each test
 * loads one state per page so module caches never carry between states.
 */
const publicRoot = resolve(__dirname, '../../public');
let lab: PortfolioStatesLab;

test.beforeAll(async () => { lab = await buildPortfolioStatesLab(); });

async function open(page: Page, stage: string, { route = '/portfolio', theme = 'official' } = {}) {
  const html = `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/lab.css"></head>`
    + `<body><div id="root"></div><script>window.__portfolioStates = ${JSON.stringify({ stage, route, theme })};</script><script src="/lab.js"></script></body></html>`;
  await page.route('http://lab.test/**', async (request) => {
    const path = new URL(request.request().url()).pathname;
    if (path === '/') return request.fulfill({ contentType: 'text/html', body: html });
    if (path === '/lab.css') return request.fulfill({ contentType: 'text/css', body: lab.css });
    if (path === '/lab.js') return request.fulfill({ contentType: 'text/javascript', body: lab.script });
    const file = resolve(publicRoot, `.${decodeURIComponent(path)}`);
    if (!existsSync(file)) return request.fulfill({ status: 404, body: '' });
    return request.fulfill({ contentType: extname(file) === '.svg' ? 'image/svg+xml' : 'image/png', body: readFileSync(file) });
  });
  await page.goto('http://lab.test/');
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
}

/** Boxes of the landmarks a reader's eye holds onto while Portfolio loads. */
async function portfolioLandmarks(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null | undefined) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
    };
    const content = document.querySelector('.app-content')!;
    const headings = [...content.querySelectorAll('h1, h2')].filter((heading) => heading.getBoundingClientRect().width > 2);
    return {
      heading: box(content.querySelector('h1')),
      figure: box(content.querySelector('.missing-value-xl .missing-value-bar')),
      actions: [...content.querySelectorAll('[class*="quickAction"] > span')].map(box),
      summaries: [...content.querySelectorAll('details > summary')].map(box),
      sectionHeadings: headings.map(box),
      networkTabs: box(content.querySelector('[class*="networkTabs"]')),
      assetRows: [...content.querySelectorAll('[class*="loadingRow"]')].map(box),
      historyRows: [...content.querySelectorAll('ul li')].map(box),
      marketCards: [...content.querySelectorAll('aside > section:first-child > div:last-child > a')].map(box),
      borrow: box(content.querySelector('[class*="rowGroup"]')),
      topBarActions: box(document.querySelector('.app-topbar-actions')),
      dock: box(document.querySelector('.tabbar')),
    };
  });
}

for (const width of [320, 393, 480, 1280]) {
  test(`the first paint draws Portfolio in the place the live page takes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1700 });
    await open(page, 'provider');
    const fallback = await portfolioLandmarks(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await open(page, 'wallet');
    const live = await portfolioLandmarks(page);
    // Everything below the top bar sits exactly where the live page puts it.
    expect({ ...fallback, topBarActions: null }).toEqual({ ...live, topBarActions: null });
    expect(fallback.figure).not.toBeNull();
    expect(fallback.actions).toHaveLength(4);
    expect(fallback.assetRows).toHaveLength(3);
    expect(fallback.marketCards).toHaveLength(2);
    // The fallback never answers the live page's own lookups (scroll area, market cards).
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await open(page, 'provider');
    expect(await page.locator('.app-content-tabs, .portfolio-market-card, [data-shell-tabs], [data-header-wallet-control]').count()).toBe(0);
    // The wallet control keeps its height; its width only follows the label text.
    expect(fallback.topBarActions![3]).toBe(live.topBarActions![3]);
    expect(Math.abs(fallback.topBarActions![2] - live.topBarActions![2])).toBeLessThanOrEqual(8);
  });
}

test('placeholders hold the loaded figure line, so the page does not move when values land', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 1400 });
  const measure = async (stage: string) => {
    await open(page, stage);
    const result = await page.evaluate(() => {
      const top = (selector: string) => Math.round(document.querySelector(selector)!.getBoundingClientRect().top * 10) / 10;
      return { figure: document.querySelector('[data-portfolio-value]')!.getBoundingClientRect().height, actions: top('[class*="quickActions"]'), assets: top('#portfolio-assets-heading') };
    });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    return result;
  };
  const reads = await measure('reads');
  const loaded = await measure('loaded');
  const unavailable = await measure('unavailable');
  expect(loaded).toEqual(reads);
  expect(unavailable).toEqual(reads);
});

test('a position card lands at its placeholder’s height, with its brake line and side in words', async ({ page }) => {
  const openPositions = async (stage: string) => {
    await open(page, stage);
    await page.getByRole('region', { name: 'Positions' }).locator('summary').click();
    const positions = page.getByRole('region', { name: 'Positions' });
    return positions.locator(stage === 'reads' ? '[aria-label="Loading positions"]' : '[data-position-key]').first();
  };
  for (const width of [320, 393, 480]) {
    await page.setViewportSize({ width, height: 1600 });
    const placeholder = (await (await openPositions('reads')).boundingBox())!.height;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const first = await openPositions('positions');
    await expect(first.locator('[data-position-brake]')).toContainText('Rebalances if ETH falls ≈ 42% (≈ $1,383)');
    expect(Math.abs((await first.boundingBox())!.height - placeholder), `card vs placeholder at ${width}px`).toBeLessThanOrEqual(0.5);
    const short = page.getByRole('region', { name: 'Positions' }).locator('[data-position-key="BTC:short:109"]');
    await expect(short.locator('[data-position-brake]')).toContainText('Rebalances if BTC rises ≈ 28% (≈ $133,714)');
    await expect(short.getByText('Short', { exact: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('screenshots of Portfolio’s positions in every theme', async ({ page }) => {
  const directory = process.env.PORTFOLIO_SCREENS_DIR;
  test.skip(!directory, 'set PORTFOLIO_SCREENS_DIR to keep the screenshots');
  mkdirSync(directory!, { recursive: true });
  for (const theme of ['official', 'dark', 'light'] as const) {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 1600 });
      await open(page, 'positions', { theme });
      const positions = page.getByRole('region', { name: 'Positions' });
      await positions.locator('summary').click();
      await page.waitForTimeout(1_100);
      await positions.screenshot({ path: resolve(directory!, `portfolio-${theme}-${width}-positions.png`), animations: 'disabled' });
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  }
});

test('captures connected, empty, and one-cent home states for visual review', async ({ page }) => {
  const directory = process.env.PORTFOLIO_HOME_SCREENSHOTS_DIR;
  test.skip(!directory, 'set PORTFOLIO_HOME_SCREENSHOTS_DIR to keep the screenshots');
  mkdirSync(directory!, { recursive: true });
  for (const theme of ['official', 'dark'] as const) {
    for (const [name, stage] of [['connected', 'loaded'], ['empty', 'empty'], ['dust', 'dust']] as const) {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, stage, { theme });
      await page.addStyleTag({ content: `
        .app-shell { height: auto !important; max-height: none !important; overflow: visible !important; }
        .app-workspace { min-height: auto !important; overflow: visible !important; }
        .app-content-tabs { flex: none !important; min-height: auto !important; overflow: visible !important; }
        nav.mobile-tabbar { position: static !important; margin-top: 12px !important; }
      ` });
      await page.screenshot({ path: resolve(directory!, `portfolio-${name}-${theme}.png`), fullPage: true, animations: 'disabled' });
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  }
});

test('the live page takes over the first paint without fading in a second time', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await open(page, 'handoff');
  // The fallback itself arrives with the route fade; let that finish first.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.app-content > *')!).opacity)).toBe('1');
  const samples = await page.evaluate(`(async () => {
    const read = () => {
      const content = document.querySelector('.app-content > *');
      const bar = document.querySelector('.missing-value-xl .missing-value-bar');
      return { opacity: Number(getComputedStyle(content).opacity), bar: Math.round(bar.getBoundingClientRect().top) };
    };
    const out = [read()];
    window.__portfolioStates.handoff();
    for (let frame = 0; frame < 10; frame += 1) { await new Promise((done) => requestAnimationFrame(() => done())); out.push(read()); }
    return out;
  })()`) as Array<{ opacity: number; bar: number }>;
  await expect(page.getByRole('button', { name: 'Refresh portfolio balances and positions' })).toBeAttached();
  for (const sample of samples) expect(sample).toEqual(samples[0]);
  expect(samples[0].opacity).toBe(1);
});

test('reads that fail end every placeholder: each section says so with a retry', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 1500 });
  await open(page, 'unavailable');
  await expect(page.getByText('Total unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Portfolio value unavailable', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(2);
  await expect(page.getByText('Couldn’t load balances', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Positions' }).getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="portfolio-earn-heading"]').getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('History couldn’t load. Your transactions are unaffected.', { exact: true })).toBeVisible();
  await expect(page.getByText('Chart unavailable', { exact: true })).toHaveCount(2);
  // Nothing is left shimmering once its read has failed.
  await expect(page.locator('main .missing-value-bar, main .skeleton, main .market-chart-skeleton')).toHaveCount(0);
});

test('an empty wallet is told what is missing and how to start, never shown a placeholder', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 1500 });
  await open(page, 'empty');
  await expect(page.getByText('No assets yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Receive assets' })).toBeVisible();
  await expect(page.getByText('0 fxSAVE on Ethereum', { exact: true })).toBeVisible();
  await expect(page.getByText('No activity yet', { exact: true })).toBeVisible();
  await expect(page.locator('main .missing-value-bar, main .skeleton')).toHaveCount(0);
});

test('a settled empty Positions section is compact while loading and read failures stay visible', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 900 });
  const positions = async (stage: string) => {
    await open(page, stage);
    return page.getByRole('region', { name: 'Positions', exact: true });
  };

  const empty = await positions('empty');
  await expect(empty).toContainText('No open positions');
  await expect(empty.locator('details')).toHaveCount(0);
  expect((await empty.boundingBox())!.height, 'empty Positions stays compressed').toBeLessThanOrEqual(90);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  const loading = await positions('reads');
  await expect(loading.getByRole('status', { name: 'Loading open positions' })).toBeVisible();
  await expect(loading.locator('details')).not.toHaveAttribute('open');
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  const unavailable = await positions('unavailable');
  await expect(unavailable.getByRole('status', { name: 'Positions unavailable' })).toBeVisible();
  await expect(unavailable.locator('details')).not.toHaveAttribute('open');
});

test('the Portfolio network select filters seeded rows and the header balance preserves one cent', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 1400 });
  await open(page, 'loaded');
  const assets = page.getByRole('region', { name: 'Assets', exact: true });
  const network = assets.getByRole('combobox', { name: 'Portfolio network', exact: true });
  const rows = assets.locator('ul > li');
  await expect(rows).toHaveCount(4);
  await network.selectOption('8453');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole('button', { name: 'View ETH on Base', exact: true })).toBeVisible();
  await network.selectOption('1');
  await expect(rows).toHaveCount(3);
  await network.selectOption('all');
  await expect(rows).toHaveCount(4);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  await open(page, 'dust');
  await expect(page.locator('[data-portfolio-value]')).toContainText('$0.01');
  await expect(page.locator('[data-portfolio-value]')).not.toContainText('Total unavailable');
});

test('reduced motion leaves placeholders still and the hero light in place', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 393, height: 1200 });
  await open(page, 'reads');
  const styles = await page.evaluate(() => [...document.querySelectorAll('.skeleton, .missing-value-bar, .market-chart-skeleton')].map((element) => {
    const style = getComputedStyle(element);
    return `${style.animationName}|${style.backgroundImage}`;
  }));
  expect(styles.length).toBeGreaterThan(10);
  expect(new Set(styles)).toEqual(new Set(['none|none']));
  const light = await page.evaluate(() => getComputedStyle(document.querySelector('section[aria-label="Portfolio balance"]')!, '::before').animationName);
  expect(light).toBe('none');
});

for (const theme of ['official', 'light'] as const) {
  test(`the hero light stays inside its card through its drift (${theme})`, async ({ page }) => {
    for (const width of [320, 393, 480, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, 'loaded', { theme });
      for (const phase of [0, 0.5, 1]) {
        await page.addStyleTag({ content: `section[aria-label="Portfolio balance"]::before { animation-delay: ${-11 * phase}s !important; animation-play-state: paused !important; }` });
        const bounds = await page.evaluate(() => {
          const card = document.querySelector('section[aria-label="Portfolio balance"]')!;
          const style = getComputedStyle(card, '::before');
          const rect = card.getBoundingClientRect();
          const left = parseFloat(style.left); const top = parseFloat(style.top);
          const width = parseFloat(style.width); const height = parseFloat(style.height);
          const matrix = new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
          // Transform origin is the box centre.
          const cx = left + width / 2; const cy = top + height / 2;
          const corners = [[left, top], [left + width, top], [left, top + height], [left + width, top + height]]
            .map(([x, y]) => matrix.transformPoint(new DOMPoint(x - cx, y - cy)))
            .map((point) => [point.x + cx, point.y + cy]);
          return { minX: Math.min(...corners.map(([x]) => x)), maxX: Math.max(...corners.map(([x]) => x)), minY: Math.min(...corners.map(([, y]) => y)), cardWidth: rect.width };
        });
        expect(bounds.minX, `left edge at ${width}px, phase ${phase}`).toBeGreaterThanOrEqual(-0.5);
        expect(bounds.maxX, `right edge at ${width}px, phase ${phase}`).toBeLessThanOrEqual(bounds.cardWidth + 0.5);
        expect(bounds.minY, `top edge at ${width}px, phase ${phase}`).toBeGreaterThanOrEqual(-46.5);
      }
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
}

test('History paints its feed in place before the wallet loads', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 900 });
  const measure = async (stage: string) => {
    await open(page, stage, { route: '/history' });
    const result = await page.evaluate(() => ({
      title: (() => { const r = document.querySelector('.app-content h1')!.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })(),
      filters: [...document.querySelectorAll('.app-content select, .app-content input')].map((element) => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }),
      rows: [...document.querySelectorAll('.app-content ul li')].map((element) => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }),
    }));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    return result;
  };
  const fallback = await measure('provider');
  const reads = await measure('reads');
  expect(fallback).toEqual(reads);
  expect(reads.rows).toHaveLength(5);
});
