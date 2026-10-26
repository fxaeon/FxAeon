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
    expect(await sensitivity.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(160);
    await expect(sensitivity.getByRole('slider')).toHaveCount(0);
    if (width >= 1200) {
      const layout = await funding.evaluate((element) => {
        const next = element.nextElementSibling!.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return { adjacent: rect.right <= next.left, aligned: Math.abs(rect.top - next.top) < 1 };
      });
      expect(layout).toEqual({ adjacent: true, aligned: true });
    }
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
