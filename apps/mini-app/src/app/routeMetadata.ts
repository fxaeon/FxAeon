import type { Metadata } from 'next';

export const BRAND_TITLE = 'FxAeon · Your DeFi, in motion.';
export const BRAND_DESCRIPTION = 'Trade ETH and BTC, earn with fxSAVE, borrow fxUSD, and move assets between Ethereum and Base. On the web and in Telegram.';
export const SOCIAL_IMAGE_ALT = 'FxAeon. Your DeFi, in motion. Trade, earn, borrow, and move with f(x) Protocol.';
export const SOCIAL_IMAGE_URL = 'https://fxaeon.com/social-preview.png';

/** Emit complete social objects: Next replaces nested metadata on child routes. */
export function pageMetadata(title: string, description: string, path: string): Metadata {
  const url = new URL(path, 'https://fxaeon.com').href;
  const image = { url: SOCIAL_IMAGE_URL, width: 1200, height: 630, type: 'image/png', alt: SOCIAL_IMAGE_ALT };
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: 'FxAeon', url, title, description, images: [image] },
    twitter: { card: 'summary_large_image', site: '@FxAeonxyz', creator: '@FxAeonxyz', title, description, images: [{ url: image.url, alt: image.alt }] },
  };
}

const ROUTE_METADATA = {
  portfolio: ['Portfolio', 'View your wallet balances, positions, and recent activity in FxAeon.', '/'],
  trade: ['Trade', 'Trade leveraged ETH and BTC positions on Ethereum with f(x) Protocol.', '/trade'],
  earn: ['Earn', 'Deposit into fxSAVE, compare withdrawal options, and claim queued assets on Ethereum.', '/earn'],
  borrow: ['Borrow fxUSD', 'Borrow fxUSD against ETH or BTC collateral and manage your debt on Ethereum.', '/borrow'],
  move: ['Move', 'Move fxUSD and fxSAVE between Ethereum and Base, then follow destination delivery.', '/move'],
  send: ['Send', 'Send ETH or supported tokens to another wallet on Ethereum or Base.', '/send'],
  more: ['More', 'Open FxAeon transaction settings, wallet controls, history, and documentation.', '/more'],
  docs: ['Docs', 'Learn to trade, earn, borrow, and move with FxAeon. Find product guides, wallet help, and developer documentation.', '/docs'],
  docsGuide: ['Product guide', 'Understand FxAeon products, wallets, transaction reviews, fees, and risks before you sign.', '/docs/guide'],
  docsSdk: ['f(x) SDK reference', 'Build with FxAeon’s 15-method f(x) SDK integration: reads, transaction plans, supported networks, and execution boundaries.', '/docs/sdk'],
  history: ['History', 'Review submitted and confirmed FxAeon wallet transactions.', '/history'],
  positions: ['Positions', 'Review and manage your FxAeon ETH and BTC positions.', '/positions'],
  qr: ['Receive', 'Receive supported assets into your connected FxAeon wallet.', '/qr'],
  settings: ['Wallet & account', 'Manage the selected wallet and Telegram session in FxAeon.', '/settings'],
  login: ['Sign in', 'Connect a wallet or sign in to use FxAeon from the web or Telegram.', '/login'],
} as const;

export function routeMetadata(route: keyof typeof ROUTE_METADATA): Metadata {
  const [title, description, path] = ROUTE_METADATA[route];
  return pageMetadata(title + ' · FxAeon', description, path);
}
