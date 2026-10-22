/** Public contracts for the new client. No legacy application imports. */
export type Address = `0x${string}`;
export type Hash = `0x${string}`;

export interface WalletSession {
  readonly id: string;
  readonly address: Address;
  readonly chainId: number;
  readonly label: string;
}

export interface WalletChoice {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  readonly action?: 'connect' | 'handoff' | 'install';
  /** Authored local asset only; provider-supplied URLs are never rendered. */
  readonly icon?: string;
}

export interface LongIntent {
  readonly market: 'ETH';
  readonly side: 'long';
  readonly token: 'ETH';
  readonly amountWei: bigint;
  /** 30_000 = 3x. All user percentages/multipliers are integer-scaled. */
  readonly leverageBps: number;
  readonly slippageBps: number;
}

export interface ReviewedCall {
  readonly chainId: 1 | 8453;
  readonly from: Address;
  readonly to: Address;
  readonly data: Hash;
  readonly value: bigint;
  readonly nonce: number;
}

export interface MarketFacts {
  readonly chainId: 1;
  readonly blockNumber: bigint;
  readonly readAt: number;
  readonly balanceWei?: bigint;
  readonly priceUsdE18?: bigint;
  readonly minLeverageBps: number;
  readonly maxLeverageBps: number;
  readonly paused: boolean;
}

export interface LongEconomics {
  readonly collateralStEthWei: bigint;
  readonly debtFxUsdWei: bigint;
  readonly estimatedLeverageBps: number;
  readonly executionPriceUsdE18: bigint;
  readonly minimumWstEthWei: bigint;
  readonly borrowFeeRatio?: bigint;
  readonly supplyFeeRatio?: bigint;
  readonly liquidationPriceUsdE18?: bigint;
  readonly rebalancePriceUsdE18?: bigint;
}

export interface PreparedLong {
  readonly id: Hash;
  readonly sessionId: string;
  readonly intent: LongIntent;
  readonly call: ReviewedCall;
  readonly preparedAt: number;
  readonly expiresAt: number;
  readonly blockNumber: bigint;
  readonly economics: LongEconomics;
  readonly gasLimit: bigint;
  readonly feePerGasWei: bigint;
  readonly estimatedNetworkFeeWei: bigint;
  readonly requiredBalanceWei: bigint;
  readonly simulation: 'passed';
}

export interface ConfirmedPosition {
  readonly id: bigint;
  readonly collateralStEthWei: bigint;
  readonly debtFxUsdWei: bigint;
  readonly leverageBps?: number;
}

export interface VerifiedReceipt {
  readonly hash: Hash;
  readonly blockHash: Hash;
  readonly blockNumber: bigint;
  readonly status: 'success' | 'reverted';
  readonly networkFeeWei: bigint;
  /** Only an unambiguous canonical mint/delivery event establishes this ID. */
  readonly positionId?: bigint;
  readonly position?: ConfirmedPosition;
}

export interface ProtocolPort {
  /** No wallet request. Chain-proved read, optionally scoped to an address. */
  readMarket(address: Address | undefined, signal: AbortSignal): Promise<MarketFacts>;
  /** Official SDK only; policy/economics checks, simulation and fees required. */
  prepare(intent: LongIntent, session: WalletSession, signal: AbortSignal): Promise<PreparedLong>;
  /** Validate the SAME call again, never substitute another route. */
  preflight(plan: PreparedLong, session: WalletSession, signal: AbortSignal): Promise<void>;
  /** null means not canonically terminal yet, not failed and never retryable. */
  observe(hash: Hash, call: ReviewedCall, signal: AbortSignal): Promise<VerifiedReceipt | null>;
}

export interface WalletPort {
  choices(): readonly WalletChoice[];
  session(): WalletSession | null;
  subscribe(listener: () => void): () => void;
  connect(choiceId: string): Promise<WalletSession>;
  cancelConnect?(): void;
  disconnect(): void;
  /** Fresh account/chain/object checks immediately before dispatch. */
  assertSession(expected: WalletSession, signal?: AbortSignal, maxReadMs?: number): Promise<void>;
  /** Guard runs synchronously after final reads and immediately before the raw wallet request. */
  send(call: ReviewedCall, expected: WalletSession, guard: { readonly signal: AbortSignal; readonly maxReadMs: number; beforeDispatch(): void }): Promise<Hash>;
  switchToEthereum(): Promise<void>;
  switchChain?(chainId: 1 | 8453): Promise<void>;
  dispose(): void;
}

export interface Runtime {
  readonly protocol: ProtocolPort;
  readonly wallet: WalletPort;
  readonly mode: 'live' | 'simulation' | 'fork';
  readonly host: HostPort;
}

export interface HostPort {
  readonly kind: 'browser' | 'telegram';
  /** Back handler returns true if it consumed the action. */
  setBackHandler(handler: (() => boolean) | null): void;
  setTheme(theme: 'dark' | 'light'): void;
  openWallet(choiceId?: string): void;
  dispose(): void;
}
