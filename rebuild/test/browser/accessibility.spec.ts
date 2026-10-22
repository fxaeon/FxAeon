import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, fixture, connect, prepare, confirm, snapshot, noHorizontalOverflow } from './helpers';

async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map(violation => ({
    id: violation.id, impact: violation.impact, description: violation.help,
    nodes: violation.nodes.map(node => ({ target: node.target, failure: node.failureSummary })),
  }))).toEqual([]);
}

test('wallet keyboard focus is trapped, Escape restores the opener, and browser Back dismisses one overlay', async ({ page }) => {
  await fixture(page);
  const opener = page.getByRole('banner').getByRole('button', { name: 'Connect wallet', exact: true });
  await opener.focus();
  await opener.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Connect your wallet', exact: true });
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: /Injected browser wallet/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await accessible(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.press('Enter');
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Long Ethereum. Your terms.' })).toBeVisible();
  expect((await snapshot(page)).sends).toBe(0);
});

test('Escape closes an expanded review disclosure before the review and restores a usable editor', async ({ page }) => {
  await fixture(page);
  await connect(page);
  await prepare(page);
  const dialog = page.getByRole('dialog', { name: 'Review ETH long', exact: true });
  const details = dialog.locator('details').filter({ has: page.getByText('Transaction details', { exact: true }) });
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(dialog).toBeVisible();
  await expect(details.locator('summary')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.100000000000000001');
  expect((await snapshot(page)).sends).toBe(0);
});

test('closing the signing view preserves the original attempt and verified history without replay', async ({ page }) => {
  await fixture(page);
  await connect(page);
  await prepare(page, '0.1');
  await confirm(page);
  await expect(page.getByRole('dialog', { name: 'Confirm in your wallet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText('Opened ETH long', { exact: true })).toBeVisible();
  expect((await snapshot(page)).sends).toBe(1);
});

for (const theme of ['dark', 'light'] as const) {
  for (const width of [1280, 393, 320]) {
    test(`${theme} theme at ${width}px: trade and exact review pass axe and horizontal overflow checks`, async ({ page }) => {
      await page.setViewportSize({ width, height: 852 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await fixture(page);
      if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await noHorizontalOverflow(page);
      await accessible(page);
      await connect(page);
      await prepare(page, '0.123456789012345678');
      await noHorizontalOverflow(page);
      await accessible(page);
      const dialog = page.getByRole('dialog');
      expect(await dialog.evaluate(element => parseFloat(getComputedStyle(element).animationDuration))).toBeLessThanOrEqual(0.001);
      const targets = await dialog.getByRole('button').evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect();
        return { name: element.getAttribute('aria-label') ?? element.textContent, width: box.width, height: box.height };
      }).filter(box => box.width < 44 || box.height < 44));
      expect(targets, 'Visible review buttons retain at least 44px targets').toEqual([]);
      await dialog.getByText('Transaction details', { exact: true }).click();
      await expect(dialog.getByText('123456789012345678 wei', { exact: true })).toBeVisible();
      await noHorizontalOverflow(page);
      await page.screenshot({ path: `docs/evidence/checkpoint-review-${theme}-${width}.png` });
      expect((await snapshot(page)).sends).toBe(0);
    });
  }

  test(`${theme} theme at 320px with 200% text retains review content and usable actions`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fixture(page);
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    expect(await page.locator('html').evaluate(element => getComputedStyle(element).fontSize)).toBe('32px');
    await noHorizontalOverflow(page);
    await accessible(page);
    await connect(page);
    await prepare(page, '0.123456789012345678');
    await noHorizontalOverflow(page);
    await accessible(page);
    const dialog = page.getByRole('dialog', { name: 'Review ETH long', exact: true });
    await expect(dialog.getByRole('button', { name: 'Confirm in wallet', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Confirm in wallet', exact: true })).toBeInViewport();
    await dialog.getByText('Transaction details', { exact: true }).click();
    const exactValue = dialog.getByText('123456789012345678 wei', { exact: true });
    await exactValue.scrollIntoViewIfNeeded();
    await expect(exactValue).toBeInViewport({ ratio: 0.25 });
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `docs/evidence/checkpoint-review-${theme}-320-text200.png` });
    expect((await snapshot(page)).sends).toBe(0);
  });
}

test('theme switching preserves the exact deposit, leverage, and explicit slippage preference', async ({ page }) => {
  await fixture(page);
  await connect(page);
  await page.getByRole('textbox', { name: 'Amount in ETH' }).fill('0.123456789012345678');
  await page.getByRole('textbox', { name: 'Requested leverage' }).fill('4');
  await page.locator('summary').filter({ hasText: 'Slippage tolerance' }).click();
  await page.getByRole('radio', { name: '1%', exact: true }).check();
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.123456789012345678');
  await expect(page.getByRole('textbox', { name: 'Requested leverage' })).toHaveValue('4');
  await expect(page.getByRole('radio', { name: '1%', exact: true })).toBeChecked();
  expect((await snapshot(page)).sends).toBe(0);
});
