const PUBLIC_ROUTES = new Set(['/', '/earn', '/trade', '/borrow', '/positions', '/move', '/send']);

export type WalletBrowserLocation = { readonly href: string; readonly origin: string };

function removeLaunchProof(value: string): string {
  const params = new URLSearchParams(value);
  let changed = false;
  for (const key of [...params.keys()]) {
    if (/^tgWebApp/i.test(key) || /^(?:access_token|id_token|refresh_token)$/i.test(key)) {
      params.delete(key); changed = true;
    }
  }
  return changed ? params.toString() : value;
}

/** The caller captures origin from window.location, never a query parameter.
 * Reject foreign origins, credentials, and non-web schemes before nesting a
 * URL inside a wallet deep link. Full route state stays in the same dapp. */
export function walletBrowserTarget(location: WalletBrowserLocation): string | null {
  try {
    const url = new URL(location.href);
    if (url.origin !== location.origin || url.username || url.password) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    const search = url.search.slice(1);
    const safeSearch = removeLaunchProof(search);
    if (safeSearch !== search) url.search = safeSearch;
    const hash = url.hash.slice(1);
    const divider = hash.indexOf('?');
    const hashPrefix = divider >= 0 ? hash.slice(0, divider + 1) : '';
    const hashParams = divider >= 0 ? hash.slice(divider + 1) : hash;
    const safeHash = removeLaunchProof(hashParams);
    if (safeHash !== hashParams) url.hash = safeHash ? `${hashPrefix}${safeHash}` : hashPrefix.replace(/\?$/, '');
    return url.href;
  } catch { return null; }
}

/** Preserve trusted browser state; pathname-only callers use the public fallback. */
export function getWalletBrowserLinks(pathname = '/', location?: WalletBrowserLocation) {
  const candidate = pathname.replace(/\/$/, '') || '/';
  const route = PUBLIC_ROUTES.has(candidate) ? candidate : '/';
  const target = (location && walletBrowserTarget(location)) || `https://fxaeon.com${route}`;
  const targetUrl = new URL(target);
  return [
    { name: 'MetaMask', href: `https://link.metamask.io/dapp/${targetUrl.host}${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}` },
    // Coinbase's MobileRelay browser command; go.cb-w.com currently delegates
    // all URLs to the org.toshi Android app and Coinbase Wallet iOS app.
    { name: 'Base Wallet', href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(target)}` },
    // The current Privy OKX connector uses this plain dapp-browser command.
    // It is distinct from OKX Connect's relay/session pairing deep links.
    { name: 'OKX', href: `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(target)}` },
    { name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(target)}` },
    { name: 'Phantom', href: `https://phantom.com/ul/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(targetUrl.origin)}` },
    // Rabby's release app accepts this exact scheme/host/path and command.
    // Launch directly from the user's tap so Chrome's web fallback cannot
    // turn an open-dapp request into an app-home launch.
    { name: 'Rabby', href: `rabbygo://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(target)}` },
    { name: 'Rainbow', href: `https://rnbwapp.com/dapp?url=${encodeURIComponent(target)}` },
    // Zerion's app itself builds https://link.zerion.io?url= browser links;
    // its Android DAppBrowserSpace decoder reads the `url` query parameter.
    { name: 'Zerion', href: `https://link.zerion.io/?url=${encodeURIComponent(target)}` },
  ] as const;
}

/** Optional recovery links are independent of browser navigation. */
export function getWalletHandoffHelp(walletId: string) {
  const help: Record<string, { fallbackHref: string; guideHref: string }> = {
    metamask: { fallbackHref: 'https://metamask.io/download', guideHref: 'https://support.metamask.io/configure/wallet/how-to-use-the-metamask-mobile-browser' },
    coinbase: { fallbackHref: 'https://wallet.coinbase.com/download', guideHref: 'https://help.coinbase.com/en/wallet' },
    okx: { fallbackHref: 'https://web3.okx.com/download', guideHref: 'https://web3.okx.com/help' },
    rabby: { fallbackHref: 'https://rabby.io/?platform=mobile', guideHref: 'https://support.rabby.io/' },
    trust: { fallbackHref: 'https://trustwallet.com/download', guideHref: 'https://developer.trustwallet.com/developer/develop-for-trust/deeplinking' },
    phantom: { fallbackHref: 'https://phantom.com/download', guideHref: 'https://docs.phantom.com/phantom-deeplinks/other-methods/browse' },
    rainbow: { fallbackHref: 'https://rainbow.me/download', guideHref: 'https://rainbow.me/support' },
    zerion: { fallbackHref: 'https://zerion.io/download/', guideHref: 'https://zerion.io/blog/what-is-dapp-browser/' },
  };
  return help[walletId];
}
