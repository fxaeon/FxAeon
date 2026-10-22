import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createHost, hasTelegramLaunchData } from '../src/host/browser.ts';
import type { HostEnvironment } from '../src/host/browser.ts';
import { metaMaskBrowserLink, sanitizeWalletTarget } from '../src/host/handoff.ts';
import { AppError } from '../src/domain/errors.ts';

const ORIGIN = 'https://fxaeon.example';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Telegram {
  initData = 'host-only-test-value';
  viewportHeight = 800;
  viewportStableHeight = 780;
  safeAreaInset: unknown = { top: 24, right: 0, bottom: 20, left: 0 };
  contentSafeAreaInset: unknown = { top: 48, right: 0, bottom: 12, left: 0 };
  isActive = true;
  readyCount = 0;
  calls: [string, ...unknown[]][] = [];
  listeners = new Map<string, Set<(event?: unknown) => void>>();
  BackButton = {
    show: () => { this.calls.push(['back-show']); },
    hide: () => { this.calls.push(['back-hide']); },
  };
  onEvent(name: string, listener: (event?: unknown) => void): void {
    assert.ok(this instanceof Telegram);
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }
  offEvent(name: string, listener: (event?: unknown) => void): void {
    assert.ok(this instanceof Telegram);
    this.listeners.get(name)?.delete(listener);
  }
  emit(name: string, event?: unknown): void { for (const listener of this.listeners.get(name) ?? []) listener(event); }
  ready(): void { this.readyCount += 1; }
  setHeaderColor(color: string): void { this.calls.push(['header', color]); }
  setBackgroundColor(color: string): void { this.calls.push(['background', color]); }
  setBottomBarColor(color: string): void { this.calls.push(['bottom', color]); }
  openLink(url: string, options: unknown): void { this.calls.push(['open', url, options]); }
}

function setup(initialHref = `${ORIGIN}/`, initialBridge: unknown = undefined) {
  const events = new EventTarget();
  const documentEvents = new EventTarget();
  const styles = new Map<string, string>();
  const attributes = new Map<string, string>();
  const opened: string[] = [];
  let href = initialHref;
  let bridge = initialBridge;
  let hidden = false;
  let height = 720;
  let loadCount = 0;
  let loader: () => Promise<void> = () => Promise.resolve();
  const environment: HostEnvironment = {
    events, documentEvents,
    style: {
      getPropertyValue: key => styles.get(key) ?? '',
      setProperty: (key, value) => { styles.set(key, value ?? ''); },
      removeProperty: key => { const prior = styles.get(key) ?? ''; styles.delete(key); return prior; },
    },
    href: () => href, bridge: () => bridge, hidden: () => hidden, height: () => height,
    openExternal: url => { opened.push(url); },
    setAttribute: (name, value) => { attributes.set(name, value); },
    loadTelegram: () => { loadCount += 1; return loader(); },
  };
  return {
    environment, events, documentEvents, styles, attributes, opened,
    setHref: (value: string) => { href = value; }, setBridge: (value: unknown) => { bridge = value; },
    setHidden: (value: boolean) => { hidden = value; }, setHeight: (value: number) => { height = value; },
    setLoader: (value: () => Promise<void>) => { loader = value; }, loadCount: () => loadCount,
  };
}

test('Telegram detection requires nonempty launch data and never trusts unsafe user data or stubs', () => {
  let unsafeReads = 0;
  const stub = { initData: '', platform: 'android', colorScheme: 'dark', get initDataUnsafe() { unsafeReads += 1; throw new Error('Never read'); } };
  for (const href of [`${ORIGIN}/`, `${ORIGIN}/?tgWebAppData=`, `${ORIGIN}/#tgWebAppData=%20`, `${ORIGIN}/?tgWebAppPlatform=android`]) {
    assert.equal(hasTelegramLaunchData(href, stub), false);
  }
  for (const href of [`${ORIGIN}/?tgWebAppData=opaque`, `${ORIGIN}/#tgWebAppData=opaque`, `${ORIGIN}/#/trade?tgWebAppData=opaque`]) {
    assert.equal(hasTelegramLaunchData(href, stub), true);
  }
  assert.equal(hasTelegramLaunchData(`${ORIGIN}/`, { initData: 'nonempty' }), true);
  assert.equal(hasTelegramLaunchData(`${ORIGIN}/`, { get initData() { throw new Error('hostile'); } }), false);
  assert.equal(unsafeReads, 0);
});

test('ordinary browser keeps browser sizing and never loads the Telegram SDK', async () => {
  const state = setup(`${ORIGIN}/?tgWebAppPlatform=android`, { initData: '', viewportHeight: 1 });
  const host = createHost(state.environment);
  assert.equal(host.kind, 'browser');
  assert.equal(state.attributes.get('data-host'), 'browser');
  assert.equal(state.styles.get('--host-stable-height'), '720px');
  state.setHeight(640);
  state.events.dispatchEvent(new Event('resize'));
  assert.equal(state.styles.get('--host-viewport-height'), '640px');
  assert.equal(state.styles.get('--host-stable-height'), '640px');
  await tick();
  assert.equal(state.loadCount(), 0);
  host.dispose();
});

test('conditional async Telegram load attaches a previously registered native Back handler', async () => {
  const state = setup(`${ORIGIN}/#tgWebAppData=opaque`);
  const gate = deferred<void>();
  state.setLoader(() => gate.promise);
  const host = createHost(state.environment);
  let backCount = 0;
  host.setBackHandler(() => { backCount += 1; return true; });
  assert.equal(host.kind, 'telegram');
  assert.equal(state.loadCount(), 1);
  assert.equal(state.styles.get('--host-stable-height'), '720px');
  const bridge = new Telegram();
  state.setBridge(bridge);
  state.setHref(`${ORIGIN}/#trade`);
  gate.resolve();
  await tick();
  assert.equal(bridge.readyCount, 1);
  assert.equal(bridge.listeners.get('backButtonClicked')?.size, 1);
  assert.ok(bridge.calls.some(call => call[0] === 'back-show'));
  bridge.emit('backButtonClicked');
  assert.equal(backCount, 1);
  state.events.dispatchEvent(new Event('popstate'));
  assert.equal(backCount, 1, 'Browser history is owned by the overlay UI');
  state.events.dispatchEvent(new Event('focus'));
  assert.equal(bridge.listeners.get('backButtonClicked')?.size, 1);
  assert.equal(bridge.readyCount, 1);
  host.dispose();
});

test('Telegram layout uses stable height only on stable events and combines finite insets', () => {
  const bridge = new Telegram();
  const state = setup(`${ORIGIN}/`, bridge);
  const host = createHost(state.environment);
  assert.equal(state.styles.get('--host-viewport-height'), '800px');
  assert.equal(state.styles.get('--host-stable-height'), '780px');
  assert.equal(state.styles.get('--host-safe-top'), '24px');
  assert.equal(state.styles.get('--host-content-safe-top'), '48px');
  assert.equal(state.styles.get('--host-inset-top'), '48px');
  assert.equal(state.styles.get('--host-inset-bottom'), '20px');
  bridge.viewportHeight = 420;
  bridge.viewportStableHeight = 400;
  bridge.emit('viewportChanged', { isStateStable: false });
  assert.equal(state.styles.get('--host-viewport-height'), '420px');
  assert.equal(state.styles.get('--host-stable-height'), '780px');
  bridge.emit('viewportChanged', { isStateStable: true });
  assert.equal(state.styles.get('--host-stable-height'), '400px');
  bridge.safeAreaInset = { top: -1, right: Infinity, bottom: 99999, left: '16px' };
  bridge.contentSafeAreaInset = { get top() { throw new Error('hostile'); }, right: NaN, bottom: 0, left: 0 };
  bridge.emit('safeAreaChanged');
  for (const side of ['top', 'right', 'bottom', 'left']) assert.equal(state.styles.get(`--host-inset-${side}`), '0px');
  host.dispose();
});

test('user-selected theme remains authoritative across untrusted Telegram theme events', () => {
  const bridge = new Telegram();
  const state = setup(`${ORIGIN}/`, bridge);
  const host = createHost(state.environment);
  host.setTheme('light');
  bridge.emit('themeChanged', { colorScheme: 'dark', background_color: 'url(https://evil.example/)' });
  assert.equal(state.attributes.get('data-theme'), 'light');
  assert.deepEqual(bridge.calls.filter(call => call[0] === 'header').at(-1), ['header', '#f5f4ee']);
  host.setTheme('dark');
  assert.deepEqual(bridge.calls.filter(call => call[0] === 'background').at(-1), ['background', '#101412']);
  host.dispose();
});

test('native Back hides when unconsumed and never closes or navigates the host', () => {
  const bridge = new Telegram();
  const state = setup(`${ORIGIN}/`, bridge);
  const host = createHost(state.environment);
  let handled = 0;
  host.setBackHandler(() => { handled += 1; return false; });
  bridge.emit('backButtonClicked');
  bridge.emit('backButtonClicked');
  assert.equal(handled, 1);
  assert.equal(bridge.calls.at(-1)?.[0], 'back-hide');
  assert.deepEqual(state.opened, []);
  host.dispose();
});

test('foreground refresh is coalesced, payload-free, and gated by document and Telegram visibility', async () => {
  const bridge = new Telegram();
  const state = setup(`${ORIGIN}/`, bridge);
  const host = createHost(state.environment);
  const observed: Event[] = [];
  state.events.addEventListener('fxaeon:foreground', event => { observed.push(event); });
  state.events.dispatchEvent(new Event('focus'));
  state.events.dispatchEvent(new Event('pageshow'));
  state.documentEvents.dispatchEvent(new Event('visibilitychange'));
  await tick();
  assert.equal(observed.length, 1);
  assert.equal('detail' in observed[0]!, false);
  state.setHidden(true);
  state.events.dispatchEvent(new Event('focus'));
  await tick();
  assert.equal(observed.length, 1);
  state.setHidden(false);
  bridge.emit('deactivated');
  state.events.dispatchEvent(new Event('focus'));
  await tick();
  assert.equal(observed.length, 1);
  bridge.emit('activated');
  await tick();
  assert.equal(observed.length, 2);
  state.events.dispatchEvent(new Event('focus'));
  host.dispose();
  await tick();
  assert.equal(observed.length, 2);
});

test('disposal removes exact bridge callbacks and restores prior styles', () => {
  const bridge = new Telegram();
  const state = setup(`${ORIGIN}/`, bridge);
  state.styles.set('--host-stable-height', '600px');
  const host = createHost(state.environment);
  const late = [...bridge.listeners.get('viewportChanged')!][0]!;
  host.dispose();
  for (const listeners of bridge.listeners.values()) assert.equal(listeners.size, 0);
  assert.equal(state.styles.get('--host-stable-height'), '600px');
  assert.equal(state.styles.has('--host-viewport-height'), false);
  late({ isStateStable: true });
  assert.equal(state.styles.get('--host-stable-height'), '600px');
});

test('late SDK resolution after disposal cannot attach bridge listeners', async () => {
  const state = setup(`${ORIGIN}/?tgWebAppData=opaque`);
  const gate = deferred<void>();
  state.setLoader(() => gate.promise);
  const host = createHost(state.environment);
  host.dispose();
  const bridge = new Telegram();
  state.setBridge(bridge);
  gate.resolve();
  await tick();
  assert.equal(bridge.readyCount, 0);
  assert.equal(bridge.listeners.size, 0);
});

test('failed optional SDK load and hostile bridge properties preserve browser-like usability', async () => {
  const state = setup(`${ORIGIN}/?tgWebAppData=opaque`, { get onEvent() { throw new Error('hostile'); } });
  state.setLoader(() => Promise.reject(new Error('Offline')));
  const host = createHost(state.environment);
  await tick();
  assert.equal(host.kind, 'telegram');
  assert.equal(state.styles.get('--host-viewport-height'), '720px');
  host.setTheme('light');
  host.setBackHandler(() => true);
  assert.equal(state.opened.length, 0);
  host.openWallet();
  assert.equal(state.opened.length, 1);
  assert.ok(!state.opened[0]?.includes('opaque'));
  host.dispose();
});

test('wallet handoff strips launch and OAuth credentials while retaining safe route state', () => {
  const source = `${ORIGIN}/trade?market=ETH&tgWebAppData=secret&tgWebAppThemeParams=secret&access_token=secret&code=secret&state=secret#history?tab=recent&initData=secret&signature=secret`;
  assert.equal(sanitizeWalletTarget(source, ORIGIN), `${ORIGIN}/trade?market=ETH#history?tab=recent`);
  assert.equal(sanitizeWalletTarget(`${ORIGIN}/#tgWebAppData=secret&tgWebAppVersion=9.0`, ORIGIN), `${ORIGIN}/`);
});

test('nested same-origin targets are sanitized recursively and cross-origin or executable targets are dropped', () => {
  const source = new URL(`${ORIGIN}/`);
  source.searchParams.set('next', `${ORIGIN}/history?tab=recent&access_token=secret#tgWebAppData=secret`);
  source.searchParams.set('external', 'https://evil.example/?token=secret');
  source.searchParams.set('scheme', 'javascript:alert(1)');
  source.searchParams.set('encoded', encodeURIComponent(encodeURIComponent(`${ORIGIN}/trade?tgWebAppData=secret&market=ETH`)));
  const cleaned = new URL(sanitizeWalletTarget(source.href, ORIGIN));
  assert.equal(cleaned.searchParams.get('next'), `${ORIGIN}/history?tab=recent`);
  assert.equal(cleaned.searchParams.get('encoded'), `${ORIGIN}/trade?market=ETH`);
  assert.equal(cleaned.searchParams.has('external'), false);
  assert.equal(cleaned.searchParams.has('scheme'), false);
  assert.ok(!cleaned.href.includes('secret'));
});

test('handoff rejects insecure, credential-bearing, cross-origin, and ambiguous paths', () => {
  for (const target of [
    'http://fxaeon.example/', 'https://evil.example/', 'https://user:password@fxaeon.example/',
    `${ORIGIN}/%2f%2fevil.example`, `${ORIGIN}/%255c`, `${ORIGIN}/a\nb`, `${ORIGIN}/a\\b`,
    'javascript:alert(1)', 'data:text/html,test',
  ]) assert.throws(() => sanitizeWalletTarget(target, ORIGIN), error => error instanceof AppError && error.code === 'unavailable');
  assert.throws(() => sanitizeWalletTarget(`${ORIGIN}/`, `${ORIGIN}/`));
});

test('MetaMask handoff uses the fixed official navigation endpoint with one encoded dapp target', () => {
  const target = `${ORIGIN}/trade?market=ETH#history`;
  const url = new URL(metaMaskBrowserLink(target, ORIGIN));
  assert.equal(url.origin, 'https://link.metamask.io');
  assert.ok(url.pathname.startsWith('/dapp/'));
  assert.equal(decodeURIComponent(url.pathname.slice('/dapp/'.length)), 'fxaeon.example/trade?market=ETH#history');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
});

test('explicit Telegram handoff uses openLink once and cannot fall back after an issued error', () => {
  const bridge = new Telegram();
  const state = setup(`${ORIGIN}/?tgWebAppData=secret#trade`, bridge);
  const host = createHost(state.environment);
  assert.equal(bridge.calls.filter(call => call[0] === 'open').length, 0);
  host.openWallet();
  const issued = bridge.calls.filter(call => call[0] === 'open');
  assert.equal(issued.length, 1);
  assert.deepEqual(issued[0]?.[2], { try_instant_view: false });
  assert.ok(!(issued[0]?.[1] as string).includes('secret'));
  bridge.openLink = () => { throw new Error('May already have opened'); };
  assert.throws(() => host.openWallet(), error => error instanceof AppError && error.code === 'unavailable');
  assert.deepEqual(state.opened, []);
  host.dispose();
});

test('captured trusted origin rejects a later origin substitution before opening a wallet', () => {
  const state = setup();
  const host = createHost(state.environment);
  state.setHref('https://evil.example/');
  assert.throws(() => host.openWallet());
  assert.deepEqual(state.opened, []);
  host.dispose();
});
