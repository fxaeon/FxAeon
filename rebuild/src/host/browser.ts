import type { HostPort } from '../domain/ports.ts';
import { AppError } from '../domain/errors.ts';
import { metaMaskBrowserLink, walletNavigation } from './handoff.ts';
import { walletPlatform } from '../wallet/catalog.ts';
import type { WalletPlatform } from '../wallet/catalog.ts';

type Method = (...args: unknown[]) => unknown;
type Style = Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty' | 'getPropertyValue'>;

export interface HostEnvironment {
  readonly events: EventTarget;
  readonly documentEvents: EventTarget;
  readonly style: Style;
  readonly href: () => string;
  readonly bridge: () => unknown;
  readonly hidden: () => boolean;
  readonly height: () => number;
  readonly openExternal: (url: string) => void;
  readonly setAttribute: (name: string, value: string) => void;
  readonly loadTelegram?: () => Promise<void>;
  readonly platform?: () => WalletPlatform;
  /** A native bridge or exact Telegram iframe permits waiting, never login. */
  readonly mayRestoreTelegram?: () => boolean;
  readonly resolvedKind?: 'browser' | 'telegram';
}

function get(value: unknown, key: string): unknown {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return undefined;
  try { return Reflect.get(value, key); } catch { return undefined; }
}

function invoke(value: unknown, name: string, ...args: unknown[]): boolean {
  const method = get(value, name);
  if (typeof method !== 'function') return false;
  try { Reflect.apply(method as Method, value, args); return true; } catch { return false; }
}

/** Detection selects host behavior only. It does not validate or retain data. */
export function hasTelegramLaunchData(href: string, bridge: unknown): boolean {
  const direct = get(bridge, 'initData');
  if (typeof direct === 'string' && direct.trim().length > 0) return true;
  try {
    const url = new URL(href);
    const fragment = url.hash.slice(1);
    const queryAt = fragment.indexOf('?');
    for (const parameters of [url.searchParams, new URLSearchParams(queryAt >= 0 ? fragment.slice(queryAt + 1) : fragment)]) {
      if (parameters.getAll('tgWebAppData').some(value => value.trim().length > 0)) return true;
    }
  } catch { /* A malformed URL supplies no host identity. */ }
  return false;
}

const telegramLoads = new WeakMap<Document, Promise<void>>();
function loadOfficialTelegram(document: Document): Promise<void> {
  const existing = telegramLoads.get(document);
  if (existing) return existing;
  const loading = new Promise<void>((resolve, reject) => {
    const source = 'https://telegram.org/js/telegram-web-app.js';
    const script = document.createElement('script');
    script.src = source;
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => finish(false), 8_000);
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (ok) resolve();
      else { script.remove(); reject(new Error('Telegram host bridge unavailable')); }
    };
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    try { document.head.append(script); } catch { finish(false); }
  });
  telegramLoads.set(document, loading);
  return loading;
}

function defaultEnvironment(): HostEnvironment {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    const values = new Map<string, string>();
    return {
      events: new EventTarget(), documentEvents: new EventTarget(),
      style: { setProperty: (key, value) => { values.set(key, value ?? ''); }, getPropertyValue: key => values.get(key) ?? '', removeProperty: key => { const old = values.get(key) ?? ''; values.delete(key); return old; } },
      href: () => 'https://fxaeon.com/', bridge: () => undefined, hidden: () => false, height: () => 0,
      openExternal: () => undefined, setAttribute: () => undefined,
    };
  }
  return {
    events: window, documentEvents: document, style: document.documentElement.style,
    href: () => window.location.href,
    bridge: () => get(get(window, 'Telegram'), 'WebApp'),
    hidden: () => document.hidden, height: () => window.innerHeight,
    openExternal: url => { window.open(url, '_blank', 'noopener,noreferrer'); },
    setAttribute: (name, value) => document.documentElement.setAttribute(name, value),
    loadTelegram: () => loadOfficialTelegram(document),
    mayRestoreTelegram: () => {
      if (typeof get(get(window, 'TelegramWebviewProxy'), 'postEvent') === 'function') return true;
      try { return window.top !== window && new URL(document.referrer).origin === 'https://web.telegram.org'; }
      catch { return false; }
    },
  };
}

/** Resolve the document's host once, before routing can replace a launch hash. */
export async function resolveHostEnvironment(environment: HostEnvironment = defaultEnvironment(), maxWaitMs = 8_000): Promise<HostEnvironment> {
  const present = () => hasTelegramLaunchData(environment.href(), environment.bridge());
  const detected = present();
  let mayWait = detected;
  try { mayWait ||= environment.mayRestoreTelegram?.() === true; } catch { /* No evidence means ordinary web. */ }
  if (!mayWait) return { ...environment, resolvedKind: 'browser' };
  const limit = Number.isFinite(maxWaitMs) && maxWaitMs > 0 ? Math.min(maxWaitMs, 8_000) : 8_000;
  if (detected && typeof get(environment.bridge(), 'onEvent') === 'function') return { ...environment, resolvedKind: 'telegram' };
  let stop: (() => void) | undefined;
  await new Promise<void>(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true; clearTimeout(timer); clearInterval(interval);
      environment.events.removeEventListener('message', inspect);
      resolve();
    };
    const inspect = () => { if (present() && typeof get(environment.bridge(), 'onEvent') === 'function') finish(); };
    const timer = setTimeout(finish, limit);
    const interval = setInterval(inspect, Math.min(25, limit));
    stop = finish;
    environment.events.addEventListener('message', inspect);
    try { void environment.loadTelegram?.().then(inspect).catch(() => { if (detected) finish(); }); }
    catch { if (detected) finish(); }
    inspect();
  });
  stop?.();
  // Only the boolean survives. No launch-bearing URL or signed payload is kept.
  return { ...environment, resolvedKind: detected || present() ? 'telegram' : 'browser' };
}

function pixels(value: unknown, maximum = 16_384): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum ? value : null;
}

/** Browser layout remains usable if the optional Telegram API cannot load. */
export function createHost(environment: HostEnvironment = defaultEnvironment()): HostPort {
  const kind = environment.resolvedKind ?? (hasTelegramLaunchData(environment.href(), environment.bridge()) ? 'telegram' : 'browser');
  // Retain the origin and host boolean only, never the launch-bearing href.
  let trustedOrigin = '';
  try { trustedOrigin = new URL(environment.href()).origin; } catch { /* Handoff fails closed. */ }
  let disposed = false;
  let bridge: unknown;
  let backHandler: (() => boolean) | null = null;
  let theme: 'dark' | 'light' = 'dark';
  let stableHeight = 0;
  let foregroundQueued = false;
  let hostActive = true;
  const previousStyle = new Map<string, string>();
  let removeBridgeListeners: () => void = () => undefined;

  function style(key: string, value: string): void {
    if (!previousStyle.has(key)) previousStyle.set(key, environment.style.getPropertyValue(key));
    environment.style.setProperty(key, value);
  }

  function updateViewport(stable: boolean): void {
    if (disposed) return;
    const height = pixels(get(bridge, 'viewportHeight')) || pixels(environment.height()) || 0;
    if (stable || stableHeight === 0) stableHeight = pixels(get(bridge, 'viewportStableHeight')) || height;
    style('--host-viewport-height', height > 0 ? `${height}px` : '100dvh');
    style('--host-stable-height', stableHeight > 0 ? `${stableHeight}px` : '100dvh');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const safe = pixels(get(get(bridge, 'safeAreaInset'), side), 512) ?? 0;
      const content = pixels(get(get(bridge, 'contentSafeAreaInset'), side), 512) ?? 0;
      style(`--host-safe-${side}`, `${safe}px`);
      style(`--host-content-safe-${side}`, `${content}px`);
      style(`--host-inset-${side}`, `${Math.max(safe, content)}px`);
    }
  }

  function applyTheme(): void {
    if (disposed) return;
    environment.setAttribute('data-theme', theme);
    const color = theme === 'dark' ? '#0b0d0e' : '#fbfcfa';
    invoke(bridge, 'setHeaderColor', color);
    invoke(bridge, 'setBackgroundColor', color);
    invoke(bridge, 'setBottomBarColor', color);
  }

  function updateBack(): void { invoke(get(bridge, 'BackButton'), backHandler ? 'show' : 'hide'); }
  function back(): void {
    if (disposed || !backHandler) return;
    // The controller owns route/history state. Host Back dismisses its top
    // surface; it never closes Telegram or resumes a financial operation.
    try { if (!backHandler()) { backHandler = null; updateBack(); } } catch { /* Keep the page usable. */ }
  }

  function foreground(): void {
    if (disposed || environment.hidden() || !hostActive || foregroundQueued) return;
    foregroundQueued = true;
    queueMicrotask(() => {
      foregroundQueued = false;
      if (!disposed && !environment.hidden() && hostActive) environment.events.dispatchEvent(new Event('fxaeon:foreground'));
    });
  }

  function attachBridge(): void {
    if (disposed || kind !== 'telegram') return;
    const next = environment.bridge();
    if (!next || next === bridge || typeof get(next, 'onEvent') !== 'function' || typeof get(next, 'offEvent') !== 'function') return;
    removeBridgeListeners();
    bridge = next;
    hostActive = get(bridge, 'isActive') !== false;
    const on = get(bridge, 'onEvent');
    const off = get(bridge, 'offEvent');
    const captured = bridge;
    const bindings: [string, (event?: unknown) => void][] = [
      ['viewportChanged', event => updateViewport(get(event, 'isStateStable') === true)],
      ['safeAreaChanged', () => updateViewport(false)],
      ['contentSafeAreaChanged', () => updateViewport(false)],
      ['themeChanged', applyTheme],
      ['backButtonClicked', back],
      ['activated', () => { hostActive = true; foreground(); }],
      ['deactivated', () => { hostActive = false; }],
    ];
    if (typeof on === 'function' && typeof off === 'function') {
      for (const [name, listener] of bindings) {
        const guarded = (event?: unknown) => { if (!disposed && bridge === captured) listener(event); };
        bindings[bindings.findIndex(item => item[0] === name)] = [name, guarded];
        try { Reflect.apply(on as Method, captured, [name, guarded]); } catch { /* Browser fallback remains available. */ }
      }
      removeBridgeListeners = () => { for (const [name, listener] of bindings) { try { Reflect.apply(off as Method, captured, [name, listener]); } catch { /* Retired callbacks are fenced. */ } } };
    } else removeBridgeListeners = () => undefined;
    updateViewport(true);
    updateBack();
    applyTheme();
    invoke(bridge, 'ready');
  }

  function resume(): void { attachBridge(); updateViewport(kind === 'browser'); foreground(); }
  function resize(): void { updateViewport(kind === 'browser'); }
  environment.setAttribute('data-host', kind);
  environment.events.addEventListener('focus', resume);
  environment.events.addEventListener('pageshow', resume);
  environment.events.addEventListener('resize', resize);
  environment.documentEvents.addEventListener('visibilitychange', resume);
  attachBridge();
  updateViewport(true);
  if (kind === 'telegram' && !bridge && environment.loadTelegram) {
    void environment.loadTelegram().then(() => { if (!disposed) attachBridge(); }).catch(() => { /* No authentication or authority is inferred. */ });
  }

  return {
    kind,
    setBackHandler(handler) { if (!disposed) { backHandler = handler; attachBridge(); updateBack(); } },
    setTheme(value) { if (!disposed) { theme = value; applyTheme(); } },
    openWallet(choiceId) {
      if (disposed) return;
      const destination = choiceId
        ? walletNavigation(choiceId, environment.href(), trustedOrigin, environment.platform?.() ?? walletPlatform())
        : metaMaskBrowserLink(environment.href(), trustedOrigin);
      const openLink = get(bridge, 'openLink');
      if (kind === 'telegram' && typeof openLink === 'function') {
        try { Reflect.apply(openLink as Method, bridge, [destination, { try_instant_view: false }]); }
        catch { throw new AppError('unavailable', 'Telegram could not verify the wallet-browser handoff. Open the secure FxAeon site in your wallet browser.'); }
        return;
      }
      environment.openExternal(destination);
    },
    dispose() {
      if (disposed) return;
      backHandler = null;
      updateBack();
      disposed = true;
      removeBridgeListeners();
      bridge = undefined;
      environment.events.removeEventListener('focus', resume);
      environment.events.removeEventListener('pageshow', resume);
      environment.events.removeEventListener('resize', resize);
      environment.documentEvents.removeEventListener('visibilitychange', resume);
      for (const [key, value] of previousStyle) { if (value) environment.style.setProperty(key, value); else environment.style.removeProperty(key); }
    },
  };
}
