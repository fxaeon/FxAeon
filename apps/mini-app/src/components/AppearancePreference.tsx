'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { applyTheme, getSavedTheme, THEMES, type ThemeId } from '@/lib/theme';
import { haptic } from '@/lib/telegram';
import styles from './AppearancePreference.module.css';

const OPTIONS: ThemeId[] = ['official', 'dark'];
export function useAppearance() {
  const [theme, setTheme] = useState<ThemeId>('official');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setTheme(getSavedTheme()); setReady(true);
    const sync = (event: Event) => {
      const next = (event as CustomEvent<ThemeId>).detail;
      if (OPTIONS.includes(next)) setTheme(next);
    };
    window.addEventListener('fxaeon:theme', sync);
    return () => window.removeEventListener('fxaeon:theme', sync);
  }, []);
  const select = (next: ThemeId) => { applyTheme(next); setTheme(next); haptic('selection'); };
  return { theme, ready, select };
}

export default function AppearancePreference() {
  const { theme, ready, select } = useAppearance();
  return <section id="appearance" className={styles.section} aria-label="Appearance">
    <div className={styles.choices} role="radiogroup" aria-label="Appearance theme">
      {OPTIONS.map((option, index) => {
        const config = THEMES[option];
        return <button key={option} type="button" role="radio" aria-label={config.name} aria-checked={ready && theme === option}
          disabled={!ready} tabIndex={theme === option ? 0 : -1} className={styles.choice} onClick={() => select(option)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? OPTIONS.length - 1 : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + OPTIONS.length) % OPTIONS.length;
            select(OPTIONS[next]);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
          }}>
          <span className={styles.preview} aria-hidden="true" style={{ '--preview-bg': config.colors['--bg'], '--preview-surface': config.colors['--surface-2'], '--preview-accent': config.accent } as CSSProperties}><i /><span /><b /></span>
          <span className={styles.label}>{config.name}{ready && theme === option && <Check size={15} aria-hidden="true" />}</span>
        </button>;
      })}
    </div>
  </section>;
}
