import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.describe('cohesive responsive design', () => {
  test.use({ telegram: false });

  test('Appearance theme choices persist and all route surfaces inherit the selected palette', async ({ page, requests }) => {
    test.setTimeout(120_000);
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    for (const theme of ['official', 'dark', 'light'] as const) {
      const choices = page.getByRole('radiogroup', { name: 'Appearance theme' });
      const choice = choices.getByRole('radio', { name: new RegExp(`^${theme}$`, 'i') });
      await expect(choice).toBeEnabled();
      await choice.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const route of ['/trade', '/positions', '/portfolio', '/earn', '/borrow', '/move', '/history', '/settings', '/qr', '/docs']) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('main:visible')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect.poll(async () => page.locator('main:visible').evaluate((main) => {
          const root = getComputedStyle(document.documentElement);
          return [main, ...main.querySelectorAll('.ui-card, .amount-control, .market-chart-panel')].flatMap((element) => {
            const style = getComputedStyle(element);
            return ['--mint', '--text', '--bg'].filter((token) => style.getPropertyValue(token).trim() !== root.getPropertyValue(token).trim());
          });
        }), { message: `${route} must not replace the selected theme with a private palette` }).toEqual([]);
      }
      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    }
    assertNoBackendRequests(requests);
  });

  test('desktop Trade composes a chart beside the ticket, mobile keeps the chart optional', async ({ page, requests }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const chart = page.locator('.market-chart-panel');
    const ticket = page.locator('.trade-ticket');
    const positionSide = page.getByRole('radiogroup', { name: 'Position side' });
    await expect(chart).toBeVisible();
    await expect(ticket).toBeVisible();
    await expect(positionSide).toBeVisible();
    await expect(chart.getByText('f(x) market · Ethereum', { exact: true })).toHaveCount(0);
    await expect(chart.getByText('CoinGecko history · display only', { exact: true })).toHaveCount(0);
    await expect(chart.getByRole('link', { name: 'CoinGecko', exact: true })).toHaveCount(0);
    const chartBox = await chart.boundingBox();
    const ticketBox = await ticket.boundingBox();
    const positionSideBox = await positionSide.boundingBox();
    expect(chartBox).not.toBeNull();
    expect(ticketBox).not.toBeNull();
    expect(positionSideBox).not.toBeNull();
    expect(chartBox!.x + chartBox!.width).toBeLessThan(ticketBox!.x);
    expect(Math.abs(chartBox!.y - positionSideBox!.y)).toBeLessThan(5);
    await expect(page.getByRole('navigation', { name: 'Primary navigation' }).filter({ visible: true })).toHaveCount(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Show chart' })).toBeVisible();
    await expect(page.locator('.market-chart-content')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Input asset', exact: true })).toBeVisible();
    await expect(page.getByLabel('Amount in ETH', { exact: true })).toBeVisible();
    const combined = await page.getByRole('button', { name: 'Input asset', exact: true }).evaluate((element) => Boolean(element.closest('.amount-control')));
    expect(combined, 'asset selection belongs to the amount control rather than a duplicate field').toBe(true);
    assertNoBackendRequests(requests);
  });

  test('working routes keep page chrome fixed and scroll supporting content internally', async ({ page, requests }) => {
    for (const width of [320, 359, 390, 430, 768, 1180, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/trade', { waitUntil: 'domcontentloaded' });
      const shell = page.locator('[data-shell-tabs=true]');
      const content = page.locator('.app-content-tabs');
      await expect(shell).toBeVisible();
      await expect(content).toBeVisible();
      await expect(page.locator('.market-strip')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('[data-shell-tabs=true]') && document.querySelector('.app-content-tabs'))), {
        timeout: 5_000,
        message: 'working route shell/content must remain mounted after hydration',
      }).toBe(true);
      let geometry: {
        pageOverflow: number; bodyOverflow: number; contentOverflow: number; overflowY: string;
        bottomPadding: number; shellBottom: number; viewportBottom: number; mobileNavTop: number | null;
      } | undefined;
      let geometryError: unknown;
      for (let attempt = 0; !geometry && attempt < 25; attempt += 1) {
        try {
          geometry = await page.evaluate(() => {
            const root = document.documentElement;
            const body = document.body;
            const shell = document.querySelector<HTMLElement>('[data-shell-tabs=true]');
            const main = document.querySelector<HTMLElement>('.app-content-tabs');
            if (!main || !shell) throw new Error('working route content is missing');
            const style = getComputedStyle(main);
            const shellRect = shell.getBoundingClientRect();
            const mobileNav = document.querySelector<HTMLElement>('.mobile-tabbar');
            const mobileNavRect = mobileNav && getComputedStyle(mobileNav).display !== 'none'
              ? mobileNav.getBoundingClientRect()
              : null;
            return {
              pageOverflow: root.scrollHeight - root.clientHeight,
              bodyOverflow: body.scrollHeight - body.clientHeight,
              contentOverflow: main.scrollHeight - main.clientHeight,
              overflowY: style.overflowY,
              bottomPadding: Number.parseFloat(style.paddingBottom),
              shellBottom: shellRect.bottom,
              viewportBottom: window.innerHeight,
              mobileNavTop: mobileNavRect?.top ?? null,
            };
          });
        } catch (error) {
          if (!/working route content is missing|not attached to the DOM|detached/i.test(String(error))) throw error;
          geometryError = error;
          await page.waitForTimeout(100);
        }
      }
      if (!geometry) throw geometryError ?? new Error('working route content did not stabilize');
      expect(geometry.pageOverflow, `page must not scroll at ${width}px`).toBeLessThanOrEqual(1);
      expect(geometry.bodyOverflow, `body must not scroll at ${width}px`).toBeLessThanOrEqual(1);
      expect(geometry.shellBottom, `shell must fit at ${width}px`).toBeLessThanOrEqual(geometry.viewportBottom + 1);
      expect(geometry.overflowY).toBe('auto');
      expect(geometry.contentOverflow).toBeGreaterThanOrEqual(0);
      if (width <= 640) expect(geometry.bottomPadding).toBeGreaterThan(68);
      else if (width < 840) expect(geometry.bottomPadding).toBeGreaterThan(39);
      else expect(geometry.bottomPadding).toBeGreaterThanOrEqual(0);
      if (geometry.mobileNavTop !== null) {
        expect(geometry.bottomPadding).toBeGreaterThanOrEqual(geometry.viewportBottom - geometry.mobileNavTop - 1);
      }
    }
    assertNoBackendRequests(requests);
  });

  test('desktop top bar stays within the viewport at the compact desktop breakpoint', async ({ page, requests }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    // Only the live <header> top bar: ProviderLoadingState's div.app-topbar
    // fallback can share the DOM with it until React reveals the shell, and
    // the hidden live bar would measure as an empty rect before that.
    const topbar = page.locator('header.app-topbar');
    await expect(topbar).toBeVisible();
    const bounds = await topbar.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewport: window.innerWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
    assertNoBackendRequests(requests);
  });

  test('collapsed mobile charts stay cold until explicitly expanded', async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const toggle = page.getByRole('button', { name: 'Show chart', exact: true });
    await expect(toggle).toBeEnabled();
    await page.waitForTimeout(250);
    expect(requests.all.some((url) => url.includes('/candles'))).toBe(false);
    expect(await page.evaluate(() => performance.getEntriesByType('resource').some((entry) => entry.name.includes('lightweight-charts')))).toBe(false);
    await toggle.click();
    await expect(page.getByRole('button', { name: 'Hide chart', exact: true })).toBeVisible();
    await expect.poll(() => requests.all.filter((url) => url.includes('/candles')).length).toBeGreaterThan(0);
    assertNoBackendRequests(requests);
  });

  test('the guide is discoverable, searchable, and supports mobile section deep links', async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/more', { waitUntil: 'domcontentloaded' });
    await page.locator('main').getByRole('link', { name: /FxAeon docs/i }).click();
    await expect(page).toHaveURL(/\/docs\/?$/);
    await expect(page.getByRole('heading', { name: 'Welcome to FxAeon', exact: true })).toBeVisible();
    const welcomeCards = page.getByRole('main').getByRole('link');
    await expect(welcomeCards).toHaveCount(6);
    expect(await welcomeCards.evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute('href'))))
      .toEqual(expect.arrayContaining(['/docs/guide/getting-started', '/docs/guide/trade', '/docs/guide/earn', '/docs/guide/borrow', '/docs/guide/move', '/docs/guide/access']));
    await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
    const homeSearch = page.getByRole('searchbox', { name: 'Search docs' });
    await homeSearch.fill('getFxSaveBalance');
    const homeResults = page.getByRole('navigation', { name: 'Pages', exact: true });
    await expect(homeResults.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
    const homeFxSave = homeResults.getByRole('link', { name: /^fxSAVE/ });
    await expect(homeResults).toBeVisible();
    await expect(homeFxSave).toHaveAttribute('href', '/docs/sdk#sdk-earn');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(homeSearch).toHaveValue('');
    await expect(homeResults.getByRole('link')).toHaveCount(14);
    await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Search documentation', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(homeResults).toBeHidden();
    await welcomeCards.getByRole('heading', { name: 'Get started with FxAeon', exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/guide\/getting-started\/?$/);
    await expect(page.getByRole('heading', { name: 'Your first transaction', exact: true })).toBeVisible();
    // Keep the index/search assertions on the complete legacy guide route.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/docs/guide');
    await expect(page.getByRole('heading', { name: 'Product guide', exact: true })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Documentation sections' });
    const guides = page.getByRole('group', { name: 'Documentation guides' });
    for (const [name, href] of [
      ['Start here', '/docs/guide/getting-started'], ['Products', '/docs/guide/trade'],
      ['Wallets', '/docs/guide/wallets'], ['Help', '/docs/guide/troubleshooting'],
    ]) {
      await expect(guides.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    }
    await expect(guides.getByRole('link', { name: 'SDK reference', exact: true })).toHaveAttribute('href', '/docs/sdk');
    await page.setViewportSize({ width: 390, height: 844 });
    const contents = nav.locator('details');
    await page.getByRole('button', { name: 'Open documentation menu', exact: true }).click();
    await expect(contents).toHaveJSProperty('open', true);
    await expect(nav.getByRole('link')).toHaveCount(14);
    await page.getByRole('button', { name: 'Close documentation menu', exact: true }).click();
    await expect(nav).toBeHidden();
    await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Search docs' });
    await search.fill('network speed');
    await expect(nav.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
    await expect(nav.getByRole('link')).toHaveCount(1);
    // The compact summary announces the filtered count.
    await expect(nav.getByText('1 result', { exact: true })).toHaveCount(1);
    // Search filters the index, never the underlying article or anchors.
    await expect(page.getByRole('heading', { name: 'Getting started', exact: true })).toBeAttached();
    await search.press('Tab');
    await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Search documentation', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'More documentation options', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    const menuToggle = page.getByRole('button', { name: 'Close documentation menu', exact: true });
    await expect(menuToggle).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(nav.getByRole('link', { name: /^Fees & slippage/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/docs\/guide#fees$/);
    const articleHeading = page.getByRole('heading', { name: 'Fees & slippage', exact: true });
    await expect(articleHeading).toBeInViewport();
    await expect.poll(async () => {
      const heading = await articleHeading.boundingBox();
      const chrome = await page.locator('[class*="docsChrome"]').boundingBox();
      return heading!.y >= chrome!.y + chrome!.height - 1;
    }).toBe(true);
    await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
    await search.fill('no-matching-section');
    await expect(nav.locator('p[role="status"]')).toHaveText('0 documentation results found');
    await expect(nav.getByRole('link')).toHaveCount(0);
    await expect(nav.getByText(/Nothing found for .*no-matching-section/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(nav.getByRole('link')).toHaveCount(14);
    await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Search documentation', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(nav).toBeHidden();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(articleHeading).toBeInViewport();
    assertNoBackendRequests(requests);
  });

  test('leverage keeps a full touch target and keyboard control at mobile and desktop widths', async ({ page, requests }) => {
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const slider = page.getByRole('slider', { name: 'Target leverage slider', exact: true });
    const amount = page.getByRole('spinbutton', { name: 'Target leverage', exact: true });
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(slider).toBeVisible();
      await expect.poll(async () => (await slider.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await amount.fill('2');
      await slider.focus();
      await slider.press('ArrowRight');
      await expect(slider).toHaveValue('2.1');
      await expect(amount).toHaveValue('2.1');
    }
    assertNoBackendRequests(requests);
  });

  test('slippage presets support standard radio-key navigation', async ({ page, requests }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    const group = page.getByRole('radiogroup', { name: 'Slippage tolerance' });
    const selected = group.getByRole('radio', { name: '0.5%', exact: true });
    await expect(selected).toHaveAttribute('aria-checked', 'true');
    await expect(selected).toBeEnabled();
    await selected.focus();
    await selected.press('ArrowRight');
    const next = group.getByRole('radio', { name: '1%', exact: true });
    await expect(next).toBeFocused();
    await expect(next).toHaveAttribute('aria-checked', 'true');
    assertNoBackendRequests(requests);
  });
});

test.describe('light theme overlays', () => {
  test.use({ telegram: false, browserWallet: { address: '0x930f0000000000000000000000000000000098b9', initiallyConnected: true } });

  test('wallet and token portals use the light palette and restore focus', async ({ page, requests }) => {
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible();
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await page.getByRole('button', { name: 'Open wallet profile' }).click();
    const wallet = page.getByRole('dialog');
    await expect(wallet).toBeVisible();
    const walletBackground = await wallet.evaluate((element) => {
      const sample = document.createElement('div');
      sample.style.backgroundColor = 'var(--surface)';
      document.body.append(sample);
      const expected = getComputedStyle(sample).backgroundColor;
      sample.remove();
      return { actual: getComputedStyle(element).backgroundColor, expected };
    });
    expect(walletBackground.actual).toBe(walletBackground.expected);
    await page.keyboard.press('Escape');
    await expect(wallet).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeFocused();
    await page.getByRole('button', { name: 'Input asset', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Input asset' });
    await expect(picker).toBeVisible();
    // A browser extension, assistive technology, or application code can move
    // focus without pressing Tab. The modal must recover containment too.
    await page.getByRole('button', { name: 'Open wallet profile' }).evaluate((button) => (button as HTMLButtonElement).focus());
    await expect.poll(() => picker.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    const palette = await picker.evaluate((element) => {
      const style = getComputedStyle(element);
      const root = getComputedStyle(document.documentElement);
      return { accent: style.getPropertyValue('--mint').trim(), expected: root.getPropertyValue('--mint').trim() };
    });
    expect(palette.accent).toBe(palette.expected);
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(page.getByRole('button', { name: 'Input asset', exact: true })).toBeFocused();
    assertNoBackendRequests(requests);
  });
});
