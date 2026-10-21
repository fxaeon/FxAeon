import { expect, test, assertNoBackendRequests } from "../fixtures/test";

test.describe("protocol form help and picker keyboard behavior", () => {
  test.use({ telegram: false });

  test("transaction settings explain slippage inline, save presets, and fit compact phones", async ({ page, requests }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("/trade", { waitUntil: "domcontentloaded" });

    const settings = page.getByRole("button", { name: /^Transaction settings,/ });
    await expect(settings).toBeVisible();
    await settings.click();
    const settingsPanel = page.getByRole("dialog", { name: "Transaction settings" });
    await expect(settingsPanel).toBeVisible();
    const ticketWidth = await page.locator(".trade-ticket").evaluate((element) => element.getBoundingClientRect().width);
    const panelGeometry = await settingsPanel.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
    }));
    expect(panelGeometry.width, "Trade settings must use the ticket width on mobile").toBeGreaterThan(ticketWidth - 32);
    expect(panelGeometry.left).toBeGreaterThanOrEqual(0);
    expect(panelGeometry.right).toBeLessThanOrEqual(320);

    // The transaction limit stays visible and describes the input. Optional
    // help explains terminology without hiding that essential consequence.
    const slippageInput = settingsPanel.getByRole("textbox", { name: "Slippage tolerance percentage", exact: true });
    await expect(slippageInput).toHaveValue("0.5");
    const helpId = await slippageInput.getAttribute("aria-describedby");
    expect(helpId).toBeTruthy();
    await expect(page.locator(`[id="${helpId}"]`)).toHaveText("Reverts if price moves beyond the displayed slippage limit before confirmation.");
    await expect(slippageInput).toHaveAccessibleDescription("Reverts if price moves beyond the displayed slippage limit before confirmation.");

    const helpTrigger = settingsPanel.getByRole("button", { name: "About Max slippage", exact: true });
    await expect(helpTrigger).toHaveAttribute("aria-expanded", "false");
    await helpTrigger.focus();
    await helpTrigger.press("Enter");
    const helpPanel = page.getByRole("dialog", { name: "Max slippage", exact: true });
    await expect(helpPanel).toBeVisible();
    await expect(helpPanel).toBeFocused();
    await expect(helpPanel).toHaveAttribute("aria-modal", "false");
    await expect(helpPanel).toHaveAccessibleDescription("The maximum adverse price movement allowed between quote and execution. Raising it permits a larger difference, without guaranteeing execution.");
    await expect(helpTrigger).toHaveAttribute("aria-expanded", "true");
    await expect(helpTrigger).toHaveAttribute("aria-controls", (await helpPanel.getAttribute("id"))!);
    const helpBounds = await helpPanel.boundingBox();
    expect(helpBounds!.x).toBeGreaterThanOrEqual(0);
    expect(helpBounds!.x + helpBounds!.width).toBeLessThanOrEqual(320);
    for (const control of [helpTrigger, helpPanel.getByRole("button", { name: "Close Max slippage help", exact: true })]) {
      const bounds = await control.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    // Escape dismisses the nested explanation, not its transaction settings.
    await page.keyboard.press("Escape");
    await expect(helpPanel).toHaveCount(0);
    await expect(helpTrigger).toBeFocused();
    await expect(helpTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(settingsPanel).toBeVisible();

    // Presets are 44px targets that save at once and update the gear's label.
    const presets = settingsPanel.getByRole("radiogroup", { name: "Max slippage" }).getByRole("radio");
    await expect(presets).toHaveCount(4);
    for (const box of await presets.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    await settingsPanel.getByRole("radio", { name: "1%", exact: true }).click();
    await expect(settings).toHaveAttribute("aria-label", "Transaction settings, 1% slippage");
    await expect(slippageInput).toHaveValue("1");
    await expect(settingsPanel.getByRole("radiogroup", { name: "Network speed" })).toHaveCount(0);
    await expect(settingsPanel.getByText('Confirm the network fee in your wallet before signing.')).toHaveCount(0);

    // Escape closes the panel and returns focus to the gear.
    await page.keyboard.press("Escape");
    await expect(settingsPanel).toBeHidden();
    await expect(settings).toBeFocused();
    assertNoBackendRequests(requests);
  });

  test("filtered token options keep a tabbable sequence and ArrowDown enters it", async ({ page, requests }) => {
    await page.goto("/trade", { waitUntil: "domcontentloaded" });

    const assetTrigger = page.getByLabel("Input asset");
    await assetTrigger.click();
    const search = page.getByRole("searchbox", { name: "Search assets", exact: true });
    const listbox = page.getByRole("listbox", { name: "Input asset options", exact: true });
    const options = listbox.getByRole("option");
    await expect(search).toBeFocused();

    const selectedInitial = listbox.getByRole("option", { name: / selected$/i });
    const selectedLabel = await selectedInitial.getAttribute("aria-label");
    const selectedSymbol = selectedLabel?.match(/^([^\s]+)/)?.[1] ?? "";
    expect(selectedSymbol).not.toBe("");
    // USDC is part of the rendered ETH-market input allow-list. Confirm it is
    // actually present before using it as the filtered result below.
    await expect(listbox.getByRole("option", { name: /^USDC\b/i })).toBeVisible();

    // The active value is absent from this filtered result. The first result
    // becomes the sole sequentially tabbable option.
    await search.fill("USDC");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveAccessibleName(/^USDC\b/i);
    await expect(listbox.getByRole("option", { name: / selected$/i })).toHaveCount(0);
    await expect(search).toBeFocused();
    expect(await options.evaluateAll((elements) => elements.map((element) => element.tabIndex))).toEqual([0]);
    await search.press("ArrowDown");
    await expect(options.first()).toBeFocused();

    // When the selected value is present, it retains tab stop priority while
    // the other filtered rows stay reachable through roving arrow focus.
    await search.fill(selectedSymbol);
    await expect(search).toBeFocused();
    const selected = listbox.getByRole("option", { name: / selected$/i });
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute("tabindex", "0");
    const tabIndexes = await options.evaluateAll((elements) => elements.map((element) => element.tabIndex));
    expect(tabIndexes.filter((tabIndex) => tabIndex === 0)).toHaveLength(1);
    expect(tabIndexes.filter((tabIndex) => tabIndex === -1)).toHaveLength(tabIndexes.length - 1);
    await search.press("ArrowDown");
    await expect(selected).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
    assertNoBackendRequests(requests);
  });
});
