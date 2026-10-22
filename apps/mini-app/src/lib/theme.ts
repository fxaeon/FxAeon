/** Host chrome and authentication colors for FxAeon's dark appearance.
 * globals.css owns the live application tokens. */
import { applyTelegramChromeColors } from './telegram';

export const APP_THEME = { id: 'dark', accent: '#2563eb', background: '#080808' } as const;

/** Tokens earlier releases wrote inline; clearing them lets the stylesheet win. */
const LEGACY_INLINE_TOKENS = ['--bg', '--bg-raised', '--surface', '--surface-2', '--surface-3', '--card', '--input', '--line',
  '--line-strong', '--text', '--mut', '--mut-2', '--mint', '--mint-bright', '--on-accent', '--mint-dim', '--mint-glow', '--cyan',
  '--brand-coral', '--success', '--danger', '--warn'] as const;

/** Apply the sole appearance and migrate preferences from earlier releases. */
export function applyTheme() {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  LEGACY_INLINE_TOKENS.forEach((token) => root.style.removeProperty(token));
  root.style.colorScheme = 'dark';
  root.setAttribute('data-theme', 'dark');
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', APP_THEME.background);
  applyTelegramChromeColors(APP_THEME.background);
  try {
    localStorage.setItem('fxaeon_theme_id_v2', 'dark');
  } catch {
    // Dark appearance also works when device storage is unavailable.
  }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('fxaeon.settings.v1') || '{}');
    const settings = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ ...settings, theme: 'dark' }));
  } catch {
    // An unreadable preference never affects appearance or transaction state.
  }
}
