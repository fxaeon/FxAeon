/** Browser-only Wagmi lifecycle. Configs are created only for explicit/saved exact-provider attempts. */
import { createConfig, createConnector, ConnectorChainMismatchError, type Config, type Connector } from 'wagmi';
import { injected } from 'wagmi/connectors/injected';
import { connect, reconnect, disconnect, getConnection, watchConnection, switchChain, getWalletClient } from 'wagmi/actions';
import { mainnet, base } from 'wagmi/chains';
import { type Client, type Transport, type EIP1193Provider, type Address } from 'viem';
import { readInjectedWalletSession, requestInjectedAccounts, validWalletAccounts, type InjectedWalletSession } from './externalWalletConnection';
import { switchBrowserChain, type BrowserChainRpcConfig } from './switchBrowserChain';
import type { Eip6963Provider } from './eip6963';

type Listener = (...args: unknown[]) => unknown;
export type RawProvider = Eip6963Provider & { off?: (event: string, listener: Listener) => void };
export type Selection = { provider: RawProvider; id: string; name: string };
export type Projection = { provider: Eip6963Provider; rawProvider: RawProvider; address: string; chainId: 1 | 8453; connector: Connector };
export type DisplayProjection = Omit<Projection, 'chainId'> & { chainId?: 1 | 8453 };
type Mode = 'connect' | 'restore';
const cancelled = () => new Error('Wallet session is no longer current.');
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
// Public reconnect has an installed-core module-global lock. Serialize our calls.
let restoreQueue: Promise<unknown> = Promise.resolve();
function serializedRestore<T>(fn: () => Promise<T>): Promise<T> {
  const operation = restoreQueue.then(fn, fn);
  restoreQueue = operation.catch(() => undefined);
  return operation;
}

/** One raw callback/event; owns no listeners belonging to other consumers. */
function providerFacade(raw: RawProvider, permissions: {
  forwardEvents: () => boolean; canPrompt: () => boolean; canWrite: (method: string) => boolean; onEvent: (event: string, args: unknown[]) => void;
}) {
  const lifetime = new AbortController();
  const listeners = new Map<string, { raw: Listener; subscribers: Set<Listener> }>();
  const assertLive = () => { if (lifetime.signal.aborted) throw cancelled(); };
  const remove = raw.removeListener?.bind(raw) ?? raw.off?.bind(raw);
  // An eventful provider without a removal API cannot meet owned-listener disposal.
  if (raw.on && !remove) throw new Error('This wallet cannot safely detach its event listeners.');
  const dispatch = (args: Parameters<Eip6963Provider['request']>[0], signal?: AbortSignal): Promise<unknown> => {
      try {
        assertLive();
        if (signal?.aborted) throw cancelled();
        if (args.method === 'wallet_revokePermissions' || args.method === 'wallet_requestPermissions') throw new Error('Permission RPC is not part of session lifecycle.');
        const read = args.method === 'eth_accounts' || args.method === 'eth_chainId';
        if (args.method === 'eth_requestAccounts') {
          if (!permissions.canPrompt()) throw cancelled();
        } else if (!read && !permissions.canWrite(args.method)) throw cancelled();
        const request = args.method === 'eth_requestAccounts'
          ? requestInjectedAccounts(raw) : Promise.resolve(raw.request(args));
        // Once the wallet receives a send, local retirement cannot undo it.
        // Preserve its result for receipt tracking; never retry or republish a
        // session. Every authority/lease check above still precedes dispatch.
        if (args.method === 'eth_sendTransaction') return request;
        // Raw code can synchronously abort us before returning a rejected promise.
        void request.catch(() => undefined);
        return new Promise((resolve, reject) => {
          const cleanup = () => { lifetime.signal.removeEventListener('abort', abort); signal?.removeEventListener('abort', abort); };
          const abort = () => { cleanup(); reject(cancelled()); };
          if (lifetime.signal.aborted || signal?.aborted) { abort(); return; }
          lifetime.signal.addEventListener('abort', abort, { once: true });
          signal?.addEventListener('abort', abort, { once: true });
          void request.then((value) => { cleanup(); try { assertLive(); if (signal?.aborted) throw cancelled(); resolve(value); } catch (error) { reject(error); } }, (error) => { cleanup(); reject(error); });
        });
      } catch (error) { return Promise.reject(error); }
  };
  const request = (args: Parameters<Eip6963Provider['request']>[0], signal?: AbortSignal) => {
    const operation = dispatch(args, signal);
    // Some existing abort wrappers abandon an already-started request on abort.
    void operation.catch(() => undefined);
    return operation;
  };
  const facade: Eip6963Provider = {
    request,
    on(event, listener) {
      if (lifetime.signal.aborted) return; // Including native setup/connect continuations.
      let entry = listeners.get(event);
      if (!entry) {
        const subscribers = new Set<Listener>();
        const callback: Listener = (...args) => {
          if (lifetime.signal.aborted) return;
          permissions.onEvent(event, args); // Disable signing before native async handlers.
          if (!permissions.forwardEvents()) return; // Local core reset owns reconciliation.
          for (const subscriber of [...subscribers]) {
            try { void Promise.resolve(subscriber(...args)).catch(() => undefined); } catch { /* malformed provider event */ }
          }
        };
        entry = { raw: callback, subscribers };
        listeners.set(event, entry);
        raw.on?.(event, callback);
      }
      entry.subscribers.add(listener);
    },
    removeListener(event, listener) {
      const entry = listeners.get(event);
      if (!entry) return;
      entry.subscribers.delete(listener);
      if (!entry.subscribers.size) { remove?.(event, entry.raw); listeners.delete(event); }
    },
  };
  return {
    provider: facade,
    withSignal: (signal: AbortSignal): Eip6963Provider => ({ ...facade, request: (args) => request(args, signal) }),
    assertLive,
    dispose() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      for (const [event, entry] of listeners) remove?.(event, entry.raw);
      listeners.clear();
    },
    ownedListeners: () => listeners.size,
    ownedSubscribers: () => [...listeners.values()].reduce((sum, entry) => sum + entry.subscribers.size, 0),
  };
}

export type Candidate = {
  readonly config: Config; readonly connector: Connector; readonly selection: Selection;
  readonly ready: Promise<Candidate>; readonly mode: Mode;
  /** Review-only introspection: must remain outside application context. */
  readonly ownedListeners: () => number;
  readonly ownedSubscribers: () => number;
};
type Slot = Candidate & {
  facade: ReturnType<typeof providerFacade>; validation?: InjectedWalletSession;
  selectedAddress?: string; phase: 'candidate' | 'active' | 'retired'; revision: number;
  attemptSignal?: AbortSignal; abort: () => void; unwatch?: () => void;
  ownsAttempt: () => boolean; exactProvider: () => RawProvider | undefined;
  reconciling?: boolean; reconcilePromise?: Promise<void>; refreshAbort?: AbortController; accountAccessRevoked?: boolean; localCoreReset?: boolean;
};

export function createBrowserWagmiSessionOwner(options: {
  resolveRpcConfig: (chainId: 1 | 8453) => BrowserChainRpcConfig;
  clientForChain: (chainId: 1 | 8453) => Client;
  onDisplay?: (projection: DisplayProjection | undefined) => void;
}) {
  let active: Slot | undefined;
  let pending: Slot | undefined;
  let projection: Projection | undefined;
  let display: DisplayProjection | undefined;
  let restoreBlocked = false;
  let writeEpoch = 0;
  let switchOwner: Slot | undefined;
  let switchInFlight = false;
  let switchEpoch = 0;
  let signingLease: { slot: Slot; projection: Projection; revision: number; epoch: number } | undefined;
  const slots = new WeakMap<Candidate, Slot>();
  const publish = (value?: Projection) => { projection = value; display = value; options.onDisplay?.(display); };
  const retire = (slot: Slot) => {
    if (slot.phase === 'retired') return;
    slot.phase = 'retired'; slot.revision += 1;
    slot.refreshAbort?.abort();
    slot.attemptSignal?.removeEventListener('abort', slot.abort);
    slot.validation?.validation?.dispose(); slot.unwatch?.(); slot.facade.dispose();
    if (pending === slot) pending = undefined;
  };
  const current = (slot: Slot) => slot.phase === 'active' && active === slot
    && slot.exactProvider() === slot.selection.provider;
  const hasAuthorizedAccount = () => {
    if (!active || !current(active) || active.accountAccessRevoked) return false;
    const state = getConnection(active.config);
    return (state.connector === active.connector && validWalletAccounts(state.addresses).length > 0)
      // The deliberate local reset temporarily empties core state, but is not
      // revocation of the already accepted account. Raw loss/conflict above
      // still clears this continuity; signing requires the separate projection.
      || Boolean(active.reconciling && display?.rawProvider === active.selection.provider
        && active.selectedAddress && equal(display.address, active.selectedAddress));
  };
  const matchesStore = (slot: Slot, value: InjectedWalletSession) => {
    const state = getConnection(slot.config);
    return state.status === 'connected' && state.connector === slot.connector
      && state.chainId === value.chainId && state.addresses.some((address) => equal(address, value.address));
  };
  const project = (slot: Slot, value: InjectedWalletSession) => ({
    provider: slot.facade.provider, rawProvider: slot.selection.provider, address: value.address,
    chainId: value.chainId, connector: slot.connector,
  });
  const refresh = async (slot: Slot, revision: number, allowReconcile = true) => {
    if (!current(slot) || slot.reconciling || revision !== slot.revision) return;
    slot.refreshAbort?.abort();
    const controller = new AbortController(); slot.refreshAbort = controller;
    try {
      const accounts = getConnection(slot.config).addresses ?? [];
      const preferredAddress = accounts.find((address) => slot.selectedAddress && equal(address, slot.selectedAddress)) ?? accounts[0];
      const value = await readInjectedWalletSession(slot.facade.withSignal(controller.signal), {
        requestAccounts: false, preferredAddress, retainGuard: true, signal: controller.signal,
      });
      if (!current(slot) || slot.reconciling || revision !== slot.revision || !value?.validation?.isCurrent()) {
        value?.validation?.dispose(); return;
      }
      if (!matchesStore(slot, value)) {
        value.validation.dispose();
        // Native reconnect events may carry an old chain hint after a listener gap.
        // Never publish the fresh view until the real core store silently converges.
        if (allowReconcile && getConnection(slot.config).status === 'connected') await reconcileAccepted();
        return;
      }
      slot.validation?.validation?.dispose(); slot.validation = value;
      slot.selectedAddress = value.address;
      slot.accountAccessRevoked = false;
      publish(project(slot, value));
    } catch { /* A changed/unsupported/locked wallet remains non-signing. */ }
  };
  const invalidate = (slot: Slot) => {
    if (!current(slot)) return;
    slot.revision += 1;
    slot.refreshAbort?.abort();
    slot.validation?.validation?.dispose(); slot.validation = undefined;
    // Account identity remains accepted during same-account network/focus
    // validation. Only signing is fenced; query/review consumers must not see
    // a fabricated logout while an ordinary wallet switch is pending.
    projection = undefined;
    const accounts = validWalletAccounts(getConnection(slot.config).addresses);
    if (slot.accountAccessRevoked || !display || (!slot.reconciling && !accounts.some((account) => equal(account, display!.address)))) display = undefined;
    const state = getConnection(slot.config);
    if (display && state.status === 'connected' && state.chainId !== 1 && state.chainId !== 8453) display = { ...display, chainId: undefined };
    options.onDisplay?.(display);
    const revision = slot.revision;
    queueMicrotask(() => { void refresh(slot, revision); });
  };

  function reconcileAccepted(): Promise<void> {
      const slot = active;
      if (!slot || !current(slot) || restoreBlocked) { publish(); return Promise.resolve(); }
      if (slot.reconcilePromise) return slot.reconcilePromise;
      slot.reconciling = true; invalidate(slot);
      const operation = (async () => {
        try {
          await serializedRestore(async () => {
            slot.facade.assertLive();
            if (!current(slot)) throw cancelled();
            // Public reconnect appends core handlers on an already-connected
            // config. A local-only public reset removes those owned handlers.
            // Raw provider events are still observed, but cannot auto-connect
            // through the temporary core connect listener during this reset.
            slot.localCoreReset = true;
            try { await disconnect(slot.config, { connector: slot.connector }); }
            finally { slot.localCoreReset = false; }
            if (!current(slot)) throw cancelled();
            return reconnect(slot.config, { connectors: [slot.connector] });
          });
        } finally { slot.reconciling = false; slot.reconcilePromise = undefined; }
        if (current(slot)) {
          if (!hasAuthorizedAccount()) publish();
          await refresh(slot, slot.revision, false);
        }
      })();
      slot.reconcilePromise = operation;
      return operation;
  }

  function prepare(selection: Selection, args: {
    signal: AbortSignal; ownsAttempt: () => boolean; exactProvider: () => RawProvider | undefined;
    mode?: Mode; preferredAddress?: string;
  }): Candidate {
    if (pending) retire(pending);
    const mode = args.mode ?? 'connect';
    if (mode === 'restore' && restoreBlocked) throw new Error('Explicitly disconnected wallets require a new selection.');
    if (mode === 'restore' && !validWalletAccounts([args.preferredAddress]).length) throw new Error('Silent restore requires the remembered account.');
    if (args.signal.aborted || !args.ownsAttempt() || args.exactProvider() !== selection.provider) throw cancelled();
    const facade = providerFacade(selection.provider, {
      forwardEvents: () => !slot.reconciling,
      canPrompt: () => mode === 'connect' && slot.phase === 'candidate' && args.ownsAttempt() && !args.signal.aborted,
      canWrite: (method) => current(slot) && (
        ((method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') && switchOwner === slot && switchEpoch === writeEpoch)
        || (method === 'eth_sendTransaction' && signingLease?.slot === slot
          && signingLease.projection === projection && signingLease.revision === slot.revision
          && signingLease.epoch === writeEpoch
          && slot.validation?.validation?.isCurrent() === true)),
      onEvent: (event, args) => {
        if (slot && (event === 'disconnect' || (event === 'accountsChanged' && !validWalletAccounts(args[0]).length))) slot.accountAccessRevoked = true;
        if (slot && active === slot && event === 'accountsChanged' && display
          && !validWalletAccounts(args[0]).some((account) => equal(account, display!.address))) display = undefined;
        if (slot && active === slot && event === 'chainChanged' && display
          && Number(args[0]) !== 1 && Number(args[0]) !== 8453) display = { ...display, chainId: undefined };
        if (slot && switchOwner === slot && (event === 'accountsChanged' || event === 'disconnect')) switchOwner = undefined;
        if (slot) invalidate(slot);
      },
    });
    const connectorFactory = createConnector((context) => {
      const native = injected({ target: { id: selection.id, name: selection.name, provider: facade.provider as EIP1193Provider }, shimDisconnect: false })(context);
      return {
        ...native,
        // Public disconnect is safe local bookkeeping; native disconnect would revoke.
        async disconnect() { if (!slot.localCoreReset) facade.dispose(); },
        async switchChain({ chainId }: { chainId: number }) {
          if (chainId !== 1 && chainId !== 8453) throw new Error('Unsupported chain.');
          if (!current(slot)) throw cancelled();
          await switchBrowserChain(facade.provider, chainId, () => options.resolveRpcConfig(chainId));
          facade.assertLive();
          if (switchOwner !== slot || switchEpoch !== writeEpoch) throw cancelled();
          const actual = Number(await facade.provider.request({ method: 'eth_chainId' }));
          if (switchOwner !== slot || switchEpoch !== writeEpoch) throw cancelled();
          if (actual !== chainId) throw new Error('Wallet did not switch to the requested network.');
          context.emitter.emit('change', { chainId });
          return chainId === 1 ? mainnet : base;
        },
      };
    });
    const config = createConfig({ chains: [mainnet, base], connectors: [connectorFactory],
      storage: null, ssr: false,
      multiInjectedProviderDiscovery: false, syncConnectedChain: false,
      client({ chain }) { return options.clientForChain(chain.id) as Client<Transport, typeof chain>; },
    });
    const slot: Slot = { selection, config, connector: config.connectors[0], facade, mode,
      phase: 'candidate', revision: 0, selectedAddress: args.preferredAddress, reconciling: mode === 'restore',
      attemptSignal: args.signal, ownsAttempt: args.ownsAttempt, exactProvider: args.exactProvider,
      abort: () => retire(slot), ownedListeners: facade.ownedListeners, ownedSubscribers: facade.ownedSubscribers, ready: undefined as never };
    pending = slot; slots.set(slot, slot);
    args.signal.addEventListener('abort', slot.abort, { once: true });
    // Subscribing is real Wagmi-store ownership, without publishing candidate state.
    slot.unwatch = watchConnection(config, { onChange: () => invalidate(slot) });
    Object.assign(slot, { ready: (async () => {
      try {
        if (mode === 'restore') {
          const result = await serializedRestore(async () => {
            facade.assertLive();
            return reconnect(config, { connectors: [slot.connector] });
          });
          slot.reconciling = false;
          if (!result.length) throw new Error('Remembered wallet is not authorized.');
        } else await connect(config, { connector: slot.connector, withCapabilities: false });
        facade.assertLive();
        const value = await readInjectedWalletSession(facade.provider, {
          requestAccounts: false, signal: args.signal, preferredAddress: args.preferredAddress, retainGuard: true,
        });
        if (!value || !matchesStore(slot, value) || !args.ownsAttempt() || args.exactProvider() !== selection.provider) {
          value?.validation?.dispose(); throw cancelled();
        }
        slot.validation = value; slot.selectedAddress = value.address; slot.accountAccessRevoked = false;
        return slot;
      } catch (error) { retire(slot); throw error; }
    })() });
    return slot;
  }

  return {
    prepare,
    promote(candidate: Candidate): Projection {
      const slot = slots.get(candidate);
      if (!slot || slot.phase !== 'candidate' || pending !== slot || !slot.ownsAttempt()
        || slot.attemptSignal?.aborted || slot.exactProvider() !== slot.selection.provider
        || !slot.validation?.validation?.isCurrent() || !matchesStore(slot, slot.validation)) throw cancelled();
      const previous = active;
      slot.attemptSignal?.removeEventListener('abort', slot.abort);
      // Retained validator observes until this synchronous promotion boundary.
      slot.validation.validation.dispose();
      // Active lifetime has its own retained guard; no candidate signal remains.
      // Publication is synchronous, and facade events invalidate it before dispatch.
      slot.validation.validation = { isCurrent: () => current(slot), dispose: () => undefined };
      slot.phase = 'active'; active = slot; pending = undefined;
      if (slot.mode === 'connect') restoreBlocked = false;
      if (previous) retire(previous);
      const result = project(slot, slot.validation); publish(result); return result;
    },
    discard(candidate: Candidate) { const slot = slots.get(candidate); if (slot && slot !== active) retire(slot); },
    interruptWrites() { writeEpoch += 1; switchOwner = undefined; },
    invalidateForDiscovery() {
      writeEpoch += 1; switchOwner = undefined;
      // An ambiguous or missing provider identity ends ownership, including
      // raw listeners and queued reconciliation. A fresh selection/restore
      // must establish its own exact provider before publishing again.
      const selected = active;
      active = undefined;
      if (selected) retire(selected);
      publish();
    },
    reconcile: reconcileAccepted,
    hasCurrentIdentity: () => Boolean(active && current(active)),
    hasAuthorizedAccount,
    cancelDisconnectedSession(): boolean {
      if (hasAuthorizedAccount()) return false;
      restoreBlocked = true;
      if (pending) retire(pending);
      if (active) retire(active);
      active = undefined; publish();
      return true;
    },
    getDisplayProjection: () => active && current(active) ? display : undefined,
    getProjection: () => active && current(active) ? projection : undefined,
    getActiveConfig: () => active?.config,
    async sendTransaction(expectedChainId: 1 | 8453, transaction: Record<string, unknown>) {
      const slot = active; const value = projection;
      if (!slot || !value || !current(slot)) throw cancelled();
      if (expectedChainId !== value.chainId
        || (transaction.chainId !== undefined && Number(transaction.chainId) !== expectedChainId)) throw new Error('Transaction network does not match the active wallet.');
      if (transaction.from !== undefined && (typeof transaction.from !== 'string' || !equal(transaction.from, value.address))) throw new Error('Transaction sender does not match the active wallet.');
      if (signingLease) throw new Error('A wallet request is already pending.');
      const revision = slot.revision;
      const epoch = writeEpoch;
      const client = await getWalletClient(slot.config, {
        connector: slot.connector, account: value.address as Address, chainId: value.chainId,
      }).catch((error: unknown) => {
        // Wagmi catches a chain change during its own provider read before
        // our retained validation runs. Keep that rejection fail-closed and
        // present the same actionable message as our other signing guards.
        if (error instanceof ConnectorChainMismatchError) {
          throw new Error('The wallet network changed before signing. Review the transaction and try again.');
        }
        throw error;
      });
      if (!current(slot) || epoch !== writeEpoch || revision !== slot.revision || projection !== value) throw cancelled();
      const fresh = await readInjectedWalletSession(slot.facade.provider, {
        requestAccounts: false, preferredAddress: value.address, retainGuard: true,
      });
      if (!fresh?.validation?.isCurrent() || fresh.chainId !== expectedChainId || !current(slot)
        || epoch !== writeEpoch || revision !== slot.revision || projection !== value) { fresh?.validation?.dispose(); throw cancelled(); }
      if (signingLease) { fresh.validation.dispose(); throw new Error('A wallet request is already pending.'); }
      signingLease = { slot, projection: value, revision, epoch };
      try {
        // An explicit raw request avoids viem sendTransaction's method-fallback replay.
        const hash = await client.request({ method: 'eth_sendTransaction',
          params: [{ ...transaction, from: value.address as Address }] }, { retryCount: 0 });
        if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Wallet returned an invalid transaction hash.');
        return hash;
      } finally { signingLease = undefined; fresh.validation.dispose(); }
    },
    async switchChain(chainId: 1 | 8453) {
      if (!active || !display || !hasAuthorizedAccount()) throw cancelled();
      const slot = active;
      if (switchInFlight) throw new Error('A network switch is already pending.');
      switchInFlight = true;
      switchOwner = slot; switchEpoch = writeEpoch;
      const epoch = writeEpoch;
      try { await switchChain(slot.config, { connector: slot.connector, chainId }); }
      finally { switchInFlight = false; if (switchOwner === slot) switchOwner = undefined; }
      if (!current(slot) || epoch !== writeEpoch) throw cancelled();
      await refresh(slot, slot.revision);
      if (projection?.chainId !== chainId) throw new Error('Wallet network could not be verified.');
    },
    manualDisconnect(): void {
      restoreBlocked = true;
      const selected = active;
      if (pending) retire(pending);
      active = undefined; publish();
      if (!selected) return;
      retire(selected); // Local authority disappears before either external operation.
      void disconnect(selected.config, { connector: selected.connector }).catch(() => undefined);
      // Exactly one selected-provider best-effort revoke; hanging cannot block local UX.
      try { void selected.selection.provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => undefined); } catch { /* unsupported */ }
    },
    dispose(): void {
      if (pending) retire(pending);
      if (active) retire(active);
      active = undefined; publish();
    },
  };
}
