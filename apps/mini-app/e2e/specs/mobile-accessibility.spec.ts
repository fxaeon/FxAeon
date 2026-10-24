import { expect, test, assertNoBackendRequests } from "../fixtures/test";
import type { Page } from "@playwright/test";

const ROUTES = ["/", "/login", "/portfolio", "/trade", "/positions", "/borrow", "/earn", "/move", "/more", "/settings", "/history", "/qr", "/docs", "/docs/guide", "/docs/sdk"];
const MOBILE_WIDTHS = [320, 360, 375, 390, 412, 430];
const CONTROLS = "button, [role=button], nav a";

/** Controls outside a scrollport or under fixed navigation must prove they
 * scroll fully into view. Actual content overlaps still fail immediately. */
async function expectReachableControls(page: Page, context: string, timeout = 10_000) {
  const scan = () => {
    const nodes = [...document.querySelectorAll<HTMLElement>("button, [role=button], nav a")];
    const fixedNavigation = (element: Element | null) => {
      const navigation = element?.closest('[data-fixed-navigation="true"]');
      return Boolean(navigation && getComputedStyle(navigation).position === 'fixed');
    };
    return nodes.flatMap((element, index) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];
      const inlineHelp = element.hasAttribute("data-info-help-trigger");
      const minimum = inlineHelp ? 24 : 44;
      const visible = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      // The app reserves the dock outside its nested content scrollport.
      // A DOM rectangle can be inside the window but clipped by that port;
      // hit-testing there returns the canvas, not necessarily the dock.
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor);
        const clipX = /^(auto|scroll|hidden|clip)$/.test(css.overflowX);
        const clipY = /^(auto|scroll|hidden|clip)$/.test(css.overflowY);
        if (!clipX && !clipY) continue;
        const box = ancestor.getBoundingClientRect();
        const left = box.left + ancestor.clientLeft;
        const top = box.top + ancestor.clientTop;
        if (clipX) { visible.left = Math.max(visible.left, left); visible.right = Math.min(visible.right, left + ancestor.clientWidth); }
        if (clipY) { visible.top = Math.max(visible.top, top); visible.bottom = Math.min(visible.bottom, top + ancestor.clientHeight); }
      }
      const fullyInView = rect.top >= visible.top && rect.bottom <= visible.bottom && rect.left >= visible.left && rect.right <= visible.right;
      const clipped = inlineHelp && !fullyInView;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const obscured = inlineHelp && fullyInView && (!hit || !element.contains(hit));
      const overlaps = inlineHelp ? nodes.filter(other => {
        if (other === element || element.contains(other) || other.contains(element)) return false;
        const box = other.getBoundingClientRect();
        const otherStyle = getComputedStyle(other);
        return otherStyle.display !== "none" && otherStyle.visibility !== "hidden"
          && Math.min(rect.right, box.right) - Math.max(rect.left, box.left) > 1
          && Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top) > 1;
      }) : [];
      return [{ index, label: element.getAttribute("aria-label"), text: element.innerText.trim().slice(0, 50),
        width: rect.width, height: rect.height, minimum, fullyInView, clipped, obscured,
        overlaps: overlaps.length > 0,
        contentOverlap: overlaps.some(other => !fixedNavigation(other)),
        contentObscured: obscured && !fixedNavigation(hit),
        navigationCovered: inlineHelp && ((obscured && fixedNavigation(hit)) || overlaps.some(fixedNavigation)) }];
    });
  };
  const controls = await page.locator(CONTROLS).elementHandles();
  const geometry = await page.evaluate(scan);
  const invalid = geometry.filter(row => row.width + .01 < row.minimum || row.height + .01 < row.minimum || row.contentOverlap || row.contentObscured);
  expect(invalid, `${context}: target sizes and content overlaps`).toEqual([]);
  for (const row of geometry.filter(value => value.navigationCovered || value.clipped)) {
    const control = controls[row.index];
    await control.evaluate(element => (element as Element).scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    await expect.poll(async () => {
      // Resolve the same element after scrolling, even if a status/retry
      // control was inserted elsewhere while the page settled.
      const index = await control.evaluate(element => [...document.querySelectorAll("button, [role=button], nav a")].indexOf(element as Element));
      const current = (await page.evaluate(scan)).find(value => value.index === index);
      return Boolean(current && current.width + .01 >= current.minimum && current.height + .01 >= current.minimum
        && current.fullyInView && !current.obscured && !current.overlaps);
    }, { timeout, message: `${context}: ${row.label ?? row.text} must scroll clear of clipping and fixed navigation and retain a reachable center` }).toBe(true);
  }
  await Promise.all(controls.map(control => control.dispose()));
}

test.describe("mobile web and Telegram accessibility contract", () => {
  test("fixed navigation coverage must recover by scrolling while real help overlaps and unreachable controls fail", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    const styles = '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:1400px}button{position:absolute;width:24px;height:24px;padding:0}nav{position:fixed;inset:auto 0 0;height:64px}nav button{position:static;width:100%;height:64px}</style>';
    const help = '<button data-info-help-trigger aria-label="About test" style="left:20px;top:810px">i</button>';
    const navigation = '<nav data-fixed-navigation="true"><button>Navigation</button></nav>';
    await page.setContent(styles + help + navigation);
    await expectReachableControls(page, 'recoverable fixed navigation');
    expect(await page.getByRole('button', { name: 'About test', exact: true }).evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThan(780);

    await page.setContent(styles + '<button data-info-help-trigger style="left:20px;top:20px">i</button><button data-info-help-trigger style="left:32px;top:20px">i</button>');
    await expect(expectReachableControls(page, 'real help overlap')).rejects.toThrow('content overlaps');

    await page.setContent(styles + '<style>html,body{min-height:0;height:100%;overflow:hidden}</style>' + help + navigation);
    await expect(expectReachableControls(page, 'unreachable fixed navigation', 500)).rejects.toThrow('must scroll clear');
  });

  test("a help control clipped into a pointer-transparent navigation gap must recover inside its nested scrollport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}#shell{height:844px;overflow:hidden}#scrollport{height:760px;overflow:auto}#content{position:relative;height:1400px}button{width:24px;height:24px;padding:0}#help{position:absolute;left:20px;top:766px}nav{position:fixed;inset:auto 0 0;height:84px;pointer-events:none}nav button{margin-top:32px;width:100%;height:52px;pointer-events:auto}</style><div id="shell"><main id="scrollport"><div id="content"><button id="help" data-info-help-trigger aria-label="About nested test">i</button></div></main></div><nav data-fixed-navigation="true"><button>Navigation</button></nav>');
    const help = page.getByRole('button', { name: 'About nested test', exact: true });
    expect(await help.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.top >= 760 && rect.bottom <= innerHeight && !element.contains(hit) && !hit?.closest('nav');
    })).toBe(true);
    await expectReachableControls(page, 'recoverable nested scrollport');
    expect(await help.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(760);

    await page.locator('#scrollport').evaluate(element => { element.scrollTop = 0; (element as HTMLElement).style.overflow = 'clip'; });
    await expect(expectReachableControls(page, 'unreachable nested clipping', 500)).rejects.toThrow('must scroll clear');
  });

  test("every official screen fits a narrow viewport, exposes a main landmark, and keeps controls reachable", async ({ page, requests }) => {
    // The matrix deliberately covers 90 route/viewport combinations. Keep a
    // generous ceiling for slower CI workers while each assertion retains its
    // normal locator timeout.
    test.setTimeout(180_000);
    for (const width of MOBILE_WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        // Next's client transition may retain the previous page as a hidden
        // tree for one frame; assert the single visible landmark.
        await expect(page.locator("main:visible"), `${route} main landmark at ${width}px`).toBeVisible();
        const geometry = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          content: document.documentElement.scrollWidth,
          lang: document.documentElement.lang,
        }));
        expect(geometry.content, `${route} must not overflow horizontally at ${width}px`).toBeLessThanOrEqual(geometry.viewport + 1);
        expect(geometry.lang).toMatch(/^[a-z]{2}(?:-[A-Z]{2})?$/);

        await expectReachableControls(page, `${route} at ${width}px`);
      }
    }
    assertNoBackendRequests(requests);
  });

  test("plain browser launch does not pretend to be a connected wallet", async ({ page, requests }) => {
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/Telegram|wallet|connect|unavailable|configure/i);
    await expect(page.locator("body")).not.toContainText(/0x[a-fA-F0-9]{40}/);
    assertNoBackendRequests(requests);
  });

  test("asset picker closes on browser Back and restores focus to its trigger", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    const trigger = page.getByRole("button", { name: "Input asset" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Input asset" });
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(/\/trade$/);
  });
});
