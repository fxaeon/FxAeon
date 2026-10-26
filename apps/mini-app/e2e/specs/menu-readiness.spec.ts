import { expect, test } from '../fixtures/test';

test.use({ telegram: false, browserWallet: { initiallyConnected: false } });

test('first mobile menu opens without fetching another script and preserves the form', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/earn');
  const amount = page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true });
  await expect(amount).toBeEnabled();
  await amount.fill('12.34');
  // A ready shell must already contain navigation. A cold menu must remain
  // usable even when the connection cannot deliver another JavaScript chunk.
  await page.route('**/_next/static/**/*.js', route => route.abort());
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'More menu', exact: true });
  await expect(menu.getByRole('link', { name: /^Wallet & account/ })).toBeVisible();
  await expect(menu.getByRole('link', { name: /^Support on X/ })).toBeVisible();
  await expect(menu.getByText('Loading menu', { exact: false })).toHaveCount(0);
  await menu.getByRole('button', { name: 'Close menu', exact: true }).click();
  await expect(amount).toHaveValue('12.34');
});
