import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.describe('Portfolio views and mobile hierarchy', () => {
  test.use({ telegram: false, browserWallet: { initiallyConnected: true } });

  test('switches real Tokens, DeFi, and Activity panels with accessible tabs', async ({ page, requests }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
      const tabs = page.getByRole('tablist', { name: 'Portfolio views', exact: true });
      const tokenTab = tabs.getByRole('tab', { name: 'Tokens', exact: true });
      const defiTab = tabs.getByRole('tab', { name: 'DeFi', exact: true });
      const activityTab = tabs.getByRole('tab', { name: 'Activity', exact: true });
      const panel = page.getByRole('tabpanel');
      await expect(tokenTab).toHaveAttribute('aria-selected', 'true');
      await expect(tokenTab).toHaveAttribute('aria-controls', 'portfolio-tab-panel');
      await expect(panel).toHaveAttribute('aria-labelledby', 'portfolio-tab-tokens');
      const assets = page.getByRole('region', { name: 'Wallet assets', exact: true });
      const filters = page.getByRole('button', { name: /^Portfolio network:/ });
      await expect(assets).toBeVisible();
      await expect(filters).toBeVisible();
      await expect(filters).toHaveAttribute('aria-haspopup', 'menu');
      await expect(filters).toHaveAttribute('aria-expanded', 'false');
      await expect(filters).toBeEnabled();
      const tabBox = await tabs.boundingBox();
      const contentBox = await page.locator('#overview').boundingBox();
      expect(tabBox && contentBox ? Math.abs(tabBox.x - contentBox.x) : Infinity)
        .toBeLessThanOrEqual(2);
      for (const tab of [tokenTab, defiTab, activityTab]) {
        const box = await tab.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(48);
        expect(box?.height).toBeGreaterThanOrEqual(48);
      }
      await filters.click();
      const networkMenu = page.getByRole('menu', { name: 'Filter by network', exact: true });
      await expect(networkMenu.getByRole('menuitemradio', { name: 'All networks', exact: true })).toHaveAttribute('aria-checked', 'true');
      const menuBox = await networkMenu.boundingBox();
      const dockBox = await page.locator('nav.mobile-tabbar').boundingBox();
      expect(menuBox?.y).toBeGreaterThanOrEqual(0);
      expect(menuBox ? menuBox.y + menuBox.height : Infinity).toBeLessThanOrEqual(dockBox?.y ?? viewport.height);
      await networkMenu.getByRole('menuitemradio', { name: 'Base', exact: true }).click();
      await expect(filters).toHaveAccessibleName('Portfolio network: Base');
      await expect(filters).toHaveAttribute('aria-expanded', 'false');

      await defiTab.click();
      await expect(defiTab).toHaveAttribute('aria-selected', 'true');
      await expect(tabs.getByRole('tab', { name: 'Tokens', exact: true })).toHaveAttribute('aria-selected', 'false');
      await expect(tabs.getByRole('tab', { name: 'Activity', exact: true })).toHaveAttribute('aria-selected', 'false');
      await expect(panel).toHaveAttribute('aria-labelledby', 'portfolio-tab-defi');
      await expect(page.getByRole('region', { name: 'Positions', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Wallet assets', exact: true })).toHaveCount(0);

      await activityTab.click();
      await expect(activityTab).toHaveAttribute('aria-selected', 'true');
      await expect(tabs.getByRole('tab', { name: 'Tokens', exact: true })).toHaveAttribute('aria-selected', 'false');
      await expect(tabs.getByRole('tab', { name: 'DeFi', exact: true })).toHaveAttribute('aria-selected', 'false');
      await expect(panel).toHaveAttribute('aria-labelledby', 'portfolio-tab-activity');
      await expect(page.getByRole('region', { name: 'Recent history', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Positions', exact: true })).toHaveCount(0);

      await tokenTab.click();
      await expect(tokenTab).toHaveAttribute('aria-selected', 'true');
      await expect(defiTab).toHaveAttribute('aria-selected', 'false');
      await expect(activityTab).toHaveAttribute('aria-selected', 'false');
      await expect(page.getByRole('region', { name: 'Wallet assets', exact: true })).toBeVisible();
      await expect(filters).toHaveAccessibleName('Portfolio network: Base');

      const actions = page.locator('section[aria-labelledby="portfolio-actions-title"]');
      for (const [label, href] of [['Send', '/send'], ['Receive', '/qr'], ['Trade', '/trade']] as const) {
        const action = actions.getByRole('link', { name: label, exact: true });
        await expect(action).toHaveAttribute('href', href);
        const box = await action.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      const more = actions.getByRole('button', { name: 'More', exact: true });
      await expect(more).toHaveAttribute('aria-haspopup', 'dialog');
      const moreBox = await more.boundingBox();
      expect(moreBox?.width).toBeGreaterThanOrEqual(44);
      expect(moreBox?.height).toBeGreaterThanOrEqual(44);
    }
    assertNoBackendRequests(requests);
  });

  test('supports roving keyboard navigation and wraps through all three tabs', async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#overview')).not.toHaveAttribute('aria-busy', 'true');
    const networkTrigger = page.getByRole('button', { name: /^Portfolio network: All networks$/ });
    await expect(networkTrigger).toBeEnabled();
    const tabs = page.getByRole('tablist', { name: 'Portfolio views', exact: true });
    const tokenTab = tabs.getByRole('tab', { name: 'Tokens', exact: true });
    const defiTab = tabs.getByRole('tab', { name: 'DeFi', exact: true });
    const activityTab = tabs.getByRole('tab', { name: 'Activity', exact: true });

    await tokenTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(defiTab).toBeFocused();
    await expect(defiTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(activityTab).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tokenTab).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(activityTab).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tokenTab).toBeFocused();
    await page.keyboard.press('End');
    await expect(activityTab).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tokenTab).toBeFocused();
    await expect(tokenTab).toHaveAttribute('aria-selected', 'true');
    await expect(networkTrigger).toBeEnabled();
    await page.keyboard.press('Tab');
    await expect(networkTrigger).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tabpanel')).not.toBeFocused();
    assertNoBackendRequests(requests);
  });

  test('filters networks with a keyboard-operable radio menu and restores focus', async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#overview')).not.toHaveAttribute('aria-busy', 'true');
    const trigger = page.getByRole('button', { name: /^Portfolio network:/ });
    await expect(trigger).toBeEnabled();
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Filter by network', exact: true });
    const all = menu.getByRole('menuitemradio', { name: 'All networks', exact: true });
    const ethereum = menu.getByRole('menuitemradio', { name: 'Ethereum', exact: true });
    const base = menu.getByRole('menuitemradio', { name: 'Base', exact: true });
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(all).toHaveAttribute('aria-checked', 'true');
    await expect(ethereum).toHaveAttribute('aria-checked', 'false');
    await expect(base).toHaveAttribute('aria-checked', 'false');

    await page.keyboard.press('Home');
    await expect(all).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(ethereum).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(base).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(ethereum).toBeFocused();
    await page.keyboard.press('End');
    await expect(base).toBeFocused();
    await page.keyboard.press('Space');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAccessibleName('Portfolio network: Base');
    await expect(trigger).toBeFocused();

    await trigger.click();
    const reopened = page.getByRole('menu', { name: 'Filter by network', exact: true });
    await reopened.getByRole('menuitemradio', { name: 'Ethereum', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Filter by network', exact: true })).toHaveCount(0);
    await expect(trigger).toHaveAccessibleName('Portfolio network: Ethereum');
    await expect(trigger).toBeFocused();

    await trigger.click();
    const escapeMenu = page.getByRole('menu', { name: 'Filter by network', exact: true });
    await escapeMenu.getByRole('menuitemradio', { name: 'Base', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(escapeMenu).toHaveCount(0);
    await expect(trigger).toHaveAccessibleName('Portfolio network: Ethereum');
    await expect(trigger).toBeFocused();

    await trigger.click();
    const tabMenu = page.getByRole('menu', { name: 'Filter by network', exact: true });
    await tabMenu.getByRole('menuitemradio', { name: 'Base', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(tabMenu).toHaveCount(0);
    await expect(trigger).not.toBeFocused();
    assertNoBackendRequests(requests);
  });

  test('opens More actions as a keyboard-dismissible dialog and routes to Activity', async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    const actions = page.locator('section[aria-labelledby="portfolio-actions-title"]');
    const more = actions.getByRole('button', { name: 'More', exact: true });
    await more.click();
    const dialog = page.getByRole('dialog', { name: 'More actions', exact: true });
    await expect(dialog).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    for (const [label, href] of [['Earn', '/earn'], ['Borrow', '/borrow'], ['Move', '/move']] as const) {
      await expect(dialog.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
    }
    await expect(dialog.getByRole('button', { name: 'Activity', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close more actions', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();
    await more.click();
    await page.getByRole('dialog', { name: 'More actions', exact: true }).getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Recent history', exact: true })).toBeVisible();
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

  test('offers a clear disconnected entry without placeholder balances', async ({ page, requests }, testInfo) => {
    for (const viewport of [{ width: 320, height: 568 }, { width: 412, height: 818 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'DeFi that moves with you.', exact: true })).toBeVisible();
      const connect = page.getByRole('main').getByRole('button', { name: 'Connect wallet', exact: true });
      await expect(connect).toHaveCount(1);
      await expect(page.locator('.app-topbar').getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
      await expect(page.locator('[data-portfolio-value]')).toHaveCount(0);
      await expect(connect).toBeInViewport();
      await testInfo.attach(`portfolio-one-entry-${viewport.width}`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
      await connect.click();
      await expect(page.getByRole('dialog', { name: 'Connect your wallet' })).toBeVisible();
      await page.getByRole('button', { name: 'Close wallet selection' }).click();
      await expect(connect).toBeFocused();
      await expect(page).toHaveURL(/\/portfolio\/?$/);
    }
    assertNoBackendRequests(requests);
  });

  test('keeps Trade, Earn, Borrow, and Move directly reachable from the disconnected home', async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    const products = page.getByRole('region', { name: 'Explore FxAeon', exact: true });
    await expect(products.getByRole('link', { name: /Earn/ })).toHaveAttribute('href', '/earn');
    await expect(products.getByRole('link', { name: /Borrow/ })).toHaveAttribute('href', '/borrow');
    await expect(page.getByRole('heading', { name: 'Markets', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Markets', exact: true }).locator('[title="24-hour price change"]')).toHaveCount(2);
    // This fixture deliberately has no market feed. The timeframe still needs
    // to be announced without presenting a verified price or change.
    await expect(page.getByRole('link', { name: 'Trade ETH', exact: true })).toHaveAccessibleDescription('Market price unavailable 24 hour change unavailable');
    const destinations = [['Trade', '/trade'], ['Earn', '/earn'], ['Borrow', '/borrow'], ['Move', '/move']] as const;
    for (const [label, href] of destinations) {
      const link = products.getByRole('link', { name: new RegExp(label) });
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

  test('connected Receive opens from the wallet and History remains in More', async ({ page, requests }, testInfo) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
      if (viewport.width < 840) {
        await page.getByRole('button', { name: 'Open menu', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'More menu', exact: true })).toBeVisible();
        await expect(page).toHaveURL(/\/portfolio\/?$/);
      } else {
        await page.getByRole('link', { name: 'More', exact: true }).click();
        await expect(page).toHaveURL(/\/more\/?$/);
      }
      await expect(page.getByRole('main').getByRole('link', { name: 'Receive', exact: true })).toHaveCount(0);
      await expect(page.getByRole('main').getByRole('button', { name: 'View connected account', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Open wallet profile', exact: true }).click();
      const receive = page.getByRole('dialog').getByRole('link', { name: 'Receive', exact: true });
      await expect(receive).toHaveAttribute('href', '/qr');
      await receive.click();
      await expect(page).toHaveURL(/\/qr\/?$/);
      await expect(page.getByRole('heading', { name: 'Receive', exact: true, level: 1 })).toBeVisible();
      await expect(page.getByText('Your wallet address', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copy address', exact: true })).toBeVisible();
      expect((await page.getByRole('main').innerText()).replace(/\s/g, '')).toContain('0x930f0000000000000000000000000000000098b9');
      if (viewport.width < 840) await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toHaveAttribute('data-active', 'true');
      else await expect(page.getByRole('link', { name: 'More', exact: true })).toHaveAttribute('aria-current', 'page');
      if (viewport.width < 840) await expect(page.locator('nav.mobile-tabbar [aria-current="page"]')).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Send assets' })).toHaveCount(0);
      await testInfo.attach(`receive-${viewport.width}`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
      await page.getByRole('link', { name: 'Go back', exact: true }).click();
      await expect(page).toHaveURL(/\/more\/?$/);
      await page.getByRole('main').getByRole('link', { name: /^History\b/ }).click();
      await expect(page).toHaveURL(/\/history\/?$/);
      await expect(page.getByRole('heading', { name: 'History', exact: true, level: 1 })).toBeVisible();
      if (viewport.width < 840) await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toHaveAttribute('data-active', 'true');
      else await expect(page.getByRole('link', { name: 'More', exact: true })).toHaveAttribute('aria-current', 'page');
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
