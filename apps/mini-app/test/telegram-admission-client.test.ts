import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentTelegramLaunchData, webAppUrl,
} from '../src/lib/telegramAdmission';

function withWindow(value: unknown, callback: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
  try { callback(); } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete (globalThis as { window?: unknown }).window;
  }
}

const launch = new URLSearchParams({ auth_date: '1', user: JSON.stringify({ id: 99, first_name: 'Ada' }), signature: 'abc', hash: 'def' }).toString();

test('launch data comes from the bridge first, then the launch hash', () => {
  withWindow({ Telegram: { WebApp: { initData: ' bridge-data ' } }, location: { hash: '' } }, () => {
    assert.equal(currentTelegramLaunchData('#tgWebAppData=hash-data'), 'bridge-data');
  });
  withWindow({ location: { hash: '' } }, () => {
    assert.equal(currentTelegramLaunchData(`#tgWebAppData=${encodeURIComponent(launch)}&tgWebAppVersion=8.0`), launch);
    assert.equal(currentTelegramLaunchData('#/trade'), '');
  });
});

test('Continue on the web opens the public route without launch data', () => {
  assert.equal(webAppUrl('/'), 'https://fxaeon.com/');
  assert.equal(webAppUrl('/move/'), 'https://fxaeon.com/move');
  assert.equal(webAppUrl('/earn'), 'https://fxaeon.com/earn');
  assert.equal(webAppUrl('/settings'), 'https://fxaeon.com/');
  assert.equal(webAppUrl('/login'), 'https://fxaeon.com/');
});
