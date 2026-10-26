import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { positionPoolAddress } from '../../src/lib/fx/policy';
import { openHarness, metric } from '../harness/action-review-measurement-support';
import { essentialReviewGeometry, expectClosedReviewFits } from '../harness/review-essential-geometry';

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
      if (instant) h.displayPrices = { fxUSD: .98, USDC: 1.01 };
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
    await page.evaluate(async () => {
      await document.fonts.load('600 28px Manrope');
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)));
    });
    const essential = await essentialReviewGeometry(review);
    const evidence = JSON.stringify({ kind, size, ...essential }, null, 2);
    await writeFile(info.outputPath('initial-essential-geometry.json'), evidence);
    await info.attach('initial-essential-geometry', { body: evidence, contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath(`${kind}-${size.width}.png`), animations: 'disabled' });
    expectClosedReviewFits(essential);
    await expect(review.locator('details[data-review-secondary]')).toHaveCount(0);
    await expect(review.locator('[data-review-essential] [data-review-fact="Gas fee"]')).toBeVisible();
    if (kind === 'trade' || kind === 'borrow') {
      const expectedPrices = kind === 'borrow'
        ? { 'Rebalance price': '$1,562.5 / stETH', 'Liquidation price': '$1,388.89 / stETH' }
        : { 'Rebalance price': '$2,083.34 / stETH', 'Liquidation price': '$1,851.86 / stETH' };
      for (const label of ['Rebalance price', 'Liquidation price']) {
        const risk = review.locator(`[data-review-essential] [data-review-fact="${label}"]`);
        await expect(risk).toContainText(expectedPrices[label as keyof typeof expectedPrices]);
        await expect(risk).toBeVisible();
      }
      await expect(review.locator('[data-review-fact="Risk estimates"]')).toHaveCount(0);
    }
    const action = review.locator('[data-review-actions] button');
    await expect(action).toBeInViewport({ ratio: 1 });
    expect((await action.boundingBox())!.height, 'Primary review action retains at least 48px height').toBeGreaterThanOrEqual(48);
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
      await expect(review.locator('[data-review-actions]')).toContainText('Add 0.001008 ETH on Ethereum for fees.');
      const position = review.getByRole('region', { name: 'Estimated position', exact: true });
      await expect(position).toBeVisible();
      const debt = position.locator('dl > div').filter({ hasText: 'Total debt' });
      const ltv = position.locator('dl > div').filter({ hasText: 'LTV' });
      await expect(debt).toContainText('50 fxUSD');
      await expect(ltv).toContainText('50%');
      await expect(review.locator('[data-review-fact="Debt added"]')).toHaveCount(0);
      // Match a complete zero amount, not the trailing zero in 50 fxUSD or 50%.
      await expect(position).not.toContainText(/(?:^|[^\d.,])0(?:\.0+)?\s*(?:stETH|fxUSD|%)(?![A-Za-z])/);
      await expect(position.getByText('Current → estimated', { exact: true })).toHaveCount(0);
      const borrowRate = review.locator('[data-review-essential] [data-review-fact="Borrow rate"] [role="status"][aria-label="Borrow rate unavailable"]');
      await expect(borrowRate).toBeAttached();
      await expect(borrowRate).toHaveText('');
    }
    if (kind === 'trade' && size.width <= 390) {
      const leg = review.locator('[data-compact-amounts] [data-review-fact]').first();
      const usd = leg.locator('[data-usd-state="unavailable"]');
      const network = leg.locator('[data-network]');
      await expect(usd).toBeAttached();
      await expect(usd).toHaveText('');
      await expect(usd.getByRole('status', { name: 'USD value unavailable' })).toBeAttached();
      await expect(network).toHaveText('Ethereum');
      const metadata = await network.evaluate(element => ({
        left: element.getBoundingClientRect().left,
        lineLeft: element.parentElement!.getBoundingClientRect().left,
        marker: getComputedStyle(element, '::before').content,
      }));
      expect(metadata.marker).toBe('none');
      expect(Math.abs(metadata.left - metadata.lineLeft)).toBeLessThanOrEqual(1);
    }
    if (kind === 'move') {
      const amounts = review.getByRole('region', { name: 'Bridge amounts and terms' });
      const sent = amounts.locator('[data-review-fact="Amount"]');
      const received = amounts.locator('[data-review-fact="Estimated received"]');
      const sentAmount = sent.locator('[class*="amountText"] > div > span');
      const receivedAmount = received.locator('[class*="amountText"] > div > span');
      await expect(sentAmount).toHaveText('2,500 fxUSD');
      await expect(sent.locator('details')).toHaveCount(0);
      await expect(sent.getByText('Ethereum', { exact: true })).toBeVisible();
      await expect(receivedAmount).toHaveText('2,497.5 fxUSD');
      await expect(received.locator('details')).toHaveCount(0);
      await expect(received.getByText('Base', { exact: true })).toBeVisible();
      for (const leg of [sent, received]) {
        const unitGap = await leg.evaluate(element => {
          const amount = element.querySelector('[class*="amountText"] > div > span')!;
          const figure = [...amount.childNodes].find(node => node.nodeType === Node.TEXT_NODE && /\d/.test(node.textContent ?? '')) as Text | undefined;
          const unit = amount.querySelector('[class*="flowUnit"]');
          if (!figure || !unit) throw new Error('Bridge fixture requires a visible amount and unit');
          const range = document.createRange();
          range.selectNodeContents(figure);
          range.setEnd(figure, figure.textContent!.trimEnd().length);
          return unit.getBoundingClientRect().left - range.getBoundingClientRect().right;
        });
        expect(unitGap, 'Bridge amount and unit remain visibly separated on one line').toBeGreaterThanOrEqual(2);
        const graphics = await leg.evaluate(element => {
          const amount = element.querySelector('[class*="amountText"] > div > span')!;
          const number = [...amount.childNodes].find(node => node.nodeType === Node.TEXT_NODE && /\d/.test(node.textContent ?? ''));
          if (!number) throw new Error('Bridge fixture requires a visible numeric amount');
          // The amount's alignment box includes empty space above its text.
          // Measure the numeral itself so only actual text/icon overlap fails.
          const range = document.createRange();
          range.selectNodeContents(number);
          const figure = range.getBoundingClientRect();
          return [...element.querySelectorAll('img,svg')].map(node => {
            const icon = node.getBoundingClientRect();
            return { width: icon.width, height: icon.height, overlaps: Math.min(icon.right, figure.right) - Math.max(icon.left, figure.left) > .5
              && Math.min(icon.bottom, figure.bottom) - Math.max(icon.top, figure.top) > .5 };
          });
        });
        expect(graphics.length).toBeGreaterThan(0);
        for (const graphic of graphics) {
          expect(graphic.width).toBeGreaterThan(0);
          expect(graphic.height).toBeGreaterThan(0);
          expect(graphic.overlaps, 'Bridge token and chain graphics must not paint over the numeric amount').toBe(false);
        }
      }
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
      await expect(review.locator('[data-review-fact="Bridge fee"]')).toContainText('0.0001 ETH');
      await expect(review.locator('[data-review-fact="Delivery estimate"]')).toHaveCount(0);
    }
    if (kind === 'earn-instant') {
      const fee = review.locator('[data-review-fact="f(x) fee"]');
      // The accepted quote charges 0.6 fxUSD + 0.4 USDC before conversion.
      // Independent fresh prices give $0.992; neither token assumes a peg.
      await expect(fee.locator('[data-usd-state]')).toHaveText('≈ $0.99');
      const feeValue = fee.locator('[data-usd-state]');
      const feeBox = await feeValue.boundingBox();
      expect(feeBox!.width).toBeGreaterThan(0);
      expect(feeBox!.height).toBeGreaterThan(0);
      const feeGeometry = await feeValue.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const neighbors = [...document.querySelectorAll<HTMLElement>('[data-review-viewport] button, [data-review-viewport] summary, [data-review-viewport] a[href]')]
          .filter(other => !other.contains(element) && !element.contains(other))
          .filter(other => { const box = other.getBoundingClientRect(); return box.width > 0 && box.height > 0
            && Math.min(box.right, rect.right) - Math.max(box.left, rect.left) > .5
            && Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top) > .5; })
          .map(other => other.getAttribute('aria-label') ?? other.textContent?.trim());
        return neighbors;
      });
      expect(feeGeometry, 'Static fee estimate must not overlap neighboring controls').toEqual([]);
      await expect(fee.locator('details, summary')).toHaveCount(0);
      await page.evaluate(() => {
        const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
        h.displayPrices = { USDC: 1.01 }; h.rerender?.();
      });
      await expect(fee.locator('[data-usd-state="unavailable"]')).toHaveText('');
      await expect(fee.locator('details, summary')).toHaveCount(0);
      await page.evaluate(() => {
        const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
        h.displayPrices = { fxUSD: .98, USDC: 1.01 }; h.rerender?.();
      });
      await expect(fee.locator('[data-usd-state]')).toHaveText('≈ $0.99');
      const received = review.locator('[data-review-fact="Estimated received"]');
      await expect(received.getByText('Receive · est.', { exact: true })).toBeVisible();
      await expect(received.locator('[data-review-amount]')).toHaveText('99 USDC');
      await expect(received.locator('summary')).toHaveCount(0);
      await expect(received.locator('[data-review-amount]')).toHaveText('99 USDC');
    }
    if (kind === 'earn-queue') await expect(review.locator('[data-review-fact="Availability"]')).toContainText('claim required');
    if (kind === 'earn-deposit') await expect(review.locator('[data-review-fact="Final fxSAVE minimum"]')).toHaveCount(0);
    await expect(review.locator('details[aria-label="Advanced transaction details"]')).toHaveCount(0);
    await expect(action).toBeInViewport({ ratio: 1 });
    const close = page.getByRole('button', { name: 'Close transaction review', exact: true });
    if (await close.count()) await close.click();
    else await page.locator('[data-review-edit]').first().click();
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
  });
}

test('compact amount headers wrap above figures at 320px with long roles and 200% text', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  await openHarness(page, { presentationMode: true });
  await page.evaluate(() => {
    const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
    const wallet = h.wallet.address;
    h.financialFacts = true;
    h.reviewRoute = { operation: 'depositAndMint', chainId: 1, walletAddress: wallet,
      transactions: [{ chainId: 1, from: wallet, to: '0xB753366082466c4B5984312f0c4Bb97554be067E', data: '0x216d5108', value: 0n, kind: 'action', type: 'depositAndMint', operation: 'depositAndMint' }],
      policy: { walletAddress: wallet, chainId: 1, reviewedAction: { kind: 'deposit-and-mint', poolAddress: '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8', positionId: 0,
        depositTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', depositAmount: 100000000n, mintAmount: 50000000000000000000n, nativeInput: false } },
      details: { colls: '40000000000000000', debts: '50000000000000000000', stEthPerWstEth: '1250000000000000000', effectiveLeverage: 2,
        protocolFeeQuote: { poolAddress: '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8', routerAddress: '0xB753366082466c4B5984312f0c4Bb97554be067E', ratios: ['0', '0', '5000000', '0'] } } };
    h.rerender();
  });
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  const flow = page.locator('[data-review-essential] [data-compact-amounts="2"]');
  await expect(flow).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.load('600 28px Manrope');
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)));
  });
  async function expectFlowGeometry() {
    const legs = await flow.locator('[data-review-fact]').evaluateAll(elements => elements.map(leg => {
      const figureNode = leg.querySelector('[data-review-amount]')!;
      const figure = figureNode.getBoundingClientRect();
      const heading = leg.querySelector('[class*="heading"]')!;
      const role = heading.children[1].getBoundingClientRect();
      const network = heading.children[2]?.getBoundingClientRect();
      const bounds = leg.getBoundingClientRect();
      const usd = leg.querySelector('[data-usd-state]')!.getBoundingClientRect();
      const graphics = [...heading.querySelectorAll('img,svg')].map(node => node.getBoundingClientRect());
      return { figureHeight: figure.height, headingBottom: heading.getBoundingClientRect().bottom,
        graphicsBottom: Math.max(...graphics.map(graphic => graphic.bottom)), graphicsCount: graphics.length,
        figureTop: figure.top, figureLeft: figure.left, figureRight: figure.right, usdLeft: usd.left, usdRight: usd.right,
        left: bounds.left, right: bounds.right, roleNetworkOverlap: Boolean(network
          && Math.min(role.right, network.right) - Math.max(role.left, network.left) > .5
          && Math.min(role.bottom, network.bottom) - Math.max(role.top, network.top) > .5) };
    }));
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      expect(leg.figureHeight).toBeGreaterThan(0);
      expect(leg.headingBottom).toBeLessThanOrEqual(leg.figureTop + 1);
      expect(leg.graphicsCount).toBeGreaterThan(0);
      expect(leg.graphicsBottom, 'Token and chain graphics must not paint over the number').toBeLessThanOrEqual(leg.figureTop + 1);
      expect(leg.roleNetworkOverlap).toBe(false);
      expect(leg.figureLeft).toBeGreaterThanOrEqual(leg.left - 1);
      expect(leg.figureRight).toBeLessThanOrEqual(leg.right + 1);
      expect(leg.usdLeft).toBeGreaterThanOrEqual(leg.left - 1);
      expect(leg.usdRight).toBeLessThanOrEqual(leg.right + 1);
    }
  }
  await expectFlowGeometry();
  // Deliberately stress only presentation copy; accepted facts and amounts
  // remain unchanged. These labels model longer supported position roles.
  await flow.locator('[data-review-fact] [class*="heading"]').evaluateAll(headings => {
    ['Position size · estimated', 'Collateral returned'].forEach((text, index) => { headings[index].children[1].textContent = text; });
  });
  await expectFlowGeometry();
  await page.evaluate(() => {
    const text = [...document.querySelectorAll<HTMLElement>('body *')].filter(element => !element.closest('svg')
      && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
      .map(element => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of text) element.style.setProperty('font-size', `${size * 2}px`, 'important');
  });
  await expectFlowGeometry();
  expect(await metric(page, 'send')).toBe(0);
});

test('execution price keeps its amount and complete token unit on one line at phone widths', async ({ page }, info) => {
  test.setTimeout(90_000);
  const fixtures = (['ETH', 'BTC'] as const).flatMap(market => (['long', 'short'] as const).map(side => ({
    market, side, pool: positionPoolAddress(market, side), price: market === 'ETH' ? '2000.123456' : '87542.35',
  })));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  await openHarness(page, { presentationMode: true });
  await page.evaluate(fixtures => {
    const h = (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness;
    const wallet = h.wallet.address;
    const install = ({ market, side, pool, price }: typeof fixtures[number]) => {
      h.reviewOperationLabel = `Open ${market} ${side === 'long' ? 'Long' : 'Short'}`;
      h.reviewRoute = { operation: 'increasePosition', chainId: 1, walletAddress: wallet,
        transactions: [{ chainId: 1, from: wallet, to: '0x33636D49FbefBE798e15e7F356E8DBef543CC708', data: '0x12345678', value: 0n, kind: 'action', type: 'increasePosition', operation: 'increasePosition' }],
        policy: { walletAddress: wallet, chainId: 1, reviewedAction: { kind: 'position-increase', poolAddress: pool, positionId: 0, positionType: side,
          inputTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', inputAmount: 100000000n, nativeInput: false,
          requestedLeverage: 3, slippagePercent: .5 } },
        details: { executionPrice: price, colls: '96000000000000000', debts: '200000000000000000000', stEthPerWstEth: '1250000000000000000', effectiveLeverage: 3 } };
      h.rerender?.();
    };
    h.financialFacts = true;
    install(fixtures[0]);
    h.__installExecutionPriceFixture = install;
  }, fixtures);
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  let first = true;
  for (const fixture of fixtures) {
    for (const width of [320, 390] as const) {
      await page.setViewportSize({ width, height: 740 });
      if (!first) {
        await page.getByRole('button', { name: 'Close transaction review', exact: true }).click();
        await page.evaluate(fixture => (globalThis as typeof globalThis & { __actionReviewHarness: any }).__actionReviewHarness.__installExecutionPriceFixture(fixture), fixture);
        await page.getByRole('button', { name: 'Review position', exact: true }).click();
      }
      first = false;
      const row = page.locator('[data-review-fact="Execution price"]');
      await expect(row, `${fixture.market} ${fixture.side} at ${width}px`).toBeVisible();
      const geometry = await row.evaluate(element => {
        const value = element.querySelector(':scope > span:last-child') as HTMLElement;
        const text = value.querySelector('.value') ?? value;
        const range = document.createRange(); range.selectNodeContents(text);
        const rects = [...range.getClientRects()];
        const rowBox = element.getBoundingClientRect(); const valueBox = value.getBoundingClientRect();
        const tops = rects.map(rect => rect.top);
        return { text: text.textContent?.trim(), baselineSpread: tops.length ? Math.max(...tops) - Math.min(...tops) : Infinity,
          insideRow: valueBox.left >= rowBox.left - 1 && valueBox.right <= rowBox.right + 1,
          textInsideValue: rects.every(rect => rect.left >= valueBox.left - 1 && rect.right <= valueBox.right + 1) };
      });
      expect(geometry.text).toMatch(fixture.market === 'ETH' ? /fxUSD \/ stETH$/ : /fxUSD \/ WBTC$/);
      expect(geometry.baselineSpread, 'Price and quote denomination share one visual line despite subpixel font metrics').toBeLessThanOrEqual(2);
      expect(geometry.insideRow).toBe(true);
      expect(geometry.textInsideValue).toBe(true);
      await page.screenshot({ path: info.outputPath(`execution-price-${fixture.market}-${fixture.side}-${width}.png`), animations: 'disabled' });
    }
  }
  expect(await metric(page, 'send')).toBe(0);
});
