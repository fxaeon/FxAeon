import { test, expect } from '../fixtures/test';
import type { Page } from '@playwright/test';

const dock = (page: Page) => page.locator('nav.mobile-tabbar[aria-label="Primary navigation"]');
async function navigate(page: Page, label: string, pathname: string) {
  // Exercise the shipped Next Link, including unmount/save and mount/restore.
  // A full reload here would erase the session-only cache and hide that bug.
  await dock(page).getByRole('link', { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(pathname + '/?$'));
  await expect(page.locator('.app-workspace')).toHaveAttribute('data-route', pathname);
}

test.describe('Explicit context and wallet isolation', () => {
  test.use({ telegram: false, marketPrices: true });
  test('a market deep link takes priority over a saved Trade draft and scroll', async ({ page }) => {
    await page.goto('/trade');
    await page.getByRole('textbox', { name: 'Amount in ETH', exact: true }).fill('0.875');
    await page.getByRole('region', { name: 'What if ETH moves?' }).scrollIntoViewIfNeeded();
    await navigate(page, 'Portfolio', '/');
    await page.getByRole('link', { name: 'Trade BTC', exact: true }).click();
    await expect(page).toHaveURL(/\/trade\?market=BTC/);
    await expect(page.getByRole('textbox', { name: 'Amount in WBTC', exact: true })).toHaveValue('');
    await expect.poll(() => page.locator('[data-shell-content]').evaluate(element => element.scrollTop)).toBeLessThan(4);
  });
});

test.describe('Wallet-bound editing context', () => {
  test.use({ telegram: false, browserWallet: { address: '0x930f0000000000000000000000000000000098b9', initiallyConnected: true } });
  test('another wallet cannot restore the previous wallet’s Earn amount', async ({ page }) => {
    await page.goto('/earn');
    await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true }).fill('84.25');
    await navigate(page, 'Move', '/move');
    await page.evaluate(() => {
      const wallet = (window as unknown as { __wallet: { setAccounts: (accounts: string[]) => void } }).__wallet;
      wallet.setAccounts(['0x1111000000000000000000000000000000002222']);
    });
    await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toContainText('0x1111');
    await navigate(page, 'Earn', '/earn');
    await expect(page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true })).toHaveValue('');
  });
});

for (const route of [
  { path: '/trade', tab: 'Trade', amount: 'Amount in ETH', value: '0.375', away: 'Earn', awayPath: '/earn' },
  { path: '/earn', tab: 'Earn', amount: 'Amount in fxUSD', value: '112.25', away: 'Borrow', awayPath: '/borrow' },
  { path: '/borrow', tab: 'Borrow', amount: 'Collateral in ETH', value: '0.625', away: 'Move', awayPath: '/move' },
  { path: '/move', tab: 'Move', amount: 'Amount in fxUSD', value: '78.125', away: 'Trade', awayPath: '/trade' },
]) test.describe(route.tab + ' navigation context', () => {
  test.use({ telegram: false, marketPrices: true, browserWallet: { address: '0x930f0000000000000000000000000000000098b9', initiallyConnected: true } });
  test('restores editable inputs and the inner scroller through actual product links', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 560 });
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible({ timeout: 15_000 });
    const amount = page.getByRole('textbox', { name: route.amount, exact: true });
    await expect(amount).toBeEnabled();
    await amount.fill(route.value);
    await expect(amount).toHaveValue(route.value);
    if (route.path === '/borrow') {
      await page.getByRole('textbox', { name: 'fxUSD to borrow in fxUSD', exact: true }).fill('456.75');
    }
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__navigationContextDocument = 'same-document';
    });
    const content = page.locator('[data-shell-content]');
    const contentBox = await content.boundingBox();
    expect(contentBox).not.toBeNull();
    await page.mouse.move(contentBox!.x + contentBox!.width / 2, contentBox!.y + contentBox!.height * .7);
    // Native wheel intent cancels restoration; no programmatic scroll event
    // is misclassified as a person choosing a new position.
    await page.mouse.wheel(0, 220);
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(80);
    const savedScroll = await content.evaluate(async element => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return element.scrollTop;
    });
    expect(savedScroll, 'the test must actually move the app-owned scroller').toBeGreaterThan(80);
    await navigate(page, route.away, route.awayPath);
    await navigate(page, route.tab, route.path);
    await expect.poll(() => page.locator('[data-shell-content]').evaluate(element => element.scrollTop)).toBeGreaterThan(savedScroll - 3);
    await expect.poll(() => page.locator('[data-shell-content]').evaluate(element => element.scrollTop)).toBeLessThan(savedScroll + 3);
    await expect(amount).toBeVisible();
    await expect(amount).toHaveValue(route.value);
    if (route.path === '/earn') {
      // A native fieldset/container-query regression previously retained the
      // input value but collapsed every amount descendant to a zero-size box.
      expect(await amount.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    if (route.path === '/borrow') await expect(page.getByRole('textbox', { name: 'fxUSD to borrow in fxUSD', exact: true })).toHaveValue('456.75');
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__navigationContextDocument)).toBe('same-document');
    await expect(page.locator('[data-mobile-review-sheet]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    if (route.path === '/trade') {
      // A new wheel gesture after return must immediately release the restored
      // coordinate, even within the bounded initial-layout observation window.
      const returnedBox = await content.boundingBox();
      await page.mouse.move(returnedBox!.x + returnedBox!.width / 2, returnedBox!.y + returnedBox!.height * .7);
      await page.mouse.wheel(0, 100);
      await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(savedScroll + 30);
    }
  });
});

test.describe('Earn withdrawal editing context', () => {
  test.use({ telegram: false });
  test('retains the withdrawal method and shares, then keeps an explicit cleared intent cleared', async ({ page }) => {
    await page.goto('/earn', { waitUntil: 'domcontentloaded' });
    await page.getByRole('radio', { name: 'Withdraw', exact: true }).click();
    const methods = page.getByRole('group', { name: 'Withdrawal method' });
    await methods.getByRole('radio', { name: /^Instant/ }).locator('..').click();
    const shares = page.getByRole('textbox', { name: 'Amount in fxSAVE', exact: true });
    await shares.fill('7.125');
    await navigate(page, 'Move', '/move');
    await navigate(page, 'Earn', '/earn');
    await expect(page.getByRole('radio', { name: 'Withdraw', exact: true })).toBeChecked();
    await expect(methods.getByRole('radio', { name: /^Instant/ })).toBeChecked();
    await expect(shares).toHaveValue('7.125');
    await page.getByRole('radio', { name: 'Deposit', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true })).toHaveValue('');
    await navigate(page, 'Trade', '/trade');
    await navigate(page, 'Earn', '/earn');
    await expect(page.getByRole('radio', { name: 'Deposit', exact: true })).toBeChecked();
    await expect(page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true })).toHaveValue('');
  });
});
