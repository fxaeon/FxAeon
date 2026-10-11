/**
 * Telegram Mini App platform integration.
 *
 * Single typed entry point for `window.Telegram.WebApp` — every page was
 * previously reaching for the raw global with `(window as any)`. All helpers
 * are no-ops outside Telegram so the app still works in a plain browser.
 */

export interface TgThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  destructive_text_color?: string;
}

interface TgButton {
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}

export interface TgWebApp {
  initData: string;
  /** Unverified copy of the launch data: a routing hint, never an authentication input. */
  initDataUnsafe?: { start_param?: string; auth_date?: number | string };
  /** Bot API version advertised by the Telegram client (for example `7.10`). */
  version?: string;
  isVersionAtLeast?: (version: string) => boolean;
  /** 'android' | 'ios' | 'tdesktop' | ... — 'unknown' outside Telegram. */
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: TgThemeParams;
  /** Current viewport height; this can shrink while the keyboard is open. */
  viewportHeight?: number;
  viewportStableHeight: number;
  isExpanded: boolean;
  ready: () => void;
  expand: () => void;
  close: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  onEvent: (event: string, cb: () => void) => void;
  offEvent: (event: string, cb: () => void) => void;
  BackButton: TgButton;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
}

function locationHasTelegramLaunchParams(): boolean {
  if (typeof window === 'undefined') return false;
  const locationValue = `${window.location.search}&${window.location.hash}`;
  return /(?:^|[?&#])tgWebApp(?:Data|Version|Platform|ThemeParams)=/i.test(locationValue);
}

function locationHasTelegramMiniAppLaunchData(): boolean {
  if (typeof window === 'undefined') return false;
  return [window.location.search, window.location.hash].some((part) =>
    new URLSearchParams(part.replace(/^[?#]/, '')).getAll('tgWebAppData').some((value) => value.trim().length > 0),
  );
}

/**
 * Detect the Telegram host even when its WebApp bridge has not finished
 * loading.  A Mini App can briefly render before `telegram-web-app.js`
 * attaches `window.Telegram`; treating that interval as an ordinary browser
 * is what used to surface the misleading “No browser wallet detected” error
 * in Telegram.  The user-agent/proxy hints are only host signals — signed
 * `WebApp.initData` remains the authentication authority.
 */
export function looksLikeTelegramUserAgent(userAgent: string): boolean {
  return /Telegram/i.test(userAgent);
}

/** Native host hints can justify waiting for a late bridge, never authenticating. */
export function hasTelegramNativeHostHint(): boolean {
  if (typeof navigator === 'undefined') return false;
  const telegramProxy = typeof window !== 'undefined'
    && typeof (window as Window & { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy !== 'undefined';
  return looksLikeTelegramUserAgent(navigator.userAgent) || telegramProxy;
}

/**
 * Telegram Web hosts Mini Apps in an iframe with an ordinary browser UA.
 * Only its exact HTTPS parent origin justifies waiting for a late SDK after
 * a reload consumes the launch hash. This never selects or authenticates a
 * Privy session: actual launch data is still required after the bounded wait.
 */
export function hasTelegramWebHostHint(): boolean {
  if (typeof window === 'undefined' || window.parent === window) return false;
  try {
    // Chromium exposes the immediate parent origin even when its referrer
    // policy hides the URL. Other browsers can use the document's referrer.
    const parentOrigin = window.location.ancestorOrigins?.[0];
    if (parentOrigin) return parentOrigin === 'https://web.telegram.org';
    return typeof document !== 'undefined'
      && new URL(document.referrer).origin === 'https://web.telegram.org';
  } catch {
    return false;
  }
}

// Capture the launch marker before client navigation or an authentication SDK
// can consume/replace the initial hash. This is only an availability hint;
// signed WebApp.initData remains the authentication authority.
let initialTelegramLaunchSignal = locationHasTelegramLaunchParams();
const initialTelegramMiniAppLaunchData = locationHasTelegramMiniAppLaunchData();

/**
 * Select the Mini App wallet experience only when launch data is present.
 * A Telegram user agent, theme/platform hints, or the ordinary browser script
 * stub alone must not initialize Privy. Keep the initial signal if routing or
 * the SDK consumes the launch URL. This is a UX choice, not authentication:
 * Privy must still verify the signed payload before granting a session.
 */
export function hasTelegramMiniAppLaunchData(): boolean {
  return Boolean(getWebApp()?.initData?.trim())
    || initialTelegramMiniAppLaunchData
    || locationHasTelegramMiniAppLaunchData();
}

/** True when this document was launched with Telegram Web App parameters. */
export function hasTelegramLaunchSignal(): boolean {
  if (locationHasTelegramLaunchParams()) initialTelegramLaunchSignal = true;
  return initialTelegramLaunchSignal;
}

/** The WebApp object, or null outside Telegram / during SSR. */
export function getWebApp(): TgWebApp | null {
  if (typeof window === 'undefined') return null;
  return (window as any).Telegram?.WebApp ?? null;
}

/**
 * Screens a Telegram start parameter can open, as the landing page's section
 * links do with `https://t.me/FxAeonBot?startapp=trade`. Only these exact
 * values route anywhere, and only to these fixed paths, so a start parameter
 * can never name another path or origin.
 */
const START_PARAM_ROUTES: ReadonlyMap<string, string> = new Map([
  ['portfolio', '/'],
  ['trade', '/trade'],
  ['trade-eth', '/trade?market=ETH'],
  ['trade-btc', '/trade?market=BTC'],
  ['positions', '/positions'],
  ['earn', '/earn'],
  ['borrow', '/borrow'],
  ['move', '/move'],
  ['history', '/history'],
]);

/** The route a start parameter opens, or null for anything not on the list. */
export function startParamRoute(startParam: unknown): string | null {
  return typeof startParam === 'string' ? START_PARAM_ROUTES.get(startParam) ?? null : null;
}

export interface TelegramStartRequest {
  startParam: string;
  /** The launch's signed `auth_date`: kept across reloads, new for every launch. */
  launchId: string;
}

function launchIdFrom(value: unknown): string {
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && /^\d{1,12}$/.test(text) ? text : '';
}

/**
 * The start parameter in a launch URL. Telegram puts it in the query as
 * `tgWebAppStartParam`, so the app can open the right screen before the
 * bridge loads, and repeats it as `start_param` in the launch data.
 */
export function readTelegramStartRequest(search: string, hash: string): TelegramStartRequest | null {
  const launchData = new URLSearchParams(new URLSearchParams(hash.replace(/^#/, '')).get('tgWebAppData') ?? '');
  const startParam = new URLSearchParams(search).get('tgWebAppStartParam') || launchData.get('start_param');
  return startParam ? { startParam, launchId: launchIdFrom(launchData.get('auth_date')) } : null;
}

/** The start parameter the Telegram bridge reports for this launch. */
export function webAppStartRequest(webApp: TgWebApp | null): TelegramStartRequest | null {
  const data = webApp?.initDataUnsafe;
  const startParam = typeof data?.start_param === 'string' ? data.start_param : '';
  return startParam ? { startParam, launchId: launchIdFrom(data?.auth_date) } : null;
}

// Read with the launch signal above, before routing replaces the launch URL.
const initialStartRequest = typeof window === 'undefined'
  ? null
  : readTelegramStartRequest(window.location.search, window.location.hash);

/** The start parameter this document was launched with, if any. */
export function launchStartRequest(): TelegramStartRequest | null {
  return initialStartRequest;
}

const START_CLAIM_KEY = 'fxaeon:telegram-start';
const documentStartClaim = { claimed: false };
type StartClaimStorage = Pick<Storage, 'getItem' | 'setItem'>;

function sessionStore(): StartClaimStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage; }
  catch { return undefined; }
}

/**
 * The route a launch's start parameter asks for, handed out once per launch:
 * at most once in a document, and never again after a reload. Telegram keeps
 * a launch's data, `auth_date` included, across reloads of the Mini App and
 * sessionStorage keeps the claim, while every new launch has a new auth_date.
 * The options are test hooks.
 */
export function claimTelegramStartRoute(
  request: TelegramStartRequest | null,
  { storage = sessionStore(), state = documentStartClaim }: { storage?: StartClaimStorage; state?: { claimed: boolean } } = {},
): string | null {
  const route = startParamRoute(request?.startParam);
  if (!request || !route || state.claimed) return null;
  state.claimed = true;
  const claim = `${request.startParam}@${request.launchId}`;
  try {
    if (storage?.getItem(START_CLAIM_KEY) === claim) return null;
    storage?.setItem(START_CLAIM_KEY, claim);
  } catch {
    // Without storage the claim still holds for this document.
  }
  return route;
}

/**
 * Claim a launch's start parameter and return the in-app address to open, or
 * null when nothing is due (no parameter, one not on the list, one already
 * handled, or its screen already showing). The handled parameter leaves the
 * current URL, and the address keeps Telegram's launch hash, which Privy's
 * seamless sign-in may not have read yet.
 */
export function takeTelegramStartHref(
  request: TelegramStartRequest | null,
  options?: Parameters<typeof claimTelegramStartRoute>[1],
): string | null {
  const route = claimTelegramStartRoute(request, options);
  if (!route || typeof window === 'undefined') return null;
  const here = new URL(window.location.href);
  if (here.searchParams.has('tgWebAppStartParam')) {
    here.searchParams.delete('tgWebAppStartParam');
    try {
      window.history.replaceState(window.history.state, '', `${here.pathname}${here.search}${here.hash}`);
    } catch {
      // The claim already prevents a repeat in this session.
    }
  }
  const target = new URL(route, here.origin);
  if (here.pathname === target.pathname && [...target.searchParams].every(([key, value]) => here.searchParams.get(key) === value)) return null;
  let hash = here.hash;
  try {
    decodeURIComponent(hash);
  } catch {
    hash = ''; // The router decodes the hash; launch data is always well formed.
  }
  return `${target.pathname}${target.search}${hash}`;
}

/**
 * Wait a bounded time for Telegram's asynchronously loaded WebApp bridge.
 * This is never authentication proof; it only prevents a slow/failed bridge
 * request from leaving the Mini App in an indefinite loading state.
 */
export async function waitForTelegramWebApp(timeoutMs = 8_000): Promise<TgWebApp | null> {
  const available = getWebApp();
  if (available || typeof window === 'undefined' || timeoutMs <= 0) return available;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const webApp = getWebApp();
      if (webApp || Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer);
        resolve(webApp);
      }
    }, 100);
  });
}

/**
 * True when running inside Telegram.
 *
 * The platform field distinguishes a Telegram WebView even when a launch
 * does not carry signed init data.
 */
export function isTMA(): boolean {
  const tg = getWebApp();
  if (!tg) return false;
  return Boolean(tg.initData) || (Boolean(tg.platform) && tg.platform !== 'unknown');
}

/**
 * Do not infer host support from the presence of the injected script alone.
 * Telegram's script is also loaded in ordinary browsers for wallet/auth
 * integration, where the object can exist without a Telegram client behind
 * it. `getWebApp` intentionally remains unfiltered for those integrations.
 */
function telegramApiAvailable(apiVersion: string): TgWebApp | null {
  const tg = getWebApp();
  if (!tg || !isTMA()) return null;
  try {
    if (tg.isVersionAtLeast) return tg.isVersionAtLeast(apiVersion) ? tg : null;
  } catch {
    return null;
  }
  if (!tg.version) return null;
  const actual = tg.version.split('.').map((part) => Number.parseInt(part, 10));
  const required = apiVersion.split('.').map((part) => Number.parseInt(part, 10));
  if (actual.some((part) => !Number.isFinite(part)) || required.some((part) => !Number.isFinite(part))) return null;
  for (let index = 0; index < required.length; index += 1) {
    const difference = (actual[index] ?? 0) - required[index];
    if (difference !== 0) return difference > 0 ? tg : null;
  }
  return tg;
}

/** Apply Telegram chrome colors only when the real host supports each API. */
export function applyTelegramChromeColors(color: string): void {
  const baseline = telegramApiAvailable('6.1');
  try {
    baseline?.setHeaderColor?.(telegramApiAvailable('6.9') ? color : 'bg_color');
    baseline?.setBackgroundColor?.(color);
  } catch {
    // Host chrome updates are best-effort.
  }
  try {
    telegramApiAvailable('7.10')?.setBottomBarColor?.(color);
  } catch {
    // Older clients do not implement the bottom bar color API.
  }
}

/**
 * True when this document is a Telegram launch, including the short window
 * where the host bridge is still loading or has already consumed the launch
 * hash. This is an intent signal only; signed initData remains the authority
 * for seamless Telegram authentication.
 */
export function isTelegramLaunchContext(): boolean {
  return isTMA() || hasTelegramLaunchSignal() || hasTelegramNativeHostHint();
}

/** Open a reviewed external URL through Telegram when available. */
export function openExternalLink(url: string): boolean {
  if (typeof window === 'undefined') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  haptic('light');
  const telegram = telegramApiAvailable('6.1');
  if (telegram?.openLink) {
    try {
      telegram.openLink(parsed.toString());
      return true;
    } catch {
      // Fall through to the normal browser target.
    }
  }
  return Boolean(window.open(parsed.toString(), '_blank', 'noopener,noreferrer'));
}

/** Signed init data consumed only by Privy's Telegram authentication flow. */
export function getInitData(): string {
  return getWebApp()?.initData ?? '';
}

/**
 * Restore the Telegram launch hash (`#tgWebAppData=…`) onto the current URL.
 *
 * WHY (P0 login fix): Privy's seamless Mini-App login is AUTOMATIC — at
 * provider mount the SDK looks for `#tgWebAppData=…` in `location.hash`,
 * verifies the signed launch params server-side and logs the user in with no
 * popup. Telegram puts that hash on the INITIAL document URL only; client-side
 * routing can otherwise drop it before the Privy provider consumes it, so
 * the SDK silently
 * skips seamless auth. Every other path then falls back to the Telegram
 * login WIDGET (`window.Telegram.Login.auth`) — a popup that cannot post its
 * result back inside Telegram's own webview. That is the exact
 * "Telegram auth failed or was canceled by the client" dead end (the
 * official "logged in successfully" notification fires because the popup
 * half DOES complete server-side).
 *
 * `WebApp.initData` is the same signed payload, available on every page, so
 * we rebuild the hash immediately before the provider initializes (including
 * an explicit reconnect). Never restore it before opening a web login modal:
 * that modal can include location.href in its external return URL. The SDK
 * consumes and cleans the hash. False means no valid hand-off was prepared.
 */
export function restoreTelegramLaunchHash(): boolean {
  if (typeof window === 'undefined') return false;
  const initData = getWebApp()?.initData;
  if (!initData) return false;
  const launchHash = `#tgWebAppData=${encodeURIComponent(initData)}`;
  if (window.location.hash === launchHash) return true;
  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}${launchHash}`
    );
    return true;
  } catch {
    return false;
  }
}

/** Signal readiness + expand to full height. Safe to call repeatedly. */
export function initTelegram(): void {
  const tg = getWebApp();
  if (!tg || !isTMA()) return;
  try {
    tg.ready();
    applyTelegramChromeColors('#07070d');
    if (!tg.isExpanded) tg.expand();
  } catch {
    /* older clients */
  }
}

/** Haptic feedback — silently ignored outside Telegram / on old clients. */
export function haptic(
  kind: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' | 'selection' = 'light'
): void {
  const h = telegramApiAvailable('6.1')?.HapticFeedback;
  if (!h) return;
  try {
    if (kind === 'selection') h.selectionChanged();
    else if (kind === 'success' || kind === 'error' || kind === 'warning')
      h.notificationOccurred(kind);
    else h.impactOccurred(kind);
  } catch {
    /* haptics are best-effort */
  }
}

/**
 * Map Telegram theme params onto CSS custom properties so styles can follow
 * the user's Telegram theme (`--tg-bg`, `--tg-text`, ...). Returns true when
 * params were applied.
 */
export function applyThemeParams(): boolean {
  const tg = isTMA() ? getWebApp() : null;
  if (!tg?.themeParams) return false;
  const root = document.documentElement;
  const map: Record<string, string | undefined> = {
    '--tg-bg': tg.themeParams.bg_color,
    '--tg-secondary-bg': tg.themeParams.secondary_bg_color,
    '--tg-text': tg.themeParams.text_color,
    '--tg-hint': tg.themeParams.hint_color,
    '--tg-link': tg.themeParams.link_color,
    '--tg-button': tg.themeParams.button_color,
    '--tg-button-text': tg.themeParams.button_text_color,
    '--tg-accent': tg.themeParams.accent_text_color,
    '--tg-destructive': tg.themeParams.destructive_text_color,
  };
  let applied = false;
  for (const [prop, value] of Object.entries(map)) {
    if (value) {
      root.style.setProperty(prop, value);
      applied = true;
    }
  }
  return applied;
}

/**
 * Keep dynamic/stable viewport variables in sync so fixed/full-height layouts
 * don't jump when the Telegram keyboard or header collapses the viewport.
 * Returns an unsubscribe function.
 */
export function bindViewportHeight(): () => void {
  const tg = getWebApp();
  const root = document.documentElement;
  const set = () => {
    // Telegram exposes both values: viewportHeight follows transient chrome
    // and the software keyboard, while viewportStableHeight is the settled
    // viewport for persistent layout. visualViewport covers browser keyboard
    // resize when no Telegram bridge is present and during its late load.
    const viewport = typeof window !== 'undefined' ? window.visualViewport : undefined;
    // A pinch zoom changes visualViewport.height without changing the layout
    // viewport. Only use it at the normal scale, where a keyboard resize is
    // the meaningful signal; otherwise keep the layout viewport dimensions so
    // zoom never traps or clips the shell.
    const visualHeight = viewport && Math.abs(viewport.scale - 1) < 0.01 ? viewport.height : undefined;
    const dynamicHeight = tg?.viewportHeight || visualHeight || window.innerHeight;
    const stableHeight = tg?.viewportStableHeight || dynamicHeight;
    root.style.setProperty('--tg-viewport-height', `${Math.max(1, Math.round(dynamicHeight))}px`);
    root.style.setProperty('--tg-viewport-stable-height', `${Math.max(1, Math.round(stableHeight))}px`);
  };
  set();
  const visualViewport = typeof window !== 'undefined' ? window.visualViewport : undefined;
  window.addEventListener('resize', set);
  visualViewport?.addEventListener('resize', set);
  tg?.onEvent('viewportChanged', set);
  return () => {
    window.removeEventListener('resize', set);
    visualViewport?.removeEventListener('resize', set);
    tg?.offEvent('viewportChanged', set);
  };
}

/** Native BackButton: show + wire a handler. Returns cleanup. */
export function showBackButton(onBack: () => void): () => void {
  const tg = telegramApiAvailable('6.1');
  if (!tg?.BackButton) return () => {};
  const handler = () => {
    haptic('light');
    onBack();
  };
  try {
    tg.BackButton.onClick(handler);
    tg.BackButton.show();
  } catch {
    return () => {};
  }
  return () => {
    try {
      tg.BackButton.offClick(handler);
      tg.BackButton.hide();
    } catch {
      /* noop */
    }
  };
}
