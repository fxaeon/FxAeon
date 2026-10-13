import { expect, test, assertNoBackendRequests } from "../fixtures/test";
import type { Locator, Page } from "@playwright/test";

const ROUTES = [
  "/",
  "/login",
  "/portfolio",
  "/trade",
  "/positions",
  "/borrow",
  "/earn",
  "/move",
  "/more",
  "/settings",
  "/history",
  "/qr",
  "/docs",
] as const;

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;
const CTA_ROUTES = new Set([
  "/",
  "/login",
  "/portfolio",
  "/trade",
  "/positions",
  "/borrow",
  "/earn",
  "/move",
  "/history",
  "/qr",
  "/settings",
]);
async function assertViewportGeometry(page: Page, route: string, viewport: { width: number; height: number }) {
  // Financial forms may need a vertical scroll on short phones. The contract
  // protects fit and reachability without forcing dense controls above the
  // fold, which made fields unusable at 320px.
  const geometry = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    const body = document.body;
    return {
      documentWidth: Math.max(root.scrollWidth, body?.scrollWidth ?? 0),
      viewportWidth: root.clientWidth,
    };
  });
  expect(geometry.documentWidth, `${route} must not overflow horizontally at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
}

async function assertReachableAction(page: Page, route: string, viewport: { width: number; height: number }, action: Locator) {
  await expect(action, `${route} must expose its next action at ${viewport.width}x${viewport.height}`).toBeVisible();
  await expect(action, `${route} next action must be enabled`).toBeEnabled();
  await action.scrollIntoViewIfNeeded();
  const geometry = await action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const nav = document.querySelector<HTMLElement>('nav.mobile-tabbar[aria-label="Primary navigation"]');
    const navRect = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      receivesPointer: topmost === element || Boolean(topmost && element.contains(topmost)),
      navTop: navRect?.top ?? null,
    };
  });
  expect(geometry.left, `${route} next action must fit horizontally`).toBeGreaterThanOrEqual(-1);
  expect(geometry.right, `${route} next action must fit horizontally`).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry.top, `${route} next action must be reachable`).toBeGreaterThanOrEqual(-1);
  expect(geometry.bottom, `${route} next action must be reachable`).toBeLessThanOrEqual(viewport.height + 1);
  expect(geometry.width, `${route} next action needs a 44px hit target`).toBeGreaterThanOrEqual(44);
  expect(geometry.height, `${route} next action needs a 44px hit target`).toBeGreaterThanOrEqual(44);
  expect(geometry.receivesPointer, `${route} next action must not be obscured`).toBe(true);
  if (geometry.navTop !== null) expect(geometry.bottom, `${route} next action must clear primary navigation`).toBeLessThanOrEqual(geometry.navTop + 1);
}

async function assertEnabledCtas(page: Page, route: string, viewport: { width: number; height: number }, options: { includeDisabled?: boolean } = {}) {
  const includeDisabled = options.includeDisabled ?? false;
  const ctaSelector = includeDisabled ? ".button-primary:visible" : ".button-primary:visible:not([disabled])";
  const ctas = page.locator(ctaSelector);
  const identities = await ctas.evaluateAll((elements) => elements.map((element, index) => ({
    index,
    text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
    ariaLabel: element.getAttribute('aria-label'),
  })));

  // Keep the initially enabled action in the contract even if wallet hydration
  // temporarily disables/remounts it. Match by its accessible text and its
  // occurrence among matching actions instead of a stale positional locator.
  for (const identity of identities) {
    const exactText = identity.text ? new RegExp(`^\\s*${identity.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) : null;
    const matching = exactText
      ? page.locator('.button-primary:visible').filter({ hasText: exactText })
      : page.locator(`.button-primary:visible[aria-label="${(identity.ariaLabel ?? '').replace(/"/g, '\\\\"')}"]`);
    const occurrence = identity.text
      ? identities.slice(0, identity.index).filter((candidate) => candidate.text === identity.text).length
      : 0;
    const action = matching.nth(occurrence);
    if (!includeDisabled) {
      await expect.poll(async () => {
        if (await matching.count() <= occurrence) return false;
        return action.evaluate((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true');
      }, { timeout: 15_000, message: `${route} CTA ${identity.index + 1} must remain available after wallet hydration` }).toBe(true);
    }

    let cta = action;
    await expect(cta, `${route} CTA ${identity.index + 1} must be visible at ${viewport.width}x${viewport.height}`).toBeVisible({ timeout: 3_000 });
    // Hydration and wallet-read state can replace the action rail between the
    // visibility assertion and the scroll. Re-resolve the locator at the
    // action point so a harmless React remount is not treated as geometry loss.
    let scrollError: unknown;
    let sample: { y: number; bottom: number; width: number; height: number; viewportBottom: number; mobileNavTop: number | null } | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await cta.scrollIntoViewIfNeeded({ timeout: 3_000 });
        sample = await cta.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const mobileNav = document.querySelector<HTMLElement>('nav.mobile-tabbar[aria-label="Primary navigation"]');
          const mobileNavRect = mobileNav && getComputedStyle(mobileNav).display !== 'none'
            ? mobileNav.getBoundingClientRect()
            : null;
          return {
            y: rect.y,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            viewportBottom: window.innerHeight,
            mobileNavTop: mobileNavRect?.top ?? null,
          };
        });
        scrollError = undefined;
        if (sample.y >= -1 && sample.bottom <= sample.viewportBottom + 1
          && (sample.mobileNavTop === null || sample.bottom <= sample.mobileNavTop + 1)) break;
      } catch (error) {
        if (!/not attached to the DOM|detached/i.test(String(error))) throw error;
        scrollError = error;
      }
      await page.waitForTimeout(100);
    }
    if (scrollError) throw scrollError;
    if (!sample) throw new Error(`${route} CTA ${identity.index + 1} did not produce a stable geometry sample`);
    cta = matching.nth(occurrence);
    expect(sample.width, `${route} CTA ${identity.index + 1} must have visible geometry`).toBeGreaterThan(0);
    expect(sample.height, `${route} CTA ${identity.index + 1} must have visible geometry`).toBeGreaterThan(0);
    expect(sample.y, `${route} CTA ${identity.index + 1} must be inside the viewport`).toBeGreaterThanOrEqual(-1);
    expect(sample.bottom, `${route} CTA ${identity.index + 1} must be inside the viewport`).toBeLessThanOrEqual(viewport.height + 1);

    await expect.poll(() => cta.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return topmost === element || Boolean(topmost && element.contains(topmost));
    }), { timeout: 5_000, message: `${route} CTA ${identity.index + 1} must not be obscured at ${viewport.width}x${viewport.height}` }).toBe(true);

    const mobileNav = page.locator('nav.mobile-tabbar[aria-label="Primary navigation"]:visible');
    if (await mobileNav.count()) {
      let navBox = await mobileNav.boundingBox();
      for (let attempt = 0; !navBox && attempt < 25; attempt += 1) {
        await page.waitForTimeout(100);
        navBox = await mobileNav.boundingBox();
      }
      expect(navBox).not.toBeNull();
      expect(sample.y + sample.height, `${route} CTA ${identity.index + 1} must clear primary nav`).toBeLessThanOrEqual(navBox!.y + 1);
    }
  }
}

test.describe("single-viewport route contract", () => {
  test.use({ telegram: false });

  test("public and disconnected routes keep horizontal fit and the next action reachable", async ({ page, requests }) => {
    test.setTimeout(360_000);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);

      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page.locator("main:visible"), `${route} main at ${viewport.width}px`).toBeVisible();

        const topbar = page.locator("header.app-topbar");
        if (CTA_ROUTES.has(route) && await topbar.count()) {
          await expect(topbar.getByRole("button", { name: "Connect wallet", exact: true }), `${route} disconnected wallet must finish hydration before CTA geometry`).toBeVisible({ timeout: 15_000 });
        }

        // Let client hydration and the optional market context settle before
        // asserting its deliberate absence in this compact route contract.
        await expect(page.locator("main:visible").first()).toBeVisible();
        await page.waitForTimeout(120);
        await expect(page.locator('[role="region"][aria-label="Market prices"]'), `${route} must not render a price strip`).toHaveCount(0);
        await expect(page.locator('.market-strip'), `${route} must not render a market strip class`).toHaveCount(0);

        await assertViewportGeometry(page, route, viewport);
        if (CTA_ROUTES.has(route)) {
          if (route === "/" || route === "/portfolio") {
            // The disconnected portfolio is the landing. Its real next
            // actions are the four links in the named QuickActions section;
            // the Connect wallet control remains covered by the topbar check.
            const actions = page.getByRole("region", { name: "Actions" });
            for (const label of ["Receive", "Trade", "Move", "Earn"]) {
              await assertReachableAction(page, route, viewport, actions.getByRole("link", { name: label, exact: true }));
            }
          } else if (route === "/settings") {
            // Settings' first disconnected action is AccountSummary's Connect
            // control, which has its own account-row style rather than the
            // product form's .button-primary class.
            await assertReachableAction(page, route, viewport, page.getByRole("button", { name: "Connect", exact: true }));
          } else {
            await expect(page.locator(".button-primary:visible:not([disabled])").first(), `${route} must expose an enabled primary/review action at ${viewport.width}x${viewport.height}`).toBeVisible();
            await assertEnabledCtas(page, route, viewport);
          }
        }
      }
    }

    assertNoBackendRequests(requests);
  });

  test("393px Move keeps the compact bridge ticket and review action above navigation", async ({ page }) => {
    const viewport = { width: 393, height: 852 } as const;
    await page.setViewportSize(viewport);
    await page.goto("/move", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-topbar").getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible({ timeout: 15_000 });

    const main = page.locator("main:visible");
    await expect(main.getByRole("heading", { name: "Move", exact: true })).toBeVisible();
    await expect(page.getByLabel("Amount in fxUSD")).toBeVisible();
    await expect(page.getByText("Recipient", { exact: true })).toBeVisible();
    await expect(page.locator('summary').filter({ hasText: 'Custom contracts' })).toBeVisible();
    const action = page.locator(".button-primary:visible").first();
    await expect(action).toBeVisible();

    const geometry = await action.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const nav = document.querySelector<HTMLElement>('nav.mobile-tabbar[aria-label="Primary navigation"]');
      const navRect = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect() : null;
      const root = document.scrollingElement ?? document.documentElement;
      return { top: rect.top, bottom: rect.bottom, height: rect.height, navTop: navRect?.top ?? window.innerHeight, documentWidth: Math.max(root.scrollWidth, document.body.scrollWidth), viewportWidth: root.clientWidth };
    });
    expect(geometry.top, "Move action should be visible without scrolling at 393x852").toBeGreaterThanOrEqual(-1);
    expect(geometry.bottom, "Move action should clear primary navigation without scrolling at 393x852").toBeLessThanOrEqual(geometry.navTop + 1);
    expect(geometry.height, "Move action should keep an accessible hit target").toBeGreaterThanOrEqual(44);
    expect(geometry.documentWidth, "Move must not overflow horizontally at 393px").toBeLessThanOrEqual(geometry.viewportWidth + 1);
  });

  test("mobile trade chart is a deliberate, explicit scroll exception", async ({ page }) => {
    test.setTimeout(60_000);
    const viewport = { width: 390, height: 844 } as const;
    await page.setViewportSize(viewport);
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main:visible")).toBeVisible();

    const toggle = page.locator(".market-chart-toggle:visible");
    await expect(toggle, "mobile trade must expose an explicit chart toggle").toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".market-chart-content:visible"), "collapsed mobile charts must not be rendered").toHaveCount(0);

    // The chart must remain cold until the user asks for it. Once expanded,
    // the route is intentionally permitted to scroll so the chart can retain
    // a useful height on small phones.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".market-chart-content:visible")).toBeVisible();

    const contentGeometry = await page.locator("main.app-content-tabs").evaluate((element: HTMLElement) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      horizontalOverflow: element.scrollWidth - element.clientWidth,
    }));
    // Expanded charts are the one product exception to the no-scroll fold:
    // keep the chart useful and let the shell content pane scroll when the
    // chart plus ticket cannot fit on a small phone. The document itself is
    // still locked by the app shell.
    expect(contentGeometry.scrollHeight).toBeGreaterThanOrEqual(contentGeometry.clientHeight);
    expect(contentGeometry.horizontalOverflow).toBeLessThanOrEqual(1);
  });

  test("320px Trade keeps controls usable and the review action reachable", async ({ page }) => {
    const viewport = { width: 320, height: 568 } as const;
    await page.setViewportSize(viewport);
    await page.goto("/trade", { waitUntil: "domcontentloaded" });

    const required = [
      page.getByRole("link", { name: "Positions", exact: true }),
      page.getByText("ETH / USD", { exact: true }),
      // The 24h slot shows its value, or a placeholder that says whether the feed is still connecting or has failed.
      page.locator('.market-chart-header').getByText(/% 24h$/).or(page.locator('.market-chart-header :is([aria-label="24 hour change loading"], [aria-label="24 hour change unavailable"])')).first(),
      page.getByRole("radio", { name: "ETH", exact: true }),
      page.getByRole("radio", { name: "BTC", exact: true }),
      page.getByRole("button", { name: "Show chart", exact: true }),
      page.getByRole("radiogroup", { name: "Position side" }).getByRole("radio", { name: "Long", exact: true }),
      page.getByText("Price rises", { exact: true }),
      page.getByText("Price falls", { exact: true }),
      page.getByLabel("Amount in ETH"),
      page.getByRole("button", { name: /Input asset/ }),
      page.getByLabel("Target leverage", { exact: true }),
      page.getByRole("button", { name: /^Transaction settings,/ }),
      page.getByRole("button", { name: "Connect wallet", exact: true }).last(),
    ];

    const nav = page.locator('nav.mobile-tabbar[aria-label="Primary navigation"]');
    await expect(nav, 'mobile navigation must be mounted before geometry checks').toBeVisible();
    await expect.poll(async () => nav.evaluate((element) => element.getBoundingClientRect().width), { timeout: 5_000 }).toBeGreaterThan(0);
    const navBox = await nav.evaluate((element) => element.getBoundingClientRect().toJSON());
    expect(navBox.width).toBeGreaterThan(0);
    expect(navBox.height).toBeGreaterThan(0);
    await expect(page.getByRole("radiogroup", { name: "Position side" }).getByRole("radio", { name: "Long", exact: true })).toBeChecked();
    for (const item of required) {
      await expect(item).toBeVisible();
      await item.scrollIntoViewIfNeeded();
      const box = await item.evaluate((element) => element.getBoundingClientRect().toJSON());
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.y).toBeGreaterThanOrEqual(-1);
      expect(box.y + box.height).toBeLessThanOrEqual(navBox.y + 1);
    }
    const amountTarget = await page.getByLabel("Amount in ETH").evaluate((element) => element.getBoundingClientRect().height);
    const sliderTarget = await page.getByRole("slider", { name: "Target leverage slider" }).evaluate((element) => element.getBoundingClientRect().height);
    expect(amountTarget, "amount input must retain a 44px hit target").toBeGreaterThanOrEqual(44);
    expect(sliderTarget, "leverage slider must retain a 44px hit target").toBeGreaterThanOrEqual(44);
    await assertViewportGeometry(page, "/trade", viewport);
    await assertEnabledCtas(page, "/trade", viewport);
  });

  test("279px Trade keeps the page header, market switch, side switch, and action usable", async ({ page }) => {
    const viewport = { width: 279, height: 650 } as const;
    await page.setViewportSize(viewport);
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main:visible")).toBeVisible();

    const topbar = page.locator("header.app-topbar");
    await expect(topbar).toBeVisible();
    await expect(topbar.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(topbar).toHaveCSS("display", "flex");
    await expect(topbar).toHaveCSS("flex-wrap", "nowrap");
    const headerGeometry = await topbar.evaluate((element) => {
      const brand = element.querySelector(":scope > a")?.getBoundingClientRect();
      const actions = element.querySelector(":scope > .app-topbar-actions")?.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        flexWrap: style.flexWrap,
        width: element.getBoundingClientRect().width,
        scrollWidth: element.scrollWidth,
        brand,
        actions,
      };
    });
    expect(headerGeometry.flexWrap, "App top bar must remain one row at 279px").toBe("nowrap");
    expect(headerGeometry.scrollWidth, "App top bar must not clip its controls").toBeLessThanOrEqual(headerGeometry.width + 1);
    expect(headerGeometry.brand).not.toBeNull();
    expect(headerGeometry.actions).not.toBeNull();
    expect(Math.min(headerGeometry.brand!.bottom, headerGeometry.actions!.bottom)
      - Math.max(headerGeometry.brand!.top, headerGeometry.actions!.top),
    "App brand and controls must share one row").toBeGreaterThan(0);
    const topbarActions = topbar.locator(".app-topbar-actions");
    await expect(topbarActions).toBeVisible();
    const topbarActionGeometry = await topbarActions.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      scrollWidth: element.scrollWidth,
    }));
    expect(topbarActionGeometry.scrollWidth, "App top bar actions must not overflow at 279px").toBeLessThanOrEqual(topbarActionGeometry.width + 1);

    const topbarControls = [
      topbar.getByRole("button", { name: /Choose a network|Change network|Switch to / }).first(),
      topbar.getByRole("button", { name: /Switch to (?:official|dark|light) theme/ }).first(),
      topbar.getByRole("button", { name: "Connect wallet", exact: true }).first(),
    ];
    for (const control of topbarControls) {
      await expect(control, "App top bar control must be visible at 279px").toBeVisible({ timeout: 15_000 });
      await expect(control, "App top bar control must be enabled at 279px").toBeEnabled();
      const geometry = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          receivesPointer: topmost === element || Boolean(topmost && element.contains(topmost)),
          tabIndex: (element as HTMLElement).tabIndex,
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(-1);
      expect(geometry.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(geometry.top).toBeGreaterThanOrEqual(-1);
      expect(geometry.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(geometry.width).toBeGreaterThanOrEqual(44);
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      expect(geometry.receivesPointer).toBe(true);
      expect(geometry.tabIndex).toBeGreaterThanOrEqual(0);
      await control.focus();
      await expect(control).toBeFocused();
    }

    const assertControls = async (group: Locator, label: string) => {
      await expect(group, `${label} control group must be visible`).toBeVisible();
      const controls = group.getByRole("radio");
      await expect(controls, `${label} controls must remain available`).toHaveCount(2);
      for (const control of await controls.all()) {
        await control.scrollIntoViewIfNeeded();
        const geometry = await control.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            receivesPointer: topmost === element || Boolean(topmost && element.contains(topmost)),
          };
        });
        expect(geometry.left, `${label} control must fit horizontally`).toBeGreaterThanOrEqual(-1);
        expect(geometry.right, `${label} control must fit horizontally`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
        expect(geometry.top, `${label} control must be reachable`).toBeGreaterThanOrEqual(-1);
        expect(geometry.bottom, `${label} control must be reachable`).toBeLessThanOrEqual(geometry.viewportHeight + 1);
        expect(geometry.width, `${label} control needs a 44px hit target`).toBeGreaterThanOrEqual(44);
        expect(geometry.height, `${label} control needs a 44px hit target`).toBeGreaterThanOrEqual(44);
        expect(geometry.receivesPointer, `${label} control must receive pointer input`).toBe(true);
      }
    };

    await assertControls(page.getByRole("radiogroup", { name: "Market", exact: true }), "Market");
    await assertControls(page.getByRole("radiogroup", { name: "Position side", exact: true }), "Position side");

    const action = page.getByRole("button", { name: "Connect wallet", exact: true }).last();
    await expect(action).toBeVisible();
    await action.scrollIntoViewIfNeeded();
    const actionGeometry = await action.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, receivesPointer: topmost === element || Boolean(topmost && element.contains(topmost)) };
    });
    expect(actionGeometry.left).toBeGreaterThanOrEqual(-1);
    expect(actionGeometry.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(actionGeometry.top).toBeGreaterThanOrEqual(-1);
    expect(actionGeometry.bottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(actionGeometry.width).toBeGreaterThanOrEqual(44);
    expect(actionGeometry.height).toBeGreaterThanOrEqual(44);
    expect(actionGeometry.receivesPointer).toBe(true);
    await assertViewportGeometry(page, "/trade", viewport);
  });

  test("320px Move and Borrow keep amount fields editable", async ({ page }) => {
    const viewport = { width: 320, height: 568 } as const;
    await page.setViewportSize(viewport);

    await page.goto("/move", { waitUntil: "domcontentloaded" });
    const moveAmount = page.getByLabel("Amount in fxUSD");
    await expect(moveAmount).toBeVisible();
    await expect.poll(() => page.locator('input[aria-label="Amount in fxUSD"]:visible').first().evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(120);

    await page.goto("/borrow", { waitUntil: "domcontentloaded" });
    const collateral = page.getByLabel("Collateral in ETH", { exact: true });
    const debt = page.getByLabel("fxUSD to borrow in fxUSD");
    await expect(collateral).toBeVisible();
    await expect(debt).toBeVisible();
    await expect.poll(() => page.locator('input[aria-label="Collateral in ETH"]:visible').first().evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(120);
    await expect.poll(() => page.locator('input[aria-label="fxUSD to borrow in fxUSD"]:visible').first().evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(120);
    await assertViewportGeometry(page, "/borrow", viewport);
  });

  test("short 390px screens keep financial actions reachable after scrolling", async ({ page }) => {
    const viewport = { width: 390, height: 500 } as const;
    await page.setViewportSize(viewport);
    for (const route of ["/trade", "/borrow", "/earn", "/move"] as const) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main:visible"), `${route} main at short 390px`).toBeVisible();
      await page.waitForTimeout(120);
      await assertViewportGeometry(page, route, viewport);
      await expect(page.locator(".button-primary:visible:not([disabled])").first(), `${route} must expose an action at 390x500`).toBeVisible();
      await assertEnabledCtas(page, route, viewport);
    }
  });

  test.describe("connected browser route states", () => {
    test.use({ browserWallet: { address: "0x930f0000000000000000000000000000000098b9", initiallyConnected: true } });

    test("connected Trade keeps its compact ticket action above navigation at 393x852", async ({ page }) => {
      const viewport = { width: 393, height: 852 } as const;
      await page.setViewportSize(viewport);
      await page.goto("/trade", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "Open wallet profile", exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "Show chart", exact: true })).toHaveAttribute("aria-expanded", "false");

      const label = page.getByText("Target leverage", { exact: true });
      const numeric = page.getByLabel("Target leverage", { exact: true });
      const slider = page.getByRole("slider", { name: "Target leverage slider" });
      await expect(label).toBeVisible();
      await expect(numeric).toBeVisible();
      await expect(slider).toBeVisible();
      const numericBox = await numeric.boundingBox();
      expect(numericBox, "Trade leverage numeric input must have rendered geometry").not.toBeNull();
      const leverageGeometry = await page.locator(".trade-ticket").evaluate((ticket) => {
        const labelElement = Array.from(ticket.querySelectorAll("label"))
          .find((element) => element.textContent?.trim() === "Target leverage");
        const sliderElement = ticket.querySelector('[aria-label="Target leverage slider"]');
        if (!labelElement || !sliderElement) throw new Error("Trade leverage caption and slider must be mounted");
        const labelRect = labelElement.getBoundingClientRect();
        const sliderRect = sliderElement.getBoundingClientRect();
        return {
          ticketWidth: ticket.getBoundingClientRect().width,
          label: { top: labelRect.top, bottom: labelRect.bottom },
          sliderWidth: sliderRect.width,
          sliderHeight: sliderRect.height,
        };
      });
      // The numeric control sits beside its caption, while the range control
      // spans the ticket below it and remains a 44px touch target.
      expect(Math.min(leverageGeometry.label.bottom, numericBox!.y + numericBox!.height)
        - Math.max(leverageGeometry.label.top, numericBox!.y)).toBeGreaterThan(0);
      expect(numericBox!.height, "Trade leverage numeric input must remain usable").toBeGreaterThanOrEqual(44);
      expect(leverageGeometry.sliderWidth).toBeGreaterThan(leverageGeometry.ticketWidth * 0.72);
      expect(leverageGeometry.sliderHeight).toBeGreaterThanOrEqual(44);

      const action = page.locator(".trade-ticket .reviewTrigger .button-primary").first();
      const nav = page.locator('nav.mobile-tabbar[aria-label="Primary navigation"]');
      await expect(action, "connected Trade's initial primary action must be visible without scrolling").toBeVisible();
      await expect(nav).toBeVisible();
      const geometry = await page.evaluate(() => {
        const actionElement = document.querySelector<HTMLElement>(".trade-ticket .reviewTrigger .button-primary");
        const navElement = document.querySelector<HTMLElement>('nav.mobile-tabbar[aria-label="Primary navigation"]');
        if (!actionElement || !navElement) throw new Error("Trade action and primary navigation must be mounted");
        const actionRect = actionElement.getBoundingClientRect();
        const navRect = navElement.getBoundingClientRect();
        return { actionBottom: actionRect.bottom, navTop: navRect.top, viewportHeight: window.innerHeight };
      });
      expect(geometry.actionBottom, "initial Trade action must clear the bottom navigation").toBeLessThanOrEqual(geometry.navTop + 1);
      expect(geometry.actionBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    });

    test("connected forms keep their supporting state inside the viewport contract", async ({ page, requests }) => {
      test.setTimeout(300_000);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const route of ["/portfolio", "/trade", "/positions", "/borrow", "/earn", "/move", "/more", "/settings", "/history", "/qr"] as const) {
          await page.goto(route, { waitUntil: "domcontentloaded" });
          await expect(page.locator("main:visible"), `${route} connected main at ${viewport.width}px`).toBeVisible();
          await expect(page.getByRole("button", { name: "Open wallet profile", exact: true }), `${route} connected wallet must finish hydration before CTA geometry`).toBeVisible({ timeout: 15_000 });
          // Connected feeds settle asynchronously; let the initial review
          // transition finish before sampling CTA geometry so a transient
          // enabled button cannot disappear mid-assertion.
          await page.waitForTimeout(500);
          await assertViewportGeometry(page, route, viewport);
          await assertEnabledCtas(page, route, viewport, { includeDisabled: true });
        }
      }
      assertNoBackendRequests(requests);
    });
  });
});
