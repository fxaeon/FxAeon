import type { ConnectedWallet } from '@privy-io/react-auth';

export const FX_CHAIN_IDS = {
  ethereum: 1,
  base: 8453,
} as const;

export type FxChainId = (typeof FX_CHAIN_IDS)[keyof typeof FX_CHAIN_IDS];

/**
 * The transaction shape the client transaction runner hands to Privy.
 * Quantities intentionally accept the same JSON-safe values as Privy's
 * UnsignedTransactionRequest. Callers should pass hex strings for calldata
 * and numeric quantities when possible.
 */
export type FxWalletTransaction = {
  from?: string;
  to: string;
  data?: string;
  value?: string | number | bigint;
  nonce?: string | number | bigint;
  gasLimit?: string | number | bigint;
  gasPrice?: string | number | bigint;
  maxFeePerGas?: string | number | bigint;
  maxPriorityFeePerGas?: string | number | bigint;
  chainId: FxChainId;
};

export type FxWalletTransactionOptions = {
  description?: string;
  action?: string;
  buttonText?: string;
  successHeader?: string;
  successDescription?: string;
};

export type FxSelectedWallet = ConnectedWallet & {
  walletClientType?: string;
};

export type FxPrivyWallet = {
  ready: boolean;
  authenticated: boolean;
  /** Increments only after a provider reports a successful connection. */
  connectionVersion: number;
  wallets: ConnectedWallet[];
  selectedWallet?: FxSelectedWallet;
  /** Current selected wallet network when Privy has a supported chain value. */
  chainId?: FxChainId;
  address?: string;
  isEmbedded: boolean;
  /** True while a wallet prompt (Privy's modal or the browser wallet chooser) is on screen. */
  promptOpen?: boolean;
  /**
   * Request an account from the user's browser wallet. No private key leaves
   * the wallet. Rejects with WalletConnectCancelledError when the person
   * closes the prompt without connecting.
   */
  connect: (options?: { external?: boolean }) => Promise<void>;
  /** End the app wallet session. This never transfers assets or exposes keys. */
  disconnect: () => Promise<void>;
  selectWallet: (address: string) => void;
  switchChain: (chainId: FxChainId) => Promise<void>;
  sendTransaction: (
    transaction: FxWalletTransaction,
    options?: FxWalletTransactionOptions
  ) => Promise<{ hash: `0x${string}` }>;
  /** Wait for the preceding embedded-wallet success screen before revalidating a later step. */
  waitForPreviousConfirmationClose?: () => Promise<void>;
};
