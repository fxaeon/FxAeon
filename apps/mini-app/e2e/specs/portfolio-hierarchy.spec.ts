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
      const filters = assets.getByRole('combobox', { name: 'Portfolio network', exact: true });
      await expect(assets).toBeVisible();
      await expect(filters).toBeVisible();
      expect(await filters.evaluate((element) => element.closest('section[aria-labelledby="portfolio-assets-heading"]') !== null)).toBe(true);
      await expect(filters.locator('option')).toHaveText(['All networks', 'Ethereum', 'Base']);
      await expect(filters).toBeEnabled();
      await filters.selectOption('8453');
      await expect(filters).toHaveValue('8453');
      const overflow = await assets.evaluate((element) => getComputedStyle(element).overflowY);
      expect(overflow).not.toMatch(/auto|scroll/);
      const actions = page.locator('section[aria-labelledby="portfolio-actions-title"]');
      await expect(actions.locator('a')).toHaveCount(4);
      await expect(actions.getByRole('link', { name: 'Borrow', exact: true })).toHaveAttribute('href', '/borrow');
      await expect(actions.getByRole('link', { name: 'Move', exact: true })).toHaveCount(0);
    }
    assertNoBackendRequests(requests);
  });
});


test.describe('Disconnected Portfolio entry', () => {
  test.use({ telegram: false, browserWallet: false });

  test.beforeEach(async ({ page }) => {
    await page.route('https://api.aladdin.club/api1/concentrator_aToken_tvl_apy', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 200, data: { fxSave: { address: '0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39', apy: '6.25' } } }),
    }));
  });

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

  test('keeps Trade, Earn, and Borrow directly reachable from the disconnected home', async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    const products = page.getByRole('region', { name: 'Savings and borrowing', exact: true });
    await expect(products.getByRole('link', { name: /Earn with fxSAVE/ })).toHaveAttribute('href', '/earn');
    await expect(products.getByText(/6\.25% variable APY/)).toBeVisible();
    await expect(products.getByRole('link', { name: /Borrow fxUSD/ })).toHaveAttribute('href', '/borrow');
    await expect(page.getByRole('heading', { name: 'Markets', exact: true })).toBeVisible();
    await expect(page.getByText('24h change', { exact: true })).toBeVisible();
    const actions = page.locator('section[aria-labelledby="portfolio-actions-title"]');
    const destinations = [['Trade', '/trade'], ['Earn', '/earn'], ['Borrow', '/borrow']] as const;
    for (const [label, href] of destinations) {
      const link = actions.getByRole('link', { name: label, exact: true });
      await expect(link).toHaveAttribute('href', href);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${href}\\/?$`));
      await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    }
    assertNoBackendRequests(requests);
  });
});

test.describe('Grouped Portfolio header controls', () => {
  test.use({ telegram: false, browserWallet: { initiallyConnected: true } });

  test('connected Receive and History open their own workspaces within More', async ({ page, requests }, testInfo) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/more', { waitUntil: 'domcontentloaded' });
      const receive = page.getByRole('main').getByRole('link', { name: 'Receive', exact: true });
      await expect(receive).toHaveAttribute('href', '/qr');
      await receive.click();
      await expect(page).toHaveURL(/\/qr\/?$/);
      await expect(page.getByRole('heading', { name: 'Receive', exact: true, level: 1 })).toBeVisible();
      await expect(page.getByText('Your wallet address', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copy address', exact: true })).toBeVisible();
      expect((await page.getByRole('main').innerText()).replace(/\s/g, '')).toContain('0x930f0000000000000000000000000000000098b9');
      const nav = page.locator(viewport.width < 1000 ? 'nav.mobile-tabbar' : '.app-topbar nav');
      await expect(nav.locator('[aria-current="page"]')).toHaveText('More');
      await expect(page.getByRole('region', { name: 'Send assets' })).toHaveCount(0);
      await testInfo.attach(`receive-${viewport.width}`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
      await page.getByRole('link', { name: 'Go back', exact: true }).click();
      await expect(page).toHaveURL(/\/more\/?$/);
      await page.getByRole('main').getByRole('link', { name: 'History', exact: true }).click();
      await expect(page).toHaveURL(/\/history\/?$/);
      await expect(page.getByRole('heading', { name: 'History', exact: true, level: 1 })).toBeVisible();
      await expect(nav.locator('[aria-current="page"]')).toHaveText('More');
    }
    assertNoBackendRequests(requests);
  });

  test('network and wallet controls open independently and the dock clears page content', async ({ page, requests }) => {
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
      const group = page.getByRole('group', { name: 'Wallet and network controls', exact: true });
      const network = group.getByRole('button', { name: 'Change network, current Ethereum', exact: true });
      const profile = group.getByRole('button', { name: 'Open wallet profile', exact: true });
      await expect(network).toBeVisible();
      await expect(profile).toBeVisible();
      for (const control of [network, profile]) {
        const box = await control.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }

      await network.click();
      await expect(page.getByRole('menu', { name: 'Choose wallet network' })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await profile.click();
      await expect(page.locator('.wallet-profile-backdrop[data-state="open"]')).toBeVisible();
      await expect(page.getByRole('menu', { name: 'Choose wallet network' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Close wallet profile' }).click();

      const dock = page.locator('nav.mobile-tabbar');
      if (viewport.width < 1000) {
        await expect(dock).toBeVisible();
        await page.locator('.app-content').evaluate((content) => { content.scrollTop = content.scrollHeight; });
        const clearance = await page.evaluate(() => {
          const content = document.querySelector('#overview')!.getBoundingClientRect();
          const nav = document.querySelector('nav.mobile-tabbar')!.getBoundingClientRect();
          const dock = document.querySelector('.tabbar')!.getBoundingClientRect();
          return { contentBottom: content.bottom, navTop: nav.top, dockHeight: dock.height };
        });
        expect(clearance.dockHeight, 'the dock remains compact').toBeLessThanOrEqual(62);
        expect(clearance.contentBottom, 'Portfolio content can scroll clear of the dock').toBeLessThanOrEqual(clearance.navTop + 1);
      } else {
        await expect(dock).toBeHidden();
      }
    }
    assertNoBackendRequests(requests);
  });
});
