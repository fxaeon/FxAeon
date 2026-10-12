/**
 * Pure wallet-prompt visibility and watchdog rules.
 *
 * Privy's global success/error payloads have no operation identity. The
 * adapter uses only modal visibility and its own call failures to end a
 * wait; accepting an external wallet requires explicit app selection.
 * Callback event shapes below remain useful for compatibility tests, but
 * must not establish ownership of an application connection attempt.
 */

/** How long a queued click waits for the wallet provider to become ready. */
export const WALLET_READY_TIMEOUT_MS = 12_000;
/**
 * Privy shows its modal 15 ms after login() or connectWallet() is called. A
 * request whose modal has not appeared after this long was ignored.
 */
export const PRIVY_PROMPT_OPEN_GRACE_MS = 5_000;
/** How long a completed connection may take to publish its wallet address. */
export const WALLET_ADDRESS_SETTLE_MS = 10_000;
/** The longest a request may stay pending while no wallet prompt is visible. */
export const CONNECT_STALL_TIMEOUT_MS = 120_000;

/**
 * Privy callback codes that mean the person left the flow (a close button,
 * Escape, the backdrop, or declined consent) rather than that it failed.
 */
const CANCELLATION_CODES: ReadonlySet<string> = new Set([
  'exited_auth_flow',
  'exited_link_flow',
  'exited_update_flow',
  'user_exited_set_password_flow',
  'oauth_user_denied',
  // The connect-only modal reports its own close button with this code.
  'generic_connect_wallet_error',
  'user_rejected',
]);

export function isPrivyCancellationCode(code: unknown): boolean {
  return typeof code === 'string' && CANCELLATION_CODES.has(code);
}

/** A connection request the person ended themselves; callers stay quiet. */
export class WalletConnectCancelledError extends Error {
  readonly cancelled = true;

  constructor(message = 'Wallet connection was cancelled.') {
    super(message);
    this.name = 'WalletConnectCancelledError';
  }
}

export function isWalletConnectCancellation(cause: unknown): boolean {
  return cause instanceof WalletConnectCancelledError
    || (cause instanceof Error && cause.name === 'WalletConnectCancelledError');
}

/** What the adapter has observed about the Privy prompt behind one request. */
export type PrivyPromptWatch = Readonly<{
  /** Privy's modal has been on screen at some point during this request. */
  promptSeen: boolean;
}>;

export type PrivyPromptEvent =
  | Readonly<{ type: 'modal'; open: boolean }>
  | Readonly<{ type: 'success' }>
  | Readonly<{ type: 'error'; code: unknown; modalOpen: boolean }>
  | Readonly<{ type: 'open-timeout' }>;

export type PrivyPromptStep =
  | Readonly<{ outcome: 'pending'; watch: PrivyPromptWatch }>
  | Readonly<{ outcome: 'resolved' }>
  | Readonly<{ outcome: 'cancelled' }>
  | Readonly<{ outcome: 'failed'; code: unknown }>
  /** Privy never showed a prompt for the request. */
  | Readonly<{ outcome: 'unavailable' }>;

export function watchPrivyPrompt(modalOpen: boolean): PrivyPromptWatch {
  return { promptSeen: modalOpen };
}

export function stepPrivyPrompt(watch: PrivyPromptWatch, event: PrivyPromptEvent): PrivyPromptStep {
  switch (event.type) {
    case 'success':
      return { outcome: 'resolved' };
    case 'modal':
      if (event.open) return { outcome: 'pending', watch: { promptSeen: true } };
      // The prompt closed without reporting success, so the person dismissed
      // it: the backdrop, Escape, or Privy's own close button.
      return watch.promptSeen ? { outcome: 'cancelled' } : { outcome: 'pending', watch };
    case 'error':
      // A visible prompt shows the error itself and offers a retry. The
      // request ends with a later success or when the prompt closes.
      if (event.modalOpen) return { outcome: 'pending', watch: { promptSeen: true } };
      return isPrivyCancellationCode(event.code) ? { outcome: 'cancelled' } : { outcome: 'failed', code: event.code };
    case 'open-timeout':
      return watch.promptSeen ? { outcome: 'pending', watch } : { outcome: 'unavailable' };
  }
}

export type ConnectWatchdog =
  | Readonly<{ kind: 'none' }>
  /** A queued click is waiting for the provider to become ready. */
  | Readonly<{ kind: 'provider-ready'; ms: number }>
  /** A request is running with no wallet prompt on screen. */
  | Readonly<{ kind: 'stall'; ms: number }>;

const NO_WATCHDOG: ConnectWatchdog = { kind: 'none' };

/**
 * The one timer a connect button needs in its current state. A visible
 * wallet prompt belongs to the person, so it pauses both timers: the request
 * ends when they finish or close it. (Privy's seamless Telegram sign-in, for
 * one, shows its prompt before the provider reports ready.)
 */
export function connectWatchdog(state: Readonly<{
  queued: boolean;
  connecting: boolean;
  ready: boolean;
  promptOpen: boolean;
}>): ConnectWatchdog {
  if (state.promptOpen) return NO_WATCHDOG;
  if (state.connecting) return { kind: 'stall', ms: CONNECT_STALL_TIMEOUT_MS };
  if (state.queued && !state.ready) return { kind: 'provider-ready', ms: WALLET_READY_TIMEOUT_MS };
  return NO_WATCHDOG;
}
