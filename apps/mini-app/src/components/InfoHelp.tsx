'use client';

import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import { INFO_HELP_CONTENT, type InfoHelpKey } from './infoHelpContent';
import styles from './InfoHelp.module.css';

export type InfoHelpViewport = { left: number; top: number; width: number; height: number };
type HelpAnchor = { left: number; right: number; top: number; bottom: number };

/** Pure positioning contract, also used by narrow-screen and zoom tests. */
export function getInfoHelpPosition(anchor: HelpAnchor, contentHeight: number, viewport: InfoHelpViewport) {
  const gutter = Math.min(12, Math.max(0, viewport.width / 4), Math.max(0, viewport.height / 4));
  const width = Math.max(0, Math.min(320, viewport.width - gutter * 2));
  const minLeft = viewport.left + gutter;
  const minTop = viewport.top + gutter;
  const bottom = viewport.top + viewport.height - gutter;
  const below = Math.max(minTop, anchor.bottom + 6);
  const above = Math.min(bottom, anchor.top - 6);
  const belowSpace = Math.max(0, bottom - below);
  const aboveSpace = Math.max(0, above - minTop);
  const useBelow = contentHeight <= belowSpace || belowSpace >= aboveSpace;
  // Large text scrolls within the room on one side of the trigger. Clamping a
  // full-height panel across its own icon would make a second tap impossible.
  const maxHeight = useBelow ? belowSpace : aboveSpace;
  const height = Math.min(Math.max(0, contentHeight), maxHeight);
  const preferredTop = useBelow ? below : above - height;
  return {
    left: Math.max(minLeft, Math.min(anchor.right - width, viewport.left + viewport.width - gutter - width)),
    top: Math.max(minTop, Math.min(preferredTop, bottom - height)),
    width,
    maxHeight,
  };
}

type HelpMode = 'hover' | 'focus' | 'active';
let activeHelp: { id: string; mode: HelpMode; close: (restoreFocus?: boolean) => void } | null = null;

type InfoHelpProps = {
  label: string;
  children?: ReactNode;
  definition?: InfoHelpKey;
  className?: string;
  minimal?: boolean;
};

/** A deliberate tap/keyboard disclosure, not hover-only or a native title.
 * Native popover keeps the panel in the top layer AND in its sheet's DOM tree,
 * so overflow cannot clip it and the sheet's existing focus trap remains valid.
 * Older browsers portal into the nearest dialog, never outside its focus trap.
 * This lightweight disclosure owns no browser-history entry. */
export function InfoHelp({ label, children, definition, className, minimal = false }: InfoHelpProps) {
  const id = useId();
  const panelId = `${id}-help`;
  const content = children ?? (definition ? INFO_HELP_CONTENT[definition] : undefined);
  const [open, setOpen] = useState(false);
  const openMode = useRef<HelpMode | null>(null);
  const suppressFocusPreview = useRef(false);
  const hoverClose = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const nativePopover = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
  const portalTarget = open && !nativePopover ? triggerRef.current?.closest<HTMLElement>('[role="dialog"], dialog') ?? document.body : null;

  const close = useCallback((restoreFocus = false) => {
    clearTimeout(hoverClose.current);
    openMode.current = null;
    if (activeHelp?.id === id) activeHelp = null;
    setOpen(false);
    if (restoreFocus && triggerRef.current?.isConnected) {
      suppressFocusPreview.current = true;
      triggerRef.current.focus({ preventScroll: true });
      suppressFocusPreview.current = false;
    }
  }, [id]);

  const show = (mode: HelpMode) => {
    clearTimeout(hoverClose.current);
    if (mode === 'hover' && (openMode.current === 'active' || openMode.current === 'focus'
      || (activeHelp?.id !== id && (activeHelp?.mode === 'active' || activeHelp?.mode === 'focus')))) return;
    if (activeHelp?.id !== id) activeHelp?.close();
    activeHelp = { id, mode, close };
    openMode.current = mode;
    if (!open) setPosition({ visibility: 'hidden' });
    setOpen(true);
    if (mode === 'active') panelRef.current?.focus({ preventScroll: true });
  };
  const leaveHover = () => {
    if (openMode.current !== 'hover') return;
    clearTimeout(hoverClose.current);
    // Allow crossing the small gap between the icon and its anchored panel.
    hoverClose.current = setTimeout(() => { if (openMode.current === 'hover') close(); }, 180);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    if (activeHelp?.id !== id) { activeHelp?.close(); activeHelp = { id, mode: openMode.current ?? 'active', close }; }
    let topLayer = false;
    if (nativePopover) {
      try { panel.showPopover(); topLayer = true; }
      catch { panel.removeAttribute('popover'); }
    }
    const isParentInactive = () => {
      const dialog = trigger.closest('dialog');
      return !trigger.isConnected || Boolean(trigger.closest('[inert],[hidden],[aria-hidden="true"]'))
        || Boolean(dialog && !dialog.hasAttribute('open'));
    };
    const place = () => {
      if (isParentInactive()) { close(); return; }
      const visual = window.visualViewport;
      const viewport: InfoHelpViewport = {
        left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0,
        width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight,
      };
      let offsetLeft = 0;
      let offsetTop = 0;
      if (!topLayer) {
        // A transformed sheet establishes the containing block for fixed
        // descendants. Clamp the fallback to that sheet and convert coordinates.
        const owner = trigger.closest<HTMLElement>('[role="dialog"], dialog');
        if (owner) {
          const rect = owner.getBoundingClientRect();
          const right = Math.min(viewport.left + viewport.width, rect.right);
          const bottom = Math.min(viewport.top + viewport.height, rect.bottom);
          viewport.left = Math.max(viewport.left, rect.left);
          viewport.top = Math.max(viewport.top, rect.top);
          viewport.width = Math.max(0, right - viewport.left);
          viewport.height = Math.max(0, bottom - viewport.top);
        }
        for (let ancestor = panel.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
          const css = window.getComputedStyle(ancestor);
          if (css.transform !== 'none' || css.perspective !== 'none' || css.filter !== 'none' || /paint|layout|strict|content/.test(css.contain) || /transform|perspective|filter/.test(css.willChange)) {
            const rect = ancestor.getBoundingClientRect();
            offsetLeft = rect.left + ancestor.clientLeft - ancestor.scrollLeft;
            offsetTop = rect.top + ancestor.clientTop - ancestor.scrollTop;
            break;
          }
        }
      }
      const anchor = trigger.getBoundingClientRect();
      // Measure after assigning width so 200% text wrapping sets the real height.
      const initial = getInfoHelpPosition(anchor, 0, viewport);
      panel.style.width = `${initial.width}px`;
      panel.style.maxHeight = 'none';
      const next = getInfoHelpPosition(anchor, panel.getBoundingClientRect().height, viewport);
      const left = next.left - offsetLeft;
      const top = next.top - offsetTop;
      Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, maxHeight: `${next.maxHeight}px`, visibility: 'visible' });
      setPosition({ ...next, left, top, visibility: 'visible' });
    };
    place();
    // Focus the description, rather than opening a second modal. Its close
    // control is next in DOM order; Tab can still leave this non-modal help.
    if (openMode.current === 'active') panel.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || activeHelp?.id !== id) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      close(openMode.current === 'active');
    };
    const onTelegramBack = (event: Event) => {
      const detail = (event as CustomEvent<{ consume?: () => void; isConsumed?: () => boolean }>).detail;
      if (activeHelp?.id !== id || detail?.isConsumed?.()) return;
      event.stopImmediatePropagation();
      detail?.consume?.();
      close(openMode.current === 'active');
    };
    const onOutside = (event: Event) => {
      if (!(event.target instanceof Node) || panel.contains(event.target) || trigger.contains(event.target)) return;
      close(); // Do not steal focus from the outside control the person chose.
    };
    // Window capture runs before the parent sheet's document Escape listener.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('fxaeon:telegram-back', onTelegramBack, true);
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('focusin', onOutside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(panel);
    observer?.observe(trigger);
    // Exit-presence keeps a closing sheet mounted briefly. Hide help as soon
    // as that sheet becomes inert/hidden, rather than waiting for its removal.
    const parentObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { if (isParentInactive()) close(); });
    for (let ancestor: HTMLElement | null = trigger; ancestor; ancestor = ancestor.parentElement) {
      parentObserver?.observe(ancestor, { attributes: true, attributeFilter: ['inert', 'hidden', 'aria-hidden', 'open'] });
    }
    return () => {
      clearTimeout(hoverClose.current);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('fxaeon:telegram-back', onTelegramBack, true);
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('focusin', onOutside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      observer?.disconnect();
      parentObserver?.disconnect();
      if (activeHelp?.id === id) activeHelp = null;
      // React removes the panel, which also removes its native top-layer entry.
      // Do not call hidePopover(): its implicit focus restoration can steal
      // focus from an outside click before that click's default action runs.
    };
  }, [open, nativePopover, id, close]);

  if (content === undefined || content === null || content === '') return null;
  const panel = open ? <span ref={panelRef} id={panelId} role="dialog" aria-modal="false" aria-labelledby={`${id}-heading`} aria-describedby={`${id}-content`}
    tabIndex={-1} popover={nativePopover ? 'manual' : undefined} className={`${styles.panel} ${minimal ? styles.minimalPanel : ''}`} style={position} data-info-help-panel=""
    onPointerEnter={() => clearTimeout(hoverClose.current)} onPointerLeave={minimal ? leaveHover : undefined}
    onClick={event => event.stopPropagation()}>
    <span className={minimal ? 'sr-only' : styles.heading}><strong id={`${id}-heading`}>{label}</strong>
      {!minimal && <button type="button" className={styles.close} aria-label={`Close ${label} help`} onClick={() => close(true)}><X size={16} aria-hidden="true" /></button>}
    </span>
    <span id={`${id}-content`} className={styles.content}>{content}</span>
  </span> : null;
  return <>
    <button ref={triggerRef} type="button" className={[styles.trigger, className].filter(Boolean).join(' ')} aria-label={`About ${label}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} data-info-help-trigger=""
      onPointerEnter={minimal ? () => clearTimeout(hoverClose.current) : undefined}
      onPointerMove={minimal ? event => {
        // Actual pointer motion distinguishes intentional hover from a term
        // scrolling underneath a stationary pointer during keyboard navigation.
        if (openMode.current === null && event.pointerType === 'mouse' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) show('hover');
      } : undefined}
      onPointerLeave={minimal ? leaveHover : undefined}
      onFocus={minimal ? () => { if (!suppressFocusPreview.current && openMode.current !== 'active') show('focus'); } : undefined}
      onClick={event => {
        event.preventDefault(); event.stopPropagation();
        if (open && openMode.current === 'active') { close(); return; }
        show('active');
      }}><Info size={15} aria-hidden="true" /></button>
    {portalTarget ? createPortal(panel, portalTarget) : panel}
  </>;
}

/** The label remains visible and meaningful without opening its explanation. */
export function MetricLabel({ label, visualLabel, help, definition, className, minimalHelp = false }: {
  label: string; visualLabel?: ReactNode; help?: ReactNode; definition?: InfoHelpKey; className?: string; minimalHelp?: boolean;
}) {
  return <span className={[styles.label, className].filter(Boolean).join(' ')}>
    <span>{visualLabel ?? label}</span><InfoHelp label={label} definition={definition} minimal={minimalHelp}>{help}</InfoHelp>
  </span>;
}
