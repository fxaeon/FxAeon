import { expect, test, assertNoBackendRequests } from "../fixtures/test";

test.describe("canonical app home", () => {
  test.use({ telegram: false });

  test("browser root renders the Portfolio workspace", async ({ page, requests }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".app-shell")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible();
    await expect(page.locator(".app-topbar").getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Your DeFi.*All in one place/ })).toHaveCount(0);
    assertNoBackendRequests(requests);
  });

  test("legacy portfolio links remain compatible", async ({ page, requests }) => {
    await page.goto("/portfolio?source=legacy#overview", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/portfolio\?source=legacy#overview$/);
    await expect(page.locator(".app-shell")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test("Telegram launch payload at root stays on the app home", async ({ page, requests }) => {
    await page.goto("/#tgWebAppData=query_id%3Dtest&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/#tgWebAppData=query_id%3Dtest&tgWebAppVersion=8\.0&tgWebAppPlatform=tdesktop$/);
    await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible();
    assertNoBackendRequests(requests);
  });
});
