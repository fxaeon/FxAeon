import { test, expect, assertNoBackendRequests } from '../fixtures/test';
import { FX_SAVE_APY_ENDPOINT, FX_SAVE_TOKEN_ADDRESS } from '../../src/lib/fxSaveApy';

test.describe('Earn entry and honest unavailable state', () => {
  test.use({ telegram: false });

  test('keeps the position, APY, action tabs, and primary action together on a normal phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto('/earn', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'fxSAVE', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your fxSAVE earnings' }).getByText('APY', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Deposit', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Withdraw', exact: true })).toBeVisible();
    const primary = page.getByRole('button', { name: 'Connect wallet', exact: true }).last();
    await expect(primary).toBeVisible();
    const nav = page.locator('nav.mobile-tabbar[aria-label="Primary navigation"]');
    await expect(nav).toBeVisible();
    const geometry = await page.evaluate(() => {
      const action = document.querySelector<HTMLElement>('.reviewTrigger .button-primary');
      const navigation = document.querySelector<HTMLElement>('nav.mobile-tabbar[aria-label="Primary navigation"]');
      if (!action || !navigation) throw new Error('Earn primary action and bottom navigation must be mounted');
      return { actionBottom: action.getBoundingClientRect().bottom, navTop: navigation.getBoundingClientRect().top };
    });
    expect(geometry.actionBottom, 'Earn primary action must clear the fixed bottom navigation').toBeLessThanOrEqual(geometry.navTop + 1);
  });

  test('keeps the narrow Earn form within 320px while allowing natural vertical scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/earn', { waitUntil: 'domcontentloaded' });
    const main = page.getByRole('main');
    await expect(main).toBeVisible();
    const widths = await main.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(widths.scroll - widths.client).toBeLessThanOrEqual(1);
    const primary = page.getByRole('button', { name: 'Connect wallet', exact: true }).last();
    await primary.scrollIntoViewIfNeeded();
    await expect(primary).toBeInViewport();
  });

  test('disconnected users can edit the earn form and enter through its review action', async ({ page, requests }) => {
    await page.goto('/earn', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Earn', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Borrow fxUSD', exact: true })).toHaveCount(0);
    const amount = page.getByLabel('Amount in fxUSD', { exact: true });
    await expect(amount).toBeVisible();
    await expect(amount).toBeEnabled();
    await amount.fill('112');
    await expect(amount).toHaveValue('112');
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry fxSAVE data', exact: true })).toHaveCount(0);
    await expect(page.getByText('fxSAVE balance unavailable', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Claim', exact: true })).toHaveCount(0);
    await expect(page.getByText(/claim success|claimed successfully/i)).toHaveCount(0);
    assertNoBackendRequests(requests);
  });

  test('mobile withdrawal explains both methods without compressing the form', async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await page.goto('/earn', { waitUntil: 'domcontentloaded' });
    const withdraw = page.getByRole('radio', { name: 'Withdraw', exact: true });
    await withdraw.click();
    await expect(withdraw).toHaveAttribute('aria-checked', 'true');
    const methods = page.getByRole('group', { name: 'Withdrawal method' });
    await expect(methods).toBeVisible();
    const cooldown = methods.getByRole('radio', { name: /After cooldown/ });
    const instant = methods.getByRole('radio', { name: /Instant/ });
    await expect(cooldown).toBeVisible();
    await expect(instant).toBeVisible();
    await cooldown.click();
    await expect(cooldown).toBeChecked();
    await expect(page.getByRole('region', { name: 'Withdrawal outcome' })).toContainText('Claim later');
    await expect(page.getByRole('region', { name: 'Withdrawal outcome' })).toContainText('fxUSD + USDC');
    const amount = page.getByLabel('Amount in fxSAVE');
    await expect(amount).toBeVisible();
    await expect(amount).toBeEnabled();
    await amount.fill('1.25');
    await expect(amount).toHaveValue('1.25');
    const overflow = await page.getByRole('main').evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    assertNoBackendRequests(requests);
  });

  test('claim deep links remain available without a permanent empty tab', async ({ page, requests }) => {
    await page.goto('/earn?mode=claim', { waitUntil: 'domcontentloaded' });
    const claimDetails = page.getByRole('dialog', { name: 'Withdrawal details', exact: true });
    await expect(claimDetails.getByRole('heading', { name: 'Withdrawal details', exact: true })).toBeVisible();
    await expect(claimDetails.getByText('Connect the requesting wallet to view its withdrawal.')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Claim', exact: true })).toHaveCount(0);
    await claimDetails.getByRole('button', { name: 'Close transaction review', exact: true }).click();
    await expect(claimDetails).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Withdraw', exact: true })).toHaveAttribute('aria-checked', 'true');
    assertNoBackendRequests(requests);
  });
});

test.describe('connected Earn summary at normal phone width', () => {
  test.use({
    telegram: false,
    browserWallet: { address: '0x930f0000000000000000000000000000000098b9', initiallyConnected: true },
  });

  test('keeps the honest fxSAVE balance and APY row above bottom navigation', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.route(FX_SAVE_APY_ENDPOINT, route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 200, data: { fxSave: { address: FX_SAVE_TOKEN_ADDRESS, apy: '6.96' } } }),
    }));
    await page.goto('/earn', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^(?:Your fxSAVE value|Last verified fxSAVE value|fxSAVE balance)$/)).toBeVisible();
    await expect(page.getByText('Last verified position value', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'fxSAVE balance' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Your fxSAVE earnings' }).getByText('APY', { exact: true })).toBeVisible();
    // MetricLabel nests the label with its help trigger. The nearest div is
    // the complete rate group, including the independently rendered value.
    const apyRow = page.getByRole('region', { name: 'Your fxSAVE earnings' }).getByText('APY', { exact: true }).locator('xpath=ancestor::div[1]');
    await expect(apyRow.getByText('6.96%', { exact: true })).toBeVisible();
    const geometry = await page.evaluate(() => {
      const summary = document.querySelector<HTMLElement>('[class*="balanceTop"]');
      const navigation = document.querySelector<HTMLElement>('nav.mobile-tabbar[aria-label="Primary navigation"]');
      if (!summary || !navigation) throw new Error('Earn balance summary and bottom navigation must be mounted');
      return { summaryBottom: summary.getBoundingClientRect().bottom, navTop: navigation.getBoundingClientRect().top };
    });
    expect(geometry.summaryBottom, 'Earn balance and APY should remain visible above navigation').toBeLessThanOrEqual(geometry.navTop + 1);
  });
});
