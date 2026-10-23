import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { openHarness, metric } from '../harness/action-review-measurement-support';
import { essentialReviewGeometry, expectEssentialReviewFits } from '../harness/review-essential-geometry';

for (const kind of ['trade', 'borrow', 'earn-instant', 'earn-queue', 'earn-deposit', 'move'] as const) for (const size of [
  { width: 390, height: 740 }, { width: 320, height: 568 },
  { width: 390, height: 770 }, { width: 1280, height: 900 }, { width: 390, height: 500 },
]) {
  test(`${kind} keeps decision visible at ${size.width}×${size.height}`, async ({ page }, info) => {
    // The first case also compiles the real component harness from source.
    test.setTimeout(60_000);
    await page.setViewportSize(size);
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { presentationMode: true });
    await page.evaluate(kind => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
      const wallet = h.wallet.address;
      const router = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';
      const mintRouter = '0xB753366082466c4B5984312f0c4Bb97554be067E';
      const pool = '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8';
      const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const liquidationQuote = { poolAddress: pool, liquidateRatio: '900000000000000000', rebalanceRatio: '800000000000000000', stEthPerWstEth: '1250000000000000000', readAt: Date.now() };
      if (kind === 'trade') {
        h.financialFacts = true;
        h.reviewOperationLabel = 'Open ETH Long';
        h.reviewRoute = { operation: 'increasePosition', chainId: 1, walletAddress: wallet,
          transactions: [{ chainId: 1, from: wallet, to: router, data: '0x12345678', value: 0n, kind: 'action', type: 'increasePosition', operation: 'increasePosition' }],
          policy: { walletAddress: wallet, chainId: 1, reviewedAction: { kind: 'position-increase', poolAddress: pool, positionId: 0, positionType: 'long',
            inputTokenAddress: usdc, inputAmount: 100000000n, nativeInput: false, requestedLeverage: 3, slippagePercent: .5,
            collateralTokenAddress: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', debtTokenAddress: '0x085780639CC2cACd35E474e71f4d000e2405d8f6' } },
          details: { colls: '96000000000000000', debts: '200000000000000000000', stEthPerWstEth: '1250000000000000000', effectiveLeverage: 3, liquidationQuote },
        };
        h.rerender?.(); return;
      }
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
        h.financialFacts = true;
        h.reviewRoute.details.liquidationQuote = liquidationQuote;
        const estimate = { ...h.gasCost.estimate, nativeBalanceWei: 0n, requiredNativeCostWei: 1008000000000000n, insufficientNativeBalance: true };
        h.gasCost = { ...h.gasCost, estimate, current: estimate };
      }
      h.rerender?.();
    }, kind);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-compact-review]');
    await expect(review).toBeVisible();
    await expect(review).toHaveAttribute('data-review-phase', 'review');
    const essential = await essentialReviewGeometry(review);
    const evidence = JSON.stringify({ kind, size, ...essential }, null, 2);
    await writeFile(info.outputPath('initial-essential-geometry.json'), evidence);
    await info.attach('initial-essential-geometry', { body: evidence, contentType: 'application/json' });
    if (size.width === 1280 || size.width === 390 && size.height === 770) expectEssentialReviewFits(essential);
    await expect(review.locator('[data-review-essential] [data-review-fact="Gas fee"]')).toBeVisible();
    if (kind === 'trade' || kind === 'borrow') {
      for (const label of ['Rebalance price', 'Liquidation price']) {
        const risk = review.locator(`[data-review-essential] [data-review-fact="${label}"]`);
        await expect(risk).toContainText(/\$[\d,]+\.\d{2}/);
        await expect(risk).toBeVisible();
      }
      await expect(review.locator('[data-review-fact="Risk estimates"]')).toHaveCount(0);
    }
    const action = review.locator('[data-review-actions] button');
    await expect(action).toBeInViewport({ ratio: 1 });
    const geometry = await review.evaluate(el => {
      const body = el.querySelector('[aria-label="Review information"]')!;
      const footer = el.querySelector('[data-review-actions]')!;
      return { overflow: document.documentElement.scrollWidth - innerWidth, bodyScroll: body.scrollHeight - body.clientHeight, bodyOverflow: getComputedStyle(body).overflowY, bodyBottom: body.getBoundingClientRect().bottom, footerTop: footer.getBoundingClientRect().top, footerBottom: footer.getBoundingClientRect().bottom, height: innerHeight, bodyTop: body.scrollTop };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(0);
    expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.height);
    expect(geometry.bodyTop).toBe(0);
    expect(geometry.bodyBottom, 'terms cannot overlap the decision footer').toBeLessThanOrEqual(geometry.footerTop + 1);
    if (geometry.bodyScroll > 1) expect(geometry.bodyOverflow, 'longer terms remain independently scrollable').toBe('auto');
    if (kind === 'borrow') {
      await expect(action).toHaveText('Not enough ETH');
      await expect(action).toBeDisabled();
      await expect(review.locator('[data-review-actions]')).toContainText('Add at least');
      await expect(review.locator('[data-review-fact="Debt added"]')).toBeVisible();
      await expect(review.locator('[data-review-fact="Loan-to-value"]')).toBeVisible();
      await expect(review.locator('[data-review-essential] [data-review-fact="Borrow rate"]')).toContainText('Not quoted');
    }
    if (kind === 'move') {
      const amounts = review.getByRole('region', { name: 'Bridge amounts and terms' });
      const sent = amounts.locator('[data-review-fact="Amount"]');
      const received = amounts.locator('[data-review-fact="Estimated received"]');
      await expect(sent.locator('summary')).toHaveText('2,500 fxUSD');
      await expect(sent.locator('summary')).toHaveAccessibleName('Show exact sent amount: 2500 fxUSD');
      await expect(sent.getByText('Ethereum', { exact: true })).toBeVisible();
      await expect(received.locator('summary')).toHaveText('2,497.5 fxUSD');
      await expect(received.locator('summary')).toHaveAccessibleName('Show full receive estimate: 2497.5 fxUSD');
      await expect(received.getByText('Base', { exact: true })).toBeVisible();
      await expect(review.locator('[data-review-fact="Networks"]')).toHaveCount(0);
      await expect(review.locator('[data-review-fact="Minimum received"]')).toContainText('2,475 fxUSD');
      const recipient = review.locator('[data-review-fact="Recipient"]');
      await expect(recipient.getByRole('button', { name: 'Copy full recipient address' })).toBeHidden();
      await expect(recipient.locator('summary')).toHaveAccessibleName(/^Show full recipient address:/);
      await recipient.locator('summary').click();
      await expect(recipient.locator('[translate="no"]')).toHaveText('0x00000000000000000000000000000000000000aa');
      await expect(recipient.getByRole('button', { name: 'Copy full recipient address' })).toBeVisible();
      await expect(recipient.locator('summary')).toHaveCount(1);
      await recipient.locator('summary').click();
      await expect(action).toBeInViewport({ ratio: 1 });
      await expect(review.locator('[data-review-fact="Bridge fee"] summary')).toContainText('0.0001 ETH');
      await expect(review.locator('[data-review-fact="Delivery estimate"]')).toHaveCount(0);
    }
    if (kind === 'earn-instant') {
      const fee = review.locator('[data-review-value="f(x) fee"]');
      await expect(fee.locator('summary')).toHaveText('1%');
      const feeTarget = await fee.locator('summary').boundingBox();
      expect(feeTarget!.width).toBeGreaterThanOrEqual(44);
      // Inline numeric disclosures follow the explicit 32px review-row
      // contract; actions, navigation and address controls retain 44px.
      expect(feeTarget!.height).toBeGreaterThanOrEqual(32);
      const feeHit = await fee.locator('summary').evaluate(element => {
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
      expect(feeHit.hit, 'Inline fee disclosure receives its own center hit').toBe(true);
      expect(feeHit.neighbors, 'Inline fee disclosure must not overlap neighboring controls').toEqual([]);
      await fee.locator('summary').click();
      await expect(fee.getByText('Accepted quote’s base-pool instant redemption fee, deducted from both redemption legs before conversion. Excludes gas and conversion costs.', { exact: true })).toBeVisible();
      await fee.locator('summary').click();
      const received = review.locator('[data-review-fact="Estimated received"]');
      await expect(received.getByText('Receive · estimated', { exact: true })).toBeVisible();
      await expect(received.locator('summary')).toHaveText('99 USDC');
      await expect(received.locator('summary')).toHaveAccessibleName('Show full estimate: 99 USDC');
    }
    if (kind === 'earn-queue') await expect(review.locator('[data-review-fact="Availability"]')).toContainText('claim required');
    if (kind === 'earn-deposit') await expect(review.locator('[data-review-fact="Final fxSAVE minimum"]')).toContainText('Not enforced');
    await page.evaluate(async () => { await document.fonts.load('600 28px Manrope'); await Promise.all([...document.images].map(image => image.decode().catch(() => undefined))); });
    await page.screenshot({ path: info.outputPath(`${kind}-${size.width}.png`), animations: 'disabled' });
    const more = review.locator('details[aria-label="Advanced transaction details"] > summary');
    await more.scrollIntoViewIfNeeded();
    expect(await more.evaluate(node => {
      const bounds = node.getBoundingClientRect();
      const body = node.closest('[data-review-scroll]')!.getBoundingClientRect();
      return bounds.top >= body.top - 1 && bounds.bottom <= body.bottom + 1;
    }), 'the last disclosure is reachable inside the terms region').toBe(true);
    await expect(action).toBeInViewport({ ratio: 1 });
    await more.click();
    await expect(action).toBeInViewport({ ratio: 1 });
    const close = page.getByRole('button', { name: 'Close transaction review', exact: true });
    if (await close.count()) await close.click();
    else await page.locator('[data-review-edit]').first().click();
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
  });
}
