'use client';

import { createContext, useContext, useEffect, useId, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
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

export function MobileFlowSheet({ children, title, subtitle, onClose, triggerRef, dismissible = true }: {
  children: ReactNode;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  dismissible?: boolean;
}) {
  const phone = useSyncExternalStore(subscribeToPhone, isPhone, serverPhone);
  const insideSheet = useContext(MobileFlowSheetContext);
  const open = phone && !insideSheet;
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
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
        <header className={styles.header}>
          <span className={styles.handle} aria-hidden="true" />
          <div className={styles.heading}><h2 ref={headingRef} id={titleId} tabIndex={-1}>{title}</h2>{subtitle}</div>
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
