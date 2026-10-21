import { test, expect, assertNoBackendRequests } from '../fixtures/test';

const legacyFragments = ['overview', 'getting-started', 'access', 'wallets', 'trade', 'positions', 'earn', 'borrow', 'move', 'fees', 'history', 'recovery', 'privacy', 'troubleshooting'];

test.describe('documentation provider lifecycle', () => {
  test.use({ telegram: false, browserWallet: { initiallyConnected: true } });
  test('defers wallet work on a docs entry and preserves the session after visiting the app', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const walletReads = () => page.evaluate(() => {
      const wallet = (window as unknown as { __wallet: { requests: { method: string }[] } }).__wallet;
      return wallet.requests.filter(request => request.method === 'eth_accounts').length;
    });
    await page.goto('/docs');
    await expect(page.getByRole('searchbox', { name: 'Search docs' })).toBeEnabled();
    expect(await walletReads()).toBe(0);
    await page.getByRole('link', { name: 'Open app', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible();
    const initialReads = await walletReads();
    expect(initialReads).toBeGreaterThan(0);
    await page.locator('.app-topbar').getByRole('link', { name: 'More', exact: true }).click();
    await page.getByRole('link', { name: /FxAeon docs/ }).click();
    await expect(page.getByRole('searchbox', { name: 'Search docs' })).toBeEnabled();
    await page.getByRole('link', { name: 'Open app', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible();
    expect(await walletReads()).toBe(initialReads);
  });
});

async function openDocsSearch(page: import('@playwright/test').Page) {
  const toggle = page.getByRole('button', { name: 'Search documentation', exact: true });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  const search = page.getByRole('searchbox', { name: 'Search docs' });
  await expect(search).toBeVisible();
  return search;
}

test.describe('documentation experience', () => {
  test('home skip link stays on the documentation home and focuses the reader', async ({ page }) => {
    await page.goto('/docs');
    const skip = page.getByRole('link', { name: 'Skip to main content', exact: true });
    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/docs\/?#main-content$/);
    await expect(page.locator('#main-content')).toBeFocused();
    await expect(page.getByRole('heading', { name: 'FxAeon Documentation', exact: true })).toBeVisible();
  });

  test('mobile search contains focus and Escape closes it from any control', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 740 });
    await page.goto('/docs');
    const toggle = page.getByRole('button', { name: 'Search documentation', exact: true });
    const main = page.locator('#main-content');
    for (const target of ['clear', 'result'] as const) {
      const search = await openDocsSearch(page);
      await search.fill('getFxSaveBalance');
      await expect(main).toHaveAttribute('inert', '');
      const results = page.locator('#docs-contents a');
      await expect(results.first()).toBeVisible();
      await results.last().focus();
      await page.keyboard.press('Tab');
      await expect(page.locator('button[aria-controls="docs-contents"]')).toBeFocused();
      if (target === 'clear') await page.getByRole('button', { name: 'Clear', exact: true }).focus();
      else await results.first().focus();
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(search).toBeHidden();
      await expect(main).not.toHaveAttribute('inert', '');
      await expect(page.getByRole('navigation', { name: 'Pages', exact: true })).toBeHidden();
      await expect(page.locator('[class*="docsPage"]')).toHaveCSS('overflow-y', 'auto');
    }
  });

  test('SDK topic headings, outlines, and copy controls remain usable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/docs/sdk/earn');
    await expect(page.getByRole('heading', { level: 1, name: 'fxSAVE methods', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'getFxSaveBalance', exact: true })).toBeVisible();
    const outline = page.getByRole('navigation', { name: 'On this page', exact: true });
    await outline.getByRole('link', { name: 'withdrawFxSave', exact: true }).click();
    await expect(page.locator('#withdrawFxSave')).toBeInViewport();
    await expect(page.locator('#withdrawFxSave')).toBeFocused();
    await page.goto('/docs/sdk/setup');
    // A deterministic clipboard verifies the exact source copied without an OS prompt.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (value: string) => { (window as unknown as { __copiedCode: string }).__copiedCode = value; },
      } });
    });
    const copy = page.getByRole('button', { name: 'Copy FxAeon app wrapper', exact: true });
    await copy.click();
    await expect(copy).toContainText('Copied');
    const code = await page.locator('pre[aria-label="FxAeon app wrapper"]').textContent();
    expect(await page.evaluate(() => (window as unknown as { __copiedCode: string }).__copiedCode)).toBe(code);
  });

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
      await expect(page).toHaveURL(new RegExp(`/docs/guide/${id === 'recovery' ? 'history' : id}#docs-page-heading$`));
      await expect(page.getByRole('button', { name: 'Open documentation menu', exact: true })).toHaveAttribute('aria-expanded', 'false');
      const heading = page.locator('#docs-page-heading');
      await expect(heading).toBeInViewport();
      await expect.poll(async () => {
        const target = await heading.boundingBox();
        const chrome = await page.locator('[class*="docsChrome"]').boundingBox();
        return target!.y >= chrome!.y + chrome!.height - 1;
      }).toBe(true);
    }
  });

  test('old nested and method bookmarks reach their exact current topic', async ({ page }) => {
    for (const [old, current, heading] of [
      ['/docs#start-wallet', '/docs/guide/getting-started#start-wallet', 'start-wallet'],
      ['/docs/guide#trade-rebalancing', '/docs/guide/trade#trade-rebalancing', 'trade-rebalancing'],
      ['/docs/guide#help-delivery', '/docs/guide/troubleshooting#help-delivery', 'help-delivery'],
      ['/docs/sdk#depositFxSave', '/docs/sdk/earn#depositFxSave', 'depositFxSave'],
    ]) {
      await page.goto(old);
      await expect(page).toHaveURL(new RegExp(current.replaceAll('/', '\\/') + '$'));
      await expect(page.locator(`#${heading}`)).toBeInViewport();
      await expect(page.locator(`#${heading}`)).toBeFocused();
    }
  });

  test('searches actual text across pages and preserves back navigation', async ({ page }) => {
    await page.goto('/docs/guide');
    const nav = page.getByRole('navigation', { name: 'Pages' });
    const search = await openDocsSearch(page);
    await expect(search).toBeEnabled();
    await search.fill('manage debt');
    await expect(nav.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
    await expect(nav.getByRole('link', { name: /^Overview/ })).toBeVisible();
    await search.fill('getFxSaveBalance');
    await expect(nav.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
    await nav.getByRole('link', { name: /^getFxSaveBalance/ }).click();
    await expect(page).toHaveURL(/\/docs\/sdk\/earn\/?#getFxSaveBalance$/);
    await expect(page.locator('#getFxSaveBalance')).toBeInViewport();
    await expect(page.locator('#getFxSaveBalance')).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(/\/docs\/guide\/?$/);
    await expect(page.getByRole('heading', { name: 'Product guide' })).toBeVisible();
  });

  test('has readable examples and method anchors without requesting wallet access', async ({ page }) => {
    await page.goto('/docs/sdk#sdk-setup');
    await expect(await openDocsSearch(page)).toBeEnabled();
    const example = page.locator('pre[aria-label="FxAeon app wrapper"]');
    await expect(example).toContainText('getFxReadFacade()');
    await expect(example).toContainText('getFxSaveBalance({ userAddress })');
    await page.goto('/docs/sdk#getPositions');
    await expect(page.locator('#getPositions')).toBeInViewport();
    await expect(page.locator('#getPositions a')).toHaveAttribute('href', '#getPositions');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('product articles support outline navigation, pagination, and mobile width', async ({ page, requests }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
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

    await expect(options.getByRole('button', { name: /Switch to .* theme/ })).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await searchToggle.click();
    await expect(searchToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(options).toHaveCount(0);
    const search = page.getByRole('searchbox', { name: 'Search docs' });
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    await search.fill('Borrow fxUSD');
    const pages = page.getByRole('navigation', { name: 'Pages', exact: true });
    await expect(pages.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
    const result = pages.getByRole('link', { name: /^Borrow fxUSD/ });
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
    const nav = page.getByRole('navigation', { name: 'Pages' });
    const search = page.getByRole('searchbox', { name: 'Search docs' });
    const searchToggle = page.getByRole('button', { name: 'Search documentation', exact: true });
    const optionsToggle = page.getByRole('button', { name: 'More documentation options', exact: true });
    const contentsToggle = page.locator('button[aria-controls="docs-contents"]');
    const navElement = page.locator('nav[aria-label="Pages"]');
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
      await page.keyboard.press('Shift+Tab');
      await expect(searchToggle).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByRole('link', { name: 'FxAeon docs home', exact: true })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(contentsToggle).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(contentsToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(nav).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'FxAeon docs home', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(searchToggle).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(optionsToggle).toBeFocused();
      await page.keyboard.press('Tab');
      for (const name of ['FxAeon Documentation', 'Supported networks', 'Your first transaction', 'Telegram & browser']) {
        await expect(nav.getByRole('link', { name, exact: true })).toBeFocused();
        await page.keyboard.press('Tab');
      }
      await expect(nav.getByRole('link', { name: 'Wallets & signing', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/docs\/guide\/wallets\/?$/);
      await expect(navElement.locator('details')).toHaveJSProperty('open', false);
      await expect(page.locator('#docs-page-heading')).toBeInViewport();
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
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await expect(page.locator('#docs-search')).toBeEnabled();
    await searchToggle.click();
    const search = page.getByRole('searchbox', { name: 'Search docs' });
    await expect(search).toBeFocused();
    await search.fill('getFxSaveBalance');
    await expect(nav.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    await nav.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(nav.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
    await expect(page.locator('#docs-contents a[href="/docs/sdk/earn#getFxSaveBalance"]')).toBeVisible();
    expect(requests).toBe(2);
  });

  test('desktop docs keeps search and Back/Forward navigation usable in dark appearance', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/docs/guide');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: /Switch to .* theme/ })).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await page.getByRole('searchbox', { name: 'Search docs' }).fill('getfxsavebalance');
    await expect(nav.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
    await nav.getByRole('link', { name: /^getFxSaveBalance/ }).click();
    await expect(page.locator('#getFxSaveBalance')).toBeFocused();
    await page.getByRole('navigation', { name: 'Pages', exact: true }).getByRole('link', { name: 'Read-only quickstart', exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/sdk\/setup\/?$/);
    await expect(page.getByRole('heading', { name: 'Read-only quickstart', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/docs\/sdk\/earn\/?#getFxSaveBalance$/);
    await expect(page.locator('#getFxSaveBalance')).toBeInViewport();
    await expect(page.locator('#getFxSaveBalance')).toBeFocused();
    await page.goForward();
    await expect(page).toHaveURL(/\/docs\/sdk\/setup\/?$/);
    await expect(page.getByRole('heading', { name: 'Read-only quickstart', exact: true })).toBeInViewport();
  });

});
