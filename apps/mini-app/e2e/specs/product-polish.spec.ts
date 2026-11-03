import { test, expect } from '../fixtures/test';
import { installRefinementGalleryFixtures } from '../fixtures/refinement-gallery';

// Built routes, inert fixture wallet and reads. No review, signing or submission.
test.use({ telegram: false, browserWallet: { initiallyConnected: true }, marketPrices: true });
for (const width of [390, 1440]) {
  test(`product routes retain usable controls and layout at ${width}px`, async ({ page }, info) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await installRefinementGalleryFixtures(page);
    for (const route of ['/earn', '/borrow', '/more', '/trade', '/move', '/portfolio', '/settings']) {
      await page.goto(route);
      await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const main = page.locator('main.app-content-tabs:visible');
      await expect(main).toBeVisible();
      const geometry = await main.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, page: document.documentElement.scrollWidth, viewport: innerWidth }));
      expect(geometry.scroll, `${route} content overflows`).toBeLessThanOrEqual(geometry.width + 1);
      expect(geometry.page, `${route} page overflows`).toBeLessThanOrEqual(geometry.viewport + 1);
      if (['/earn', '/borrow', '/trade', '/move'].includes(route)) {
        const field = main.locator('[data-amount-field]').first();
        await expect(field).toBeVisible();
        const input = field.locator('input').first();
        const box = await input.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        const picker = field.locator('button[aria-haspopup="dialog"]').first();
        if (await picker.count()) {
          const colors = await picker.evaluate(element => ({ button: getComputedStyle(element).backgroundColor, surface: getComputedStyle(element.closest('.amount-control')!).backgroundColor }));
          if (route === '/earn' || route === '/borrow' || route === '/move') expect(colors.button, `${route} asset selector remains visible`).not.toBe(colors.surface);
          const target = await picker.boundingBox();
          expect(target!.height).toBeGreaterThanOrEqual(44);
        }
      } else if (route === '/more') {
        await expect(page.locator('[data-utility-directory]:visible')).toBeVisible();
      }
      await page.screenshot({ path: info.outputPath(`${route.slice(1)}-${width}.png`), fullPage: true, animations: 'disabled' });
      // The app scrolls inside main; fullPage alone only captures the viewport.
      // Keep separate actual viewport frames rather than fabricating a tall page.
      const remaining = await main.evaluate(element => element.scrollHeight - element.clientHeight);
      if (remaining > 24) {
        await main.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await page.screenshot({ path: info.outputPath(`${route.slice(1)}-details-${width}.png`), animations: 'disabled' });
        await main.evaluate(element => { element.scrollTop = 0; });
      }
      if (route === '/earn') {
        await page.getByRole('radio', { name: 'Withdraw', exact: true }).click();
        await expect(page.getByRole('radio', { name: 'Withdraw', exact: true })).toBeChecked();
        await page.screenshot({ path: info.outputPath(`earn-withdraw-${width}.png`), fullPage: true, animations: 'disabled' });
      }
      if (route === '/trade') {
        await page.getByRole('radio', { name: /Short/ }).click();
        await expect(page.getByRole('radio', { name: /Short/ })).toBeChecked();
        await page.getByRole('button', { name: 'Open wallet profile', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Close wallet profile', exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath(`wallet-${width}.png`), animations: 'disabled' });
        await page.getByRole('button', { name: 'Close wallet profile', exact: true }).click();
      }
    }
  });
}
