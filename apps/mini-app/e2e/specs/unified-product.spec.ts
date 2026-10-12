import { test, expect, assertNoBackendRequests } from '../fixtures/test';

/** These checks exercise actual components, not a screenshot-only mockup. */
test.describe('unified product presentation', () => {
  test.use({ telegram: false });

  test('opening the mobile chart moves an intact ticket below the market', async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const ticket = page.locator('[data-trade-ticket]');
    const market = page.locator('[data-trade-market]');
    const amount = page.getByLabel('Amount in ETH', { exact: true });
    await expect(amount).toBeEnabled();
    await amount.fill('0.0025');
    const before = await ticket.boundingBox();
    expect(before).not.toBeNull();
    await page.getByRole('button', { name: /show chart/i }).click();
    await expect(page.getByRole('button', { name: /hide chart/i })).toBeVisible();
    await expect.poll(async () => {
      const a = await market.boundingBox();
      const b = await ticket.boundingBox();
      return Boolean(a && b && b.y >= a.y + a.height - 1 && b.y > before!.y + 100);
    }).toBe(true);
    await expect(amount).toHaveValue('0.0025');
    const expanded = await ticket.boundingBox();
    expect(expanded!.height).toBeGreaterThanOrEqual(before!.height - 2);
    await page.getByRole('button', { name: /hide chart/i }).click();
    await expect(amount).toHaveValue('0.0025');
    await expect.poll(async () => Math.abs((await ticket.boundingBox())!.y - before!.y)).toBeLessThanOrEqual(3);
    assertNoBackendRequests(requests);
  });

  for (const route of ['/trade', '/earn', '/borrow', '/move']) {
    test(`${route} has one shared amount surface without horizontal overflow`, async ({ page, requests }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      const field = page.locator('[data-amount-field="unified"]').first();
      await expect(field).toBeVisible();
      const input = field.locator('input');
      await expect(input).toBeEnabled();
      await input.fill('0.000608469184323854');
      await expect(input).toHaveValue('0.000608469184323854');
      const geometry = await field.evaluate((element) => {
        const input = element.querySelector('input')!;
        const usd = element.querySelector('[data-amount-usd]')!;
        const a = input.getBoundingClientRect();
        const b = usd.getBoundingClientRect();
        return { amountBottom: a.bottom, usdTop: b.top, inputWidth: a.width, overflow: element.scrollWidth - element.clientWidth };
      });
      expect(geometry.usdTop).toBeGreaterThanOrEqual(geometry.amountBottom - 1);
      expect(geometry.inputWidth).toBeGreaterThan(90);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      assertNoBackendRequests(requests);
    });
  }

  test('web slippage saves without gas quotes or losing saved gas and appearance preferences', async ({ page, requests }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('fxaeon.settings.v1')) localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ gasTier: 'fast', slippageBps: 50 }));
    });
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    const theme = page.getByRole('radiogroup', { name: 'Appearance theme' });
    await theme.getByRole('radio', { name: 'Light', exact: true }).click();
    await expect(theme.getByRole('radio', { name: 'Light', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radiogroup', { name: 'Gas speed', exact: true })).toHaveCount(0);
    const slippage = page.getByRole('radiogroup').filter({ has: page.getByRole('radio', { name: '0.1%', exact: true }) });
    await slippage.getByRole('radio', { name: '1%', exact: true }).click();
    await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
    const save = page.getByRole('button', { name: 'Save preferences', exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(slippage.getByRole('radio', { name: '1%', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radiogroup', { name: 'Gas speed', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fxaeon.settings.v1') || '{}').gasTier)).toBe('fast');
    await expect(theme.getByRole('radio', { name: 'Light', exact: true })).toHaveAttribute('aria-checked', 'true');
    expect(requests.all.filter((url) => new URL(url).pathname === '/api/gas')).toEqual([]);
    assertNoBackendRequests(requests);
  });

  test('saved slippage updates the open Trade form', async ({ page, requests }) => {
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const settings = page.getByRole('button', { name: /^Transaction settings,/ });
    await settings.click();
    const settingsPanel = page.getByRole('dialog', { name: 'Transaction settings' });
    await expect(settingsPanel).toBeVisible();
    const slippage = page.getByRole('textbox', { name: 'Slippage tolerance percentage', exact: true });
    await expect(slippage).toHaveValue('0.5');
    await page.evaluate(() => {
      window.localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ slippageBps: 100 }));
      window.dispatchEvent(new CustomEvent('fxaeon:settings-updated', { detail: { slippageBps: 100 } }));
    });
    await expect(settings).toHaveAttribute('aria-label', 'Transaction settings, 1% slippage');
    await expect(settingsPanel).toBeVisible();
    await expect(slippage).toHaveValue('1');
    await page.evaluate(() => {
      const value = JSON.stringify({ slippageBps: 200 });
      window.localStorage.setItem('fxaeon.settings.v1', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'fxaeon.settings.v1', newValue: value }));
    });
    await expect(settings).toHaveAttribute('aria-label', 'Transaction settings, 2% slippage');
    await expect(settingsPanel).toBeVisible();
    await expect(slippage).toHaveValue('2');
    assertNoBackendRequests(requests);
  });

  test('More distinguishes internal destinations from external resources', async ({ page, requests }) => {
    await page.goto('/more', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: /FxAeon docs/ })).toHaveAttribute('href', '/docs');
    const protocol = page.getByRole('link', { name: /^Protocol docs/ });
    await expect(protocol).toHaveAttribute('href', 'https://fxprotocol.gitbook.io/fx-docs');
    await expect(protocol).toHaveAttribute('target', '_blank');
    await expect(page.getByRole('button', { name: 'Disconnect wallet', exact: true })).toHaveCount(0);
    const appearance = page.getByRole('link', { name: /Appearance/ });
    await expect(appearance).toHaveAttribute('href', '/settings#appearance');
    assertNoBackendRequests(requests);
  });
});
