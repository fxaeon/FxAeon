'use client';

/**
 * Telegram Mini App platform glue.
 *
 * - calls WebApp.ready() + expand() on mount
 * - keeps dynamic/stable viewport CSS variables in sync (viewportChanged)
 * - tracks an in-app navigation stack so the NATIVE BackButton does the
 *   right thing on every launch type:
 *     · in-app history → router.back()
 *     · launched directly onto a sub-page (inline/menu button) → close()
 *   The old version keyed off initData, which is EMPTY for keyboard
 *   launches, so the back button silently did nothing.
 * - opens the screen a start parameter names (`t.me/FxAeonBot?startapp=trade`)
 *   once per launch, on top of the entry page so BackButton returns to it
 *
 * Everything is a no-op outside Telegram, so the app still works in a browser.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  applyThemeParams,
  bindViewportHeight,
  getWebApp,
  hasTelegramLaunchSignal,
  initTelegram,
  isTMA,
  launchStartRequest,
  showBackButton,
  takeTelegramStartHref,
  waitForTelegramWebApp,
  webAppStartRequest,
  type TelegramStartRequest,
} from '@/lib/telegram';
import { applyTheme } from '@/lib/theme';

/** Screens that act as app roots — BackButton hidden (Telegram shows ✕). */
const ROOT_PATHS = new Set(['/', '/login', '/portfolio']);
const LEGACY_CACHE_NAME = 'fxaeon-static-v1';
const LEGACY_WORKER_RELOAD_KEY = 'fxaeon:legacy-worker-reload';

async function releaseLegacyServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  const isLegacyFxAeonWorker = (worker: ServiceWorker | null | undefined): boolean => {
    if (!worker?.scriptURL) return false;
    try {
      const url = new URL(worker.scriptURL);
      return url.origin === window.location.origin && url.pathname === '/sw.js';
    } catch {
      return false;
    }
  };
  const wasControlled = isLegacyFxAeonWorker(navigator.serviceWorker.controller);
  const registrations = await navigator.serviceWorker.getRegistrations();
  const legacyRegistrations = registrations.filter((registration) =>
    isLegacyFxAeonWorker(registration.active)
    || isLegacyFxAeonWorker(registration.waiting)
    || isLegacyFxAeonWorker(registration.installing),
  );
  await Promise.allSettled(legacyRegistrations.map((registration) => registration.unregister()));

  // Delete only the cache name owned by the retired FxAeon worker. Other
  // origin caches may belong to Privy or the hosting platform.
  if (legacyRegistrations.length > 0 && 'caches' in window) {
    await window.caches.delete(LEGACY_CACHE_NAME);
  }

  // unregister() does not release the controller from the current document.
  // Reload once so an upgraded Telegram tab cannot continue receiving stale
  // financial navigation from the retired worker until it is closed.
  if (wasControlled && sessionStorage.getItem(LEGACY_WORKER_RELOAD_KEY) !== '1') {
    sessionStorage.setItem(LEGACY_WORKER_RELOAD_KEY, '1');
    window.location.reload();
  } else if (!wasControlled) {
    sessionStorage.removeItem(LEGACY_WORKER_RELOAD_KEY);
  }
}

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [telegramReady, setTelegramReady] = useState(() => isTMA());
  // Visited-path stack for back-vs-close decisions.
  const stack = useRef<string[]>([]);
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);

  // One-time platform init + viewport binding + theme application.
  useEffect(() => {
    applyTheme();
    let disposed = false;
    const root = document.documentElement;
    const previousSafeAreaMarker = root.getAttribute('data-tma-safe-area');
    const markTelegramSafeArea = () => {
      if (isTMA()) root.setAttribute('data-tma-safe-area', 'true');
    };
    markTelegramSafeArea();
    let unbindViewport = bindViewportHeight();
    let cleanupTheme = () => {};

    // A start parameter opens its screen straight from the launch URL. The
    // bridge's copy only counts while the visitor is still on the entry page.
    const entryPath = window.location.pathname;
    const openStartScreen = (request: TelegramStartRequest | null) => {
      const href = takeTelegramStartHref(request);
      if (href) routerRef.current.push(href);
    };
    const urlStartRequest = launchStartRequest();
    if (urlStartRequest && (hasTelegramLaunchSignal() || isTMA())) openStartScreen(urlStartRequest);

    const bindTelegram = async () => {
      const tg = getWebApp() ?? (hasTelegramLaunchSignal() ? await waitForTelegramWebApp() : null);
      if (disposed || !tg) return;

      unbindViewport();
      initTelegram();
      markTelegramSafeArea();
      applyThemeParams();
      applyTheme();
      unbindViewport = bindViewportHeight();
      const syncTheme = () => {
        applyThemeParams();
        applyTheme();
      };
      tg.onEvent('themeChanged', syncTheme);
      cleanupTheme = () => tg.offEvent('themeChanged', syncTheme);
      if (!urlStartRequest && isTMA() && window.location.pathname === entryPath) openStartScreen(webAppStartRequest(tg));
      setTelegramReady(isTMA());
    };
    void bindTelegram();

    // Financial state must never be served from the legacy offline cache.
    // Remove any worker installed by an older FxAeon build; the static app
    // remains online-only and always rereads authoritative chain state.
    void releaseLegacyServiceWorker();

    return () => {
      disposed = true;
      unbindViewport();
      cleanupTheme();
      if (previousSafeAreaMarker === null) root.removeAttribute('data-tma-safe-area');
      else root.setAttribute('data-tma-safe-area', previousSafeAreaMarker);
    };
  }, []);

  // Maintain the nav stack.
  useEffect(() => {
    const path = pathname ?? '/';
    const s = stack.current;
    if (s.length >= 2 && s[s.length - 2] === path) {
      s.pop(); // back navigation
    } else if (s[s.length - 1] !== path) {
      s.push(path); // forward navigation
    }
  }, [pathname]);

  // Native BackButton on sub-pages: back through in-app history, close when
  // the sub-page was the entry point.
  useEffect(() => {
    if (!telegramReady || !isTMA() || ROOT_PATHS.has(pathname ?? '/')) return;
    return showBackButton(() => {
      let consumed = false;
      window.dispatchEvent(new CustomEvent<{ consume: () => void; isConsumed: () => boolean }>('fxaeon:telegram-back', {
        detail: { consume: () => { consumed = true; }, isConsumed: () => consumed },
      }));
      if (consumed) return;
      if (stack.current.length > 1) router.back();
      else getWebApp()?.close();
    });
  }, [pathname, router, telegramReady]);

  return <>{children}</>;
}
