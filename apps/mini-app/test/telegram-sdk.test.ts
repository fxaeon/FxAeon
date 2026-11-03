import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(resolve('public/vendor/telegram/telegram-web-app.js'), 'utf8');

test('official Telegram SDK bytes and license stay pinned with same-origin pre-hydration loading', () => {
  const sdk = readFileSync(resolve('public/vendor/telegram/telegram-web-app.js'));
  assert.equal(createHash('sha256').update(sdk).digest('hex'), 'b317829a04cec83bafdaff23c153b9d66498ddd1b1ab887b2b1edd4e695c03da');
  assert.ok(readFileSync(resolve('public/vendor/telegram/LICENSE'), 'utf8').includes('Copyright (c) 2022 Telegram Messenger'));
  const layout = readFileSync(resolve('src/app/layout.tsx'), 'utf8');
  assert.ok(layout.includes('src="/vendor/telegram/telegram-web-app.js"'));
  assert.ok(layout.includes('strategy="beforeInteractive"'));
  assert.ok(!layout.includes('https://telegram.org/js/telegram-web-app.js'));
});

function sdkHost(path = '/', iframe = false) {
  const storage = new Map<string, string>(), logs: unknown[][] = [], sent: Array<{ name: string; data: unknown; target?: string }> = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const host: any = {
    location: { pathname: path, hash: '#tgWebAppPlatform=android&tgWebAppVersion=8.0&tgWebAppData=user%3Dfixture', reload: () => sent.push({ name: 'reload', data: null }) },
    navigator: { userAgent: 'Android' }, innerHeight: 568,
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    console: { log: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args), error: (...args: unknown[]) => logs.push(args) },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener), removeEventListener: () => {},
    document: { documentElement: { style: { setProperty: () => {} } }, head: { appendChild: () => {} },
      createElement: (tag: string) => tag.toLowerCase() === 'a' ? new URL('https://fxaeon.test/') : { style: {} },
      addEventListener: () => {}, removeEventListener: () => {} },
  };
  host.window = host;
  host.parent = iframe ? { postMessage: (message: string, target: string) => { const event = JSON.parse(message); sent.push({ name: event.eventType, data: event.eventData, target }); } } : host;
  if (!iframe) host.TelegramWebviewProxy = { postEvent: (name: string, data: string) => sent.push({ name, data: JSON.parse(data) }) };
  const run = () => runInNewContext(source, host);
  return { host, storage, logs, sent, listeners, run };
}

for (const path of ['/wallet-approval', '/wallet-approval/', '/wallet-approval.html', '/invite', '/invite/', '/invite.html']) {
  test(`capability route ${path} never initializes the SDK or persists/logs the fragment`, () => {
    const fixture = sdkHost(path);
    fixture.host.location.hash = '#token=capability-secret&commitment=secret-commitment';
    fixture.run();
    assert.equal(fixture.host.Telegram, undefined);
    assert.equal(fixture.storage.size, 0);
    assert.deepEqual(fixture.logs, []);
    assert.deepEqual(fixture.sent, []);
  });
}

test('native transport still opens exact capability URL without logging its payload', () => {
  const fixture = sdkHost(); fixture.run();
  assert.equal(fixture.host.Telegram.WebApp.platform, 'android');
  const url = 'https://fxaeon.test/wallet-approval#token=capability-secret&commitment=secret-commitment';
  fixture.host.Telegram.WebApp.openLink(url, { try_instant_view: false });
  assert.deepEqual(fixture.sent.at(-1), { name: 'web_app_open_link', data: { url, try_instant_view: false } });
  fixture.host.Telegram.WebView.receiveEvent('unknown', { token: 'capability-secret' });
  assert.ok(!JSON.stringify(fixture.logs).includes('capability-secret'));
  assert.ok(!JSON.stringify([...fixture.storage.values()]).includes('capability-secret'));
});

test('iframe transport targets only Telegram Web and accepts only that parent origin', () => {
  const fixture = sdkHost('/', true); fixture.run();
  const receive = fixture.listeners.get('message')!;
  const update = JSON.stringify({ eventType: 'viewport_changed', eventData: { height: 420, is_state_stable: true, is_expanded: true } });
  receive({ source: fixture.host.parent, origin: 'https://other.telegram.org', data: update });
  assert.equal(fixture.host.Telegram.WebApp.viewportHeight, 568);
  receive({ source: {}, origin: 'https://web.telegram.org', data: update });
  assert.equal(fixture.host.Telegram.WebApp.viewportHeight, 568);
  receive({ source: fixture.host.parent, origin: 'https://web.telegram.org', data: update });
  assert.equal(fixture.host.Telegram.WebApp.viewportHeight, 420);
  fixture.host.Telegram.WebApp.openLink('https://fxaeon.test/wallet-approval#token=capability-secret');
  receive({ source: fixture.host.parent, origin: 'https://web.telegram.org', data: JSON.stringify({ eventType: 'reload_iframe' }) });
  for (const event of fixture.sent.filter(event => event.name !== 'reload')) assert.equal(event.target, 'https://web.telegram.org');
  assert.ok(fixture.sent.some(event => event.name === 'iframe_ready'));
  assert.ok(fixture.sent.some(event => event.name === 'iframe_will_reload'));
  assert.ok(fixture.sent.some(event => event.name === 'web_app_open_link'));
  assert.ok(!JSON.stringify(fixture.logs).includes('capability-secret'));
});
