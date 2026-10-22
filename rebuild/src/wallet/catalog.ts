/** Authored wallet names and reviewed navigation hosts; no remote icon metadata. */
export type WalletPlatform = 'mobile' | 'desktop' | 'unknown';
export type WalletBrand = 'metamask' | 'rabby' | 'okx' | 'coinbase';

export const walletCatalog = Object.freeze([
  { id: 'metamask', name: 'MetaMask', rdns: 'io.metamask', download: 'https://metamask.io/download/', browser: true },
  { id: 'rabby', name: 'Rabby', rdns: 'io.rabby', download: 'https://rabby.io/', browser: true },
  { id: 'okx', name: 'OKX', rdns: 'com.okex.wallet', download: 'https://web3.okx.com/download', browser: false },
  { id: 'coinbase', name: 'Base', rdns: 'com.coinbase.wallet', download: 'https://www.coinbase.com/wallet/downloads', browser: false },
] as const);

/** A presentation hint only. It never establishes provider or host identity. */
export function walletPlatform(input?: { userAgent?: unknown; platform?: unknown; maxTouchPoints?: unknown }): WalletPlatform {
  try {
    const source = input ?? (typeof navigator === 'undefined' ? undefined : navigator);
    const ua = source?.userAgent;
    if (typeof ua !== 'string' || ua.length > 2048 || !ua.trim()) return 'unknown';
    if (/Android|iPhone|iPad|iPod/i.test(ua)
      || (source?.platform === 'MacIntel' && typeof source.maxTouchPoints === 'number' && source.maxTouchPoints > 1)) return 'mobile';
    return /Windows NT|Macintosh|X11|Linux x86_64/i.test(ua) ? 'desktop' : 'unknown';
  } catch { return 'unknown'; }
}

export function absentWalletAction(id: WalletBrand, platform: WalletPlatform): 'handoff' | 'install' {
  return platform === 'mobile' && walletCatalog.find(wallet => wallet.id === id)?.browser ? 'handoff' : 'install';
}
