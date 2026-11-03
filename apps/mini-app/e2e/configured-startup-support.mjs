import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExportManifest, createStaticServer } from './serve.mjs';

export const SAVED_THEMES = ['unset', 'official', 'dark', 'light', 'invalid', 'blocked'];
export function savedThemes(value = 'all') {
  if (value === 'all') return [...SAVED_THEMES];
  if (!SAVED_THEMES.includes(value)) throw new Error('FXAEON_HYDRATION_THEME must be all, unset, official, dark, light, invalid, or blocked.');
  return [value];
}
export function localBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a loopback HTTP(S) origin serving the existing build.');
  return url.origin;
}
export function observationMs(value = '1000') {
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms < 100 || ms > 5000) throw new Error('FXAEON_HYDRATION_OBSERVE_MS must be 100–5000.');
  return ms;
}

/** Importing serve.mjs never invokes its CLI build. Missing exports fail closed. */
export async function existingBuildTarget(env = process.env) {
  if (env.FXAEON_HYDRATION_BASE_URL) return { baseUrl: localBaseUrl(env.FXAEON_HYDRATION_BASE_URL), close: async () => {} };
  const dist = env.FXAEON_HYDRATION_DIST_DIR ? resolve(env.FXAEON_HYDRATION_DIST_DIR) : fileURLToPath(new URL('../dist/', import.meta.url));
  if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Existing export missing. Build once first; this check never builds.');
  const server = createStaticServer(await createExportManifest(dist));
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done, reject) => {
    server.closeAllConnections(); server.close(error => error ? reject(error) : done());
  }) };
}
export function hydrationIssue(text) { return /hydrat|server rendered HTML|Minified React error #(418|423|425)\b/i.test(text); }
export function watchHydration(page) {
  const issues = [];
  page.on('pageerror', error => issues.push(error.message));
  page.on('console', message => { if (hydrationIssue(message.text())) issues.push(message.text()); });
  page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(25_000);
  return issues;
}

/** Installed before document scripts; never replaces application modules. */
export async function installFirstPaintProbe(page, savedTheme, passkey = false) {
  await page.addInitScript(({ savedTheme, passkey }) => {
    if (savedTheme === 'blocked') {
      Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new DOMException('Fixture storage denied', 'SecurityError'); };
    } else if (savedTheme !== 'unset') {
      const theme = savedTheme === 'invalid' ? 'retired-theme' : savedTheme;
      localStorage.setItem('fxaeon_theme_id_v2', theme);
      localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ theme }));
    }
    const probe = window.__configuredStartup = { paints: 0, badPaints: 0, badStates: 0, allowConnected: false, stop: false };
    const sample = (paint = false) => {
      if (!document.querySelector('.app-shell')) return;
      const root = document.documentElement;
      const style = getComputedStyle(root);
      if (paint) {
        probe.paints += 1;
        if (root.dataset.theme !== 'dark' || !style.colorScheme.includes('dark') || style.getPropertyValue('--bg').trim() !== '#080808') probe.badPaints += 1;
      }
      if (passkey && (document.querySelector('[data-portfolio-explore], [data-admission-state="checking"]')
        || !probe.allowConnected && document.querySelector('[data-portfolio-value], [aria-label="Portfolio views"], .app-content .skeleton'))) probe.badStates += 1;
    };
    new MutationObserver(() => sample()).observe(document, { childList: true, subtree: true, attributes: true });
    const paint = () => { if (!probe.stop) { sample(true); requestAnimationFrame(paint); } };
    requestAnimationFrame(paint);
  }, { savedTheme, passkey });
}
export async function assertDarkHydration(page, savedTheme, issues, passkey = false) {
  const result = await page.evaluate(() => {
    window.__configuredStartup.stop = true;
    let saved = null;
    try { saved = localStorage.getItem('fxaeon_theme_id_v2'); } catch { /* Fixture denies storage. */ }
    return { ...window.__configuredStartup, theme: document.documentElement.dataset.theme, saved };
  });
  assert.equal(result.theme, 'dark');
  assert.ok(result.paints > 0, 'No application paint observed; static HTML alone cannot pass.');
  assert.equal(result.badPaints, 0, 'A non-dark application frame was painted.');
  if (savedTheme !== 'blocked') assert.equal(result.saved, 'dark', 'Saved appearance was not migrated.');
  if (passkey) assert.equal(result.badStates, 0, 'Checking access, guest, or connected-shaped unknown content appeared.');
  assert.deepEqual(issues, [], 'Hydration warnings or uncaught page errors occurred.');
  return result;
}
export function boundedRun(browser, ms = 240_000) {
  let expired = false;
  const timer = setTimeout(() => { expired = true; void browser.close(); }, ms);
  return { expired: () => expired, close: () => clearTimeout(timer) };
}
export async function openConfiguredRun(chromium, channel) {
  const target = await existingBuildTarget();
  try {
    const browser = await chromium.launch({ headless: true, timeout: 25_000, ...(channel ? { channel } : {}) });
    return { target, browser, budget: boundedRun(browser) };
  } catch (error) { await target.close(); throw error; }
}
export function artifactDirectory(env = process.env) {
  const directory = env.FXAEON_HYDRATION_ARTIFACTS ? resolve(env.FXAEON_HYDRATION_ARTIFACTS) : fileURLToPath(new URL('../../../output/configured-startup/', import.meta.url));
  mkdirSync(directory, { recursive: true }); return directory;
}
export function saveReport(directory, name, results) { writeFileSync(resolve(directory, `${name}.json`), `${JSON.stringify(results, null, 2)}\n`); }
