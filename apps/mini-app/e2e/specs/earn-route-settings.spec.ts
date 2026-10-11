import { test, expect, assertNoBackendRequests } from '../fixtures/test';

test.describe('Earn route-specific settings', () => {
  test.use({ telegram: false });

  for (const width of [320, 393]) {
    test(`only instant stable withdrawals offer slippage at ${width}px`, async ({ page, requests }, testInfo) => {
      await page.setViewportSize({ width, height: 852 });
      await page.goto('/earn', { waitUntil: 'domcontentloaded' });
      const settings = page.getByRole('button', { name: /^Transaction settings,/ });
      const checkSettings = async (hasSlippage: boolean) => {
        await settings.click();
        const dialog = page.getByRole('dialog', { name: 'Transaction settings', exact: true });
        await expect(dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' })).toHaveCount(hasSlippage ? 1 : 0);
        await expect(dialog.getByRole('radiogroup', { name: 'Network speed' })).toHaveCount(0);
        await expect(dialog.getByText('Review and confirm the network fee in your connected wallet.')).toBeVisible();
        const box = await dialog.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: testInfo.outputPath(`settings-${hasSlippage ? 'slippage' : 'gas-only'}-${width}.png`), fullPage: true, animations: 'disabled' });
        await page.keyboard.press('Escape');
        await expect(page.locator('[role="dialog"][aria-label="Transaction settings"]')).toHaveCount(0);
        await expect(settings).toBeFocused();
      };
      for (const token of ['fxUSD', 'usdc', 'fxUSDBasePool']) {
        await page.goto(`/earn?token=${token}`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('button', { name: 'Transaction settings, Fees set in wallet', exact: true })).toBeVisible();
        await checkSettings(false);
        // The deposit view stays compact: limits belong to the review, not to helper copy here.
        await expect(page.getByText(/slippage/i)).toHaveCount(0);
        if (token === 'fxUSDBasePool') {
          await page.screenshot({ path: testInfo.outputPath(`base-pool-deposit-${width}.png`), fullPage: true, animations: 'disabled' });
        }
        await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).last()).toBeVisible();
      }
      for (const token of ['fxUSD', 'usdc']) {
        await page.goto(`/earn?mode=withdraw&token=${token}`, { waitUntil: 'domcontentloaded' });
        const methods = page.getByRole('group', { name: 'Withdrawal method' });
        await expect(methods.getByRole('radio', { name: /^Instant/ })).toBeChecked();
        await checkSettings(true);
        await methods.getByRole('radio', { name: /After cooldown/ }).locator('..').click();
        await expect(page.getByText(/A queued withdrawal is claimed later/)).toBeVisible();
        await checkSettings(false);
        await page.locator('.sticky-action-sentinel').scrollIntoViewIfNeeded();
        await expect(page.locator('.sticky-action')).not.toHaveAttribute('data-riding', 'true');
        await page.screenshot({ path: testInfo.outputPath(`queued-${token}-${width}.png`), fullPage: true, animations: 'disabled' });
        await methods.getByRole('radio', { name: /^Instant/ }).locator('..').click();
        await checkSettings(true);
        await expect(page.getByLabel('Amount in fxSAVE')).toBeEnabled();
      }
      await page.goto('/earn?mode=withdraw&token=fxUSDBasePool', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('group', { name: 'Withdrawal method' })).toHaveCount(0);
      await expect(page.getByText(/with no queued claim/)).toBeVisible();
      await expect(page.getByText(/A queued withdrawal is claimed later/)).toHaveCount(0);
      await checkSettings(false);
      await page.screenshot({ path: testInfo.outputPath(`direct-base-pool-${width}.png`), fullPage: true, animations: 'disabled' });
      expect(await page.getByRole('main').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await page.goto('/earn?mode=claim', { waitUntil: 'domcontentloaded' });
      await expect(settings).toHaveCount(0);
      await expect(page.getByText('Connect the requesting wallet to view its withdrawal.')).toBeVisible();
      assertNoBackendRequests(requests);
    });
  }
});

test.describe('Earn unavailable reads', () => {
  test.use({ telegram: false, browserWallet: { address: '0x930f0000000000000000000000000000000098b9', initiallyConnected: true } });

  test('route settings cannot bypass unavailable balance or vault reads', async ({ page, requests }) => {
    for (const mode of ['deposit', 'withdraw']) {
      await page.goto(`/earn?mode=${mode}&token=fxUSDBasePool`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible();
      await page.getByRole('textbox', { name: mode === 'deposit' ? 'Amount in fxSP' : 'Amount in fxSAVE', exact: true }).fill('1');
      await expect(page.getByRole('button', { name: mode === 'deposit' ? 'Review deposit' : 'Review withdrawal', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: /^Transaction settings,/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Transaction settings', exact: true });
      await expect(dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: mode === 'deposit' ? 'Review deposit' : 'Review withdrawal', exact: true })).toBeDisabled();
    }
    assertNoBackendRequests(requests);
  });
});
