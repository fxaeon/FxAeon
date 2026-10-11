import type { ConnectedWallet } from '@privy-io/react-auth';
import { asChainNumber } from './helpers';
import type { FxChainId } from './types';

type EthereumProvider = Awaited<ReturnType<ConnectedWallet['getEthereumProvider']>>;
export type PrivyDispatchSnapshot = {
  ready: boolean;
  authenticated: boolean;
  userId?: string;
  wallet?: ConnectedWallet;
};

const retired = () => new Error('Wallet or session changed before signing. Reopen the action to continue.');
function providerChainNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string' || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
const embedded = (wallet: ConnectedWallet) => wallet.walletClientType === 'privy' || wallet.walletClientType === 'privy-v2';

/** Semantic identity survives SDK object hydration, but not another account/session. */
function walletIdentity(wallet: ConnectedWallet | undefined): string {
  return JSON.stringify(wallet ? [
    wallet.address.toLowerCase(), wallet.walletClientType, wallet.connectorType,
    wallet.walletIndex ?? null, wallet.connectedAt, wallet.imported ?? false,
  ] : null);
}
function sessionIdentity(snapshot: PrivyDispatchSnapshot): string {
  return JSON.stringify([snapshot.ready, snapshot.authenticated, snapshot.userId ?? '', walletIdentity(snapshot.wallet)]);
}

/**
 * Owns only pre-dispatch authority. Invalidating a ticket never cancels, retries,
 * or changes a promise already handed to Privy/the wallet provider.
 */
export function createPrivyDispatchAuthority() {
  let mounted = false;
  let generation = 0;
  let current: PrivyDispatchSnapshot = { ready: false, authenticated: false };
  let identity = sessionIdentity(current);
  const observers = new Set<(chain: number | undefined) => void>();
  const wakeups = new Set<() => void>();
  const retireTickets = new Set<() => void>();
  const wake = () => { for (const notify of [...wakeups]) notify(); };
  const invalidate = () => {
    generation += 1;
    for (const retire of [...retireTickets]) retire();
    wake();
  };
  const update = (next: PrivyDispatchSnapshot) => {
    const nextIdentity = sessionIdentity(next);
    if (identity !== nextIdentity) { invalidate(); identity = nextIdentity; }
    current = next;
    for (const observe of observers) observe(asChainNumber(next.wallet?.chainId));
    wake();
  };
  const setMounted = (next: boolean) => {
    if (mounted !== next) { mounted = next; invalidate(); }
  };

  function capture(expectedWallet: ConnectedWallet) {
    const ownedGeneration = generation;
    const ownedIdentity = walletIdentity(expectedWallet);
    let chain = asChainNumber(current.wallet?.chainId);
    let switchTarget: FxChainId | undefined;
    let invalid = false;
    let dispatched = false;
    let started = false;
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const isCurrent = () => !invalid && mounted && generation === ownedGeneration
      && current.ready && current.authenticated && Boolean(current.userId)
      && walletIdentity(current.wallet) === ownedIdentity;
    const assertCurrent = () => {
      observeChain(asChainNumber(current.wallet?.chainId));
      if (!isCurrent()) throw retired();
    };

    const observeChain = (next: number | undefined) => {
      if (dispatched || next === chain) return;
      if (switchTarget !== undefined && next === switchTarget) chain = next;
      else retireTicket();
    };
    assertCurrent();
    observers.add(observeChain);
    const dispose = () => {
      if (!disposed) {
        disposed = true;
        observers.delete(observeChain);
        retireTickets.delete(retireTicket);
      }
      for (const cleanup of cleanups.splice(0)) {
        // Cleanup must not replace an already-issued hash or provider error.
        try { cleanup(); } catch { /* Best-effort removal of this ticket's listeners only. */ }
      }
    };
    function retireTicket() {
      if (!dispatched) invalid = true;
      dispose();
    }
    retireTickets.add(retireTicket);
    const watchProvider = (provider: EthereumProvider) => {
      if (typeof provider.on !== 'function' || typeof provider.removeListener !== 'function') return;
      const changed = () => { if (!dispatched) retireTicket(); };
      let providerChain = chain;
      let acceptedSwitch = false;
      const chainChanged = (value: string | number) => {
        if (dispatched) return;
        const next = providerChainNumber(value);
        if (next === undefined) { retireTicket(); return; }
        // The only chain change allowed during preflight is its own switch.
        if (next === providerChain) return;
        if (!acceptedSwitch && switchTarget !== undefined && next === switchTarget) {
          providerChain = next;
          acceptedSwitch = true;
        } else retireTicket();
      };
      const listeners = [
        ['accountsChanged', changed], ['disconnect', changed], ['connect', changed], ['chainChanged', chainChanged],
      ] as const;
      for (const [event, listener] of listeners) {
        try {
          provider.on(event, listener);
        } finally {
          // A provider may retire this ticket synchronously from on(). Its
          // newly attached listener must still be removed, even if disposed.
          cleanups.push(() => provider.removeListener(event, listener));
        }
        assertCurrent();
      }
    };
    const waitForSwitchedEmbeddedWallet = async (target: FxChainId) => {
      // Embedded switchChain resolves after scheduling SDK state. Its old
      // ConnectedWallet creates providers for the old chain, so await the
      // authoritative replacement rather than using that stale closure.
      const deadline = Date.now() + 5_000;
      while (asChainNumber(current.wallet?.chainId) !== target) {
        assertCurrent();
        if (Date.now() >= deadline) throw new Error('The wallet network has not updated. Try again.');
        await new Promise<void>((resolve) => {
          const complete = () => { clearTimeout(timer); wakeups.delete(complete); resolve(); };
          const timer = setTimeout(complete, Math.min(50, Math.max(1, deadline - Date.now())));
          wakeups.add(complete);
        });
        assertCurrent();
      }
    };

    async function run<T>(target: FxChainId, dispatch: (provider: EthereumProvider, wallet: ConnectedWallet) => Promise<T>): Promise<T> {
      if (started || disposed) throw retired();
      started = true;
      try {
        assertCurrent();
        let wallet = current.wallet!;
        let provider = await wallet.getEthereumProvider();
        assertCurrent();
        watchProvider(provider);
        assertCurrent();
        if (chain !== target) {
          switchTarget = target;
          await wallet.switchChain(target);
          assertCurrent();
          if (embedded(wallet)) await waitForSwitchedEmbeddedWallet(target);
          assertCurrent();
          // Privy's documented contract requires acquiring a new provider
          // after switchChain. Embedded SDK wrappers are intentionally fresh.
          wallet = current.wallet!;
          const switchedProvider = await wallet.getEthereumProvider();
          assertCurrent();
          // External ConnectedWallet uses a stable SDK proxy; only embedded
          // wrappers are recreated for the newly selected chain.
          if (!embedded(wallet) && switchedProvider !== provider) throw retired();
          provider = switchedProvider;
          watchProvider(provider);
        }
        const checkedRead = async (method: 'eth_chainId' | 'eth_accounts') => {
          assertCurrent();
          const value: unknown = await provider.request({ method });
          assertCurrent();
          if (method === 'eth_chainId') {
            if (providerChainNumber(value) !== target) throw new Error('The connected wallet is on the wrong network. Switch chains and try again.');
          } else if (!Array.isArray(value) || !value.some((account: unknown) => typeof account === 'string' && account.toLowerCase() === wallet.address.toLowerCase())) {
            throw new Error('The connected wallet account does not match the selected signing wallet.');
          }
        };
        // Repeated reads catch eventless drift during an earlier read. Events
        // also invalidate A→B→A changes even if the final values match again.
        await checkedRead('eth_chainId');
        await checkedRead('eth_accounts');
        if (!embedded(wallet)) {
          const exactProvider = await current.wallet!.getEthereumProvider();
          assertCurrent();
          if (exactProvider !== provider) throw retired();
        }
        // Provider acquisition may itself wait while its state changes. Keep
        // the retained final reads after every asynchronous acquisition.
        await checkedRead('eth_chainId');
        await checkedRead('eth_accounts');
        assertCurrent();
        // No await between this final authority check and the irreversible
        // dispatch. Once issued, its result belongs to the transaction runner.
        dispatched = true;
        return await dispatch(provider, wallet);
      } finally {
        dispose();
      }
    }
    return { run, isCurrent, dispose };
  }
  return { update, invalidate, setMounted, capture };
}
