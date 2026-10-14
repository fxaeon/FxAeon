/** FxAeon palettes shared by the compact toggle and full appearance control. */
import { applyTelegramChromeColors } from './telegram';

// Keep the stored "official" id for the light palette across upgrades.
export type ThemeId = 'official' | 'dark';

const THEME_STORAGE_KEY = 'fxaeon_theme_id_v2';

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  accent: string;
  /** Preview and host-chrome colors only. globals.css owns every live token. */
  colors: Record<'--bg' | '--surface' | '--surface-2', string>;
}

export const THEMES: Record<ThemeId, ThemeConfig> = {
  official: {
    id: 'official',
    name: 'Light',
    accent: '#2973ff',
    colors: { '--bg': '#f3f6fb', '--surface': '#ffffff', '--surface-2': '#eaf0f8' },
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    accent: '#2973ff',
    colors: { '--bg': '#111113', '--surface': '#1b1b1f', '--surface-2': '#242428' },
  },
};

/** Tokens earlier releases wrote inline; clearing them lets the stylesheet win. */
const LEGACY_INLINE_TOKENS = ['--bg', '--bg-raised', '--surface', '--surface-2', '--surface-3', '--card', '--input', '--line',
  '--line-strong', '--text', '--mut', '--mut-2', '--mint', '--mint-bright', '--on-accent', '--mint-dim', '--mint-glow', '--cyan',
  '--brand-coral', '--success', '--danger', '--warn'] as const;

export function getSavedTheme(): ThemeId {
  if (typeof window === 'undefined') return 'official';
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'official';
  } catch {
    return 'official';
  }
}

export function applyTheme(themeId: ThemeId) {
  if (typeof window === 'undefined') return;
  const theme = THEMES[themeId] || THEMES.official;
  const root = document.documentElement;
  LEGACY_INLINE_TOKENS.forEach((token) => root.style.removeProperty(token));
  root.style.colorScheme = themeId === 'dark' ? 'dark' : 'light';
  root.setAttribute('data-theme', themeId);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme.colors['--bg']);
  applyTelegramChromeColors(theme.colors['--bg']);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
    const settings = JSON.parse(localStorage.getItem('fxaeon.settings.v1') || '{}') as Record<string, unknown>;
    localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ ...settings, theme: themeId }));
  } catch {
    // Theme still applies for this session when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<ThemeId>('fxaeon:theme', { detail: themeId }));
}
