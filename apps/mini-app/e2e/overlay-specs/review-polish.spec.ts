import { expect, test } from '@playwright/test';
import { openHarness, metric } from '../harness/action-review-measurement-support';

for (const width of [320, 390, 1280]) test(`quiet review keeps approval, details and accessible title at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  await openHarness(page, { presentationMode: true });
  await page.evaluate(() => {
    const h = (globalThis as any).__actionReviewHarness;
    h.approvalRequired = true;
    h.rerender();
  });
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  const review = page.locator('[data-review-viewport]');
  await expect(review).toBeVisible();
  await expect(page.getByRole('list', { name: /Transaction sequence|Wallet request sequence/ })).toHaveCount(0);
  const cta = review.locator('[data-review-actions] button');
  await expect(cta).toHaveText('Approve fxUSD');
  await expect(cta).toBeEnabled();
  await expect(cta).toBeInViewport({ ratio: 1 });
  const title = width <= 600 ? page.locator('[data-mobile-review-sheet] > header h2') : review.locator('[data-review-focus]');
  await expect(title).not.toHaveText('');
  await expect(title).toBeVisible();
  expect(await title.evaluate(el => { const box=el.getBoundingClientRect(); return box.width > 1 && box.height > 1; })).toBe(true);
  await expect(page.getByRole('heading', { name: 'Add to ETH Long', exact: true })).toHaveCount(1);
  if (width <= 600) await expect(page.getByRole('dialog')).toHaveAccessibleName(await title.textContent() ?? '');
  await page.screenshot({ path: info.outputPath('review.png'), animations: 'disabled' });
  await review.locator('details[aria-label="Advanced transaction details"] > summary').click();
  const details=review.locator('details[aria-label="Advanced transaction details"]');
  await expect(details.getByRole('region', { name: 'Route and limits' })).toBeVisible();
  await expect(details.getByRole('region', { name: 'Prepared transactions' })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Copy full approval spender', exact: true })).toBeVisible();
  const copyTarget = await details.getByRole('button', { name: 'Copy full approval spender', exact: true }).boundingBox();
  expect(copyTarget!.width).toBeGreaterThanOrEqual(44);
  expect(copyTarget!.height).toBeGreaterThanOrEqual(44);
  await details.getByRole('button', { name: 'View full approval spender', exact: true }).click();
  const dialog=page.getByRole('dialog', { name: 'Full approval spender', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveValue('0x0000000000000000000000000000000000000000');
  await page.keyboard.press('Escape');
  await expect(review).toBeVisible();
  await expect(cta).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: info.outputPath('details.png'), animations: 'disabled' });
  expect(await metric(page, 'send')).toBe(0);
});

for (const width of [320, 390, 768, 1280]) test(`context help is keyboard/touch accessible without a new history stop at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  await openHarness(page, { presentationMode: true });
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  const review = page.locator('[data-review-viewport]');
  const beforeHistory = await page.evaluate(() => history.length);
  await review.locator('details[aria-label="Advanced transaction details"] > summary').click();
  const help = review.getByRole('button', { name: 'About Execution price', exact: true });
  await help.focus();
  await page.keyboard.press('Enter');
  const panel = page.locator('[data-info-help-panel]');
  await expect(panel).toHaveCount(1);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAccessibleName('Execution price');
  expect(await page.evaluate(() => history.length)).toBe(beforeHistory);
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(help).toBeFocused();
  await expect(review).toBeVisible();
  await help.click();
  // At wider widths the non-modal description can legitimately cover the
  // following row. Move keyboard focus to that row rather than force-clicking
  // through the visible panel; focus-out must dismiss the previous help.
  const priceImpactHelp = review.getByRole('button', { name: 'About Price impact', exact: true });
  await priceImpactHelp.focus();
  await expect(panel).toHaveCount(0);
  await priceImpactHelp.press('Enter');
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveAccessibleName('Price impact');
  const advancedSummary = review.locator('details[aria-label="Advanced transaction details"] > summary');
  await advancedSummary.focus();
  await expect(panel).toHaveCount(0);
  await expect(review.locator('details[aria-label="Advanced transaction details"]')).toHaveAttribute('open');
  expect(await page.evaluate(() => history.length)).toBe(beforeHistory);
  // Help should reflow at enlarged text, not reduce the font to fit.
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  await help.click();
  await expect(panel).toBeVisible();
  expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('help-200-percent.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  expect(await metric(page, 'send')).toBe(0);
});
