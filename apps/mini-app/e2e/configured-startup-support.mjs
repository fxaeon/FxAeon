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
    performance.setResourceTimingBufferSize(2000);
    const probe = window.__configuredStartup = { paints: 0, badPaints: 0, badStates: 0, allowConnected: false, stop: false,
      firstNeutralPaintMs: null, firstWalletPaintMs: null, firstConnectedPaintMs: null, requests: [] };
    // Observe native fetch invocation without wrapping its promise or delaying
    // delivery. Response end comes from the browser's Resource Timing entries.
    const nativeFetch = window.fetch;
    window.fetch = function(input, init) {
      try {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
        if (url.origin === location.origin && url.pathname === '/api/telegram-wallet') {
          const action = typeof init?.body === 'string' ? JSON.parse(init.body).action : null;
          probe.requests.push({ action, url: url.href, fetchCalledMs: performance.now() });
        }
      } catch { /* Observation must never change fetch semantics. */ }
      return Reflect.apply(nativeFetch, this, arguments);
    };
    const visible = element => {
      if (!element || element.getBoundingClientRect().width <= 0 || element.getBoundingClientRect().height <= 0) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const sample = (paint = false, atMs) => {
      if (!document.querySelector('.app-shell')) return;
      const root = document.documentElement;
      const style = getComputedStyle(root);
      if (paint) {
        probe.paints += 1;
        if (probe.firstNeutralPaintMs === null && visible(document.querySelector('[data-wallet-startup]'))) probe.firstNeutralPaintMs = atMs;
        if (probe.firstWalletPaintMs === null && visible(document.querySelector('button[aria-label="Open wallet profile"]'))) probe.firstWalletPaintMs = atMs;
        if (probe.firstConnectedPaintMs === null && visible(document.querySelector('[data-portfolio-state^="connected-"]'))) probe.firstConnectedPaintMs = atMs;
        if (root.dataset.theme !== 'dark' || !style.colorScheme.includes('dark') || style.getPropertyValue('--bg').trim() !== '#080808') probe.badPaints += 1;
      }
      if (passkey && (document.querySelector('[data-portfolio-explore], [data-admission-state="checking"]')
        || !probe.allowConnected && document.querySelector('[data-portfolio-value], [aria-label="Portfolio views"], .app-content .skeleton'))) probe.badStates += 1;
    };
    new MutationObserver(() => sample()).observe(document, { childList: true, subtree: true, attributes: true });
    // Use observation time, not the rAF frame tick (which can predate a DOM
    // update within that frame), so publication cannot appear before recovery.
    const paint = () => { if (!probe.stop) { sample(true, performance.now()); requestAnimationFrame(paint); } };
    requestAnimationFrame(paint);
  }, { savedTheme, passkey });
}

/** All values are browser navigation-relative Performance timestamps. Missing
 * events remain null; fixture holds never stand in for request measurements. */
export function startupTimeline(snapshot, scenario) {
  const measured = value => Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;
  const used = new Set();
  const requests = snapshot.requests.map((request, index) => {
    const next = snapshot.requests.slice(index + 1).find(entry => entry.url === request.url);
    const resource = snapshot.resources.filter(entry => entry.name === request.url && !used.has(entry)
      && entry.startTime >= request.fetchCalledMs - 0.5 && (!next || entry.startTime < next.fetchCalledMs))
      .sort((a, b) => Math.abs(a.startTime - request.fetchCalledMs) - Math.abs(b.startTime - request.fetchCalledMs))[0];
    if (resource) used.add(resource);
    const start = measured(resource?.startTime), end = measured(resource?.responseEnd);
    return { action: request.action, fetchCalledMs: measured(request.fetchCalledMs), requestStartMs: start, requestEndMs: end,
      durationMs: start !== null && end !== null && end >= start ? measured(end - start) : null };
  });
  const status = requests.find(request => request.action === 'status') ?? null;
  const recovery = requests.find(request => request.action === 'transaction/status') ?? null;
  const control = name => measured(snapshot.controls.find(event => event.name === name)?.atMs);
  const hold = (name, from, until, reason) => ({ name, fromMs: from, releaseCommandMs: until,
    observedHoldMs: from !== null && until !== null && until >= from ? measured(until - from) : null, reason });
  return {
    clock: 'milliseconds since browser navigation; no simulated clock', navigationTimeOriginEpochMs: snapshot.timeOrigin,
    requestTimingSource: 'native fetch invocation and PerformanceResourceTiming startTime/responseEnd',
    paintTimingSource: 'first visible DOM frame sampled by requestAnimationFrame; native paint entries also reported',
    nativeFirstPaintMs: measured(snapshot.nativePaints.find(entry => entry.name === 'first-paint')?.startTime),
    nativeFirstContentfulPaintMs: measured(snapshot.nativePaints.find(entry => entry.name === 'first-contentful-paint')?.startTime),
    firstNeutralPaintMs: measured(snapshot.firstNeutralPaintMs), firstWalletPaintMs: measured(snapshot.firstWalletPaintMs),
    firstConnectedPaintMs: measured(snapshot.firstConnectedPaintMs), statusRequest: status, recoveryRequest: recovery,
    intentionalDelays: { label: scenario === 'fast' ? 'none; immediate intercepted replies' : 'controlled bridge/status/recovery holds',
      maxRunMs: 240_000, holds: scenario === 'fast' ? [] : [
        hold('bridge', control('bridgeWithheld'), control('bridgeReleased'), 'Release after status begins and neutral UI is checked'),
        hold('status', status?.fetchCalledMs ?? null, control('statusReplyReleaseRequested'), 'Response held for neutral assertion and screenshot'),
        hold('recovery', recovery?.fetchCalledMs ?? null, control('recoveryReplyReleaseRequested'), 'Response held until neutral recovery UI is checked'),
      ] },
  };
}

export async function readStartupTimeline(page, scenario) {
  const snapshot = await page.evaluate(() => {
    const probe = window.__configuredStartup;
    return { timeOrigin: performance.timeOrigin, requests: probe.requests,
      resources: performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname === '/api/telegram-wallet')
        .map(entry => ({ name: entry.name, startTime: entry.startTime, responseEnd: entry.responseEnd })),
      nativePaints: performance.getEntriesByType('paint').map(entry => ({ name: entry.name, startTime: entry.startTime })),
      firstNeutralPaintMs: probe.firstNeutralPaintMs, firstWalletPaintMs: probe.firstWalletPaintMs, firstConnectedPaintMs: probe.firstConnectedPaintMs,
      controls: window.__configuredFixtureEvents ?? [] };
  });
  return startupTimeline(snapshot, scenario);
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
