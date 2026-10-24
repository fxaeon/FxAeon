import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { openHarness } from '../harness/action-review-measurement-support';
import { essentialReviewGeometry, expectClosedReviewFits } from '../harness/review-essential-geometry';

test('deposit review shares the official page APY without requiring an APY in the transaction quote', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 700 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  await openHarness(page, { presentationMode: true });
  await page.evaluate(() => {
    const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
    const wallet = h.wallet.address;
    h.financialFacts = true;
    h.savingsApy = { apy: 6.32, observedAt: Date.now() };
    h.savingsApyStatus = 'ready';
    h.reviewOperationLabel = 'Deposit into fxSAVE';
    h.reviewRoute = {
      operation: 'depositFxSave', chainId: 1, walletAddress: wallet,
      transactions: [{ chainId: 1, from: wallet, to: '0x33636D49FbefBE798e15e7F356E8DBef543CC708', data: '0x3ea34dc0', value: 0n, kind: 'action', type: 'depositFxSave', operation: 'depositFxSave' }],
      policy: { walletAddress: wallet, chainId: 1, reviewedAction: { kind: 'fxsave-deposit', tokenInAddress: '0x00000000000000000000000000000000000000c1', amount: 1204548856269749526n, receiver: wallet, directBasePool: false } },
      details: { fxSaveQuote: { kind: 'deposit', inputAmount: '1204548856269749526', tokenAddress: '0x00000000000000000000000000000000000000c1', actionTo: '0x33636D49FbefBE798e15e7F356E8DBef543CC708', actionData: '0x3ea34dc0', readAt: Date.now(), estimatedOutput: '1070000000000000000' } },
    };
    h.rerender?.();
  });
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  const review = page.locator('[data-review-essential]');
  const apy = review.locator('[data-review-fact="Current APY"]');
  await expect(apy).toContainText('APY');
  await expect(apy).toContainText('6.32%');
  await expect(review.locator('[data-review-fact="Final fxSAVE minimum"]')).toHaveCount(0);
  await expect(review.locator('details')).toHaveCount(0);
  const before = await review.boundingBox();
  await review.locator('[data-review-amount]').first().click();
  expect((await review.boundingBox())!.height).toBe(before!.height);
  await expect(page.getByText(/Exact reviewed amount|Source detail|Full value/)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('earn-actual-review.png'), animations: 'disabled' });
  await page.evaluate(() => {
    const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
    h.savingsApy = { apy: 6.33, observedAt: Date.now() };
    h.rerender?.();
  });
  await expect(apy).toContainText('6.33%');
  await expect(page.getByRole('region', { name: 'Updated transaction consequences' })).toHaveCount(0);
  await page.evaluate(() => {
    const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
    h.savingsApy = null; h.savingsApyStatus = 'unavailable'; h.rerender?.();
  });
  await expect(apy).toContainText('Unavailable');
  await expect(apy).not.toContainText('0%');
});

for (const size of [{ width: 390, height: 700 }, { width: 320, height: 568 }, { width: 390, height: 500 }]) {
  test(`new Borrow shows the resulting position and eight-hour funding at ${size.width}x${size.height}`, async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize(size);
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { presentationMode: true });
    await page.evaluate(() => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
      const wallet = h.wallet.address;
      const pool = '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8';
      const router = '0xB753366082466c4B5984312f0c4Bb97554be067E';
      h.financialFacts = true;
      h.displayPrices = { ETH: 2400, stETH: 2400, fxUSD: 1, USDC: 1 };
      h.reviewOperationLabel = 'Borrow fxUSD';
      h.reviewRoute = {
        operation: 'depositAndMint', chainId: 1, walletAddress: wallet,
        transactions: [{ chainId: 1, from: wallet, to: router, data: '0x216d5108', value: 0n, kind: 'action', type: 'depositAndMint', operation: 'depositAndMint' }],
        policy: { walletAddress: wallet, chainId: 1, reviewedAction: { kind: 'deposit-and-mint', poolAddress: pool, positionId: 0, depositTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', depositAmount: 100000000n, mintAmount: 50000000000000000000n, nativeInput: false } },
        details: {
          colls: '40000000000000000', debts: '50000000000000000000', stEthPerWstEth: '1250000000000000000', effectiveLeverage: 2,
          liquidationQuote: { poolAddress: pool, liquidateRatio: '900000000000000000', rebalanceRatio: '800000000000000000', stEthPerWstEth: '1250000000000000000', readAt: Date.now() },
          protocolFeeQuote: { poolAddress: pool, routerAddress: router, ratios: ['0', '0', '5000000', '0'] },
          borrowFundingQuote: { poolAddress: pool, ratio: '45318576060452136', netRatio: '45318576060452136', readAt: Date.now() },
        },
      };
      h.rerender?.();
    });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-compact-review]');
    await expect(review).toHaveAttribute('data-review-phase', 'review');
    const outcome = review.getByRole('region', { name: 'Estimated position', exact: true });
    await expect(outcome).toContainText('Total debt');
    await expect(outcome).toContainText('LTV');
    await expect(outcome).not.toContainText(/Current|No position|→/);
    await expect(review.locator('[data-review-fact="Borrow rate"]')).toContainText('≈ 0.0041% / 8h');
    await expect(review.locator('[data-review-fact="Liquidation price"]')).toContainText('$');
    await expect(review.locator('[data-review-essential] details')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('borrow-actual-review.png'), animations: 'disabled' });
    const geometry = await essentialReviewGeometry(review);
    await writeFile(info.outputPath('review-geometry.json'), JSON.stringify(geometry, null, 2));
    await info.attach('review-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
    expectClosedReviewFits(geometry);
  });
}

for (const fixture of [
  { size: { width: 320, height: 568 }, label: 'wide Move', amount: '1000000120000000000000000', receivedAmount: '999000119880000000000000', sent: '1,000,000.12 fxUSD', received: '≈ 999,000.12 fxUSD' },
  { size: { width: 390, height: 500 }, label: 'wide Move', amount: '1000000120000000000000000', receivedAmount: '999000119880000000000000', sent: '1,000,000.12 fxUSD', received: '≈ 999,000.12 fxUSD' },
  { size: { width: 320, height: 568 }, label: 'boundary Move', amount: '12345670000000000000000', receivedAmount: '12333320000000000000000', sent: '12,345.67 fxUSD', received: '12,333.32 fxUSD' },
  { size: { width: 390, height: 500 }, label: 'boundary Move', amount: '12345670000000000000000', receivedAmount: '12333320000000000000000', sent: '12,345.67 fxUSD', received: '12,333.32 fxUSD' },
]) {
  const { size } = fixture;
  test(`${fixture.label} retains exact model amounts and intact hero values at ${size.width}x${size.height}`, async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize(size);
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { presentationMode: true });
    await page.evaluate(input => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
      const wallet = h.wallet.address;
      const amount = BigInt(input.amount);
      const received = BigInt(input.receivedAmount);
      const bridgeNativeFee = 100_000_000_000_000n;
      h.financialFacts = true;
      h.displayPrices = { fxUSD: 1, ETH: 2400 };
      h.reviewOperationLabel = 'Send fxUSD to Base';
      h.reviewRoute = {
        operation: 'buildBridgeTx', chainId: 1, walletAddress: wallet,
        transactions: [{ chainId: 1, from: wallet, to: '0x33636D49FbefBE798e15e7F356E8DBef543CC708',
          data: '0xc7c7f5b3', value: bridgeNativeFee, kind: 'action', type: 'buildBridgeTx', operation: 'buildBridgeTx' }],
        quote: { nativeFee: bridgeNativeFee, destinationChainId: 8453, bridgeToken: 'fxUSD', bridgeAmount: amount,
          minAmountLD: amount * 99n / 100n, estimatedReceived: received, receiptReadAt: Date.now(), recipient: wallet },
      };
      const estimate = { ...h.gasCost.estimate, nativeValueWei: bridgeNativeFee,
        totalNativeCostWei: bridgeNativeFee + 12_600_000_000_000n,
        requiredNativeCostWei: bridgeNativeFee + 15_120_000_000_000n,
        nativeBalanceWei: 1_000_000_000_000_000n, insufficientNativeBalance: false };
      h.gasCost = { ...h.gasCost, estimate, current: estimate };
      h.rerender?.();
    }, fixture);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-compact-review]');
    await expect(review).toHaveAttribute('data-review-phase', 'review');
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.screenshot({ path: info.outputPath(`wide-move-${size.width}x${size.height}.png`), animations: 'disabled' });
    const closed = await essentialReviewGeometry(review);
    const amounts = review.getByRole('region', { name: 'Bridge amounts and terms' });
    const figures = await amounts.evaluate(element => ['Amount', 'Estimated received'].map(label => {
      const leg = element.querySelector(`[data-review-fact="${label}"]`)!;
      const amount = leg.querySelector('[class*="amountText"] > div > span')!;
      const numericText = [...amount.childNodes].find(node => node.nodeType === Node.TEXT_NODE && /\d/.test(node.textContent ?? ''));
      if (!numericText) throw new Error('Wide Move fixture requires a numeric amount');
      const range = document.createRange();
      range.selectNodeContents(numericText);
      return { label, leg: leg.getBoundingClientRect().toJSON(), amount: amount.getBoundingClientRect().toJSON(),
        number: range.getBoundingClientRect().toJSON(), numberLines: [...range.getClientRects()].map(rect => rect.toJSON()),
        unit: amount.querySelector('span')!.getBoundingClientRect().toJSON(),
        fontSize: getComputedStyle(amount).fontSize, unitFontSize: getComputedStyle(amount.querySelector('span')!).fontSize,
        overflow: leg.scrollWidth - leg.clientWidth };
    }));
    const evidence = JSON.stringify({ closed, figures }, null, 2);
    await writeFile(info.outputPath('wide-move-geometry.json'), evidence);
    await info.attach('wide-move-geometry', { body: evidence, contentType: 'application/json' });
    await expect(amounts.locator('[data-wide-amounts]')).toHaveAttribute('data-wide-amounts', 'true');
    await expect(amounts.locator('[data-review-fact="Amount"] [class*="amountText"] > div > span')).toHaveText(fixture.sent);
    await expect(amounts.locator('[data-review-fact="Estimated received"] [class*="amountText"] > div > span')).toHaveText(fixture.received);
    await expect(amounts.locator('[data-review-fact="Price impact"]')).toHaveCount(0);
    expect(figures[1].leg.top, 'Long bridge legs stack without overlapping').toBeGreaterThanOrEqual(figures[0].leg.bottom);
    for (const figure of figures) {
      expect(figure.numberLines, `${figure.label} numerals remain on one line`).toHaveLength(1);
      expect(figure.overflow, `${figure.label} never clips the value or unit`).toBeLessThanOrEqual(1);
      for (const rect of [figure.number, figure.unit]) {
        expect(rect.left).toBeGreaterThanOrEqual(figure.leg.left - 1);
        expect(rect.right).toBeLessThanOrEqual(figure.leg.right + 1);
      }
      expect(figure.fontSize).toBe('24px');
      expect(figure.unitFontSize).toBe('14px');
      expect(Math.abs(figure.number.bottom - figure.unit.bottom), `${figure.label} token unit aligns beside the number`).toBeLessThanOrEqual(8);
      expect(figure.unit.left, `${figure.label} token unit follows the complete number`).toBeGreaterThanOrEqual(figure.number.right - 1);
      const unitCenter = (figure.unit.top + figure.unit.bottom) / 2;
      expect(unitCenter, `${figure.label} token unit remains on the number's line`).toBeGreaterThan(figure.number.top);
      expect(unitCenter).toBeLessThan(figure.number.bottom);
    }
    expectClosedReviewFits(closed);
    const action = review.locator('[data-review-actions] button');
    await expect(action).toBeInViewport({ ratio: 1 });
    await expect(action).toBeEnabled();
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
      return { amount: h.reviewRoute.quote.bridgeAmount.toString(), received: h.reviewRoute.quote.estimatedReceived.toString(), sendCount: h.sendCount };
    })).toEqual({ amount: fixture.amount, received: fixture.receivedAmount, sendCount: 0 });
  });
}

for (const fixture of [
  { size: { width: 320, height: 568 }, label: 'large Borrow', deposit: '1000000120000', collateral: '400000000000000000000', debt: '500000000000000000000000', collateralUsd: 960000,
    depositText: '1,000,000.12 USDC', netText: '497,500 fxUSD', collateralText: '400 stETH', debtText: '500,000 fxUSD' },
  { size: { width: 390, height: 500 }, label: 'large Borrow', deposit: '1000000120000', collateral: '400000000000000000000', debt: '500000000000000000000000', collateralUsd: 960000,
    depositText: '1,000,000.12 USDC', netText: '497,500 fxUSD', collateralText: '400 stETH', debtText: '500,000 fxUSD' },
  { size: { width: 320, height: 568 }, label: 'boundary Borrow', deposit: '25000000000', collateral: '10000000000000000000', debt: '12407708542713567839195', collateralUsd: 24000,
    depositText: '25,000 USDC', netText: '12,345.67 fxUSD', collateralText: '10 stETH', debtText: '≈ 12,407.71 fxUSD' },
]) {
  const { size } = fixture;
  test(`${fixture.label} retains exact input, debt and net proceeds without clipping at ${size.width}x${size.height}`, async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize(size);
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { presentationMode: true });
    await page.evaluate(input => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
      const wallet = h.wallet.address;
      const pool = '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8';
      const router = '0xB753366082466c4B5984312f0c4Bb97554be067E';
      const deposit = BigInt(input.deposit);
      const collateral = BigInt(input.collateral);
      const debt = BigInt(input.debt);
      h.financialFacts = true;
      h.displayPrices = { USDC: 1, stETH: 2400, ETH: 2400, fxUSD: 1 };
      h.reviewOperationLabel = 'Borrow fxUSD';
      h.reviewRoute = {
        operation: 'depositAndMint', chainId: 1, walletAddress: wallet,
        transactions: [{ chainId: 1, from: wallet, to: router, data: '0x216d5108', value: 0n,
          kind: 'action', type: 'depositAndMint', operation: 'depositAndMint' }],
        policy: { walletAddress: wallet, chainId: 1, reviewedAction: {
          kind: 'deposit-and-mint', poolAddress: pool, positionId: 0,
          depositTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', depositAmount: deposit,
          mintAmount: debt, nativeInput: false,
        } },
        details: {
          colls: collateral.toString(), debts: debt.toString(), stEthPerWstEth: '1250000000000000000',
          effectiveLeverage: input.collateralUsd / (input.collateralUsd - Number(debt) / 1e18),
          liquidationQuote: { poolAddress: pool, liquidateRatio: '900000000000000000', rebalanceRatio: '800000000000000000',
            stEthPerWstEth: '1250000000000000000', readAt: Date.now() },
          protocolFeeQuote: { poolAddress: pool, routerAddress: router, ratios: ['0', '0', '5000000', '0'] },
          borrowFundingQuote: { poolAddress: pool, ratio: '45318576060452136', netRatio: '45318576060452136', readAt: Date.now() },
        },
      };
      h.rerender?.();
    }, fixture);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-compact-review]');
    await expect(review).toHaveAttribute('data-review-phase', 'review');
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.screenshot({ path: info.outputPath(`large-borrow-${size.width}x${size.height}.png`), animations: 'disabled' });
    const closed = await essentialReviewGeometry(review);
    const geometry = await review.evaluate(element => {
      const flow = element.querySelector('[data-compact-amounts="2"]')!;
      const figures = ['Deposit', 'Estimated fxUSD received'].map(label => {
        const leg = flow.querySelector(`[data-review-fact="${label}"]`)!;
        const amount = leg.querySelector('[data-review-amount]')!;
        const numericText = [...amount.childNodes].find(node => node.nodeType === Node.TEXT_NODE && /\d/.test(node.textContent ?? ''));
        if (!numericText) throw new Error('Large Borrow fixture requires a numeric amount');
        const range = document.createRange();
        range.selectNodeContents(numericText);
        return { label, leg: leg.getBoundingClientRect().toJSON(), number: range.getBoundingClientRect().toJSON(),
          numberLines: [...range.getClientRects()].map(rect => rect.toJSON()),
          unit: amount.querySelector('span')!.getBoundingClientRect().toJSON(), overflow: leg.scrollWidth - leg.clientWidth };
      });
      const positionValues = [...element.querySelectorAll('[data-new-position] dl > div')].map(cell => {
        const value = cell.querySelector('strong')!;
        const range = document.createRange();
        range.selectNodeContents(value);
        return { text: value.textContent, cell: cell.getBoundingClientRect().toJSON(), value: value.getBoundingClientRect().toJSON(),
          lines: [...range.getClientRects()].map(rect => rect.toJSON()) };
      });
      return { figures, positionValues };
    });
    const evidence = JSON.stringify({ closed, ...geometry }, null, 2);
    await writeFile(info.outputPath('large-borrow-geometry.json'), evidence);
    await info.attach('large-borrow-geometry', { body: evidence, contentType: 'application/json' });
    await expect(review.locator('[data-review-fact="Deposit"] [data-review-amount]')).toHaveText(fixture.depositText);
    await expect(review.locator('[data-review-fact="Estimated fxUSD received"] [data-review-amount]')).toHaveText(fixture.netText);
    const position = review.getByRole('region', { name: 'Estimated position', exact: true });
    await expect(position.locator('dl > div').filter({ hasText: 'Collateral' })).toContainText(fixture.collateralText);
    await expect(position.locator('dl > div').filter({ hasText: 'Total debt' })).toContainText(fixture.debtText);
    expect(geometry.figures[1].leg.top).toBeGreaterThanOrEqual(geometry.figures[0].leg.bottom);
    for (const figure of geometry.figures) {
      expect(figure.numberLines, `${figure.label} keeps the complete quantity together`).toHaveLength(1);
      expect(figure.overflow).toBeLessThanOrEqual(1);
      for (const rect of [figure.number, figure.unit]) {
        expect(rect.left).toBeGreaterThanOrEqual(figure.leg.left - 1);
        expect(rect.right).toBeLessThanOrEqual(figure.leg.right + 1);
      }
      expect(figure.unit.left).toBeGreaterThanOrEqual(figure.number.right - 1);
      expect(Math.abs(figure.number.bottom - figure.unit.bottom)).toBeLessThanOrEqual(8);
    }
    for (const { text, cell, value, lines } of geometry.positionValues) {
      expect(new Set(lines.map(rect => Math.round(rect.top))).size, `Position quantity and unit remain intact: ${text}`).toBe(1);
      expect(value.left).toBeGreaterThanOrEqual(cell.left - 1);
      expect(value.right).toBeLessThanOrEqual(cell.right + 1);
    }
    expectClosedReviewFits(closed);
    const action = review.locator('[data-review-actions] button');
    await expect(action).toBeInViewport({ ratio: 1 });
    await expect(action).toBeEnabled();
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
      const intent = h.reviewRoute.policy.reviewedAction;
      return { deposit: intent.depositAmount.toString(), debt: intent.mintAmount.toString(),
        collateral: h.reviewRoute.details.colls, routeDebt: h.reviewRoute.details.debts, sendCount: h.sendCount };
    })).toEqual({ deposit: fixture.deposit, debt: fixture.debt, collateral: fixture.collateral,
      routeDebt: fixture.debt, sendCount: 0 });
  });
}

for (const size of [{ width: 390, height: 700 }, { width: 390, height: 500 }, { width: 320, height: 568 }]) {
  test(`tiny native ETH Borrow retains aligned amounts and unclipped units at ${size.width}x${size.height}`, async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize(size);
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { presentationMode: true });
    await page.evaluate(() => {
      const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
      const wallet = h.wallet.address;
      const pool = '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8';
      const router = '0xB753366082466c4B5984312f0c4Bb97554be067E';
      const deposit = 360_600_000_000_000n;
      const debt = 714_100_000_000_000_000n;
      const networkMaximum = 15_120_000_000_000n;
      h.financialFacts = true;
      h.displayPrices = { ETH: 2400, stETH: 2400, fxUSD: 1 };
      h.reviewOperationLabel = 'Borrow fxUSD';
      h.reviewRoute = {
        operation: 'depositAndMint', chainId: 1, walletAddress: wallet,
        transactions: [{ chainId: 1, from: wallet, to: router, data: '0x216d5108', value: deposit,
          kind: 'action', type: 'depositAndMint', operation: 'depositAndMint' }],
        policy: { walletAddress: wallet, chainId: 1, reviewedAction: {
          kind: 'deposit-and-mint', poolAddress: pool, positionId: 0,
          depositTokenAddress: '0x0000000000000000000000000000000000000000', depositAmount: deposit,
          mintAmount: debt, nativeInput: true,
        } },
        details: {
          colls: deposit.toString(), debts: debt.toString(), stEthPerWstEth: '1250000000000000000',
          effectiveLeverage: .86544 / (.86544 - .7141),
          liquidationQuote: { poolAddress: pool, liquidateRatio: '950000000000000000', rebalanceRatio: '880000000000000000',
            stEthPerWstEth: '1250000000000000000', readAt: Date.now() },
          protocolFeeQuote: { poolAddress: pool, routerAddress: router, ratios: ['0', '0', '5000000', '0'] },
          borrowFundingQuote: { poolAddress: pool, ratio: '45318576060452136', netRatio: '45318576060452136', readAt: Date.now() },
        },
      };
      // Native gas accounting must include the exact ETH carried by the route.
      // The 0.5% borrowed-debt fee leaves 0.7105295 fxUSD in net proceeds.
      const estimate = { ...h.gasCost.estimate, nativeValueWei: deposit,
        executionGasFeeWei: 12_600_000_000_000n, totalNativeCostWei: deposit + 12_600_000_000_000n,
        requiredNativeCostWei: deposit + networkMaximum, nativeBalanceWei: 721_280_000_000_000n,
        insufficientNativeBalance: false };
      h.gasCost = { ...h.gasCost, estimate, current: estimate };
      h.rerender?.();
    });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('[data-compact-review]');
    await expect(review).toHaveAttribute('data-review-phase', 'review');
    await page.evaluate(async () => {
      await document.fonts.load('600 28px Manrope');
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)));
    });
    await page.screenshot({ path: info.outputPath(`tiny-borrow-${size.width}x${size.height}.png`), animations: 'disabled' });
    const closed = await essentialReviewGeometry(review);
    const alignment = await review.evaluate(element => {
      const flow = element.querySelector('[data-compact-amounts="2"]')!;
      const figures = ['Deposit', 'Estimated fxUSD received'].map(label => {
        const leg = flow.querySelector(`[data-review-fact="${label}"]`)!;
        const amount = leg.querySelector('[data-review-amount]')!;
        const numericText = [...amount.childNodes].find(node => node.nodeType === Node.TEXT_NODE && /\d/.test(node.textContent ?? ''));
        if (!numericText) throw new Error('Tiny native fixture requires a visible numeric amount');
        const range = document.createRange();
        range.selectNodeContents(numericText);
        const number = range.getBoundingClientRect();
        return { leg: leg.getBoundingClientRect().toJSON(), amount: amount.getBoundingClientRect().toJSON(), unit: amount.querySelector('span')!.getBoundingClientRect().toJSON(),
          number: { left: number.left, right: number.right, top: number.top, bottom: number.bottom },
          overflow: leg.scrollWidth - leg.clientWidth };
      });
      const position = element.querySelector('[data-new-position]')!;
      const cells = [...position.querySelectorAll('dl > div')];
      const positionValues = cells.map(cell => {
        const value = cell.querySelector('strong')!;
        const range = document.createRange();
        range.selectNodeContents(value);
        return { cell: cell.getBoundingClientRect().toJSON(), value: value.getBoundingClientRect().toJSON(),
          text: value.textContent, lines: [...range.getClientRects()].map(rect => rect.toJSON()) };
      });
      const riskValues = ['Rebalance price', 'Liquidation price'].map(label => {
        const row = element.querySelector(`[data-review-fact="${label}"]`)!;
        const value = row.querySelector(':scope > span:last-child > span')!;
        const range = document.createRange();
        range.selectNodeContents(value);
        return { label, row: row.getBoundingClientRect().toJSON(), value: value.getBoundingClientRect().toJSON(),
          text: value.textContent, lines: [...range.getClientRects()].map(rect => rect.toJSON()) };
      });
      const terms = [...element.querySelectorAll('[data-review-essential] [data-review-fact]')]
        .filter(node => !flow.contains(node)).map(node => node.getBoundingClientRect().toJSON());
      return { flow: flow.getBoundingClientRect().toJSON(), figures, position: position.getBoundingClientRect().toJSON(), positionValues, riskValues, terms };
    });
    const evidence = JSON.stringify({ closed, alignment }, null, 2);
    await writeFile(info.outputPath('tiny-borrow-geometry.json'), evidence);
    await info.attach('tiny-borrow-geometry', { body: evidence, contentType: 'application/json' });
    await expect(review.locator('[data-review-fact="Deposit"] [data-review-amount]')).toHaveText('0.0003606 ETH');
    await expect(review.locator('[data-review-fact="Estimated fxUSD received"] [data-review-amount]')).toHaveText('≈ 0.7105 fxUSD');
    const position = review.getByRole('region', { name: 'Estimated position', exact: true });
    await expect(position.locator('dl > div').filter({ hasText: 'Total debt' })).toContainText('0.7141 fxUSD');
    await expect(position.locator('dl > div').filter({ hasText: 'Collateral' })).toContainText('0.0003606 stETH');
    const [source, receive] = alignment.figures;
    expect(Math.abs(source.number.bottom - receive.number.bottom), 'Deposit and net receive figures share a baseline').toBeLessThanOrEqual(1);
    expect(Math.abs(source.number.left - alignment.flow.left), 'Deposit starts on the main content edge').toBeLessThanOrEqual(1);
    expect(Math.abs(receive.unit.right - alignment.flow.right), 'Receive aligns to the right content edge').toBeLessThanOrEqual(1);
    expect(Math.abs(alignment.position.left - alignment.flow.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(alignment.position.right - alignment.flow.right)).toBeLessThanOrEqual(1);
    for (const figure of alignment.figures) {
      expect(figure.overflow, 'Amount legs never clip numbers or token units').toBeLessThanOrEqual(1);
      for (const rect of [figure.number, figure.unit]) {
        expect(rect.left).toBeGreaterThanOrEqual(figure.leg.left - 1);
        expect(rect.right).toBeLessThanOrEqual(figure.leg.right + 1);
      }
      expect(Math.abs(figure.number.bottom - figure.unit.bottom), 'Token units stay beside their numeric amount').toBeLessThanOrEqual(8);
    }
    for (const { cell, value, lines, text } of alignment.positionValues) {
      expect(value.left).toBeGreaterThanOrEqual(cell.left - 1);
      expect(value.right).toBeLessThanOrEqual(cell.right + 1);
      expect(new Set(lines.map(rect => Math.round(rect.top))).size, `Position quantity and unit stay together: ${text}`).toBe(1);
    }
    for (const { label, row, value, lines } of alignment.riskValues) {
      expect(value.left).toBeGreaterThanOrEqual(row.left - 1);
      expect(value.right).toBeLessThanOrEqual(row.right + 1);
      expect(new Set(lines.map(rect => Math.round(rect.top))).size, `${label} value and collateral unit stay together`).toBe(1);
    }
    for (const term of alignment.terms) {
      expect(Math.abs(term.left - alignment.flow.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(term.right - alignment.flow.right)).toBeLessThanOrEqual(1);
    }
    expectClosedReviewFits(closed);
    expect(await page.evaluate(() => (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness.sendCount)).toBe(0);
  });
}
