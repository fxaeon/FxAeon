import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { savedThemes, localBaseUrl, observationMs, existingBuildTarget, hydrationIssue,
  assertDarkHydration, boundedRun, startupTimeline, passkeyStartupCases, passkeyLaunchUrl } from '../apps/mini-app/e2e/configured-startup-support.mjs';

test('built deep-link and desktop checks augment the matrix and can run without rebuilding', () => {
  const themes = ['unset', 'official', 'dark', 'light', 'invalid'];
  assert.equal(passkeyStartupCases(themes).length, 12);
  assert.equal(passkeyStartupCases(themes, 'matrix').length, 10);
  assert.deepEqual(passkeyStartupCases(themes, 'trade-deeplink'), [{ theme: 'dark', timing: 'delayed', caseName: 'trade-deeplink', startParam: 'trade', expectedPath: '/trade' }]);
  assert.throws(() => passkeyStartupCases(themes, 'typo'));
});

test('trade entry supplies the actual Telegram start key and preserves signed launch data in the hash', () => {
  const launch = 'user=%7B%22id%22%3A12345%7D&auth_date=123&hash=synthetic&start_param=trade';
  const url = new URL(passkeyLaunchUrl('http://127.0.0.1:4321', launch, 'trade'));
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.get('tgWebAppStartParam'), 'trade');
  const hash = new URLSearchParams(url.hash.slice(1));
  assert.equal(hash.get('tgWebAppData'), launch);
  assert.equal(new URLSearchParams(hash.get('tgWebAppData')).get('start_param'), 'trade');
  assert.equal(hash.get('tgWebAppPlatform'), 'android');
  assert.equal(new URL(passkeyLaunchUrl(url.origin, launch)).search, '');
});

test('theme matrix covers every saved alias plus unset, invalid and denied storage', () => {
  assert.deepEqual(savedThemes(), ['unset', 'official', 'dark', 'light', 'invalid', 'blocked']);
  for (const theme of savedThemes()) assert.deepEqual(savedThemes(theme), [theme]);
  assert.throws(() => savedThemes('cream'));
});

test('configured checks accept local artifacts only, without credentials in URLs', () => {
  for (const url of ['http://localhost:4321/', 'http://127.0.0.1:1234', 'http://[::1]:4321']) assert.ok(localBaseUrl(url));
  for (const url of ['https://fxaeon.com', 'http://user:secret@localhost', 'file:///dist', 'http://localhost/private', 'http://localhost/?token=secret']) {
    assert.throws(() => localBaseUrl(url));
  }
});

test('observation time is bounded and invalid values fail before a browser launches', () => {
  assert.equal(observationMs(), 1000);
  for (const ms of ['100', '5000']) assert.equal(observationMs(ms), Number(ms));
  for (const ms of ['0', '-1', '5001', 'Infinity', '1.5', 'invalid']) assert.throws(() => observationMs(ms));
});

test('missing exports fail instead of silently triggering a build', async () => {
  await assert.rejects(existingBuildTarget({ FXAEON_HYDRATION_DIST_DIR: fileURLToPath(new URL('./fixture-no-configured-export', import.meta.url)) }), /never builds/);
});

const sample = overrides => ({ evaluate: async () => ({ theme: 'dark', saved: 'dark', paints: 3, badPaints: 0, badStates: 0, ...overrides }) });
test('a dark final DOM cannot hide a light first frame or a static-only false pass', async () => {
  await assertDarkHydration(sample({}), 'light', []);
  await assert.rejects(assertDarkHydration(sample({ badPaints: 1 }), 'light', []), /non-dark/);
  await assert.rejects(assertDarkHydration(sample({ paints: 0 }), 'dark', []), /static HTML/);
  await assert.rejects(assertDarkHydration(sample({ saved: 'light' }), 'light', []), /not migrated/);
});

test('startup flashes and hydration diagnostics fail the built gate', async () => {
  await assert.rejects(assertDarkHydration(sample({ badStates: 1 }), 'dark', [], true), /connected-shaped/);
  await assert.rejects(assertDarkHydration(sample({}), 'dark', ['Hydration mismatch'], true), /Hydration warnings/);
  assert.ok(hydrationIssue('Minified React error #418;'));
  assert.ok(hydrationIssue('A tree hydrated but some attributes did not match'));
  assert.equal(hydrationIssue('net::ERR_FAILED'), false);
});

test('the total browser budget closes the browser and cannot wait indefinitely', async () => {
  let closed = 0;
  const budget = boundedRun({ close: async () => { closed += 1; } }, 5);
  try {
    await new Promise(done => setTimeout(done, 20));
    assert.equal(budget.expired(), true);
    assert.equal(closed, 1);
  } finally { budget.close(); }
});

const api = 'http://127.0.0.1:4321/api/telegram-wallet';
function timingSnapshot() {
  return { timeOrigin: 1_800_000_000_000, firstNeutralPaintMs: 920, firstWalletPaintMs: 1450, firstConnectedPaintMs: 1480,
    connectedPaintKind: 'authenticated-route', routeEvents: [{ kind: 'pushState', atMs: 950, pathname: '/trade', hasLaunchHash: true }],
    requests: [{ action: 'status', url: api, fetchCalledMs: 1200.1 }, { action: 'transaction/status', url: api, fetchCalledMs: 1300.2 }],
    resources: [{ name: api, startTime: 1300.3, responseEnd: 1400.4 }, { name: api, startTime: 1200.2, responseEnd: 1299.9 }],
    nativePaints: [{ name: 'first-paint', startTime: 800 }, { name: 'first-contentful-paint', startTime: 900 }],
    controls: [{ name: 'bridgeWithheld', atMs: 5 }, { name: 'bridgeReleased', atMs: 1250 },
      { name: 'statusReplyReleaseRequested', atMs: 1251 }, { name: 'recoveryReplyReleaseRequested', atMs: 1390 }] };
}

test('request trace uses native navigation-relative resources, independently of release controls', () => {
  const snapshot = timingSnapshot();
  const trace = startupTimeline(snapshot, 'fast');
  assert.deepEqual(trace.statusRequest, { action: 'status', fetchCalledMs: 1200.1, requestStartMs: 1200.2, requestEndMs: 1299.9, durationMs: 99.7 });
  assert.deepEqual(trace.recoveryRequest, { action: 'transaction/status', fetchCalledMs: 1300.2, requestStartMs: 1300.3, requestEndMs: 1400.4, durationMs: 100.1 });
  assert.equal(trace.firstNeutralPaintMs, 920);
  assert.equal(trace.firstWalletPaintMs, 1450);
  assert.equal(trace.firstConnectedPaintMs, 1480);
  assert.equal(trace.connectedPaintKind, 'authenticated-route');
  assert.deepEqual(trace.routeEvents, snapshot.routeEvents);
  assert.equal(trace.nativeFirstContentfulPaintMs, 900);
  assert.deepEqual(trace.intentionalDelays.holds, []);
  assert.equal(trace.navigationTimeOriginEpochMs, snapshot.timeOrigin);
});

test('controlled delayed holds are measured and labelled without replacing request intervals', () => {
  const trace = startupTimeline(timingSnapshot(), 'delayed');
  assert.match(trace.intentionalDelays.label, /controlled/);
  assert.equal(trace.intentionalDelays.maxRunMs, 240_000);
  assert.equal(trace.intentionalDelays.holds.find(hold => hold.name === 'status').observedHoldMs, 50.9);
  assert.equal(trace.statusRequest.requestEndMs, 1299.9);
  assert.equal(trace.statusRequest.durationMs, 99.7);
});

test('missing resource completion or paint remains unknown rather than borrowing another request', () => {
  const snapshot = timingSnapshot();
  snapshot.resources = [snapshot.resources[0]];
  snapshot.firstNeutralPaintMs = null;
  const trace = startupTimeline(snapshot, 'fast');
  assert.equal(trace.statusRequest.requestStartMs, null);
  assert.equal(trace.statusRequest.requestEndMs, null);
  assert.equal(trace.statusRequest.durationMs, null);
  assert.equal(trace.firstNeutralPaintMs, null);
  assert.equal(trace.recoveryRequest.requestStartMs, 1300.3);
});
