import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './icons';

interface DialogProps {
  title: string;
  subtitle?: string;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose(): void;
  variant?: 'wallet' | 'review';
  returnFocus?: HTMLElement | null;
}

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]')]
    .filter(node => node.getClientRects().length > 0 && !node.closest('[inert]'));
}

export function Dialog({ title, subtitle, eyebrow, children, footer, onClose, variant = 'review', returnFocus }: DialogProps) {
  const element = useRef<HTMLElement>(null);
  const dismiss = useRef(onClose);
  dismiss.current = onClose;

  useLayoutEffect(() => {
    const section = element.current;
    if (!section) return;
    const previous = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = section.querySelector<HTMLElement>('[data-dialog-close]');
    (close ?? section).focus({ preventScroll: true });

    function onKey(event: KeyboardEvent) {
      if (!section) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        const openDetails = [...section.querySelectorAll<HTMLDetailsElement>('details[open]')].reverse();
        if (openDetails.length) {
          const details = openDetails[0]!;
          details.open = false;
          details.querySelector('summary')?.focus();
          return;
        }
        dismiss.current();
      }
      if (event.key !== 'Tab') return;
      const nodes = focusable(section);
      if (!nodes.length) { event.preventDefault(); section.focus(); return; }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !section.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !section.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    function ownFocus(event: FocusEvent) {
      if (section && !section.contains(event.target as Node)) (focusable(section)[0] ?? section).focus();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', ownFocus);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', ownFocus);
      document.body.style.overflow = oldOverflow;
      requestAnimationFrame(() => {
        if (document.querySelector('[aria-modal="true"]')) return;
        if (previous?.isConnected && !previous.hasAttribute('disabled') && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
        else document.querySelector<HTMLElement>('[data-focus-fallback]')?.focus({ preventScroll: true });
      });
    };
  }, []);

  return <div className="dialog-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={element} className={`dialog dialog--${variant}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby={subtitle ? 'dialog-subtitle' : undefined} tabIndex={-1}>
      <div className="dialog-body">
        <header className="dialog-header">
          <div className="dialog-heading">
            {eyebrow && <div className="dialog-eyebrow">{eyebrow}</div>}
            <h2 id="dialog-title">{title}</h2>
            {subtitle && <p id="dialog-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-button dialog-close" aria-label="Close dialog" data-dialog-close onClick={onClose}><Icon name="close" /></button>
        </header>
        <div className="dialog-content">{children}</div>
      </div>
      {footer && <footer className="dialog-footer">{footer}</footer>}
    </section>
  </div>;
}
