import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.describe('cohesive responsive design', () => {
  test.use({ telegram: false });

  test('all route surfaces inherit the dark palette without appearance controls', async ({ page, requests }) => {
    test.setTimeout(120_000);
    for (const route of ['/trade', '/positions', '/portfolio', '/earn', '/borrow', '/move', '/history', '/settings', '/qr', '/docs']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main:visible')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.getByRole('button', { name: /Switch to .* theme/ })).toHaveCount(0);
      await expect(page.getByRole('radiogroup', { name: 'Appearance theme' })).toHaveCount(0);
      await expect.poll(async () => page.locator('main:visible').evaluate((main) => {
        const root = getComputedStyle(document.documentElement);
        return [main, ...main.querySelectorAll('.ui-card, .amount-control, .market-chart-panel')].flatMap((element) => {
          const style = getComputedStyle(element);
          return ['--mint', '--text', '--bg'].filter((token) => style.getPropertyValue(token).trim() !== root.getPropertyValue(token).trim());
        });
      }), { message: `${route} must inherit the shared dark palette` }).toEqual([]);
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
    // The selector lives inside the padded ticket now; align the two outer
    // cards, and measure them together after the responsive layout settles.
    await expect.poll(() => page.evaluate(() => {
      const chart = document.querySelector('.market-chart-panel')?.getBoundingClientRect();
      const ticket = document.querySelector('.trade-ticket')?.getBoundingClientRect();
      return {
        sideBySide: Boolean(chart && ticket && chart.width > 0 && chart.right < ticket.left),
        aligned: Boolean(chart && ticket && ticket.width > 0 && Math.abs(chart.top - ticket.top) < 5),
      };
    })).toEqual({ sideBySide: true, aligned: true });
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
        contentBottom: number; shellBottom: number; viewportBottom: number; mobileNavTop: number | null;
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
              contentBottom: main.getBoundingClientRect().bottom,
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
      if (geometry.mobileNavTop !== null) {
        expect(geometry.contentBottom, `the entire scrollport clears navigation at ${width}px`)
          .toBeLessThanOrEqual(geometry.mobileNavTop - 7);
      }
    }
    assertNoBackendRequests(requests);
  });

  test('desktop top bar spans the viewport while route content stays centered', async ({ page, requests }, testInfo) => {
    for (const width of [840, 1180, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/earn', { waitUntil: 'domcontentloaded' });
      // Only the live <header> top bar: ProviderLoadingState's div.app-topbar
      // fallback can share the DOM with it until React reveals the shell, and
      // the hidden live bar would measure as an empty rect before that.
      const topbar = page.locator('header.app-topbar');
      await expect(topbar).toBeVisible();
      const bounds = await topbar.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const content = document.querySelector('main.app-content')!.getBoundingClientRect();
        const brand = element.querySelector(':scope > a')!.getBoundingClientRect();
        const nav = element.querySelector('nav')!.getBoundingClientRect();
        const wallet = element.querySelector('.app-topbar-actions')!.getBoundingClientRect();
        return { left: rect.left, right: rect.right, viewport: window.innerWidth, content: { left: content.left, right: content.right, width: content.width },
          brandRight: brand.right, navLeft: nav.left, navRight: nav.right, walletLeft: wallet.left, walletRight: wallet.right };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
      expect(bounds.left).toBeLessThanOrEqual(40);
      expect(bounds.viewport - bounds.walletRight).toBeLessThanOrEqual(40);
      expect(bounds.brandRight).toBeLessThanOrEqual(bounds.navLeft);
      expect(bounds.navRight).toBeLessThanOrEqual(bounds.walletLeft);
      expect(bounds.content.width).toBeLessThanOrEqual(1120);
      expect(Math.abs(bounds.content.left - (bounds.viewport - bounds.content.right))).toBeLessThanOrEqual(1);
      if (width === 1920) await page.screenshot({ path: testInfo.outputPath('earn-wide-navigation.png') });
    }
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
    await expect(page.getByRole('heading', { name: 'FxAeon Documentation', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Use FxAeon', exact: true })).toBeVisible();
    const home = page.locator('#main-content');
    expect(await home.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href'))))
      .toEqual(expect.arrayContaining(['/docs/guide/getting-started', '/docs/guide/trade', '/docs/guide/earn', '/docs/guide/borrow', '/docs/guide/move', '/docs/sdk/setup']));

    const searchToggle = page.getByRole('button', { name: 'Search documentation', exact: true });
    const pages = page.getByRole('navigation', { name: 'Pages', exact: true });
    const search = page.getByRole('searchbox', { name: 'Search docs' });
    await searchToggle.click();
    await expect(search).toBeFocused();
    await search.fill('getFxSaveBalance');
    await expect(pages.locator('p[role="status"]')).toHaveText(/^\d+ documentation results? found$/);
    const method = pages.getByRole('link', { name: /^getFxSaveBalance/ });
    await expect(method).toHaveAttribute('href', '/docs/sdk/earn#getFxSaveBalance');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(pages.getByRole('link', { name: 'Your first transaction', exact: true })).toBeVisible();
    await search.fill('getFxSaveBalance');
    await expect(method).toBeVisible();
    await expect(home).toHaveAttribute('inert', '');
    // The background document stays intact while mobile search contains focus.
    await expect(page.locator('#use-fxaeon')).toBeAttached();
    await pages.getByRole('link').last().focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('button[aria-controls="docs-contents"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(searchToggle).toBeFocused();
    await expect(searchToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(pages).toBeHidden();
    await expect(home).not.toHaveAttribute('inert', '');

    await home.locator('a[href="/docs/guide/getting-started"]').click();
    await expect(page).toHaveURL(/\/docs\/guide\/getting-started\/?$/);
    await expect(page.getByRole('heading', { name: 'Your first transaction', exact: true })).toBeVisible();
    const menu = page.locator('button[aria-controls="docs-contents"]');
    await menu.click();
    await expect(pages.getByRole('link', { name: 'Your first transaction', exact: true })).toHaveAttribute('aria-current', 'location');
    await expect(pages.getByRole('link', { name: 'Telegram & browser', exact: true })).toHaveAttribute('href', '/docs/guide/access');
    await expect(pages.getByRole('link', { name: 'SDK reference', exact: true })).toHaveAttribute('href', '/docs/sdk/overview');
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await expect(pages).toBeHidden();

    await searchToggle.click();
    await search.fill('getFxSaveBalance');
    await method.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/docs\/sdk\/earn\/?#getFxSaveBalance$/);
    await expect(page.locator('#getFxSaveBalance')).toBeFocused();
    await expect(page.locator('#getFxSaveBalance')).toBeInViewport();
    await expect(pages).toBeHidden();

    // A bookmark to the former complete guide still reaches its focused topic.
    await page.goto('/docs/guide#fees');
    await expect(page).toHaveURL(/\/docs\/guide\/fees\/?#docs-page-heading$/);
    const heading = page.getByRole('heading', { name: 'Fees & slippage', level: 1, exact: true });
    await expect(heading).toBeFocused();
    await expect.poll(async () => {
      const target = await heading.boundingBox();
      const chrome = await page.locator('[class*="docsChrome"]').boundingBox();
      return Boolean(target && chrome && target.y >= chrome.y + chrome.height - 1);
    }).toBe(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(heading).toBeInViewport();
    assertNoBackendRequests(requests);
  });

  test('leverage keeps a full touch target and keyboard control at mobile and desktop widths', async ({ page, requests }) => {
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const slider = page.getByRole('slider', { name: 'Target leverage slider', exact: true });
    const amount = page.getByRole('textbox', { name: 'Target leverage', exact: true });
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
    await page.goto('/more', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Transaction settings/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Transaction settings' });
    const group = dialog.getByRole('radiogroup', { name: 'Max slippage' });
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

test.describe('dark overlays', () => {
  test.use({ telegram: false, browserWallet: { address: '0x930f0000000000000000000000000000000098b9', initiallyConnected: true } });

  test('wallet and token portals use the dark palette and restore focus', async ({ page, requests }) => {
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
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
