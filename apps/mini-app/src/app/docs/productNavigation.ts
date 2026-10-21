export const productNavigation = [
  { id: 'overview', title: 'Supported networks', group: 'Get started', description: 'The products, assets, and networks supported by FxAeon.' },
  { id: 'getting-started', title: 'Your first transaction', group: 'Get started', description: 'Choose a wallet, add funds on the right network, and follow your first reviewed action.' },
  { id: 'access', title: 'Telegram & browser', group: 'Get started', description: 'Open the Mini App or connect an existing wallet in your browser.' },
  { id: 'wallets', title: 'Wallets & signing', group: 'Get started', description: 'Check the selected account and understand connections, allowances, and wallet requests.' },
  { id: 'trade', title: 'Trade & leverage', group: 'Use FxAeon', description: 'Open an ETH or BTC position on Ethereum and understand its quoted exposure.' },
  { id: 'positions', title: 'Manage positions', group: 'Use FxAeon', description: 'Read collateral and debt, then add, reduce, change leverage, close, or borrow.' },
  { id: 'earn', title: 'Earn with fxSAVE', group: 'Use FxAeon', description: 'Deposit into the vault, compare withdrawal routes, and claim a queued redemption.' },
  { id: 'borrow', title: 'Borrow fxUSD', group: 'Use FxAeon', description: 'Open a collateral position and manage fxUSD debt, repayments, and withdrawals.' },
  { id: 'move', title: 'Move between chains', group: 'Use FxAeon', description: 'Bridge fxUSD or fxSAVE between Ethereum and Base, then follow destination delivery.' },
  { id: 'review', title: 'Review & confirmation', group: 'Understand the details', description: 'Read estimates, exact amounts, terms, wallet requests, and verified results.' },
  { id: 'fees', title: 'Fees & slippage', group: 'Understand the details', description: 'Separate network costs, protocol charges, bridge fees, and execution limits.' },
  { id: 'risks', title: 'Risks & rebalancing', group: 'Understand the details', description: 'Understand leverage, collateral thresholds, and the limits of protocol safeguards.' },
  { id: 'glossary', title: 'Glossary', group: 'Understand the details', description: 'Definitions for the assets, position figures, and transaction terms used in FxAeon.' },
  { id: 'history', title: 'History & recovery', group: 'Get help', description: 'Inspect submitted transactions, distinguish drafts, and handle partial actions.' },
  { id: 'privacy', title: 'Privacy & data', group: 'Get help', description: 'Understand device storage, wallet information, public records, and external services.' },
  { id: 'troubleshooting', title: 'Troubleshooting', group: 'Get help', description: 'Find the next step for connection problems, unavailable quotes, fees, or delayed delivery.' },
] as const;

export const productHref = (id: string) => `/docs/guide/${id}`;
