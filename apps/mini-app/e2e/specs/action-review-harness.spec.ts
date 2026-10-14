import { test, expect } from '@playwright/test';
import { openHarness, metric } from '../harness/action-review-measurement-support';
import { readReviewedTransactions } from '../fork/reviewedTransactions';
async function harnessMetrics(page: import('@playwright/test').Page): Promise<Record<string, unknown>> {
  return page.locator('[data-metrics]').evaluate((node) => JSON.parse(node.textContent || '{}') as Record<string, unknown>);
}

for (const change of ['reconnect', 'network', 'wallet mode'] as const) test(`a ${change} change committed immediately before Confirm cannot adopt an old accepted session`, async ({ page }) => {
  await openHarness(page);
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await page.evaluate((change) => {
    const h = (globalThis as typeof globalThis & { __actionReviewHarness: { wallet: { connectionVersion: number; chainId: number; isEmbedded: boolean }; confirmDuringCommit: boolean; rerender: () => void } }).__actionReviewHarness;
    h.wallet = { ...h.wallet, ...(change === 'reconnect' ? { connectionVersion: h.wallet.connectionVersion + 1 }
      : change === 'network' ? { chainId: 8453 } : { isEmbedded: true }) };
    h.confirmDuringCommit = true;
    h.rerender();
  }, change);
  expect(await metric(page, 'runner')).toBe(0);
  expect(await metric(page, 'send')).toBe(0);
  await expect(page.getByRole('button', { name: 'Review updated quote', exact: true })).toBeEnabled();
});

for (const width of [320, 1280]) for (const theme of ['official', 'dark']) for (const declined of [false, true]) {
  test(`review, wallet signature and ${declined ? 'declined' : 'result'} polish at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { presentationMode: true });
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const screenshot = async (state: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: testInfo.outputPath(`${state}.png`), fullPage: true, animations: 'disabled' });
    };
    await screenshot('input');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeEnabled();
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeInViewport();
    await screenshot('review');
    await page.evaluate(() => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: { deferWalletResponse: boolean } }).__actionReviewHarness;
      h.deferWalletResponse = true;
    });
    await confirm.click();
    const waiting = page.getByRole('button', { name: 'Confirm in wallet', exact: true });
    await expect(waiting).toBeDisabled();
    await waiting.scrollIntoViewIfNeeded();
    await expect(waiting).toBeInViewport();
    await screenshot('signature');
    await page.evaluate(reject => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: { walletResolvers: Array<(reject?: boolean) => void> } }).__actionReviewHarness;
      h.walletResolvers.shift()?.(reject);
    }, declined);
    if (declined) {
      const retry = page.getByRole('button', { name: 'Try again', exact: true });
      await expect(retry).toBeVisible();
      await retry.scrollIntoViewIfNeeded();
      await expect(retry).toBeInViewport();
      await screenshot('declined');
      return;
    }
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    const management = page.getByRole('button', { name: 'View position', exact: true });
    await management.scrollIntoViewIfNeeded();
    await expect(management).toBeInViewport();
    expect((await management.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await screenshot('result');
  });
}
type PreviewRequestSnapshot = {
  id: number;
  routeVersion: number;
  routeType: string;
  routeWalletAddress: string;
  previewWalletAddress: string;
  connectionVersion: number;
  settled: boolean;
};

async function previewRequests(page: import('@playwright/test').Page): Promise<PreviewRequestSnapshot[]> {
  return page.evaluate(() => {
    const harness = (window as typeof window & { __actionReviewHarness?: { previewRequests?: PreviewRequestSnapshot[] } }).__actionReviewHarness;
    return (harness?.previewRequests ?? []).map(({ id, routeVersion, routeType, routeWalletAddress, previewWalletAddress, connectionVersion, settled }) => ({
      id, routeVersion, routeType, routeWalletAddress, previewWalletAddress, connectionVersion, settled,
    }));
  });
}

/** How far the review spills sideways: the page, the card's scroll body, and any label or value cell. */
async function reviewOverflow(review: import('@playwright/test').Locator) {
  return review.evaluate((node) => {
    const body = node.querySelector<HTMLElement>('[aria-label="Review information"]')!;
    const bounds = body.getBoundingClientRect();
    const rows = Array.from(node.querySelectorAll<HTMLElement>('[data-review-fact]')).filter((row) => row.getBoundingClientRect().height > 0);
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      escaped: rows.flatMap((row) => Array.from(row.children).map((cell) => {
        const box = cell.getBoundingClientRect();
        return box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5 ? row.dataset.reviewFact : null;
      })).filter(Boolean),
    };
  });
}

async function expectReviewInside(review: import('@playwright/test').Locator) {
  const fit = await reviewOverflow(review);
  expect(fit.pageOverflow, 'no horizontal page overflow').toBeLessThanOrEqual(0);
  expect(fit.bodyOverflow, 'no hidden horizontal overflow inside the card').toBeLessThanOrEqual(0);
  expect(fit.escaped, 'every label and value stays inside the card').toEqual([]);
}

for (const estimateKind of ['fxSAVE', 'Move'] as const) {
test(`${estimateKind} planning and refresh delays cannot extend the accepted quote signing window`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await openHarness(page);
  await page.evaluate((estimateKind) => {
    const h = (window as typeof window & { __actionReviewHarness: { reviewRoute?: unknown; previewDelayMs: number; rerender?: () => void } }).__actionReviewHarness;
    const wallet = '0x00000000000000000000000000000000000000aa';
    const router = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';
    const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    h.previewDelayMs = 10_000;
    h.reviewRoute = {
      operation: 'withdrawFxSave', chainId: 1, walletAddress: wallet,
      transactions: [{ chainId: 1, from: wallet, to: router, data: '0x6d701088', value: 0n, kind: 'action', type: 'instantRedeem', operation: 'withdrawFxSave' }],
      policy: { walletAddress: wallet, chainId: 1, reviewedAction: { kind: 'fxsave-withdraw', tokenOutAddress: usdc, amount: 100n * 10n ** 18n, receiver: wallet, directBasePool: false, instant: true, slippagePercent: 0.5 } },
      details: { fxSaveQuote: { kind: 'instant-withdraw', inputAmount: (100n * 10n ** 18n).toString(), tokenAddress: usdc, actionTo: router, actionData: '0x6d701088', readAt: Date.now(), estimatedOutput: '99000000', instantFeeRatio: '10000000000000000', grossFxUSD: '60000000000000000000', netFxUSD: '59400000000000000000', grossUSDC: '40000000', netUSDC: '39600000' } },
    };
    if (estimateKind === 'Move') {
      const route = h.reviewRoute as { operation: string; details?: unknown; policy?: unknown; quote?: unknown };
      route.operation = 'buildBridgeTx';
      delete route.details;
      delete route.policy;
      route.quote = { nativeFee: 0n, bridgeToken: 'fxUSD', bridgeAmount: 100n * 10n ** 18n, estimatedReceived: 100n * 10n ** 18n, receiptReadAt: Date.now() };
    }
    h.rerender?.();
  }, estimateKind);
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
  const refresh = page.getByRole('button', { name: 'Review updated quote', exact: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await expect.poll(() => metric(page, 'prepare')).toBe(attempt + 1);
    await page.clock.runFor(10_001);
    await expect(confirm).toBeEnabled();
    await page.clock.runFor(20_001);
    await expect(confirm).toHaveCount(0);
    await expect(refresh).toBeEnabled();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    if (attempt === 0) {
      await page.evaluate((estimateKind) => {
        const h = (window as typeof window & { __actionReviewHarness: { reviewRoute: { details?: { fxSaveQuote: { readAt: number } }; quote?: { receiptReadAt: number } } } }).__actionReviewHarness;
        if (estimateKind === 'Move') h.reviewRoute.quote!.receiptReadAt = Date.now();
        else h.reviewRoute.details!.fxSaveQuote.readAt = Date.now();
      }, estimateKind);
      await refresh.click();
    }
  }
});
}

test('fxSAVE review keeps net proceeds, its accepted fee and availability visible; stale estimates expire', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  await page.clock.install();
  await openHarness(page);
  await page.evaluate(() => {
    const h = (window as typeof window & { __actionReviewHarness: { reviewRoute?: unknown; reviewOperationLabel?: string; rerender?: () => void } }).__actionReviewHarness;
    const wallet = '0x00000000000000000000000000000000000000aa';
    const router = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';
    const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    h.reviewOperationLabel = 'Review withdrawal';
    h.reviewRoute = {
      operation: 'withdrawFxSave', chainId: 1, walletAddress: wallet,
      transactions: [{ chainId: 1, from: wallet, to: router, data: '0x6d701088', value: 0n, kind: 'action', type: 'instantRedeem', operation: 'withdrawFxSave' }],
      policy: { walletAddress: wallet, chainId: 1, reviewedAction: { kind: 'fxsave-withdraw', tokenOutAddress: usdc, amount: 100n * 10n ** 18n, receiver: wallet, directBasePool: false, instant: true, slippagePercent: 0.5 } },
      details: { fxSaveQuote: { kind: 'instant-withdraw', inputAmount: (100n * 10n ** 18n).toString(), tokenAddress: usdc, actionTo: router, actionData: '0x6d701088', readAt: Date.now(), estimatedOutput: '99000000', instantFeeRatio: '10000000000000000', grossFxUSD: '60000000000000000000', netFxUSD: '59400000000000000000', grossUSDC: '40000000', netUSDC: '39600000' } },
    };
    h.rerender?.();
  });
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  const review = page.locator('.reviewInlineContent');
  await expect(review.locator('[data-review-fact="Estimated received"]')).toHaveText('Estimated received99 USDC');
  await expect(review.locator('[data-review-fact="f(x) fee"]')).toHaveText('f(x) fee1%');
  await expect(review.locator('[data-review-fact="Availability"]')).toContainText('After confirmation');
  await expect(review.getByText('More details', { exact: true })).toBeVisible();
  await expect(review.locator('[data-review-fact="Mode"]')).toBeHidden();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expectReviewInside(review);
    if (width === 390) await review.screenshot({ path: testInfo.outputPath('fxsave-review-mobile.png') });
  }
  expect(await metric(page, 'send')).toBe(0);
  await page.clock.fastForward(30_001);
  await expect(review.locator('[data-review-fact="Estimated received"]')).toContainText('Unavailable');
  await expect(review.locator('[data-review-fact="f(x) fee"]')).toContainText('Unavailable');
});

async function resolvePreviewRequest(page: import('@playwright/test').Page, requestId: number): Promise<void> {
  const resolved = await page.evaluate((id) => {
    const harness = (window as typeof window & {
      __actionReviewHarness?: { previewRequests?: Array<{ id: number; settled: boolean; resolve: () => void }> };
    }).__actionReviewHarness;
    const request = harness?.previewRequests?.find((candidate) => candidate.id === id);
    if (!request || request.settled) return false;
    request.resolve();
    return true;
  }, requestId);
  expect(resolved, `preview request ${requestId} should be pending before resolution`).toBe(true);
}

test.describe('ActionReview isolated orchestration', () => {
  test('renders each reviewed transaction once in Steps with exact wei and calldata', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page);
    await page.getByRole('button', { name: 'Use approval route', exact: true }).click();
    await page.getByRole('button', { name: 'Use multi-step route', exact: true }).click();
    await page.getByRole('button', { name: 'Use nonzero transaction values', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();

    const review = page.locator('.reviewInlineContent');
    const stepsSummary = review.getByText('Steps · 3', { exact: true });
    await expect(stepsSummary).toBeHidden();
    await expect(review.locator('details[aria-label="Review details"]')).toHaveJSProperty('open', false);
    const advanced = review.locator('details').filter({ has: review.getByText('Technical information', { exact: true }) });
    await expect(advanced).toHaveCount(0);
    await expect(review.getByText('Prepared transactions', { exact: true })).toHaveCount(0);
    const reviewed = await readReviewedTransactions(review, { collapseAfterRead: false });
    expect(reviewed.map((transaction) => transaction.heading)).toEqual(['Approve fxUSD 1', 'Confirm 2', 'Confirm 3']);
    expect(reviewed.map((transaction) => transaction.status)).toEqual(['Ready', 'Ready', 'Ready']);
    expect(reviewed.some((transaction) => transaction.status === 'Confirmed')).toBe(false);
    expect(reviewed.map((transaction) => transaction.valueWei)).toEqual(['0', '123', '456']);
    expect(reviewed.map((transaction) => transaction.calldata)).toEqual([
      `0x095ea7b3${'0'.repeat(24)}${'0'.repeat(40)}${'0'.repeat(63)}1`,
      '0x12345678',
      '0x87654321',
    ]);
    const steps = review.getByRole('region', { name: 'Prepared transactions', exact: true });
    const cards = steps.getByRole('group', { name: /^Transaction \d+$/ });
    for (let index = 0; index < await cards.count(); index += 1) {
      const dimensions = await cards.nth(index).evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
      expect(dimensions.scrollWidth, `transaction ${index + 1} must fit without horizontal overflow`).toBeLessThanOrEqual(dimensions.clientWidth);
    }
    expect(await metric(page, 'send')).toBe(0);

    // Keep the stress route assertions above, but capture a representative
    // approval-plus-action review instead of presenting the synthetic third
    // step as a normal product state.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { multiStepExecution: boolean; rerender?: () => void } }).__actionReviewHarness;
      if (!harness) throw new Error('ActionReview fixture state is missing');
      harness.multiStepExecution = false;
      harness.rerender?.();
    });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(review.getByText('Steps · 2', { exact: true })).toBeHidden();
    const representative = await readReviewedTransactions(review, { collapseAfterRead: false });
    expect(representative.map((transaction) => transaction.heading)).toEqual(['Approve fxUSD 1', 'Confirm 2']);
    expect(representative.map((transaction) => transaction.status)).toEqual(['Ready', 'Ready']);
    await expect(steps).toHaveCount(1);
    await steps.evaluate((node) => {
      const label = document.createElement('p');
      label.textContent = 'Synthetic test fixture · no wallet signature requested';
      label.style.cssText = 'font-size:10px;color:var(--mut);padding:0 0 8px';
      node.prepend(label);
    });
    await page.locator('[role="toolbar"]').evaluate((node) => { (node as HTMLElement).style.display = 'none'; });
    await steps.scrollIntoViewIfNeeded();
    await steps.screenshot({ path: testInfo.outputPath('action-review-steps-expanded.png') });
    expect(await metric(page, 'send')).toBe(0);
  });

  test('primary action names the required token approval and fee tier reaches wallet request fields', async ({ page }) => {
    await page.goto('/token-icons/eth.png', { waitUntil: 'load' });
    await openHarness(page);
    await page.getByRole('button', { name: 'Toggle embedded wallet mode', exact: true }).click();
    await page.getByRole('button', { name: 'Use approval route', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const approval = page.getByRole('button', { name: 'Approve fxUSD', exact: true });
    await expect(approval).toBeVisible();

    const rapid = page.locator('input[name="review-gas-tier"][value="rapid"]');
    await page.getByText('Network speed', { exact: true }).click();
    await rapid.scrollIntoViewIfNeeded();
    await rapid.check({ force: true });
    await expect(rapid).toBeChecked();
    await approval.click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(2);
    const sent = await page.evaluate(() => (globalThis as typeof globalThis & { __actionReviewHarness?: { sentTransactions?: Array<{ maxFeePerGas?: string; maxPriorityFeePerGas?: string }> } }).__actionReviewHarness?.sentTransactions);
    expect(sent?.[0]).toEqual({ maxFeePerGas: '60000000000', maxPriorityFeePerGas: '20000000000' });
  });

  test('approval sequence advances only after the first receipt and keeps wallet waiting distinct', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use approval route', exact: true }).click();
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const sequence = page.getByRole('list', { name: 'Transaction sequence' });
    await expect(sequence.locator('li[aria-current="step"]')).toContainText('Approve fxUSD');
    await page.getByRole('button', { name: 'Approve fxUSD', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm in wallet', exact: true })).toBeDisabled();
    expect(await metric(page, 'send')).toBe(1);
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Resolve wallet response', exact: true }).click();
    await expect(sequence.locator('li[data-complete]')).toContainText('Approve fxUSD');
    await expect(sequence.locator('li[aria-current="step"]')).toContainText('Confirm');
    await expect(page.getByRole('button', { name: 'Confirm in wallet', exact: true })).toBeDisabled();
    expect(await metric(page, 'send')).toBe(2);
    await page.getByRole('button', { name: 'Resolve wallet response', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
  });

  test('external wallets see estimated gas without fee tiers and receive no app fee caps', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Gas estimate current', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('.reviewInlineContent');
    // The most the network fee can take: the buffered gas limit the wallet funds.
    await expect(review.locator('[data-review-fact="Gas fee"] > span').last()).toHaveText('0.001008 ETH max');
    await expect(page.locator('input[name="review-gas-tier"]')).toHaveCount(0);
    expect((await harnessMetrics(page)).feeQuoteCount).toBe(0);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect((await harnessMetrics(page)).hasFeeSelection).toBe(false);
    const feeFields = await page.evaluate(() => {
      const sent = (globalThis as typeof globalThis & { __actionReviewHarness?: { sentTransactions?: Array<{ maxFeePerGas?: string; maxPriorityFeePerGas?: string }> } }).__actionReviewHarness?.sentTransactions?.[0];
      return { maxFeePerGas: sent?.maxFeePerGas, maxPriorityFeePerGas: sent?.maxPriorityFeePerGas };
    });
    expect(feeFields).toEqual({});
    expect((await harnessMetrics(page)).feeQuoteCount).toBe(0);
  });

  test('changing wallet mode invalidates an accepted embedded-fee review', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Toggle embedded wallet mode', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.locator('input[name="review-gas-tier"]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Toggle embedded wallet mode', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    await expect(page.locator('input[name="review-gas-tier"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect((await harnessMetrics(page)).hasFeeSelection).toBe(false);
  });

  test('compact review fits mobile and expanded confirmation stays in document flow', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 393, height: 852 });
    // The harness mounts into the current document; seed a real viewport meta
    // so mobile emulation does not retain the blank page's 980px layout width.
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { presentationMode: true });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Confirm position changes', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Increase ETH Long', exact: true })).toBeVisible();
    await expect(page.getByText('0.25 fxUSD', { exact: true })).toBeVisible();
    await expect(page.getByText('3×', { exact: true })).toBeVisible();
    await expect(page.getByText('0.001008 ETH max', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary navigation', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trade', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[role="toolbar"]')).toBeHidden();
    const box = await confirm.boundingBox();
    const navBox = await page.locator('[data-fixed-navigation="true"]').boundingBox();
    const headerBox = await page.locator('.app-topbar').boundingBox();
    expect(box).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(393);
    expect(box!.y).toBeGreaterThan(headerBox!.y + headerBox!.height);
    expect(box!.y + box!.height).toBeLessThanOrEqual(navBox!.y);
    const review = page.locator('[data-review-viewport]');
    const reviewBox = await review.boundingBox();
    expect(reviewBox!.height, 'collapsed review should occupy at most half the mobile viewport').toBeLessThanOrEqual(426);
    await expect(review.locator('summary').filter({ hasText: /^Steps ·/ })).toBeHidden();
    const details = review.locator('details[aria-label="Review details"]');
    await details.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveJSProperty('open', true);
    await page.keyboard.press('Enter');
    await expect(details).toHaveJSProperty('open', false);
    // Expanded metadata grows the card; the action follows it in document flow.
    await review.locator('details').evaluateAll((nodes) => nodes.forEach((node) => { (node as HTMLDetailsElement).open = true; }));
    const scrollBody = page.getByRole('region', { name: 'Review information', exact: true });
    expect(await scrollBody.evaluate((node) => getComputedStyle(node).overflowY)).not.toBe('auto');
    expect((await confirm.boundingBox())!.y).toBeGreaterThan(box!.y);
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('action-review-expanded-flow.png') });
    for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      await confirm.scrollIntoViewIfNeeded();
      await expect.poll(async () => {
        const action = await confirm.boundingBox();
        const bottom = await page.locator('[data-fixed-navigation="true"]').evaluate((node) => {
          const box = node.getBoundingClientRect();
          return box.height > 0 ? box.top : window.innerHeight;
        });
        return Boolean(action && action.y >= 0 && action.y + action.height <= bottom);
      }, { message: `expanded review confirmation fits ${size.width}×${size.height}` }).toBe(true);
    }
    await page.setViewportSize({ width: 393, height: 852 });
    await review.locator('details').evaluateAll((nodes) => nodes.forEach((node) => { (node as HTMLDetailsElement).open = false; }));
    await review.scrollIntoViewIfNeeded();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const duration = await details.locator(':scope > summary svg').evaluate((node) => getComputedStyle(node).transitionDuration);
    // The global reduced-motion reset uses 0.01ms to preserve end events.
    expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001);
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(852);
    await page.screenshot({ path: testInfo.outputPath('action-review-393x852.png') });
    // A narrow review on a wide viewport must remain one label/value column.
    await page.setViewportSize({ width: 1440, height: 1000 });
    const amountRow = page.getByText('Amount', { exact: true }).locator('..');
    const leverageRow = page.getByText('Target leverage', { exact: true }).locator('..');
    const amountBox = await amountRow.boundingBox();
    const leverageBox = await leverageRow.boundingBox();
    expect(leverageBox!.y).toBeGreaterThanOrEqual(amountBox!.y + amountBox!.height);
    expect(Math.abs(leverageBox!.x - amountBox!.x)).toBeLessThan(1);
    expect(await review.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('action-review-desktop.png') });
  });

  test('explicit review never signs until the separate confirmation action', async ({ page }) => {
    await openHarness(page);
    const review = page.getByRole('button', { name: 'Review position', exact: true });
    await expect(review).toBeEnabled();
    await review.click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeVisible();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    await confirm.click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('locks the accepted route while the wallet response is pending', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Wallet approval', { exact: true })).toBeVisible();
    const progressDetails = page.locator('summary#transaction-steps-heading').locator('..');
    await expect(progressDetails).toHaveJSProperty('open', false);

    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(1);
    expect(await metric(page, 'runner')).toBe(1);

    await page.getByRole('button', { name: 'Resolve wallet response', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    const executedRouteVersion = await page.evaluate(() => (window as typeof window & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion);
    expect(executedRouteVersion).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps a deferred send visible after account change and stops later signatures', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use multi-step route', exact: true }).click();
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Wallet approval', { exact: true })).toBeVisible();
    // The wallet prompt names the exact request, including its place in the route.
    await expect(page.getByText('Confirm Open position v1 (step 1 of 2). Review it in your wallet.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Switch account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('selected wallet changed during this action');
    await page.getByRole('button', { name: 'Resolve wallet response', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Partially completed', exact: true })).toBeVisible();
    await expect(page.getByText('0x1111111111111111111111111111111111111111111111111111111111111111')).toBeVisible();
    expect(await metric(page, 'send')).toBe(1);
    const callbacks = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { refreshStarted?: boolean; completeStarted?: boolean } }).__actionReviewHarness;
      return { refreshStarted: harness?.refreshStarted, completeStarted: harness?.completeStarted };
    });
    expect(callbacks).toEqual({ refreshStarted: false, completeStarted: false });
  });

  test('keeps an execution latched through disconnect and reconnect while its wallet prompt is pending', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Wallet approval', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resolve wallet response', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(1);
    const callbacks = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { refreshStarted?: boolean; completeStarted?: boolean } }).__actionReviewHarness;
      return { refreshStarted: harness?.refreshStarted, completeStarted: harness?.completeStarted };
    });
    expect(callbacks).toEqual({ refreshStarted: false, completeStarted: false });
  });

  test('allows the requested chain switch without invalidating the executing route', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Start on Base', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps the wallet-scoped draft when an invalidated wallet request is rejected', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Wallet approval', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Switch account', exact: true }).click();
    await page.getByRole('button', { name: 'Reject wallet response', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Not completed', exact: true })).toBeVisible();
    const drafts = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { draftSaveCount?: number; draftCancelCount?: number; draftRemoveCount?: number } }).__actionReviewHarness;
      return { saved: harness?.draftSaveCount, canceled: harness?.draftCancelCount, removed: harness?.draftRemoveCount };
    });
    expect(drafts).toEqual({ saved: 1, canceled: 0, removed: 0 });
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps the draft after approval when action signing is rejected, then replans on resume', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use approval route', exact: true }).click();
    await page.getByRole('button', { name: 'Reject action signature', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Approve fxUSD', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Approval confirmed', exact: true })).toBeVisible();

    const beforeResume = await metric(page, 'plan');
    const retainedDraft = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { draftSaveCount?: number; draftCancelCount?: number; draftRemoveCount?: number; sendCount?: number } }).__actionReviewHarness;
      return { saved: harness?.draftSaveCount, canceled: harness?.draftCancelCount, removed: harness?.draftRemoveCount, sends: harness?.sendCount };
    });
    expect(retainedDraft).toEqual({ saved: 1, canceled: 0, removed: 0, sends: 2 });

    await page.getByRole('button', { name: 'Unmount review', exact: true }).click();
    await page.getByRole('button', { name: 'Mount review', exact: true }).click();
    await page.getByRole('button', { name: 'Resume review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve fxUSD', exact: true })).toBeVisible();
    expect(await metric(page, 'plan')).toBeGreaterThan(beforeResume);
    expect(await page.getByRole('heading', { name: 'Approval confirmed', exact: true }).count()).toBe(0);
  });

  test('Continue action returns to an editable form and cancels the approval-only resume draft', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use approval route', exact: true }).click();
    await page.getByRole('button', { name: 'Reject action signature', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Approve fxUSD', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Approval confirmed', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue action', exact: true }).click();
    const drafts = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { draftSaveCount?: number; draftCancelCount?: number; draftRemoveCount?: number } }).__actionReviewHarness;
      return { saved: harness?.draftSaveCount, canceled: harness?.draftCancelCount, removed: harness?.draftRemoveCount };
    });
    expect(drafts).toEqual({ saved: 1, canceled: 1, removed: 0 });
  });

  test('does not publish a deferred wallet response after the review unmounts', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Wallet approval', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Unmount review', exact: true }).click();
    await page.getByRole('button', { name: 'Resolve wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Mount review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toHaveCount(0);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('does not publish a late wallet refresh after the review unmounts', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Defer wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { refreshStarted?: boolean } }).__actionReviewHarness?.refreshStarted))).toBe(true);
    await page.getByRole('button', { name: 'Unmount review', exact: true }).click();
    await page.getByRole('button', { name: 'Resolve wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Mount review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toHaveCount(0);
  });

  test('keeps a fee placeholder while gas is loading and shows unavailable when estimation fails', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Gas estimate loading', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('.reviewInlineContent');
    await expect(review.getByText('Network fee', { exact: true })).toBeVisible();
    await expect(page.locator('.missing-value[aria-label="Loading gas fee"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Checking network fees…', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: 'Gas estimate unavailable', exact: true }).click();
    await expect(review).toContainText('Unavailable');
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade keeps reviewed fields bound to the signed route through live input and wallet changes', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use stable Trade review', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-review-viewport]');
    const originalFacts = { Amount: '0.25 fxUSD', 'Target leverage': '3×', Position: '#42', Slippage: '0.5%' };
    const expectOriginalFacts = async () => {
      for (const [label, value] of Object.entries(originalFacts)) {
        await expect(review.locator(label === "Amount" ? `[data-review-fact="Amount"] summary > span` : label === "Target leverage" ? `[data-review-fact="Target leverage"]` : `[data-review-fact="${label}"] > span`).last()).toHaveText(value);
      }
    };
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
    await expectOriginalFacts();
    // Parent presentation updates alone must not rewrite the accepted quote.
    await page.getByRole('button', { name: 'Change preparation facts', exact: true }).click();
    await expectOriginalFacts();

    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Open position', exact: true }).click();
    await expect(page.getByText('Wallet approval', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await page.getByRole('button', { name: 'Switch account', exact: true }).click();
    await expectOriginalFacts();
    await expect(page.getByRole('heading', { name: 'Review position v1', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('selected wallet changed during this action');
    expect(await metric(page, 'send')).toBe(1);
    await page.getByRole('button', { name: 'Resolve wallet response', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as typeof window & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion)).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('stable Trade does not fill missing verified fields from live preparation facts', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.getByRole('button', { name: 'Use stable Trade review', exact: true }).click();
    await page.getByRole('button', { name: 'Omit reviewed leverage', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const leverage = page.locator('[data-review-fact="Target leverage"]').last();
    await expect(leverage).toHaveText('3×');
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    await resolvePreviewRequest(page, (await previewRequests(page))[0]!.id);
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
    await expect(leverage).toHaveText('Unavailable');
    await page.getByRole('button', { name: 'Change preparation facts', exact: true }).click();
    await expect(leverage).toHaveText('Unavailable');
    await expect(page.locator('[data-review-fact="Amount"] summary > span').last()).toHaveText('0.25 fxUSD');
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade new preparation clears old expiry, updated consequences, and gas tier prices', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await openHarness(page);
    await page.getByRole('button', { name: 'Use stable Trade review', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle embedded wallet mode', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-review-viewport]');
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
    await review.getByText('Network speed', { exact: true }).click();
    await expect(review.getByText('25 Gwei', { exact: true })).toBeVisible();
    await page.clock.runFor(31_001);
    await page.getByRole('button', { name: 'Change quote terms to v2', exact: true }).click();
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    const changes = review.getByRole('region', { name: 'Updated transaction consequences' });
    await expect(changes).toContainText('Terms 1 → Terms 2');
    await page.clock.runFor(31_001);
    await expect(review).toContainText('Quote expired.');
    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await page.getByRole('button', { name: 'Defer preview', exact: true }).click();
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(3);
    await expect(review).toHaveAttribute('aria-busy', 'true');
    await expect(review.getByText('Quote expired.', { exact: false })).toHaveCount(0);
    await expect(changes).toHaveCount(0);
    await expect(review.getByText(/^(25|30|40) Gwei$/)).toHaveCount(0);
    for (const tier of ['standard', 'fast', 'rapid']) {
      await expect(review.locator(`.missing-value[aria-label="Loading ${tier} gas price"]`)).toHaveCount(1);
    }
    await expect(page.getByRole('button', { name: 'Checking transaction…', exact: true })).toBeDisabled();
    await resolvePreviewRequest(page, (await previewRequests(page))[0]!.id);
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
    await expect(review).toHaveAttribute('aria-busy', 'false');
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade preserves self-clamp failure and keyboard Retry focuses a fresh busy preparation', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use stable Trade review', exact: true }).click();
    await page.getByRole('button', { name: 'Clamp next preparation', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-review-viewport]');
    await expect(page.getByRole('alert')).toHaveText('Pool leverage limits changed to 4.0x-10.0x. The target was updated; review it again.');
    await expect(page.getByText('The inputs changed. Check the action again before signing.', { exact: true })).toHaveCount(0);
    await expect(review.locator('[data-review-fact="Target leverage"]').last()).toHaveText('4×');
    await expect(review).toHaveAttribute('aria-busy', 'false');
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'prepare')).toBe(0);

    await page.getByRole('button', { name: 'Defer preview', exact: true }).click();
    await page.getByRole('button', { name: 'Retry review', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(review.getByRole('heading', { name: 'Review position v2', exact: true })).toBeFocused();
    await expect(review).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Checking transaction…', exact: true })).toBeDisabled();
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const pending = (await previewRequests(page))[0]!;
    expect(pending.routeVersion).toBe(2);
    await resolvePreviewRequest(page, pending.id);
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
    await expect(review).toHaveAttribute('aria-busy', 'false');
    expect(await metric(page, 'plan')).toBe(2);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade background gas checks leave the polite announcement unchanged', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use stable Trade review', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
    await page.locator('details[aria-label="Review details"] > summary').click();
    const announcement = page.locator('[data-review-viewport] [role="status"][aria-live="polite"]');
    await expect(announcement).toHaveCount(1);
    const readyAnnouncement = await announcement.textContent();
    const liveStatuses = page.locator('[data-review-viewport] [role="status"]:not([aria-live="off"])');
    const baselineStatuses = await liveStatuses.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? node.textContent));
    await announcement.evaluate((node) => {
      const observed = window as typeof window & { __reviewAnnouncementChanges?: number };
      observed.__reviewAnnouncementChanges = 0;
      new MutationObserver((changes) => { observed.__reviewAnnouncementChanges! += changes.length; })
        .observe(node, { subtree: true, childList: true, characterData: true });
    });
    for (let refresh = 0; refresh < 2; refresh += 1) {
      await page.getByRole('button', { name: 'Gas estimate loading', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Checking network fees…', exact: true })).toBeDisabled();
      await expect(announcement).toHaveText(readyAnnouncement!);
      // role=status is implicitly polite even without an aria-live attribute.
      // Keep the existing copy-confirmation region, but row placeholders must
      // not create or change an announcement on each poll.
      expect(await liveStatuses.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? node.textContent))).toEqual(baselineStatuses);
      await page.getByRole('button', { name: 'Gas estimate current', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
      await expect(announcement).toHaveText(readyAnnouncement!);
    }
    expect(await page.evaluate(() => (window as typeof window & { __reviewAnnouncementChanges?: number }).__reviewAnnouncementChanges)).toBe(0);
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade keeps low-balance gas refresh quiet and never enables signing', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use stable Trade review', exact: true }).click();
    await page.getByRole('button', { name: 'Gas balance insufficient', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-review-viewport]');
    const announcement = review.locator('[role="status"][aria-live="polite"]');
    await expect(page.getByRole('button', { name: 'Not enough ETH', exact: true })).toBeDisabled();
    await expect(announcement).toHaveCount(1);
    const liveStatuses = review.locator('[role="status"]:not([aria-live="off"])');
    const baselineStatuses = await liveStatuses.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? node.textContent));
    await liveStatuses.evaluateAll((nodes) => {
      const observed = window as typeof window & { __reviewLowBalanceStatusChanges?: number };
      observed.__reviewLowBalanceStatusChanges = 0;
      for (const node of nodes) {
        new MutationObserver((changes) => { observed.__reviewLowBalanceStatusChanges! += changes.length; })
          .observe(node, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['role', 'aria-live', 'aria-label'] });
      }
    });
    const expectCheckedRoute = async () => {
      for (const [label, value] of Object.entries({ Amount: '0.25 fxUSD', 'Target leverage': '3×', Position: '#42', Slippage: '0.5%' })) {
        await expect(review.locator(label === "Amount" ? `[data-review-fact="Amount"] summary > span` : label === "Target leverage" ? `[data-review-fact="Target leverage"]` : `[data-review-fact="${label}"] > span`).last()).toHaveText(value);
      }
      expect(await liveStatuses.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? node.textContent))).toEqual(baselineStatuses);
      await expect(page.getByRole('button', { name: 'Open position', exact: true })).toHaveCount(0);
    };
    for (let refresh = 0; refresh < 2; refresh += 1) {
      await expect(page.getByRole('button', { name: 'Not enough ETH', exact: true })).toBeDisabled();
      // The notice names the exact top-up on the network that pays it, and
      // links to the wallet's Receive. With nothing else to send and an empty
      // wallet, that is exactly the max fee the card shows.
      await expect(review.locator('p', { hasText: 'Add at least' })).toHaveText('Add at least 0.001008 ETH on Ethereum to cover network fees. Receive ETH');
      await expect(review.locator('[data-review-fact="Gas fee"] > span').last()).toHaveText('0.001008 ETH max');
      await expect(review.getByRole('link', { name: 'Receive ETH', exact: true })).toHaveAttribute('href', '/qr');
      await expectCheckedRoute();
      // A TTL refresh removes current but retains its insufficient previous
      // estimate; the shortfall remains blocked by the active fee check.
      await page.getByRole('button', { name: 'Refresh expired gas estimate', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Checking network fees…', exact: true })).toBeDisabled();
      await expectCheckedRoute();
      await page.getByRole('button', { name: 'Gas balance insufficient', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Not enough ETH', exact: true })).toBeDisabled();
      await expectCheckedRoute();
    }
    expect(await page.evaluate(() => (window as typeof window & { __reviewLowBalanceStatusChanges?: number }).__reviewLowBalanceStatusChanges)).toBe(0);
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'prepare')).toBe(1);
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('every review names the exact ETH shortfall on the network that pays it', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Gas balance insufficient', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-review-viewport]');
    const action = page.getByRole('button', { name: 'Not enough ETH', exact: true });
    await expect(action).toBeDisabled();
    const note = review.locator('[role="status"]', { hasText: 'Add at least' });
    // An empty wallet with nothing else to send needs exactly the max fee shown.
    await expect(note).toHaveText('Add at least 0.001008 ETH on Ethereum to cover network fees. Receive ETH');
    await expect(review.locator('[data-review-fact="Gas fee"] > span').last()).toHaveText('0.001008 ETH max');
    await expect(note.getByRole('link', { name: 'Receive ETH', exact: true })).toHaveAttribute('href', '/qr');
    // The product Button also carries Tailwind's disabled:opacity-50. A
    // blocked action names what is missing, so it must stay full strength.
    await action.evaluate((node) => node.classList.add('disabled:opacity-50'));
    expect(await action.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');

    // Base names Base; a partial estimate proves the gap but never invents its size.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Use Base route', exact: true }).click();
    await page.getByRole('button', { name: 'Gas balance insufficient by an unknown amount', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(review.locator('header').getByText('Base', { exact: true })).toBeVisible();
    await expect(review.locator('[role="status"]', { hasText: 'needs more ETH' })).toHaveText('This wallet needs more ETH on Base for network fees. Receive ETH');
    await expect(action).toBeDisabled();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('a long exact amount fits the stable Trade card at 320px while preparing and once verified', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { initialPreviewMode: 'deferred' });
    // The owner's report (9.jpg) was the light theme while preparing.
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.getByRole('button', { name: 'Use stable Trade review', exact: true }).click();
    await page.getByRole('button', { name: 'Use long amount', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.locator('[role="toolbar"]').evaluate((node) => { (node as HTMLElement).style.display = 'none'; });
    const review = page.locator('[data-review-viewport]');
    const amount = review.locator('[data-review-fact="Amount"] summary > span').last();
    const expectFits = async () => {
      await expectReviewInside(review);
      await expect(amount).toHaveText('≈ 0.000244431 fxUSD');
      await expect(review.locator('[data-review-fact="Amount"] summary')).toHaveAttribute('aria-label', 'Show exact amount: 0.00024443113696627 fxUSD');
      for (const [label, value] of [['Target leverage', '3×']]) {
        await expect(review.locator(label === "Amount" ? `[data-review-fact="Amount"] summary > span` : label === "Target leverage" ? `[data-review-fact="Target leverage"]` : `[data-review-fact="${label}"] > span`).last()).toHaveText(value);
        await expect(review.locator(label === "Amount" ? `[data-review-fact="Amount"] summary > span` : label === "Target leverage" ? `[data-review-fact="Target leverage"]` : `[data-review-fact="${label}"] > span`).last()).toBeInViewport();
      }
    };
    await expect(page.getByRole('button', { name: 'Checking transaction…', exact: true })).toBeDisabled();
    await expectFits();
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    await resolvePreviewRequest(page, (await previewRequests(page))[0]!.id);
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
    // Verification preserves the compact display and the exact amount behind its disclosure.
    await expectFits();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('a whole recipient address wraps inside the review at 320px instead of widening the card', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page);
    await page.getByRole('button', { name: 'Use bridge recipient', exact: true }).click();
    // The review bounds its height where it opens; open it where the card will be.
    await page.locator('[role="toolbar"]').evaluate((node) => { (node as HTMLElement).style.display = 'none'; });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-review-viewport]');
    // The summary row; Quote details repeats it, collapsed.
    const recipient = review.locator('[data-review-fact="Recipient"]').first().locator(':scope > span').last();
    await expect(recipient).toHaveText('0x00000000000000000000000000000000000000aa');
    await recipient.scrollIntoViewIfNeeded();
    await expect(recipient).toBeInViewport({ ratio: 1 });
    await expectReviewInside(review);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('preparation takes focus, names the check that is running, and a failure returns focus to Review', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Preparing review', exact: true })).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Simulating each step and checking network fees.' })).toBeVisible();
    await resolvePreviewRequest(page, (await previewRequests(page))[0]!.id);
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeFocused();

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Fail next preview', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('mock preview failure');
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeFocused();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('a check that fails before signing is told once and offers a fresh review instead of a dead Confirm', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use approval route', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const approve = page.getByRole('button', { name: 'Approve fxUSD', exact: true });
    await expect(approve).toBeEnabled();
    // The wallet will ask twice; the review says so before the first prompt.
    await expect(page.getByText('Two wallet requests: approve fxUSD, then confirm.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Fail before wallet request', exact: true }).click();
    await approve.click();
    await expect(page.getByRole('alert')).toHaveText('mock execution failure');
    await expect(page.getByText('Action stopped', { exact: true })).toHaveCount(0);
    await expect(page.getByText('This reviewed quote expired.', { exact: false })).toHaveCount(0);
    const refresh = page.getByRole('button', { name: 'Review updated quote', exact: true });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(approve).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await metric(page, 'prepare')).toBe(2);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade preserves a self-clamp during expired refresh and retries the updated input', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await openHarness(page);
    await page.getByRole('button', { name: 'Use stable Trade review', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
    await page.clock.runFor(31_001);
    await page.getByRole('button', { name: 'Clamp next preparation', exact: true }).click();
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Pool leverage limits changed to 4.0x-10.0x. The target was updated; review it again.');
    await expect(page.getByText('The inputs changed. Check the action again before signing.', { exact: true })).toHaveCount(0);
    expect(await metric(page, 'plan')).toBe(2);
    expect(await metric(page, 'prepare')).toBe(1);
    // Failed refresh keeps the previously reviewed terms visible but expired.
    await expect(page.locator('[data-review-fact="Target leverage"]').last()).toHaveText('3×');
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Defer preview', exact: true }).click();
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(2);
    const updated = (await previewRequests(page))[0]!;
    expect(updated.routeVersion).toBe(2);
    await resolvePreviewRequest(page, updated.id);
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
    await expect(page.locator('[data-review-fact="Target leverage"]').last()).toHaveText('4×');
    expect(await metric(page, 'plan')).toBe(3);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade discards a pending route when the user changes its input', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.getByRole('button', { name: 'Use stable Trade review', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const original = (await previewRequests(page))[0]!;
    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await resolvePreviewRequest(page, original.id);
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toHaveCount(0);
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(2);
    const updated = (await previewRequests(page))[1]!;
    expect(updated.routeVersion).toBe(2);
    await resolvePreviewRequest(page, updated.id);
    await expect(page.getByRole('button', { name: 'Open position', exact: true })).toBeEnabled();
    await expect(page.locator('[data-review-fact="Amount"] summary > span').last()).toHaveText('0.5 fxUSD');
    expect(await metric(page, 'send')).toBe(0);
  });

  test('keeps accepted calldata when a rerender recreates the planner for the same form intent', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Recreate planner', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    const executedRouteVersion = await page.evaluate(() => (window as typeof window & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion);
    expect(executedRouteVersion).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps reviewed terms visible but blocks signing when disabled or its planner disappears', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeEnabled();
    await page.getByRole('button', { name: 'Disable action', exact: true }).click();
    await expect(confirm).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
    await page.getByRole('button', { name: 'Enable action', exact: true }).click();
    await page.getByRole('button', { name: 'Remove planner', exact: true }).click();
    await expect(confirm).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
    await page.getByRole('button', { name: 'Restore planner', exact: true }).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(1);
  });

  test('invalidates the accepted route when the logical form intent really changes', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toHaveCount(0);
    const refresh = page.getByRole('button', { name: 'Review updated quote', exact: true });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(page.getByRole('heading', { name: 'Open position v2', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('same-tab gas-tier preference changes invalidate the accepted review until an updated quote is explicit', async ({ page }) => {
    test.setTimeout(60_000);
    // Give this isolated harness a same-origin storage area for the real
    // settings reader before replacing the document with the harness bundle.
    // Establish the app origin without carrying the HTML document's CSP into
    // the inline harness document. The static token asset is same-origin and
    // has no document policy, while localStorage remains available.
    await page.goto('/token-icons/eth.png', { waitUntil: 'load' });
    await page.evaluate(() => window.localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ slippageBps: 100, gasTier: 'fast' })));
    await openHarness(page);
    await page.getByRole('button', { name: 'Toggle embedded wallet mode', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeVisible();
    await page.getByText('Network speed', { exact: true }).click();
    const fastTier = page.locator('input[name="review-gas-tier"][value="fast"]');
    const rapidTier = page.locator('input[name="review-gas-tier"][value="rapid"]');
    await expect(fastTier).toBeChecked();
    expect(await metric(page, 'send')).toBe(0);

    await page.evaluate(() => {
      const key = 'fxaeon.settings.v1';
      const current = JSON.parse(window.localStorage.getItem(key) || '{}') as { slippageBps?: number; [key: string]: unknown };
      window.localStorage.setItem(key, JSON.stringify({ ...current, gasTier: 'rapid' }));
      window.dispatchEvent(new CustomEvent('fxaeon:settings-updated', { detail: { slippageBps: 100, gasTier: 'rapid' } }));
    });
    await expect(confirm).toHaveCount(0);
    await expect(fastTier, 'the accepted Fast fee must remain selected until the user reviews the new tier').toBeChecked();
    const reviewUpdated = page.getByRole('button', { name: 'Review updated quote', exact: true });
    await expect(reviewUpdated).toBeEnabled();
    await expect(page.getByRole('alert')).toContainText('Network fee preference changed');
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);

    await reviewUpdated.click();
    await expect(confirm).toBeVisible();
    await expect(rapidTier).toBeChecked();
    await expect(page.locator('[aria-label="Updated transaction consequences"]')).toContainText('Fast · 30 Gwei → Rapid · 40 Gwei');
    expect(await metric(page, 'prepare')).toBe(2);
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });


  test('typing and connecting do not prepare quotes; Review replaces the editor once', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await page.clock.install();
    await page.clock.runFor(16_000);
    expect(await metric(page, 'plan')).toBe(0);
    expect(await metric(page, 'prepare')).toBe(0);
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Preparing review' })).toBeVisible();
    await expect(page.getByText('Editor terms v2', { exact: true })).toHaveCount(0);
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const pending = (await previewRequests(page))[0]!;
    await resolvePreviewRequest(page, pending.id);
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await page.clock.runFor(16_000);
    expect(await metric(page, 'plan')).toBe(1);
  });

  test('Edit cancels an in-flight review and ignores its late result', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const pending = (await previewRequests(page))[0]!;
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByText('Editor terms v1', { exact: true })).toBeVisible();
    await resolvePreviewRequest(page, pending.id);
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeEnabled();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('shows the confirmed receipt while wallet refresh is pending and starts completion concurrently', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Defer wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { refreshStarted?: boolean } }).__actionReviewHarness?.refreshStarted))).toBe(true);
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { completeStarted?: boolean } }).__actionReviewHarness?.completeStarted))).toBe(true);
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
    await page.getByRole('button', { name: 'Resolve wallet refresh', exact: true }).click();
  });

  test('keeps partial-result copy accurate while the post-confirm refresh is pending', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Return partial result', exact: true }).click();
    await page.getByRole('button', { name: 'Defer wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Partially completed', exact: true })).toBeVisible();
    await expect(page.getByText('An earlier step confirmed before the action stopped.', { exact: true })).toBeVisible();
    await expect(page.getByText('Transaction confirmed. Position details are refreshing.', { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { refreshStarted?: boolean } }).__actionReviewHarness?.refreshStarted))).toBe(true);
    await page.getByRole('button', { name: 'Resolve wallet refresh', exact: true }).click();
  });

  test('discards late planning after input and wallet changes', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const original = (await previewRequests(page))[0]!;
    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await resolvePreviewRequest(page, original.id);
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(2);
    const current = (await previewRequests(page))[1]!;
    expect(current).toMatchObject({ routeVersion: 2, connectionVersion: 2 });
    await resolvePreviewRequest(page, current.id);
    await expect(page.getByRole('heading', { name: 'Open position v2', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('uses the simulated visible route if the planner changes after the quote', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Change planner after quote', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    const executedRouteVersion = await page.evaluate(() => (globalThis as typeof globalThis & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion);
    expect(executedRouteVersion).toBe(1);
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('expires a resumed review without dropping accepted terms and requires an explicit quote refresh', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await openHarness(page);
    await page.getByRole('button', { name: 'Resume review', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeVisible({ timeout: 2_000 });
    await expect(confirm).toBeEnabled();
    await expect.poll(() => metric(page, 'plan')).toBe(1);
    await expect.poll(() => metric(page, 'prepare')).toBe(1);

    await page.clock.runFor(31_000);
    // Flush a zero-delay freshness callback if React committed the review
    // effect at the end of the same fake-clock advancement.
    await page.clock.runFor(1);
    await expect(confirm).toHaveCount(0);
    const refresh = page.getByRole('button', { name: 'Review updated quote', exact: true });
    await expect(refresh).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    await page.getByRole('button', { name: 'Change quote terms to v2', exact: true }).click();
    await refresh.click();
    const changes = page.getByRole('region', { name: 'Updated transaction consequences' });
    await expect(changes).toContainText('Changed since your previous review');
    await expect(changes).toContainText('Terms 1 → Terms 2');
    await expect(confirm).toBeEnabled();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('persists a resume hint only when the wallet request starts', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const action = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(action).toBeVisible({ timeout: 2_000 });

    await page.getByRole('button', { name: 'Fail before wallet request', exact: true }).click();
    await action.click();
    await expect(page.getByRole('alert')).toContainText('mock execution failure');
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
    expect(await metric(page, 'draftSave')).toBe(0);

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await action.click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(2);
    expect(await metric(page, 'send')).toBe(1);
    expect(await metric(page, 'draftSave')).toBe(1);
  });

  test('returns to the editable form after preparation fails and retries on Review', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Fail next preview', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('mock preview failure');
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v2', exact: true })).toBeVisible();
    expect(await metric(page, 'prepare')).toBe(2);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('keeps the reviewed route through an account change before the wallet request', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const primary = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(primary).toBeVisible({ timeout: 2_000 });
    await expect(primary).toBeEnabled({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Defer before wallet request', exact: true }).click();
    await expect(primary).toBeEnabled({ timeout: 5_000 });
    await primary.click();
    await expect.poll(() => metric(page, 'runner')).toBe(1);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resolve execution', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Not completed', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
  });
});
