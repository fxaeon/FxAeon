import { test, expect } from '@playwright/test';
import { openHarness, metric } from '../harness/action-review-measurement-support';
import { readReviewedTransactions } from '../fork/reviewedTransactions';
// Fixture controls simulate wallet/RPC events outside the product dialog. They
// must not depend on clicking through the modal backdrop used by real users.
async function harnessControl(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('toolbar').getByRole('button', { name, exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
}

async function reviewExitControl(page: import('@playwright/test').Page) {
  const sheet = page.locator('[data-mobile-review-sheet]');
  return await sheet.isVisible()
    ? sheet.getByRole('button', { name: 'Close transaction review', exact: true })
    : page.locator('[data-review-edit]');
}

async function resultExitControl(page: import('@playwright/test').Page) {
  const sheet = page.locator('[data-mobile-review-sheet]');
  return await sheet.isVisible()
    ? sheet.getByRole('button', { name: 'Close transaction review', exact: true })
    : page.getByRole('button', { name: 'View position', exact: true });
}

async function visibleReviewHeader(page: import('@playwright/test').Page) {
  const sheet = page.locator('[data-mobile-review-sheet]');
  return await sheet.isVisible() ? sheet.locator(':scope > header') : page.locator('[data-review-header]');
}

async function harnessMetrics(page: import('@playwright/test').Page): Promise<Record<string, unknown>> {
  return page.locator('[data-metrics]').evaluate((node) => JSON.parse(node.textContent || '{}') as Record<string, unknown>);
}

async function expectReviewHeadingLeverage(page: import('@playwright/test').Page, value: string) {
  const heading = page.getByRole('heading', { name: `${value} ETH Long`, exact: true });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText(value);
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

for (const width of [320, 1280]) for (const theme of ['dark']) for (const declined of [false, true]) {
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
    const confirm = page.getByRole('button', { name: 'Add to position', exact: true });
    await expect(confirm).toBeEnabled();
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeInViewport();
    await screenshot('review');
    await page.evaluate(() => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: { deferWalletResponse: boolean } }).__actionReviewHarness;
      h.deferWalletResponse = true;
    });
    await confirm.click();
    const waiting = page.getByRole('region', { name: 'Transaction progress', exact: true });
    await expect(waiting).toContainText('Confirm in wallet');
    await expect(page.locator('[data-review-actions]')).toHaveCount(0);
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
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
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
  const confirm = page.getByRole('button', { name: estimateKind === 'fxSAVE' ? 'Withdraw instantly' : 'Bridge fxUSD', exact: true });
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

test('fxSAVE review keeps accepted net proceeds and availability visible but blocks an expired quote', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  await page.clock.install();
  await openHarness(page);
  await page.evaluate(() => {
    const h = (window as typeof window & { __actionReviewHarness: { reviewRoute?: unknown; reviewOperationLabel?: string; displayPrices?: Record<string, number>; rerender?: () => void } }).__actionReviewHarness;
    const wallet = '0x00000000000000000000000000000000000000aa';
    const router = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';
    const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    h.reviewOperationLabel = 'Review withdrawal';
    h.displayPrices = { fxUSD: .98, USDC: 1.01 };
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
  await expect(review.locator('[data-review-fact="Estimated received"] [data-review-amount]')).toHaveText('99 USDC');
  await expect(review.locator('[data-review-fact="Estimated received"] summary')).toHaveCount(0);
  await expect(review.locator('[data-review-fact="Estimated received"]').getByText('Receive · estimated', { exact: true })).toBeVisible();
  const fee = review.locator('[data-review-fact="f(x) fee"]');
  await review.locator('details[aria-label="Advanced transaction details"] > summary').click();
  await expect(fee.locator('[data-usd-state]')).toHaveText('≈ $0.99');
  await expect(fee.locator('details, summary')).toHaveCount(0);
  await expect(review.locator('[data-review-fact="Availability"]')).toContainText('After confirmation');
  await review.locator('details[aria-label="Advanced transaction details"] > summary').click();
  await expect(review.getByText('Execution details', { exact: true })).toBeVisible();
  await expect(review.locator('[data-review-evidence="Mode"]')).toBeHidden();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expectReviewInside(review);
    if (width === 390) await review.screenshot({ path: testInfo.outputPath('fxsave-review-mobile.png') });
  }
  expect(await metric(page, 'send')).toBe(0);
  await page.clock.fastForward(30_001);
  // Accepted amounts remain evidence of the old review, not a fresh quote.
  await expect(review.locator('[data-review-fact="Estimated received"] [data-review-amount]')).toHaveText('99 USDC');
  await expect(review.getByText('Quote expired · review again', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw instantly', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review updated quote', exact: true })).toBeEnabled();
  await expect(review.locator('[data-review-fact="f(x) fee"]')).toContainText('Unavailable');
  expect(await metric(page, 'runner')).toBe(0);
  expect(await metric(page, 'send')).toBe(0);
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
  test('renders each reviewed transaction once in Advanced with exact wei and calldata', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page);
    await harnessControl(page, 'Use approval route');
    await harnessControl(page, 'Use multi-step route');
    await harnessControl(page, 'Use nonzero transaction values');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();

    const review = page.locator('.reviewInlineContent');
    const advanced = review.locator('details[aria-label="Advanced transaction details"]');
    await expect(advanced).toHaveCount(1);
    await expect(advanced).toHaveJSProperty('open', false);
    await expect(advanced.locator(':scope > summary')).toHaveText('Execution details');
    await expect(review.getByRole('region', { name: 'Prepared transactions', exact: true, includeHidden: true })).toBeHidden();
    const reviewed = await readReviewedTransactions(review, { collapseAfterRead: false });
    expect(reviewed.map((transaction) => transaction.heading)).toEqual(['Approve fxUSD 1', 'Confirm 2', 'Confirm 3']);
    // A route checked for signing must not imply that any receipt exists.
    expect(reviewed.map((transaction) => transaction.status)).toEqual(['', '', '']);
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
    await (await reviewExitControl(page)).click();
    await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { multiStepExecution: boolean; rerender?: () => void } }).__actionReviewHarness;
      if (!harness) throw new Error('ActionReview fixture state is missing');
      harness.multiStepExecution = false;
      harness.rerender?.();
    });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(advanced).toHaveJSProperty('open', false);
    await expect(advanced.locator(':scope > summary')).toHaveText('Execution details');
    const representative = await readReviewedTransactions(review, { collapseAfterRead: false });
    expect(representative.map((transaction) => transaction.heading)).toEqual(['Approve fxUSD 1', 'Confirm 2']);
    expect(representative.map((transaction) => transaction.status)).toEqual(['', '']);
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
    await harnessControl(page, 'Toggle embedded wallet mode');
    await harnessControl(page, 'Use approval route');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const approval = page.getByRole('button', { name: 'Approve fxUSD', exact: true });
    await expect(approval).toBeVisible();

    const rapid = page.locator('input[name="review-gas-tier"][value="rapid"]');
    await page.locator('details[aria-label="Advanced transaction details"] > summary').click();
    await rapid.scrollIntoViewIfNeeded();
    await rapid.check({ force: true });
    await expect(rapid).toBeChecked();
    await approval.click();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(2);
    const sent = await page.evaluate(() => (globalThis as typeof globalThis & { __actionReviewHarness?: { sentTransactions?: Array<{ maxFeePerGas?: string; maxPriorityFeePerGas?: string }> } }).__actionReviewHarness?.sentTransactions);
    expect(sent?.[0]).toEqual({ maxFeePerGas: '60000000000', maxPriorityFeePerGas: '20000000000' });
  });

  test('approval sequence advances only after the first receipt and keeps wallet waiting distinct', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Use approval route');
    await harnessControl(page, 'Defer wallet response');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const requests = await readReviewedTransactions(page.locator('[data-review-viewport]'));
    expect(requests.map(request => request.heading)).toEqual(['Approve fxUSD 1', 'Confirm 2']);
    const progress = page.getByRole('region', { name: 'Transaction progress', exact: true });
    await page.getByRole('button', { name: 'Approve fxUSD', exact: true }).click();
    await expect(page.locator('[data-review-actions]')).toHaveCount(0);
    await expect(progress.getByRole('status')).toContainText('Approve in wallet');
    expect(await metric(page, 'send')).toBe(1);
    await harnessControl(page, 'Defer wallet response');
    await harnessControl(page, 'Resolve wallet response');
    await expect(progress.getByRole('status')).toContainText('Confirm in wallet');
    const steps = await readReviewedTransactions(page.locator('[data-review-viewport]'));
    expect(steps.map(request => request.status)).toEqual(['Confirmed', '']);
    await expect(page.locator('[data-review-actions]')).toHaveCount(0);
    expect(await metric(page, 'send')).toBe(2);
    await harnessControl(page, 'Resolve wallet response');
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
  });

  test('external wallets see estimated gas without fee tiers and receive no app fee caps', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Gas estimate current');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('.reviewInlineContent');
    // The most the network fee can take: the buffered gas limit the wallet funds.
    await expect(review.locator('[data-review-fact="Gas fee"] [data-usd-state]')).toContainText('0.001008 ETH');
    await expect(review.locator('[data-review-fact="Gas fee"] details, [data-review-fact="Gas fee"] summary')).toHaveCount(0);
    await expect(page.locator('input[name="review-gas-tier"]')).toHaveCount(0);
    expect((await harnessMetrics(page)).feeQuoteCount).toBe(0);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
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
    await harnessControl(page, 'Toggle embedded wallet mode');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.locator('input[name="review-gas-tier"]')).toHaveCount(3);
    await harnessControl(page, 'Toggle embedded wallet mode');
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    await expect(page.locator('input[name="review-gas-tier"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    expect((await harnessMetrics(page)).hasFeeSelection).toBe(false);
  });

  test('review fits its mobile sheet and keeps confirmation available while details scroll', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 393, height: 852 });
    // The harness mounts into the current document; seed a real viewport meta
    // so mobile emulation does not retain the blank page's 980px layout width.
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { presentationMode: true });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Add to position', exact: true });
    await expect(confirm).toBeVisible();
    const sheet = page.locator('[data-mobile-review-sheet]');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { level: 2, name: 'Add to ETH Long', exact: true })).toBeVisible();
    await expect(sheet.getByText('Position #42', { exact: true })).toBeVisible();
    const reviewedAmount = page.getByRole('region', { name: 'Transaction amounts', exact: true }).locator('[data-review-fact="Amount"] [data-review-amount]');
    await expect(reviewedAmount).toBeVisible();
    await expect(reviewedAmount).toHaveText('0.25 fxUSD');
    await expect(page.locator('[data-review-fact="Gas fee"] [data-usd-state]')).toContainText('0.001008 ETH');
    const navigation = page.locator('[data-fixed-navigation="true"]');
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('link', { name: 'Trade', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[role="toolbar"]')).toBeHidden();
    const box = await confirm.boundingBox();
    const navBox = await navigation.boundingBox();
    const sheetBox = await sheet.boundingBox();
    const headerBox = await sheet.locator(':scope > header').boundingBox();
    expect(box).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(sheetBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(393);
    expect(box!.y).toBeGreaterThan(headerBox!.y + headerBox!.height);
    expect(sheetBox!.y).toBeGreaterThanOrEqual(0);
    expect(sheetBox!.y + sheetBox!.height).toBeLessThanOrEqual(852);
    expect(box!.y + box!.height).toBeLessThanOrEqual(sheetBox!.y + sheetBox!.height);
    const review = page.locator('[data-review-viewport]');
    const reviewBox = await review.boundingBox();
    expect(reviewBox!.height, 'the review fits below the mobile sheet header').toBeLessThanOrEqual(sheetBox!.height - headerBox!.height);
    const details = review.locator('details[aria-label="Advanced transaction details"]');
    await details.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveJSProperty('open', true);
    await page.keyboard.press('Enter');
    await expect(details).toHaveJSProperty('open', false);
    // Expanded metadata scrolls independently; the decision remains available.
    await review.locator('details').evaluateAll((nodes) => nodes.forEach((node) => { (node as HTMLDetailsElement).open = true; }));
    const scrollBody = page.getByRole('region', { name: 'Review information', exact: true });
    expect(await scrollBody.evaluate((node) => getComputedStyle(node).overflowY)).toBe('auto');
    await expect.poll(() => scrollBody.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0);
    await expect(confirm).toBeInViewport();
    const expandedActionTop = await confirm.evaluate(button => button.getBoundingClientRect().top);
    await scrollBody.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect.poll(() => scrollBody.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    expect(await confirm.evaluate(button => button.getBoundingClientRect().top)).toBeCloseTo(expandedActionTop, 0);
    expect(await confirm.evaluate(button => getComputedStyle(button.parentElement!).position)).toBe('static');
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('action-review-expanded-flow.png') });
    for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      await expect(sheet).toHaveCount(size.width <= 600 ? 1 : 0);
      if (size.width <= 600) await expect(sheet.locator('[data-review-viewport]')).toBeVisible();
      await expect(confirm).toBeVisible();
      await confirm.scrollIntoViewIfNeeded();
      await expect.poll(async () => {
        return confirm.evaluate((button) => {
          const action = button.getBoundingClientRect();
          const sheet = button.closest('[data-mobile-review-sheet]')?.getBoundingClientRect();
          const navigation = document.querySelector('[data-fixed-navigation="true"]')?.getBoundingClientRect();
          const bottom = sheet ? sheet.bottom : navigation && navigation.height > 0 ? navigation.top : window.innerHeight;
          return (!sheet || sheet.top >= 0 && sheet.bottom <= window.innerHeight)
            && action.top >= 0 && action.bottom <= bottom;
        });
      }, { message: `expanded review confirmation fits ${size.width}×${size.height}` }).toBe(true);
    }
    await page.setViewportSize({ width: 393, height: 852 });
    // Crossing the phone breakpoint moves the review into a new portal node.
    // Wait for that owner before evaluating or scrolling its contents.
    const phoneReview = sheet.locator('[data-review-viewport]');
    await expect(phoneReview).toBeVisible();
    await phoneReview.locator('details').evaluateAll((nodes) => nodes.forEach((node) => { (node as HTMLDetailsElement).open = false; }));
    await phoneReview.scrollIntoViewIfNeeded();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const duration = await details.locator(':scope > summary svg').evaluate((node) => getComputedStyle(node).transitionDuration);
    // The global reduced-motion reset uses 0.01ms to preserve end events.
    expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001);
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(852);
    await page.screenshot({ path: testInfo.outputPath('action-review-393x852.png') });
    // Existing-position additions keep their position identity; the separate
    // new-Trade tests bind requested leverage to the accepted opening route.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Add to ETH Long', exact: true })).toBeVisible();
    await expect(review.getByText('Position #42', { exact: true })).toBeVisible();
    // Crossing the breakpoint remounts the review outside the portal, then its
    // layout effect measures the desktop scroll region. Visible copy alone is
    // not evidence that those dimensions have settled. Allow no overflow once
    // settled, and report the actual excess/descendants if it persists.
    await expect.poll(() => review.evaluate((node) => {
      const overflowPx = node.scrollWidth - node.clientWidth;
      if (overflowPx <= 0) return null;
      const bounds = node.getBoundingClientRect();
      const left = bounds.left + node.clientLeft;
      const right = left + node.clientWidth;
      const offenders = Array.from(node.querySelectorAll<HTMLElement>('*')).flatMap(element => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.left >= left && rect.right <= right) return [];
        return [{ tag: element.tagName, class: element.getAttribute('class'), fact: element.closest('[data-review-fact]')?.getAttribute('data-review-fact'), text: element.textContent?.trim().slice(0, 100), left: rect.left, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }];
      });
      return { overflowPx, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, left, right, offenders: offenders.slice(0, 20) };
    }), { timeout: 5_000, message: 'The settled desktop review has zero horizontal overflow' }).toBeNull();
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
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('locks the accepted route while the wallet response is pending', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await harnessControl(page, 'Defer wallet response');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('status').getByText('Confirm in wallet', { exact: true })).toBeVisible();
    await expect(await reviewExitControl(page)).toBeDisabled();
    const progressDetails = page.locator('details[aria-label="Advanced transaction details"]');
    await expect(progressDetails).toHaveJSProperty('open', false);

    await harnessControl(page, 'Change terms');
    await expect(page.getByText('Open position v1', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(await reviewExitControl(page)).toBeDisabled();
    expect(await metric(page, 'send')).toBe(1);
    expect(await metric(page, 'runner')).toBe(1);

    await harnessControl(page, 'Resolve wallet response');
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    const executedRouteVersion = await page.evaluate(() => (window as typeof window & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion);
    expect(executedRouteVersion).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps a deferred send visible after account change and stops later signatures', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Use multi-step route');
    await harnessControl(page, 'Defer wallet response');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('status').getByText('Confirm in wallet', { exact: true })).toBeVisible();
    // The compact pending summary keeps the accepted action and the exact
    // prepared requests available without inventing on-chain progress.
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    const requests = await readReviewedTransactions(page.locator('[data-review-viewport]'));
    expect(requests.map(request => request.heading)).toEqual(['Confirm 1', 'Confirm 2']);
    expect(requests.map(request => request.status)).toEqual(['', '']);

    await harnessControl(page, 'Switch account');
    await expect(page.getByText('Open position v1', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('selected wallet changed during this action');
    await harnessControl(page, 'Resolve wallet response');
    await expect(page.getByRole('heading', { name: 'Partially completed', exact: true })).toBeVisible();
    // The real receipt link retains the exact submitted hash; the fixture
    // never follows it or contacts a chain.
    const receipts = page.getByRole('region', { name: 'Transaction receipts', exact: true });
    await page.locator('[data-review-viewport] details').filter({ has: page.getByText('Execution details', { exact: true }) }).locator(':scope > summary').click();
    await expect(receipts).toBeVisible();
    await expect(receipts.getByRole('link')).toHaveCount(1);
    await expect(receipts.getByRole('link')).toHaveAttribute('href', 'https://etherscan.io/tx/0x1111111111111111111111111111111111111111111111111111111111111111');
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toHaveCount(0);
    expect(await metric(page, 'send')).toBe(1);
    const callbacks = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { refreshStarted?: boolean; completeStarted?: boolean } }).__actionReviewHarness;
      return { refreshStarted: harness?.refreshStarted, completeStarted: harness?.completeStarted };
    });
    expect(callbacks).toEqual({ refreshStarted: false, completeStarted: false });
  });

  test('keeps an execution latched through disconnect and reconnect while its wallet prompt is pending', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Defer wallet response');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('status').getByText('Confirm in wallet', { exact: true })).toBeVisible();

    await harnessControl(page, 'Disconnect');
    await harnessControl(page, 'Reconnect');
    await expect(page.getByText('Open position v1', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await harnessControl(page, 'Resolve wallet response');
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(1);
    const callbacks = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { refreshStarted?: boolean; completeStarted?: boolean } }).__actionReviewHarness;
      return { refreshStarted: harness?.refreshStarted, completeStarted: harness?.completeStarted };
    });
    expect(callbacks).toEqual({ refreshStarted: false, completeStarted: false });
  });

  test('allows the requested chain switch without invalidating the executing route', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Start on Base');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps the wallet-scoped draft when an invalidated wallet request is rejected', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Defer wallet response');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('status').getByText('Confirm in wallet', { exact: true })).toBeVisible();
    await harnessControl(page, 'Switch account');
    await harnessControl(page, 'Reject wallet response');
    await expect(page.getByRole('heading', { name: 'Wallet request declined', exact: true })).toBeVisible();
    const drafts = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { draftSaveCount?: number; draftCancelCount?: number; draftRemoveCount?: number } }).__actionReviewHarness;
      return { saved: harness?.draftSaveCount, canceled: harness?.draftCancelCount, removed: harness?.draftRemoveCount };
    });
    expect(drafts).toEqual({ saved: 1, canceled: 0, removed: 0 });
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps the draft after approval when action signing is rejected, then replans on resume', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Use approval route');
    await harnessControl(page, 'Reject action signature');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Approve fxUSD', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Approval confirmed', exact: true })).toBeVisible();

    const beforeResume = await metric(page, 'plan');
    const retainedDraft = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { draftSaveCount?: number; draftCancelCount?: number; draftRemoveCount?: number; sendCount?: number } }).__actionReviewHarness;
      return { saved: harness?.draftSaveCount, canceled: harness?.draftCancelCount, removed: harness?.draftRemoveCount, sends: harness?.sendCount };
    });
    expect(retainedDraft).toEqual({ saved: 1, canceled: 0, removed: 0, sends: 2 });

    await harnessControl(page, 'Unmount review');
    await harnessControl(page, 'Mount review');
    await harnessControl(page, 'Resume review');
    await expect(page.getByRole('button', { name: 'Approve fxUSD', exact: true })).toBeVisible();
    expect(await metric(page, 'plan')).toBeGreaterThan(beforeResume);
    expect(await page.getByRole('heading', { name: 'Approval confirmed', exact: true }).count()).toBe(0);
  });

  test('Continue action returns to an editable form and cancels the approval-only resume draft', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Use approval route');
    await harnessControl(page, 'Reject action signature');
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

  test('an approval hash without a confirmed receipt routes to transaction progress, never Continue action', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Return unconfirmed approval');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Approve fxUSD', exact: true }).click();
    await expect(page.getByRole('button', { name: 'View transaction progress', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue action', exact: true })).toHaveCount(0);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('does not publish a deferred wallet response after the review unmounts', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Defer wallet response');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('status').getByText('Confirm in wallet', { exact: true })).toBeVisible();
    await harnessControl(page, 'Unmount review');
    await harnessControl(page, 'Resolve wallet response');
    await harnessControl(page, 'Mount review');
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toHaveCount(0);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('does not publish a late wallet refresh after the review unmounts', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Defer wallet refresh');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { refreshStarted?: boolean } }).__actionReviewHarness?.refreshStarted))).toBe(true);
    await harnessControl(page, 'Unmount review');
    await harnessControl(page, 'Resolve wallet refresh');
    await harnessControl(page, 'Mount review');
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toHaveCount(0);
  });

  test('an old confirmed completion cannot remove a newer action’s wallet recovery draft', async ({ page }) => {
    await openHarness(page);
    const draftState = () => page.evaluate(() => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: {
        draftRemoveCount: number; walletResolvers: unknown[]; completeResolvers: unknown[];
      } }).__actionReviewHarness;
      return { removed: h.draftRemoveCount, walletWaiting: h.walletResolvers.length, completionWaiting: h.completeResolvers.length };
    });
    await harnessControl(page, 'Defer completion refresh');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { completeStarted?: boolean } }).__actionReviewHarness?.completeStarted))).toBe(true);
    await expect.poll(async () => (await draftState()).completionWaiting).toBe(1);

    // A has a final receipt but its completion read still waits. B must own
    // its recovery draft once the next wallet prompt starts.
    await (await resultExitControl(page)).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeEnabled();
    await harnessControl(page, 'Defer wallet response');
    await confirm.click();
    const awaitingWallet = page.getByRole('region', { name: 'Transaction progress', exact: true });
    await expect(awaitingWallet).toContainText('Confirm in wallet');
    await expect(page.locator('[data-review-actions]')).toHaveCount(0);
    await expect.poll(async () => (await draftState()).walletWaiting).toBe(1);
    expect(await metric(page, 'draftSave')).toBe(2);
    const removedBeforeOldCompletion = (await draftState()).removed;
    expect(removedBeforeOldCompletion).toBe(1);

    await harnessControl(page, 'Resolve completion refresh');
    // Cross a browser rendering turn so A's resumed post-run microtasks finish
    // before checking that B's still-pending draft survived their cleanup.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(await draftState()).toEqual({ removed: removedBeforeOldCompletion, walletWaiting: 1, completionWaiting: 0 });
    await expect(awaitingWallet).toContainText('Confirm in wallet');
    await expect(page.locator('[data-review-actions]')).toHaveCount(0);
    await expect(await reviewExitControl(page)).toBeDisabled();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toHaveCount(0);
    expect(await metric(page, 'runner')).toBe(2);
    expect(await metric(page, 'send')).toBe(2);

    await harnessControl(page, 'Resolve wallet response');
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    await expect.poll(async () => (await draftState()).removed).toBe(removedBeforeOldCompletion + 1);
    await expect.poll(async () => (await draftState()).completionWaiting).toBe(1);
    await harnessControl(page, 'Resolve completion refresh');
    await expect(page.getByRole('button', { name: 'View position', exact: true })).toBeEnabled();
    expect(await metric(page, 'draftSave')).toBe(2);
    expect(await metric(page, 'send')).toBe(2);
  });

  test('keeps the editor visible until gas settles and labels an unavailable estimate honestly', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Gas estimate loading');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('.reviewInlineContent');
    await expect(review).toHaveCount(0);
    await expect(page.getByText(/^Editor terms v/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preparing review…', exact: true })).toBeDisabled();

    await harnessControl(page, 'Gas estimate unavailable');
    await expect(review.getByText('Network fee', { exact: true })).toBeVisible();
    await expect(review).toContainText('Unavailable');
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade keeps reviewed fields bound to the signed route through live input and wallet changes', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Use stable Trade review');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-review-viewport]');
    const originalFacts = { Amount: '0.25 fxUSD', Position: 'New position', Slippage: '0.5%' };
    const expectOriginalFacts = async () => {
      for (const [label, value] of Object.entries(originalFacts)) {
        await expect(review.locator(label === 'Amount' ? '[data-review-fact="Amount"] [data-review-amount]' : label === 'Position' ? '[data-review-evidence="Position"] > span' : `[data-review-fact="${label}"] > span`).last()).toHaveText(value);
      }
      await expectReviewHeadingLeverage(page, '3×');
    };
    await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toBeEnabled();
    await expectOriginalFacts();
    // Parent presentation updates alone must not rewrite the accepted quote.
    await harnessControl(page, 'Change preparation facts');
    await expectOriginalFacts();

    await harnessControl(page, 'Defer wallet response');
    await page.getByRole('button', { name: 'Open ETH Long', exact: true }).click();
    await expect(page.getByRole('status').getByText('Confirm in wallet', { exact: true })).toBeVisible();
    await harnessControl(page, 'Change terms');
    await harnessControl(page, 'Switch account');
    await expectOriginalFacts();
    await expect(page.getByRole('heading', { name: '3× ETH Long', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('selected wallet changed during this action');
    expect(await metric(page, 'send')).toBe(1);
    await harnessControl(page, 'Resolve wallet response');
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as typeof window & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion)).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('stable Trade does not fill missing verified fields from live preparation facts', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await harnessControl(page, 'Use stable Trade review');
    await harnessControl(page, 'Omit reviewed leverage');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('fieldset[aria-busy="true"]')).toBeVisible();
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    await resolvePreviewRequest(page, (await previewRequests(page))[0]!.id);
    await expect(page.getByRole('heading').filter({ hasText: '3×' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toBeEnabled();
    await harnessControl(page, 'Change preparation facts');
    await expect(page.getByRole('heading').filter({ hasText: '3×' })).toHaveCount(0);
    await expect(page.locator('[data-review-fact="Amount"] [data-review-amount]').last()).toHaveText('0.25 fxUSD');
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade new preparation clears old expiry, updated consequences, and gas tier prices', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await openHarness(page);
    await harnessControl(page, 'Use stable Trade review');
    await harnessControl(page, 'Toggle embedded wallet mode');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-review-viewport]');
    await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toBeEnabled();
    await review.locator('details[aria-label="Advanced transaction details"] > summary').click();
    await expect(review.getByText('25 Gwei', { exact: true })).toBeVisible();
    await page.clock.runFor(31_001);
    await harnessControl(page, 'Change quote terms to v2');
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    const changes = review.getByRole('region', { name: 'Updated transaction consequences' });
    await expect(changes).toContainText('Terms 1 → Terms 2');
    await page.clock.runFor(31_001);
    await expect(review).toContainText('Quote expired.');
    await harnessControl(page, 'Change terms');
    await harnessControl(page, 'Defer preview');
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(3);
    await expect(page.locator('fieldset[aria-busy="true"]')).toBeVisible();
    await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Preparing review…', exact: true })).toBeDisabled();
    await resolvePreviewRequest(page, (await previewRequests(page))[0]!.id);
    await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toBeEnabled();
    await expect(review).toHaveAttribute('aria-busy', 'false');
    await expect(review.getByText('Quote expired.', { exact: true })).toHaveCount(0);
    await expect(changes).toHaveCount(0);
    await expect(review.locator('.missing-value[aria-label="Loading standard gas price"]')).toHaveCount(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade preserves self-clamp failure in the editor and retries from the original action', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Use stable Trade review');
    await harnessControl(page, 'Clamp next preparation');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Pool leverage limits changed to 4.0x-10.0x. The target was updated; review it again.');
    await expect(page.getByText('The inputs changed. Check the action again before signing.', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry review', exact: true })).toHaveCount(0);
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'prepare')).toBe(0);

    await harnessControl(page, 'Defer preview');
    await page.getByRole('button', { name: 'Review position', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('fieldset[aria-busy="true"]')).toBeVisible();
    await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Preparing review…', exact: true })).toBeDisabled();
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const pending = (await previewRequests(page))[0]!;
    expect(pending.routeVersion).toBe(2);
    await resolvePreviewRequest(page, pending.id);
    await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toBeEnabled();
    await expect(page.locator('[data-review-viewport]')).toBeVisible();
    expect(await metric(page, 'plan')).toBe(2);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade background gas checks leave the polite announcement unchanged', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Use stable Trade review');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toBeEnabled();
    await page.locator('details[aria-label="Advanced transaction details"] > summary').click();
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
      await harnessControl(page, 'Gas estimate loading');
      await expect(page.getByRole('button', { name: 'Checking network fees…', exact: true })).toBeDisabled();
      await expect(announcement).toHaveText(readyAnnouncement!);
      // role=status is implicitly polite even without an aria-live attribute.
      // Keep the existing copy-confirmation region, but row placeholders must
      // not create or change an announcement on each poll.
      expect(await liveStatuses.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? node.textContent))).toEqual(baselineStatuses);
      await harnessControl(page, 'Gas estimate current');
      await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toBeEnabled();
      await expect(announcement).toHaveText(readyAnnouncement!);
    }
    expect(await page.evaluate(() => (window as typeof window & { __reviewAnnouncementChanges?: number }).__reviewAnnouncementChanges)).toBe(0);
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade keeps low-balance gas refresh quiet and never enables signing', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Use stable Trade review');
    await harnessControl(page, 'Gas balance insufficient');
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
      for (const [label, value] of Object.entries({ Amount: '0.25 fxUSD', Position: 'New position', Slippage: '0.5%' })) {
        await expect(review.locator(label === 'Amount' ? '[data-review-fact="Amount"] [data-review-amount]' : label === 'Position' ? '[data-review-evidence="Position"] > span' : `[data-review-fact="${label}"] > span`).last()).toHaveText(value);
      }
      await expectReviewHeadingLeverage(page, '3×');
      expect(await liveStatuses.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? node.textContent))).toEqual(baselineStatuses);
      await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toHaveCount(0);
    };
    for (let refresh = 0; refresh < 2; refresh += 1) {
      await expect(page.getByRole('button', { name: 'Not enough ETH', exact: true })).toBeDisabled();
      // The notice names the exact top-up on the network that pays it, and
      // links to the wallet's Receive. With nothing else to send and an empty
      // wallet, that is exactly the max fee the card shows.
      await expect(review.locator('p', { hasText: /^Add [\d,.]+ ETH on / })).toHaveText('Add 0.001008 ETH on Ethereum for fees. Receive ETH');
      await expect(review.locator('[data-review-fact="Gas fee"] [data-usd-state]')).toContainText('0.001008 ETH');
      await expect(review.getByRole('link', { name: 'Receive ETH', exact: true })).toHaveAttribute('href', '/qr');
      await expectCheckedRoute();
      // A TTL refresh removes current but retains its insufficient previous
      // estimate; the shortfall remains blocked by the active fee check.
      await harnessControl(page, 'Refresh expired gas estimate');
      await expect(page.getByRole('button', { name: 'Checking network fees…', exact: true })).toBeDisabled();
      await expectCheckedRoute();
      await harnessControl(page, 'Gas balance insufficient');
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
    await harnessControl(page, 'Gas balance insufficient');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-review-viewport]');
    const action = page.getByRole('button', { name: 'Not enough ETH', exact: true });
    await expect(action).toBeDisabled();
    const note = review.locator('[role="status"]', { hasText: /^Add [\d,.]+ ETH on / });
    // An empty wallet with nothing else to send needs exactly the max fee shown.
    await expect(note).toHaveText('Add 0.001008 ETH on Ethereum for fees. Receive ETH');
    await expect(review.locator('[data-review-fact="Gas fee"] [data-usd-state]')).toContainText('0.001008 ETH');
    await expect(note.getByRole('link', { name: 'Receive ETH', exact: true })).toHaveAttribute('href', '/qr');
    // The product Button also carries Tailwind's disabled:opacity-50. A
    // blocked action names what is missing, so it must stay full strength.
    await action.evaluate((node) => node.classList.add('disabled:opacity-50'));
    expect(await action.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');

    // Base names Base; a partial estimate proves the gap but never invents its size.
    await (await reviewExitControl(page)).click();
    await harnessControl(page, 'Use Base route');
    await harnessControl(page, 'Gas balance insufficient by an unknown amount');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Transaction summary', exact: true }).getByText('Base', { exact: true })).toBeVisible();
    await expect(review.locator('[role="status"]', { hasText: 'needs more ETH' })).toHaveText('This wallet needs more ETH on Base for network fees. Receive ETH');
    await expect(action).toBeDisabled();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('a long exact amount stays in the disabled editor at 320px until verification opens the review sheet', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await harnessControl(page, 'Use stable Trade review');
    await harnessControl(page, 'Use long amount');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.locator('[role="toolbar"]').evaluate((node) => { (node as HTMLElement).style.display = 'none'; });
    await expect(page.locator('fieldset[aria-busy="true"]')).toBeVisible();
    await expect(page.getByText('Editor terms v1', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preparing review…', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    await resolvePreviewRequest(page, (await previewRequests(page))[0]!.id);
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { level: 2, name: '3× ETH Long', exact: true })).toBeVisible();
    const review = page.locator('[data-review-viewport]');
    const amount = review.locator('[data-review-fact="Amount"] [data-review-amount]').last();
    const expectFits = async () => {
      await expectReviewInside(review);
      await expect(amount).toHaveText('≈ 0.0002444 fxUSD');
      await expect(review.locator('[data-review-fact="Amount"] summary')).toHaveCount(0);
      await expect(review.locator('[data-review-fact="Amount"] [data-review-amount]')).toHaveText('≈ 0.0002444 fxUSD');
      await expectReviewHeadingLeverage(page, '3×');
    };
    await expectFits();
    await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toBeEnabled();
    // The review sheet preserves the compact display and exact amount behind its disclosure.
    await expectFits();
    await page.getByRole('button', { name: 'Close transaction review', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText('Editor terms v1', { exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('a whole recipient address wraps inside the review at 320px instead of widening the card', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page);
    await harnessControl(page, 'Use bridge recipient');
    // The review bounds its height where it opens; open it where the card will be.
    await page.locator('[role="toolbar"]').evaluate((node) => { (node as HTMLElement).style.display = 'none'; });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { level: 2, name: 'Review transaction', exact: true })).toBeVisible();
    const review = page.locator('[data-review-viewport]');
    // The summary row; Quote details repeats it, collapsed.
    const recipient = review.locator('[data-review-fact="Recipient"]').first().locator(':scope > span').last();
    await expect(recipient).toHaveText('0x00000000000000000000000000000000000000aa');
    await recipient.scrollIntoViewIfNeeded();
    await expect(recipient).toBeInViewport({ ratio: 1 });
    await expectReviewInside(review);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('preparation keeps the editor available, names the check that is running, and a failure returns focus to Review', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByText('Editor terms v1', { exact: true })).toBeVisible();
    await expect(page.locator('fieldset[aria-busy="true"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preparing review…', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Preparing review', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Simulating each step and checking network fees.' })).toBeVisible();
    await resolvePreviewRequest(page, (await previewRequests(page))[0]!.id);
    const preparedHeading = (await visibleReviewHeader(page)).getByRole('heading', { name: 'Review transaction', exact: true });
    await expect(preparedHeading).toBeVisible();
    // The phone sheet initially focuses its visible Close control; the inline
    // desktop review focuses its accepted action heading.
    const initialReviewFocus = await page.locator('[data-mobile-review-sheet]').isVisible()
      ? await reviewExitControl(page) : preparedHeading;
    await expect(initialReviewFocus).toBeFocused();

    await (await reviewExitControl(page)).click();
    await harnessControl(page, 'Fail next preview');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('mock preview failure');
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeFocused();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('a check that fails before signing is told once and offers a fresh review instead of a dead Confirm', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Use approval route');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const approve = page.getByRole('button', { name: 'Approve fxUSD', exact: true });
    await expect(approve).toBeEnabled();
    // The primary action names approval; exact prepared requests remain
    // available in details, and neither may claim a confirmed receipt.
    const requests = await readReviewedTransactions(page.locator('[data-review-viewport]'));
    expect(requests.map(request => request.heading)).toEqual(['Approve fxUSD 1', 'Confirm 2']);
    expect(requests.map(request => request.status)).toEqual(['', '']);
    expect(await metric(page, 'send')).toBe(0);
    await harnessControl(page, 'Fail before wallet request');
    await approve.click();
    await expect(page.getByRole('alert')).toHaveText('mock execution failure');
    await expect(page.getByText('Action stopped', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Quote expired.', { exact: false })).toHaveCount(0);
    const refresh = page.getByRole('button', { name: 'Review updated quote', exact: true });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(approve).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await metric(page, 'prepare')).toBe(2);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade refresh self-clamp preserves non-signable terms until the updated editor is reviewed', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await openHarness(page);
    await harnessControl(page, 'Use stable Trade review');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toBeEnabled();
    await page.clock.runFor(31_001);
    await harnessControl(page, 'Clamp next preparation');
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Pool leverage limits changed to 4.0x-10.0x. The target was updated; review it again.');
    await expect(page.getByText('The inputs changed. Check the action again before signing.', { exact: true })).toHaveCount(0);
    expect(await metric(page, 'plan')).toBe(2);
    expect(await metric(page, 'prepare')).toBe(1);
    // A failed refresh retains the accepted route as non-signable evidence.
    await expect(page.getByRole('heading', { name: '3× ETH Long', exact: true })).toBeVisible();
    await expect(page.locator('[data-review-fact="Amount"] [data-review-amount]').last()).toHaveText('0.25 fxUSD');
    await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review updated quote', exact: true })).toBeEnabled();
    expect(await metric(page, 'send')).toBe(0);
    await (await reviewExitControl(page)).click();
    await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Retry review', exact: true })).toHaveCount(0);

    await harnessControl(page, 'Defer preview');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(2);
    await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('fieldset[aria-busy="true"]')).toBeVisible();
    const updated = (await previewRequests(page))[0]!;
    expect(updated.routeVersion).toBe(2);
    await resolvePreviewRequest(page, updated.id);
    await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toBeEnabled();
    await expectReviewHeadingLeverage(page, '4×');
    expect(await metric(page, 'plan')).toBe(3);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('stable Trade discards a pending route when the user changes its input', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await harnessControl(page, 'Use stable Trade review');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const original = (await previewRequests(page))[0]!;
    await harnessControl(page, 'Change terms');
    await resolvePreviewRequest(page, original.id);
    await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toHaveCount(0);
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const retry = page.getByRole('button', { name: 'Review updated quote', exact: true });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect.poll(() => metric(page, 'prepare')).toBe(2);
    const updated = (await previewRequests(page))[1]!;
    expect(updated.routeVersion).toBe(2);
    await resolvePreviewRequest(page, updated.id);
    await expect(page.getByRole('button', { name: 'Open ETH Long', exact: true })).toBeEnabled();
    await expect(page.locator('[data-review-fact="Amount"] [data-review-amount]').last()).toHaveText('0.5 fxUSD');
    expect(await metric(page, 'send')).toBe(0);
  });

  test('keeps accepted calldata when a rerender recreates the planner for the same form intent', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByText('Open position v1', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await harnessControl(page, 'Recreate planner');
    await expect(page.getByText('Open position v1', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    const executedRouteVersion = await page.evaluate(() => (window as typeof window & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion);
    expect(executedRouteVersion).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps reviewed terms visible but blocks signing when disabled or its planner disappears', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeEnabled();
    await harnessControl(page, 'Disable action');
    await expect(confirm).toBeDisabled();
    await expect(page.getByText('Open position v1', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
    await harnessControl(page, 'Enable action');
    await harnessControl(page, 'Remove planner');
    await expect(confirm).toBeDisabled();
    await expect(page.getByText('Open position v1', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
    await harnessControl(page, 'Restore planner');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(1);
  });

  test('invalidates the accepted route when the logical form intent really changes', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByText('Open position v1', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await harnessControl(page, 'Change terms');
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await expect(page.getByText('Open position v1', { exact: true }).filter({ visible: true }).first()).toHaveCount(0);
    const refresh = page.getByRole('button', { name: 'Review updated quote', exact: true });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(page.locator('[data-review-scroll]').getByText('Open position v2', { exact: true }).first()).toBeVisible();
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
    await harnessControl(page, 'Toggle embedded wallet mode');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeVisible();
    await page.locator('details[aria-label="Advanced transaction details"] > summary').click();
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


  test('typing and connecting do not prepare quotes; Review disables the editor until preparation finishes', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await harnessControl(page, 'Disconnect');
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await harnessControl(page, 'Change terms');
    await page.clock.install();
    await page.clock.runFor(16_000);
    expect(await metric(page, 'plan')).toBe(0);
    expect(await metric(page, 'prepare')).toBe(0);
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Preparing review…', exact: true })).toBeDisabled();
    await expect(page.locator('fieldset[aria-busy="true"]')).toBeVisible();
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const pending = (await previewRequests(page))[0]!;
    await resolvePreviewRequest(page, pending.id);
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
    await (await reviewExitControl(page)).click();
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await page.clock.runFor(16_000);
    expect(await metric(page, 'plan')).toBe(1);
  });

  test('Cancel returns to the editor during preparation and ignores its late result', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const pending = (await previewRequests(page))[0]!;
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Editor terms v1', { exact: true })).toBeVisible();
    await resolvePreviewRequest(page, pending.id);
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeEnabled();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('shows the confirmed receipt while wallet refresh is pending and starts completion concurrently', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await harnessControl(page, 'Defer wallet refresh');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { refreshStarted?: boolean } }).__actionReviewHarness?.refreshStarted))).toBe(true);
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { completeStarted?: boolean } }).__actionReviewHarness?.completeStarted))).toBe(true);
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
    await harnessControl(page, 'Resolve wallet refresh');
  });

  test('keeps partial-result copy accurate while the post-confirm refresh is pending', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await harnessControl(page, 'Return partial result');
    await harnessControl(page, 'Defer wallet refresh');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Partially completed', exact: true })).toBeVisible();
    await expect(page.getByText('Earlier steps confirmed · do not repeat', { exact: true })).toBeVisible();
    await expect(page.getByText('Transaction confirmed. Position details are refreshing.', { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { refreshStarted?: boolean } }).__actionReviewHarness?.refreshStarted))).toBe(true);
    await harnessControl(page, 'Resolve wallet refresh');
  });

  test('discards late planning after input and wallet changes', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const original = (await previewRequests(page))[0]!;
    await harnessControl(page, 'Change terms');
    await harnessControl(page, 'Disconnect');
    await harnessControl(page, 'Reconnect');
    await resolvePreviewRequest(page, original.id);
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await expect(page.locator('[data-review-viewport]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const retry = page.getByRole('button', { name: 'Review updated quote', exact: true });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect.poll(() => metric(page, 'prepare')).toBe(2);
    const current = (await previewRequests(page))[1]!;
    expect(current).toMatchObject({ routeVersion: 2, connectionVersion: 2 });
    await resolvePreviewRequest(page, current.id);
    await expect(page.locator('[data-review-scroll]').getByText('Open position v2', { exact: true }).first()).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('uses the simulated visible route if the planner changes after the quote', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await harnessControl(page, 'Change planner after quote');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    const executedRouteVersion = await page.evaluate(() => (globalThis as typeof globalThis & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion);
    expect(executedRouteVersion).toBe(1);
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('expires a resumed review without dropping accepted terms and requires an explicit quote refresh', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await openHarness(page);
    await harnessControl(page, 'Resume review');
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
    await expect(page.getByText('Open position v1', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    await harnessControl(page, 'Change quote terms to v2');
    await refresh.click();
    const changes = page.getByRole('region', { name: 'Updated transaction consequences' });
    await expect(changes).toContainText('Quote updated');
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

    await harnessControl(page, 'Fail before wallet request');
    await action.click();
    await expect(page.getByRole('alert')).toContainText('mock execution failure');
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
    expect(await metric(page, 'draftSave')).toBe(0);

    await (await reviewExitControl(page)).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await action.click();
    await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(2);
    expect(await metric(page, 'send')).toBe(1);
    expect(await metric(page, 'draftSave')).toBe(1);
  });

  test('returns to the editable form after preparation fails and retries on Review', async ({ page }) => {
    await openHarness(page);
    await harnessControl(page, 'Fail next preview');
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('mock preview failure');
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.locator('[data-review-scroll]').getByText('Open position v2', { exact: true }).first()).toBeVisible();
    expect(await metric(page, 'prepare')).toBe(2);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('keeps the reviewed route through an account change before the wallet request', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const primary = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(primary).toBeVisible({ timeout: 2_000 });
    await expect(primary).toBeEnabled({ timeout: 5_000 });
    await harnessControl(page, 'Defer before wallet request');
    await expect(primary).toBeEnabled({ timeout: 5_000 });
    await primary.click();
    await expect.poll(() => metric(page, 'runner')).toBe(1);
    await harnessControl(page, 'Disconnect');
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toHaveCount(0);
    await expect(page.getByText('Open position v1', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await harnessControl(page, 'Resolve execution');
    await expect(page.getByRole('heading', { name: 'Not submitted', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
  });
});
