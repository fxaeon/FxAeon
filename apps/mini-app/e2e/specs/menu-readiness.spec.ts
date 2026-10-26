import { expect, test } from '../fixtures/test';
import { reportPerformanceEvidence, type PerformanceSample } from '../performance-evidence';

test.use({ telegram: false, browserWallet: { initiallyConnected: false } });

test('first mobile menu opens without fetching another script and preserves the form', async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/earn');
  const amount = page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true });
  await expect(amount).toBeEnabled();
  await amount.fill('12.34');
  // A ready shell must already contain navigation. A cold menu must remain
  // usable even when the connection cannot deliver another JavaScript chunk.
  await page.route('**/_next/static/**/*.js', route => route.abort());
  // Measure in the browser from the click event through the next animation
  // frame after the complete menu is in layout. Playwright click and locator
  // transport time is outside these samples.
  await page.evaluate(() => {
    const samples: number[] = [];
    (window as typeof window & { __menuOpenSamples?: number[] }).__menuOpenSamples = samples;
    document.addEventListener('click', event => {
      if (!(event.target instanceof Element) || !event.target.closest('button[data-mobile-more][aria-label="Open menu"]')) return;
      const startedAt = performance.now();
      const observe = () => {
        const menu = document.getElementById('mobile-more-menu');
        if (!menu || !menu.querySelector('a') || menu.getClientRects().length === 0) {
          requestAnimationFrame(observe);
          return;
        }
        requestAnimationFrame(() => {
          if (menu.isConnected && menu.getClientRects().length > 0) samples.push(Math.round((performance.now() - startedAt) * 100) / 100);
        });
      };
      requestAnimationFrame(observe);
    }, true);
  });
  const openMenu = page.getByRole('button', { name: 'Open menu', exact: true });
  await openMenu.click();
  const menu = page.getByRole('dialog', { name: 'More menu', exact: true });
  await expect(menu.getByRole('link', { name: /^Wallet & account/ })).toBeVisible();
  await expect(menu.getByRole('link', { name: /^Support on X/ })).toBeVisible();
  await expect(menu.getByText('Loading menu', { exact: false })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __menuOpenSamples?: number[] }).__menuOpenSamples?.length ?? 0)).toBe(1);
  await menu.getByRole('button', { name: 'Close menu', exact: true }).click();
  await expect(amount).toHaveValue('12.34');

  for (let sample = 2; sample <= 5; sample += 1) {
    await openMenu.click();
    await expect(menu.getByRole('link', { name: /^Wallet & account/ })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __menuOpenSamples?: number[] }).__menuOpenSamples?.length ?? 0)).toBe(sample);
    await menu.getByRole('button', { name: 'Close menu', exact: true }).click();
  }
  await expect(amount).toHaveValue('12.34');
  const durations = await page.evaluate(() => (window as typeof window & { __menuOpenSamples?: number[] }).__menuOpenSamples ?? []);
  const samples: PerformanceSample[] = durations.map((durationMs, index) => ({
    stage: 'menu-open', source: 'browser-interaction', durationMs,
    detail: `${index === 0 ? 'Cold' : 'Repeat'} mobile menu click event to the next animation frame after menu links enter layout; static script requests blocked. Sample ${index + 1}/5.`,
  }));
  await reportPerformanceEvidence(browser, testInfo, samples);
});
