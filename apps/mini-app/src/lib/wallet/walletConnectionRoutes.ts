import type { DiscoveredEip6963Provider, Eip6963Provider } from './eip6963';
import { getWalletBrowserLinks, getWalletHandoffHelp, walletBrowserTarget, type WalletBrowserLocation } from './walletBrowserLinks';
import { buildWalletChoices, getWalletBrand, type WalletChoice } from './walletCatalog';
import { walletIdentityRdns } from './walletIdentity';
import { groupWalletProviderClaims } from './walletProviderSnapshot';

export type WalletEnvironment = 'desktop' | 'mobile' | 'unknown';

export type WalletEnvironmentHints = {
  readonly userAgent?: string;
  readonly userAgentData?: { readonly mobile?: boolean };
  readonly platform?: string;
  readonly maxTouchPoints?: number;
};

/** Device hints choose navigation UX only. They never detect a wallet or prove
 * provider identity. Unrecognized/no-UA contexts do not get install prompts.
 */
export function resolveWalletEnvironment({ userAgent = '', userAgentData, platform = '', maxTouchPoints = 0 }: WalletEnvironmentHints = {}): WalletEnvironment {
  if (userAgentData?.mobile === true) return 'mobile';
  if (/Android|iPhone|iPad|iPod|Windows Phone|Mobile|Tablet|Silk|Kindle/i.test(userAgent)
    || /iPhone|iPad|iPod/i.test(platform)) return 'mobile';
  // iPadOS may report a desktop Safari UA and MacIntel platform.
  if (maxTouchPoints > 1 && /Macintosh|MacIntel|Mac OS X/i.test(`${userAgent} ${platform}`)) return 'mobile';
  // Android desktop mode can expose a Linux/X11 UA and mobile:false. Touch
  // makes this ambiguous, not proof that desktop extensions can be installed.
  // https://developer.chrome.com/blog/desktop-mode
  if (maxTouchPoints > 0 && /X11/i.test(userAgent) && /Linux/i.test(userAgent)
    && !/Windows NT/i.test(userAgent)) return 'unknown';
  if (/Windows NT|Macintosh|X11|CrOS/i.test(userAgent)) return 'desktop';
  return 'unknown';
}

export type WalletRouteUnavailableReason =
  | 'ambiguous_provider'
  | 'provider_changed'
  | 'provider_unavailable';

export type WalletConnectionRoute =
  | { readonly kind: 'injected'; readonly provider: Eip6963Provider; readonly rdns: string | null }
  // Navigation is a separate browser context, never an established session.
  | { readonly kind: 'browser' | 'install' | 'download'; readonly href: string; readonly message: string; readonly fallbackHref?: string; readonly guideHref?: string; readonly dappHref?: string; readonly canReopen?: boolean }
  | { readonly kind: 'unavailable'; readonly reason: WalletRouteUnavailableReason; readonly message: string };

export type WalletConnectionRouteContext = {
  readonly providers: readonly DiscoveredEip6963Provider[];
  readonly legacyProvider?: Eip6963Provider;
  readonly legacyProviders?: readonly Eip6963Provider[];
  readonly environment: WalletEnvironment;
  /** Compatibility fallback when no trusted browser location is supplied. */
  readonly pathname?: string;
  readonly location?: WalletBrowserLocation;
};

/** Resolve immediately before starting an attempt, using fresh discovery.
 * Never infer a named provider from isMetaMask or unrelated window.ethereum.
 */
export function resolveWalletConnectionRoute(
  choice: WalletChoice,
  { providers, legacyProvider, legacyProviders, environment, pathname = '/', location }: WalletConnectionRouteContext,
): WalletConnectionRoute {
  const unavailable = (reason: WalletRouteUnavailableReason, message = `${choice.name} isn’t available in this browser.`): WalletConnectionRoute => ({
    kind: 'unavailable', reason, message,
  });

  if (choice.source === 'legacy') {
    // A new global object must not replace the object the person selected.
    if (!choice.provider || typeof choice.provider.request !== 'function'
      || (!(legacyProviders ?? (legacyProvider ? [legacyProvider] : [])).includes(choice.provider)
        && !providers.some(item => item.provider === choice.provider))) {
      return unavailable('provider_changed', 'Your browser wallet changed. Choose it again.');
    }
    // Late announcement is harmless only when it still refers to this object
    // and its now-announced identity is not shared by another provider.
    const announcement = providers.find((item) => item.provider === choice.provider);
    if (groupWalletProviderClaims(providers).conflictingProviders.has(choice.provider)
      || (announcement && providers.some((item) => walletIdentityRdns(item.rdns) === walletIdentityRdns(announcement.rdns) && item.provider !== choice.provider))) {
      return unavailable('ambiguous_provider', 'Multiple wallets report the same identity. Check your wallets and retry.');
    }
    return { kind: 'injected', provider: choice.provider, rdns: announcement ? walletIdentityRdns(announcement.rdns) : null };
  }

  const current = buildWalletChoices(providers).find((candidate) => candidate.id === choice.id && candidate.rdns === choice.rdns);
  if (current?.injected === 'ambiguous') {
    return unavailable('ambiguous_provider', 'Multiple wallets report the same identity. Check your wallets and retry.');
  }
  if (choice.provider && current?.provider !== choice.provider) {
    return unavailable('provider_changed', `${choice.name} changed or disconnected. Choose it again.`);
  }
  if (current?.provider) {
    return { kind: 'injected', provider: current.provider, rdns: current.rdns };
  }

  // Unknown announced wallets have only their actual discovered route. No
  // brand or navigation target is guessed from display names or flags.
  const wallet = choice.source === 'catalog' && choice.rdns ? getWalletBrand(choice.rdns) : undefined;
  if (!wallet || wallet.id !== choice.id) return unavailable('provider_unavailable');

  const help = getWalletHandoffHelp(wallet.id);
  const dappHref = location ? walletBrowserTarget(location) ?? undefined : undefined;
  if (environment === 'desktop') {
    return {
      kind: 'install',
      href: wallet.extensionUrl,
      message: `Opening ${wallet.name}’s official download page.`,
      ...help, fallbackHref: wallet.extensionUrl, dappHref, canReopen: false,
    };
  }
  if (environment === 'mobile') {
    const browser = getWalletBrowserLinks(pathname, location).find((link) => link.name === wallet.name);
    if (browser) return {
      kind: 'browser',
      href: browser.href,
      message: `Opening ${wallet.name}…`,
      ...help, dappHref, canReopen: true,
    };
    return { kind: 'download', href: wallet.appUrl, ...help, dappHref, canReopen: false,
      message: `Open FxAeon in ${wallet.name}’s browser to connect. Use the app guide or install the wallet below.` };
  }
  // Unknown environments include desktop-mode Android tablets. A vendor's
  // platform-aware app landing is safe here; never send them to extension-only
  // installation or pretend that the browser detected an installed app.
  return { kind: 'download', href: wallet.appUrl, ...help, dappHref, canReopen: false,
    message: `Open FxAeon in ${wallet.name}’s browser to connect. Use the app guide or install the wallet below.` };
}
