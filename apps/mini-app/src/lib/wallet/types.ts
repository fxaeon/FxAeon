export const FX_CHAIN_IDS = {
  ethereum: 1,
  base: 8453,
} as const;

export type FxChainId = (typeof FX_CHAIN_IDS)[keyof typeof FX_CHAIN_IDS];

/**
 * App-owned transaction input shared by browser and Telegram passkey owners.
 * Callers should pass hex strings for calldata and numeric quantities when possible.
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

/** Display and read-only provider facade; signing belongs to sendTransaction. */
export type FxSelectedWallet = {
  address: string;
  type: 'ethereum';
  walletClientType?: string;
  chainId?: string;
  getEthereumProvider: () => Promise<{
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  }>;
  switchChain: (chainId: FxChainId) => Promise<void>;
};

export type FxPrivyWallet = {
  ready: boolean;
  /** The owner's authenticated wallet identity is still being restored. */
  restoring?: boolean;
  authenticated: boolean;
  /** Increments after an accepted connection or deliberate wallet selection. */
  connectionVersion: number;
  wallets: FxSelectedWallet[];
  selectedWallet?: FxSelectedWallet;
  /** Current selected wallet network when it is supported. */
  chainId?: FxChainId;
  address?: string;
  isEmbedded: boolean;
  /** True while a wallet chooser or passkey approval prompt is on screen. */
  promptOpen?: boolean;
  /** An available wallet requires an explicit choice in Settings. */
  selectionRequired?: boolean;
  /**
   * Request an account from the user's browser wallet. No private key leaves
   * the wallet. Rejects with WalletConnectCancelledError when the person
   * closes the prompt without connecting.
   */
  connect: () => Promise<void>;
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
