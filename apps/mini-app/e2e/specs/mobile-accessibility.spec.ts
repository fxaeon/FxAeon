import { expect, test, assertNoBackendRequests } from "../fixtures/test";

const ROUTES = ["/", "/login", "/portfolio", "/trade", "/positions", "/borrow", "/earn", "/move", "/more", "/settings", "/history", "/qr", "/docs", "/docs/guide", "/docs/sdk"];
const MOBILE_WIDTHS = [320, 360, 375, 390, 412, 430];

test.describe("mobile web and Telegram accessibility contract", () => {
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

        const undersized = await page.locator("button, [role=button], nav a").evaluateAll((nodes) =>
          nodes.flatMap((node) => {
            const element = node as HTMLElement;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];
            return rect.width + 0.01 < 44 || rect.height + 0.01 < 44
              ? [{ text: element.innerText.trim().slice(0, 50), label: element.getAttribute("aria-label"), width: rect.width, height: rect.height }]
              : [];
          }),
        );
        expect(undersized, `${route} visible controls smaller than 44px at ${width}px`).toEqual([]);
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
