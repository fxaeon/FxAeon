/** Real exported Next chunks + deterministic Telegram/API boundaries. No build,
 * credentials, signing, or deployment. An unconfigured artifact must fail.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { configuredBrowserChannel } from '../../../scripts/e2e_browser_channel.cjs';
import { savedThemes, observationMs, openConfiguredRun, watchHydration, installFirstPaintProbe,
  assertDarkHydration, readStartupTimeline, artifactDirectory, saveReport, passkeyStartupCases, passkeyLaunchUrl } from './configured-startup-support.mjs';

function gate() {
  let release;
  const promise = new Promise(done => { release = done; });
  return { promise, release };
}
async function seen(promise, label) {
  let timer;
  try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} not reached in the real configured passkey branch`)), 15_000); })]); }
  finally { clearTimeout(timer); }
}
async function neutral(page, expectedPath) {
  await page.locator(expectedPath === '/' ? '[data-wallet-startup]' : '[role="status"][aria-label="Loading FxAeon"]').waitFor({ state: 'visible' });
  await page.locator(`[data-route="${expectedPath}"]`).waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-portfolio-explore], [data-admission-state="checking"], [data-portfolio-value], [aria-label="Portfolio views"]').count(), 0);
  assert.equal(await page.locator('[data-wallet-connect-trigger]:visible').count(), 0);
}

const themes = savedThemes(process.env.FXAEON_HYDRATION_THEME).filter(theme => theme !== 'blocked');
assert.ok(themes.length, 'Storage denial is covered by verify-configured-hydration.mjs; passkey recovery requires usable durable storage.');
const observe = observationMs(process.env.FXAEON_HYDRATION_OBSERVE_MS);
const cases = passkeyStartupCases(themes, process.env.FXAEON_CONFIGURED_STARTUP_CASE);
const directory = artifactDirectory();
const channel = configuredBrowserChannel();
const { target, browser, budget } = await openConfiguredRun(chromium, channel);
const results = [];
try {
  for (const { theme, timing, caseName, startParam, expectedPath } of cases) {
    assert.ok(!budget.expired(), 'Configured startup exceeded its four-minute budget.');
    const desktop = caseName === 'desktop-prefetch';
    const context = await browser.newContext({ viewport: desktop ? { width: 1280, height: 900 } : { width: 412, height: 818 }, colorScheme: 'light', serviceWorkers: 'block' });
    const page = await context.newPage();
    const issues = watchHydration(page);
    const statusSeen = gate(), recoverySeen = gate(), statusReply = gate(), recoveryReply = gate();
    const actions = [], unexpected = [], chunkChecks = [], providerChunks = [];
    const prefetches = [], prefetchSeen = gate();
    page.on('request', request => {
      if (new URL(request.url()).origin === target.baseUrl && request.headers()['next-router-prefetch'] === '1') {
        prefetches.push(new URL(request.url()).pathname); prefetchSeen.release();
      }
    });
    let timeline = null;
    const launch = `user=%7B%22id%22%3A12345%7D&auth_date=${Math.floor(Date.now() / 1000)}&hash=synthetic-configured-fixture${startParam ? `&start_param=${startParam}` : ''}`;
    if (timing === 'fast') { statusReply.release(); recoveryReply.release(); }
    try {
      await installFirstPaintProbe(page, theme, true);
      if (desktop) await page.addInitScript(() => sessionStorage.setItem('fxaeon:sidebar-expanded', 'true'));
      await page.addInitScript(({ launch, delayed }) => {
        window.__configuredFixtureEvents = [{ name: delayed ? 'bridgeWithheld' : 'bridgeCreated', atMs: performance.now() }];
        window.Telegram = {};
        window.__releaseConfiguredBridge = () => {
          const noop = () => {};
          window.Telegram.WebApp = { initData: launch, initDataUnsafe: { user: { id: 12345 }, start_param: new URLSearchParams(launch).get('start_param') || undefined }, platform: 'android', version: '8.0',
            colorScheme: 'light', themeParams: {}, isExpanded: true, viewportHeight: innerHeight, viewportStableHeight: innerHeight,
            ready: noop, expand: noop, close: noop, onEvent: noop, offEvent: noop, isVersionAtLeast: () => true,
            setHeaderColor: noop, setBackgroundColor: noop, setBottomBarColor: noop,
            BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop } };
          window.__configuredFixtureEvents.push({ name: 'bridgeReleased', atMs: performance.now() });
        };
        window.__credentialCalls = 0;
        const reject = () => { window.__credentialCalls += 1; return Promise.reject(new Error('Credentials forbidden in this fixture')); };
        navigator.credentials.get = navigator.credentials.create = reject;
        if (!delayed) window.__releaseConfiguredBridge();
      }, { launch, delayed: timing === 'delayed' });
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin === target.baseUrl && url.pathname.startsWith('/_next/') && url.pathname.endsWith('.js') && response.ok()) {
          chunkChecks.push(response.text().then(source => {
            if (source.includes('telegram-passkey') && source.includes('transaction/status')) providerChunks.push(url.pathname);
          }).catch(() => {}));
        }
      });
      await page.route('**/*', async request => {
        const url = new URL(request.request().url());
        if (url.origin !== target.baseUrl) {
          if (/privy/i.test(url.hostname)) unexpected.push('native Privy request');
          return request.abort();
        }
        if (url.pathname === '/vendor/telegram/telegram-web-app.js') return request.fulfill({ contentType: 'application/javascript', body: '/* Telegram host boundary controlled by the fixture. */' });
        if (url.pathname === '/api/telegram-wallet') {
          const body = request.request().postDataJSON();
          actions.push(body.action);
          if (body.launchData !== launch) unexpected.push('status/recovery launch mismatch');
          if (body.action === 'status') {
            statusSeen.release(); await statusReply.promise;
            return request.fulfill({ json: { state: 'ready', hasCredential: true, cohortFull: false, telegramNotify: false, emailVerified: false,
              wallet: { id: 'built-fixture-wallet', address: `0x${'1'.repeat(40)}` } } });
          }
          if (body.action === 'transaction/status') {
            recoverySeen.release(); await recoveryReply.promise;
            await page.evaluate(() => {
              window.__configuredStartup.allowConnected = true;
              window.__configuredFixtureEvents.push({ name: 'recoveryReplyReleaseRequested', atMs: performance.now() });
            });
            return request.fulfill({ json: { operation: null } });
          }
          unexpected.push(`forbidden action: ${body.action}`);
          return request.fulfill({ status: 403, json: { error: 'fixture_forbidden' } });
        }
        if (url.pathname.startsWith('/api/')) return request.fulfill({ status: 503, json: { error: 'fixture_unavailable' } });
        // Documents, CSS, fonts and every genuine emitted Next chunk pass through.
        return request.continue();
      });
      const response = await page.goto(passkeyLaunchUrl(target.baseUrl, launch, startParam), { waitUntil: 'domcontentloaded' });
      assert.ok(response?.ok(), 'Existing build document did not load.');
      await seen(statusSeen.promise, 'Server status');
      assert.deepEqual(unexpected, [], 'Server status must carry the original signed launch data.');
      await page.waitForURL(url => url.pathname === expectedPath);
      if (timing === 'delayed') {
        assert.equal(await page.evaluate(() => Boolean(window.Telegram?.WebApp)), false, 'Status must start before bridge availability.');
        await neutral(page, expectedPath);
        if (desktop) {
          await page.locator('[data-desktop-sidebar]').waitFor({ state: 'visible' });
          // A real observation window while the server response is held;
          // inert navigation must not start Next's native route prefetches.
          await page.waitForTimeout(observe);
          assert.deepEqual(prefetches, [], 'Desktop routes prefetched before provider readiness.');
        }
        await page.screenshot({ path: resolve(directory, `${theme}-${caseName}-status.png`), animations: 'disabled' });
        await page.evaluate(() => {
          window.__releaseConfiguredBridge();
          window.__configuredFixtureEvents.push({ name: 'statusReplyReleaseRequested', atMs: performance.now() });
        });
        statusReply.release();
      }
      await seen(recoverySeen.promise, 'Transaction recovery');
      if (timing === 'delayed') {
        await neutral(page, expectedPath);
        if (desktop) assert.deepEqual(prefetches, [], 'Desktop routes prefetched before recovery resolved.');
        recoveryReply.release();
      }
      const profile = page.getByRole('button', { name: 'Open wallet profile', exact: true });
      await profile.waitFor({ state: 'visible' });
      await page.locator(expectedPath === '/' ? '[data-portfolio-state^="connected-"]' : `[data-route="${expectedPath}"] .app-content`).waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).pathname, expectedPath);
      await page.waitForTimeout(observe);
      await Promise.all(chunkChecks);
      assert.ok(providerChunks.length, 'No genuine emitted passkey module was loaded from the build.');
      assert.deepEqual(actions, ['status', 'transaction/status']);
      assert.deepEqual(unexpected, []);
      assert.equal(await page.evaluate(() => window.__credentialCalls), 0);
      const probe = await assertDarkHydration(page, theme, issues, true);
      timeline = await readStartupTimeline(page, timing);
      for (const request of [timeline.statusRequest, timeline.recoveryRequest]) {
        assert.ok(request && request.fetchCalledMs !== null && request.requestStartMs !== null && request.requestEndMs !== null && request.durationMs !== null,
          'A real browser request interval was not observed.');
      }
      assert.ok(timeline.firstWalletPaintMs !== null && timeline.firstConnectedPaintMs !== null, 'Verified wallet and connected frames were not observed.');
      await page.screenshot({ path: resolve(directory, `${theme}-${caseName}-connected.png`), animations: 'disabled' });
      const actualPath = new URL(page.url()).pathname;
      if (desktop) {
        await seen(prefetchSeen.promise, 'Resolved desktop route prefetch');
        await page.locator('[data-desktop-sidebar] nav a[href="/earn"]').click();
        await page.waitForURL(url => url.pathname === '/earn');
        await page.locator('[data-route="/earn"]').waitFor({ state: 'visible' });
      }
      results.push({ savedTheme: theme, timing, caseName, expectedPath, actualPath, ok: true,
        ...(desktop ? { nativePrefetchRequests: prefetches, navigatedTo: new URL(page.url()).pathname } : {}),
        paints: probe.paints, badStates: probe.badStates, badPaints: probe.badPaints, actions, providerChunks, timeline });
      console.log(`TRACE ${JSON.stringify({ savedTheme: theme, scenario: caseName, ...timeline })}`);
      console.log(`PASS saved=${theme}, ${caseName}: emitted passkey chunks, dark first paint, verified publication at ${expectedPath}`);
    } catch (error) {
      timeline ??= await readStartupTimeline(page, timing).catch(() => null);
      await page.screenshot({ path: resolve(directory, `${theme}-${caseName}-failed.png`), animations: 'disabled', timeout: 3000 }).catch(() => {});
      results.push({ savedTheme: theme, timing, caseName, expectedPath, ok: false, error: error.message, timeline,
        ...(desktop ? { nativePrefetchRequests: prefetches } : {}) });
      throw error; // A wrong/unconfigured build fails promptly instead of passing static HTML.
    } finally { statusReply.release(); recoveryReply.release(); await context.close(); }
  }
} finally {
  budget.close(); await browser.close(); await target.close();
  saveReport(directory, 'configured-passkey', results);
}
