import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TELEGRAM_ADMISSION_CACHE_KEY, TELEGRAM_ADMISSION_ENABLED, TELEGRAM_ADMISSION_ENDPOINT, currentTelegramLaunchData, forgetAdmission,
  launchUserId, rememberAdmission, rememberedAdmission, requestTelegramAdmission, webAppUrl,
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

function respond(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test('admission stays off unless the build opts in', () => {
  assert.equal(TELEGRAM_ADMISSION_ENABLED, false);
});

test('a decision is read from the reviewed same-origin route', async () => {
  for (const status of ['admitted', 'full', 'waitlisted'] as const) {
    const { calls, fetchImpl } = respond(200, { status });
    assert.equal(await requestTelegramAdmission(launch, 'join', { fetchImpl }), status);
    assert.equal(calls[0].url, TELEGRAM_ADMISSION_ENDPOINT);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.redirect, 'error');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { launchData: launch, intent: 'join' });
  }
});

test('only the server’s explicit launch errors become decisions; anything else is unavailable', async () => {
  const cases: [number, unknown, string][] = [
    [403, { error: 'launch_expired' }, 'expired'],
    [403, { error: 'launch_rejected' }, 'rejected'],
    [403, { error: 'origin_rejected' }, 'unavailable'],
    [503, { error: 'admission_unavailable' }, 'unavailable'],
    [200, { status: 'maybe' }, 'unavailable'],
    [200, '<html>gateway</html>', 'unavailable'],
    [200, { status: 'admitted', padding: 'x'.repeat(2_000) }, 'unavailable'],
  ];
  for (const [status, body, expected] of cases) {
    assert.equal(await requestTelegramAdmission(launch, 'enter', respond(status, body)), expected);
  }
  const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
  assert.equal(await requestTelegramAdmission(launch, 'enter', { fetchImpl: offline }), 'unavailable');
  const never = ((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  })) as unknown as typeof fetch;
  assert.equal(await requestTelegramAdmission(launch, 'enter', { fetchImpl: never, timeoutMs: 10 }), 'unavailable');
  const unused = respond(200, { status: 'admitted' });
  assert.equal(await requestTelegramAdmission('', 'enter', unused), 'rejected');
  assert.equal(unused.calls.length, 0, 'a launch without data never calls the route');
});

test('launch data comes from the bridge first, then the launch hash', () => {
  withWindow({ Telegram: { WebApp: { initData: ' bridge-data ' } }, location: { hash: '' } }, () => {
    assert.equal(currentTelegramLaunchData('#tgWebAppData=hash-data'), 'bridge-data');
  });
  withWindow({ location: { hash: '' } }, () => {
    assert.equal(currentTelegramLaunchData(`#tgWebAppData=${encodeURIComponent(launch)}&tgWebAppVersion=8.0`), launch);
    assert.equal(currentTelegramLaunchData('#/trade'), '');
  });
});

test('the device remembers a seat only for the same Telegram user', () => {
  assert.equal(launchUserId(launch), 99);
  assert.equal(launchUserId('user=%7B%22id%22%3A%22x%22%7D'), null);
  assert.equal(launchUserId('nonsense'), null);
  const store = new Map<string, string>();
  const localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } };
  withWindow({ localStorage }, () => {
    assert.equal(rememberedAdmission(99), false);
    rememberAdmission(99);
    assert.equal(store.get(TELEGRAM_ADMISSION_CACHE_KEY), '{"userId":99}');
    assert.equal(rememberedAdmission(99), true);
    assert.equal(rememberedAdmission(100), false);
    assert.equal(rememberedAdmission(null), false);
    forgetAdmission();
    assert.equal(rememberedAdmission(99), false);
  });
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  withWindow({ localStorage: blocked }, () => {
    assert.doesNotThrow(() => rememberAdmission(99));
    assert.equal(rememberedAdmission(99), false);
    assert.doesNotThrow(() => forgetAdmission());
  });
});

test('Continue on the web opens the public route without launch data', () => {
  assert.equal(webAppUrl('/'), 'https://fxaeon.com/');
  assert.equal(webAppUrl('/move/'), 'https://fxaeon.com/move');
  assert.equal(webAppUrl('/earn'), 'https://fxaeon.com/earn');
  assert.equal(webAppUrl('/settings'), 'https://fxaeon.com/');
  assert.equal(webAppUrl('/login'), 'https://fxaeon.com/');
});
