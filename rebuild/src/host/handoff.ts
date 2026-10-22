import { AppError } from '../domain/errors.ts';
import { absentWalletAction, walletCatalog, walletPlatform } from '../wallet/catalog.ts';
import type { WalletPlatform } from '../wallet/catalog.ts';

const publicPaths = new Set(['/', '/app', '/app/', '/portfolio', '/trade', '/positions', '/earn', '/borrow', '/move', '/send', '/history', '/settings']);
const unsafePath = /[\u0000-\u001f\u007f\\]|%(?:00|0[ad]|5c|2f|25)/i;
function invalid(): AppError { return new AppError('unavailable', 'Open FxAeon on its secure site before opening a wallet browser.'); }

/** Route only. No query, fragment, launch payload, draft, address or auth data. */
export function sanitizeWalletTarget(input: string, trustedOrigin: string): string {
  let trusted: URL;
  let target: URL;
  try { trusted = new URL(trustedOrigin); target = new URL(input, trustedOrigin); }
  catch { throw invalid(); }
  if (trusted.protocol !== 'https:' || trusted.username || trusted.password || trusted.origin !== trustedOrigin
    || target.protocol !== 'https:' || target.origin !== trustedOrigin || target.username || target.password
    || input.length > 16_384 || /[\u0000-\u001f\u007f\\]/.test(input) || unsafePath.test(target.pathname)) throw invalid();
  return `${trustedOrigin}${publicPaths.has(target.pathname) ? target.pathname : '/app/'}`;
}

/** Navigation only. This never pairs a signer or resumes a financial action. */
export function metaMaskBrowserLink(input: string, trustedOrigin: string): string {
  const target = sanitizeWalletTarget(input, trustedOrigin);
  // https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks/
  return `https://link.metamask.io/dapp/${encodeURIComponent(target.slice('https://'.length))}`;
}

export function walletNavigation(choiceId: string, input: string, trustedOrigin: string, platform: WalletPlatform = walletPlatform()): string {
  const id = choiceId.replace(/^wallet:/, '');
  const wallet = walletCatalog.find(item => item.id === id);
  if (!wallet) throw new AppError('unavailable', 'This wallet does not have a reviewed external destination.');
  // Validate before every handoff, including installation, so changed origins
  // cannot smuggle a replacement route into a previously open chooser.
  const target = sanitizeWalletTarget(input, trustedOrigin);
  if (absentWalletAction(wallet.id, platform) === 'install') return wallet.download;
  if (wallet.id === 'metamask') return metaMaskBrowserLink(target, trustedOrigin);
  if (wallet.id === 'rabby') {
    // Official source inspected at 784783cc9ddce0edf90b8a65e5c18bc02b57af00:
    // apps/mobile/src/constant/universalLink.ts and hooks/universalLink.ts.
    const link = new URL('https://go.rabby.io/mobile/');
    link.searchParams.set('_cmd', 'open-dapp');
    link.searchParams.set('dapp', target);
    return link.href;
  }
  return wallet.download;
}
