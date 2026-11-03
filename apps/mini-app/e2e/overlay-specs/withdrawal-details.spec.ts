import { expect, test } from '@playwright/test';
import { FX_TOKENS } from '../../src/lib/fx/tokens';
import { openHarness, metric } from '../harness/action-review-measurement-support';

for (const width of [320, 390]) {
  test(`withdrawal details keep exact swap protection readable at ${width}px`, async ({ page }, info) => {
    test.setTimeout(60_000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setViewportSize({ width, height: 740 });
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { presentationMode: true });
    await page.evaluate(token => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
      const wallet = h.wallet.address;
      const router = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';
      h.reviewOperationLabel = 'Review withdrawal';
      h.displayPrices = { fxUSD: 1, USDC: 1, fxSAVE: 1.127 };
      h.reviewRoute = {
        operation: 'withdrawFxSave', chainId: 1, walletAddress: wallet,
        transactions: [{ chainId: 1, from: wallet, to: router, data: '0x6d701088', value: 0n, kind: 'action', type: 'instantRedeem', operation: 'withdrawFxSave' }],
        policy: { walletAddress: wallet, chainId: 1, reviewedAction: { kind: 'fxsave-withdraw', tokenOutAddress: token, amount: 1076000000000000000n, receiver: wallet, directBasePool: false, instant: true, slippagePercent: .5 } },
        details: {
          economicLimits: [{ label: 'fxUSD instant output minimum output', value: '0' }, { label: 'USDC instant output minimum output', value: '23581234567890123' }],
          fxSaveQuote: { kind: 'instant-withdraw', inputAmount: '1076000000000000000', tokenAddress: token, actionTo: router, actionData: '0x6d701088', readAt: Date.now(), estimatedOutput: '1212750000000000000', identityOutputIncluded: true, instantFeeRatio: '10000000000000000', grossFxUSD: '1200000000000000000', netFxUSD: '1188000000000000000', grossUSDC: '25000', netUSDC: '24750' },
        },
      };
      h.rerender?.();
    }, FX_TOKENS.fxUSD.address);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-compact-review]');
    await expect(review.locator('[data-review-fact="Receive"]')).toContainText('fxUSD');
    const disclosure = review.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Withdrawal details' }) });
    await expect(disclosure).not.toHaveAttribute('open', '');
    await expect(disclosure.locator('[data-review-fact]').first()).not.toBeVisible();
    await disclosure.locator('summary').click();
    const floor = disclosure.locator('[data-review-fact="Minimum received (USDC leg)"]');
    await expect(floor).toContainText('0.023581234567890123 fxUSD');
    await expect(floor).toContainText('USDC → fxUSD');
    if (width === 320) {
      const valueLines = await floor.locator('span').last().evaluate(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getClientRects().length;
      });
      expect(valueLines).toBe(1);
    }
    await expect(disclosure).toContainText('Direct fxUSD · est.');
    expect((await disclosure.locator('summary').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await floor.scrollIntoViewIfNeeded();
    const geometry = await disclosure.evaluate(node => {
      const box = node.getBoundingClientRect();
      const rows = [...node.querySelectorAll('[data-review-fact]')].map(row => {
        const [label, value] = [...row.children].map(child => child.getBoundingClientRect());
        return { gap: value.left - label.right, stacked: value.top >= label.bottom - 1, right: value.right, left: label.left };
      });
      return { left: box.left, right: box.right, width: innerWidth, rows, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(0);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    for (const row of geometry.rows) {
      expect(row.stacked || row.gap >= 7).toBe(true);
      expect(row.right).toBeLessThanOrEqual(geometry.right + 1);
    }
    await page.screenshot({ path: info.outputPath(`withdrawal-details-${width}.png`), animations: 'disabled' });
    await disclosure.locator('summary').click();
    expect(await metric(page, 'send')).toBe(0);
    expect(pageErrors).toEqual([]);
  });
}
