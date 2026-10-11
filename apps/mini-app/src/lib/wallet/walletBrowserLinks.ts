const PUBLIC_ROUTES = new Set(['/', '/earn', '/trade', '/borrow', '/positions', '/move', '/send']);

/** Fixed public host and allowlisted route: never forward query, fragment or launch data. */
export function getWalletBrowserLinks(pathname = '/') {
  const candidate = pathname.replace(/\/$/, '') || '/';
  const route = PUBLIC_ROUTES.has(candidate) ? candidate : '/';
  return [
    { name: 'MetaMask', href: `https://link.metamask.io/dapp/fxaeon.com${route}` },
    { name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(`https://fxaeon.com${route}`)}` },
  ] as const;
}
