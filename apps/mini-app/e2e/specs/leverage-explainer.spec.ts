import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.use({ telegram: false });

for (const width of [320, 390, 1280]) {
  test(`leverage examples fit ${width}px and follow the trade ticket's side`, async ({ page, requests }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const ticketSide = page.getByRole('radiogroup', { name: 'Position side' });
    const explanation = page.getByRole('region', { name: 'Where leverage comes from' });
    await explanation.scrollIntoViewIfNeeded();
    // The ticket's slider explains the chosen leverage live, so the examples
    // have no side switch of their own; they show the ticket's side.
    await expect(explanation.getByRole('radiogroup')).toHaveCount(0);
    await expect(explanation.getByText('Example', { exact: true })).toHaveCount(0);
    await expect(explanation).toContainText('67% minted fxUSD · 33% yours');
    const split = explanation.getByRole('list', { name: /Share of a position/ });
    const longHeight = (await split.boundingBox())!.height;
    await explanation.screenshot({ path: testInfo.outputPath('long-example.png') });

    await ticketSide.getByRole('radio', { name: 'Short' }).click();
    await expect(ticketSide.getByRole('radio', { name: 'Short' })).toBeChecked();
    await expect(explanation).toContainText('75% borrowed wstETH · 25% yours');
    await expect(explanation).not.toContainText('pool maximum');
    expect((await split.boundingBox())!.height, 'switching sides must not move the content below').toBe(longHeight);
    await explanation.screenshot({ path: testInfo.outputPath('short-example.png') });

    // The general steps and questions live in Docs, one in-app link away.
    const docs = explanation.getByRole('link', { name: 'How it works', exact: true });
    await expect(docs).toHaveAttribute('href', '/docs/guide/trade');
    expect((await docs.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const bounds = await explanation.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    assertNoBackendRequests(requests);
  });
}
