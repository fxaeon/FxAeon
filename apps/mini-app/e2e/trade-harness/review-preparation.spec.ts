import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

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
async function mount(page: Page, options: { delayMs?: number; blockDelayMs?: number; funded?: boolean; simulationFailureIndex?: number; feeDelayMs?: number } = {}) {
  const transportOptions = { delayMs: options.delayMs ?? 20, ethBalance: options.funded ? 10n ** 20n : 400000000000000n, simulationFailureIndex: options.simulationFailureIndex };
  const fixture = createFixture(transportOptions);
  fixture.setSimulationFailure = (index) => { transportOptions.simulationFailureIndex = index; };
  await page.route('**/*', async (route) => {
    const url = route.request().url();
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
      if (Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Confirm' && !button.disabled)) h.enabledConfirmSeen = true;
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await page.addStyleTag({ content: bundle.css });
  await page.addScriptTag({ content: bundle.script });
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toBeVisible();
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

test('quick review presents entered facts immediately and starts only one plan', async ({ page }) => {
  await mount(page); await fill(page); await review(page);
  await expect(page.getByRole('button', { name: 'Checking transaction…', exact: true })).toBeDisabled();
  await expect(page.getByText('0.0003 ETH', { exact: true })).toBeVisible();
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

test('Edit abandons preparation and late results cannot reopen review', async ({ page }) => {
  await mount(page); await fill(page); await review(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.0003');
  await page.waitForTimeout(1800);
  await expect(page.getByRole('button', { name: 'Review ETH Long', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
});

test('wallet change abandons the old preparation', async ({ page }) => {
  await mount(page); await fill(page); await review(page);
  await page.evaluate(() => { const h = (globalThis as typeof globalThis & { __longReview: Control }).__longReview; h.wallet = { ...h.wallet, address: '0x2222222222222222222222222222222222222222', connectionVersion: 2 }; h.rerender?.(); });
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('');
  await page.waitForTimeout(1800);
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
});

test('fresh-cache visibility refresh disables confirmation until the request settles', async ({ page }) => {
  await mount(page, { funded: true, delayMs: 100 }); await fill(page); await review(page);
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true }); await expect(confirm).toBeEnabled();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Checking network fees…', exact: true })).toBeDisabled();
  await expect(confirm).toBeEnabled();
});

async function geometry(page: Page, seed = false) {
  return page.evaluate((seed) => {
    const selectors = ['[data-review-viewport]', '[data-review-fact="Amount"]', '[data-review-fact="Target leverage"]', '[data-review-fact="Position"]', '[data-review-fact="Slippage"]', '[data-review-viewport] > :last-child button'];
    const nodes = selectors.map(selector => document.querySelector(selector)!);
    const global = window as unknown as { __reviewNodes?: Element[] };
    if (seed) global.__reviewNodes = nodes;
    return { same: nodes.map((node,index) => node === global.__reviewNodes?.[index]), boxes: nodes.map(node => { const r=node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; }) };
  }, seed);
}
for (const viewport of [{ width:393,height:920 }, { width:320,height:568 }, { width:768,height:1024 }, { width:1100,height:1200 }]) {
  test(`one review card keeps known fields stable and its action reachable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport); await mount(page,{feeDelayMs:650}); await fill(page); await review(page);
    await expect(page.getByRole('button',{name:'Checking transaction…',exact:true})).toBeDisabled();
    await page.waitForTimeout(120); const before = await geometry(page,true);
    await expect(page.getByRole('button',{name:'Checking network fees…',exact:true})).toBeDisabled();
    const during = await geometry(page); await insufficient(page); const after = await geometry(page);
    for (const frame of [during, after]) {
      expect(frame.same.every(Boolean)).toBe(true);
      // Content may now fit more closely after preparation. Keep the known
      // fields mounted and anchored, without reserving a fixed-height card.
      for (let i = 1; i < 5; i++) for (const key of ['x', 'y', 'width', 'height'] as const) {
        // On a short screen, fitting content can clamp the outer scroll a few
        // pixels. The card's own known-field arrangement must remain stable.
        const relative = key === 'x' || key === 'y';
        const previous = before.boxes[i][key] - (relative ? before.boxes[0][key] : 0);
        const current = frame.boxes[i][key] - (relative ? frame.boxes[0][key] : 0);
        expect(Math.abs(current - previous), `known row ${i} ${key}`).toBeLessThanOrEqual(1);
      }
      const action = frame.boxes.at(-1)!;
      expect(action.height).toBeGreaterThanOrEqual(44);
      expect(action.y + action.height).toBeLessThanOrEqual(viewport.height);
    }
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
test('a Max-length exact amount stays inside the card at 320px while preparing and once checked', async ({ page }) => {
  // The owner's phone report (9.jpg): light theme, preparing, and a 17-decimal
  // amount pushed the value column out of the card ("New position" read "Nev").
  await page.setViewportSize({ width: 320, height: 640 });
  await mount(page, { feeDelayMs: 650 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
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
    // Exact, never "≈", before and after the route is checked.
    await expect(page.locator('[data-review-fact="Amount"] > span').last()).toHaveText('0.00024443113696627 ETH');
    for (const [label, value] of [['Target leverage', '2.8×'], ['Position', 'New position']]) {
      const cell = page.locator(`[data-review-fact="${label}"] > span`).last();
      await expect(cell).toHaveText(value);
      await expect(cell).toBeInViewport();
    }
  };
  await expect(page.getByRole('button', { name: 'Checking transaction…', exact: true })).toBeDisabled();
  await expectInsideCard();
  await insufficient(page);
  await expectInsideCard();
  await expect(page.locator('p', { hasText: 'Add at least' })).toHaveText(/^Add at least \d[\d,]*(?:\.\d+)? ETH on Ethereum to cover network fees\. Receive ETH$/);
  // The fee is the max the wallet funds, so the ETH to add is exactly the
  // total shown (amount plus that max) less the fixture's 0.0004 ETH balance.
  const toWei = (text: string) => {
    const [whole, fraction = ''] = /([\d,]+(?:\.\d+)?) ETH/.exec(text)![1].replace(/,/g, '').split('.');
    return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  };
  await expect(page.locator('[data-review-fact="Gas fee"] > span').last()).toHaveText(/ ETH max$/);
  const total = await page.locator('[data-review-fact="Total cost"] > span').last().innerText();
  expect(total).toMatch(/ ETH max$/);
  const asked = await page.locator('p', { hasText: 'Add at least' }).innerText();
  expect(toWei(asked)).toBe(toWei(total) - 400000000000000n);
});

test('failed preparation stays in the same card and Retry performs a fresh check', async ({page}) => {
  const fixture=await mount(page,{simulationFailureIndex:0}); await fill(page); await review(page);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await geometry(page,true); // seed the node identities compared below
  await expect(page.getByRole('button',{name:'Retry review',exact:true})).toBeEnabled();
  expect((await geometry(page)).same.every(Boolean)).toBe(true);
  await expect(page.getByRole('button',{name:'Confirm',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Checking transaction steps')).toHaveCount(0);
  fixture.setSimulationFailure?.(undefined);
  await page.getByRole('button',{name:'Retry review',exact:true}).click(); await insufficient(page);
  const after=await geometry(page); expect(after.same.every(Boolean)).toBe(true);
  expect(after.boxes.at(-1)!.height).toBeGreaterThanOrEqual(44);
  expect(after.boxes.at(-1)!.y + after.boxes.at(-1)!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & {__longReview:Control}).__longReview.events.filter(event=>event.name==='prepareRoutesForReview').length)).toBe(2);
});
test('Telegram Back cancels retained failed preparation and returns to the editor', async ({page}) => {
  await mount(page,{simulationFailureIndex:0}); await fill(page); await review(page);
  await expect(page.getByRole('button',{name:'Retry review',exact:true})).toBeEnabled();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('fxaeon:telegram-back')));
  await expect(page.getByRole('textbox',{name:'Amount in ETH'})).toHaveValue('0.0003');
  await expect(page.getByRole('button',{name:'Confirm',exact:true})).toHaveCount(0);
});
