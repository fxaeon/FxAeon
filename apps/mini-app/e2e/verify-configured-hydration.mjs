/** Ordinary-browser hydration against an existing export. Never builds or signs in.
 * Also run verify-configured-passkey-startup.mjs to prove the configured passkey branch.
 */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { configuredBrowserChannel } from '../../../scripts/e2e_browser_channel.cjs';
import { savedThemes, observationMs, openConfiguredRun, watchHydration, installFirstPaintProbe,
  assertDarkHydration, artifactDirectory, saveReport } from './configured-startup-support.mjs';

const themes = savedThemes(process.env.FXAEON_HYDRATION_THEME);
const observe = observationMs(process.env.FXAEON_HYDRATION_OBSERVE_MS);
const channel = configuredBrowserChannel();
const { target, browser, budget } = await openConfiguredRun(chromium, channel);
const results = [];
try {
  for (const route of ['/', '/trade', '/positions']) for (const theme of themes) {
    assert.ok(!budget.expired(), 'Hydration matrix exceeded its four-minute budget.');
    const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 412, height: 818 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const issues = watchHydration(page);
    const started = Date.now();
    try {
      await installFirstPaintProbe(page, theme);
      await page.route('**/*', request => {
        const url = new URL(request.request().url());
        if (url.origin !== target.baseUrl) return request.abort();
        if (url.pathname.startsWith('/api/')) return request.fulfill({ status: 503, json: { error: 'fixture_unavailable' } });
        return request.continue();
      });
      const response = await page.goto(new URL(route, target.baseUrl).href, { waitUntil: 'domcontentloaded' });
      assert.ok(response?.ok(), `HTTP ${response?.status() ?? 'no response'}`);
      await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().waitFor({ state: 'visible' });
      if (route === '/trade') {
        const picker = page.getByLabel('Input asset');
        assert.ok(await picker.isEnabled(), 'Input asset picker is disabled after hydration.');
        await picker.click();
        await page.getByRole('dialog', { name: 'Input asset', exact: true }).waitFor({ state: 'visible' });
      }
      await page.waitForTimeout(observe);
      const probe = await assertDarkHydration(page, theme, issues);
      results.push({ route, savedTheme: theme, ok: true, elapsedMs: Date.now() - started, paints: probe.paints });
      console.log(`PASS ${route}, saved=${theme}: dark first paint and hydrated controls`);
    } catch (error) {
      results.push({ route, savedTheme: theme, ok: false, error: error.message });
      console.error(`FAIL ${route}, saved=${theme}: ${error.message}`);
    } finally { await context.close(); }
  }
} finally {
  budget.close(); await browser.close(); await target.close();
  saveReport(artifactDirectory(), 'hydration', results);
}
if (results.some(result => !result.ok)) process.exitCode = 1;
