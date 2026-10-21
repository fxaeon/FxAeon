import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { leverageTrackPosition } from '../../src/lib/leverageShare';

// The real Trade ticket (LeverageField, the warmed route and its outcome
// preview, ActionReview) over the offline RPC fixture used by the review
// preparation harness. No wallet connector, signature or live RPC is used.
const require = createRequire(resolve(__dirname, 'ticket.spec.ts'));
const { buildHarness } = require('./long-review-build.cjs') as { buildHarness: () => Promise<{ script: string; css: string }> };
const { createFixture } = require('./long-review-rpc.cjs') as { createFixture: (options: Record<string, unknown>) => { rpc: (request: unknown) => Promise<unknown> } };
let bundle: { script: string; css: string };
test.beforeAll(async () => { bundle = await buildHarness(); });

type Control = {
  wallet: { ready: boolean; authenticated: boolean; isEmbedded: boolean; address: string; chainId: number; connectionVersion: number };
  events: Array<{ name: string; start: number; end?: number; error?: string }>;
  trace: (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
};
type Harness = typeof globalThis & { __longReview: Control };

/** `failCalls` makes every contract read fail while it returns true (the bounds read has settled by then). */
async function mount(page: Page, options: { delayMs?: number; failCalls?: () => boolean; reducedMotion?: 'reduce' | 'no-preference' } = {}) {
  const fixture = createFixture({ delayMs: options.delayMs ?? 20, ethBalance: 400000000000000n });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('http://long-review.test/token-icons/') || url.startsWith('http://long-review.test/chain-icons/')) {
      const publicRoot = resolve(__dirname, '../../public');
      const asset = resolve(publicRoot, `.${new URL(url).pathname}`);
      if (asset.startsWith(publicRoot) && existsSync(asset)) return route.fulfill({ contentType: asset.endsWith('.svg') ? 'image/svg+xml' : 'image/png', body: readFileSync(asset) });
      return route.fulfill({ status: 404, body: '' });
    }
    if (url.includes('/api/gas')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: 'etherscan', chainId: 1, gasPriceWei: '3000000000', baseFeePerGasWei: '1000000000', tiers: { standard: '3000000000', fast: '4000000000', rapid: '5000000000' }, fetchedAt: Date.now(), stale: false }) });
    if (url.includes('fake-controlled-fixture')) {
      const body = route.request().postDataJSON();
      const calls: Array<{ id: number; method: string }> = Array.isArray(body) ? body : [body];
      if (options.failCalls?.() && calls.some((call) => call.method === 'eth_call')) {
        const failed = calls.map((call) => ({ jsonrpc: '2.0', id: call.id, error: { code: -32000, message: 'fixture: reads unavailable' } }));
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? failed : failed[0]) });
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(await fixture.rpc(body)) });
    }
    if (url.startsWith('http://long-review.test/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' });
    return route.abort();
  });
  await page.emulateMedia({ reducedMotion: options.reducedMotion ?? 'reduce' });
  await page.goto('http://long-review.test/trade');
  await page.evaluate(() => {
    (globalThis as unknown as { process: { env: Record<string, string> } }).process = { env: {} };
    const h: Control = {
      wallet: { ready: true, authenticated: true, isEmbedded: true, address: '0x1111111111111111111111111111111111111111', chainId: 1, connectionVersion: 1 },
      events: [],
      async trace(name, fn) {
        const event: Control['events'][number] = { name, start: performance.now() }; h.events.push(event);
        try { return await fn(); } catch (cause) { event.error = String(cause); throw cause; } finally { event.end = performance.now(); }
      },
    };
    (globalThis as Harness).__longReview = h;
  });
  await page.addStyleTag({ content: bundle.css });
  await page.addScriptTag({ content: bundle.script });
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (globalThis as Harness).__longReview.events.some((event) => event.name === 'readLeverageBounds' && event.end !== undefined))).toBe(true);
}
const planCount = (page: Page) => page.evaluate(() => (globalThis as Harness).__longReview.events.filter((event) => event.name === 'planIncreasePosition').length);
const outcome = (page: Page) => page.getByRole('group', { name: 'Estimated position' });
const fact = (page: Page, label: string) => outcome(page).locator(`[data-outcome-fact="${label}"] dd`);
/** A preview row's estimate, as displayed on the ticket. */
const figure = async (page: Page, label: string) => (await fact(page, label).locator('span').first().textContent()) ?? '';
/** The review's plain fact value; token amounts use their own exact-value disclosure. */
const reviewFact = (page: Page, label: string) => page.locator(`[data-review-fact="${label}"]`).first().locator('> span').last();
const slider = (page: Page) => page.getByRole('slider', { name: 'Target leverage slider', exact: true });
const leverageField = (page: Page) => page.getByRole('textbox', { name: 'Target leverage', exact: true });

test.describe('the ticket’s outcome preview', () => {
  test('previews the warmed route with the figures its review then shows, from the same single plan', async ({ page }) => {
    await mount(page);
    await expect(outcome(page)).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('0.0003');
    await slider(page).fill('2.8');
    await expect(outcome(page)).toHaveAttribute('data-trade-outcome', 'ready');
    const previewPrice = fact(page, 'Execution price');
    await previewPrice.locator('summary').click();
    const executionPriceExact = await previewPrice.getByText('Source detail', { exact: true }).locator('..').locator(':scope > span').last().textContent();
    expect(executionPriceExact).toMatch(/^[\d,]+(?:\.\d+)? fxUSD \/ stETH$/);
    await previewPrice.locator('summary').click();
    const preview = {
      executionPrice: await figure(page, 'Execution price'),
      executionPriceExact,
      liquidationPrice: await figure(page, 'Liquidation price'),
      fee: await figure(page, 'f(x) fee'),
    };
    // The SDK execution quote is already expressed in fxUSD per stETH.
    expect(preview.executionPrice).toMatch(/^≈ [\d,]+(?:\.\d+)? fxUSD \/ stETH$/);
    await expect(fact(page, 'Estimated collateral')).toHaveCount(0);
    await expect(fact(page, 'Estimated debt')).toHaveCount(0);
    expect(preview.liquidationPrice).toMatch(/^≈ \$[\d,]+(?:\.\d+)? \/ stETH$/);
    expect(preview.fee).toMatch(/%/);
    const plansBeforeReview = await planCount(page);

    await page.getByRole('button', { name: 'Review ETH Long', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Not enough ETH', exact: true })).toBeDisabled();
    // Ticket and review disclosures retain the same complete source quote.
    expect(preview.executionPriceExact).toBeTruthy();
    await expect(reviewFact(page, 'Execution price').locator('summary > span')).toHaveText(preview.executionPrice);
    await reviewFact(page, 'Execution price').locator('summary').click();
    await expect(reviewFact(page, 'Execution price').getByText('Source detail', { exact: true }).locator('..').locator(':scope > span').last()).toHaveText(preview.executionPriceExact!);
    await reviewFact(page, 'Execution price').locator('summary').click();
    await expect(reviewFact(page, 'Execution price')).toHaveAttribute('title', preview.executionPriceExact!);
    const collateral = page.locator('[data-review-fact="Estimated collateral"]').first();
    await expect(collateral).toContainText('Position size · collateral');
    const collateralValue = collateral.locator('[data-usd-state="unavailable"]');
    await expect(collateralValue).toHaveText(/^≈ [\d,]+(?:\.\d+)? stETH$/);
    const collateralSource = (await collateralValue.getAttribute('title'))!.split('. USD value unavailable:')[0];
    expect(collateralSource).toMatch(/^[\d,]+(?:\.\d+)? stETH \([\d,]+(?:\.\d+)? wstETH at [\d,]+(?:\.\d+)? stETH per wstETH\)$/);
    await expect(collateralValue).toHaveAttribute('title', /USD value unavailable: no fresh matching wstETH price\.$/);
    const details = page.getByLabel('Advanced transaction details', { exact: true });
    await details.locator(':scope > summary').click();
    const quotedCollateral = details.locator('[data-review-fact="Estimated collateral"]');
    await expect(quotedCollateral).toContainText('Quoted collateral · native');
    // The full accepted amount and conversion rate are unchanged, not parsed
    // back out of the compact display or the unrelated USD estimate.
    await expect(quotedCollateral.locator(':scope > span').last()).toHaveText(collateralSource);
    await expect(reviewFact(page, 'Estimated debt')).toHaveText(/^≈ [\d,]+(?:\.\d+)? fxUSD$/);
    await expect(reviewFact(page, 'f(x) fee')).toHaveText(preview.fee);
    // The signed floor stays exact in wstETH, with its stETH equivalent muted beneath it.
    const floor = reviewFact(page, 'Minimum converted input');
    await expect(floor).toHaveText(/^[\d,]+(?:\.\d+)? wstETH≈ [\d,]+(?:\.\d+)? stETH$/);
    await expect(floor.locator('span').last()).toHaveText(/^≈ [\d,]+(?:\.\d+)? stETH$/);
    // The review reused the warm route it validated: the preview cost no plan of its own.
    expect(await planCount(page)).toBe(plansBeforeReview);
  });

  test('clears its figures the moment an input changes, then estimates the new ticket', async ({ page }) => {
    await mount(page, { delayMs: 150 });
    await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('0.0003');
    await slider(page).fill('2.8');
    await expect(outcome(page)).toHaveAttribute('data-trade-outcome', 'ready');
    const liquidationAt28 = await figure(page, 'Liquidation price');
    const box = (await outcome(page).boundingBox())!;

    await slider(page).fill('3.5');
    // Checked on the very next frame: no figure for 2.8× survives next to 3.5×.
    expect(await page.evaluate(() => {
      const group = document.querySelector('[data-trade-outcome]');
      return { state: group?.getAttribute('data-trade-outcome'), text: group?.textContent ?? '' };
    })).toEqual({ state: 'pending', text: 'Execution priceLiquidation pricef(x) fee' });
    // The placeholder keeps the rows where they were.
    const pending = (await outcome(page).boundingBox())!;
    expect(Math.abs(pending.y - box.y)).toBeLessThanOrEqual(1);
    await expect(outcome(page)).toHaveAttribute('data-trade-outcome', 'ready');
    const liquidationAt35 = await figure(page, 'Liquidation price');
    const amount = (text: string) => Number(text.replace(/[^\d.]/g, ''));
    expect(amount(liquidationAt35)).toBeGreaterThan(amount(liquidationAt28));

    // Clearing the amount leaves nothing to estimate.
    await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('');
    await expect(outcome(page)).toHaveCount(0);
  });

  test('a failed warm-up leaves no preview and no error behind, and review still plans afresh', async ({ page }) => {
    let failing = false;
    await mount(page, { failCalls: () => failing });
    failing = true;
    await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('0.0003');
    await slider(page).fill('2.8');
    await expect.poll(() => page.evaluate(() => (globalThis as Harness).__longReview.events.some((event) => event.name === 'planIncreasePosition' && event.error))).toBe(true);
    await expect(outcome(page)).toHaveCount(0);
    await expect(page.locator('[data-trade-ticket] [role="alert"]')).toHaveCount(0);
    failing = false;
    const plansBeforeReview = await planCount(page);
    await page.getByRole('button', { name: 'Review ETH Long', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Not enough ETH', exact: true })).toBeDisabled();
    expect(await planCount(page)).toBe(plansBeforeReview + 1);
  });

  test('back from review, the figures stay in place while the ticket re-estimates from the current chain', async ({ page }) => {
    await mount(page);
    await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('0.0003');
    await slider(page).fill('2.8');
    await expect(outcome(page)).toHaveAttribute('data-trade-outcome', 'ready');
    const liquidationPrice = await figure(page, 'Liquidation price');
    await page.getByRole('button', { name: 'Review ETH Long', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Not enough ETH', exact: true })).toBeDisabled();
    expect(await planCount(page)).toBe(1);
    await page.locator('[data-review-edit]').click();
    // Same inputs, same figures, never a placeholder flash; a fresh warm-up runs behind them.
    await expect(outcome(page)).toHaveAttribute('data-trade-outcome', 'ready');
    await expect(fact(page, 'Liquidation price')).toHaveText(liquidationPrice);
    await expect.poll(() => planCount(page)).toBe(2);
    await expect.poll(() => page.evaluate(() => (globalThis as Harness).__longReview.events.filter((event) => event.name === 'planIncreasePosition').every((event) => event.end !== undefined))).toBe(true);
    await expect(fact(page, 'Liquidation price')).toHaveText(liquidationPrice);
  });

  test('an untouched ticket stops showing a liquidation estimate once its pool threshold expires', async ({ page }) => {
    await page.clock.install();
    await mount(page);
    await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('0.0003');
    await slider(page).fill('2.8');
    await expect(outcome(page)).toHaveAttribute('data-trade-outcome', 'ready');
    await expect(fact(page, 'Liquidation price')).toHaveText(/^≈ \$[\d,]+(?:\.\d+)? \/ stETH$/);
    const plans = await planCount(page);
    await page.clock.fastForward(30_001);
    await expect(fact(page, 'Liquidation price')).toHaveText('Unavailable');
    expect(await planCount(page)).toBe(plans);
    await expect(fact(page, 'Execution price')).toHaveText(/^≈ [\d,]+(?:\.\d+)? fxUSD \/ stETH$/);
  });

  test('quoted execution and liquidation prices remain readable on narrow dark tickets', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('0.0003');
    await slider(page).fill('2.8');
    await expect(outcome(page)).toHaveAttribute('data-trade-outcome', 'ready');
    await expect(fact(page, 'Execution price')).toHaveText(/^≈ [\d,]+(?:\.\d+)? fxUSD \/ stETH$/);
    await expect(fact(page, 'Liquidation price')).toHaveText(/^≈ \$[\d,]+(?:\.\d+)? \/ stETH$/);
    const artifacts = resolve(__dirname, '../../../../artifacts/home-hierarchy');
    mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: resolve(artifacts, 'trade-prices-dark-390.png'), animations: 'disabled', fullPage: true });
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(fact(page, 'Execution price')).toBeVisible();
    await expect(fact(page, 'Liquidation price')).toBeVisible();
    await page.screenshot({ path: resolve(artifacts, 'trade-prices-dark-320.png'), animations: 'disabled', fullPage: true });
  });
});

/** Two frames, so a change's transitions (0.01ms under reduced motion) have run before anything is measured. */
const nextFrames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
/** The drawn bar and thumb, and the screen x of a share along the bar. */
async function track(page: Page) {
  const root = slider(page).locator('..');
  // The slider draws two layers: the split bar, then the ticks above it.
  const bar = (await root.locator(':scope > div[aria-hidden="true"]').first().boundingBox())!;
  const thumb = root.locator('span[aria-hidden="true"]');
  return { bar, thumb, y: bar.y + bar.height / 2, at: (share: number) => bar.x + share * bar.width };
}
/**
 * The drawn ticks, measured against the bar and the thumb. Two frames pass
 * first: the track is re-measured after a resize, and even reduced motion's
 * 0.01ms transitions report their starting value until a frame has run.
 */
async function tickLayout(page: Page) {
  await nextFrames(page);
  return slider(page).evaluate((input) => {
    const root = input.parentElement!;
    const [barLayer, tickLayer] = Array.from(root.querySelectorAll<HTMLElement>(':scope > div[aria-hidden="true"]'));
    const bar = barLayer.getBoundingClientRect();
    const thumb = root.querySelector(':scope > span[aria-hidden="true"]')!.getBoundingClientRect();
    return {
      bar: { top: bar.top, bottom: bar.bottom },
      thumbCentre: thumb.left + thumb.width / 2,
      thumbRadius: thumb.width / 2,
      ticks: Array.from(tickLayer.children, (tick) => {
        const box = tick.getBoundingClientRect();
        return { x: box.left + box.width / 2, top: box.top, bottom: box.bottom, width: box.width, near: tick.hasAttribute('data-near-thumb'), opacity: Number(getComputedStyle(tick).opacity) };
      }),
    };
  });
}
async function thumbCentre(thumb: Locator) {
  await nextFrames(thumb.page());
  const box = (await thumb.boundingBox())!;
  return box.x + box.width / 2;
}

async function expectThumbAtLeverage(page: Page, leverage: number) {
  await expect(slider(page)).toHaveValue(String(leverage));
  // A side change starts another live-bounds read. Measure the thumb, range,
  // and bar in one browser turn so they belong to the same committed scale.
  await expect.poll(async () => {
    await nextFrames(page);
    const geometry = await slider(page).evaluate(input => {
      const range = input as HTMLInputElement;
      const root = range.parentElement!;
      const bar = root.querySelector(':scope > div[aria-hidden="true"]')!.getBoundingClientRect();
      const thumb = root.querySelector(':scope > span[aria-hidden="true"]')!.getBoundingClientRect();
      return { min: Number(range.min), max: Number(range.max), value: Number(range.value), left: bar.left, width: bar.width, centre: thumb.left + thumb.width / 2 };
    });
    if (geometry.value !== leverage) return Infinity;
    return Math.abs(geometry.centre - geometry.left - leverageTrackPosition(leverage, geometry.min, geometry.max) * geometry.width);
  }, { message: `the ${leverage}× thumb follows the currently committed live range` }).toBeLessThanOrEqual(1);
}

test.describe('the leverage slider uses its live minimum and maximum', () => {
  test('keeps a full-width 44px target at phone and desktop widths, without overflow', async ({ page }) => {
    await mount(page);
    for (const [side, width] of [['Long', 320], ['Long', 390], ['Long', 480], ['Long', 1280], ['Short', 320], ['Short', 390]] as const) {
      await page.getByRole('radio', { name: side, exact: true }).click();
      await page.setViewportSize({ width, height: 900 });
      await expect(slider(page)).toBeVisible();
      await expect.poll(async () => slider(page).evaluate((target) => {
        const targetRect = target.getBoundingClientRect();
        const ticketRect = target.closest('.trade-ticket')?.getBoundingClientRect();
        return {
          minTouchTarget: targetRect.height >= 44,
          widthRatio: Boolean(ticketRect && targetRect.width > ticketRect.width * 0.72),
          noOverflow: document.documentElement.scrollWidth - window.innerWidth <= 0,
        };
      }), { message: `${side} ${width}px: slider target fits its ticket after resize` })
        .toEqual({ minTouchTarget: true, widthRatio: true, noOverflow: true });
      // The range ends and the split caption share one row, inside the ticket.
      // Read once the resize has settled: a slow runner can measure mid-layout.
      await expect.poll(async () => {
        const bounds = (await page.locator('[data-leverage-bounds]').boundingBox())!;
        const settled = (await page.locator('.trade-ticket').boundingBox())!;
        return {
          insideLeft: bounds.x >= settled.x - 0.5,
          insideRight: bounds.x + bounds.width <= settled.x + settled.width + 0.5,
          oneLine: bounds.height < 24,
        };
      }, { message: `${side} ${width}px: the range row sits inside the ticket on one line` })
        .toEqual({ insideLeft: true, insideRight: true, oneLine: true });
    }
  });

  test('its thumb follows the live leverage scale while the caption explains the debt split', async ({ page }) => {
    await mount(page);
    for (const leverage of ['2', '3.5', '1.5']) {
      await leverageField(page).fill(leverage);
      await expectThumbAtLeverage(page, Number(leverage));
    }
    await page.getByRole('radio', { name: 'Short' }).click();
    await leverageField(page).fill('3');
    await expectThumbAtLeverage(page, 3);
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '3.0×, 75% debt, 25% equity');
  });

  test('a mouse drag maps x to live leverage, snapped to 0.1×, and the ends clamp to the range', async ({ page }) => {
    await mount(page);
    const min = Number(await slider(page).getAttribute('min'));
    const max = Number(await slider(page).getAttribute('max'));
    const { at, y, thumb } = await track(page);
    // Grabbing the thumb off-centre does not jump it.
    await page.mouse.move(await thumbCentre(thumb) + 5, y);
    await page.mouse.down();
    await expect(leverageField(page)).toHaveValue('2');
    await page.mouse.move(at(leverageTrackPosition(3.5, min, max)) + 5, y, { steps: 6 });
    await expect(leverageField(page)).toHaveValue('3.5');
    await page.mouse.move(at(1) + 5, y, { steps: 4 });
    await expect(leverageField(page)).toHaveValue(String(max));
    await page.mouse.move(at(0.005), y, { steps: 8 });
    await expect(leverageField(page)).toHaveValue(String(min));
    await page.mouse.up();
    // A click on the track moves the thumb there, as on a native slider.
    await page.mouse.click(at(leverageTrackPosition(4, min, max)), y);
    await expect(leverageField(page)).toHaveValue('4');
    await expect(slider(page)).toHaveValue('4');
    await expect(slider(page)).toBeFocused();
  });

  test('keys step 0.1×, pages move a whole ×, and Home/End reach the bounds', async ({ page }) => {
    await mount(page);
    const min = await slider(page).getAttribute('min');
    const max = await slider(page).getAttribute('max');
    await leverageField(page).fill('2');
    await slider(page).focus();
    for (const [key, value] of [['ArrowRight', '2.1'], ['ArrowUp', '2.2'], ['ArrowLeft', '2.1'], ['PageUp', '3.1'], ['PageUp', '4.1'], ['PageDown', '3.1'], ['Home', min], ['End', max], ['PageUp', max]] as const) {
      await slider(page).press(key);
      await expect(slider(page)).toHaveValue(value!);
      await expect(leverageField(page)).toHaveValue(value!);
    }
  });

  test('assistive technology hears a slider in leverage units, with the split it draws', async ({ page }) => {
    await mount(page);
    await leverageField(page).fill('2.8');
    const cdp = await page.context().newCDPSession(page);
    type AXNode = { role?: { value?: string }; name?: { value?: string }; value?: { value?: unknown }; properties?: Array<{ name: string; value: { value?: unknown } }> };
    const { nodes } = await cdp.send('Accessibility.getFullAXTree') as unknown as { nodes: AXNode[] };
    const sliders = nodes.filter((node) => node.role?.value === 'slider');
    expect(sliders.map((node) => node.name?.value)).toEqual(['Target leverage slider']);
    // Chromium reports the accessible value and bounds as float32: leverage, not share.
    const properties = Object.fromEntries((sliders[0].properties ?? []).map((property) => [property.name, Number(property.value.value)]));
    expect(Number(sliders[0].value?.value)).toBeCloseTo(2.8, 5);
    expect(properties.valuemin).toBeCloseTo(Number(await slider(page).getAttribute('min')), 5);
    expect(properties.valuemax).toBeCloseTo(Number(await slider(page).getAttribute('max')), 5);
    // CDP's tree does not carry aria-valuetext (it reads empty even on a role="slider"); the attribute is what screen readers speak.
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '2.8×, 64% debt, 36% equity');
    await page.getByRole('radio', { name: 'Short' }).click();
    await leverageField(page).fill('3');
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '3.0×, 75% debt, 25% equity');
  });

  test.describe('on a touch screen', () => {
    test.use({ hasTouch: true });

    test('a sideways drag moves the thumb with the finger, a tap jumps it, and a vertical swipe leaves it alone', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 700 });
      await mount(page);
      await leverageField(page).fill('2');
      const touch = await page.context().newCDPSession(page);
      const min = Number(await slider(page).getAttribute('min'));
      const max = Number(await slider(page).getAttribute('max'));
      const { at, y, thumb } = await track(page);
      const start = await thumbCentre(thumb);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] });
      for (const share of [0.55, 0.6, leverageTrackPosition(3, min, max)]) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at(share), y }] });
      }
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(leverageField(page)).toHaveValue('3');

      await page.touchscreen.tap(at(leverageTrackPosition(1.5, min, max)), y);
      await expect(leverageField(page)).toHaveValue('1.5');

      // Scrolling past the ticket is not a leverage change.
      const target = at(leverageTrackPosition(4, min, max));
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target, y }] });
      for (const dy of [12, 30, 60]) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target + 2, y: y - dy }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(leverageField(page)).toHaveValue('1.5');
    });
  });

  test('whole-× ticks stand on the bar’s upper edge, keep 14px apart and step aside near the thumb', async ({ page }) => {
    await mount(page);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const leverage of ['2.9', '4.6', '2']) {
        await leverageField(page).fill(leverage);
        await expect.poll(async () => (await tickLayout(page)).ticks.length, `${width}px`).toBeGreaterThan(1);
        const layout = await tickLayout(page);
        let lastVisible = Number.NEGATIVE_INFINITY;
        for (const tick of layout.ticks) {
          // A hairline on the bar's upper edge: it never cuts into the split.
          expect(tick.bottom, `${width}px ${leverage}×`).toBeLessThanOrEqual(layout.bar.top + 0.5);
          expect(tick.width).toBeLessThanOrEqual(1.5);
          const clearance = Math.abs(tick.x - layout.thumbCentre) - layout.thumbRadius;
          if (clearance < 9) expect({ near: tick.near, opacity: tick.opacity }, `${width}px ${leverage}×: tick ${clearance.toFixed(1)}px from the thumb`).toEqual({ near: true, opacity: 0 });
          if (clearance > 11) expect({ near: tick.near, opacity: tick.opacity }, `${width}px ${leverage}×: tick ${clearance.toFixed(1)}px from the thumb`).toEqual({ near: false, opacity: 1 });
          if (tick.opacity === 0) continue;
          expect(tick.x - lastVisible, `${width}px ${leverage}×: visible ticks keep 14px apart`).toBeGreaterThanOrEqual(13.5);
          lastVisible = tick.x;
        }
      }
      // Several whole-× ticks may fall inside the thumb clearance at narrow
      // widths; every tick inside that collision envelope must step aside.
      await leverageField(page).fill('2.9');
      const nearTicks = (await tickLayout(page)).ticks.filter((tick) => tick.near);
      expect(nearTicks.length).toBeGreaterThan(0);
      expect(nearTicks.every((tick) => tick.opacity === 0)).toBe(true);
    }
  });

  test('the boundary glides to a typed leverage, and ticks fade aside, unless reduced motion is asked for', async ({ page }) => {
    await mount(page, { reducedMotion: 'no-preference' });
    const thumb = slider(page).locator('..').locator('span[aria-hidden="true"]');
    const tick = slider(page).locator('..').locator(':scope > div[aria-hidden="true"]').nth(1).locator('i').first();
    await expect(tick).toBeAttached();
    expect(await thumb.evaluate((element) => getComputedStyle(element).transitionProperty)).toContain('left');
    expect(await tick.evaluate((element) => getComputedStyle(element).transitionProperty)).toContain('opacity');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // The app's reduced-motion reset leaves transitions at 0.01ms: instant, never a glide or a fade.
    for (const element of [thumb, tick]) {
      expect(await element.evaluate((node) => getComputedStyle(node).transitionDuration.split(',').every((duration) => parseFloat(duration) < 0.001))).toBe(true);
    }
  });
});
