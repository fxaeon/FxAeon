import { expect, test, assertNoBackendRequests } from "../fixtures/test";
import type { Page } from "@playwright/test";

async function assertNoTopOverlay(page: Page) {
  const overlays = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("*"), (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (element.classList.contains("skip-link") || style.position !== "fixed" || rect.height === 0 || rect.width === 0) return null;
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0 || style.pointerEvents === "none") return null;
    return rect.top < 80 ? { tag: element.tagName, role: element.getAttribute("role"), className: element.className } : null;
  }).filter(Boolean));
  expect(overlays, "wallet connection must not leave an app-owned overlay under the host chrome").toEqual([]);
}

const APP_ROUTES = [
  "/",
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
] as const;

const DOCS_ROUTES = ["/docs", "/docs/guide", "/docs/sdk"] as const;

const OFFICIAL_ROUTES = [
  ...APP_ROUTES,
  ...DOCS_ROUTES,
] as const;

test.describe("official f(x) client routes", () => {
  for (const route of OFFICIAL_ROUTES) {
    test(`${route} loads without an FxAeon backend`, async ({ page, requests }) => {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main:visible")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${route.replace("/", "\\/")}(?:\\/)?$`));
      assertNoBackendRequests(requests);

      // With RPC and Privy deliberately omitted from this build, a route may
      // render an empty/unavailable state, but it must never invent market or
      // wallet numbers to make the screen look loaded.
      // An untouched amount input has a real zero notional independent of
      // prices. Exclude only that input hint; wallet/market values stay unknown.
      const pricedText = await page.locator('body').evaluate((body, route) => {
        const copy = body.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('script, style, template').forEach((node) => node.remove());
        // Product guide articles contain dollar-denominated teaching
        // examples; only live app surfaces indicate fabricated values.
        if (route.startsWith('/docs')) copy.querySelectorAll('main article').forEach((node) => node.remove());
        const sourceFields = Array.from(body.querySelectorAll('[data-amount-field]'));
        copy.querySelectorAll('[data-amount-field]').forEach((field, index) => {
          const input = sourceFields[index]?.querySelector('input');
          if (input && !input.value.trim()) field.querySelector('[data-amount-usd]')?.remove();
        });
        return copy.textContent;
      }, route);
      expect(pricedText).not.toMatch(/\$\s*\d/);
      await expect(page.locator("body")).not.toContainText(/5,240\.75|3,500(?:\.42)?|104,500/);
      await expect(page.locator("canvas")).toHaveCount(0);

      const registrations = await page.evaluate(async () =>
        "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
      );
      expect(registrations, "financial state must not be served from a service worker").toBe(0);
    });
  }
});

test.describe("browser entry", () => {
  test.use({ telegram: false });

  test("legacy Activity deep links resolve to the History workspace", async ({ page, requests }) => {
    await page.goto("/activity", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/history\/?$/);
    await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test("browser root presents the portfolio workspace", async ({ page, requests }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible();
    await expect(page.locator(".app-topbar").getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test("canonical root preserves Telegram payloads and query state", async ({ page, requests }) => {
    await page.goto("/?ref=telegram#tgWebAppData=query_id%3Dtest&tgWebAppVersion=8.0", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/?ref=telegram#tgWebAppData=query_id%3Dtest&tgWebAppVersion=8\.0$/);
    await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test("wallet entry stays on every app route", async ({ page, requests }) => {
    test.setTimeout(90_000);
    for (const route of APP_ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const walletControls = page.getByRole("group", { name: "Wallet and network controls", exact: true });
      const connect = walletControls.getByRole("button", { name: "Connect wallet", exact: true });
      // The header wallet control shows a loading status while its provider
      // initializes. Wait for the actual wallet entry instead of racing it at
      // domcontentloaded or accidentally selecting the network picker.
      await expect(connect).toBeEnabled({ timeout: 20_000 });
      await connect.click();
      await expect(page).toHaveURL(new RegExp(`${route.replace("/", "\\/")}(?:\\/)?$`));
      const picker = page.getByRole("dialog", { name: "Connect your wallet", exact: true });
      await expect(picker).toBeVisible();
      for (const name of ["MetaMask", "Base Wallet", "OKX", "Rabby", "Other wallets"]) {
        await expect(picker.getByRole("button", { name, exact: true })).toBeVisible();
      }
      await picker.getByRole("button", { name: "Close wallet selection", exact: true }).click();
      await expect(picker).toHaveCount(0);
      await expect(connect).toBeEnabled();
    }
    assertNoBackendRequests(requests);
  });

  test("documentation routes use their own header and link back to the app", async ({ page, requests }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const route of DOCS_ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("banner")).toBeVisible();
      const docsLinks = page.getByRole("navigation", { name: "FxAeon links", exact: true });
      await expect(docsLinks).toBeVisible();
      const openApp = docsLinks.getByRole("link", { name: /^Open app$/i });
      await expect(openApp).toBeVisible();
      await expect(openApp).toHaveAttribute("href", "/");
      await expect(page.locator(".app-topbar")).toHaveCount(0);
    }
    await page.getByRole("navigation", { name: "FxAeon links", exact: true })
      .getByRole("link", { name: /^Open app$/i }).click();
    await expect(page).toHaveURL(/\/$/);
    assertNoBackendRequests(requests);
  });
});

test.describe("Telegram bridge availability", () => {
  test.use({ telegram: false });

  test("a failed Telegram script cannot block the plain browser portfolio", async ({ page, requests }) => {
    await page.route("**/telegram-web-app.js", (route) => route.abort("failed"));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/?(?:#.*)?$/);
    await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 3_000 });
    assertNoBackendRequests(requests);
  });

  test("a Telegram launch remains usable when its bridge never arrives", async ({ page, requests }) => {
    await page.route("**/telegram-web-app.js", (route) => route.abort("failed"));
    await page.goto("/#tgWebAppData=query_id%3Dtest&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/?(?:#.*)?$/, { timeout: 5_000 });
    await expect(page.getByRole("heading", { name: /portfolio/i })).toBeVisible();
    await expect(page.locator(".app-topbar").getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Telegram bridge unavailable/i);
    assertNoBackendRequests(requests);
  });

  test("a Telegram protocol route uses the safe Telegram sign-in path", async ({ page, requests }) => {
    await page.route("**/telegram-web-app.js", (route) => route.abort("failed"));
    await page.goto("/portfolio#tgWebAppData=query_id%3Dtest&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /portfolio/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Telegram bridge unavailable/i);
    await page.locator(".app-topbar").getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/portfolio(?:#.*)?$/);
    await expect(page.locator("body")).not.toContainText(/sign-in is initializing|Telegram wallet sign-in is unavailable|No browser wallet detected/i);
    await expect(page.locator("body")).not.toContainText(/Telegram bridge unavailable/i);
    assertNoBackendRequests(requests);
  });
});

test.describe("Telegram browser recovery", () => {
  test.use({ telegram: true });

  test("uses the Telegram external-link bridge for browser recovery", async ({ page, requests }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const continueLink = page.getByRole("link", { name: "Continue in browser", exact: true });
    await expect(continueLink).toHaveAttribute("href", "https://fxaeon.com/");
    await continueLink.click();
    await expect(page).toHaveURL(/\/login\/?$/);
    const opened = await page.evaluate(() => (window as typeof window & { __tg?: { record?: Record<string, unknown[]> } }).__tg?.record?.openLink ?? []);
    expect(opened).toContain("https://fxaeon.com/");
    assertNoBackendRequests(requests);
  });
});

test.describe("Telegram connect CTA with an available bridge", () => {
  test.use({ telegram: true });

  test("uses the Telegram/Privy entry instead of injected-wallet discovery", async ({ page, requests }) => {
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await page.locator(".app-topbar").getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/portfolio\/?$/);
    await expect(page.locator("body")).not.toContainText(/sign-in is initializing|Telegram wallet sign-in is unavailable|No browser wallet detected/i);
    assertNoBackendRequests(requests);
  });
});

test.describe("plain browser wallet login", () => {
  test.use({ telegram: false });

  test("missing Privy configuration still offers a browser wallet entry", async ({ page, requests }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /connect your wallet/i })).toBeVisible();
    await expect(page.locator("main").getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
    await expect(page.getByText(/02\s*Wallet access|Connect once|A focused home for your Ethereum markets/i)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/wallet setup unavailable|wallet service unavailable|wallet controls are unavailable/i);
    await expect(page.locator("body")).not.toContainText(/private key|session signer|delegat(?:ed|ion)/i);
    assertNoBackendRequests(requests);
  });
});

test.describe("connected browser wallet flows", () => {
  test.use({
    telegram: false,
    browserWallet: {
      address: "0x930f0000000000000000000000000000000098b9",
      initiallyConnected: true,
    },
  });

  test("portfolio shows the selected account and honest balance state", async ({ page, requests }) => {
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /portfolio/i })).toBeVisible();
    await expect(page.getByText(/0x930f/i).first()).toBeVisible();
    await expect(page.getByText("Wallet balances", { exact: true })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('status', { name: /portfolio value/i })).toBeVisible();
    const breakdown = page.getByRole('region', { name: 'Portfolio balance', exact: true });
    await expect(breakdown.getByText(/^(Known )?wallet assets$/i)).toBeVisible();
  await expect(breakdown.getByText(/^(Known )?position value$/i)).toBeVisible();
    await expect(page.getByText('Verified units', { exact: true })).toHaveCount(0);
    await expect(page.getByText('0 assets', { exact: true })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/\$\s*\d/);
    await expect(page.locator("body")).not.toContainText("Transaction status");
    await assertNoTopOverlay(page);
    assertNoBackendRequests(requests);
  });

  test("wallet profile opens only on demand and exposes History", async ({ page, requests }) => {
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await assertNoTopOverlay(page);
    await page.getByRole("button", { name: "Open wallet profile" }).click();
    const profile = page.getByRole("dialog");
    await expect(profile).toBeVisible();
    await expect(profile).toHaveAccessibleName("Wallet 0x930f0000000000000000000000000000000098b9");
    await expect(profile.getByRole("heading", { level: 2 })).toHaveText("0x930f…98b9");
    await expect(profile.getByRole("status", { name: /wallet value/i })).toBeVisible();
    await expect(profile.getByRole("link", { name: "View on Etherscan" })).toHaveAttribute("href", /etherscan\.io\/address\/0x930f/i);
    await expect(profile.getByRole("link", { name: /History/ })).toBeVisible();
    await profile.getByRole("link", { name: /History/ }).click();
    await expect(page).toHaveURL(/\/history\/?$/);
    await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test("trade exposes the full official input set and rejects an empty leverage in all four position flows", async ({ page, requests }) => {
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    // Restoring the fixture's account starts a new wallet-scoped form session.
    // Establish this connected-flow precondition before interacting with it.
    await expect(page.getByRole("button", { name: "Open wallet profile" })).toBeVisible();
    const asset = page.getByLabel("Input asset");
    await asset.click();
    const picker = page.getByRole("listbox", { name: "Input asset options" });
    await expect(picker.getByRole("option")).toHaveCount(7);
    const search = page.getByRole("searchbox", { name: "Search assets" });
    await expect(search).toBeFocused();
    await search.fill("tether");
    await expect(picker.getByRole("option")).toHaveCount(1);
    await expect(picker.getByRole("option", { name: /^USDT/i })).toBeVisible();
    await search.fill("");
    for (const option of ["ETH", "WETH", "stETH", "wstETH", "USDC", "USDT", "fxUSD"]) {
      await expect(picker.getByRole("option", { name: new RegExp(`^${option}`) })).toBeVisible();
    }
    await picker.getByRole("option", { name: /^ETH\b.*\bselected$/i }).click();
    await page.getByRole("radio", { name: "BTC" }).click();
    await asset.click();
    const btcPicker = page.getByRole("listbox", { name: "Input asset options" });
    await expect(btcPicker.getByRole("option")).toHaveCount(4);
    await expect(btcPicker.getByRole("option", { name: /^WBTC\b.*\bselected$/i })).toBeVisible();
    await btcPicker.getByRole("option", { name: /^WBTC\b.*\bselected$/i }).click();
    await page.getByRole("radio", { name: "ETH" }).click();
    await page.getByRole("radiogroup", { name: "Position side" }).getByRole("radio", { name: "Short" }).click();
    await asset.click();
    await expect(page.getByRole("listbox", { name: "Input asset options" }).getByRole("option", { name: /^stETH/i })).toBeVisible();
    await page.getByRole("listbox", { name: "Input asset options" }).getByRole("option", { name: /^ETH\b.*\bselected$/i }).click();
    for (const flow of [
      { market: "ETH", side: "Long", label: "Target leverage", min: "1.1", max: "6.1" },
      { market: "ETH", side: "Short", label: "Target leverage", min: "0.1", max: "6" },
      { market: "BTC", side: "Long", label: "Target leverage", min: "1.1", max: "6.1" },
      { market: "BTC", side: "Short", label: "Target leverage", min: "0.1", max: "6" },
    ] as const) {
      await page.getByRole("radio", { name: flow.market, exact: true }).click();
      await page.getByRole("radiogroup", { name: "Position side" }).getByRole("radio", { name: flow.side, exact: true }).click();
      const leverage = page.getByRole("textbox", { name: flow.label, exact: true });
      const leverageSlider = page.getByRole("slider", { name: `${flow.label} slider`, exact: true });
      await expect(leverageSlider).toHaveAttribute("min", flow.min);
      await expect(leverageSlider).toHaveAttribute("max", flow.max);
      // An empty numeric draft must stay empty and invalid. In particular,
      // it must not silently regain the minimum leverage as a fallback.
      const reviewAction = page.locator(".reviewTrigger button");
      await leverage.fill("");
      await expect(leverage).toHaveValue("");
      await expect(leverage).toHaveAttribute("aria-invalid", "true");
      await expect(reviewAction).toBeDisabled();
      await leverage.blur();
      await expect(leverage).toHaveValue("");
      await expect(leverage).toHaveAttribute("aria-invalid", "true");
      await expect(reviewAction).toBeDisabled();
    }
    assertNoBackendRequests(requests);
  });

  test("skip link stays hidden while connected Trade remains fixed and remains keyboard accessible", async ({ page, requests }) => {
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Open wallet profile" })).toBeVisible();
    const skipLink = page.getByRole("link", { name: "Skip to main content", exact: true });
    const brandLink = page.getByRole("link", { name: "FxAeon portfolio", exact: true });
    const main = page.locator("#main-content");
    const assertSkipLinkHidden = async () => {
      // Off-screen translation alone is insufficient: the mobile compositor
      // must have neither a painted nor pointer-interactive resting overlay.
      await expect(skipLink).not.toBeFocused();
      await expect(skipLink).toHaveCSS("opacity", "0");
      await expect(skipLink).toHaveCSS("pointer-events", "none");
    };

    await assertSkipLinkHidden();
    // The shell keeps its header in place while the content region owns the
    // scroll. The connected fixture may render supporting content below the
    // ticket, so wait for that actual scroll boundary rather than assuming
    // either an immediate layout or a zero scroll range.
    const topbar = page.locator("header.app-topbar");
    const topbarTopBefore = await topbar.evaluate((element) => element.getBoundingClientRect().top);
    await expect.poll(() => main.evaluate((element) => element.scrollHeight - element.clientHeight), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await main.evaluate((element) => element.scrollTo({ top: 500 }));
    await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const topbarTopAfter = await topbar.evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.abs(topbarTopAfter - topbarTopBefore), "shell header must stay fixed while content scrolls").toBeLessThanOrEqual(1);
    await assertSkipLinkHidden();

    const asset = page.getByLabel("Input asset");
    await asset.click();
    await expect(page.getByRole("searchbox", { name: "Search assets" })).toBeFocused();
    await assertSkipLinkHidden();
    await page.getByRole("listbox", { name: "Input asset options" }).getByRole("option", { name: /^USDC/i }).click();
    await expect(asset).toContainText("USDC");
    await assertSkipLinkHidden();

    // Enter the skip link through real keyboard navigation from the next
    // focusable link, not a forced click on an otherwise invisible element.
    await brandLink.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toHaveCSS("opacity", "1");
    await expect(skipLink).toHaveCSS("pointer-events", "auto");
    await expect(skipLink).toBeInViewport();

    await page.keyboard.press("Tab");
    await expect(brandLink).toBeFocused();
    await assertSkipLinkHidden();

    await page.keyboard.press("Shift+Tab");
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toHaveAttribute("href", "#main-content");
    await page.keyboard.press("Enter");
    await expect(main).toBeFocused();
    await expect(page).toHaveURL(/\/trade\/?#main-content$/);
    await assertSkipLinkHidden();
    assertNoBackendRequests(requests);
  });

});

test.describe("market price context", () => {
  test.use({
    telegram: false,
    marketPrices: true,
    browserWallet: {
      address: "0x930f0000000000000000000000000000000098b9",
      initiallyConnected: true,
    },
  });

  test("shows market prices and input USD without confusing token prices with owned balances", async ({ page, requests }) => {
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    // Connected-wallet hydration keys the protocol session and remounts the
    // Trade subtree once the fixture account is restored. Wait for that
    // session boundary before interacting with the chart controls.
    await expect(page.getByRole("button", { name: "Open wallet profile" })).toBeVisible();
    await expect(page.getByText("$2,400.00", { exact: true }).first()).toBeVisible();
    const chartContent = page.locator(".market-chart-content");
    const showChart = page.getByRole("button", { name: "Show chart", exact: true });
    await expect(showChart).toHaveAttribute("aria-expanded", "false");
    await expect(showChart).toBeEnabled();
    await expect(chartContent).toBeHidden();
    await expect(showChart).toHaveAttribute("aria-controls", (await chartContent.getAttribute("id"))!);
    expect((await showChart.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await showChart.click();
    await expect(page.getByRole("button", { name: "Hide chart", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("img", { name: /^ETH 1D USD price chart/ })).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => page.locator(".market-chart-frame").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(170);
    const oneDay = page.getByRole("radio", { name: "1D" });
    await oneDay.focus();
    await oneDay.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "7D" })).toBeFocused();
    await expect(page.getByRole("img", { name: /^ETH 7D USD price chart/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("radio", { name: "BTC" }).click();
    await expect(page.getByRole("img", { name: /^BTC 7D USD price chart/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("radio", { name: "ETH" }).click();
    await page.getByRole("button", { name: "Hide chart", exact: true }).click();
    await expect(chartContent).toBeHidden();
    await expect(showChart).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Input asset")).toBeVisible();
    await page.getByLabel("Amount in ETH").fill("2");
    await expect(page.getByText("≈ $4,800.00", { exact: true })).toBeVisible();
    await page.getByLabel("Input asset").click();
    const ethOption = page.getByRole("listbox", { name: "Input asset options" }).getByRole("option", { name: /^ETH\b.*\bselected$/i });
    // This build has no RPC configured: a known token price is not evidence
    // of an owned balance, and must not appear as the wallet's USD worth.
    await expect(ethOption.locator('.missing-value')).toBeVisible();
    await expect(ethOption).not.toContainText(/unavailable/i);
    await expect(ethOption.getByText("$2,400.00", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    const slider = page.getByRole("slider", { name: "Target leverage slider" });
    await expect(slider).toBeVisible();
    await slider.fill("3");
    await expect(page.getByRole("textbox", { name: "Target leverage", exact: true })).toHaveValue("3");
    assertNoBackendRequests(requests);
  });

  test("shows the desktop chart by default and keeps its disclosure state correct across resizing", async ({ page, requests }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    const chartContent = page.locator(".market-chart-content");
    const toggle = page.locator(".market-chart-toggle");
    await expect(page.locator(".market-chart-panel")).toHaveAttribute("data-mobile-expanded", "true", { timeout: 15_000 });
    await expect(page.getByRole("img", { name: /^ETH 1D USD price chart/ })).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await page.setViewportSize({ width: 640, height: 844 });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText("Show chart");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(chartContent).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(chartContent).toBeVisible();

    await page.setViewportSize({ width: 768, height: 844 });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText("Hide chart");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(chartContent).toBeVisible();
    await page.setViewportSize({ width: 840, height: 844 });
    await expect(chartContent).toBeVisible();
    await expect(toggle).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(toggle).toHaveText("Hide chart");
    await toggle.click();
    await expect(chartContent).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(chartContent).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(chartContent).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    assertNoBackendRequests(requests);
  });

  test("scrubbing the chart reads the hovered bar in the header, then returns to the live price", async ({ page, requests }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    const panel = page.locator(".market-chart-panel");
    const chart = page.getByRole("img", { name: /^ETH 1D USD price chart/ });
    await expect(chart).toBeVisible({ timeout: 15_000 });
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5);
    await expect(panel).toHaveAttribute("data-scrubbing", "true");
    await expect(panel.locator("[data-scrub-price]")).toHaveText(/^\$[\d,]+\.\d{2}$/);
    await expect(panel.locator("[data-scrub-time] time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
    // Leaving the chart restores the live quote and its 24h change.
    await page.mouse.move(box.x + box.width / 2, Math.max(0, box.y - 160));
    await expect(panel).not.toHaveAttribute("data-scrubbing", "true");
    await expect(panel.locator(".market-chart-header")).toContainText(/% 24h/);
    assertNoBackendRequests(requests);
  });

  test("a long press scrubs the chart by touch, and lifting the finger returns to the live price", async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    const panel = page.locator(".market-chart-panel");
    await page.locator(".market-chart-toggle").click();
    const chart = page.getByRole("img", { name: /^ETH 1D USD price chart/ });
    await expect(chart).toBeVisible({ timeout: 15_000 });
    await chart.scrollIntoViewIfNeeded();
    const box = (await chart.boundingBox())!;
    const x = box.x + box.width * 0.4;
    const y = box.y + box.height * 0.5;
    const touch = await page.context().newCDPSession(page);
    // Holding still past the long-press delay makes the chart follow the finger instead of panning.
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await expect(panel).toHaveAttribute("data-scrubbing", "true");
    await expect(panel.locator("[data-scrub-price]")).toHaveText(/^\$[\d,]+\.\d{2}$/);
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 60, y }] });
    await expect(panel).toHaveAttribute("data-scrubbing", "true");
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(panel).not.toHaveAttribute("data-scrubbing", "true");
    await expect(panel.locator(".market-chart-header")).toContainText(/% 24h/);
    assertNoBackendRequests(requests);
  });

  test("keeps the top bar free of a duplicate market-price strip across every asset workspace", async ({ page, requests }) => {
    for (const route of ["/portfolio", "/positions", "/borrow", "/earn", "/move", "/more", "/settings", "/history", "/qr"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main:visible")).toBeVisible();
      await expect(page.getByRole("region", { name: "Market prices" })).toHaveCount(0);
    }
    assertNoBackendRequests(requests);
  });

  test.describe("disconnected portfolio state", () => {
    test.use({ telegram: false, browserWallet: false, marketPrices: false });

    test("preserves actions and markets without a value card", async ({ page, requests }) => {
      await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
      const main = page.getByRole("main");
      await expect(main.getByRole("button", { name: "Connect wallet", exact: true })).toHaveCount(0);
      await expect(page.locator(".app-topbar").getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toHaveCount(1);
      await expect(main.locator(".portfolio-value-metrics")).toHaveCount(0);
      await expect(main.getByText("Portfolio value", { exact: true })).toHaveCount(0);
      const actions = main.getByRole("region", { name: "Actions", exact: true });
      await expect(actions).toBeVisible();
      for (const label of ["Trade", "Earn", "Borrow"]) {
        await expect(actions.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
      const markets = main.getByRole("region", { name: "Markets", exact: true });
      await expect(markets).toBeVisible();
      await expect(markets.getByText("24h change", { exact: true })).toBeVisible();
      await expect(markets.getByText("ETH", { exact: true })).toBeVisible();
      await expect(markets.getByText("BTC", { exact: true })).toBeVisible();
      assertNoBackendRequests(requests);
    });
  });

  test("portfolio keeps positions and fxSAVE actions inline", async ({ page, requests }) => {
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    const positions = page.getByRole("region", { name: "Positions", exact: true });
    await expect(positions.getByRole("heading", { name: "Positions", exact: true })).toBeVisible();
    const actions = page.getByRole("region", { name: "Actions", exact: true });
    await expect(actions.getByRole("link", { name: "Trade", exact: true })).toHaveAttribute("href", "/trade");
    await expect(page.getByRole("region", { name: "Markets" }).getByText("24h change", { exact: true })).toBeVisible();
    const earnSection = page.locator('section[aria-labelledby="portfolio-earn-heading"]');
    if (await earnSection.count()) {
      await expect(earnSection.getByRole("heading", { name: "Savings", exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: /^fxSAVE View Earn$/ })).toHaveAttribute("href", "/earn");
    }
    // The no-RPC fixture cannot fabricate protocol positions. When a
    // canonical read returns one, the card and its Manage/Borrow/Close links
    // stay in this region; when it does not, the empty state is still valid.
    await expect(positions).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test("desktop portfolio sparklines stay inside their compact card frames", async ({ page, requests }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    const charts = page.locator('.portfolio-market-card .market-chart-compact');
    await expect(charts).toHaveCount(2);
    for (const chart of await charts.all()) {
      await expect(chart.getByRole('img')).toBeVisible();
      const geometry = await chart.evaluate((element) => ({
        chart: element.getBoundingClientRect().height,
        frame: element.parentElement!.getBoundingClientRect().height,
      }));
      expect(geometry.chart).toBeLessThanOrEqual(54);
      expect(geometry.chart).toBeLessThanOrEqual(geometry.frame);
    }
    assertNoBackendRequests(requests);
  });

  test("keeps a recent validated snapshot visible across a hard navigation when the feed retries", async ({ page, requests }) => {
    await page.unroute("https://coins.llama.fi/**");
    let calls = 0;
    await page.route("https://coins.llama.fi/**", async (route) => {
      calls += 1;
      if (calls > 1) return route.abort("failed");
      const encodedIds = new URL(route.request().url()).pathname.split("/prices/current/")[1] ?? "";
      const ids = decodeURIComponent(encodedIds).split(",").filter(Boolean);
      const timestamp = Math.floor(Date.now() / 1000);
      const coins = Object.fromEntries(ids.map((id) => {
        const normalised = id.toLowerCase();
        const price = normalised.includes("2260fac5e5542a773aa44fbcfedf7c193bc2c599")
          ? 104_000
          : normalised.includes("c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")
            ? 2_400
            : 1;
        return [id, { price, timestamp, confidence: 0.99 }];
      }));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ coins }) });
    });

    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "ETH market chart" }).getByText("$2,400.00", { exact: true })).toBeVisible();
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "Market prices" })).toHaveCount(0);
    const marketCard = page.getByRole("link", { name: "Trade ETH", exact: true });
    await expect(marketCard.getByText("$2,400.00", { exact: true })).toBeVisible();
    await expect.poll(() => calls).toBeGreaterThan(1);
    assertNoBackendRequests(requests);
  });
});

test("Earn stays focused on fxSAVE without cross-product navigation", async ({ page, requests }) => {
  await page.goto("/earn", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Earn", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "fxSAVE", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Borrow fxUSD", exact: true })).toHaveCount(0);
  assertNoBackendRequests(requests);
});

test.describe("browser wallet connection", () => {
  test.use({
    telegram: false,
    browserWallet: {
      address: "0x930f0000000000000000000000000000000098b9",
      initiallyConnected: false,
    },
  });

  test("browser users can connect an injected wallet without Telegram", async ({ page, requests }) => {
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await page.locator(".app-topbar").getByRole("button", { name: "Connect wallet", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Connect your wallet", exact: true });
    await expect(picker).toBeVisible();
    await expect(page.getByRole("button", { name: "Open wallet profile", exact: true })).toHaveCount(0);
    await picker.getByRole("button", { name: "Other wallets", exact: true }).click();
    await page.getByRole("button", { name: "Test wallet", exact: true }).click();
    await expect(page).toHaveURL(/\/portfolio\/?$/);
    await expect(page.getByRole("button", { name: "Open wallet profile", exact: true })).toBeVisible();
    await expect(page.getByText("0x930f0000000000000000000000000000000098b9", { exact: true })).toHaveCount(0);
    await assertNoTopOverlay(page);
    assertNoBackendRequests(requests);
  });

  test("Move keeps recipient editable and centralizes wallet connection in review", async ({ page, requests }) => {
    await page.goto("/move", { waitUntil: "domcontentloaded" });
    const recipient = page.getByText("Your wallet", { exact: true }).locator("xpath=../../..");
    // The recipient row is a status, not a second connect control.
    await expect(recipient.getByText("Not connected", { exact: true })).toBeVisible();
    await expect(recipient.getByText("Connect wallet", { exact: true })).toHaveCount(0);
    await expect(page.locator(".reviewTrigger").getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect wallet for recipient", exact: true })).toHaveCount(0);
    // The shortest phone layout keeps derived route metadata out of the first
    // frame so the recipient and review action remain immediately reachable.
    await expect(page.getByRole("region", { name: "Bridge route preview", exact: true })).toHaveCount(0);
    await assertNoTopOverlay(page);
    assertNoBackendRequests(requests);
  });

  test("mobile portfolio keeps both ETH and BTC markets in the overview", async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    const markets = page.getByRole('heading', { name: 'Markets', exact: true });
    await expect(markets).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trade ETH', exact: true })).toHaveAttribute('href', /\/trade\?market=ETH$/);
    await expect(page.getByRole('link', { name: 'Trade BTC', exact: true })).toHaveAttribute('href', /\/trade\?market=BTC$/);
    assertNoBackendRequests(requests);
  });
});

test.describe("dark appearance", () => {
  test.use({ telegram: false });

  test("renders dark before hydration and migrates saved light preferences", async ({ page, requests }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("fxaeon_theme_id_v2", "official");
      window.localStorage.setItem("fxaeon_theme_id", "light");
    });
    const response = await page.goto("/settings", { waitUntil: "domcontentloaded" });
    expect(await response!.text()).toMatch(/<html[^>]*data-theme="dark"/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("fxaeon_theme_id_v2"))).toBe("dark");
    await expect(page.getByRole("radiogroup", { name: "Appearance theme", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Switch to .* theme/ })).toHaveCount(0);
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".app-topbar").getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
    // Portfolio's sole header entry uses the text token. Check the contrasting
    // primary CTA on Earn now that Portfolio no longer duplicates it in main.
    await page.goto("/earn", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("main").getByRole("button", { name: "Connect wallet", exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    assertNoBackendRequests(requests);
  });
});

test.describe("Move and More compact surfaces", () => {
  test.use({ telegram: false });

  test("More exposes wallet/account destinations and docs without appearance choices", async ({ page, requests }) => {
    await page.goto("/more", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /History/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Receive/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Transaction settings/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Wallet & account", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Appearance/ })).toHaveCount(0);
    for (const redundantGroupTitle of ["Account", "Preferences", "f(x) Protocol", "Resources"]) {
      await expect(page.getByRole("heading", { name: redundantGroupTitle, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("link", { name: "FxAeon docs", exact: true })).toHaveAttribute("href", "/docs");
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Wallet & account", exact: true })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Appearance theme", exact: true })).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "Slippage tolerance" })).toHaveCount(0);
    assertNoBackendRequests(requests);
  });

  test("More and Settings fit narrow screens without clipping their account controls", async ({ page }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/more", { waitUntil: "domcontentloaded" });
      const more = page.getByRole("main");
      await expect(more.getByRole("heading", { name: "More", exact: true })).toBeVisible();
      await expect(more.getByRole("link", { name: /History/ })).toHaveCount(0);
      await expect(more.getByRole("link", { name: /Receive/ })).toHaveCount(0);
      await expect(more.getByRole("button", { name: /Transaction settings/ })).toBeVisible();
      await expect(more.getByRole("link", { name: "Wallet & account", exact: true })).toBeVisible();
      expect(await more.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

      await page.goto("/settings", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Wallet & account", exact: true })).toBeVisible();
      await expect(page.getByRole("radiogroup", { name: "Slippage tolerance" })).toHaveCount(0);
      await expect(page.getByRole("radiogroup", { name: "Appearance theme" })).toHaveCount(0);
      expect(await page.getByRole("main").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    }
  });

  test("Move keeps the bridge form focused on the supported asset flow", async ({ page, requests }) => {
    await page.goto("/move", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("main").getByRole("heading", { name: "Move", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Transfer", exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Send assets' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Receive assets' })).toBeVisible();
    await page.getByRole('button', { name: /Transaction settings/ }).click();
    const settings = page.getByRole('dialog', { name: 'Transaction settings' });
    await settings.getByRole('checkbox', { name: /Expert mode/ }).check();
    await expect(settings.getByLabel(/Ethereum OFT|Base OFT/).first()).toBeVisible();
    await settings.getByRole('button', { name: 'Close transaction settings' }).click();
    await expect(page.locator('.reviewTrigger').getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test("Move keeps raw input separate from quote-backed output", async ({ page, requests }) => {
    await page.goto("/move", { waitUntil: "domcontentloaded" });
    const amount = page.getByLabel("Amount in fxUSD");
    await amount.fill("not-a-number");
    await expect(page.getByText("Use digits and one decimal separator only.", { exact: true })).toBeVisible();
    await expect(page.getByText(/\b(?:Expected receive|ETA)\b/i)).toHaveCount(0);
    await amount.fill("1");
    await expect(page.getByText(/\b(?:Expected receive|ETA)\b/i)).toHaveCount(0);
    assertNoBackendRequests(requests);
  });
});

test("unknown routes render the scoped FxAeon recovery screen", async ({ page, requests }) => {
  const response = await page.goto("/outside-official-scope", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(404);
  await expect(page.locator("main:visible")).toBeVisible();
  await expect(page.locator("body")).toContainText(/outside FxAeon|That page is not available/i);
  await expect(page.getByRole("link", { name: /back to portfolio/i })).toBeVisible();
  assertNoBackendRequests(requests);
});
