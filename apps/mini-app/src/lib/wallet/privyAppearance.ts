import { createElement } from 'react';
import type { PrivyClientConfig, WalletListEntry } from '@privy-io/react-auth';
import { THEMES, type ThemeId } from '../theme';

type PrivyAppearance = NonNullable<PrivyClientConfig['appearance']>;
type HexColor = `#${string}`;

export type FxPrivyAppearance = Pick<PrivyAppearance, 'theme' | 'accentColor' | 'logo' | 'landingHeader' | 'loginMessage' | 'walletList'>;

/** FxAeon's app mark, served from this origin (the favicon file). */
export const FXAEON_MARK_PATH = '/icon.svg';

/**
 * Detected browser wallets first, then the wallets most FxAeon users carry.
 * Privy 3.45 filters this list through its own allow-list and silently drops
 * unknown ids, including the deprecated 'detected_wallets'.
 */
const WALLET_LIST: readonly WalletListEntry[] = [
  'detected_ethereum_wallets',
  'metamask',
  'coinbase_wallet',
  'rainbow',
  'wallet_connect',
];

function hexColor(value: string): HexColor | undefined {
  return /^#[0-9a-f]{6}$/i.test(value) ? value as HexColor : undefined;
}

/**
 * The Privy modal's Aeon appearance for one FxAeon theme.
 *
 * Privy accepts a background hex as `theme`: a color at or below 50%
 * luminance selects its dark palette and becomes the modal background. Every
 * other surface, text, and radius is mapped to Aeon tokens by privy-theme.css.
 */
export function privyAppearance(themeId: ThemeId): FxPrivyAppearance {
  const theme = THEMES[themeId] ?? THEMES.official;
  return {
    theme: hexColor(theme.colors['--bg']) ?? (theme.id === 'dark' ? 'dark' : 'light'),
    accentColor: hexColor(theme.accent),
    // A sized image element: the mark has no intrinsic size, and Privy would
    // otherwise stretch it to the 90px limit it applies to wordmarks.
    logo: createElement('img', { src: FXAEON_MARK_PATH, width: 48, height: 48, alt: '' }),
    landingHeader: 'Sign in to FxAeon',
    loginMessage: 'Trade, earn, and borrow on f(x) Protocol.',
    walletList: [...WALLET_LIST],
  };
}
