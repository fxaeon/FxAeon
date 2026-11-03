import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { buildPortfolioStatesLab, type PortfolioStatesLab } from '../harness/portfolio-states-build';
import { USD_PRICE_MAX_AGE_MS } from '../../src/lib/prices';

/*
 * Portfolio's first load against inline mock providers (see
 * e2e/harness/portfolio-states-build.ts): the provider fallback, the live page
 * while the wallet starts, every read in flight, and settled reads. Each test
 * loads one state per page so module caches never carry between states.
 */
const publicRoot = resolve(__dirname, '../../public');
let lab: PortfolioStatesLab;

test.beforeAll(async () => {
  // Bundling the real portfolio graph can exceed the per-interaction deadline.
  test.setTimeout(120_000);
  lab = await buildPortfolioStatesLab();
});

async function open(page: Page, stage: string, { route = '/portfolio', theme = 'dark', waitForFrame = true } = {}) {
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
  // The harness flag follows root.render(), before React necessarily commits.
  // Wait for its content to request the fonts before awaiting their readiness.
  await expect(page.locator('.app-content')).toBeVisible();
  await page.evaluate(async waitForFrame => {
    await document.fonts.ready;
    if (waitForFrame) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }, waitForFrame);
}

/** Identity changes may replace content; the app chrome must stay put. */
async function portfolioLandmarks(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null | undefined) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
    };
    return {
      topBar: box(document.querySelector('.app-topbar')),
      content: box(document.querySelector('.app-content')),
      topBarActions: box(document.querySelector('.app-topbar-actions')),
      dock: box(document.querySelector('.tabbar')),
    };
  });
}

for (const width of [320, 393, 480, 1280]) {
  test(`public Explore waits for resolved disconnection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1700 });
    for (const stage of ['provider', 'wallet', 'hydrating', 'disconnected']) {
      await open(page, stage);
      if (stage === 'disconnected') {
        await expect(page.locator('[data-portfolio-explore]')).toBeVisible();
        await expect(page.locator('#portfolio-explore-heading')).toContainText('moves with you.');
        await expect(page.locator('[data-product]')).toHaveCount(4);
        await expect(page.locator('[data-portfolio-value], [aria-label="Portfolio views"], [class*="quickActions"]')).toHaveCount(0);
      } else {
        await expect(page.locator('[data-portfolio-explore]')).toHaveCount(0);
        await expect(page.locator('[data-wallet-startup]')).toBeVisible();
        await expect(page.locator('.app-content [data-portfolio-value], .app-content .skeleton, [aria-label="Portfolio views"], [class*="quickActions"]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toHaveCount(0);
      }
      const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
}

test('provider and wallet hydration reach the account without a disconnected frame', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await open(page, 'handoff');
  await page.evaluate(`window.__disconnectedFrames = []; new MutationObserver(() => {
    if (document.querySelector('[data-portfolio-explore]')) window.__disconnectedFrames.push(window.__portfolioStates.stage);
  }).observe(document.getElementById('root'), { childList: true, subtree: true }); window.__portfolioStates.handoff();`);
  for (const stage of ['wallet', 'hydrating', 'restoring', 'reads', 'loaded']) {
    await page.evaluate(`window.__portfolioStates.transition(${JSON.stringify(stage)})`);
    await expect(page.locator('html')).toHaveAttribute('data-portfolio-stage', stage);
    await expect(page.locator('[data-portfolio-explore]')).toHaveCount(0);
    if (stage === 'loaded') await expect(page.locator('[data-portfolio-value]')).toContainText('$');
    else if (stage === 'reads') await expect(page.locator('[data-portfolio-value] .missing-value-bar')).toBeVisible();
    else {
      await expect(page.locator('[data-wallet-startup]')).toBeVisible();
      await expect(page.locator('[data-portfolio-value], [aria-label="Portfolio views"]')).toHaveCount(0);
    }
    if (stage === 'wallet' || stage === 'hydrating' || stage === 'restoring') {
      await expect(page.getByText('Loading wallet', { exact: true })).toBeAttached();
    }
  }
  expect(await page.evaluate('window.__disconnectedFrames')).toEqual([]);
  await page.evaluate(`window.__portfolioStates.transition('disconnected')`);
  await expect(page.locator('[data-portfolio-explore]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeVisible();
});

test('unresolved wallet timeout offers recovery and later resolved disconnection remains usable', async ({ page }) => {
  await open(page, 'timeout');
  await expect(page.getByText('Your wallet didn’t load', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page.locator('[data-portfolio-explore]')).toHaveCount(0);
  await page.evaluate(`window.__portfolioStates.transition('disconnected')`);
  await expect(page.locator('[data-portfolio-explore]')).toBeVisible();
  await expect(page.getByText('Your wallet didn’t load', { exact: true })).toHaveCount(0);
});

async function pauseStartupClock(page: Page) {
  await page.clock.install({ time: new Date('2026-11-04T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-04T00:01:00Z'));
}

test('instant connected reads complete without a portfolio skeleton frame', async ({ page }) => {
  await pauseStartupClock(page);
  await open(page, 'reads', { waitForFrame: false });
  await expect(page.locator('[data-portfolio-state="connected-loading"]')).toBeVisible();
  await expect(page.locator('[data-portfolio-value], .app-content .skeleton')).toHaveCount(0);
  await page.evaluate(`window.__skeletonFrames = []; new MutationObserver(() => {
    if (document.querySelector('.app-content .skeleton, .app-content .missing-value-bar')) window.__skeletonFrames.push('skeleton');
  }).observe(document.getElementById('root'), { childList: true, subtree: true });`);
  await page.clock.runFor(40);
  await page.evaluate(`window.__portfolioStates.transition('loaded')`);
  await expect(page.locator('[data-portfolio-state="connected-ready"]')).toBeVisible();
  await expect(page.locator('[data-portfolio-value]')).toContainText('$');
  expect(await page.evaluate('window.__skeletonFrames')).toEqual([]);
});

test('only a slow verified connection reveals a skeleton and completion never waits', async ({ page }) => {
  await pauseStartupClock(page);
  await open(page, 'reads', { waitForFrame: false });
  await expect(page.locator('[data-wallet-startup]')).toBeVisible();
  await expect(page.locator('[data-portfolio-value]')).toHaveCount(0);
  await page.clock.runFor(161);
  await expect(page.locator('[data-portfolio-value] .missing-value-bar')).toBeVisible();
  await page.evaluate(`window.__portfolioStates.transition('loaded')`);
  await expect(page.locator('[data-portfolio-state="connected-ready"]')).toBeVisible();
  await expect(page.locator('[data-portfolio-value] .missing-value-bar')).toHaveCount(0);
});

test('resolved disconnected, populated, empty and failed reads select their own portfolio state', async ({ page }) => {
  for (const [stage, state] of [['wallet', 'unknown'], ['disconnected', 'disconnected'], ['reads', 'connected-loading'],
    ['loaded', 'connected-ready'], ['empty', 'connected-empty'], ['unavailable', 'connected-error']]) {
    await open(page, stage);
    await expect(page.locator(`[data-portfolio-state="${state}"]`)).toBeVisible();
    if (state === 'unknown' || state === 'disconnected') {
      await expect(page.locator('[data-portfolio-value], [aria-label="Portfolio views"]')).toHaveCount(0);
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('account and network changes retire old totals and ignore late account reads', async ({ page }) => {
  await open(page, 'loaded');
  await expect(page.locator('[data-portfolio-state="connected-ready"]')).toBeVisible();
  await expect(page.locator('[data-portfolio-value]')).toContainText('$9,900.00');
  await page.evaluate(`window.__portfolioStates.transition('reads', { address: '0x2222222222222222222222222222222222222222' })`);
  await expect(page.locator('[data-portfolio-state="connected-loading"]')).toBeVisible();
  await expect(page.locator('.app-content')).not.toContainText('$9,900.00');
  await expect.poll(() => page.evaluate('typeof window.__portfolioStates.settleReads')).toBe('function');
  await page.evaluate(`window.__latePortfolioRead = window.__portfolioStates.settleReads;
    window.__portfolioStates.transition('empty', { address: '0x3333333333333333333333333333333333333333' });`);
  await expect(page.locator('[data-portfolio-state="connected-empty"]')).toBeVisible();
  await page.evaluate(`const state = window.__portfolioStates; const stage = state.stage;
    state.stage = 'loaded'; window.__latePortfolioRead(); state.stage = stage;`);
  await expect(page.locator('[data-portfolio-state="connected-empty"]')).toBeVisible();
  await expect(page.locator('[data-portfolio-value]')).toContainText('$0.00');
  await page.getByRole('tab', { name: 'DeFi', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Savings', exact: true }).getByRole('link', { name: 'Deposit', exact: true })).toBeVisible();
  await page.evaluate(`window.__portfolioStates.transition('reads', { chainId: 8453 })`);
  await expect(page.locator('[data-portfolio-state="connected-loading"]')).toBeVisible();
  await expect(page.locator('.app-content')).not.toContainText('$9,900.00');
  await page.evaluate(`window.__portfolioStates.transition('empty')`);
  await expect(page.locator('[data-portfolio-state="connected-empty"]')).toBeVisible();
});

test('captures deterministic phone wallet readiness for review', async ({ page }) => {
  const directory = process.env.PORTFOLIO_READINESS_SCREENSHOTS_DIR;
  test.skip(!directory, 'set PORTFOLIO_READINESS_SCREENSHOTS_DIR to keep screenshots');
  mkdirSync(directory!, { recursive: true });
  await page.setViewportSize({ width: 393, height: 852 });
  for (const [name, stage] of [['neutral-provider', 'provider'], ['neutral-loading', 'wallet'], ['disconnected', 'disconnected'], ['connected-loading', 'reads'], ['connected', 'loaded'], ['empty', 'empty'], ['error', 'unavailable']]) {
    await open(page, stage);
    if (stage === 'loaded') await expect(page.locator('[data-portfolio-value]')).toContainText('$');
    else if (stage === 'disconnected') await expect(page.locator('[data-portfolio-explore]')).toBeVisible();
    else if (stage === 'provider' || stage === 'wallet') await expect(page.locator('[data-wallet-startup]')).toBeVisible();
    else if (stage === 'reads') await expect(page.locator('[data-portfolio-value] .missing-value-bar')).toBeVisible();
    else await expect(page.locator('[data-portfolio-value]')).toBeVisible();
    await page.screenshot({ path: resolve(directory!, `${name}.png`), animations: 'disabled',
      mask: [page.getByRole('button', { name: 'Open wallet profile', exact: true })], maskColor: '#242428' });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('connected wallet profile keeps its action rows accessible across widths', async ({ page }, info) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await open(page, 'loaded');
    const trigger = page.getByRole('button', { name: 'Open wallet profile', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (const name of ['Positions', 'History', 'Settings']) {
      const row = dialog.getByRole('link', { name: new RegExp(`^${name}`) });
      await row.scrollIntoViewIfNeeded();
      const box = await row.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    await page.screenshot({ path: info.outputPath(`wallet-actions-${width}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('a known returning wallet waits for verification and then shows its account', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await open(page, 'restoring');
  await expect(page.locator('[data-portfolio-explore]')).toHaveCount(0);
  await expect(page.locator('[data-wallet-startup]')).toBeVisible();
  await expect(page.locator('[data-portfolio-value], [aria-label="Portfolio views"]')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await open(page, 'reads');
  await expect(page.locator('[data-portfolio-explore]')).toHaveCount(0);
  await expect(page.locator('.missing-value-xl .missing-value-bar')).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await open(page, 'loaded');
  await expect(page.locator('[data-portfolio-explore]')).toHaveCount(0);
  await expect(page.locator('[data-portfolio-value]')).toContainText('$');
});

test('placeholders hold the loaded figure line, so the page does not move when values land', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 1400 });
  const measure = async (stage: string) => {
    await open(page, stage);
    await expect(page.locator('[data-portfolio-value]')).toBeVisible();
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

test('compact position rows expand into accounting and numeric risk thresholds without mobile overflow', async ({ page }) => {
  const assertFits = async (position: Locator) => {
    const geometry = await position.evaluate(element => {
      const summary = element.querySelector('summary')!;
      const row = element.getBoundingClientRect();
      const children = [...summary.children].map(node => node.getBoundingClientRect());
      const [icon, identity, value, chevron] = children;
      return {
        width: row.width,
        summaryHeight: summary.getBoundingClientRect().height,
        childBounds: children.map(rect => ({ left: rect.left - row.left, right: rect.right - row.left, width: rect.width })),
        summaryFits: children.every(rect => rect.left >= row.left - 1 && rect.right <= row.right + 1),
        identityBeforeValue: identity.right <= value.left + 1,
        valueBeforeChevron: value.right <= chevron.left + 1,
        iconBeforeIdentity: icon.right <= identity.left + 1,
        factsFit: [...element.querySelectorAll('dl > div')].every(fact => {
          const cell = fact.getBoundingClientRect();
          const label = fact.querySelector('dt')!.getBoundingClientRect();
          const value = fact.querySelector('dd')!;
          const rect = value.getBoundingClientRect();
          return cell.left >= row.left - 1 && cell.right <= row.right + 1
            && rect.top >= label.bottom - 1 && rect.left >= cell.left - 1
            && rect.right <= cell.right + 1 && value.scrollWidth <= value.clientWidth + 1;
        }),
      };
    });
    expect(geometry.summaryHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.summaryHeight, 'the collapsed identity stays a compact row').toBeLessThanOrEqual(140);
    expect(geometry.summaryFits, JSON.stringify(geometry)).toBe(true);
    expect(geometry.identityBeforeValue, JSON.stringify(geometry)).toBe(true);
    expect(geometry.valueBeforeChevron, JSON.stringify(geometry)).toBe(true);
    expect(geometry.iconBeforeIdentity, JSON.stringify(geometry)).toBe(true);
    expect(geometry.factsFit, JSON.stringify(geometry)).toBe(true);
    const pageGeometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      content: [...document.querySelectorAll('.app-content')].map(content => ({ width: content.clientWidth, scrollWidth: content.scrollWidth })),
      overflow: [...document.querySelectorAll('.app-content *')].filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.right > window.innerWidth + 1;
      }).map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right })).slice(0, 10),
    }));
    expect(pageGeometry.document <= pageGeometry.viewport && pageGeometry.content.every(content => content.scrollWidth <= content.width + 1), JSON.stringify(pageGeometry)).toBe(true);
    return geometry;
  };
  const openPositions = async (stage: string, inset: number) => {
    await open(page, stage);
    await page.getByRole('tab', { name: 'DeFi', exact: true }).click();
    // Exercise the narrower column a non-overlay scrollbar can leave behind.
    if (inset) await page.addStyleTag({ content: `.app-shell { width: calc(100% - ${inset}px); }` });
    const positions = page.getByRole('region', { name: 'Positions' });
    return positions.locator(stage === 'reads' ? '[aria-label="Loading positions"]' : '[data-position-key]').first();
  };
  for (const [width, inset] of [[320, 0], [320, 15], [393, 0], [480, 0], [1280, 0]]) {
    await page.setViewportSize({ width, height: 1600 });
    const placeholder = await openPositions('reads', inset);
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toHaveAttribute('data-portfolio-position-skeleton', 'true');
    const placeholderBox = (await placeholder.boundingBox())!;
    expect(placeholderBox.height, 'the waiting position uses one compact row').toBeLessThanOrEqual(90);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const first = await openPositions('positions', inset);
    const firstSummary = first.locator('summary');
    await expect(firstSummary).toHaveAttribute('aria-label', 'ETH Long position #2033 details');
    await expect(firstSummary).toHaveAccessibleDescription(/Position value.*\$2,900\.00/);
    await expect(firstSummary.getByText('ETH Long', { exact: true })).toBeVisible();
    await expect(first).toHaveJSProperty('open', false);
    await expect(first.locator('[data-position-price]')).toHaveCount(0);
    const positionsRegion = page.getByRole('region', { name: 'Positions', exact: true });
    const collapsed = await assertFits(first);
    expect(Math.abs(collapsed.width - placeholderBox.width), `position width at ${width}px, ${inset}px inset`).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsed.summaryHeight - placeholderBox.height), `position height at ${width}px, ${inset}px inset`).toBeLessThanOrEqual(0.5);
    await firstSummary.focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveJSProperty('open', true);
    await expect(first.locator('dl')).toBeVisible();
    await expect(first.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Collateral$/ }) })).toContainText('2.5 stETH');
    await expect(first.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Debt$/ }) })).toContainText('3,100 fxUSD');
    await expect(first.locator('[data-position-price="rebalance"]')).toHaveText('≈ $1,383');
    await expect(first.locator('[data-position-price="liquidation"]')).toHaveText('≈ $1,281');
    await expect(first.getByRole('link', { name: 'Manage position', exact: true })).toHaveAttribute('href', '/positions?position=ETH%3Along%3A2033');
    await assertFits(first);
    await firstSummary.focus();
    await page.keyboard.press('Space');
    await expect(first).toHaveJSProperty('open', false);
    await expect(first.locator('dl, [data-position-price]')).toHaveCount(0);
    const short = page.getByRole('region', { name: 'Positions' }).locator('[data-position-key="BTC:short:109"]');
    await expect(short.locator('summary')).toHaveAttribute('aria-label', 'BTC Short position #109 details');
    await expect(short.locator('summary')).toHaveAccessibleDescription(/Position value.*\$3,560\.00/);
    await expect(short.getByText('BTC Short', { exact: true })).toBeVisible();
    await short.locator('summary').click();
    await expect(short.locator('[data-position-price="rebalance"]')).toHaveText('≈ $133,714');
    await expect(short.locator('[data-position-price="liquidation"]')).toHaveText('≈ $141,142');
    await expect(short.getByRole('link', { name: 'Manage position', exact: true })).toHaveAttribute('href', '/positions?position=BTC%3Ashort%3A109');
    await assertFits(short);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('expanding a position never revives dollar values from expired provider quotes', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-18T00:00:00Z') });
  await page.setViewportSize({ width: 393, height: 1400 });
  await open(page, 'positions');
  await page.getByRole('tab', { name: 'DeFi', exact: true }).click();
  const position = page.getByRole('region', { name: 'Positions', exact: true }).locator('[data-position-key="ETH:long:2033"]');
  const summary = position.locator('summary');
  await expect(summary).toHaveAccessibleDescription(/Position value.*\$2,900\.00/);
  const quotedAt = await page.evaluate(() => Date.now());
  // Advance the freshness clock without fabricating a provider refresh. The
  // disclosure interaction rerenders this row against the retained snapshot.
  await page.clock.setSystemTime(new Date(quotedAt + USD_PRICE_MAX_AGE_MS + 1));
  await summary.click();
  await expect(position.locator('dl')).toBeVisible();
  for (const label of ['Position value', 'Collateral value', 'Debt value']) {
    await expect(position.getByRole('status', { name: `${label} unavailable`, exact: true })).toBeVisible();
  }
  await expect(summary).not.toContainText('$2,900.00');
  await expect(position.locator('dl')).toContainText('2.5 stETH');
  await expect(position.locator('dl')).toContainText('3,100 fxUSD');
});

test('screenshots of Portfolio’s positions in dark appearance', async ({ page }) => {
  const directory = process.env.PORTFOLIO_SCREENS_DIR;
  test.skip(!directory, 'set PORTFOLIO_SCREENS_DIR to keep the screenshots');
  mkdirSync(directory!, { recursive: true });
  for (const theme of ['dark'] as const) {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 1600 });
      await open(page, 'positions', { theme });
      await page.getByRole('tab', { name: 'DeFi', exact: true }).click();
      const positions = page.getByRole('region', { name: 'Positions' });
      await page.waitForTimeout(1_100);
      await positions.screenshot({ path: resolve(directory!, `portfolio-${theme}-${width}-positions.png`), animations: 'disabled' });
      await positions.locator('[data-position-key="ETH:long:2033"] > summary').click();
      await expect(positions.locator('[data-position-price="rebalance"]').first()).toBeVisible();
      await positions.screenshot({ path: resolve(directory!, `portfolio-${theme}-${width}-positions-expanded.png`), animations: 'disabled' });
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  }
});

test('captures connected, empty, and one-cent home states for visual review', async ({ page }) => {
  const directory = process.env.PORTFOLIO_HOME_SCREENSHOTS_DIR;
  test.skip(!directory, 'set PORTFOLIO_HOME_SCREENSHOTS_DIR to keep the screenshots');
  mkdirSync(directory!, { recursive: true });
  for (const theme of ['dark'] as const) {
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
  const firstPaint = await portfolioLandmarks(page);
  const samples = await page.evaluate(`(async () => {
    const read = () => {
      const content = document.querySelector('.app-content > *');
      const bar = document.querySelector('.app-topbar');
      return { opacity: Number(getComputedStyle(content).opacity), bar: Math.round(bar.getBoundingClientRect().top) };
    };
    const out = [read()];
    window.__portfolioStates.handoff();
    for (let frame = 0; frame < 10; frame += 1) { await new Promise((done) => requestAnimationFrame(() => done())); out.push(read()); }
    return out;
  })()`) as Array<{ opacity: number; bar: number }>;
  await expect(page.locator('[data-portfolio-explore]')).toHaveCount(0);
  expect(await portfolioLandmarks(page), 'unknown identity retains app-shell geometry without an account layout').toEqual(firstPaint);
  for (const sample of samples) expect(sample).toEqual(samples[0]);
  expect(samples[0].opacity).toBe(1);
});

test('reads that fail end every placeholder: each section says so with a retry', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 1500 });
  await open(page, 'unavailable');
  await expect(page.getByRole('status', { name: 'Portfolio value unavailable', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(1);
  await expect(page.getByText('Couldn’t load balances', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'DeFi', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Positions' }).getByRole('status', { name: 'Couldn’t load positions. Your funds are unaffected.', exact: true })).toBeVisible();
  const savings = page.getByRole('region', { name: 'Savings', exact: true });
  await expect(savings.getByText('Couldn’t load fxSAVE', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('Couldn’t load history', { exact: true })).toBeVisible();
  // Nothing is left shimmering once its read has failed.
  await expect(page.locator('main .missing-value-bar, main .skeleton')).toHaveCount(0);
});

test('partial prices stay attached to the affected token and do not obscure the balance headline', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 1200 });
  await open(page, 'partial');
  const balance = page.getByRole('region', { name: 'Portfolio balance', exact: true });
  await expect(balance.getByRole('status', { name: 'Portfolio value unavailable', exact: true })).toBeVisible();
  const assets = page.getByRole('region', { name: 'Wallet assets', exact: true });
  const fxUsd = assets.getByRole('button', { name: 'View fxUSD on Ethereum', exact: true });
  await expect(fxUsd).toBeVisible();
  await expect(fxUsd.getByRole('status', { name: 'Holding value unavailable', exact: true })).toBeVisible();
});

test('an empty wallet is told what is missing and how to start, never shown a placeholder', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 1500 });
  await open(page, 'empty');
  await expect(page.getByText('No assets yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Receive assets' })).toBeVisible();
  await page.getByRole('tab', { name: 'DeFi', exact: true }).click();
  const savings = page.getByRole('region', { name: 'Savings', exact: true });
  await expect(savings.getByRole('link', { name: 'Deposit', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('No activity yet', { exact: true })).toBeVisible();
  await expect(page.locator('main .missing-value-bar, main .skeleton')).toHaveCount(0);
});

test('a settled empty Positions section is compact while loading and read failures stay visible', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 900 });
  const positions = async (stage: string) => {
    await open(page, stage);
    await page.getByRole('tab', { name: 'DeFi', exact: true }).click();
    return page.getByRole('region', { name: 'Positions', exact: true });
  };

  const empty = await positions('empty');
  await expect(empty).toContainText('No open positions');
  await expect(empty.locator('details')).toHaveCount(0);
  await expect(empty.getByRole('link', { name: 'Open trade', exact: true })).toHaveAttribute('href', '/trade');
  expect((await empty.boundingBox())!.height, 'empty Positions includes its start action without a large card').toBeLessThanOrEqual(128);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  const loading = await positions('reads');
  await expect(loading.getByRole('status', { name: 'Loading positions', exact: true })).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  const unavailable = await positions('unavailable');
  await expect(unavailable.getByRole('status', { name: 'Couldn’t load positions. Your funds are unaffected.', exact: true })).toBeVisible();
  await expect(unavailable.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});

test('the Portfolio network menu filters seeded rows and the balance headline preserves one cent', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 1400 });
  await open(page, 'loaded');
  const assets = page.getByRole('region', { name: 'Wallet assets', exact: true });
  const network = page.getByRole('button', { name: /^Portfolio network:/ });
  const selectNetwork = async (name: 'Base' | 'Ethereum' | 'All networks') => {
    await network.click();
    const menu = page.getByRole('menu', { name: 'Filter by network', exact: true });
    await menu.getByRole('menuitemradio', { name, exact: true }).click();
    await expect(network).toHaveAccessibleName(`Portfolio network: ${name}`);
    await expect(menu).toHaveCount(0);
  };
  const rows = assets.locator('ul > li');
  await expect(rows).toHaveCount(4);
  await selectNetwork('Base');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole('button', { name: 'View ETH on Base', exact: true })).toBeVisible();
  await selectNetwork('Ethereum');
  await expect(rows).toHaveCount(3);
  await selectNetwork('All networks');
  await expect(rows).toHaveCount(4);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  await open(page, 'dust');
  await expect(page.locator('[data-portfolio-value]')).toContainText('$0.01');
  await expect(page.getByRole('status', { name: 'Portfolio value unavailable', exact: true })).toHaveCount(0);
  const smallHoldings = page.getByRole('region', { name: 'Wallet assets', exact: true }).locator('details').filter({ has: page.locator('summary', { hasText: 'Low-value assets (1)' }) });
  await expect(smallHoldings).toHaveJSProperty('open', true);
  await expect(smallHoldings.getByRole('button', { name: 'View USDC on Ethereum', exact: true })).toBeVisible();
});

test('reduced motion leaves Portfolio placeholders still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 393, height: 1200 });
  await open(page, 'reads');
  await expect(page.getByRole('status', { name: 'Loading assets', exact: true })).toBeVisible();
  const styles = await page.evaluate(() => [...document.querySelectorAll('.skeleton, .missing-value-bar')].map((element) => {
    const style = getComputedStyle(element);
    return `${style.animationName}|${style.backgroundImage}`;
  }));
  expect(styles.length).toBeGreaterThan(10);
  expect(new Set(styles)).toEqual(new Set(['none|none']));
  const light = await page.evaluate(() => getComputedStyle(document.querySelector('section[aria-label="Portfolio balance"]')!, '::before').animationName);
  expect(light).toBe('none');
});

test('History paints its feed in place before the wallet loads', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 900 });
  const measure = async (stage: string) => {
    await open(page, stage, { route: '/history' });
    const result = await page.evaluate(() => ({
      title: (() => { const r = document.querySelector('.app-content h1')!.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })(),
      filters: [...document.querySelectorAll('.app-content [role="combobox"], .app-content input')].map((element) => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }),
      rows: [...document.querySelectorAll('.app-content ul li')].map((element) => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }),
    }));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    return result;
  };
  const fallback = await measure('provider');
  const reads = await measure('reads');
  expect(fallback).toEqual(reads);
  expect(reads.filters).toHaveLength(3);
  expect(reads.rows).toHaveLength(5);
});
