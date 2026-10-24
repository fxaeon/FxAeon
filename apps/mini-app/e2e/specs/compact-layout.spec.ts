import { test, expect } from '../fixtures/test';
import { installRefinementGalleryFixtures } from '../fixtures/refinement-gallery';

test.use({ telegram: false });

test.describe('fixed dock clearance', () => {
  test.use({ browserWallet: { initiallyConnected: true }, marketPrices: true });

  test('Borrow settled unavailable limit and retry retain the initial action inside the scrollport', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await installRefinementGalleryFixtures(page);
    await page.goto('/borrow');
    await expect(page.getByRole('button', { name: 'Retry borrowing limit', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Live limit unavailable', { exact: true })).toBeVisible();
    const retry = await page.getByRole('button', { name: 'Retry borrowing limit', exact: true }).boundingBox();
    expect(retry!.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(async () => document.fonts.ready);
    const action = page.locator('.reviewTrigger .button-primary').first();
    const geometry = await action.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const main = document.querySelector<HTMLElement>('main.app-content-tabs:not([hidden])')!;
      const mainRect = main.getBoundingClientRect();
      const nav = document.querySelector('nav.mobile-tabbar')!.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 4);
      return { scrollTop: main.scrollTop, bottom: rect.bottom, height: rect.height,
        visibleBottom: Math.min(mainRect.bottom, nav.top), hit: hit === element || Boolean(hit && element.contains(hit)) };
    });
    expect(geometry.scrollTop).toBe(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.visibleBottom);
    expect(geometry.height).toBeGreaterThanOrEqual(48);
    expect(geometry.hit).toBe(true);
  });

  // Funded Earn's initial CTA geometry is enforced by capture_scenario_matrix
  // against its configured RPC build. This suite intentionally builds without
  // an RPC, so it cannot obtain the funded balance required by that case.

  test('connected forms keep focus and the complete action inside the scrollport above the dock', async ({ page }) => {
    for (const route of ['/trade', '/move', '/earn']) {
      await page.setViewportSize({ width: 390, height: 770 });
      await page.goto(route);
      await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible();
      const main = page.locator('main.app-content-tabs:visible');
      const nav = page.locator('nav.mobile-tabbar');
      const action = page.locator('.reviewTrigger .button-primary').first();
      const amount = main.locator('input[inputmode="decimal"]').first();
      await expect(amount).toBeVisible();
      await amount.focus();

      // A short viewport exercises the same shell resize used when browser
      // chrome or a keyboard reduces the available layout height. No wallet
      // action or native on-screen keyboard is invoked by this fixture.
      for (const height of [770, 500, 770]) {
        await page.setViewportSize({ width: 390, height });
        const navBox = await nav.boundingBox();
        expect(navBox).not.toBeNull();
        const mainBox = await main.boundingBox();
        expect(mainBox).not.toBeNull();
        expect(mainBox!.y + mainBox!.height, `${route} scrollport ends above navigation at ${height}px`)
          .toBeLessThanOrEqual(navBox!.y - 7);
        await expect(amount, `${route} resize preserves the focused draft field`).toBeFocused();
        await action.scrollIntoViewIfNeeded();
        const geometry = await action.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const mainRect = document.querySelector('main.app-content-tabs:not([hidden])')!.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return { top: rect.top, bottom: rect.bottom, height: rect.height, mainTop: mainRect.top,
            hit: hit === element || Boolean(hit && element.contains(hit)) };
        });
        expect(geometry.top).toBeGreaterThanOrEqual(geometry.mainTop - 1);
        expect(geometry.bottom).toBeLessThanOrEqual(mainBox!.y + mainBox!.height + 1);
        expect(geometry.height).toBeGreaterThanOrEqual(44);
        expect(geometry.hit, `${route} entire action remains clear of the dock`).toBe(true);
      }
    }
  });
});

test('baseline forms keep their action above navigation and Move stays centered', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  // Exercise the settled error shape, including Borrow's 44px retry row.
  // A loading-only capture can miss the later downward layout shift.
  await page.route('https://eth-mainnet.g.alchemy.com/**', route => route.abort('blockedbyclient'));
  for (const route of ['/trade', '/borrow', '/earn', '/move']) {
    await page.goto(route);
    if (route === '/borrow') {
      await expect(page.getByRole('button', { name: 'Retry borrowing limit', exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Live limit unavailable', { exact: true })).toBeVisible();
    }
    const action = page.locator('.reviewTrigger .button-primary');
    await expect(action).toBeVisible();
    const bounds = await action.evaluate(element => {
      const main = document.querySelector('main')!;
      const nav = document.querySelector('nav.mobile-tabbar')!;
      const rect = element.getBoundingClientRect();
      return { bottom: rect.bottom, height: rect.height, navTop: nav.getBoundingClientRect().top, mainBottom: main.getBoundingClientRect().bottom, scroll: main.scrollTop };
    });
    expect(bounds.scroll, `${route} starts at the top`).toBe(0);
    // Transformed cards can report fractional-pixel rounding just below 48px.
    expect(bounds.height, `${route} primary CTA retains its 48px baseline`).toBeGreaterThanOrEqual(48 - 0.01);
    expect(bounds.bottom, `${route} action clears navigation`).toBeLessThanOrEqual(bounds.navTop - 4);
    expect(bounds.bottom, `${route} initial action fits wholly inside the main scrollport`).toBeLessThanOrEqual(bounds.mainBottom);
    if (route === '/borrow') await expect(page.getByRole('heading', { name: 'Borrow fxUSD', exact: true })).toBeVisible();
    if (route === '/move') {
      const gaps = await page.locator('[data-flow-stage]').evaluate(card => {
        const rect = card.getBoundingClientRect();
        const stage = card.parentElement!.getBoundingClientRect();
        return { top: rect.top - stage.top, bottom: stage.bottom - rect.bottom };
      });
      expect(Math.abs(gaps.top - gaps.bottom)).toBeLessThanOrEqual(2);
    }
  }
});

test('amount shortcuts retain touch targets and never overlap the label', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  // Borrow keeps the shared geometry contract. Earn also keeps presets
  // visible before connection, disabled until a usable balance is known.
  await page.goto('/borrow');
  const field = page.locator('[data-amount-field]').first();
  await expect(field.getByRole('group', { name: 'Collateral shortcuts' })).toBeVisible();
  const geometry = await field.evaluate(element => {
    const label = element.querySelector('label')!.getBoundingClientRect();
    const shortcuts = element.querySelector('[role="group"]')!.getBoundingClientRect();
    return { labelRight: label.right, shortcutsLeft: shortcuts.left,
      buttons: [...element.querySelectorAll('[role="group"] button')].map(button => ({ w: button.getBoundingClientRect().width, h: button.getBoundingClientRect().height })) };
  });
  expect(geometry.labelRight).toBeLessThanOrEqual(geometry.shortcutsLeft);
  expect(geometry.buttons).toHaveLength(4);
  for (const button of geometry.buttons) { expect(button.w).toBeGreaterThanOrEqual(44); expect(button.h).toBeGreaterThanOrEqual(44); }

  await page.goto('/earn');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 770 });
    for (const mode of ['Deposit', 'Withdraw']) {
      await page.getByRole('radio', { name: mode, exact: true }).click();
      const presets = page.locator('[data-amount-field]').first().getByRole('group', { name: 'Amount shortcuts' });
      await expect(presets).toBeVisible();
      await expect(presets.getByRole('button')).toHaveCount(4);
      for (const name of ['25%', '50%', '75%', 'Max']) {
        const button = name === 'Max' ? presets.locator('button').last() : presets.getByRole('button', { name, exact: true });
        await expect(button).toBeDisabled();
        const box = await button.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      await expect(page.locator('[data-amount-field] input').first()).toHaveValue('');
    }
  }
});

test('form review actions remain reachable with 200% text in dark appearance', async ({ page }) => {
  // The static export has no wallet/RPC planner; this contract verifies honest
  // layout and reachability without claiming that the route quote is healthy.
  const routes = ['/trade', '/borrow', '/earn', '/move'];
  await page.setViewportSize({ width: 393, height: 852 });

  async function assertActionReachable(route: string, enlargedText: boolean) {
    const action = page.locator('.reviewTrigger .button-primary').first();
    await expect(action, `${route} must retain its review action`).toBeVisible();
    await action.scrollIntoViewIfNeeded();
    const geometry = await action.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const nav = document.querySelector<HTMLElement>('nav.mobile-tabbar[aria-label="Primary navigation"]');
      const navRect = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
      const root = document.scrollingElement ?? document.documentElement;
      return {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height,
        navTop: navRect?.top ?? null,
        receivesPointer: topmost === element || Boolean(topmost && element.contains(topmost)),
        documentWidth: Math.max(root.scrollWidth, document.body.scrollWidth),
        viewportWidth: root.clientWidth,
        appWidth: document.querySelector<HTMLElement>('.app-content')?.clientWidth ?? root.clientWidth,
        appScrollWidth: document.querySelector<HTMLElement>('.app-content')?.scrollWidth ?? root.scrollWidth,
        amountFields: Array.from(document.querySelectorAll<HTMLElement>('.app-content [data-amount-field]')).map((field) => {
          const surface = field.querySelector<HTMLElement>('.amount-control');
          const label = field.querySelector<HTMLElement>('label')?.getBoundingClientRect();
          const shortcuts = field.querySelector<HTMLElement>('[role="group"]')?.getBoundingClientRect();
          const surfaceRect = surface?.getBoundingClientRect();
          const usd = field.querySelector<HTMLElement>('[data-amount-usd]');
          return {
            fieldOverflow: field.scrollWidth > field.clientWidth + 1,
            surfaceOverflow: surface ? surface.scrollWidth > surface.clientWidth + 1 : false,
            usdOverflow: usd ? usd.scrollWidth > usd.clientWidth + 1 : false,
            labelOverlapsShortcuts: Boolean(label && shortcuts
              && label.right > shortcuts.left + 1 && label.left < shortcuts.right - 1
              && label.bottom > shortcuts.top + 1 && label.top < shortcuts.bottom - 1),
            shortcutsEscapeSurface: Boolean(shortcuts && surfaceRect && (shortcuts.left < surfaceRect.left + 1 || shortcuts.right > surfaceRect.right - 1)),
          };
        }),
      };
    });
    expect(geometry.documentWidth, `${route} must not overflow horizontally (${enlargedText ? '200% text' : 'default text'})`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.appScrollWidth, `${route} form content must not clip horizontally (${enlargedText ? '200% text' : 'default text'})`).toBeLessThanOrEqual(geometry.appWidth + 1);
    for (const field of geometry.amountFields) {
      expect(field.fieldOverflow, `${route} amount field must not clip horizontally (${enlargedText ? '200% text' : 'default text'})`).toBe(false);
      expect(field.surfaceOverflow, `${route} amount surface must not clip horizontally (${enlargedText ? '200% text' : 'default text'})`).toBe(false);
      expect(field.usdOverflow, `${route} balance metadata must not clip (${enlargedText ? '200% text' : 'default text'})`).toBe(false);
      expect(field.labelOverlapsShortcuts, `${route} amount label must not overlap shortcuts (${enlargedText ? '200% text' : 'default text'})`).toBe(false);
      expect(field.shortcutsEscapeSurface, `${route} amount shortcuts must stay within the amount surface (${enlargedText ? '200% text' : 'default text'})`).toBe(false);
    }
    expect(geometry.left, `${route} review action must fit the viewport`).toBeGreaterThanOrEqual(-1);
    expect(geometry.right, `${route} review action must fit the viewport`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.height, `${route} review action must remain a usable touch target`).toBeGreaterThanOrEqual(48);
    expect(geometry.top, `${route} review action must be reachable`).toBeGreaterThanOrEqual(-1);
    expect(geometry.receivesPointer, `${route} review action must not be covered`).toBe(true);
    if (geometry.navTop !== null) expect(geometry.bottom, `${route} review action must clear primary navigation`).toBeLessThanOrEqual(geometry.navTop + 1);
  }

  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await assertActionReachable(route, false);

    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>('body *')).flatMap((element) => {
        if (element.closest('svg')) return [];
        const hasDirectText = Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()));
        if (!hasDirectText && !element.matches('input, textarea, select')) return [];
        const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
        return Number.isFinite(fontSize) && fontSize > 0 ? [{ element, fontSize }] : [];
      });
      document.documentElement.style.fontSize = '200%';
      for (const { element, fontSize } of elements) element.style.setProperty('font-size', `${fontSize * 2}px`, 'important');
    });
    await assertActionReachable(route, true);
  }
});
