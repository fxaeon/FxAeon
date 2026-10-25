import { test, expect } from '../fixtures/test';

test.use({ telegram: false, marketPrices: true });

for (const width of [320, 390, 1280]) {
  test(`Borrow support sections stay readable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/borrow');
    const funding = page.getByRole('region', { name: 'ETH borrow funding history' });
    await expect(funding).toContainText('Funding & costs');
    const sensitivity = page.getByRole('region', { name: 'Collateral sensitivity' });
    await sensitivity.scrollIntoViewIfNeeded();
    await expect(sensitivity).toContainText('Enter collateral and debt');
    await sensitivity.screenshot({ path: info.outputPath('borrow-sensitivity.png') });
    await page.getByText('Borrowing terms & risk', { exact: true }).click();
    await expect(page.getByRole('link', { name: 'Borrowing details', exact: true })).toBeVisible();
    expect(await sensitivity.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
  test(`Move route and delivery reflects the selected direction at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/move');
    const disclosure = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Route and delivery' }) });
    await disclosure.locator('summary').click();
    await expect(disclosure).toContainText('Ethereum');
    await expect(disclosure).toContainText('Base');
    await expect(disclosure.getByRole('link', { name: /LayerZero Scan/ })).toHaveAttribute('href', 'https://layerzeroscan.com/');
    await expect(disclosure).not.toContainText('After review');
    await expect(disclosure.getByRole('img', { name: 'Ethereum to Base via LayerZero' })).toBeVisible();
    await page.getByRole('button', { name: 'Reverse route to Ethereum', exact: true }).click();
    await expect(disclosure.getByRole('img', { name: 'Base to Ethereum via LayerZero' })).toBeVisible();
    await disclosure.screenshot({ path: info.outputPath('move-route.png') });
    expect(await disclosure.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
