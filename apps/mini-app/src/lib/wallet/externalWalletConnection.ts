import { WalletConnectCancelledError } from './connectWatch';
import type { Eip6963Provider } from './eip6963';

export type ExternalWalletAttemptState =
  | { status: 'closed' | 'choosing' }
  | { status: 'pending' | 'error' | 'handoff'; walletId: string; name: string; message?: string; fallbackHref?: string; guideHref?: string; dappHref?: string; canReopen?: boolean };

/** One owner for every CTA. UI dismissal invalidates publication, not wallet permissions. */
export function createExternalWalletConnection<T>(options: {
  onState: (state: ExternalWalletAttemptState) => void;
  onCommit: (session: T) => void;
  onDiscard?: (session: T) => void;
  onInvalidate?: () => void;
}) {
  let generation = 0;
  let state: ExternalWalletAttemptState = { status: 'closed' };
  let operation: AbortController | undefined;
  let request: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | undefined;
  const publish = (next: ExternalWalletAttemptState) => { state = next; options.onState(next); };
  const invalidate = () => {
    generation += 1;
    operation?.abort();
    operation = undefined;
    options.onInvalidate?.();
  };
  return {
    open(): Promise<void> {
      if (request) return request.promise;
      invalidate();
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      request = { promise, resolve, reject };
      publish({ status: 'choosing' });
      return promise;
    },
    select(wallet: { id: string; name: string }, run: (signal: AbortSignal) => Promise<T>): void {
      if (!request || (state.status === 'pending' && state.walletId === wallet.id)) return;
      invalidate();
      const owner = generation;
      const pending = request;
      const controller = new AbortController();
      operation = controller;
      publish({ status: 'pending', walletId: wallet.id, name: wallet.name });
      const owns = () => request === pending && generation === owner && !controller.signal.aborted;
      void Promise.resolve().then(() => {
        if (!owns()) throw new WalletConnectCancelledError();
        return run(controller.signal);
      }).then((session) => {
        if (!owns()) { options.onDiscard?.(session); return; }
        try { options.onCommit(session); } catch (cause) { options.onDiscard?.(session); throw cause; }
        operation = undefined;
        request = undefined;
        publish({ status: 'closed' });
        pending.resolve();
      }).catch((cause: unknown) => {
        if (!owns()) return;
        operation = undefined;
        const rejected = cause && typeof cause === 'object' && 'code' in cause && cause.code === 4001;
        publish({ status: 'error', walletId: wallet.id, name: wallet.name,
          // Providers also use 4001 for incomplete onboarding or an aborted
          // request. The code alone does not establish a person's decision.
          message: rejected ? 'Connection wasn’t completed. Try again.'
            : cause instanceof Error ? cause.message : 'Could not connect. Please try again.' });
      });
    },
    handoff(wallet: { id: string; name: string }, message: string, launch: () => void, help: { fallbackHref?: string; guideHref?: string; dappHref?: string; canReopen?: boolean } = {}): void {
      if (!request) return;
      invalidate();
      publish({ status: 'handoff', walletId: wallet.id, name: wallet.name, message, ...help });
      try { launch(); }
      catch { publish({ status: 'error', walletId: wallet.id, name: wallet.name, message: 'Could not open the wallet. Please try again.', ...help }); }
    },
    back(): void {
      if (!request) return;
      invalidate();
      publish({ status: 'choosing' });
    },
    cancel(): void {
      const pending = request;
      request = undefined;
      invalidate();
      publish({ status: 'closed' });
      pending?.reject(new WalletConnectCancelledError());
    },
    getState: () => state,
  };
}

// Sharing is scoped to the actual provider object, never a brand or address.
// An injected prompt cannot be withdrawn. Reopening must not create a duplicate.
const accountPrompts = new WeakMap<Eip6963Provider, Promise<unknown>>();
export function requestInjectedAccounts(provider: Eip6963Provider): Promise<unknown> {
  const existing = accountPrompts.get(provider);
  if (existing) return existing;
  const request = Promise.resolve().then(() => provider.request({ method: 'eth_requestAccounts' }));
  accountPrompts.set(provider, request);
  void request.finally(() => { if (accountPrompts.get(provider) === request) accountPrompts.delete(provider); }).catch(() => undefined);
  return request;
}

export function validWalletAccounts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((account) => typeof account !== 'string'
    || !/^0x[0-9a-fA-F]{40}$/.test(account) || /^0x0{40}$/i.test(account))) return [];
  return [...new Map((value as string[]).map((account) => [account.toLowerCase(), account])).values()];
}

function allowedChain(value: unknown): 1 | 8453 | undefined {
  if (typeof value !== 'string' || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) return undefined;
  const chain = Number(value);
  return chain === 1 || chain === 8453 ? chain : undefined;
}

function awaitWithAbort<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  return new Promise<T>((resolve, reject) => {
    const cancelled = () => reject(new WalletConnectCancelledError());
    // The already-started provider call may synchronously abort this signal
    // before returning a rejected promise. Always consume that completion.
    void request.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancelled));
    if (signal.aborted) { cancelled(); return; }
    signal.addEventListener('abort', cancelled, { once: true });
  });
}

export type InjectedWalletSession = {
  provider: Eip6963Provider; address: string; chainId: 1 | 8453;
  validation?: { isCurrent: () => boolean; dispose: () => void };
};

/** Validate usable authority. No cached address, app launch, or metadata grants it. */
export async function readInjectedWalletSession(provider: Eip6963Provider, options: {
  requestAccounts: boolean;
  signal?: AbortSignal;
  preferredAddress?: string;
  /** Keep observation alive until the caller synchronously installs session listeners. */
  retainGuard?: boolean;
}): Promise<InjectedWalletSession | undefined> {
  let revision = 0;
  const changed = () => { revision += 1; };
  const events = ['accountsChanged', 'chainChanged', 'disconnect'];
  let retained = false;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const event of events) provider.removeListener?.(event, changed);
    options.signal?.removeEventListener('abort', dispose);
  };
  for (const event of events) provider.on?.(event, changed);
  options.signal?.addEventListener('abort', dispose, { once: true });
  const current = () => { if (options.signal?.aborted) throw new WalletConnectCancelledError(); };
  try {
    current();
    const startingRevision = revision;
    const initial = validWalletAccounts(await awaitWithAbort(options.requestAccounts
      ? requestInjectedAccounts(provider) : provider.request({ method: 'eth_accounts' }), options.signal));
    current();
    if (!options.requestAccounts && revision !== startingRevision) throw new Error('Your wallet changed while reconnecting. Please connect again.');
    if (!initial.length) {
      if (!options.requestAccounts) return undefined;
      throw new Error('The wallet did not approve a valid account. Please try again.');
    }
    const address = options.preferredAddress
      ? initial.find((account) => account.toLowerCase() === options.preferredAddress!.toLowerCase())
      : initial[0];
    if (!address) return undefined;
    const observed = revision;
    const chainId = allowedChain(await awaitWithAbort(provider.request({ method: 'eth_chainId' }), options.signal));
    current();
    if (!chainId) throw new Error('Switch your wallet to Ethereum or Base, then try again.');
    const freshAccounts = validWalletAccounts(await awaitWithAbort(provider.request({ method: 'eth_accounts' }), options.signal));
    current();
    const freshChain = allowedChain(await awaitWithAbort(provider.request({ method: 'eth_chainId' }), options.signal));
    current();
    if (revision !== observed || freshChain !== chainId || !freshAccounts.some((account) => account.toLowerCase() === address.toLowerCase())) {
      throw new Error('Your wallet account or network changed. Please try again.');
    }
    retained = Boolean(options.retainGuard);
    return { provider, address, chainId, ...(retained ? { validation: { isCurrent: () => !disposed && !options.signal?.aborted && revision === observed, dispose } } : {}) };
  } finally {
    if (!retained) dispose();
  }
}
