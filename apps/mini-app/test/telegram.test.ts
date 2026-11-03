import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTelegramChromeColors, applyThemeParams, haptic, initTelegram, looksLikeTelegramUserAgent, openExternalLink, waitForTelegramWebApp, type TgWebApp } from '../src/lib/telegram';

type FakeWindow = {
  Telegram?: { WebApp?: TgWebApp };
  open?: (url: string, target?: string, features?: string) => unknown;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  location: { search: string; hash: string };
};

function installWindow(webApp?: TgWebApp): { fake: FakeWindow; restore: () => void } {
  const globalObject = globalThis as unknown as { window?: FakeWindow };
  const previous = globalObject.window;
  const fake: FakeWindow = { Telegram: webApp ? { WebApp: webApp } : undefined, setInterval, clearInterval, location: { search: '', hash: '' } };
  globalObject.window = fake;
  return {
    fake,
    restore: () => {
      if (previous) globalObject.window = previous;
      else delete globalObject.window;
    },
  };
}

function bridge(): TgWebApp {
  return { initData: 'signed', platform: 'tdesktop', version: '7.10', isVersionAtLeast: () => true } as unknown as TgWebApp;
}

test('Telegram host detection covers mobile and desktop WebView user agents', () => {
  assert.equal(looksLikeTelegramUserAgent('Mozilla/5.0 Telegram-Android/11.0'), true);
  assert.equal(looksLikeTelegramUserAgent('Mozilla/5.0 Telegram-iOS/10.0'), true);
  assert.equal(looksLikeTelegramUserAgent('Mozilla/5.0 TelegramDesktop/5.8'), true);
  assert.equal(looksLikeTelegramUserAgent('Mozilla/5.0 Chrome/140.0 Safari/537.36'), false);
});

test('Telegram bridge availability resolves immediately when already present', async () => {
  const { restore } = installWindow(bridge());
  try {
    assert.equal(await waitForTelegramWebApp(50), (globalThis as unknown as { window: FakeWindow }).window.Telegram?.WebApp);
  } finally {
    restore();
  }
});

test('Telegram bridge availability tolerates a delayed host injection', async () => {
  const { fake, restore } = installWindow();
  try {
    const pending = waitForTelegramWebApp(500);
    setTimeout(() => { fake.Telegram = { WebApp: bridge() }; }, 20);
    assert.ok(await pending);
  } finally {
    restore();
  }
});

test('Telegram bridge availability fails closed after a bounded timeout', async () => {
  const { restore } = installWindow();
  try {
    assert.equal(await waitForTelegramWebApp(20), null);
  } finally {
    restore();
  }
});

test('default bridge wait is shared across routing and admission, even after timeout', async t => {
  const { fake, restore } = installWindow();
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  fake.setInterval = setInterval; fake.clearInterval = clearInterval;
  const intervals = t.mock.method(fake, 'setInterval');
  try {
    const routing = waitForTelegramWebApp();
    const admission = waitForTelegramWebApp();
    assert.equal(intervals.mock.callCount(), 1);
    t.mock.timers.tick(8_000);
    assert.equal(await routing, null);
    assert.equal(await admission, null);
    assert.equal(await waitForTelegramWebApp(), null);
    assert.equal(intervals.mock.callCount(), 1, 'a later gate must not start another eight-second wait');
    fake.Telegram = { WebApp: bridge() };
    assert.equal(await waitForTelegramWebApp(), fake.Telegram.WebApp, 'late bridge arrival remains usable');
  } finally {
    restore(); t.mock.timers.reset();
  }
});

test('external links use Telegram openLink when the host provides it', () => {
  const linkCalls: string[] = [];
  const webApp = { ...bridge(), openLink: (url: string) => linkCalls.push(url) } as TgWebApp;
  const { restore } = installWindow(webApp);
  try {
    assert.equal(openExternalLink('https://etherscan.io/tx/0xabc'), true);
    assert.deepEqual(linkCalls, ['https://etherscan.io/tx/0xabc']);
  } finally {
    restore();
  }
});

test('external links reject non-HTTPS URLs without opening a browser target', () => {
  let opened = false;
  const { fake, restore } = installWindow();
  fake.open = () => { opened = true; return {}; };
  try {
    assert.equal(openExternalLink('javascript:alert(1)'), false);
    assert.equal(opened, false);
  } finally {
    restore();
  }
});

test('browser-injected Telegram stub never receives Telegram-only calls', () => {
  let calls = 0;
  const webApp = {
    initData: '', platform: 'unknown', version: '6.0', colorScheme: 'dark', themeParams: { bg_color: '#123456' },
    ready: () => { calls += 1; }, expand: () => { calls += 1; }, isExpanded: false,
    setHeaderColor: () => { calls += 1; }, setBackgroundColor: () => { calls += 1; }, setBottomBarColor: () => { calls += 1; },
    HapticFeedback: { impactOccurred: () => { calls += 1; }, notificationOccurred: () => { calls += 1; }, selectionChanged: () => { calls += 1; } },
  } as unknown as TgWebApp;
  const { restore } = installWindow(webApp);
  const previousDocument = (globalThis as unknown as { document?: unknown }).document;
  (globalThis as unknown as { document?: unknown }).document = { documentElement: { style: { setProperty: () => { calls += 1; } } } };
  try {
    initTelegram();
    haptic('light');
    applyTelegramChromeColors('#000000');
    assert.equal(applyThemeParams(), false);
    assert.equal(calls, 0);
  } finally {
    restore();
    if (previousDocument) (globalThis as unknown as { document?: unknown }).document = previousDocument;
    else delete (globalThis as unknown as { document?: unknown }).document;
  }
});

test('supported Telegram host receives haptics and version-gated chrome colors', () => {
  const calls: string[] = [];
  const webApp = {
    ...bridge(), version: '7.10', isVersionAtLeast: (version: string) => {
      const [major, minor] = version.split('.').map(Number);
      const [hostMajor, hostMinor] = '7.10'.split('.').map(Number);
      return hostMajor > major || (hostMajor === major && hostMinor >= minor);
    },
    ready: () => calls.push('ready'), expand: () => calls.push('expand'), isExpanded: false,
    setHeaderColor: () => calls.push('header'), setBackgroundColor: () => calls.push('background'), setBottomBarColor: () => calls.push('bottom'),
    HapticFeedback: { impactOccurred: () => calls.push('haptic'), notificationOccurred: () => calls.push('notification'), selectionChanged: () => calls.push('selection') },
  } as unknown as TgWebApp;
  const { restore } = installWindow(webApp);
  try {
    initTelegram();
    haptic('light');
    applyTelegramChromeColors('#000000');
    assert.deepEqual(calls, ['ready', 'header', 'background', 'bottom', 'expand', 'haptic', 'header', 'background', 'bottom']);
  } finally {
    restore();
  }
});

test('Telegram 6.0 host skips APIs that require Bot API 6.1 or later', () => {
  const calls: string[] = [];
  const webApp = {
    ...bridge(), version: '6.0', isVersionAtLeast: () => false,
    setHeaderColor: () => calls.push('header'), setBackgroundColor: () => calls.push('background'), setBottomBarColor: () => calls.push('bottom'),
    HapticFeedback: { impactOccurred: () => calls.push('haptic') },
  } as unknown as TgWebApp;
  const { restore } = installWindow(webApp);
  try {
    haptic('light');
    applyTelegramChromeColors('#000000');
    assert.deepEqual(calls, []);
  } finally {
    restore();
  }
});

test('Telegram 6.1 uses a theme header key while allowing custom background colors', () => {
  const calls: string[] = [];
  const { restore } = installWindow({
    ...bridge(), version: '6.1', isVersionAtLeast: undefined,
    setHeaderColor: (color: string) => calls.push(`header:${color}`),
    setBackgroundColor: (color: string) => calls.push(`background:${color}`),
    setBottomBarColor: () => calls.push('bottom'),
  } as TgWebApp);
  try {
    applyTelegramChromeColors('#123456');
    assert.deepEqual(calls, ['header:bg_color', 'background:#123456']);
  } finally {
    restore();
  }
});
