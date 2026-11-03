import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TgWebApp } from '../src/lib/telegram';
import { requestTelegramWriteAccess, TelegramWriteAccessError } from '../src/lib/telegramWriteAccess';

function bridge() {
  const handlers = new Set<(payload?: unknown) => void>();
  let callback: ((allowed: boolean) => void) | undefined;
  let calls = 0;
  let gesture = true;
  const webApp = {
    version: '6.9',
    isVersionAtLeast(this: unknown, version: string) { assert.equal(this, webApp); assert.equal(version, '6.9'); return true; },
    requestWriteAccess(this: unknown, value: (allowed: boolean) => void) {
      assert.equal(this, webApp); assert.equal(gesture, true); calls++; callback = value;
    },
    onEvent(name: string, handler: (payload?: unknown) => void) { assert.equal(name, 'writeAccessRequested'); handlers.add(handler); },
    offEvent(name: string, handler: (payload?: unknown) => void) { assert.equal(name, 'writeAccessRequested'); handlers.delete(handler); },
  } as unknown as TgWebApp;
  return { webApp, handlers, calls: () => calls, endGesture: () => { gesture = false; },
    callback: (allowed: boolean) => callback?.(allowed), event: (status: string) => [...handlers].forEach(handler => handler({ status })) };
}

test('native method retains its receiver and runs before the click gesture ends', async () => {
  const fixture = bridge();
  const result = requestTelegramWriteAccess(fixture.webApp);
  fixture.endGesture();
  assert.equal(fixture.calls(), 1);
  fixture.callback(true);
  assert.equal(await result, true);
  assert.equal(fixture.handlers.size, 0);
});

test('event-only result works; event plus callback completes once and cancellation stays false', async () => {
  for (const allowed of [true, false]) {
    const fixture = bridge();
    const result = requestTelegramWriteAccess(fixture.webApp);
    fixture.event(allowed ? 'allowed' : 'cancelled');
    fixture.callback(!allowed);
    assert.equal(await result, allowed);
    assert.equal(fixture.handlers.size, 0);
  }
});

test('unsupported SDK/version gives an actionable error without opening a request', async () => {
  const fixture = bridge();
  fixture.webApp.isVersionAtLeast = () => false;
  await assert.rejects(requestTelegramWriteAccess(fixture.webApp), (error: unknown) => error instanceof TelegramWriteAccessError && error.code === 'unsupported');
  delete fixture.webApp.isVersionAtLeast;
  fixture.webApp.version = '6.8';
  await assert.rejects(requestTelegramWriteAccess(fixture.webApp), /Update Telegram/);
  delete fixture.webApp.requestWriteAccess;
  await assert.rejects(requestTelegramWriteAccess(fixture.webApp), /Update Telegram/);
  assert.equal(fixture.calls(), 0);
  assert.equal(fixture.handlers.size, 0);
});

test('numeric version fallback supports 6.10 and unverified launch permission is never a grant', async () => {
  const fixture = bridge();
  delete fixture.webApp.isVersionAtLeast;
  fixture.webApp.version = '6.10';
  fixture.webApp.initDataUnsafe = Object.assign({ auth_date: 0 }, { user: { allows_write_to_pm: true } });
  const result = requestTelegramWriteAccess(fixture.webApp);
  assert.equal(fixture.calls(), 1);
  fixture.callback(false);
  assert.equal(await result, false);
});

test('SDK throws clean up listeners and expose only a safe, specific message', async () => {
  for (const [message, code] of [['WebAppMethodUnsupported', 'unsupported'], ['WebAppWriteAccessRequested', 'in-progress'], ['secret native diagnostic', 'unavailable']]) {
    const fixture = bridge();
    fixture.webApp.requestWriteAccess = () => { throw new Error(message); };
    await assert.rejects(requestTelegramWriteAccess(fixture.webApp), (error: unknown) => error instanceof TelegramWriteAccessError && error.code === code && !error.message.includes(message));
    assert.equal(fixture.handlers.size, 0);
  }
});

test('timeout cleans up, ignores malformed results and late grants, and permits a fresh request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = bridge();
  const result = requestTelegramWriteAccess(fixture.webApp);
  const rejected = assert.rejects(result, (error: unknown) => error instanceof TelegramWriteAccessError && error.code === 'timeout');
  fixture.event('unexpected');
  t.mock.timers.tick(30_001);
  await rejected;
  assert.equal(fixture.handlers.size, 0);
  fixture.callback(true);
  const retry = requestTelegramWriteAccess(fixture.webApp);
  fixture.callback(false);
  assert.equal(await retry, false);
});

test('abort and duplicate clicks cannot produce another request or accept late permission', async () => {
  const fixture = bridge();
  const controller = new AbortController();
  const result = requestTelegramWriteAccess(fixture.webApp, { signal: controller.signal });
  await assert.rejects(requestTelegramWriteAccess(fixture.webApp), (error: unknown) => error instanceof TelegramWriteAccessError && error.code === 'in-progress');
  const rejected = assert.rejects(result, { name: 'AbortError' });
  controller.abort();
  await rejected;
  fixture.callback(true);
  fixture.event('allowed');
  await assert.rejects(requestTelegramWriteAccess(fixture.webApp, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fixture.calls(), 1);
  assert.equal(fixture.handlers.size, 0);
});
