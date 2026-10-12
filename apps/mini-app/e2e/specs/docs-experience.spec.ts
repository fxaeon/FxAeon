import { test, expect, assertNoBackendRequests } from '../fixtures/test';

const legacyFragments = ['overview', 'getting-started', 'access', 'wallets', 'trade', 'positions', 'earn', 'borrow', 'move', 'fees', 'history', 'recovery', 'privacy', 'troubleshooting'];

async function openDocsSearch(page: import('@playwright/test').Page) {
  const toggle = page.getByRole('button', { name: 'Search documentation', exact: true });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  const search = page.getByRole('searchbox', { name: 'Search docs' });
  await expect(search).toBeVisible();
  return search;
}

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
      await expect(page.getByRole('button', { name: 'Open documentation menu', exact: true })).toHaveAttribute('aria-expanded', 'false');
      const heading = page.locator(id === 'recovery' ? '#history-heading' : `#${id}-heading`);
      await expect(heading).toBeInViewport();
      await expect.poll(async () => {
        const target = await heading.boundingBox();
        const chrome = await page.locator('[class*="docsChrome"]').boundingBox();
        return target!.y >= chrome!.y + chrome!.height - 1;
      }).toBe(true);
    }
  });

  test('searches actual text across pages and preserves back navigation', async ({ page }) => {
    await page.goto('/docs/guide');
    const nav = page.getByRole('navigation', { name: 'Documentation sections' });
    const search = await openDocsSearch(page);
    await expect(search).toBeEnabled();
    await search.fill('repayments');
    await expect(nav.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
    await expect(nav.getByRole('link', { name: /^Overview/ })).toBeVisible();
    await search.fill('getFxSaveBalance');
    await expect(nav.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
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
    await expect(await openDocsSearch(page)).toBeEnabled();
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

  test('product articles support outline navigation, copying, pagination, and mobile width', async ({ page, context, requests }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/docs/guide/getting-started');
    await expect(page).toHaveURL(/\/docs\/guide\/getting-started\/?$/);
    await expect(page.getByRole('heading', { name: 'Your first transaction', exact: true })).toBeVisible();

    const pages = page.getByRole('navigation', { name: 'Pages', exact: true });
    await expect(pages.getByRole('link', { name: 'Your first transaction', exact: true })).toHaveAttribute('aria-current', 'location');
    const outline = page.getByRole('navigation', { name: 'On this page', exact: true });
    const openHeading = page.locator('#start-open');
    await expect(outline.getByRole('link', { name: 'Open FxAeon', exact: true })).toHaveAttribute('href', '#start-open');
    await outline.getByRole('link', { name: 'Open FxAeon', exact: true }).click();
    await expect(page).toHaveURL(/#start-open$/);
    await expect(openHeading).toBeInViewport();

    const copy = page.getByRole('button', { name: 'Copy page', exact: true });
    await copy.click();
    await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('Your first transaction');
    expect(clipboard).toContain('Open FxAeon');

    const pagination = page.getByRole('navigation', { name: 'Pagination', exact: true });
    const next = pagination.getByRole('link', { name: /Telegram & browser/ });
    await expect(next).toHaveAttribute('href', '/docs/guide/access');

    await page.setViewportSize({ width: 320, height: 700 });
    await expect(page.locator('[class*="docsPage"]')).toBeVisible();
    expect(await page.locator('[class*="docsPage"]').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    assertNoBackendRequests(requests);
  });

  test('mobile product articles expose usable search, contents, and documentation options', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/docs/guide/getting-started');

    const searchToggle = page.getByRole('button', { name: 'Search documentation', exact: true });
    const optionsToggle = page.getByRole('button', { name: 'More documentation options', exact: true });
    const contentsToggle = page.getByRole('button', { name: 'Open documentation menu', exact: true });
    for (const control of [searchToggle, optionsToggle, contentsToggle]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    await optionsToggle.click();
    await expect(optionsToggle).toHaveAttribute('aria-expanded', 'true');
    const options = page.getByRole('navigation', { name: 'Documentation options', exact: true });
    await expect(options).toBeVisible();
    await expect(options.getByRole('link', { name: 'Open app', exact: true })).toHaveAttribute('href', '/');
    await expect(options.getByRole('link', { name: /^Website/ })).toHaveAttribute('href', 'https://fxaeon.xyz/');
    await expect(options.getByRole('link', { name: /^Support/ })).toHaveAttribute('href', 'https://x.com/FxAeonxyz');

    const themeToggle = options.getByRole('button', { name: /Switch to .* theme/ });
    const beforeTheme = await page.locator('html').getAttribute('data-theme');
    await themeToggle.click();
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).not.toBe(beforeTheme);
    await expect(themeToggle).toBeVisible();

    await searchToggle.click();
    await expect(searchToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(options).toHaveCount(0);
    const search = page.getByRole('searchbox', { name: 'Search docs' });
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    await search.fill('Borrow fxUSD');
    const pages = page.getByRole('navigation', { name: 'Pages', exact: true });
    await expect(pages.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
    const result = pages.getByRole('link', { name: /Borrow fxUSD/ });
    await expect(result).toBeVisible();
    await result.click();
    await expect(page).toHaveURL(/\/docs\/guide\/borrow\/?$/);

    const pageContents = page.getByRole('navigation', { name: 'Pages', exact: true });
    const menuToggle = page.locator('button[aria-controls="docs-contents"]');
    await menuToggle.click();
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(pageContents).toBeVisible();
    await expect(pageContents.getByRole('link', { name: 'Trade & leverage', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open documentation menu', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(pageContents).toBeHidden();
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
    const nav = page.getByRole('navigation', { name: 'Documentation sections' });
    const search = page.getByRole('searchbox', { name: 'Search docs' });
    const searchToggle = page.getByRole('button', { name: 'Search documentation', exact: true });
    const optionsToggle = page.getByRole('button', { name: 'More documentation options', exact: true });
    const contentsToggle = page.locator('button[aria-controls="docs-contents"]');
    await expect(page.locator('#docs-search')).toBeEnabled();
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.keyboard.press('Control+k');
      await expect(search).toBeFocused();
      await search.fill('nothing-matches-this');
      await expect(nav.locator('p[role="status"]')).toHaveText('0 documentation results found');
      await expect(nav.getByText(/Nothing found for .*nothing-matches-this/)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#docs-search')).toHaveValue('');
      await expect(searchToggle).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(optionsToggle).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(contentsToggle).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(contentsToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(nav).toBeVisible();
      await page.keyboard.press('Tab');
      for (const name of ['Overview', 'Getting started', 'Browser & Telegram']) {
        await expect(nav.getByRole('link', { name, exact: true })).toBeFocused();
        await page.keyboard.press('Tab');
      }
      await expect(nav.getByRole('link', { name: 'Wallets & signing', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#wallets$/);
      await expect(nav.locator('details')).toHaveJSProperty('open', false);
      await expect(page.locator('#wallets-heading')).toBeInViewport();
    }
  });

  test('search recovers when the static index request fails once', async ({ page }) => {
    let requests = 0;
    await page.route('**/docs/search-index.json', async (route) => {
      requests += 1;
      if (requests === 1) await route.abort();
      else await route.continue();
    });
    await page.goto('/docs/guide');
    const searchToggle = page.getByRole('button', { name: 'Search documentation', exact: true });
    const nav = page.getByRole('navigation', { name: 'Documentation sections' });
    await expect(page.locator('#docs-search')).toBeEnabled();
    await searchToggle.click();
    const search = page.getByRole('searchbox', { name: 'Search docs' });
    await expect(search).toBeFocused();
    await search.fill('getFxSaveBalance');
    await expect(nav.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    await nav.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(nav.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
    await expect(page.locator('#docs-contents a[href="/docs/sdk#sdk-earn"]')).toBeVisible();
    expect(requests).toBe(2);
  });

  test('copy failure is explained and a later attempt can recover', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/docs/sdk#sdk-setup');
    await expect(await openDocsSearch(page)).toBeEnabled();
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
    await expect(nav.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
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
