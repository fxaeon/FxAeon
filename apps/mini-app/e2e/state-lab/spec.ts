import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');

async function openLab(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('[data-harness-ready="true"]')).toHaveCount(1);
}

async function select(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
}

test('catalogs deterministic data states through the real provider-independent amount field', async ({ page }) => {
  await openLab(page);
  const input = page.getByRole('textbox', { name: 'Amount in ETH' });
  await expect(input).toHaveValue('1234.56789');
  expect(await page.locator('.amount-control').evaluate((element) => getComputedStyle(element).borderRadius)).toBe('12px');
  await expect.poll(() => page.locator('img[aria-label="ETH logo"]').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('14px Inter'))).toBe(true);
  await select(page, 'loading');
  await expect(page.getByText('Checking balance')).toBeVisible();
  await expect(page.getByLabel('Available balance', { exact: true })).toHaveAttribute('role', 'status');
  const shortcuts = page.getByRole('group', { name: 'Amount shortcuts' });
  for (const button of await shortcuts.getByRole('button').all()) await expect(button).toBeDisabled();
  await expect(shortcuts.getByRole('button')).toHaveCount(4);
  await select(page, 'zero');
  await expect(page.getByText('0 ETH')).toBeVisible();
  await expect(shortcuts).toContainText('25%50%75%Max');
  for (const button of await shortcuts.getByRole('button').all()) await expect(button).toBeDisabled();
  await select(page, 'partial');
  await expect(page.getByText('Some data is unavailable')).toBeVisible();
  await expect(page.getByLabel('USD value unavailable')).toHaveAttribute('role', 'status');
  await select(page, 'stale');
  await expect(page.getByText('Balance needs refresh')).toBeVisible();
  await expect(page.getByText('Stale values are not presented as current.')).toBeVisible();
  await select(page, 'unavailable');
  await expect(page.getByText('Balance unavailable')).toBeVisible();
  await select(page, 'positive');
  await expect(page.getByText('Balance available')).toBeVisible();
  for (const button of await shortcuts.getByRole('button').all()) await expect(button).toBeEnabled();
  await expect(page.getByText('Available:')).toContainText('1,234.56789 ETH');
  await expect(page.getByText('$4,267,629.59')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Action consequences' })).toContainText('Estimated debt');
  const receipt = page.getByRole('region', { name: 'Receipt detail fixtures' });
  await expect(receipt).toContainText('sent 1.2345 USDC');
  await expect(receipt).toContainText('Execution fee: 0.000021 ETH');
  await expect(receipt).toContainText('Partial fee data: this receipt does not include every gas, L1 data, and operator fee component.');
  await expect(receipt).toContainText('Token movement available in technical details');
  await receipt.getByText('Technical movement details', { exact: true }).click();
  await expect(receipt).toContainText('0x3333333333333333333333333333333333333333');
  await expect(receipt).toContainText('9 base units');
});

test('exposes transaction stage fixtures, long values, and keyboard focus in dark appearance', async ({ page }) => {
  await openLab(page);
  await expect(page.locator('.lab')).toHaveAttribute('data-theme', 'dark');
  const stages = page.getByLabel('Transaction stage', { exact: true });
  for (const stage of ['Editing', 'Preparing', 'Review', 'Wallet request', 'Submitted', 'Partial completion', 'Confirmed', 'Uncertain']) {
    await stages.selectOption({ label: stage });
    await expect(page.getByText(`Selected fixture: ${stage}.`)).toBeVisible();
    if (stage === 'Partial completion') {
      await expect(page.getByRole('status').getByText('Approval confirmed', { exact: true })).toBeVisible();
      await expect(page.getByRole('status')).toContainText('Action not submitted. The approval is on-chain; review each step before continuing.');
    }
    if (stage === 'Confirmed') await expect(page.getByRole('status').getByText('Confirmed', { exact: true })).toBeVisible();
    if (stage === 'Submitted') await expect(page.getByRole('status').getByText('Submitted', { exact: true })).toBeVisible();
    if (stage === 'Uncertain') await expect(page.getByRole('status').getByText('Confirmation unknown', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /wallet|submit|confirm/i })).toHaveCount(0);
  }
  await expect(page.getByRole('status').locator('svg')).toBeVisible();
  await expect(page.getByLabel('Long amount example')).toContainText('1234567890.123456789012345');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});

test('adapts to narrow, short, tablet, and desktop viewports with reduced motion enabled', async ({ page }) => {
  await openLab(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 620 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.lab')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data states' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `unexpected horizontal overflow at ${viewport.width}x${viewport.height}`).toBe(false);
  }
});

test('keeps amount label and shortcut targets clear at enlarged text on narrow widths', async ({ page }) => {
  await openLab(page);
  await select(page, 'positive');

  for (const width of [393, 320]) {
    await page.setViewportSize({ width, height: 852 });
    const field = page.locator('.field-shell');
    await field.evaluate((root) => {
      const textNodes = Array.from(root.querySelectorAll<HTMLElement>('label, button, span, strong, input'));
      const initialSizes = textNodes.map((element) => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
      for (const { element, size } of initialSizes) element.style.fontSize = `${size * 2}px`;
    });
    const geometry = await field.evaluate((root) => {
      const label = root.querySelector('label');
      const shortcutGroup = root.querySelector('[role="group"]');
      const shortcutTargets = [...(shortcutGroup?.querySelectorAll('button') ?? [])];
      if (!label || !shortcutGroup || shortcutTargets.length === 0) throw new Error('Expected the amount label and shortcut controls.');
      const range = document.createRange();
      range.selectNodeContents(label);
      const textRects = [...range.getClientRects()].map(({ left, right, top, bottom }) => ({ left, right, top, bottom }));
      const targets = shortcutTargets.map((button) => {
        const { left, right, top, bottom } = button.getBoundingClientRect();
        return { left, right, top, bottom };
      });
      const fieldRect = root.querySelector('.amount-control')!.getBoundingClientRect();
      return { textRects, targets, field: { left: fieldRect.left, right: fieldRect.right, top: fieldRect.top, bottom: fieldRect.bottom } };
    });
    expect(geometry.textRects.length, `amount label has visible text at ${width}px`).toBeGreaterThan(0);
    for (const target of geometry.targets) {
      expect(target.left, `shortcut starts within amount field at ${width}px`).toBeGreaterThanOrEqual(geometry.field.left);
      expect(target.right, `shortcut ends within amount field at ${width}px`).toBeLessThanOrEqual(geometry.field.right);
      for (const text of geometry.textRects) {
        const overlaps = target.left < text.right && target.right > text.left && target.top < text.bottom && target.bottom > text.top;
        expect(overlaps, `shortcut target does not cover label text at ${width}px`).toBe(false);
      }
    }
    await page.screenshot({ animations: 'disabled', path: `./test-results/ui-state-lab-playwright/amount-enlarged-${width}.png` });
    await field.evaluate((root) => root.querySelectorAll<HTMLElement>('label, button, span, strong, input').forEach((element) => { element.style.fontSize = ''; }));
  }
});

test('captures focused components and compares approved Windows references when present', async ({ page }, testInfo) => {
  await openLab(page);
  const artifacts = resolve(root, 'apps/mini-app/e2e/state-lab/captures');
  const snapshotNames = [
    'amount-loading', 'amount-zero', 'amount-partial', 'amount-positive', 'amount-long-value',
    'amount-theme-dark', 'amount-narrow',
    'progress-review', 'review-consequences', 'progress-wallet-request', 'progress-submitted', 'progress-partial', 'progress-confirmed', 'progress-uncertain',
    'receipt-known-usdc', 'receipt-base-technical',
  ];
  const forceCompare = process.env.UI_STATE_COMPARE === '1';
  const approveBaselines = process.env.UI_STATE_APPROVE_BASELINES === '1';
  const updatingSnapshots = testInfo.config.updateSnapshots !== 'none';
  if ((forceCompare || approveBaselines) && process.platform !== 'win32') throw new Error('Visual comparison and baseline approval require the pinned Windows Playwright environment used for these references.');
  if (approveBaselines && !updatingSnapshots) throw new Error('UI_STATE_APPROVE_BASELINES requires --update-snapshots.');
  const hasCompleteReferences = snapshotNames.every((name) => existsSync(testInfo.snapshotPath(`ui-state-${name}.png`)));
  const compare = forceCompare || approveBaselines || (process.platform === 'win32' && hasCompleteReferences);
  if (process.platform === 'win32' && !approveBaselines && !hasCompleteReferences && process.env.UI_STATE_CAPTURE !== '1') {
    throw new Error('Windows visual gate requires the complete approved reference set. Inspect captures, then use the explicit baseline approval command in docs/ui-state-lab.md.');
  }
  if (compare && !updatingSnapshots) expect(hasCompleteReferences, 'Approved snapshot set is incomplete; review and update all focused references together.').toBe(true);
  const compareOrCapture = async (name: string, locator: import('@playwright/test').Locator) => {
    const image = await locator.screenshot({ animations: 'disabled' });
    if (process.env.UI_STATE_CAPTURE === '1') {
      mkdirSync(artifacts, { recursive: true });
      const path = resolve(artifacts, `${name}.png`);
      await writeFile(path, image);
    }
    if (compare) await expect.soft(locator).toHaveScreenshot(`ui-state-${name}.png`, { animations: 'disabled' });
    else await testInfo.attach(name, { body: image, contentType: 'image/png' });
  };
  const field = page.locator('.field-shell');
  await select(page, 'loading'); await compareOrCapture('amount-loading', field);
  await select(page, 'zero'); await compareOrCapture('amount-zero', field);
  await select(page, 'partial'); await compareOrCapture('amount-partial', field);
  await select(page, 'positive'); await compareOrCapture('amount-positive', field);
  const amount = page.getByRole('textbox', { name: 'Amount in ETH' });
  await amount.fill('1234567890.123456789012345');
  await amount.evaluate((element: HTMLInputElement) => element.blur());
  await compareOrCapture('amount-long-value', field);
  await amount.fill('1234.56789');
  await amount.evaluate((element: HTMLInputElement) => element.blur());
  await compareOrCapture('amount-theme-dark', field);
  await page.setViewportSize({ width: 320, height: 568 });
  await compareOrCapture('amount-narrow', field);
  await page.setViewportSize({ width: 390, height: 844 });
  await compareOrCapture('review-consequences', page.getByRole('region', { name: 'Action consequences' }));
  for (const stage of ['Review', 'Wallet request', 'Submitted', 'Partial completion', 'Confirmed', 'Uncertain']) {
    await page.getByLabel('Transaction stage', { exact: true }).selectOption({ label: stage });
    const name = stage === 'Partial completion' ? 'partial' : stage.toLowerCase().replaceAll(' ', '-');
    await compareOrCapture(`progress-${name}`, page.locator('.presentation'));
  }
  await page.getByLabel('Transaction stage', { exact: true }).selectOption({ label: 'Uncertain' });
  await compareOrCapture('receipt-known-usdc', page.locator('.receipt-example').nth(0));
  await page.getByText('Technical movement details', { exact: true }).click();
  await compareOrCapture('receipt-base-technical', page.locator('.receipt-example').nth(1));
  await testInfo.attach('state-lab-manifest', {
    body: Buffer.from(`${snapshotNames.map((name) => `ui-state-${name}.png`).join('\n')}\nSnapshots are compared only on Windows after the full reference set is approved and added.`),
    contentType: 'text/plain',
  });
});
