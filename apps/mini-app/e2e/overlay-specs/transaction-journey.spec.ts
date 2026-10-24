import { expect, test } from '@playwright/test';
import { openHarness, metric } from '../harness/action-review-measurement-support';
import { FX_TOKENS } from '../../src/lib/fx/tokens';

// The live components render deterministic local receipts. No wallet or RPC
// is contacted; the amount deliberately differs from the accepted quote.
const scenarios = [
  { width: 320, height: 568, theme: 'dark', reduced: false },
  { width: 390, height: 844, theme: 'dark', reduced: false },
  { width: 390, height: 844, theme: 'dark', reduced: true },
  { width: 412, height: 818, theme: 'dark', reduced: false },
  { width: 480, height: 844, theme: 'dark', reduced: false },
  { width: 1280, height: 900, theme: 'dark', reduced: false },
] as const;

for (const scenario of scenarios) test(`amounts stay truthful through wallet and receipt at ${scenario.width}px ${scenario.theme}${scenario.reduced ? ' reduced motion' : ''}`, async ({ page }, info) => {
  // A fresh worker first compiles the real component harness. Keep that
  // startup cost separate from the unchanged 5s UI assertion deadlines.
  test.setTimeout(60_000);
  await page.setViewportSize(scenario);
  await page.emulateMedia({ reducedMotion: scenario.reduced ? 'reduce' : 'no-preference' });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  await openHarness(page, { presentationMode: true });
  await page.evaluate(({ theme, usdc, fxusd }) => {
    document.documentElement.dataset.theme = theme;
    const h = (globalThis as any).__actionReviewHarness;
    h.displayPrices = { ETH: 2691.56, USDC: 1, fxUSD: 0.9998 };
    h.financialFacts = true;
    h.deferWalletResponse = true;
    h.deferReceipt = true;
    const wallet = h.wallet.address;
    const router = '0xB753366082466c4B5984312f0c4Bb97554be067E';
    const pool = '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8';
    h.reviewRoute = {
      operation: 'depositAndMint', chainId: 1, walletAddress: wallet,
      transactions: [{ chainId: 1, from: wallet, to: router, data: '0x216d5108', value: 0n, kind: 'action', type: 'depositAndMint', operation: 'depositAndMint' }],
      policy: { walletAddress: wallet, chainId: 1, reviewedAction: { kind: 'deposit-and-mint', poolAddress: pool, positionId: 0, depositTokenAddress: usdc, depositAmount: 100000000n, mintAmount: 50000000000000000000n, nativeInput: false } },
      details: { colls: '40000000000000000', debts: '50000000000000000000', stEthPerWstEth: '1250000000000000000', effectiveLeverage: 2, protocolFeeQuote: { poolAddress: pool, routerAddress: router, ratios: ['0', '0', '5000000', '0'] }, liquidationQuote: { poolAddress: pool, liquidateRatio: '900000000000000000', rebalanceRatio: '800000000000000000', stEthPerWstEth: '1250000000000000000', readAt: Date.now() } },
    };
    const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const addressTopic = (address: string) => `0x${address.slice(2).padStart(64, '0')}`;
    h.receiptLogs = [
      { address: usdc, topics: [topic, addressTopic(wallet), addressTopic(router)], data: `0x${(100000000n).toString(16).padStart(64, '0')}` },
      { address: fxusd, topics: [topic, addressTopic(router), addressTopic(wallet)], data: `0x${(49741234567890123456n).toString(16).padStart(64, '0')}` },
    ];
    h.rerender();
  }, { theme: scenario.theme, usdc: FX_TOKENS.USDC.address, fxusd: FX_TOKENS.fxUSD.address });
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  const viewport = page.locator('[data-review-viewport]');
  const cta = viewport.locator('[data-review-actions] button');
  await expect(page.getByRole('heading', { name: 'Review borrow', exact: true })).toBeVisible();
  await expect(cta).toHaveText('Borrow fxUSD');
  await expect(cta).toBeInViewport({ ratio: 1 });
  await expect(viewport.locator('[data-review-fact="Estimated fxUSD received"]')).toContainText('49.75');
  await expect(viewport.locator('[data-review-fact="Debt added"]')).toContainText('50 fxUSD');
  await expect(viewport.locator('[data-review-fact="Liquidation price"]')).toContainText('$1,388.89');
  await page.evaluate(async () => {
    await document.fonts.load('600 28px Manrope');
    await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)));
  });
  expect(await page.locator('[data-review-viewport] img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: info.outputPath('review.png'), animations: 'disabled' });
  if (scenario.width === 390 && !scenario.reduced) {
    const borrowRateHelp = viewport.getByRole('button', { name: 'About Funding status', exact: true });
    const target = await borrowRateHelp.boundingBox();
    expect(target!.width).toBeGreaterThanOrEqual(24);
    expect(target!.height).toBeGreaterThanOrEqual(24);
    const hitTarget = await borrowRateHelp.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const neighbors = [...document.querySelectorAll<HTMLElement>('[data-review-viewport] button, [data-review-viewport] summary, [data-review-viewport] a[href]')]
        .filter(other => other !== element && !other.contains(element) && !element.contains(other))
        .filter(other => { const box = other.getBoundingClientRect(); return box.width > 0 && box.height > 0
          && Math.min(box.right, rect.right) - Math.max(box.left, rect.left) > .5
          && Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top) > .5; })
        .map(other => other.getAttribute('aria-label') ?? other.textContent?.trim());
      return { hit: hit === element || Boolean(hit && element.contains(hit)), neighbors };
    });
    expect(hitTarget.hit, 'The compact help target receives its center hit').toBe(true);
    expect(hitTarget.neighbors, 'Help controls must not overlap neighboring controls').toEqual([]);
    const before = await viewport.locator('[data-review-fact="Debt added"]').boundingBox();
    await borrowRateHelp.click();
    const help = page.getByRole('dialog', { name: 'Funding status', exact: true });
    await expect(help).toContainText('charged against the whole collateral, not just the fxUSD borrowed');
    await expect(help).toContainText('The current rate could not be verified.');
    await expect(help.getByRole('link', { name: 'Verify on f(x) Protocol' })).toHaveAttribute('href', 'https://fx.aladdin.club/v2/fxmint');
    expect(await viewport.locator('[data-review-fact="Debt added"]').boundingBox()).toEqual(before);
    await page.screenshot({ path: info.outputPath('funding-status-help.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(borrowRateHelp).toBeFocused();
    const details = viewport.locator('details[aria-label="Advanced transaction details"]');
    await details.locator('summary').first().click();
    for (const label of ['Deposit', 'Debt added', 'Estimated debt', 'Loan-to-value', 'Borrow rate', 'Gas fee', 'f(x) fee']) {
      await expect(details.locator(`[data-review-evidence="${label}"]`)).toHaveCount(0);
    }
    await expect(details.getByRole('region', { name: 'Prepared transactions' })).toBeVisible();
    await details.getByRole('region', { name: 'Prepared transactions' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('technical-details.png'), animations: 'disabled' });
    await details.locator('summary').first().click();
  }
  await cta.click();
  const pending = page.getByRole('region', { name: 'Transaction progress', exact: true });
  await expect(pending).toContainText('Confirm in wallet');
  await expect(page.getByRole('heading', { name: 'Borrow fxUSD', exact: true })).toBeVisible();
  await expect(pending.getByRole('region', { name: 'Reviewed transaction amounts' })).toBeVisible();
  await expect(viewport.locator('[data-review-actions]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toHaveCount(0);
  if (scenario.reduced) expect(await pending.locator('svg').first().evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await page.screenshot({ path: info.outputPath('wallet-request.png'), animations: 'disabled' });
  await page.evaluate(() => (globalThis as any).__actionReviewHarness.walletResolvers.shift()());
  await expect(pending).toContainText('Submitted');
  await expect(pending).toContainText('Do not resubmit');
  await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('submitted.png'), animations: 'disabled' });
  await page.evaluate(() => (globalThis as any).__actionReviewHarness.receiptResolvers.shift()());
  const actual = page.getByRole('region', { name: 'Confirmed transaction amounts', exact: true });
  await expect(actual).toBeVisible();
  await expect(actual.locator('[data-review-fact="Received"] summary')).toHaveText('≈ 49.74 fxUSD');
  await expect(actual).not.toContainText('49.75');
  await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toContainText('Network fee');
  await expect(cta).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: info.outputPath('confirmed.png'), animations: 'disabled' });
  await actual.locator('[data-review-fact="Received"] summary').focus();
  await page.keyboard.press('Enter');
  await expect(actual.locator('[data-review-fact="Received"] details')).toHaveAttribute('open');
  await expect(actual.locator('[data-review-fact="Received"]')).toContainText('49.741234567890123456 fxUSD');
  await expect(cta).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('exact-receipt.png'), animations: 'disabled' });
  expect(await metric(page, 'send')).toBe(1);
});

test('approval request names the token and step; rejection never shows completed amounts', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  await openHarness(page, { presentationMode: true });
  await page.evaluate(() => { const h = (globalThis as any).__actionReviewHarness; h.approvalRequired = true; h.deferWalletResponse = true; h.rerender(); });
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  await page.getByRole('button', { name: 'Approve fxUSD', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Transaction progress', exact: true })).toContainText('Approve fxUSD · step 1 of 2');
  await page.screenshot({ path: info.outputPath('approval-request.png'), animations: 'disabled' });
  await page.evaluate(() => (globalThis as any).__actionReviewHarness.walletResolvers.shift()(true));
  await expect(page.getByRole('heading', { name: 'Wallet request declined', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Confirmed transaction amounts', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('rejected.png'), animations: 'disabled' });
});
