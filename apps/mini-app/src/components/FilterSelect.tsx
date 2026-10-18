'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import styles from './FilterSelect.module.css';

/** Select-only combobox: keep focus on the trigger while its active option moves. */
export function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = Math.max(0, options.findIndex(option => option.value === value));
  const [active, setActive] = useState(selected);
  const typeahead = useRef({ text: '', at: 0 });
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const choose = (index: number) => { onChange(options[index].value); setOpen(false); trigger.current?.focus(); };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : !open ? selected : (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      setActive(next); setOpen(true); return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(active); else { setActive(selected); setOpen(true); }
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const text = now - typeahead.current.at < 600 ? typeahead.current.text + event.key.toLowerCase() : event.key.toLowerCase();
      typeahead.current = { text, at: now };
      const index = options.findIndex(option => option.label.toLowerCase().startsWith(text));
      if (index >= 0) { setActive(index); setOpen(true); }
    }
  };
  return <div ref={root} className={styles.root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={`${id}-options`} aria-activedescendant={open ? `${id}-option-${active}` : undefined}
      className={styles.trigger} onKeyDown={keyDown} onClick={() => { setActive(selected); setOpen(!open); }}>
      <span>{options[selected].label}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div id={`${id}-options`} role="listbox" aria-label={label} className={styles.menu}>
      {options.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={option.value === value}
        data-active={active === index || undefined} className={styles.option} onPointerMove={() => setActive(index)}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{option.label}</span>{option.value === value && <Check size={16} aria-hidden="true" />}
      </div>)}
    </div>}
  </div>;
}
