import {
  PRIVY_PROMPT_OPEN_GRACE_MS,
  WalletConnectCancelledError,
  stepPrivyPrompt,
  watchPrivyPrompt,
  type PrivyPromptWatch,
} from './connectWatch';

type PendingIntent = {
  promise: Promise<void>;
  reject: (cause: Error) => void;
  watch: PrivyPromptWatch;
  timer?: ReturnType<typeof setTimeout>;
};

/**
 * Owns only the app's visible modal wait, never a Privy connection result.
 * Privy 3.45 broadcasts completions to current listeners without an operation
 * ID, including work left over after Back/Close. Such events cannot accept a
 * wallet or settle a later intent. The SDK wallet list is availability; the
 * person's explicit selection is acceptance.
 */
export function createPrivyConnectionIntent() {
  let pending: PendingIntent | undefined;
  const retire = (cause: Error = new WalletConnectCancelledError()) => {
    const current = pending;
    if (!current) return;
    pending = undefined;
    if (current.timer !== undefined) clearTimeout(current.timer);
    current.reject(cause);
  };
  return {
    start(open: () => unknown, modalOpen: boolean, ready: boolean): Promise<void> {
      // All consumers share one visible Privy modal. Do not launch another
      // underlying operation just because a second button was pressed.
      if (pending) return pending.promise;
      let reject!: PendingIntent['reject'];
      const promise = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; });
      const current: PendingIntent = { promise, reject, watch: watchPrivyPrompt(modalOpen) };
      pending = current;
      if (ready) current.timer = setTimeout(() => {
        if (pending !== current) return;
        if (stepPrivyPrompt(current.watch, { type: 'open-timeout' }).outcome === 'unavailable') {
          retire(new Error('The wallet window did not open. Try again.'));
        }
      }, PRIVY_PROMPT_OPEN_GRACE_MS);
      try {
        // The public API returns void. Only a rejection of this invocation's
        // own call can end it; shared SDK success/error events cannot.
        void Promise.resolve(open()).catch((cause: unknown) => {
          if (pending === current) retire(cause instanceof Error ? cause : new Error('The wallet window could not open. Try again.'));
        });
      } catch (cause) {
        if (pending === current) retire(cause instanceof Error ? cause : new Error('The wallet window could not open. Try again.'));
      }
      return promise;
    },
    observeModal(open: boolean) {
      if (!pending) return;
      const step = stepPrivyPrompt(pending.watch, { type: 'modal', open });
      if (step.outcome === 'pending') pending.watch = step.watch;
      else if (step.outcome === 'cancelled') retire();
    },
    retire,
  };
}

export type PrivyWalletChoice = {
  address: string;
  type: string;
  walletClientType?: string;
  connectorType?: string;
  meta?: { id?: string };
  walletIndex?: number;
  imported?: boolean;
};
export type PrivyWalletSelection = Readonly<{ userId: string; identity: string }>;

/** Selection metadata only. Chain, connection time and provider objects are not a preference. */
export function privyWalletIdentity(wallet: PrivyWalletChoice): string {
  const string = (value: unknown) => typeof value === 'string' ? value : null;
  return JSON.stringify([
    wallet.type, wallet.address.toLowerCase(), string(wallet.walletClientType),
    string(wallet.connectorType), string(wallet.meta?.id),
    Number.isSafeInteger(wallet.walletIndex) ? wallet.walletIndex : null,
    typeof wallet.imported === 'boolean' ? wallet.imported : null,
  ]);
}

export function privyWalletSelection(userId: string, wallet: PrivyWalletChoice): PrivyWalletSelection {
  return Object.freeze({ userId, identity: privyWalletIdentity(wallet) });
}

export function eligiblePrivyWallets<T extends PrivyWalletChoice>(wallets: readonly T[]): T[] {
  return wallets.filter((wallet) => wallet.type === 'ethereum'
    && typeof wallet.address === 'string'
    && /^0x[0-9a-fA-F]{40}$/.test(wallet.address) && !/^0x0{40}$/i.test(wallet.address));
}

export function acceptedPrivyWallet<T extends PrivyWalletChoice>(
  wallets: readonly T[], userId: string | undefined, authenticated: boolean,
  selection: PrivyWalletSelection | undefined,
): T | undefined {
  if (!authenticated || !userId) return undefined;
  const eligible = eligiblePrivyWallets(wallets);
  if (selection) {
    if (selection.userId !== userId) return undefined;
    const matches = eligible.filter((wallet) => privyWalletIdentity(wallet) === selection.identity);
    return matches.length === 1 ? matches[0] : undefined;
  }
  // Seamless Telegram embedded-wallet hydration is unchanged. New external
  // wallets never acquire authority merely by appearing in the SDK list.
  const embedded = eligible.find((wallet) => wallet.walletClientType === 'privy' || wallet.walletClientType === 'privy-v2');
  return embedded && eligible.filter((wallet) => privyWalletIdentity(wallet) === privyWalletIdentity(embedded)).length === 1
    ? embedded : undefined;
}
