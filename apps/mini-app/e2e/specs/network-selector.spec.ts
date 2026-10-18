import { test, expect } from '../fixtures/test';
import type { Page } from '@playwright/test';

const WALLET = '0x930f0000000000000000000000000000000098b9';

type WalletRequest = { method: string; params?: unknown[] };

async function switchRequests(page: Page): Promise<WalletRequest[]> {
  return page.evaluate(() => {
    const wallet = (window as typeof window & { __wallet?: { requests?: WalletRequest[] } }).__wallet;
    return wallet?.requests?.filter((request) => request.method === 'wallet_switchEthereumChain') ?? [];
  });
}

function selector(page: Page) {
  return page.locator('button.network-selector');
}

async function expectHeaderToFit(page: Page, width: number): Promise<void> {
  const header = page.locator('header.app-topbar');
  await expect(header).toBeVisible();
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const box = await header.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  const brand = await header.locator(':scope > a').boundingBox();
  const group = await page.getByRole('group', { name: 'Wallet and network controls' }).boundingBox();
  expect(brand).not.toBeNull();
  expect(group).not.toBeNull();
  expect(Math.abs((brand!.y + brand!.height / 2) - (group!.y + group!.height / 2))).toBeLessThan(5);
  for (const control of await header.locator('button').all()) {
    const target = await control.boundingBox();
    expect(target).not.toBeNull();
    expect(target!.height).toBeGreaterThanOrEqual(44);
  }
}

async function waitForConnectedNetwork(page: Page, network: 'Ethereum' | 'Base'): Promise<void> {
  // Browser-wallet discovery publishes readiness and chain state separately.
  // Wait for the selector's actual connected label before opening its menu so
  // hydration cannot race the option-enabled assertions below.
  await expect(page.locator('.network-selector-label')).toHaveText(network, { timeout: 15_000 });
}

async function chooseNetwork(page: Page, network: 'Ethereum' | 'Base'): Promise<void> {
  await page.getByRole('menu', { name: 'Choose wallet network' })
    .locator('button[data-network-option]')
    .filter({ hasText: network })
    .click();
}

test.describe('network selector', () => {
  test.use({
    telegram: false,
    browserWallet: { address: WALLET, initiallyConnected: true, chainId: '0x1' },
  });

  test('switches Ethereum and Base with exact EIP-1193 chain requests', async ({ page }) => {
    await page.goto('/portfolio');
    await waitForConnectedNetwork(page, 'Ethereum');
    const button = selector(page);
    const control = page.getByRole('group', { name: 'Wallet and network controls' });
    await expect(control).toBeVisible();
    await expect(control.getByRole('button', { name: 'Open wallet profile' })).toContainText('0x930f…98b9');
    await expect(button.locator('.network-selector-visual-label')).toHaveText('Ethereum');
    await expect(button).toHaveAttribute('aria-label', 'Change network, current Ethereum');
    await expect(button.locator('img[aria-label="Ethereum logo"]')).toBeVisible();
    await expect(button.locator('.network-selector-label')).toHaveClass(/sr-only/);
    await expect(button.locator('.network-selector-chevron')).toBeHidden();

    await button.click();
    await chooseNetwork(page, 'Base');
    await expect(button).toHaveAttribute('aria-label', 'Change network, current Base');
    await expect(button.locator('img[aria-label="Base logo"]')).toBeVisible();

    await button.click();
    await chooseNetwork(page, 'Ethereum');
    await expect(button).toHaveAttribute('aria-label', 'Change network, current Ethereum');

    await expect.poll(async () => switchRequests(page)).toEqual([
      { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] },
      { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] },
    ]);
  });

  test.describe('pending switch', () => {
    test.use({
      browserWallet: {
        address: WALLET,
        initiallyConnected: true,
        chainId: '0x1',
        switchChain: { manual: true },
      },
    });

    test('keeps the old chain visible while a switch is pending', async ({ page }) => {
      await page.goto('/portfolio');
      await waitForConnectedNetwork(page, 'Ethereum');
      const button = selector(page);
      await button.click();
      await page.getByRole('menu', { name: 'Choose wallet network' })
        .getByRole('menuitemradio', { name: 'Base', exact: true })
        .click();

      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('aria-label', 'Change network, current Switching to Base');
      await expect(page.getByRole('menu', { name: 'Choose wallet network' })
        .locator('button[data-network-option]')
        .filter({ hasText: 'Ethereum' }))
        .toHaveAttribute('aria-checked', 'true');
      await expect.poll(async () => page.evaluate(async () => window.ethereum?.request({ method: 'eth_chainId' }))).toBe('0x1');

      await page.evaluate(() => {
        (window as typeof window & { __wallet?: { releaseSwitch?: () => void } }).__wallet?.releaseSwitch?.();
      });
      await expect(button).toHaveAttribute('aria-label', 'Change network, current Base');
      await expect.poll(async () => page.evaluate(async () => window.ethereum?.request({ method: 'eth_chainId' }))).toBe('0x2105');
    });

    test('ignores a late switch completion after the account disconnects', async ({ page }) => {
      await page.goto('/portfolio');
      await waitForConnectedNetwork(page, 'Ethereum');
      const button = selector(page);
      await button.click();
      await chooseNetwork(page, 'Base');
      await expect(button).toBeDisabled();

      await page.evaluate(() => {
        const wallet = (window as typeof window & { __wallet?: { setAccounts?: (accounts: string[]) => void } }).__wallet;
        wallet?.setAccounts?.([]);
      });
      await expect(button).toHaveCount(0);
      await page.evaluate(() => {
        (window as typeof window & { __wallet?: { releaseSwitch?: () => void } }).__wallet?.releaseSwitch?.();
      });
      await expect(page.locator('.network-selector-error')).toHaveCount(0);
      await expect(button).toHaveCount(0);
    });
  });

  test.describe('rejection and provider mismatch', () => {
    test.use({
      browserWallet: {
        address: WALLET,
        initiallyConnected: true,
        chainId: '0x1',
        switchChain: { outcomes: ['reject', 'success'] },
      },
    });

    test('keeps the old chain after rejection and retries the requested chain', async ({ page }) => {
      await page.goto('/portfolio');
      await waitForConnectedNetwork(page, 'Ethereum');
      const button = selector(page);
      await button.click();
      await chooseNetwork(page, 'Base');

      const switchError = page.locator('.network-selector-error');
      await expect(switchError).toContainText('Switch failed.');
      await expect(button).toHaveAttribute('aria-label', 'Change network, current Ethereum');

      await switchError.getByRole('menuitem', { name: 'Retry', exact: true }).click();
      await expect(button).toHaveAttribute('aria-label', 'Change network, current Base');
      await expect.poll(async () => switchRequests(page)).toEqual([
        { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] },
        { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] },
      ]);
    });
  });

  test.describe('provider verification', () => {
    test.use({
      browserWallet: {
        address: WALLET,
        initiallyConnected: true,
        chainId: '0x1',
        switchChain: { outcomes: ['noop'] },
      },
    });

    test('does not show the target chain when the wallet reports a no-op success', async ({ page }) => {
      await page.goto('/portfolio');
      await waitForConnectedNetwork(page, 'Ethereum');
      const button = selector(page);
      await button.click();
      await chooseNetwork(page, 'Base');

      await expect(page.locator('.network-selector-error')).toContainText('Switch failed.');
      await expect(button).toHaveAttribute('aria-label', 'Change network, current Ethereum');
      await expect.poll(async () => switchRequests(page)).toEqual([
        { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] },
      ]);
    });
  });

  test.describe('route guard', () => {
    test.use({
      browserWallet: { address: WALLET, initiallyConnected: true, chainId: '0x2105' },
    });

    test('explains that Ethereum is required on Ethereum-only routes', async ({ page }) => {
      await page.goto('/trade');
      await waitForConnectedNetwork(page, 'Base');
      const button = selector(page);
      await expect(button).toHaveAttribute('aria-label', 'Switch to Ethereum');
      await expect(page.locator('.network-selector-notice')).toHaveText('Switch to Ethereum to continue.');

      await button.click();
      const menu = page.getByRole('menu', { name: 'Choose wallet network' });
      await expect(menu.locator('button[data-network-option]').filter({ hasText: 'Ethereum' })).toBeEnabled();
      await expect(menu.locator('button[data-network-option]').filter({ hasText: 'Base' })).toBeEnabled();
    });
  });
});

test.describe('network selector on a narrow viewport', () => {
  test.use({
    telegram: false,
    browserWallet: { address: WALLET, initiallyConnected: true, chainId: '0x1' },
  });

  test('keeps the menu inside a 320px viewport and returns focus on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/portfolio');
    await waitForConnectedNetwork(page, 'Ethereum');
    await expectHeaderToFit(page, 320);
    const button = selector(page);
    await button.click();
    const menu = page.getByRole('menu', { name: 'Choose wallet network' });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.y + box!.height).toBeLessThanOrEqual(568);
    await expect(menu.locator('button[data-network-option]').filter({ hasText: 'Ethereum' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await expectHeaderToFit(page, 390);
  });

  test('dismisses on browser Back without leaving the current route', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/portfolio');
    await waitForConnectedNetwork(page, 'Ethereum');
    const combinedControl = page.getByRole('group', { name: 'Wallet and network controls' });
    const combinedBox = await combinedControl.boundingBox();
    expect(combinedBox).not.toBeNull();
    expect(combinedBox!.x).toBeGreaterThanOrEqual(0);
    expect(combinedBox!.x + combinedBox!.width).toBeLessThanOrEqual(320);
    const button = selector(page);
    await button.click();
    const menu = page.getByRole('menu', { name: 'Choose wallet network' });
    await expect(menu).toBeVisible();

    await page.goBack();

    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(button).toBeFocused();
  });
});

test.describe('disconnected header wallet control', () => {
  test.use({ telegram: false, browserWallet: false });

  test('shows a compact Connect action without a disconnected network control', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/portfolio');
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      const control = page.getByRole('group', { name: 'Wallet and network controls' });
      await expect(control.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
      await expect(control.getByRole('button', { name: 'Connect wallet' })).toHaveText('Connect');
      await expectHeaderToFit(page, width);
      await expect(control.locator('.network-selector')).toHaveCount(0);
      expect((await control.boundingBox())!.width).toBeLessThanOrEqual(100);
    }
  });
});

test.describe('Telegram header sign-in', () => {
  test.use({ telegram: true, browserWallet: false });

  test('labels the Telegram entry Sign in without changing the browser entry', async ({ page }) => {
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const controls = page.getByRole('group', { name: 'Wallet and network controls' });
    await expect(controls.getByRole('button', { name: 'Sign in', exact: true })).toHaveText('Sign in');
    await expect(controls.getByRole('button', { name: 'Connect wallet', exact: true })).toHaveCount(0);
    await expect(controls.locator('.network-selector')).toHaveCount(0);
  });
});
