'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, getSavedTheme, THEMES, type ThemeId } from '@/lib/theme';
import { haptic } from '@/lib/telegram';

const ICONS = { official: Sun, dark: Moon } as const;
const ORDER: readonly ThemeId[] = ['official', 'dark'];

/** Shows the theme in use and switches between light and dark. Both icons render;
 * the root's pre-hydration data-theme picks the visible one in CSS, so the
 * icon is right from the first paint instead of flipping after hydration. */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeId>('official');
  const [mounted, setMounted] = useState(false);
  const [switched, setSwitched] = useState(false);

  useEffect(() => {
    setTheme(getSavedTheme());
    setMounted(true);
    const sync = (event: Event) => setTheme((event as CustomEvent<ThemeId>).detail);
    window.addEventListener('fxaeon:theme', sync);
    return () => window.removeEventListener('fxaeon:theme', sync);
  }, []);

  const next: ThemeId = theme === 'dark' ? 'official' : 'dark';
  const label = `${THEMES[theme].name} theme. Switch to ${THEMES[next].name.toLowerCase()} theme`;
  return (
    <button
      type="button"
      disabled={!mounted}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
        setSwitched(true);
        haptic('selection');
      }}
      aria-label={label}
      title={label}
      data-switched={switched || undefined}
      className={`theme-toggle glass-press flex min-h-11 min-w-11 items-center justify-center rounded-full text-mut ${className}`}
    >
      {ORDER.map((id) => {
        const Icon = ICONS[id];
        return <Icon key={id} data-theme-icon={id} className="theme-toggle-icon h-[18px] w-[18px]" aria-hidden="true" />;
      })}
    </button>
  );
}
