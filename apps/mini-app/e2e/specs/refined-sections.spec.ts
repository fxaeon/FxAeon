import { test, expect } from '../fixtures/test';

test.use({ telegram: false, marketPrices: true });

for (const width of [320, 390, 1280]) {
  test(`Borrow support sections stay readable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/borrow');
    const funding = page.getByRole('region', { name: 'ETH borrow funding history' });
    await expect(funding).toContainText('Funding & costs');
    const sensitivity = page.getByRole('region', { name: 'Collateral sensitivity' });
    await expect(sensitivity).toHaveCount(0);
    await funding.scrollIntoViewIfNeeded();
    if (width >= 1200) {
      const layout = await funding.evaluate((element) => {
        const workspace = element.parentElement!.parentElement!;
        const overview = workspace.querySelector('[aria-label="fxUSD borrowing overview"]')!.getBoundingClientRect();
        const action = workspace.querySelector('[data-testid="borrow-workspace-card"]')!.getBoundingClientRect();
        const terms = workspace.querySelector('[aria-label="Borrowing details"]')!.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return { belowOverview: rect.top >= overview.bottom - 1 && rect.top - overview.bottom <= 25,
          termsBelowBoth: terms.top >= Math.max(rect.bottom, action.bottom) - 1 };
      });
      expect(layout).toEqual({ belowOverview: true, termsBelowBoth: true });
    }
    await funding.screenshot({ path: info.outputPath('borrow-funding.png') });
    await page.getByText('Borrowing terms & risk', { exact: true }).click();
    await expect(page.getByRole('link', { name: 'Borrowing details', exact: true })).toBeVisible();
    expect(await funding.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
  test(`Earn performance follows its overview at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/earn');
    const performance = page.getByRole('region', { name: 'fxSAVE performance', exact: true });
    await expect(performance).toBeVisible();
    if (width >= 1200) {
      const layout = await performance.evaluate(element => {
        const workspace = element.parentElement!.parentElement!;
        const summary = workspace.querySelector('[aria-label="Your fxSAVE earnings"]')!.getBoundingClientRect();
        const action = workspace.querySelector('[class*="SavingsWorkspace_panel"]')!.getBoundingClientRect();
        const information = workspace.querySelector('[aria-label="fxSAVE details"]')!.getBoundingClientRect();
        const history = element.getBoundingClientRect();
        return { belowOverview: history.top >= summary.bottom - 1 && history.top - summary.bottom <= 25,
          besideInformation: history.right <= information.left,
          informationBelowAction: information.top >= action.bottom - 1 && information.top - action.bottom <= 25 };
      });
      expect(layout).toEqual({ belowOverview: true, besideInformation: true, informationBelowAction: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
  test(`Move route and delivery reflects the selected direction at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/move');
    const disclosure = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Route and delivery' }) });
    await disclosure.locator('summary').click();
    const summary = disclosure.locator('summary');
    expect(await summary.evaluate(element => element.matches(':focus-visible'))).toBe(false);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(summary).toBeFocused();
    const focus = await summary.evaluate(element => {
      const style = getComputedStyle(element);
      return { visible: element.matches(':focus-visible'),
        inset: Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth) };
    });
    expect(focus.visible).toBe(true);
    expect(focus.inset).toBeLessThanOrEqual(0);
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
