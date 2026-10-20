import { expect, test } from '@playwright/test';
import { openHarness, metric } from '../harness/action-review-measurement-support';

for (const kind of ['borrow', 'earn-instant', 'earn-queue', 'earn-deposit', 'move'] as const) for (const size of [{ width: 390, height: 740 }, { width: 320, height: 568 }]) {
  test(`${kind} keeps decision visible at ${size.width}×${size.height}`, async ({ page }, info) => {
    await page.setViewportSize(size);
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page);
    await page.evaluate(kind => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
      const wallet = h.wallet.address;
      const router = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';
      const mintRouter = '0xB753366082466c4B5984312f0c4Bb97554be067E';
      const pool = '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8';
      const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const borrow = kind === 'borrow'; const deposit = kind === 'earn-deposit'; const instant = kind === 'earn-instant';
      h.reviewOperationLabel = borrow ? 'Open collateral position' : deposit ? 'Deposit into fxSAVE' : instant ? 'Withdraw instantly' : 'Queue withdrawal';
      h.reviewRoute = {
        operation: borrow ? 'depositAndMint' : deposit ? 'depositFxSave' : 'withdrawFxSave', chainId: 1, walletAddress: wallet,
        transactions: [{ chainId: 1, from: wallet, to: borrow ? mintRouter : router, data: borrow ? '0x216d5108' : deposit ? '0x3ea34dc0' : instant ? '0x6d701088' : '0xaa2f892d', value: 0n, kind: 'action', type: borrow ? 'depositAndMint' : instant ? 'instantRedeem' : 'requestRedeem', operation: borrow ? 'depositAndMint' : deposit ? 'depositFxSave' : 'withdrawFxSave' }],
        policy: { walletAddress: wallet, chainId: 1, reviewedAction: borrow ? { kind: 'deposit-and-mint', poolAddress: pool, positionId: 0, depositTokenAddress: usdc, depositAmount: 100000000n, mintAmount: 50000000000000000000n, nativeInput: false } : deposit ? { kind: 'fxsave-deposit', tokenInAddress: usdc, amount: 100000000n, receiver: wallet, directBasePool: false } : { kind: 'fxsave-withdraw', tokenOutAddress: usdc, amount: 100000000000000000000n, receiver: wallet, directBasePool: false, instant, slippagePercent: 0.5 } },
        details: borrow ? { colls: '40000000000000000', debts: '50000000000000000000', stEthPerWstEth: '1250000000000000000', effectiveLeverage: 2, protocolFeeQuote: { poolAddress: pool, routerAddress: mintRouter, ratios: ['0', '0', '5000000', '0'] } } : instant ? { fxSaveQuote: { kind: 'instant-withdraw', inputAmount: '100000000000000000000', tokenAddress: usdc, actionTo: router, actionData: '0x6d701088', readAt: Date.now(), estimatedOutput: '99000000', instantFeeRatio: '10000000000000000', grossFxUSD: '60000000000000000000', netFxUSD: '59400000000000000000', grossUSDC: '40000000', netUSDC: '39600000' } } : {},
      };
      if (kind === 'move') {
        h.reviewOperationLabel = 'Send fxUSD to Base';
        h.reviewRoute = { operation: 'buildBridgeTx', chainId: 1, walletAddress: wallet,
          transactions: [{ chainId: 1, from: wallet, to: router, data: '0xc7c7f5b3', value: 100000000000000n, kind: 'action', type: 'buildBridgeTx', operation: 'buildBridgeTx' }],
          quote: { nativeFee: 100000000000000n, destinationChainId: 8453, bridgeToken: 'fxUSD', bridgeAmount: 2500000000000000000000n, minAmountLD: 2475000000000000000000n, estimatedReceived: 2497500000000000000000n, receiptReadAt: Date.now(), recipient: wallet },
        };
      }
      if (borrow) {
        const estimate = { ...h.gasCost.estimate, nativeBalanceWei: 0n, requiredNativeCostWei: 1008000000000000n, insufficientNativeBalance: true };
        h.gasCost = { ...h.gasCost, estimate, current: estimate };
      }
      h.rerender?.();
    }, kind);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-compact-review]');
    await expect(review).toBeVisible();
    const action = review.locator('[data-review-actions] button');
    await expect(action).toBeInViewport({ ratio: 1 });
    const geometry = await review.evaluate(el => {
      const body = el.querySelector('[aria-label="Review information"]')!;
      const footer = el.querySelector('[data-review-actions]')!;
      return { overflow: document.documentElement.scrollWidth - innerWidth, bodyScroll: body.scrollHeight - body.clientHeight, footerBottom: footer.getBoundingClientRect().bottom, height: innerHeight, bodyTop: body.scrollTop };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(0);
    expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.height);
    expect(geometry.bodyTop).toBe(0);
    if (size.width === 390) expect(geometry.bodyScroll, 'essential summary fits without scrolling').toBeLessThanOrEqual(1);
    if (kind === 'borrow') {
      await expect(action).toHaveText('Not enough ETH');
      await expect(action).toBeDisabled();
      await expect(review.locator('[data-review-actions]')).toContainText('Add at least');
      await expect(review.locator('[data-review-fact="Debt added"]')).toBeVisible();
      await expect(review.locator('[data-review-fact="Loan-to-value"]')).toBeVisible();
    }
    if (kind === 'move') {
      await expect(review.getByRole('region', { name: 'Bridge amounts and terms' })).toContainText('fxUSD on Ethereum');
      await expect(review.getByRole('region', { name: 'Bridge amounts and terms' })).toContainText('fxUSD on Base');
      await expect(review.locator('[data-review-fact="Networks"]')).toHaveCount(0);
      await expect(review.locator('[data-review-fact="Minimum received"]')).toContainText('2,475 fxUSD');
      await expect(review.locator('[data-review-fact="Recipient"] > summary')).toContainText('0x0000…00aa');
      await review.locator('[data-review-fact="Recipient"] > summary').click();
      await expect(review.locator('[data-review-fact="Recipient"] > div')).toContainText('0x00000000000000000000000000000000000000aa');
      await expect(action).toBeInViewport({ ratio: 1 });
      await review.locator('[data-review-fact="Recipient"] > summary').click();
      await expect(review.locator('[data-review-fact="Bridge fee"]')).toContainText('0.0001 ETH');
      await expect(review.locator('[data-review-fact="Delivery estimate"]')).toHaveCount(0);
    }
    if (kind === 'earn-instant') {
      await expect(review.locator('[data-review-fact="f(x) fee"]')).toHaveText('f(x) fee1%');
      await expect(review.locator('[data-review-fact="Estimated received"]')).toHaveText('Estimated received99 USDC');
    }
    if (kind === 'earn-queue') await expect(review.locator('[data-review-fact="Availability"]')).toContainText('claim required');
    if (kind === 'earn-deposit') await expect(review.locator('[data-review-fact="Final fxSAVE minimum"]')).toContainText('Not enforced');
    await page.screenshot({ path: info.outputPath(`${kind}-${size.width}.png`), animations: 'disabled' });
    const more = review.locator('details[aria-label="Advanced transaction details"] > summary');
    await more.click();
    await expect(action).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Close transaction review' }).click();
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
  });
}
