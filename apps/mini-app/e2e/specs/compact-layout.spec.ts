import { test, expect } from '../fixtures/test';

test.use({ telegram: false });

test('baseline forms keep their action above navigation and Move stays centered', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  for (const route of ['/trade', '/borrow', '/earn', '/move']) {
    await page.goto(route);
    const action = page.locator('.reviewTrigger .button-primary');
    await expect(action).toBeVisible();
    const bounds = await action.evaluate(element => {
      const main = document.querySelector('main')!;
      const nav = document.querySelector('nav.mobile-tabbar')!;
      const rect = element.getBoundingClientRect();
      return { bottom: rect.bottom, height: rect.height, navTop: nav.getBoundingClientRect().top, scroll: main.scrollTop };
    });
    expect(bounds.scroll, `${route} starts at the top`).toBe(0);
    // Transformed cards can report fractional-pixel rounding just below 48px.
    expect(bounds.height, `${route} primary CTA retains its 48px baseline`).toBeGreaterThanOrEqual(48 - 0.01);
    expect(bounds.bottom, `${route} action clears navigation`).toBeLessThanOrEqual(bounds.navTop - 4);
    if (route === '/borrow') await expect(page.getByRole('heading', { name: 'Borrow fxUSD', exact: true })).toHaveCount(0);
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
  await page.goto('/earn');
  await page.getByRole('radio', { name: 'Withdraw', exact: true }).click();
  const field = page.locator('[data-amount-field]');
  const geometry = await field.evaluate(element => {
    const label = element.querySelector('label')!.getBoundingClientRect();
    const shortcuts = element.querySelector('[role="group"]')!.getBoundingClientRect();
    return { labelRight: label.right, shortcutsLeft: shortcuts.left,
      buttons: [...element.querySelectorAll('[role="group"] button')].map(button => ({ w: button.getBoundingClientRect().width, h: button.getBoundingClientRect().height })) };
  });
  expect(geometry.labelRight).toBeLessThanOrEqual(geometry.shortcutsLeft);
  expect(geometry.buttons).toHaveLength(4);
  for (const button of geometry.buttons) { expect(button.w).toBeGreaterThanOrEqual(44); expect(button.h).toBeGreaterThanOrEqual(44); }
});

test('form review actions remain reachable with 200% text in every appearance theme', async ({ page }) => {
  // The static export has no wallet/RPC planner; this contract verifies honest
  // layout and reachability without claiming that the route quote is healthy.
  const routes = ['/trade', '/borrow', '/earn', '/move'];
  const themes = ['official', 'dark', 'light'] as const;
  await page.setViewportSize({ width: 393, height: 852 });

  async function chooseTheme(theme: typeof themes[number]) {
    const html = page.locator('html');
    for (let attempt = 0; attempt < themes.length; attempt += 1) {
      const current = await html.getAttribute('data-theme') ?? 'official';
      if (current === theme) return;
      const next = current === 'official' ? 'dark' : current === 'dark' ? 'light' : 'official';
      await page.getByRole('button', { name: `Switch to ${next} theme` }).click();
      await expect(html).toHaveAttribute('data-theme', next);
    }
    await expect(html).toHaveAttribute('data-theme', theme);
  }

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
    for (const theme of themes) {
      await page.goto(route);
      await expect(page.getByRole('button', { name: /Switch to .* theme/ })).toBeEnabled();
      await chooseTheme(theme);
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
  }
});
