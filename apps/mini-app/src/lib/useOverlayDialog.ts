'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { useRouter } from 'next/navigation';

type OverlayDialogOptions = {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Opt-in fallback when this dialog's opener was removed by its result. */
  restoreFocusFallback?: () => HTMLElement | null;
};

type OverlayEntry = { id: number; element: HTMLElement; href: string; previousState: () => unknown; navigate: (href: string) => void; dismiss: () => void };
const overlayStack: OverlayEntry[] = [];
let nextOverlayId = 0;
let originalBodyOverflow = '';
type PendingHistoryTraversal = {
  href: string;
  expectedState: string;
  expectedEntry: Record<string, unknown>;
  queuedOpens: Array<() => void>;
  queuedCloses: Array<() => void>;
  queuedNavigations: Array<() => void>;
};
let pendingHistoryTraversal: PendingHistoryTraversal | null = null;
type PendingOverlayNavigation = { href: string; sourceHref: string; expectedState: string; sameUrl: boolean; navigate: (href: string) => void };
let pendingOverlayNavigation: PendingOverlayNavigation | null = null;
let historyCoordinatorInstalled = false;
const consumedHistoryEvents = new WeakSet<Event>();

function historyStateRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? { ...value as Record<string, unknown> } : {};
}

function installHistoryCoordinator(): void {
  if (historyCoordinatorInstalled) return;
  historyCoordinatorInstalled = true;
  window.addEventListener('popstate', (event) => {
    const navigation = pendingOverlayNavigation;
    if (navigation && JSON.stringify(event.state) === navigation.expectedState) {
      pendingOverlayNavigation = null;
      event.stopImmediatePropagation();
      for (const entry of [...overlayStack].reverse()) if (entry.href === navigation.sourceHref) entry.dismiss();
      if (!navigation.sameUrl) navigation.navigate(navigation.href);
      return;
    }
    const pending = pendingHistoryTraversal;
    if (!pending || JSON.stringify(event.state) !== pending.expectedState) return;
    pendingHistoryTraversal = null;
    consumedHistoryEvents.add(event);
    for (const close of pending.queuedCloses) close();
    for (const open of pending.queuedOpens) open();
    for (const navigate of pending.queuedNavigations) navigate();
  }, true);
  window.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor || anchor.target && anchor.target !== '_self' || anchor.hasAttribute('download')) return;
    let destination: URL;
    try { destination = new URL(anchor.href); } catch { return; }
    if (destination.origin !== window.location.origin) return;
    const sourceHref = window.location.href;
    const activeEntries = overlayStack.filter((entry) => entry.href === sourceHref);
    if (activeEntries.length === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pendingOverlayNavigation || pendingHistoryTraversal?.queuedNavigations.length) return;
    const beginNavigation = () => {
      const currentEntries = overlayStack.filter((entry) => entry.href === sourceHref);
      if (!currentEntries.length) return;
      const root = currentEntries[0];
      pendingOverlayNavigation = {
        href: `${destination.pathname}${destination.search}${destination.hash}`,
        sourceHref,
        expectedState: JSON.stringify(root.previousState()),
        sameUrl: destination.href === sourceHref,
        navigate: currentEntries[currentEntries.length - 1].navigate,
      };
      window.history.go(-currentEntries.length);
    };
    if (pendingHistoryTraversal?.href === sourceHref) pendingHistoryTraversal.queuedNavigations.push(beginNavigation);
    else beginNavigation();
  }, true);
}

function startHistoryBack(href: string, previousState: unknown, key: string, id: string | number): void {
  const previousEntry = historyStateRecord(previousState);
  if (pendingHistoryTraversal) {
    if (pendingHistoryTraversal.href === href && pendingHistoryTraversal.expectedEntry[key] === id) {
      pendingHistoryTraversal.queuedCloses.push(() => startHistoryBack(href, previousState, key, id));
    }
    return;
  }
  pendingHistoryTraversal = {
    href,
    expectedState: JSON.stringify(previousState),
    expectedEntry: previousEntry,
    queuedOpens: [],
    queuedCloses: [],
    queuedNavigations: [],
  };
  window.history.back();
}

export function isLocalHistoryTraversal(event: Event): boolean {
  return consumedHistoryEvents.has(event);
}

/** Adds one local history stop and serializes back cleanup with quick reopens. */
export function beginLocalHistoryEntry(key: string, id: string | number) {
  installHistoryCoordinator();
  const href = window.location.href;
  let previousState: unknown = null;
  let active = false;
  let cancelled = false;
  const activate = () => {
    if (cancelled || window.location.href !== href) return;
    previousState = window.history.state;
    window.history.pushState({ ...historyStateRecord(previousState), [key]: id }, '', href);
    active = true;
  };
  if (pendingHistoryTraversal?.href === href) pendingHistoryTraversal.queuedOpens.push(activate);
  else activate();
  return {
    href,
    finish(consumedByBack: boolean) {
      if (consumedByBack) { cancelled = true; return; }
      if (!active) { cancelled = true; return; }
      if (window.location.href !== href) return;
      const state = historyStateRecord(window.history.state);
      if (state[key] === id) {
        startHistoryBack(href, previousState, key, id);
      } else if (pendingHistoryTraversal?.href === href && pendingHistoryTraversal.expectedEntry[key] === id) {
        pendingHistoryTraversal.queuedCloses.push(() => startHistoryBack(href, previousState, key, id));
      }
    },
    previousState: () => previousState,
  };
}

function visibleFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),summary:not([tabindex="-1"]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
  )].filter((element) => {
    if (element.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
    if (element.getClientRects().length === 0) return false;
    for (let node: HTMLElement | null = element; node && node !== dialog; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      // Some browsers retain layout boxes for display-locked details content.
      // Only its first summary participates in focus while it is closed.
      if (node.tagName === 'DETAILS' && !node.hasAttribute('open')) {
        const summary = [...node.children].find(child => child.tagName === 'SUMMARY');
        if (!summary?.contains(element)) return false;
      }
    }
    return true;
  });
}

/** Shared lifecycle for modal overlays. The dialog element must have role=dialog,
 * aria-modal=true, an accessible name, and a visible close button. */
export function useOverlayDialog<T extends HTMLElement = HTMLElement>({ open, onClose, triggerRef, initialFocusRef, restoreFocusFallback }: OverlayDialogOptions) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const fallbackRef = useRef(restoreFocusFallback);
  fallbackRef.current = restoreFocusFallback;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeElement = document.activeElement;
    const outsideActive = activeElement instanceof HTMLElement
      && activeElement !== document.body
      && !dialog.contains(activeElement)
      ? activeElement
      : null;
    // Preserve alternate opening controls, but do not mistake a route's
    // programmatically focused heading/main for the dialog's opener.
    const trigger = outsideActive && outsideActive.tabIndex >= 0
      ? outsideActive
      : triggerRef.current ?? outsideActive;
    const usedTriggerRef = trigger === triggerRef.current;
    const id = ++nextOverlayId;
    const historyKey = '__fxaeonOverlayId';
    const historyEntry = beginLocalHistoryEntry(historyKey, id);
    const entry: OverlayEntry = { id, element: dialog, href: window.location.href,
      previousState: historyEntry.previousState, navigate: (href) => routerRef.current.push(href), dismiss: () => closeRef.current() };
    const wasTop = () => overlayStack.at(-1)?.id === entry.id;
    if (overlayStack.length === 0) originalBodyOverflow = document.body.style.overflow;
    overlayStack.push(entry);
    document.body.style.overflow = 'hidden';
    let consumedBack = false;
    const focusable = () => visibleFocusableElements(dialog);
    const focusInitial = () => (initialFocusRef?.current ?? focusable()[0] ?? dialog).focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (!wasTop()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (!dialog.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!wasTop()) return;
      if (!dialog.contains(event.target as Node)) focusInitial();
    };
    const onPopState = (event: PopStateEvent) => {
      if (isLocalHistoryTraversal(event)) return;
      if (!wasTop()) return;
      consumedBack = true;
      closeRef.current();
    };
    const onTelegramBack = (event: Event) => {
      if (!wasTop()) return;
      const detail = (event as CustomEvent<{ consume?: () => void; isConsumed?: () => boolean }>).detail;
      if (detail?.isConsumed?.()) return;
      closeRef.current();
      detail?.consume?.();
    };
    // Initial focus waits a frame for the dialog to paint. By then the person
    // may already have tapped a field inside it; never pull focus (and the
    // keystrokes that follow) away from there.
    const raf = window.requestAnimationFrame(() => {
      if (!dialog.contains(document.activeElement)) focusInitial();
    });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('fxaeon:telegram-back', onTelegramBack);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('fxaeon:telegram-back', onTelegramBack);
      const wasTopOnClose = wasTop();
      const index = overlayStack.findIndex((item) => item.id === entry.id);
      if (index >= 0) overlayStack.splice(index, 1);
      if (overlayStack.length === 0) document.body.style.overflow = originalBodyOverflow;
      historyEntry.finish(consumedBack);
      if (wasTopOnClose) {
        const returnTarget = usedTriggerRef && triggerRef.current?.isConnected ? triggerRef.current : trigger;
        if (returnTarget?.isConnected && !returnTarget.matches(':disabled')) returnTarget.focus({ preventScroll: true });
        else if (fallbackRef.current) window.requestAnimationFrame(() => {
          // A successful connection may replace its opener during this commit.
          // Never steal focus from a newer dialog, route, or deliberate target.
          if (overlayStack.length || window.location.href !== entry.href) return;
          const active = document.activeElement;
          if (active instanceof HTMLElement && active !== document.body && active.isConnected && !dialog.contains(active)) return;
          const fallback = fallbackRef.current?.();
          if (fallback?.isConnected && !fallback.matches(':disabled')) fallback.focus({ preventScroll: true });
        });
      }
    };
  }, [open, triggerRef, initialFocusRef]);

  return dialogRef;
}
