/**
 * Telegram Mini App admission, client side. The `/api/telegram-admission`
 * Pages Function decides from Telegram's signed launch data; this module asks
 * it before the Privy wallet loads, and remembers a granted seat on this device
 * so returning members never wait on the network. The memory is a UX hint for
 * this device only; the server alone admits new Telegram users.
 */
import { getWebApp } from '@/lib/telegram';

/**
 * Off unless the deployment opts in, so an unconfigured service changes
 * nothing. Next inlines the variable; an isolated bundle that never defines
 * it (and has no `process`) stays off instead of failing to load.
 */
export const TELEGRAM_ADMISSION_ENABLED = (() => {
  try { return process.env.NEXT_PUBLIC_TELEGRAM_ADMISSION === 'on'; } catch { return false; }
})();
export const TELEGRAM_ADMISSION_ENDPOINT = '/api/telegram-admission';
export const TELEGRAM_ADMISSION_CACHE_KEY = 'fxaeon:telegram-admission:v1';
export const TELEGRAM_ADMISSION_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_024;

export type TelegramAdmissionIntent = 'enter' | 'join';
export type TelegramAdmission =
  /** The server's decision for this Telegram user. */
  | 'admitted' | 'full' | 'waitlisted'
  /** The launch is too old to check: reopening from Telegram issues a fresh one. */
  | 'expired'
  /** The launch data did not verify, or is missing. */
  | 'rejected'
  /** Network, configuration or storage failure: nothing was decided. */
  | 'unavailable';

/** Telegram's signed launch data, from the bridge or the launch URL's hash. */
export function currentTelegramLaunchData(hash = typeof window === 'undefined' ? '' : window.location.hash): string {
  const fromBridge = getWebApp()?.initData?.trim();
  if (fromBridge) return fromBridge;
  try {
    return new URLSearchParams(hash.replace(/^#/, '')).get('tgWebAppData')?.trim() ?? '';
  } catch {
    return '';
  }
}

/** The launch's Telegram user ID. Unverified: it only keys this device's memory. */
export function launchUserId(launchData: string): number | null {
  try {
    const user: unknown = JSON.parse(new URLSearchParams(launchData).get('user') ?? 'null');
    const id = typeof user === 'object' && user !== null ? (user as { id?: unknown }).id : undefined;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function rememberedAdmission(userId: number | null): boolean {
  if (userId === null || typeof window === 'undefined') return false;
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(TELEGRAM_ADMISSION_CACHE_KEY) ?? 'null');
    return typeof saved === 'object' && saved !== null && (saved as { userId?: unknown }).userId === userId;
  } catch {
    return false;
  }
}

export function rememberAdmission(userId: number | null): void {
  if (userId === null || typeof window === 'undefined') return;
  try { window.localStorage.setItem(TELEGRAM_ADMISSION_CACHE_KEY, JSON.stringify({ userId })); } catch { /* storage blocked */ }
}

export function forgetAdmission(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(TELEGRAM_ADMISSION_CACHE_KEY); } catch { /* storage blocked */ }
}

/** Ask the reviewed same-origin route; every failure is 'unavailable', never a decision. */
export async function requestTelegramAdmission(
  launchData: string,
  intent: TelegramAdmissionIntent,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<TelegramAdmission> {
  if (!launchData) return 'rejected';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TELEGRAM_ADMISSION_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(TELEGRAM_ADMISSION_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ launchData, intent }),
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return 'unavailable';
    const payload: unknown = JSON.parse(text);
    const field = (name: string) => typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)[name] : undefined;
    if (response.ok) {
      const status = field('status');
      return status === 'admitted' || status === 'full' || status === 'waitlisted' ? status : 'unavailable';
    }
    if (response.status === 403) {
      const error = field('error');
      if (error === 'launch_expired') return 'expired';
      if (error === 'launch_rejected') return 'rejected';
    }
    return 'unavailable';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

const PUBLIC_WEB_ROUTES = new Set(['/', '/earn', '/trade', '/borrow', '/positions', '/move', '/send']);

/** The public web app at the same route, with no launch data or form state. */
export function webAppUrl(pathname: string): string {
  const route = pathname.replace(/(.)\/$/, '$1');
  return `https://fxaeon.com${PUBLIC_WEB_ROUTES.has(route) ? route : '/'}`;
}
