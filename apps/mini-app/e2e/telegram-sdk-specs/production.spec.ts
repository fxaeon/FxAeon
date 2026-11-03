import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { TgWebApp } from '../../src/lib/telegram';

const dist = resolve(__dirname, '../../dist');
const origin = 'https://fxaeon.test';
const launchData = 'user=%7B%22id%22%3A12345%7D&hash=fixture';
const challenge = Buffer.from('fixture-registration-challenge').toString('base64url');
type NativeEvent = { name: string; data: { url?: string; try_instant_view?: boolean }; gestureAge: number; trusted: boolean };
type HostWindow = Window & { Telegram?: { WebApp: TgWebApp }; nativeEvents: NativeEvent[] };

async function mount(page: Page, platform = 'android', options: { rejectLaunch?: boolean; blockSdk?: boolean; capabilityPath?: string } = {}) {
  const requests: Array<Record<string, unknown>> = [];
  const remoteScripts: string[] = [];
  const errors: string[] = [];
  const logs: string[] = [];
  page.on('console', message => logs.push(message.text()));
  page.on('pageerror', error => errors.push(error.message));
  // Only the native Android/iOS transport is simulated. The official SDK must
  // construct WebApp itself from the launch hash, before app hydration.
  await page.addInitScript(() => {
    const host = window as unknown as HostWindow & { TelegramWebviewProxy: { postEvent: (name: string, data: string) => void } };
    host.nativeEvents = [];
    let gestureAt = -Infinity, trusted = false;
    document.addEventListener('click', event => { gestureAt = performance.now(); trusted = event.isTrusted; }, true);
    host.TelegramWebviewProxy = { postEvent(name, data) {
      host.nativeEvents.push({ name, data: JSON.parse(data || '{}'), gestureAge: performance.now() - gestureAt, trusted });
    } };
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      if (route.request().resourceType() === 'script') remoteScripts.push(url.href);
      return route.abort(); // telegram.org and every other remote host unavailable.
    }
    if (url.pathname === '/api/telegram-wallet') {
      const body = route.request().postDataJSON(); requests.push(body);
      if (options.capabilityPath) return route.fulfill({ status: 403, json: { error: 'handoff_invalid' } });
      if (options.rejectLaunch) return route.fulfill({ status: 403, json: { error: 'launch_rejected' } });
      expect(body.launchData).toBe(launchData);
      switch (body.action) {
        case 'status': return route.fulfill({ json: { state: 'approved', hasCredential: false, cohortFull: false, telegramNotify: false, emailVerified: false } });
        case 'register/options': return route.fulfill({ json: { challengeId: 'registration-1', options: { challenge } } });
        case 'handoff/create':
          // Exceed Telegram's 1s interaction TTL: opening from this continuation
          // would be ignored on a real phone.
          await new Promise(resolve => setTimeout(resolve, 1200));
          return route.fulfill({ json: { url: `${origin}/wallet-approval#token=fixture-ticket` } });
        case 'handoff/status': return route.fulfill({ json: { state: 'pending' } });
        default: throw new Error(`Unexpected wallet action: ${body.action}`);
      }
    }
    if (options.blockSdk && url.pathname === '/vendor/telegram/telegram-web-app.js') return route.abort();
    let file = resolve(dist, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
    if (!file.startsWith(`${dist}${sep}`)) return route.abort();
    if (!extname(file)) file += '.html';
    try {
      const body = await readFile(file);
      const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' } as Record<string, string>)[extname(file)] || 'application/octet-stream';
      return route.fulfill({ body, contentType });
    } catch { return route.fulfill({ status: 404, body: 'Not found' }); }
  });
  const hash = options.capabilityPath ? `#token=capability-secret&commitment=${'a'.repeat(43)}` : `#${new URLSearchParams({ tgWebAppData: launchData, tgWebAppPlatform: platform, tgWebAppVersion: '8.0' })}`;
  await page.goto(`${origin}${options.capabilityPath || '/'}${hash}`, { waitUntil: 'domcontentloaded' });
  return { requests, remoteScripts, errors, logs };
}

const openEvents = (page: Page) => page.evaluate(() => (window as unknown as HostWindow).nativeEvents.filter(event => event.name === 'web_app_open_link'));

for (const platform of ['android', 'ios']) test(`${platform} real SDK boots with remote hosts blocked and first registration opens on a fresh click`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 568 });
  const { requests, remoteScripts, errors, logs } = await mount(page, platform);
  await expect(page.getByRole('button', { name: 'Set up my wallet' })).toBeVisible();
  expect(await page.evaluate(() => {
    const app = (window as unknown as HostWindow).Telegram?.WebApp;
    return { platform: app?.platform, initData: app?.initData, ready: typeof app?.ready, open: typeof app?.openLink, notify: typeof app?.requestWriteAccess };
  })).toEqual({ platform, initData: launchData, ready: 'function', open: 'function', notify: 'function' });
  await page.getByRole('button', { name: 'Set up my wallet' }).click();
  await expect(page.getByText('Checking Telegram…')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create passkey' })).toHaveCount(0);
  expect(requests.some(request => request.action === 'register/options')).toBe(false);
  await page.getByRole('button', { name: 'Continue in browser' }).click();
  await expect(page.getByText('Ready to open your browser.')).toBeVisible();
  expect(await openEvents(page)).toEqual([]);
  expect(requests.some(request => request.action === 'handoff/status')).toBe(false);
  await page.getByRole('button', { name: 'Continue in browser' }).click();
  await expect.poll(() => openEvents(page)).toHaveLength(1);
  const [opened] = await openEvents(page);
  expect(opened.trusted).toBe(true); expect(opened.gestureAge).toBeLessThan(1000);
  expect(opened.data.try_instant_view).toBe(false);
  const url = new URL(opened.data.url!);
  expect(url.origin + url.pathname).toBe(`${origin}/wallet-approval`);
  expect(url.search).toBe('');
  expect(new URLSearchParams(url.hash.slice(1)).get('commitment')).toBe(createHash('sha256').update(Buffer.from(challenge, 'base64url')).digest('base64url'));
  await expect.poll(() => requests.some(request => request.action === 'handoff/status')).toBe(true);
  expect(requests.some(request => request.action === 'register/complete')).toBe(false);
  await page.getByRole('button', { name: 'Stop waiting' }).click();
  expect(remoteScripts.filter(url => new URL(url).hostname.endsWith('telegram.org'))).toEqual([]);
  expect(logs.join('\n')).not.toContain('fixture-ticket');
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain('fixture-ticket');
  expect(errors).toEqual([]);
});

for (const path of ['/wallet-approval', '/invite']) test(`production capability route ${path} never persists or logs its token`, async ({ page }) => {
  const { requests, logs } = await mount(page, 'android', { capabilityPath: path });
  await expect(page).toHaveURL(`${origin}${path}`);
  expect(await page.evaluate(() => Boolean((window as unknown as HostWindow).Telegram))).toBe(false);
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain('capability-secret');
  expect(logs.join('\n')).not.toContain('capability-secret');
  expect(requests.some(request => request.action === 'email/confirm' || request.action === 'handoff/complete')).toBe(false);
});

test('real SDK preserves launch params across hash removal and reload', async ({ page }) => {
  const { requests } = await mount(page);
  await expect(page.getByRole('button', { name: 'Set up my wallet' })).toBeVisible();
  await page.evaluate(() => history.replaceState({}, '', '/'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Set up my wallet' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as HostWindow).Telegram?.WebApp.platform)).toBe('android');
  expect(requests.filter(request => request.action === 'status')).toHaveLength(2);
});

test('platform hint cannot bypass a rejected signed launch', async ({ page }) => {
  const { requests } = await mount(page, 'android', { rejectLaunch: true });
  await expect(page.getByText('Open FxAeon from its Telegram bot.')).toBeVisible();
  expect(requests.every(request => request.action === 'status')).toBe(true);
  expect(await openEvents(page)).toEqual([]);
});

test('blocked local SDK stays closed without desktop or native fallback', async ({ page }) => {
  const { requests } = await mount(page, 'android', { blockSdk: true });
  await page.getByRole('button', { name: 'Set up my wallet' }).click();
  await expect(page.getByText('Checking Telegram…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue in browser' })).toBeEnabled({ timeout: 12_000 });
  await page.getByRole('button', { name: 'Continue in browser' }).click();
  await expect(page.getByRole('alert')).toContainText('Telegram isn’t ready.');
  expect(requests.every(request => request.action === 'status')).toBe(true);
  expect(await openEvents(page)).toEqual([]);
});
