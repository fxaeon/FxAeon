import { test, expect, assertNoBackendRequests } from '../fixtures/test';

test.describe('transaction review wallet entry', () => {
  test.use({
    telegram: false,
    browserWallet: {
      address: '0x930f0000000000000000000000000000000098b9',
      initiallyConnected: false,
    },
  });

  // These are production ConnectWalletButton instances in the built app.
  // The provider harness has its own button and cannot catch a native-disabled
  // opener dropping focus before the real wallet dialog captures it.
  for (const entry of [
    { name: 'home header', route: '/', selector: '.app-topbar button[aria-label="Connect wallet"]' },
    { name: 'trade review', route: '/trade', selector: '.reviewTrigger button' },
    { name: 'move review', route: '/move', selector: '.reviewTrigger button' },
  ]) {
    for (const dismissal of ['Close', 'Escape', 'browser Back'] as const) {
      test(`${entry.name}: ${dismissal} returns focus to the real opener through repeated reopening`, async ({ page, requests }) => {
        await page.goto(entry.route, { waitUntil: 'domcontentloaded' });
        const trigger = page.locator(entry.selector);
        await expect(trigger).toHaveCount(1);
        await expect(trigger).toBeVisible({ timeout: 15_000 });
        await expect(trigger).toBeEnabled();
        const amount = page.getByLabel('Amount in ETH');
        if (entry.route === '/trade') await amount.fill('2.1');
        const originalUrl = page.url();
        const originalOverflow = await page.locator('body').evaluate((body) => body.style.overflow);
        const connectionRequests = () => page.evaluate(() => {
          const calls = (window as unknown as { __wallet: { requests: Array<{ method: string }> } }).__wallet.requests;
          return calls.filter((request) => request.method === 'eth_requestAccounts').length;
        });

        for (let opening = 0; opening < 2; opening += 1) {
          await trigger.click();
          const picker = page.getByRole('dialog', { name: 'Connect your wallet', exact: true });
          await expect(picker).toBeVisible();
          await expect(page.getByRole('dialog')).toHaveCount(1);
          await expect(trigger).toHaveAttribute('aria-busy', 'true');
          await expect(trigger).toHaveAttribute('aria-disabled', 'true');
          expect(await trigger.evaluate((button) => (button as HTMLButtonElement).disabled),
            'an opening ConnectWalletButton must remain natively focusable').toBe(false);
          // Programmatic duplicate clicks exercise the real synchronous guard
          // even though the overlay correctly prevents user pointer access.
          await trigger.evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
          await expect(page.getByRole('dialog')).toHaveCount(1);
          expect(await connectionRequests(), 'opening and repeated opener clicks must not request accounts').toBe(0);

          if (opening === 1) {
            await picker.getByRole('button', { name: 'Other wallets', exact: true }).click();
            await page.getByRole('button', { name: 'Back to wallets', exact: true }).click();
            await expect(picker.getByRole('button', { name: 'Other wallets', exact: true })).toBeFocused();
          }
          if (dismissal === 'Escape') await page.keyboard.press('Escape');
          else if (dismissal === 'browser Back') await page.goBack();
          else await picker.getByRole('button', { name: 'Close wallet selection', exact: true }).click();

          await expect(page.getByRole('dialog')).toHaveCount(0);
          await expect(trigger).toBeEnabled();
          await expect(trigger).not.toHaveAttribute('aria-busy', 'true');
          await expect(trigger).toBeFocused();
          await expect(page).toHaveURL(originalUrl);
          await expect.poll(() => page.locator('body').evaluate((body) => body.style.overflow)).toBe(originalOverflow);
          await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toHaveCount(0);
          if (entry.route === '/trade') await expect(amount).toHaveValue('2.1');
        }

        await trigger.click();
        const picker = page.getByRole('dialog', { name: 'Connect your wallet', exact: true });
        await expect(picker).toBeVisible();
        await picker.getByRole('button', { name: 'Other wallets', exact: true }).click();
        await page.getByRole('button', { name: 'Test wallet', exact: true }).evaluate((button) => {
          (button as HTMLButtonElement).click();
          (button as HTMLButtonElement).click();
        });
        await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible();
        await expect(picker).toHaveCount(0);
        await expect(page).toHaveURL(originalUrl);
        if (entry.route === '/trade') await expect(amount).toHaveValue('2.1');
        expect(await connectionRequests(), 'reopening and duplicate selection clicks must yield one explicit account request').toBe(1);
        assertNoBackendRequests(requests);
      });
    }
  }

  for (const route of ['/trade', '/move']) {
    test(`${route} keeps the review rail as the wallet entry`, async ({ page, requests }) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' });

      const main = page.getByRole('main');
      // The top bar owns the first matching button; the embedded review CTA
      // is the last and remains inside the route's action card.
      await expect(page.locator('.app-topbar').getByRole('button', { name: 'Connect wallet', exact: true }))
        .toBeVisible({ timeout: 15_000 });
      const walletEntries = page.getByRole('button', { name: 'Connect wallet', exact: true });
      await expect(walletEntries).toHaveCount(2);
      const reviewEntry = walletEntries.last();
      await expect(reviewEntry).toBeVisible();
      // The review rail owns this transition; no separate wallet card should
      // compete with it on a screen that already has an actionable review.
      await expect(main.locator('.wallet-connect-cta')).toHaveCount(0);

      await reviewEntry.click();
      await expect(page).toHaveURL(new RegExp(`${route}/?$`));
      const picker = page.getByRole('dialog', { name: 'Connect your wallet', exact: true });
      await expect(picker).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toHaveCount(0);
      await picker.getByRole('button', { name: 'Other wallets', exact: true }).click();
      await page.getByRole('button', { name: 'Test wallet', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible();
      assertNoBackendRequests(requests);
    });
  }

  test('successful header connection returns focus to the new wallet profile control', async ({ page, requests }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const header = page.locator('.app-topbar');
    const opener = header.getByRole('button', { name: 'Connect wallet', exact: true });
    await expect(opener).toBeVisible({ timeout: 15_000 });
    await opener.click();
    const picker = page.getByRole('dialog', { name: 'Connect your wallet', exact: true });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Other wallets', exact: true }).click();
    await page.getByRole('button', { name: 'Test wallet', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(opener).toHaveCount(0);
    const profile = header.getByRole('button', { name: 'Open wallet profile', exact: true });
    await expect(profile).toBeVisible();
    await expect(profile).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => {
      const wallet = (window as unknown as { __wallet: { requests: Array<{ method: string }> } }).__wallet;
      return wallet.requests.filter((request) => request.method === 'eth_requestAccounts').length;
    })).toBe(1);
    assertNoBackendRequests(requests);
  });

  test.describe('late browser discovery', () => {
    test.use({
      browserWallet: {
        address: '0x930f0000000000000000000000000000000098b9',
        initiallyConnected: false,
        manualInjection: true,
      },
    });

    test('keeps review intent while a late wallet becomes available for explicit selection', async ({ page, requests }) => {
      // Withhold both the legacy object and EIP-6963 announcement. Opening the
      // shared picker must remain usable before any provider has arrived.
      await page.goto('/trade', { waitUntil: 'domcontentloaded' });
      const reviewEntry = page.locator('.reviewTrigger').getByRole('button', { name: 'Connect wallet', exact: true });
      await expect(reviewEntry).toBeVisible();
      const amount = page.getByLabel('Amount in ETH');
      await amount.fill('2.1');
      await reviewEntry.click();
      const picker = page.getByRole('dialog', { name: 'Connect your wallet', exact: true });
      await expect(picker).toBeVisible();
      await expect(picker.getByRole('button', { name: 'Test wallet', exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => typeof window.ethereum)).toBe('undefined');
      const connectionRequests = () => page.evaluate(() => {
        const calls = (window as unknown as { __wallet: { requests: Array<{ method: string }> } }).__wallet.requests;
        return calls.filter((request) => request.method === 'eth_requestAccounts').length;
      });
      expect(await connectionRequests(), 'opening the picker must not request accounts').toBe(0);

      await page.evaluate(() => (window as unknown as { __wallet: { inject: () => void } }).__wallet.inject());
      // Unique detected providers are promoted into the main picker, including
      // arbitrary EIP-6963 wallets; discovery still grants no account authority.
      const detectedWallet = picker.getByRole('button', { name: 'Test wallet', exact: true });
      await expect(detectedWallet).toBeVisible();
      await expect(detectedWallet.locator('.wallet-provider-detected')).toHaveText('Detected');
      await expect(picker.locator('[data-wallet-id]').first()).toHaveAttribute('aria-label', 'Test wallet');
      await picker.getByRole('button', { name: 'Other wallets', exact: true }).click();
      const lateWallet = page.getByRole('button', { name: 'Test wallet', exact: true });
      await expect(lateWallet).toHaveCount(1);
      await expect(lateWallet).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toHaveCount(0);
      expect(await connectionRequests(), 'late discovery must not choose a wallet automatically').toBe(0);
      await lateWallet.click();
      await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(picker).toHaveCount(0);
      await expect(page).toHaveURL(/\/trade\/?$/);
      await expect(amount).toHaveValue('2.1');
      expect(await connectionRequests(), 'one explicit selection must issue exactly one provider connection request').toBe(1);
      assertNoBackendRequests(requests);
    });
  });
});
