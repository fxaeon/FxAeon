import { expect, test, type Page } from '@playwright/test';
import { openHarness, metric } from '../harness/action-review-measurement-support';

test.setTimeout(90_000);

async function mount(page: Page, deferredQuote = false) {
  await page.goto('about:blank');
  await openHarness(page, { initialPreviewMode: deferredQuote ? 'deferred' : 'auto' });
}
const review = (page: Page) => page.getByRole('button', { name: 'Review position', exact: true }).click();
const editor = (page: Page) => page.getByText(/^Editor terms v/);
const surface = (page: Page) => page.locator('[data-review-viewport]');

test('execution keeps phone focus and its Back stop until the result can close', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mount(page);
  await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
  await review(page);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Transaction progress', exact: true })).toContainText('Confirm in wallet');
  await expect(surface(page).locator('[data-review-actions]')).toHaveCount(0);
  expect(await metric(page, 'send')).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.locator('[data-mobile-review-sheet]');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close transaction review', exact: true })).toBeDisabled();
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  const stop = await page.evaluate(() => window.history.state?.__fxaeonOverlayId);
  expect(stop).toBeDefined();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.evaluate(() => window.history.back());
    await expect.poll(() => page.evaluate(() => window.history.state?.__fxaeonOverlayId)).toBe(stop);
    await expect(dialog).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __actionReviewHarness: { walletResolvers: Array<() => void> } }).__actionReviewHarness.walletResolvers.shift()?.();
  });
  const close = page.getByRole('button', { name: 'Close transaction review', exact: true });
  await expect(close).toBeEnabled();
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('quote and gas checks finish before the first review frame', async ({ page }) => {
  await mount(page, true);
  await page.getByRole('button', { name: 'Gas estimate loading', exact: true }).click();
  await review(page);
  await expect.poll(() => metric(page, 'prepare')).toBe(1);
  await expect(editor(page)).toBeVisible();
  await expect(surface(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Resolve oldest preview', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __actionReviewHarness: { gasPreflightCount?: number } }).__actionReviewHarness.gasPreflightCount)).toBe(1);
  await expect(editor(page)).toBeVisible();
  await expect(surface(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Gas estimate current', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('[data-review-fact="Gas fee"]')).toContainText('ETH');
});

test('a failed fee preflight leaves the error at input and permits a fresh attempt', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => { (globalThis as typeof globalThis & { __actionReviewHarness: { failNextGasPreflight?: boolean } }).__actionReviewHarness.failNextGasPreflight = true; });
  await review(page);
  await expect(page.getByText('Network fee check failed. Try again.', { exact: true })).toBeVisible();
  await expect(editor(page)).toBeVisible();
  await expect(surface(page)).toHaveCount(0);
  await review(page);
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  expect(await metric(page, 'prepare')).toBe(2);
});

test('changed form intent discards a delayed quote before it can open review', async ({ page }) => {
  await mount(page, true);
  await review(page);
  await expect.poll(() => metric(page, 'prepare')).toBe(1);
  await page.getByRole('button', { name: 'Change terms', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review updated quote', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Resolve oldest preview', exact: true }).click();
  await expect(editor(page)).toHaveText('Editor terms v2');
  await expect(surface(page)).toHaveCount(0);
  expect(await metric(page, 'send')).toBe(0);
});

for (const change of ['Switch account', 'Start on Base', 'Toggle embedded wallet mode']) {
  test(`${change} cancels pending fee readiness and rejects its late result`, async ({ page }) => {
    await mount(page);
    await page.getByRole('button', { name: 'Gas estimate loading', exact: true }).click();
    await review(page);
    await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __actionReviewHarness: { gasPreflightCount?: number } }).__actionReviewHarness.gasPreflightCount)).toBe(1);
    await page.getByRole('button', { name: change, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Review updated quote', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Gas estimate current', exact: true }).click();
    await expect(surface(page)).toHaveCount(0);
    await expect(editor(page)).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
  });
}
