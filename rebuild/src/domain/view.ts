import type { ErrorCode } from './errors';
import type { Hash, MarketFacts, PreparedLong, VerifiedReceipt, WalletChoice, WalletSession } from './ports';

export interface UserError { readonly code: ErrorCode; readonly message: string }
export interface TicketInput {
  readonly amount: string;
  readonly leverage: string;
  readonly slippageBps: number;
}
export type Flow =
  | { readonly stage: 'editing' }
  | { readonly stage: 'preparing' }
  | { readonly stage: 'review' | 'expired' | 'checking' | 'signing'; readonly plan: PreparedLong }
  | { readonly stage: 'pending'; readonly plan: PreparedLong; readonly hash: Hash }
  | { readonly stage: 'confirmed'; readonly plan: PreparedLong; readonly receipt: VerifiedReceipt }
  | { readonly stage: 'failed'; readonly error: UserError; readonly plan?: PreparedLong; readonly hash?: Hash; readonly receipt?: VerifiedReceipt }
  | { readonly stage: 'unverified'; readonly error: UserError; readonly plan: PreparedLong; readonly hash?: Hash };

export interface HistoryEntry {
  readonly id: string;
  readonly account: string;
  readonly createdAt: number;
  readonly amountWei: string;
  readonly leverageBps: number;
  readonly state: 'wallet-request' | 'pending' | 'unverified' | 'reverted' | 'confirmed' | 'declined';
  readonly hash?: Hash;
  readonly receipt?: VerifiedReceipt;
  /** A persisted label is never current confirmation evidence. */
  readonly verifiedInSession: boolean;
}

export interface AppState {
  readonly route: 'trade' | 'history';
  readonly theme: 'dark' | 'light';
  readonly input: TicketInput;
  readonly wallet: WalletSession | null;
  readonly choices: readonly WalletChoice[];
  readonly market: {
    readonly status: 'idle' | 'loading' | 'ready' | 'error';
    readonly facts?: MarketFacts;
    readonly message?: string;
  };
  readonly flow: Flow;
  readonly history: readonly HistoryEntry[];
  readonly notice?: UserError;
  readonly now: number;
}

export interface AppController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AppState;
  setAmount(value: string): void;
  setLeverage(value: string): void;
  setSlippage(value: number): void;
  setTheme(value: 'dark' | 'light'): void;
  navigate(route: 'trade' | 'history'): void;
  connect(choiceId: string): Promise<void>;
  disconnect(): void;
  switchChain(): Promise<void>;
  refreshMarket(): Promise<void>;
  prepare(): Promise<void>;
  cancelReview(): void;
  confirm(): Promise<void>;
  checkReceipt(id?: string): Promise<void>;
  clearNotice(): void;
  dispose(): void;
}
