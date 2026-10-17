import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { buildPositionBrakeLab, type PositionBrakeLab } from '../harness/position-brake-build';

/*
 * Position cards with the real brake provider, reader and card against a fake
 * Ethereum client (see e2e/harness/position-brake-entry.tsx). Set
 * BRAKE_SCREENSHOT_DIR to keep the per-state card screenshots.
 */
const publicRoot = resolve(__dirname, '../../public');
const screenshotDir = process.env.BRAKE_SCREENSHOT_DIR;
const QUOTES = { ETH: 2_444.58, BTC: 81_354.96 };
let lab: PositionBrakeLab;

test.beforeAll(async () => { lab = await buildPositionBrakeLab(); });

type BrakeConfig = { theme?: 'official' | 'dark' | 'light'; scenarios?: string[]; variant?: 'article' | 'link' | 'button'; quotes?: { ETH?: number; BTC?: number }; loading?: boolean; skeleton?: boolean; details?: string };
type HarnessWindow = Window & { __brakeHarness: { calls: Array<Array<{ functionName: string }>>; refresh(): void; setQuote(market: 'ETH' | 'BTC', price: number): void; setRatio(key: string, ratio: string): void; release(): void; setCardsShown(shown: boolean): void } };

async function open(page: Page, config: BrakeConfig) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/lab.css"></head>`
    + `<body><div id="root"></div><script>window.__brakeConfig = ${JSON.stringify(config)};</script><script src="/lab.js"></script></body></html>`;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
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

const card = (page: Page, scenario: string) => page.locator(`section[data-scenario="${scenario}"] [data-position-key]`);
const line = (cardLocator: Locator) => cardLocator.locator('[data-position-brake]');
/** The line as it reads on screen, without its screen-reader-only sentence. */
const shown = (cardLocator: Locator) => expect.poll(() => line(cardLocator).evaluate((element) => {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.sr-only').forEach((hidden) => hidden.remove());
  // "≈" is bound to its figure with a no-break space; compare words, not spacing.
  return copy.textContent?.replace(/\u00a0/g, ' ').trim();
}).catch(() => null));
const multicalls = (page: Page) => page.evaluate(() => (window as unknown as HarnessWindow).__brakeHarness.calls.map((call) => call.map((item) => item.functionName)));

/** Where each marker and the debt fill end, as fractions of the bar's width. */
async function barGeometry(cardLocator: Locator) {
  return cardLocator.locator('[data-position-split]').evaluate((bar) => {
    const box = bar.getBoundingClientRect();
    const centre = (selector: string) => {
      const marker = bar.querySelector(selector);
      if (!marker) return null;
      const rect = marker.getBoundingClientRect();
      return (rect.left + rect.width / 2 - box.left) / box.width;
    };
    const fill = bar.querySelector('[class*="splitDebt"]')!.getBoundingClientRect();
    return { rebalance: centre('[data-brake-marker="rebalance"]'), liquidation: centre('[data-brake-marker="liquidation"]'), fill: fill.width / box.width, state: bar.getAttribute('data-brake') };
  });
}

test('Long and Short cards say how far the market can move, with markers at the pool thresholds', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1600 });
  await open(page, { quotes: QUOTES });
  const long = card(page, 'long');
  await shown(long).toBe('Rebalances if ETH falls ≈ 35% (≈ $1,575)');
  const short = card(page, 'short');
  await shown(short).toBe('Rebalances if BTC rises ≈ 17% (≈ $95,724)');
  await shown(card(page, 'near')).toBe('Rebalances if ETH falls ≈ 1% (≈ $2,407)');
  // Screen readers also hear where liquidation could follow.
  await expect(line(long).locator('.sr-only')).toHaveText('If rebalancing can’t keep up, liquidation becomes possible once ETH falls ≈ 40% (≈ $1,459).');
  await expect(long.locator('[data-position-price="rebalance"]')).toHaveText('≈ $1,575');
  await expect(long.locator('[data-position-price="liquidation"]')).toHaveText('≈ $1,459');

  // Let the draw-in finish before measuring the bars.
  await page.waitForTimeout(1_300);
  const longBar = await barGeometry(long);
  expect(longBar.state).toBe('clear');
  expect(longBar.rebalance!).toBeCloseTo(0.88, 2);
  expect(longBar.liquidation!).toBeCloseTo(0.95, 2);
  expect(longBar.fill).toBeCloseTo(0.5667, 2);
  const shortBar = await barGeometry(short);
  expect(shortBar.rebalance!).toBeCloseTo(0.9, 2);
  expect(shortBar.fill).toBeCloseTo(0.7649, 2);

  const rebalance = card(page, 'rebalance');
  await expect(line(rebalance)).toHaveAttribute('data-tone', 'warn');
  await expect(line(rebalance)).toContainText('At the rebalance point. The protocol may rebalance part of this position.');
  await expect(rebalance.getByRole('link', { name: 'How rebalancing works' })).toHaveAttribute('href', 'https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/rebalancing-the-position-liquidation-brake');
  expect((await barGeometry(rebalance)).state).toBe('rebalance');
  await expect(rebalance.locator('[data-position-price="rebalance"]')).toHaveText('Reached');

  // A failed read omits the line and markers; the split falls back to the valuation.
  const failed = card(page, 'failed');
  await expect(failed.locator('[data-position-price="rebalance"]')).toContainText('Estimated rebalance price unavailable');
  await expect(failed.locator('[data-position-brake], [data-brake-marker], [aria-label="Loading rebalance point"]')).toHaveCount(0);
  const failedBar = await barGeometry(failed);
  expect(failedBar.state).toBeNull();
  expect(failedBar.fill).toBeCloseTo(14_479.43 / (0.264897 * 81_354.96), 2);
  await expect(page.getByText(/≈ 0%|\b0%/)).toHaveCount(0);
});

test('the fill and the line follow the live quote between chain reads', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1200 });
  await open(page, { quotes: QUOTES, scenarios: ['long', 'short'] });
  const long = card(page, 'long');
  await shown(long).toBe('Rebalances if ETH falls ≈ 35% (≈ $1,575)');
  await page.waitForTimeout(1_300);
  const before = await barGeometry(long);
  const reads = (await multicalls(page)).length;

  await page.evaluate(() => (window as unknown as HarnessWindow).__brakeHarness.setQuote('ETH', 2_444.58 * 0.8));
  await shown(long).toBe('Rebalances if ETH falls ≈ 19% (≈ $1,575)');
  await page.waitForTimeout(600);
  const after = await barGeometry(long);
  expect(after.fill).toBeGreaterThan(before.fill + 0.1);
  expect(after.fill).toBeCloseTo(0.7083, 2);
  expect(after.rebalance!).toBeCloseTo(0.88, 2);

  await page.evaluate(() => (window as unknown as HarnessWindow).__brakeHarness.setQuote('ETH', 1_560));
  await expect(line(long)).toContainText('At the rebalance point.');
  await expect(line(long)).toHaveAttribute('data-tone', 'warn');
  await page.evaluate(() => (window as unknown as HarnessWindow).__brakeHarness.setQuote('BTC', 81_354.96 * 1.1));
  await shown(card(page, 'short')).toBe('Rebalances if BTC rises ≈ 6% (≈ $95,724)');
  // Price movement alone never reads the chain.
  expect((await multicalls(page)).length).toBe(reads);
});

test('reads follow the position refresh: thresholds once, then one multicall per refresh', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1200 });
  await open(page, { quotes: QUOTES, scenarios: ['long', 'short', 'ethShort'] });
  await shown(card(page, 'ethShort')).toBe('Rebalances if ETH rises ≈ 47% (≈ $3,596)');
  expect(await multicalls(page)).toEqual([
    ['getRebalanceRatios', 'getLiquidateRatios', 'priceOracle', 'getRebalanceRatios', 'getLiquidateRatios', 'priceOracle', 'getRebalanceRatios', 'getLiquidateRatios', 'priceOracle'],
    ['getPositionDebtRatio', 'getPositionDebtRatio', 'getPositionDebtRatio', 'getPrice', 'getPrice', 'getPrice'],
  ]);

  await page.evaluate(() => (window as unknown as HarnessWindow).__brakeHarness.refresh());
  await expect.poll(async () => (await multicalls(page)).length).toBe(3);
  expect((await multicalls(page))[2]).toEqual(['getPositionDebtRatio', 'getPositionDebtRatio', 'getPositionDebtRatio', 'getPrice', 'getPrice', 'getPrice']);

  // Without a card on screen nothing is read; a card returning catches up once.
  await page.evaluate(() => (window as unknown as HarnessWindow).__brakeHarness.setCardsShown(false));
  await page.evaluate(() => (window as unknown as HarnessWindow).__brakeHarness.refresh());
  await page.waitForTimeout(300);
  expect((await multicalls(page)).length).toBe(3);
  await page.evaluate(() => (window as unknown as HarnessWindow).__brakeHarness.setCardsShown(true));
  await expect.poll(async () => (await multicalls(page)).length).toBe(4);
  await page.waitForTimeout(300);
  expect((await multicalls(page)).length).toBe(4);
});

test('a failed refresh keeps the last read until it ages out, then the line goes', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 900 });
  await open(page, { scenarios: ['long'] });
  const long = card(page, 'long');
  // Without a live quote the line keeps the chain read's distance and names no price.
  await shown(long).toBe('Rebalances if ETH falls ≈ 35%');
  await page.evaluate(() => {
    const harness = (window as unknown as HarnessWindow).__brakeHarness;
    harness.setRatio('long', 'fail');
    harness.refresh();
  });
  await expect.poll(async () => (await multicalls(page)).length).toBe(3);
  await shown(long).toBe('Rebalances if ETH falls ≈ 35%');
  await page.clock.fastForward(121_000);
  await expect(long.locator('[data-position-brake], [data-brake-marker]')).toHaveCount(0);
  await expect(long.locator('[data-position-split]')).toHaveCount(1);
});

test('the loading card reserves the line, so the skeleton, the read in flight and the loaded card match', async ({ page }) => {
  // Figures short enough for one line each, so only the placeholders differ.
  for (const width of [320, 390, 480]) {
    await page.setViewportSize({ width, height: 1400 });
    await open(page, { quotes: QUOTES, scenarios: ['tidy'], skeleton: true, loading: true });
    const skeleton = page.locator('section[data-scenario="skeleton"] [role="status"]');
    const reading = card(page, 'tidy');
    await expect(reading.getByRole('status', { name: 'Loading rebalance point' })).toBeVisible();
    const skeletonHeight = (await skeleton.boundingBox())!.height;
    const readingHeight = (await reading.boundingBox())!.height;
    await page.evaluate(() => (window as unknown as HarnessWindow).__brakeHarness.release());
    await expect(line(reading)).toBeVisible();
    const loadedHeight = (await reading.boundingBox())!.height;
    expect(Math.abs(readingHeight - loadedHeight), `in flight vs loaded at ${width}px`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(skeletonHeight - loadedHeight), `skeleton vs loaded at ${width}px`).toBeLessThanOrEqual(0.5);
  }
});

test('cards fit every phone width, and interactive cards never nest a link', async ({ page }) => {
  for (const variant of ['article', 'link', 'button'] as const) {
    for (const width of [320, 360, 390, 480]) {
      await page.setViewportSize({ width, height: 1800 });
      await open(page, { quotes: QUOTES, variant });
      const overflow = await page.evaluate(() => [...document.querySelectorAll('[data-position-key]')].map((element) => element.scrollWidth - element.clientWidth));
      expect(Math.max(...overflow), `${variant} at ${width}px`).toBeLessThanOrEqual(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    const rebalance = card(page, 'rebalance');
    expect(await rebalance.locator('a').count()).toBe(variant === 'article' ? 1 : 0);
    if (variant !== 'article') await expect(line(rebalance)).toHaveAttribute('title', /^How rebalancing works: https:\/\/fxprotocol\.gitbook\.io\//);
  }
});

test('the side is plain text in its colour, with AA contrast in dark appearance', async ({ page }) => {
  for (const theme of ['dark'] as const) {
    await page.setViewportSize({ width: 390, height: 1200 });
    await open(page, { quotes: QUOTES, theme, scenarios: ['long', 'short', 'rebalance'] });
    const sides = await page.evaluate(() => {
      const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const luminance = (color: string) => {
        const [r, g, b] = color.match(/[\d.]+/g)!.map(Number);
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
      // Rows have no box of their own: measure against what they sit on.
      const backdrop = (element: Element | null): string => {
        for (let node = element; node; node = node.parentElement) {
          const color = getComputedStyle(node).backgroundColor;
          if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
        }
        return 'rgb(255, 255, 255)';
      };
      return [...document.querySelectorAll('[data-position-key]')].flatMap((element) => {
        const surface = backdrop(element);
        const side = element.querySelector('[class*="marketLine"] > span:last-child')!;
        const brake = element.querySelector('[data-position-brake]');
        const style = getComputedStyle(side);
        return [{ text: side.textContent, contrast: contrast(style.color, surface), background: style.backgroundColor, radius: style.borderTopLeftRadius, padding: style.paddingLeft,
          brake: brake ? contrast(getComputedStyle(brake).color, surface) : null }];
      });
    });
    expect(sides.map((side) => side.text)).toEqual(['Long', 'Short', 'Long']);
    for (const side of sides) {
      expect(side.background, theme).toBe('rgba(0, 0, 0, 0)');
      expect(side.radius, theme).toBe('0px');
      expect(side.padding, theme).toBe('0px');
      expect(side.contrast, `${side.text} in ${theme}`).toBeGreaterThanOrEqual(4.5);
      expect(side.brake!, `brake line in ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('reduced motion keeps the split still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 900 });
  await open(page, { quotes: QUOTES, scenarios: ['long'] });
  await expect(line(card(page, 'long'))).toBeVisible();
  const motion = await card(page, 'long').evaluate((element) => [...element.querySelectorAll('[data-position-split] *')].map((node) => {
    const style = getComputedStyle(node);
    return { animation: style.animationName, transition: style.transitionDuration.split(',').map((value) => parseFloat(value)) };
  }));
  for (const item of motion) {
    expect(item.animation).toBe('none');
    expect(Math.max(...item.transition)).toBeLessThan(0.001);
  }
});

test('screenshots of each state at phone widths in dark appearance', async ({ page }) => {
  test.skip(!screenshotDir, 'set BRAKE_SCREENSHOT_DIR to keep the screenshots');
  mkdirSync(screenshotDir!, { recursive: true });
  for (const theme of ['dark'] as const) {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 2200 });
      await open(page, { quotes: QUOTES, theme, scenarios: ['long', 'short', 'near', 'rebalance', 'failed'], skeleton: true, details: 'rebalance' });
      await page.waitForTimeout(1_300);
      for (const scenario of ['skeleton', 'loading', 'details', 'long', 'short', 'near', 'rebalance', 'failed']) {
        await page.locator(`section[data-scenario="${scenario}"]`).screenshot({ path: resolve(screenshotDir!, `brake-${theme}-${width}-${scenario}.png`), animations: 'disabled' });
      }
    }
  }
});
