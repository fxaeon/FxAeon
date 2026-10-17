import type { Metadata } from 'next';

const ROUTE_METADATA = {
  portfolio: ['Portfolio', 'View verified wallet balances, positions, and FxAeon actions powered by the f(x) SDK.'],
  trade: ['Trade', 'Trade ETH and BTC positions with the f(x) SDK in FxAeon.'],
  earn: ['Earn', 'Deposit and withdraw fxSAVE with the f(x) SDK in FxAeon.'],
  borrow: ['Borrow fxUSD', 'Borrow fxUSD against ETH or BTC collateral with the f(x) SDK in FxAeon.'],
  move: ['Move', 'Move supported fxUSD and fxSAVE assets between Ethereum and Base in FxAeon.'],
  more: ['More', 'Open FxAeon transaction settings, wallet controls, history, and documentation.'],
  docs: ['Docs', 'Learn how FxAeon uses the f(x) SDK for trading, borrowing, earning, and moving assets.'],
  docsSdk: ['f(x) SDK reference', 'Explore FxAeon’s 15-method f(x) SDK integration: supported reads, transaction plans, network scope, and local patches.'],
  history: ['History', 'Review submitted and confirmed FxAeon wallet transactions.'],
  positions: ['Positions', 'Review and manage your FxAeon ETH and BTC positions.'],
  qr: ['Receive', 'Receive supported assets into your connected FxAeon wallet.'],
  settings: ['Wallet & account', 'Manage the selected wallet and Telegram session in FxAeon.'],
  login: ['Sign in', 'Connect a wallet or sign in to use FxAeon from the web or Telegram.'],
} as const;

export function routeMetadata(route: keyof typeof ROUTE_METADATA): Metadata {
  const [title, description] = ROUTE_METADATA[route];
  return {
    title,
    description,
    openGraph: {
      type: 'website',
      siteName: 'FxAeon',
      title: `${title} · FxAeon`,
      description,
      images: [{
        url: '/landing/fxaeon-banner.png',
        width: 2172,
        height: 724,
        alt: 'FxAeon — Your DeFi. All in one place.',
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} · FxAeon`,
      description,
      images: ['/landing/fxaeon-banner.png'],
    },
  };
}
