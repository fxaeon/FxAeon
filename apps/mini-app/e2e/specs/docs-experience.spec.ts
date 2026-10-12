import { test, expect } from '../fixtures/test';

const legacyFragments = ['overview', 'getting-started', 'access', 'wallets', 'trade', 'positions', 'earn', 'borrow', 'move', 'fees', 'history', 'recovery', 'privacy', 'troubleshooting'];

test.describe('documentation experience', () => {
  test('keeps the privacy disclosure reachable through the rendered product guide', async ({ page }) => {
    await page.goto('/docs#privacy');
    const link = page.getByRole('link', { name: 'How FxAeon handles your data', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/privacy.html');
    await link.click();
    await expect(page).toHaveURL(/\/privacy\.html$/);
    await expect(page.locator('body')).toContainText('browser storage');
    await expect(page.locator('body')).toContainText('public blockchains are publicly visible');
  });

  test('keeps legacy guide fragments reachable below the compact mobile navigation', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 500 });
    for (const id of legacyFragments) {
      await page.goto(`/docs#${id}`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(`/docs/guide#${id}$`));
      const nav = page.getByRole('navigation', { name: 'Documentation sections' });
      await expect(nav).toHaveAttribute('aria-busy', 'false');
      await expect(nav.locator('details')).toHaveJSProperty('open', false);
      const heading = page.locator(id === 'recovery' ? '#history-heading' : `#${id}-heading`);
      await expect(heading).toBeInViewport();
      await expect.poll(async () => {
        const target = await heading.boundingBox();
        const rail = await nav.boundingBox();
        return target!.y >= rail!.y + rail!.height - 1;
      }).toBe(true);
    }
  });

  test('searches actual text across pages and preserves back navigation', async ({ page }) => {
    await page.goto('/docs/guide');
    const nav = page.getByRole('navigation', { name: 'Documentation sections' });
    const search = page.getByRole('searchbox', { name: 'Search docs' });
    await expect(search).toBeEnabled();
    await search.fill('repayments');
    await expect(nav.getByRole('link', { name: /^Overview/ })).toBeVisible();
    await search.fill('getFxSaveBalance');
    await nav.getByRole('link', { name: /^fxSAVE/ }).click();
    await expect(page).toHaveURL(/\/docs\/sdk\/?#sdk-earn$/);
    await expect(page.locator('#sdk-earn-heading')).toBeInViewport();
    await expect(page.locator('#sdk-earn-heading')).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(/\/docs\/guide\/?$/);
    await expect(page.getByRole('heading', { name: 'Product guide' })).toBeVisible();
  });

  test('has copyable examples and method anchors without requesting wallet access', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/docs/sdk#sdk-setup');
    await expect(page.getByRole('searchbox', { name: 'Search docs' })).toBeEnabled();
    const copy = page.getByRole('button', { name: 'Copy FxAeon app wrapper' });
    await copy.click();
    await expect(copy).toHaveText('Copied');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('getFxReadFacade()');
    expect(text).toContain('getFxSaveBalance({ userAddress })');
    await page.goto('/docs/sdk#getPositions');
    await expect(page.locator('#getPositions')).toBeInViewport();
    await expect(page.locator('#getPositions a')).toHaveAttribute('href', '#getPositions');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('keeps navigation, code and prose contained at every small viewport and large text', async ({ page }) => {
    const docsPage = page.locator('[class*="docsPage"]');
    for (const width of [320, 360, 390, 480, 768, 1280]) {
      await page.setViewportSize({ width, height: 750 });
      await page.goto('/docs/sdk#sdk-setup');
      await expect(docsPage).toBeVisible();
      expect(await docsPage.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 390, height: 750 });
    const before = await page.locator('article h1').evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    await page.locator('article').evaluate((article) => {
      // Enlarge computed text, including fixed-pixel type, rather than changing
      // the root font size while leaving the visible type unchanged.
      const elements = [...article.querySelectorAll<HTMLElement>('h1, h2, h3, p, li, dt, dd, code, figcaption')];
      const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
      elements.forEach((element, index) => { element.style.fontSize = `${sizes[index] * 2}px`; });
    });
    expect(await page.locator('article h1').evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(before * 2, 1);
    expect(await docsPage.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  });

  test('keyboard search can be cleared and navigation can be reopened repeatedly', async ({ page }) => {
    await page.goto('/docs/guide');
    const docsPage = page.locator('[class*="docsPage"]');
    const nav = page.getByRole('navigation', { name: 'Documentation sections' });
    const search = page.getByRole('searchbox', { name: 'Search docs' });
    await expect(search).toBeEnabled();
    await page.keyboard.press('Control+k');
    await expect(search).toBeFocused();
    await search.fill('nothing-matches-this');
    await expect(nav.getByText('No matches', { exact: true })).toBeVisible();
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(nav.locator('details')).toHaveJSProperty('open', false);
    const contentsSummary = nav.locator('summary');
    const themeToggle = page.getByRole('button', { name: /Switch to .* theme/ });
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await page.keyboard.press('Control+k');
      await page.keyboard.press('Tab');
      await expect(themeToggle).toBeFocused();
      await page.keyboard.press('Tab');
      for (const name of ['Start here', 'Products', 'Wallets', 'Help', 'SDK reference']) {
        await expect(page.getByRole('link', { name, exact: true })).toBeFocused();
        await page.keyboard.press('Tab');
      }
      await expect(contentsSummary).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(nav.getByRole('link', { name: 'Wallets & signing', exact: true })).toBeVisible();
      await nav.getByRole('link', { name: 'Wallets & signing', exact: true }).click();
      await expect(nav.locator('details')).toHaveJSProperty('open', false);
      await expect(page.locator('#wallets-heading')).toBeInViewport();
      if (attempt === 0) await docsPage.evaluate((element) => { element.scrollTop = 0; });
    }
  });

  test('copy failure is explained and a later attempt can recover', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/docs/sdk#sdk-setup');
    await expect(page.getByRole('searchbox', { name: 'Search docs' })).toBeEnabled();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => { throw new Error('Test clipboard refusal'); } },
      });
    });
    const copy = page.getByRole('button', { name: 'Copy FxAeon app wrapper' });
    await copy.click();
    await expect(copy).toHaveText('Try again');
    await expect(page.getByText('Copy was unavailable. Select and copy the example directly.')).toBeVisible();
    await page.evaluate(() => { Reflect.deleteProperty(navigator, 'clipboard'); });
    await copy.click();
    await expect(copy).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('getFxReadFacade()');
  });

  test('desktop docs keeps themes, search, copying and Back/Forward navigation usable', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/docs/guide');
    for (const theme of ['dark', 'light', 'official']) {
      await page.getByRole('button', { name: /Switch to .* theme/ }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    }
    const nav = page.getByRole('navigation', { name: 'Documentation sections' });
    await page.getByRole('searchbox', { name: 'Search docs' }).fill('getfxsavebalance');
    await nav.getByRole('link', { name: /^fxSAVE/ }).click();
    await expect(page.locator('#sdk-earn-heading')).toBeFocused();
    await nav.getByRole('link', { name: 'Read-only quickstart', exact: true }).click();
    await expect(page.locator('#sdk-setup-heading')).toBeFocused();
    const copy = page.getByRole('button', { name: 'Copy FxAeon app wrapper' });
    await copy.click();
    await expect(copy).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('getFxReadFacade()');
    await page.goBack();
    await expect(page).toHaveURL(/#sdk-earn$/);
    await expect(page.locator('#sdk-earn-heading')).toBeInViewport();
    await expect(page.locator('#sdk-earn-heading')).toBeFocused();
    await page.goForward();
    await expect(page).toHaveURL(/#sdk-setup$/);
    await expect(page.locator('#sdk-setup-heading')).toBeInViewport();
    await expect(page.locator('#sdk-setup-heading')).toBeFocused();
  });

});
