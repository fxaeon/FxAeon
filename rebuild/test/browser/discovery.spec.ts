import { test, expect, fixture, snapshot } from './helpers';

test('built fixture announces simulation, has a labelled trade editor, and makes no wallet request on load', async ({ page, browser }, testInfo) => {
  await fixture(page);
  await expect(page.getByRole('heading', { name: 'Long Ethereum. Your terms.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Requested leverage' })).toHaveValue('3');
  await expect(page.getByText('$3,520.45', { exact: true })).toBeVisible();
  expect((await snapshot(page)).requests).toEqual([]);
  await testInfo.attach('actual-browser-version', { body: browser.version(), contentType: 'text/plain' });
  await testInfo.attach('initial-accessibility-tree', { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' });
  await page.screenshot({ path: 'docs/evidence/checkpoint-trade-dark-desktop.png', fullPage: true });
});
