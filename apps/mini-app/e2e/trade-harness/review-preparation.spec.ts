import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

// Real Trade, ActionReview, service, patched SDK, route policy, simulation and
// fee hooks. Only the wallet/display providers and transport responses are
// deterministic fixtures. No connector, wallet signature or live RPC is used.
const require = createRequire(resolve(__dirname, 'review-preparation.spec.ts'));
const { buildHarness } = require('./long-review-build.cjs') as { buildHarness: () => Promise<{ script: string; css: string }> };
const { createFixture } = require('./long-review-rpc.cjs') as { createFixture: (options: Record<string, unknown>) => {
  rpc: (request: unknown) => Promise<unknown>;
  block: { number: string };
  setSimulationFailure?: (index?: number) => void;
} };
let bundle: { script: string; css: string };
test.beforeAll(async () => { bundle = await buildHarness(); });

type Control = {
  wallet: { ready: boolean; authenticated: boolean; isEmbedded: boolean; address: string; chainId: number; connectionVersion: number };
  events: Array<{ name: string; start: number; end?: number; error?: string }>;
  rerender?: () => void;
  trace: (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
  enabledConfirmSeen: boolean;
};
async function mount(page: Page, options: { delayMs?: number; blockDelayMs?: number; funded?: boolean; simulationFailureIndex?: number; feeDelayMs?: number; feeRatios?: bigint[]; restoredSlippage?: string } = {}) {
  const transportOptions = { delayMs: options.delayMs ?? 20, ethBalance: options.funded ? 10n ** 20n : 400000000000000n, simulationFailureIndex: options.simulationFailureIndex, feeRatios: options.feeRatios };
  const fixture = createFixture(transportOptions);
  fixture.setSimulationFailure = (index) => { transportOptions.simulationFailureIndex = index; };
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const icon = new URL(url).pathname.match(/^\/(token-icons|chain-icons)\/([\w-]+\.(?:png|svg))$/);
    if (icon) return route.fulfill({ contentType: icon[2].endsWith('.svg') ? 'image/svg+xml' : 'image/png', body: readFileSync(resolve(__dirname, '../../public', icon[1], icon[2])) });
    if (url.includes('/api/gas')) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 20));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: 'etherscan', chainId: 1, gasPriceWei: '3000000000', baseFeePerGasWei: '1000000000', tiers: { standard: '3000000000', fast: '4000000000', rapid: '5000000000' }, fetchedAt: Date.now(), stale: false }) });
    }
    if (url.includes('fake-controlled-fixture')) {
      const request = route.request().postDataJSON();
      if (options.feeDelayMs && ['eth_getBalance', 'eth_estimateGas'].includes(request.method)) await new Promise(resolve => setTimeout(resolve, options.feeDelayMs));
      if (request.method === 'eth_blockNumber' && options.blockDelayMs) await new Promise((resolve) => setTimeout(resolve, options.blockDelayMs));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(await fixture.rpc(request)) });
    }
    if (url.startsWith('http://long-review.test/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' });
    return route.abort();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://long-review.test/trade');
  if (options.restoredSlippage) await page.evaluate((slippage) => {
    const now = Date.now();
    const id = '1:0x1111111111111111111111111111111111111111:increasePosition:' + encodeURIComponent('trade:ETH:long:ETH') + ':' + encodeURIComponent('/trade');
    localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ slippageBps: 50, gasTier: 'standard' }));
    localStorage.setItem('fxaeon:signature-drafts:v1', JSON.stringify([{ id, walletAddress: '0x1111111111111111111111111111111111111111', chainId: 1, operation: 'increasePosition', actionKey: 'trade:ETH:long:ETH', resumePath: '/trade', formState: { market: 'ETH', side: 'long', token: 'ETH', amount: '0.0003', leverage: 2.8, slippage }, createdAt: now, updatedAt: now, status: 'signature-required' }]));
    history.replaceState(null, '', '/trade?fxDraft=' + encodeURIComponent(id));
  }, options.restoredSlippage);
  await page.evaluate(() => {
    (globalThis as unknown as { process: { env: Record<string, string> } }).process = { env: {} };
    const h: Control = {
      wallet: { ready: true, authenticated: true, isEmbedded: true, address: '0x1111111111111111111111111111111111111111', chainId: 1, connectionVersion: 1 },
      events: [], enabledConfirmSeen: false,
      async trace(name, fn) {
        const event: Control['events'][number] = { name, start: performance.now() }; h.events.push(event);
        try { return await fn(); } catch (cause) { event.error = String(cause); throw cause; } finally { event.end = performance.now(); }
      },
    };
    (globalThis as typeof globalThis & { __longReview: Control }).__longReview = h;
    new MutationObserver(() => {
      if (Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Open position' && !button.disabled)) h.enabledConfirmSeen = true;
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await page.addStyleTag({ content: bundle.css });
  await page.addScriptTag({ content: bundle.script });
  if (options.restoredSlippage) {
    // Restored drafts intentionally reopen review once; the editor is replaced.
    await expect(page.getByRole('heading', { name: /^Long ETH .*×$/ })).toBeVisible();
  } else {
    await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toBeVisible();
  }
  // Let the initial bounds read settle so this test isolates click/preparation.
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.events.some((event) => event.name === 'readLeverageBounds' && event.end !== undefined))).toBe(true);
  return fixture;
}
async function fill(page: Page, amount = '0.0003') {
  await page.getByRole('textbox', { name: 'Amount in ETH' }).fill(amount);
  await page.getByRole('slider').fill('2.8');
}
async function planCount(page: Page) {
  return page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.events.filter((event) => event.name === 'planIncreasePosition').length);
}
async function review(page: Page) { await page.getByRole('button', { name: 'Review ETH Long', exact: true }).click(); }
async function insufficient(page: Page) { await expect(page.getByRole('button', { name: 'Not enough ETH', exact: true })).toBeDisabled(); }
const advanced = (page: Page) => page.getByLabel('Advanced transaction details', { exact: true });
// USD display estimates are a separate child, not part of the signed ETH figure.
const nativeFigure = (value: Locator) => value.evaluate(node => Array.from(node.childNodes)
  .filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('').trim());

async function expectReachableReview(page: Page) {
  const information = page.getByRole('region', { name: 'Review information', exact: true });
  const decision = page.locator('[data-review-actions] > button');
  // Desktop can scroll the surrounding page; the phone decision must already
  // be visible in its modal without moving the page or the review's terms.
  if (page.viewportSize()!.width > 600) await decision.scrollIntoViewIfNeeded();
  await expect(decision).toBeInViewport({ ratio: 1 });
  const layout = await information.evaluate(body => {
    const viewport = body.closest('[data-review-viewport]')!;
    const actions = viewport.querySelector('[data-review-actions]')!;
    const button = actions.querySelector('button')!;
    const bounds = body.getBoundingClientRect();
    const actionBounds = actions.getBoundingClientRect();
    const buttonBounds = button.getBoundingClientRect();
    const buttonUnobscured = [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75]].every(([x, y]) => {
      const hit = document.elementFromPoint(buttonBounds.x + buttonBounds.width * x, buttonBounds.y + buttonBounds.height * y);
      return hit === button || button.contains(hit);
    });
    return {
      bodyHeight: bounds.height, bodyBottom: bounds.bottom, actionsTop: actionBounds.top,
      buttonHeight: buttonBounds.height, buttonUnobscured,
      overflowY: getComputedStyle(body).overflowY, scrollable: body.scrollHeight > body.clientHeight + 1,
      horizontalOverflow: body.scrollWidth - body.clientWidth,
    };
  });
  expect(layout.bodyHeight).toBeGreaterThan(0);
  expect(layout.bodyBottom, 'scrolling terms end above the separate decision footer').toBeLessThanOrEqual(layout.actionsTop + 1);
  expect(layout.buttonHeight).toBeGreaterThanOrEqual(44);
  expect(layout.buttonUnobscured, 'the visible CTA has unobscured hit targets').toBe(true);
  expect(layout.horizontalOverflow).toBeLessThanOrEqual(0);
  if (layout.scrollable) expect(layout.overflowY).toMatch(/^(auto|scroll)$/);

  // Rows beyond the clipped body may have screen coordinates below the CTA.
  // Require every decision-critical value to scroll fully above it instead of
  // comparing the CTA against an offscreen row's unscrolled coordinates.
  for (const label of ['Amount', 'Estimated collateral', 'Execution price', 'Rebalance price', 'Liquidation price', 'f(x) fee', 'Gas fee', 'Total cost']) {
    const row = information.locator(`[data-review-fact="${label}"]`).first();
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeInViewport({ ratio: 1 });
    const fits = await row.evaluate(node => {
      const body = node.closest('[data-review-scroll]')!.getBoundingClientRect();
      const row = node.getBoundingClientRect();
      return row.top >= body.top - 1 && row.bottom <= body.bottom + 1;
    });
    expect(fits, `${label} is fully readable inside the scrolling terms`).toBe(true);
    await expect(decision).toBeInViewport({ ratio: 1 });
  }
  await advanced(page).locator(':scope > summary').scrollIntoViewIfNeeded();
  await expect(advanced(page).locator(':scope > summary')).toBeInViewport({ ratio: 1 });
  await information.evaluate(node => { node.scrollTop = 0; });
}

test('Trade settings preserve restored planner slippage through gas-only changes and explicit matching preset choices', async ({ page }) => {
  await mount(page, { funded: true, restoredSlippage: '0.101' });
  await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const gear = page.getByRole('button', { name: /Transaction settings/ });
  await expect(gear).toHaveAccessibleName(/0\.101%/);
  await page.evaluate(() => {
    localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ slippageBps: 50, gasTier: 'fast' }));
    window.dispatchEvent(new CustomEvent('fxaeon:settings-updated', { detail: { slippageBps: 50, gasTier: 'fast' } }));
  });
  await expect(gear).toHaveAccessibleName(/0\.101%/);
  await review(page);
  await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
  await advanced(page).locator(':scope > summary').click();
  await expect(page.locator('[data-review-fact="Slippage"]')).toContainText('0.101%');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await gear.click();
  await page.getByRole('radio', { name: '0.5%', exact: true }).click();
  await page.getByRole('button', { name: 'Close transaction settings', exact: true }).click();
  await expect(gear).toHaveAccessibleName(/0\.5%/);
  await review(page);
  await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
  await advanced(page).locator(':scope > summary').click();
  await expect(page.locator('[data-review-fact="Slippage"]')).toContainText('0.5%');
});

for (const theme of ['dark']) {
  test(`redesigned review exposes decisions, exact amounts and fee units in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.install();
    // Representative published Trade schedule; other fixtures exercise all fee legs.
    await mount(page, { funded: true, feeRatios: [3_000_000n, 1_000_000n, 0n, 0n] });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await fill(page, '0.0003'); await review(page);
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Long ETH 2.8×', exact: true })).toBeVisible();
    const sheet = page.getByRole('dialog', { name: 'Long ETH 2.8×' });
    const sheetBounds = (await sheet.boundingBox())!;
    expect(sheetBounds.y).toBeGreaterThanOrEqual(0);
    expect(sheetBounds.height).toBeLessThanOrEqual(844 * 0.92 + 1);
    expect(sheetBounds.y + sheetBounds.height).toBeLessThanOrEqual(845);
    await expectReachableReview(page);
    await expect(page.getByText('Confirm the terms, then continue in your wallet.', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-review-fact="f(x) fee"]')).toContainText('0.3%');
    await expect(page.locator('[data-review-fact="Execution price"]')).toBeInViewport();
    await expect(page.locator('[data-review-fact="Liquidation price"]')).toBeInViewport();
    await expect(page.locator('[data-review-fact="Rebalance price"]')).toContainText(/≈ \$[\d,.]+ \/ stETH/);
    await expect(page.locator('[data-review-fact="Estimated collateral"] summary')).toBeVisible();
    await expect(page.locator('[data-review-fact="Estimated collateral"] summary')).toHaveAccessibleName(/^Show full estimate: [\d,.]+ stETH$/);
    await expect(page.locator('[data-review-fact="Gas fee"]')).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeInViewport();
    const output = resolve(__dirname, '../../../../artifacts/review-redesign'); mkdirSync(output, { recursive: true });
    await page.screenshot({ path: resolve(output, `review-${theme}-390.png`) });
    await page.locator('[data-review-fact="Amount"] summary').click();
    await expect(page.locator('[data-review-fact="Amount"] p')).toContainText('0.0003 ETH');
    await page.locator('[data-review-fact="Amount"] summary').click();
    await advanced(page).locator(':scope > summary').click();
    await expect(advanced(page).getByRole('group', { name: 'Network fee speed', exact: true })).toBeVisible();
    await expect(advanced(page).getByText('3 Gwei', { exact: true })).toBeVisible();
    await expect(advanced(page).getByRole('radio', { name: 'Standard 3 Gwei', exact: true })).toBeChecked();
    await expect(page.locator('[data-review-fact="Slippage"]')).toBeVisible();
    await expect(page.locator('[data-review-fact="Estimated collateral"]')).toHaveCount(1);
    await expect(page.locator('[data-review-fact="Estimated debt"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Open position', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeInViewport();
    await page.screenshot({ path: resolve(output, `review-details-${theme}-390.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.clock.fastForward(31_000);
    await expect(page.locator('[data-review-fact="Liquidation price"]')).toContainText('Unavailable');
    await expect(page.locator('[data-review-fact="Rebalance price"]')).toContainText('Unavailable');
  });
}

test('quick review keeps the input visible until ready and starts only one plan', async ({ page }) => {
  await mount(page, { feeDelayMs: 650 }); await fill(page); await review(page);
  await expect(page.getByRole('button', { name: 'Preparing review…', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.0003');
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toBeDisabled();
  await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
  await page.waitForTimeout(400); expect(await planCount(page)).toBe(1);
  await insufficient(page);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.enabledConfirmSeen)).toBe(false);
});

test('click during the advisory block read prevents a late duplicate warm-up', async ({ page }) => {
  await mount(page, { blockDelayMs: 350 }); await fill(page);
  await page.waitForTimeout(260); await review(page); await insufficient(page);
  expect(await planCount(page)).toBe(1);
});

test('a matching in-flight prefetch remains reusable through explicit review', async ({ page }) => {
  await mount(page); await fill(page);
  await expect.poll(() => planCount(page)).toBe(1);
  await review(page); await insufficient(page); expect(await planCount(page)).toBe(1);
});

test('a completed warm quote still needs current-block validation and simulation', async ({ page }) => {
  await mount(page); await fill(page);
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.events.some((event) => event.name === 'planIncreasePosition' && event.end !== undefined))).toBe(true);
  await review(page); await insufficient(page); expect(await planCount(page)).toBe(1);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.events.filter((event) => event.name === 'prepareRoutesForReview').length)).toBe(1);
});

test('a new block reuses the warmed plan but still validates and simulates it', async ({ page }) => {
  const fixture = await mount(page); await fill(page);
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.events.some((event) => event.name === 'planIncreasePosition' && event.end !== undefined))).toBe(true);
  fixture.block.number = '0x1312d01'; await review(page); await insufficient(page); expect(await planCount(page)).toBe(1);
  const checks = await page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.events.map(event => event.name));
  expect(checks.filter(name => name === 'prepareRoutesForReview')).toHaveLength(1);
  expect(checks.filter(name => name === 'readLeverageBounds').length).toBeGreaterThanOrEqual(2);
});

test('Cancel abandons preparation and late results cannot reopen review', async ({ page }) => {
  await mount(page, { feeDelayMs: 650 }); await fill(page); await review(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.0003');
  await page.waitForTimeout(1800);
  await expect(page.getByRole('button', { name: 'Review ETH Long', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open position', exact: true })).toHaveCount(0);
});

test('mobile review traps focus, survives a desktop resize, and closes back to the input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page, { funded: true }); await fill(page); await review(page);
  const dialog = page.getByRole('dialog', { name: 'Long ETH 2.8×' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Close transaction review' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
  expect(await planCount(page)).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-review-fact="Amount"]')).toContainText('0.0003 ETH');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.0003');
  await expect(page.getByRole('button', { name: 'Review ETH Long', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('wallet change abandons the old preparation', async ({ page }) => {
  await mount(page); await fill(page); await review(page);
  await page.evaluate(() => { const h = (globalThis as typeof globalThis & { __longReview: Control }).__longReview; h.wallet = { ...h.wallet, address: '0x2222222222222222222222222222222222222222', connectionVersion: 2 }; h.rerender?.(); });
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('');
  await page.waitForTimeout(1800);
  await expect(page.getByRole('button', { name: 'Open position', exact: true })).toHaveCount(0);
});

test('fresh-cache visibility refresh disables confirmation until the request settles', async ({ page }) => {
  await mount(page, { funded: true, delayMs: 100 }); await fill(page); await review(page);
  const confirm = page.getByRole('button', { name: 'Open position', exact: true }); await expect(confirm).toBeEnabled();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Checking network fees…', exact: true })).toBeDisabled();
  await expect(confirm).toBeEnabled();
});

async function geometry(page: Page, seed = false) {
  return page.evaluate((seed) => {
    const selectors = ['[data-review-viewport]', '[data-review-fact="Amount"]', '[data-mobile-review-sheet] h2, [data-review-header] h3', '[data-review-fact="Execution price"]', '[data-review-fact="Liquidation price"]', '[data-review-viewport] > :last-child button'];
    const nodes = selectors.map(selector => document.querySelector(selector)!);
    const global = window as unknown as { __reviewNodes?: Element[] };
    if (seed) global.__reviewNodes = nodes;
    return { same: nodes.map((node,index) => node === global.__reviewNodes?.[index]), boxes: nodes.map(node => { const r=node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; }), facts: nodes.map(node => ({ text: node.textContent, font: getComputedStyle(node).font, children: Array.from(node.children, child => ({ text: child.textContent, width: child.getBoundingClientRect().width, height: child.getBoundingClientRect().height })) })) };
  }, seed);
}
// Complete reviews must fit at narrow widths and with wider fallback fonts.
const stabilityViewports: Array<{ width: number; height: number; font?: string }> = [{ width:393,height:920 }, { width:320,height:568 }, { width:320,height:568,font:'Arial' }, { width:320,height:568,font:'Verdana' }, { width:768,height:1024 }, { width:1100,height:1200 }];
for (const viewport of stabilityViewports) {
  test(`ready review fits and keeps its action reachable at ${viewport.width}px${viewport.font ? ` in ${viewport.font}` : ''}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); await mount(page,{feeDelayMs:650});
    if (viewport.font) await page.addStyleTag({ content: `:root { --font-sans: ${viewport.font}, sans-serif; }` });
    await fill(page); await review(page);
    await expect(page.getByRole('button',{name:'Preparing review…',exact:true})).toBeDisabled();
    await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await insufficient(page);
    const ready = await geometry(page, true);
    writeFileSync(testInfo.outputPath('review-geometry.json'), JSON.stringify(ready, null, 2));
    await testInfo.attach('review-geometry', { body: JSON.stringify(ready, null, 2), contentType: 'application/json' });
    expect(ready.boxes.at(-1)!.height).toBeGreaterThanOrEqual(44);
    await expectReachableReview(page);
    await expect(page.locator('[data-review-viewport] .skeleton')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Checking network fees…',exact:true})).toHaveCount(0);
    if (viewport.width <= 600) {
      await expect(page.getByRole('dialog', { name: 'Long ETH 2.8×' })).toBeVisible();
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    } else await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Not enough ETH', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Not enough ETH', exact: true })).toBeInViewport();
    const fit = await page.evaluate(() => {
      const review = document.querySelector<HTMLElement>('[data-review-viewport]')!;
      const body = review.querySelector<HTMLElement>('[aria-label="Review information"]')!;
      const status = review.querySelector<HTMLElement>('[aria-live="off"]')!;
      return { horizontalOverflow: document.documentElement.scrollWidth > innerWidth, blankBody: body.getBoundingClientRect().bottom - body.lastElementChild!.getBoundingClientRect().bottom, statusHeight: status.getBoundingClientRect().height, lineHeight: Number.parseFloat(getComputedStyle(status).lineHeight) };
    });
    expect(fit.horizontalOverflow).toBe(false);
    expect(fit.blankBody).toBeLessThanOrEqual(1);
    // Settled status is content-sized, not a reserved three-line slot.
    expect(fit.statusHeight).toBeLessThanOrEqual(fit.lineHeight * 2 + 1);
  });
}
test('a Max-length amount remains in the input then fits the complete review at 320px', async ({ page }) => {
  // The owner's phone report (9.jpg): light theme, preparing, and a 17-decimal
  // amount pushed the value column out of the card ("New position" read "Nev").
  await page.setViewportSize({ width: 320, height: 640 });
  await mount(page, { feeDelayMs: 650 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await fill(page, '0.00024443113696627'); await review(page);
  const expectInsideCard = async () => {
    const fit = await page.evaluate(() => {
      const viewport = document.querySelector('[data-review-viewport]')!;
      const body = viewport.querySelector<HTMLElement>('[aria-label="Review information"]')!;
      const bounds = body.getBoundingClientRect();
      const escaped = Array.from(viewport.querySelectorAll<HTMLElement>('[data-review-fact]'))
        .filter((row) => row.getBoundingClientRect().height > 0)
        .flatMap((row) => Array.from(row.children)
          .filter((cell) => { const box = cell.getBoundingClientRect(); return box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5; })
          .map(() => row.dataset.reviewFact));
      return { pageOverflow: document.documentElement.scrollWidth - innerWidth, bodyOverflow: body.scrollWidth - body.clientWidth, escaped };
    });
    expect(fit.pageOverflow, 'no horizontal page overflow').toBeLessThanOrEqual(0);
    expect(fit.bodyOverflow, 'no hidden horizontal overflow in the card').toBeLessThanOrEqual(0);
    expect(fit.escaped, 'labels and values stay inside the card').toEqual([]);
    // The exact amount remains available through its disclosure throughout verification.
    await expect(page.locator('[data-review-fact="Amount"] summary')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Long ETH 2.8×' })).toBeInViewport();
  };
  await expect(page.getByRole('button', { name: 'Preparing review…', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.00024443113696627');
  await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
  await insufficient(page);
  await expectInsideCard();
  await expect(page.locator('p', { hasText: 'Add at least' })).toHaveText(/^Add at least \d[\d,]*(?:\.\d+)? ETH on Ethereum to cover network fees\. Receive ETH$/);
  // The fee is the max the wallet funds, so the ETH to add is exactly the
  // total shown (amount plus that max) less the fixture's 0.0004 ETH balance.
  const toWei = (text: string) => {
    const [whole, fraction = ''] = /([\d,]+(?:\.\d+)?) ETH/.exec(text)![1].replace(/,/g, '').split('.');
    return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  };
  const gasValue = page.locator('[data-review-fact="Gas fee"] > span').last();
  expect(await nativeFigure(gasValue)).toMatch(/^[\d,]+(?:\.\d+)? ETH max$/);
  await expect(gasValue.locator('[data-usd-state="unavailable"]')).toHaveText('USD value unavailable');
  await advanced(page).locator(':scope > summary').click();
  const totalValue = page.locator('[data-review-fact="Total cost"] > span').last();
  const total = await nativeFigure(totalValue);
  expect(total).toMatch(/ ETH max$/);
  expect(toWei(total)).toBe(244431136966270n + toWei((await gasValue.getAttribute('title'))!));
  await expect(totalValue.locator('[data-usd-state="unavailable"]')).toHaveText('USD value unavailable');
  await expect(totalValue).not.toContainText('$0.00');
  const asked = await page.locator('p', { hasText: 'Add at least' }).innerText();
  expect(toWei(asked)).toBe(toWei(total) - 400000000000000n);
});

test('failed preparation stays beside the input and Review performs a fresh check', async ({page}) => {
  const fixture=await mount(page,{simulationFailureIndex:0}); await fill(page); await review(page);
  await expect(page.getByRole('button',{name:'Review ETH Long',exact:true})).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.0003');
  await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button',{name:'Open position',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Checking transaction steps')).toHaveCount(0);
  fixture.setSimulationFailure?.(undefined);
  await review(page); await insufficient(page);
  const after=await geometry(page);
  expect(after.boxes.at(-1)!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Not enough ETH', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Not enough ETH', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => (globalThis as typeof globalThis & {__longReview:Control}).__longReview.events.filter(event=>event.name==='prepareRoutesForReview').length)).toBe(2);
});
test('Telegram Back cancels pending preparation and preserves the editor', async ({page}) => {
  await mount(page,{feeDelayMs:650}); await fill(page); await review(page);
  await expect(page.getByRole('button',{name:'Preparing review…',exact:true})).toBeDisabled();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('fxaeon:telegram-back')));
  await expect(page.getByRole('textbox',{name:'Amount in ETH'})).toHaveValue('0.0003');
  await expect(page.getByRole('textbox',{name:'Amount in ETH'})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Open position',exact:true})).toHaveCount(0);
});
