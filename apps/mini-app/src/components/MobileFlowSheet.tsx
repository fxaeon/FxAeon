'use client';

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import styles from './MobileFlowSheet.module.css';

/** A manager already in a phone sheet keeps its review in that same sheet. */
export const MobileFlowSheetContext = createContext(false);

const phoneQuery = '(max-width: 600px)';
function subscribeToPhone(onChange: () => void) {
  const media = window.matchMedia(phoneQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const isPhone = () => window.matchMedia(phoneQuery).matches;
const serverPhone = () => false;

const MORPH_MS = 300;
const MORPH_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * The sheet glides between the heights of its stages (review, wallet request,
 * receipt) instead of jumping. It runs after each committed change, before
 * paint: hold the previous height, then transition to the new content's own
 * height and release it. Small changes and reduced motion apply at once.
 */
function useSheetMorph(open: boolean, sheetRef: RefObject<HTMLElement | null>) {
  const settled = useRef<number | null>(null);
  const release = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!open || !sheet) { settled.current = null; return; }
    // Mid-glide, the sheet shows its held height; start the next glide there.
    const inFlight = release.current !== null;
    const shown = sheet.getBoundingClientRect().height;
    release.current?.();
    const target = sheet.getBoundingClientRect().height;
    const from = inFlight ? shown : settled.current;
    settled.current = target;
    if (from === null || Math.abs(target - from) < 8 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    sheet.style.height = `${from}px`;
    sheet.getBoundingClientRect();
    let frame = 0;
    let timer = 0;
    const done = () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      sheet.removeEventListener('transitionend', onEnd);
      sheet.style.transition = '';
      sheet.style.height = '';
      release.current = null;
    };
    const onEnd = (event: TransitionEvent) => { if (event.target === sheet && event.propertyName === 'height') done(); };
    release.current = done;
    frame = requestAnimationFrame(() => {
      sheet.style.transition = `height ${MORPH_MS}ms ${MORPH_EASE}`;
      sheet.style.height = `${target}px`;
      sheet.addEventListener('transitionend', onEnd);
      timer = window.setTimeout(done, MORPH_MS + 120);
    });
  });
  useEffect(() => () => release.current?.(), []);
}

export function MobileFlowSheet({ children, title, subtitle, onClose, triggerRef, dismissible = true, hideTitle = false }: {
  children: ReactNode;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  dismissible?: boolean;
  hideTitle?: boolean;
}) {
  const phone = useSyncExternalStore(subscribeToPhone, isPhone, serverPhone);
  const insideSheet = useContext(MobileFlowSheetContext);
  const open = phone && !insideSheet;
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLElement>(null);
  const previousTitle = useRef(title);
  const close = () => { if (dismissible) onClose(); };
  const dialogRef = useOverlayDialog<HTMLElement>({
    open,
    onClose: close,
    triggerRef,
    initialFocusRef: closeRef,
    dismissible,
    restoreFocusFallback: () => document.querySelector<HTMLElement>('[data-review-trigger]:not(:disabled)'),
  });
  useSheetMorph(open, dialogRef);
  useEffect(() => {
    if (open && previousTitle.current !== title) {
      const active = document.activeElement;
      if (active === document.body || dialogRef.current?.contains(active)) headingRef.current?.focus({ preventScroll: true });
    }
    previousTitle.current = title;
  }, [open, title, dialogRef]);

  if (!open) return <>{children}</>;
  return createPortal(
    <div data-product-ui="v2" className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        data-mobile-review-sheet className={styles.sheet}>
        <header className={`${styles.header} ${hideTitle ? styles.quietHeader : ''}`}>
          <span className={styles.handle} aria-hidden="true" />
          {/* A content heading that already names the sheet is the only heading; the dialog keeps this name. */}
          <div className={styles.heading}>{hideTitle
            ? <span ref={headingRef} id={titleId} tabIndex={-1} className="sr-only">{title}</span>
            : <h2 ref={headingRef as RefObject<HTMLHeadingElement>} id={titleId} tabIndex={-1}>{title}</h2>}{subtitle}</div>
          <button ref={closeRef} type="button" onClick={close} disabled={!dismissible} aria-label="Close transaction review" className={styles.close}>
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.body}>
          <MobileFlowSheetContext.Provider value>{children}</MobileFlowSheetContext.Provider>
        </div>
      </section>
    </div>, document.body,
  );
}
