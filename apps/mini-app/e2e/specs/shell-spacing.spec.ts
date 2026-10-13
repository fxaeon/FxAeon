import { expect, test, assertNoBackendRequests } from '../fixtures/test';

// Locate the live top bar as `header.app-topbar`. On routes where React
// streams the wallet boundary out of line, the exported HTML also contains
// that boundary's loading fallback (ProviderLoadingState) with its own
// div.app-topbar until React reveals the shell, so `.app-topbar` can match twice.
test.describe('shared shell spacing', () => {
  test.use({ telegram: false });

  test('keeps the mobile product top bar compact without shrinking its controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    const topbar = page.locator('header.app-topbar');
    await expect(topbar).toBeVisible();

    const geometry = await topbar.evaluate((element) => {
      const controls = Array.from(element.querySelectorAll<HTMLElement>(
        '.app-topbar-actions > button, .app-topbar-actions .network-selector',
      ));
      return {
        height: element.getBoundingClientRect().height,
        controlHeights: controls.map((control) => control.getBoundingClientRect().height),
        shellTopPadding: getComputedStyle(element.closest('.app-shell')!).paddingTop,
      };
    });

    expect(geometry.height, 'normal-height phone top bar uses the 56px touch row').toBe(56);
    expect(geometry.controlHeights.length).toBeGreaterThan(0);
    for (const height of geometry.controlHeights) {
      expect(height, 'top bar controls retain a 44px minimum target').toBeGreaterThanOrEqual(44);
    }
    // Density changes the bar itself; safe-area spacing remains owned by .app-shell.
    expect(geometry.shellTopPadding).toBe('4px');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24 } });
    const telegramShellPadding = await page.evaluate(() => {
      document.documentElement.dataset.tmaSafeArea = 'true';
      return Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>('.app-shell')!).paddingTop);
    });
    expect(telegramShellPadding, 'Telegram top inset must remain clear above the compact header').toBeGreaterThanOrEqual(24);
    await cdp.detach();
  });

  test.describe('connected header density', () => {
    test.use({
      browserWallet: {
        address: '0x930f0000000000000000000000000000000098b9',
        initiallyConnected: true,
      },
    });

    test('keeps the connected Trade header compact with a long ENS-sized identity', async ({ page, requests }, testInfo) => {
      await page.setViewportSize({ width: 393, height: 852 });
      await page.goto('/trade', { waitUntil: 'domcontentloaded' });

      const profileButton = page.getByRole('button', { name: 'Open wallet profile', exact: true });
      await expect(profileButton).toBeVisible();
      await expect(profileButton).toContainText(/0x930f.*98b9/i);
      await expect(page.locator('[data-trade-ticket]')).toBeVisible();
      await expect(page.getByLabel('Amount in ETH')).toBeVisible();

      // The deterministic offline wallet fixture does not resolve ENS. After
      // proving its connected address, use an ENS-length label to stress the
      // same constrained identity control that displays a verified name.
      const ensSizedLabel = 'dextrader-2024.eth';
      await profileButton.locator('[data-wallet-identity-name]').evaluate((element, label) => { element.textContent = label; }, ensSizedLabel);
      await expect(profileButton).toContainText(ensSizedLabel);

      const geometry = await page.locator('header.app-topbar').evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        controls: Array.from(element.querySelectorAll<HTMLElement>('.app-topbar-actions button'))
          .map((control) => {
            const rect = control.getBoundingClientRect();
            return { height: rect.height, left: rect.left, right: rect.right };
          }),
        identityWidth: element.querySelector<HTMLElement>('[aria-label="Open wallet profile"]')?.getBoundingClientRect().width ?? 0,
        viewportWidth: window.innerWidth,
      }));
      expect(geometry.height).toBe(56);
      expect(geometry.controls.length).toBeGreaterThan(0);
      for (const control of geometry.controls) {
        expect(control.height).toBeGreaterThanOrEqual(44);
        expect(control.left).toBeGreaterThanOrEqual(0);
        expect(control.right).toBeLessThanOrEqual(geometry.viewportWidth);
      }
      expect(geometry.identityWidth).toBeGreaterThanOrEqual(44);

      const screenshot = await page.screenshot({ path: testInfo.outputPath('connected-trade-393x852.png'), fullPage: false });
      await testInfo.attach('connected-trade-header-393x852', { body: screenshot, contentType: 'image/png' });
      assertNoBackendRequests(requests);
    });
  });

  test('keeps product headers close to the top bar without overlap', async ({ page, requests }) => {
    test.setTimeout(120_000);
    const routes = ['/portfolio', '/trade', '/earn', '/borrow', '/move', '/settings'];
    const viewports = [
      { width: 320, height: 568, maxGap: 9 },
      { width: 390, height: 844, maxGap: 15 },
      { width: 1280, height: 900, maxGap: 21 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of routes) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        const topbar = page.locator('header.app-topbar');
        const header = page.locator('.page-header:visible, .trade-page-heading:visible, .portfolio-page-heading:visible').first();
        await expect(topbar).toBeVisible();
        if (await header.count() === 0) continue;

        let geometry: { gap: number; topbarBottom: number; headerTop: number; hidden: boolean } | undefined;
        let geometryError: unknown;
        for (let attempt = 0; !geometry && attempt < 25; attempt += 1) {
          try {
            const currentHeader = page.locator('.page-header:visible, .trade-page-heading:visible, .portfolio-page-heading:visible').first();
            await expect(page.locator('header.app-topbar')).toBeVisible();
            if (await currentHeader.count() === 0) {
              await page.waitForTimeout(100);
              continue;
            }
            geometry = await currentHeader.evaluate((element) => {
              const topbar = document.querySelector<HTMLElement>('header.app-topbar');
              if (!topbar) throw new Error('top bar is missing');
              const topbarRect = topbar.getBoundingClientRect();
              const headerRect = element.getBoundingClientRect();
              const hidden = headerRect.width <= 1 && headerRect.height <= 1;
              return {
                gap: headerRect.top - topbarRect.bottom,
                topbarBottom: topbarRect.bottom,
                headerTop: headerRect.top,
                hidden,
              };
            });
          } catch (error) {
            if (!/top bar is missing|not attached to the DOM|detached/i.test(String(error))) throw error;
            geometryError = error;
            await page.waitForTimeout(100);
          }
        }
        if (!geometry) throw geometryError ?? new Error('shell/header geometry did not stabilize');

        // Product route headings are intentionally visually hidden on phones;
        // keep their accessible text without reserving layout space.
        if (geometry.hidden) continue;

        expect(geometry.gap, `${route} must not overlap the top bar`).toBeGreaterThanOrEqual(0);
        expect(geometry.gap, `${route} has excessive shell/header spacing at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.maxGap);
        expect(geometry.headerTop, `${route} header must follow the top bar`).toBeGreaterThanOrEqual(geometry.topbarBottom);
      }
    }

    assertNoBackendRequests(requests);
  });
});
