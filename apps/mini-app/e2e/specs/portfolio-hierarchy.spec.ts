import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.describe('Portfolio mobile hierarchy', () => {
  test.use({ telegram: false, browserWallet: { initiallyConnected: true } });

  test('keeps network filters within Assets and uses the page scroller', async ({ page, requests }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
      const positions = page.getByRole('region', { name: 'Positions', exact: true });
      const disclosure = positions.locator('details');
      await expect(disclosure.locator('summary')).toBeVisible();
      await expect(disclosure).not.toHaveAttribute('open');
      const assets = page.getByRole('region', { name: 'Assets', exact: true });
      const filters = page.getByRole('group', { name: 'Portfolio network', exact: true });
      await expect(assets).toBeVisible();
      await expect(filters).toBeVisible();
      expect(await filters.evaluate((element) => element.closest('section[aria-labelledby="portfolio-assets-heading"]') !== null)).toBe(true);
      await filters.getByRole('button', { name: 'Base', exact: true }).click();
      await expect(filters.getByRole('button', { name: 'Base', exact: true })).toHaveAttribute('aria-pressed', 'true');
      const overflow = await assets.evaluate((element) => getComputedStyle(element).overflowY);
      expect(overflow).not.toMatch(/auto|scroll/);
      await expect(page.locator('section[aria-labelledby="portfolio-actions-title"] a')).toHaveCount(4);
    }
    assertNoBackendRequests(requests);
  });
});


test.describe('Disconnected Portfolio entry', () => {
  test.use({ telegram: false, browserWallet: false });

  test('keeps one wallet connection entry in the header and leaves the hero for the product', async ({ page, requests }, testInfo) => {
    for (const viewport of [{ width: 320, height: 568 }, { width: 412, height: 818 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Leverage, savings, and credit.', exact: true })).toBeVisible();
      await expect(page.getByText('Leverage, savings, and credit. On f(x) Protocol.', { exact: true })).toHaveCount(0);
      const connect = page.getByRole('button', { name: 'Connect wallet', exact: true });
      await expect(connect).toHaveCount(1);
      await expect(page.locator('.app-topbar').getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
      await expect(page.locator('#overview').getByRole('button', { name: /Connect wallet|Choose wallet/ })).toHaveCount(0);
      await testInfo.attach(`portfolio-one-entry-${viewport.width}`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
      await connect.click();
      await expect(page.getByRole('dialog', { name: 'Connect your wallet' })).toBeVisible();
      await page.getByRole('button', { name: 'Close wallet selection' }).click();
      await expect(connect).toBeFocused();
      await expect(page).toHaveURL(/\/portfolio\/?$/);
    }
    assertNoBackendRequests(requests);
  });
});
