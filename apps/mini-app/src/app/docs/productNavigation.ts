export const productNavigation = [
  { id: 'overview', title: 'Supported networks', group: 'Get started', description: 'What you can do on Ethereum and Base with FxAeon.' },
  { id: 'getting-started', title: 'Your first transaction', group: 'Get started', description: 'Open FxAeon, choose your wallet, add funds, and review your first action.' },
  { id: 'access', title: 'Telegram & browser', group: 'Wallets', description: 'Sign in with Telegram or connect a wallet you already use.' },
  { id: 'wallets', title: 'Wallets & signing', group: 'Wallets', description: 'Choose the right account and understand every wallet request.' },
  { id: 'trade', title: 'Trade & leverage', group: 'Products', description: 'Open an ETH or BTC position and understand what leverage changes.' },
  { id: 'positions', title: 'Manage positions', group: 'Products', description: 'Read your position, adjust its exposure, or close it.' },
  { id: 'earn', title: 'Earn with fxSAVE', group: 'Products', description: 'Deposit into the savings vault, withdraw, and claim queued redemptions.' },
  { id: 'borrow', title: 'Borrow fxUSD', group: 'Products', description: 'Supply collateral, borrow fxUSD, and manage your debt.' },
  { id: 'move', title: 'Move between chains', group: 'Products', description: 'Bridge fxUSD and fxSAVE between Ethereum and Base.' },
  { id: 'fees', title: 'Fees & slippage', group: 'Help', description: 'Understand network fees, slippage controls, and transaction preferences saved on this device.' },
  { id: 'history', title: 'History & recovery', group: 'Help', description: 'Follow a transaction and recover a saved action without sending it twice.' },
  { id: 'privacy', title: 'Privacy & risks', group: 'Help', description: 'Know what stays on your device and what your wallet shares with the network.' },
  { id: 'troubleshooting', title: 'Troubleshooting', group: 'Help', description: 'Find the next step when a wallet, quote, or transaction is unavailable.' },
] as const;

export const productHref = (id: string) => `/docs/guide/${id}`;
