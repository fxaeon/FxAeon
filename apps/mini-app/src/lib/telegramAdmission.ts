/** Shared Telegram launch parsing and public web handoff; never authentication. */
import { getWebApp } from '@/lib/telegram';

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

const PUBLIC_WEB_ROUTES = new Set(['/', '/earn', '/trade', '/borrow', '/positions', '/move', '/send']);

/** The public web app at the same route, with no launch data or form state. */
export function webAppUrl(pathname: string): string {
  const route = pathname.replace(/(.)\/$/, '$1');
  return `https://fxaeon.com${PUBLIC_WEB_ROUTES.has(route) ? route : '/'}`;
}
