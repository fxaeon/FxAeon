import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.describe('short phone trade interactions', () => {
  test.use({ telegram: false });

  test('keeps the focused amount input reachable when the visual viewport shrinks', async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 720 });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const input = page.getByLabel('Amount in ETH', { exact: true });
    await expect(input).toBeEnabled();
    await input.focus();
    await expect(input).toBeFocused();

    // Approximate keyboard occlusion by shrinking the browser viewport. This
    // exercises layout/visualViewport geometry; Chromium does not show a real
    // mobile operating-system keyboard in this test.
    await page.setViewportSize({ width: 390, height: 420 });
    await expect(input).toBeFocused();
    const viewport = await page.evaluate(() => ({
      innerHeight: window.innerHeight,
      visualHeight: window.visualViewport?.height ?? window.innerHeight,
      visualTop: window.visualViewport?.offsetTop ?? 0,
    }));
    expect(viewport.visualHeight).toBeLessThanOrEqual(420);

    await input.scrollIntoViewIfNeeded();
    const inputBox = await input.evaluate((element) => element.getBoundingClientRect().toJSON());
    expect(inputBox.top).toBeGreaterThanOrEqual(viewport.visualTop - 1);
    expect(inputBox.bottom).toBeLessThanOrEqual(viewport.visualTop + viewport.visualHeight + 1);
    await expect(input).toBeFocused();

    const content = page.locator('.app-content-tabs');
    const action = page.locator('[data-trade-ticket] .reviewTrigger .button-primary').last();
    const nav = page.locator('nav.mobile-tabbar[aria-label="Primary navigation"]');
    await expect(action).toBeVisible();
    await expect(nav).toBeVisible();
    await action.scrollIntoViewIfNeeded();
    await expect(input).toBeFocused();
    const geometry = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      const content = document.querySelector<HTMLElement>('.app-content-tabs')!;
      const action = document.querySelector<HTMLElement>('[data-trade-ticket] .reviewTrigger .button-primary')!;
      const nav = document.querySelector<HTMLElement>('nav.mobile-tabbar[aria-label="Primary navigation"]')!;
      const a = action.getBoundingClientRect();
      const n = nav.getBoundingClientRect();
      return {
        rootOverflow: root.scrollHeight - root.clientHeight,
        bodyOverflow: body.scrollHeight - body.clientHeight,
        contentOverflow: content.scrollHeight - content.clientHeight,
        actionTop: a.top,
        actionBottom: a.bottom,
        navTop: n.top,
      };
    });
    expect(geometry.rootOverflow, 'the document root must not compete with the app content scroller').toBeLessThanOrEqual(1);
    expect(geometry.bodyOverflow, 'the body must not add a second page scroller').toBeLessThanOrEqual(1);
    expect(geometry.contentOverflow, 'the workspace content pane should own short-phone scrolling').toBeGreaterThan(0);
    expect(geometry.actionTop).toBeGreaterThanOrEqual(-1);
    expect(geometry.actionBottom, 'the primary action must sit above the fixed bottom navigation').toBeLessThanOrEqual(geometry.navTop + 1);
    assertNoBackendRequests(requests);
  });

  test('expands the chart in document flow while keeping market and asset choices separate', async ({ page, requests }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const marketSwitch = page.getByRole('radiogroup', { name: 'Market', exact: true });
    const assetPicker = page.getByRole('button', { name: 'Input asset' });
    const ticket = page.locator('[data-trade-ticket]');
    await expect(marketSwitch).toBeVisible();
    await expect(assetPicker).toBeVisible();
    expect(await marketSwitch.evaluate((element) => element.closest('.amount-control') !== null)).toBe(false);
    expect(await assetPicker.evaluate((element) => element.closest('.amount-control') !== null)).toBe(true);

    await marketSwitch.getByRole('radio', { name: 'BTC', exact: true }).click();
    const market = page.getByRole('region', { name: 'BTC market chart', exact: true });
    await expect(market).toBeVisible();
    await expect(marketSwitch.getByRole('radio', { name: 'BTC', exact: true })).toBeChecked();
    const input = page.getByLabel('Amount in WBTC', { exact: true });
    await expect(input).toBeEnabled();
    await input.fill('0.0125');

    await page.getByRole('button', { name: 'Show chart', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Hide chart', exact: true })).toBeVisible();
    await expect(market.locator('.market-chart-content')).toBeVisible();
    const chartBox = await market.boundingBox();
    const ticketBox = await ticket.boundingBox();
    expect(chartBox).not.toBeNull();
    expect(ticketBox).not.toBeNull();
    expect(ticketBox!.y).toBeGreaterThanOrEqual(chartBox!.y + chartBox!.height - 1);
    await expect(input).toHaveValue('0.0125');
    await expect(marketSwitch.getByRole('radio', { name: 'BTC', exact: true })).toBeChecked();
    await expect(assetPicker).toContainText('WBTC');
    assertNoBackendRequests(requests);
  });

  test('keeps the asset picker as one contained scroll surface over a locked page', async ({ page, requests }) => {
    await page.setViewportSize({ width: 320, height: 420 });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Input asset' }).click();
    const dialog = page.getByRole('dialog', { name: 'Input asset', exact: true });
    const list = dialog.getByRole('listbox', { name: 'Input asset options', exact: true });
    await expect(dialog).toBeVisible();
    await expect(list).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search assets', exact: true })).toBeFocused();
    const scrollState = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby]')!;
      const list = dialog.querySelector<HTMLElement>('[role="listbox"]')!;
      const dialogRect = dialog.getBoundingClientRect();
      const listStyle = getComputedStyle(list);
      const scrollables = [...dialog.querySelectorAll<HTMLElement>('*')].filter((element) => {
        const style = getComputedStyle(element);
        return /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
      });
      return {
        bodyLock: body.style.overflow,
        rootOverflow: root.scrollHeight - root.clientHeight,
        bodyOverflow: body.scrollHeight - body.clientHeight,
        dialogHeight: dialogRect.height,
        viewportHeight: window.innerHeight,
        listOverflow: list.scrollHeight - list.clientHeight,
        listOverflowY: listStyle.overflowY,
        scrollableCountInsideDialog: scrollables.length,
        soleScrollerIsList: scrollables.length === 1 && scrollables[0] === list,
      };
    });
    expect(scrollState.bodyLock).toBe('hidden');
    expect(scrollState.rootOverflow).toBeLessThanOrEqual(1);
    expect(scrollState.bodyOverflow).toBeLessThanOrEqual(1);
    expect(scrollState.dialogHeight).toBeLessThanOrEqual(scrollState.viewportHeight);
    expect(scrollState.listOverflowY).toBe('auto');
    expect(scrollState.listOverflow).toBeGreaterThan(0);
    expect(scrollState.scrollableCountInsideDialog).toBe(1);
    expect(scrollState.soleScrollerIsList).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    assertNoBackendRequests(requests);
  });
});


test.describe('shared amount shortcuts', () => {
  test.use({ telegram: false });
  for (const { route, labels } of [
    { route: '/trade', labels: ['25%', '50%', '75%', 'Max'] },
    { route: '/borrow', labels: ['25%', '50%', '75%', 'Max'] },
    { route: '/move', labels: ['25%', '50%', '75%', 'Max'] },
  ]) {
    test(`keeps the intended shortcuts visible on ${route} before balances load`, async ({ page }) => {
      await page.setViewportSize({ width: 393, height: 852 });
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      const shortcuts = page.getByRole('group', { name: /shortcuts$/ }).first();
      const buttons = shortcuts.getByRole('button');
      await expect(buttons).toHaveCount(labels.length);
      await expect(buttons).toHaveText(labels);
      for (const button of await buttons.all()) {
        await expect(button).toBeVisible();
        await expect(button).toBeDisabled();
      }
      expect(await page.getByRole('main').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    });
  }
  test('disconnected Earn shows disabled balance shortcuts in both forms', async ({ page }) => {
    await page.goto('/earn', { waitUntil: 'domcontentloaded' });
    for (const action of ['Deposit', 'Withdraw']) {
      await page.getByRole('radio', { name: action, exact: true }).click();
      const shortcuts = page.getByRole('group', { name: 'Amount shortcuts', exact: true });
      await expect(shortcuts).toBeVisible();
      await expect(shortcuts.getByRole('button')).toHaveText(['25%', '50%', '75%', 'Max']);
      for (const button of await shortcuts.getByRole('button').all()) await expect(button).toBeDisabled();
      await expect(page.getByRole('textbox', { name: /^Amount in / })).toBeEnabled();
      await expect(page.locator('.reviewTrigger').getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    }
  });
});
