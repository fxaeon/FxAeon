import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.use({ telegram: false, marketPrices: true });

for (const width of [320, 390, 1280]) {
  test(`Trade sensitivity follows the ticket and fits ${width}px`, async ({ page, requests }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const scenario = page.getByRole('region', { name: 'What if ETH moves?' });
    await scenario.scrollIntoViewIfNeeded();
    await expect(scenario).toContainText('Long · 2× initial leverage');
    await expect(scenario).toContainText('−30%');
    const slider = scenario.getByRole('slider', { name: 'Market change' });
    await slider.focus();
    await slider.press('Home');
    await expect(slider).toHaveValue('-30');
    await expect(scenario).toContainText('-60.0%');
    await expect(scenario).toContainText('$1,680.00');
    await scenario.screenshot({ path: testInfo.outputPath('long-sensitivity.png') });
    const side = page.getByRole('radiogroup', { name: 'Position side' });
    const conditions = page.getByRole('region', { name: 'Protocol conditions' });
    await expect(conditions).toContainText('Gross funding charge');
    await expect(conditions.getByRole('status', { name: 'Long pool gross funding charge', exact: true })).toBeAttached();
    await side.getByRole('radio', { name: 'Short' }).click();
    await scenario.scrollIntoViewIfNeeded();
    await expect(scenario).toContainText('+60.0%');
    await expect(scenario).toContainText('Short · 2× initial leverage');
    await expect(scenario).toContainText('not projected PnL');
    await expect(conditions).toContainText('Gross funding charge');
    await expect(conditions.getByRole('status', { name: 'Short pool gross funding charge', exact: true })).toBeAttached();
    await expect(conditions.getByRole('status', { name: 'Long pool gross funding charge', exact: true })).toHaveCount(0);
    await scenario.screenshot({ path: testInfo.outputPath('short-sensitivity.png') });
    await expect(conditions).toContainText('fxUSD reference');
    await expect(conditions).toContainText('Pool capacity');
    await page.getByText('How protection works', { exact: true }).click();
    const docs = page.getByRole('link', { name: 'How rebalancing works', exact: true });
    await expect(docs).toHaveAttribute('href', '/docs/guide/trade');
    await expect(docs).toBeVisible();
    expect(await scenario.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    assertNoBackendRequests(requests);
  });
}
