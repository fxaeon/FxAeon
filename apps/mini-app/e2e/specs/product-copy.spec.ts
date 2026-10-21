import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.describe('product copy and session visibility', () => {
  test.use({ telegram: false });

  test('root identifies the Portfolio app and its canonical domain', async ({ page, requests }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle('FxAeon · Your DeFi, in motion.');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\/fxaeon\.com\/?$/);
    await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test('portfolio omits the redundant protocol-state subtitle', async ({ page, requests }) => {
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
    await expect(page.getByText('Wallet assets and verified f(x) protocol state.', { exact: true })).toHaveCount(0);
    assertNoBackendRequests(requests);
  });

  test('routes keep one unanimated accessible title with the intended visible hierarchy', async ({ page, requests }) => {
    const titles = [
      ['/portfolio', 'Portfolio', false], ['/positions', 'Positions', true], ['/earn', 'Earn', false], ['/borrow', 'Borrow', false],
      ['/move', 'Move', false], ['/history', 'History', true], ['/more', 'More', true], ['/settings', 'Wallet & account', true],
    ] as const;
    for (const [route, title, visible] of titles) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      const heading = page.locator('main h1');
      await expect(heading).toHaveCount(1);
      await expect(heading).toHaveText(title);
      const isScreenReaderOnly = await heading.evaluate((element) => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          if (node.classList.contains('sr-only')) return true;
        }
        return false;
      });
      if (visible) {
        await expect(heading).toBeVisible();
        expect(isScreenReaderOnly, `${route} keeps its visible page heading`).toBe(false);
      } else {
        expect(isScreenReaderOnly, `${route} keeps its title in the screen-reader-only tree`).toBe(true);
      }
      expect(await heading.evaluate((element) => element.getAnimations().length), `${route} title is unanimated`).toBe(0);
      if (route === '/positions') await expect(page.getByRole('link', { name: 'Back to Trade', exact: true })).toHaveAttribute('href', '/trade');
    }

    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const tradeHeading = page.locator('.trade-page-heading h1');
    await expect(tradeHeading).toHaveText('Trade');
    await expect(tradeHeading).toBeVisible();
    expect(await tradeHeading.evaluate((element) => element.closest('.sr-only'))).toBeNull();
    assertNoBackendRequests(requests);
  });

  test('disconnected settings do not expose a session disconnect card', async ({ page, requests }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Wallet & account', exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: /^(Connect|Retry wallet provider)/ })).toBeVisible();
    await expect(page.getByText('Session', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /sign out|log out/i })).toHaveCount(0);
    assertNoBackendRequests(requests);
  });

  test.describe('connected browser wallet', () => {
    test.use({
      browserWallet: {
        address: '0x930f0000000000000000000000000000000098b9',
        initiallyConnected: true,
      },
    });

    test('connected settings preserve wallet controls and expose a reachable session exit', async ({ page, requests }) => {
      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      const account = page.getByRole('button', { name: /View connected account/ });
      await expect(account).toBeVisible();
      await account.click();
      const profile = page.getByRole('dialog');
      // An asynchronous balance error may add its own section heading.
      // Assert the wallet identity without matching those unrelated headings.
      await expect(profile.getByRole('heading', { level: 2, name: '0x930f…98b9', exact: true })).toBeVisible();
      await expect(profile.getByRole('link', { name: 'View on Etherscan' })).toHaveAttribute('href', /etherscan\.io\/address\/0x930f/i);
      await profile.getByRole('button', { name: 'Close wallet profile' }).click();
      const changeWallet = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Change wallet' }) });
      await changeWallet.locator('summary').click();
      await expect(changeWallet.getByRole('button', { name: 'Reconnect wallet', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Disconnect wallet', exact: true })).toBeVisible();
      assertNoBackendRequests(requests);
    });
  });
});
