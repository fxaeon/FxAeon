import {
  acceptedPrivyWallet, eligiblePrivyWallets, privyWalletSelection,
  type PrivyWalletChoice, type PrivyWalletSelection,
} from './privyConnectionIntent';

export type PrivySelectionSnapshot<T extends PrivyWalletChoice> = {
  ready: boolean;
  walletsReady: boolean;
  authenticated: boolean;
  userId?: string;
  wallets: readonly T[];
};

/** App-owned intent and choice metadata only; never a provider, SDK wallet or signing authority. */
export function createPrivySessionIntent() {
  let blocked = false;
  let lastUserId: string | undefined;
  let selection: PrivyWalletSelection | undefined;
  let requiresExplicitChoice = false;
  const listeners = new Set<() => void>();
  // Authentication churn/logout cannot erase a prior user-change or missing-
  // wallet tombstone. Only a fresh explicit choice clears that requirement.
  const clearChoice = () => { selection = undefined; };
  const observeSession = <T extends PrivyWalletChoice>(snapshot: PrivySelectionSnapshot<T>) => {
    // Auth initialization on a provider remount is not a confirmed logout.
    if (snapshot.ready && !snapshot.authenticated) clearChoice();
    if (snapshot.authenticated && snapshot.userId) {
      if (lastUserId !== undefined && lastUserId !== snapshot.userId) {
        selection = undefined;
        // A ready SDK list can still contain the old user's embedded wallet.
        requiresExplicitChoice = true;
      }
      lastUserId = snapshot.userId;
    }
  };
  const usable = <T extends PrivyWalletChoice>(snapshot: PrivySelectionSnapshot<T>) => !blocked
    && snapshot.ready && snapshot.walletsReady && snapshot.authenticated && Boolean(snapshot.userId);
  const setBlocked = (next: boolean) => {
    if (blocked === next) return;
    blocked = next;
    for (const notify of [...listeners]) notify();
  };
  return {
    isBlocked: () => blocked,
    subscribe(notify: () => void) { listeners.add(notify); return () => { listeners.delete(notify); }; },
    block: () => { clearChoice(); setBlocked(true); },
    resume: () => setBlocked(false),
    resolveWallet<T extends PrivyWalletChoice>(snapshot: PrivySelectionSnapshot<T>): T | undefined {
      // Silent, idempotent reconciliation runs before each render's publication.
      // A missing/user-changed choice must stay retired even if that render is
      // immediately interrupted by another provider remount. Never notify React
      // subscribers here or accept an external wallet from an SDK announcement.
      observeSession(snapshot);
      if (!usable(snapshot)) return undefined;
      if (selection) {
        const wallet = acceptedPrivyWallet(snapshot.wallets, snapshot.userId, true, selection);
        if (!wallet) { selection = undefined; requiresExplicitChoice = true; }
        return wallet;
      }
      if (requiresExplicitChoice) return undefined;
      const wallet = acceptedPrivyWallet(snapshot.wallets, snapshot.userId, true, undefined);
      if (wallet) selection = privyWalletSelection(snapshot.userId!, wallet);
      return wallet;
    },
    selectWallet<T extends PrivyWalletChoice>(snapshot: PrivySelectionSnapshot<T>, address: string): T | undefined {
      observeSession(snapshot);
      if (!usable(snapshot)) return undefined;
      const matches = eligiblePrivyWallets(snapshot.wallets)
        .filter((wallet) => wallet.address.toLowerCase() === address.toLowerCase());
      // The public UI passes an address. It cannot disambiguate two clients or
      // providers exposing that address, so neither may gain authority here.
      if (matches.length !== 1) return undefined;
      const wallet = matches[0];
      selection = privyWalletSelection(snapshot.userId!, wallet);
      requiresExplicitChoice = false;
      return wallet;
    },
  };
}
const documents = new WeakMap<object, ReturnType<typeof createPrivySessionIntent>>();
/** Old SDK work can outlive React remounts, but cannot outlive its document. */
export function privySessionIntentFor(documentScope: object) {
  let intent = documents.get(documentScope);
  if (!intent) { intent = createPrivySessionIntent(); documents.set(documentScope, intent); }
  return intent;
}
