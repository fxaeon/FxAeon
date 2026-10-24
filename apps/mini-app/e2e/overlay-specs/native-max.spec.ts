import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const appRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(appRoot, 'package.json'));
const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }>;
};
let bundle = '';
test.beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: [resolve(appRoot, 'e2e/harness/native-max-entry.tsx')],
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    absWorkingDir: appRoot,
  });
  bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => { window.__nativeMaxHarness = { calls: 0 }; });
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => page.evaluate(() => window.__nativeMaxHarness.calls)).toBe(1);
});

test('warmup is click independent and a fresh Max applies inside the click without another request', async ({ page }) => {
  await page.evaluate(() => window.__nativeMaxHarness.resolve?.({ amountWei: 900n, validUntil: Date.now() + 15_000 }));
  await page.getByRole('button', { name: 'Max', exact: true }).click();
  expect(await page.evaluate(() => window.__nativeMaxHarness.clickValue)).toBe('900');
  await expect(page.getByRole('textbox', { name: 'Amount' })).toHaveValue('900');
  await expect(page.getByTestId('pending')).toHaveText('false');
  expect(await page.evaluate(() => window.__nativeMaxHarness.calls)).toBe(1);
});

test('cold Max immediately clears the old oversized amount and joins one warmup', async ({ page }) => {
  await page.getByRole('button', { name: 'Max', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Amount' })).toHaveValue('');
  await expect(page.getByTestId('pending')).toHaveText('true');
  expect(await page.evaluate(() => window.__nativeMaxHarness.calls)).toBe(1);
  await page.evaluate(() => window.__nativeMaxHarness.resolve?.({ amountWei: 900n, validUntil: Date.now() + 15_000 }));
  await expect(page.getByRole('textbox', { name: 'Amount' })).toHaveValue('900');
});

test('manual edits and immediate percentage shortcuts cancel a pending Max write', async ({ page }) => {
  await page.getByRole('button', { name: 'Max', exact: true }).click();
  await page.getByRole('button', { name: '25%', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Amount' })).toHaveValue('250');
  await page.getByRole('textbox', { name: 'Amount' }).fill('123');
  await page.evaluate(() => window.__nativeMaxHarness.resolve?.({ amountWei: 900n, validUntil: Date.now() + 15_000 }));
  await expect(page.getByRole('textbox', { name: 'Amount' })).toHaveValue('123');
  await expect(page.getByTestId('pending')).toHaveText('false');
});

test('a wallet change invalidates a pending Max and unavailable gas leaves the draft empty', async ({ page }) => {
  await page.getByRole('button', { name: 'Max', exact: true }).click();
  await page.getByRole('button', { name: 'Change wallet' }).click();
  await expect.poll(() => page.evaluate(() => window.__nativeMaxHarness.calls)).toBe(2);
  await page.getByRole('button', { name: 'Max', exact: true }).click();
  await page.evaluate(() => window.__nativeMaxHarness.reject?.(new Error('current gas estimate is unavailable')));
  await expect(page.getByRole('textbox', { name: 'Amount' })).toHaveValue('');
  await expect(page.getByTestId('pending')).toHaveText('false');
  await expect(page.getByTestId('error')).toHaveText('Current gas fees are unavailable. Try again shortly.');
});
