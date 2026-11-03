import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { savedThemes, localBaseUrl, observationMs, existingBuildTarget, hydrationIssue,
  assertDarkHydration, boundedRun } from '../apps/mini-app/e2e/configured-startup-support.mjs';

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
