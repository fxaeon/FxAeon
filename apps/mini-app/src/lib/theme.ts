/** FxAeon palettes shared by the compact toggle and full appearance control. */
import { applyTelegramChromeColors } from './telegram';

export type ThemeId = 'official' | 'dark' | 'light';

const THEME_STORAGE_KEY = 'fxaeon_theme_id_v2';
const LEGACY_THEME_STORAGE_KEY = 'fxaeon_theme_id';

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
    name: 'Official',
    accent: '#b9a0ff',
    colors: { '--bg': '#121115', '--surface': '#1e1c22', '--surface-2': '#27242d' },
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    accent: '#b9a0ff',
    colors: { '--bg': '#08090b', '--surface': '#121418', '--surface-2': '#191c21' },
  },
  light: {
    id: 'light',
    name: 'Light',
    accent: '#7341c8',
    colors: { '--bg': '#f7f5f1', '--surface': '#ffffff', '--surface-2': '#f4f0f8' },
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
    if (saved === 'official' || saved === 'dark' || saved === 'light') return saved;
    // The previous release used "dark" for today's Official palette. Preserve
    // that appearance during migration; an existing light choice stays light.
    return localStorage.getItem(LEGACY_THEME_STORAGE_KEY) === 'light' ? 'light' : 'official';
  } catch {
    return 'official';
  }
}

export function applyTheme(themeId: ThemeId) {
  if (typeof window === 'undefined') return;
  const theme = THEMES[themeId] || THEMES.official;
  const root = document.documentElement;
  LEGACY_INLINE_TOKENS.forEach((token) => root.style.removeProperty(token));
  root.style.colorScheme = themeId === 'light' ? 'light' : 'dark';
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
