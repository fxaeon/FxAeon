import { expect, test, assertNoBackendRequests } from '../fixtures/test';
import type { Locator } from '@playwright/test';

const WALLET = '0x930f0000000000000000000000000000000098b9';

async function expectReachable(control: Locator, viewportHeight: number) {
  await control.scrollIntoViewIfNeeded();
  const geometry = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom,
      left: rect.left, right: rect.right, viewportWidth: window.innerWidth,
      hit: target === element || Boolean(target && element.contains(target)) };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.top).toBeGreaterThanOrEqual(-1);
  expect(geometry.bottom).toBeLessThanOrEqual(viewportHeight + 1);
  expect(geometry.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.hit, 'The visible control must receive pointer input').toBe(true);
}

test.describe('implementation regressions', () => {
  test.use({ telegram: false });

  test.describe('connected desktop Portfolio', () => {
    test.use({ browserWallet: { address: WALLET, initiallyConnected: true } });
    test('keeps every internal action visible and clickable', async ({ page, requests }) => {
      for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
        const actions = page.getByRole('region', { name: 'Actions', exact: true });
        await expect(actions.getByRole('link')).toHaveCount(3);
        await expect(actions.getByRole('button')).toHaveCount(1);
        for (const [label, href] of [['Send', '/send'], ['Receive', '/qr'], ['Trade', '/trade']] as const) {
          const action = actions.getByRole('link', { name: label, exact: true });
          await expect(action).toBeVisible();
          await expectReachable(action, viewport.height);
          await expect(action).toHaveAttribute('href', href);
          await action.click();
          await expect(page).toHaveURL(new RegExp(`${href.replace('/', '\\/')}(?:\\/)?$`));
          await page.goBack({ waitUntil: 'domcontentloaded' });
        }
        const more = actions.getByRole('button', { name: 'More', exact: true });
        for (const [label, href] of [['Earn', '/earn'], ['Borrow', '/borrow'], ['Move', '/move']] as const) {
          await expect(more).toHaveAttribute('aria-expanded', 'false');
          await expectReachable(more, viewport.height);
          await more.click();
          await expect(more).toHaveAttribute('aria-expanded', 'true');
          const dialog = page.getByRole('dialog', { name: 'More actions', exact: true });
          const action = dialog.getByRole('link', { name: label, exact: true });
          await expect(action).toHaveAttribute('href', href);
          await expectReachable(action, viewport.height);
          await action.click();
          await expect(page).toHaveURL(new RegExp(`${href.replace('/', '\\/')}(?:\\/)?$`));
          await page.goBack({ waitUntil: 'domcontentloaded' });
        }
        await more.click();
        const activity = page.getByRole('dialog', { name: 'More actions', exact: true }).getByRole('button', { name: 'Activity', exact: true });
        await expectReachable(activity, viewport.height);
        await activity.click();
        await expect(page.getByRole('dialog', { name: 'More actions', exact: true })).toHaveCount(0);
        await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toHaveAttribute('aria-selected', 'true');
      }
      assertNoBackendRequests(requests);
    });
  });

  test.describe('connected Portfolio history', () => {
    test.use({ browserWallet: { address: WALLET, initiallyConnected: true } });
    test('opens one useful history panel from Activity below the primary account summary', async ({ page, requests }) => {
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('tab', { name: 'Tokens', exact: true })).toHaveAttribute('aria-selected', 'true');
        const recent = page.locator('section[aria-label="Recent history"]');
        await expect(recent).toHaveCount(0);
        const activity = page.getByRole('tab', { name: 'Activity', exact: true });
        await expectReachable(activity, viewport.height);
        await activity.click();
        await expect(activity).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('tabpanel', { name: 'Activity', exact: true })).toBeVisible();
        await expect(recent).toHaveCount(1);
        await expect(recent).toBeVisible();
        await expect(recent.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
        const allHistory = recent.getByRole('link', { name: 'View all history', exact: true });
        await expect(allHistory).toHaveAttribute('href', '/history');
        await expectReachable(allHistory, viewport.height);
        await expect(page.locator('[data-portfolio-value]')).toBeVisible();
        if (viewport.width < 1000) {
          // Hydration can replace the skeleton between separate rect reads.
          // Sample both live regions in one frame and wait for visible layout.
          await expect.poll(() => page.evaluate(() => {
            const recent = document.querySelector('section[aria-label="Recent history"]')?.getBoundingClientRect();
            const value = document.querySelector('[data-portfolio-value]')?.getBoundingClientRect();
            return Boolean(recent && value && recent.height > 0 && value.height > 0 && recent.top > value.bottom);
          }), { message: 'Visible recent history stays below the account value' }).toBe(true);
        }
      }
      assertNoBackendRequests(requests);
    });
  });

  test.describe('connected Borrow', () => {
    test.use({ browserWallet: { address: WALLET, initiallyConnected: true } });
    test('never presents duplicate collateral inputs', async ({ page, requests }) => {
      await page.goto('/borrow', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('main')).toBeVisible();
      const input = page.locator('input[aria-label^="Collateral in "], input[aria-label^="Collateral to add in "]');
      await expect(input).toHaveCount(1);
      await expect(input).toBeVisible();
      await expect(page.getByRole('radio', { name: 'New position', exact: true })).toHaveAttribute('aria-checked', 'true');
      assertNoBackendRequests(requests);
    });
  });

  test.describe('connected More wallet controls', () => {
    test.use({ browserWallet: { address: WALLET, initiallyConnected: true } });
    test('exposes protocol resources and disconnects through the account drawer', async ({ page, requests }) => {
      await page.goto('/more', { waitUntil: 'domcontentloaded' });
      const resource = page.getByRole('link', { name: /^Protocol docs/ });
      await expect(resource).toBeVisible();
      await expect(resource).toHaveAttribute('href', 'https://fxprotocol.gitbook.io/fx-docs');
      await expect(resource).toHaveAttribute('target', '_blank');
      await expect(page.getByRole('button', { name: 'Disconnect wallet', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'View connected account', exact: true })).toHaveCount(0);
      await page.locator('header.app-topbar').getByRole('button', { name: 'Open wallet profile', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: /Wallet/ });
      await expect(drawer).toBeVisible();
      await drawer.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
      await expect(drawer).toHaveCount(0);
      await expect(page.locator('header').getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'View connected account', exact: true })).toHaveCount(0);
      await expect(page).toHaveURL(/\/more\/?$/);
      assertNoBackendRequests(requests);
    });
  });

  test('Docs collapses contents into a compact reading region on short phones', async ({ page, requests }) => {
    const viewport = { width: 390, height: 500 } as const;
    await page.setViewportSize(viewport);
    await page.goto('/docs/guide', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main:visible')).toBeVisible();
    const docsPage = page.locator('[class*="docsPage"]');
    const mainGeometry = await docsPage.evaluate((element) => ({
      width: element.getBoundingClientRect().width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
    }));
    expect(mainGeometry.scrollWidth).toBeLessThanOrEqual(mainGeometry.clientWidth + 1);
    expect(mainGeometry.width).toBeLessThanOrEqual(391);
    const docsNav = page.locator('nav[aria-label="Documentation sections"]');
    await expect(docsNav).toHaveAttribute('aria-busy', 'false');
    const navGeometry = await docsNav.evaluate((element) => ({ height: element.getBoundingClientRect().height }));
    expect(navGeometry.height, 'Compact contents must leave room for the guide').toBeLessThanOrEqual(100);
    const article = page.locator('article').first();
    await expect(article).toBeVisible();
    await expect(article.locator('header').first()).toBeVisible();
    await expect(article.getByRole('heading', { name: 'Product guide', exact: true })).toBeVisible();
    const helpGeometry = await article.locator('section#overview').evaluate((element) => {
      const heading = element.closest('article')?.querySelector('h1')?.getBoundingClientRect();
      const paragraph = element.closest('article')?.querySelector('header p[class*="lead"]')?.getBoundingClientRect();
      return { headingTop: heading?.top ?? Infinity, paragraphTop: paragraph?.top ?? Infinity, paragraphBottom: paragraph?.bottom ?? Infinity };
    });
    expect(helpGeometry.headingTop).toBeLessThan(viewport.height);
    expect(helpGeometry.paragraphTop).toBeLessThan(viewport.height);
    expect(helpGeometry.paragraphBottom).toBeLessThanOrEqual(viewport.height + 1);
    const contents = page.locator('details').filter({ has: page.getByText('Contents', { exact: true }) });
    await expect(contents).toHaveCount(1);
    await expect(contents).toHaveJSProperty('open', false);
    await page.getByRole('button', { name: 'Open documentation menu', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close documentation menu', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(contents).toHaveJSProperty('open', true);
    await expect(contents.getByRole('link')).toHaveCount(15);
    await expect(contents.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 500 });
    await page.goto('/docs/guide', { waitUntil: 'domcontentloaded' });
    const docsRail = page.locator('nav[aria-label="Documentation sections"]');
    await expect(docsRail).toHaveAttribute('aria-busy', 'false');
    const lastLink = docsRail.getByRole('link', { name: 'Troubleshooting', exact: true });
    await expect(lastLink).toBeVisible();
    await lastLink.scrollIntoViewIfNeeded();
    const railGeometry = await docsRail.evaluate((element) => {
      const rail = element.getBoundingClientRect();
      const link = element.querySelector('a[href="#troubleshooting"]')!.getBoundingClientRect();
      return { railTop: rail.top, railBottom: rail.bottom, linkTop: link.top, linkBottom: link.bottom };
    });
    expect(railGeometry.linkTop).toBeGreaterThanOrEqual(railGeometry.railTop - 1);
    expect(railGeometry.linkBottom).toBeLessThanOrEqual(railGeometry.railBottom + 1);
    assertNoBackendRequests(requests);
  });

  test('wallet controls preserve reachable browser connection', async ({ page, requests }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Wallet & account', exact: true })).toBeVisible();
    const connect = page.getByRole('main').getByRole('button', { name: /^(Connect|Retry wallet provider)/ });
    await expect(connect).toBeVisible();
    await expect(connect).toBeEnabled();
    await connect.click();
    await expect(page).toHaveURL(/\/settings\/?$/);
    assertNoBackendRequests(requests);
  });

  test.describe('connected wallet controls', () => {
    test.use({ browserWallet: { address: WALLET, initiallyConnected: true } });
    test('keeps wallet and session controls reachable on desktop and short phones', async ({ page, requests }) => {
      for (const viewport of [{ width: 390, height: 500 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        await page.goto('/settings', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: 'Wallet & account', exact: true })).toBeVisible();
        const changeWallet = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Change wallet' }) });
        await expect(changeWallet).toHaveCount(1);
        await expect(changeWallet).toHaveJSProperty('open', false);
        await changeWallet.locator('summary').click();
        await expect(changeWallet).toHaveJSProperty('open', true);
        await expect(changeWallet.getByRole('button').first()).toBeVisible();
        for (const control of [page.getByRole('button', { name: 'Disconnect wallet', exact: true })]) {
          await expect(control).toBeVisible();
          await expectReachable(control, viewport.height);
        }
      }
      assertNoBackendRequests(requests);
    });
  });
});
