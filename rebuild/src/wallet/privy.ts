import { AppError } from '../domain/errors.ts';
import type { Address, Hash, ReviewedCall, WalletChoice, WalletSession } from '../domain/ports.ts';
import type { ManagedWalletPort, WalletAuthStatus, WalletManagement } from './management.ts';

type Method = (...arguments_: unknown[]) => unknown;
type Provider = { raw: object; request: Method };
export interface PrivyWalletDescriptor {
  readonly type: string;
  readonly address: string;
  readonly walletClientType: string;
  readonly connectorType: string;
  readonly meta?: { readonly id?: string };
  readonly walletIndex?: number;
  readonly imported?: boolean;
  readonly chainId: string;
  readonly connectedAt?: number;
  isConnected?(): Promise<boolean>;
  getEthereumProvider(): Promise<unknown>;
  switchChain(chainId: number): Promise<void>;
}
export interface PrivySnapshot {
  readonly ready: boolean;
  readonly authenticated: boolean;
  readonly userId: string | null;
  readonly walletsReady: boolean;
  readonly wallets: readonly PrivyWalletDescriptor[];
  readonly modalOpen: boolean;
}
export interface PrivyDriver {
  login(): void;
  connectWallet(): void;
  createWallet(): Promise<unknown>;
  logout(): Promise<void>;
  exportWallet(address: Address): Promise<void>;
  /** The implementation must keep SDK confirmation visible and use this address. */
  sendTransaction(call: ReviewedCall, address: Address): Promise<unknown>;
  setTheme(theme: 'dark' | 'light'): void;
}
export interface PrivyWalletController extends ManagedWalletPort {
  attach(driver: PrivyDriver): void;
  detach(driver: PrivyDriver): void;
  update(snapshot: PrivySnapshot): void;
  unavailable(): void;
}

type Identity = { key: string; address: Address; embedded: boolean; label: string };
type Entry = Identity & { descriptor: PrivyWalletDescriptor; id: string };
type Preference = { userId: string; key: string };
type DocumentIntent = { lastUser: string | null; preference: Preference | null; explicit: boolean; disconnected: boolean; epoch: number; owner: object };
type Binding = { entry: Entry; provider: Provider; session: WalletSession; connectedAt: number | undefined; remove(): void; retired: boolean; revision: number; switching: number | null };
const documentIntents = new WeakMap<object, DocumentIntent>();
const blank: PrivySnapshot = Object.freeze({ ready: false, authenticated: false, userId: null, walletsReady: false, wallets: [], modalOpen: false });
const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;
let serial = 0;

function get(value: unknown, name: string): unknown {
  try { return value !== null && (typeof value === 'object' || typeof value === 'function') ? Reflect.get(value, name) : undefined; }
  catch { return undefined; }
}
function unavailable(): AppError { return new AppError('unavailable', 'Telegram authentication is unavailable. Retry from Telegram or continue on the public website.'); }
function changed(): AppError { return new AppError('wallet-changed', 'Your account or selected wallet changed. Choose a wallet and review again.'); }
function cancelled(): AppError { return new AppError('cancelled', 'The wallet request was cancelled.'); }
function busy(): AppError { return new AppError('busy', 'Finish or dismiss the current wallet request first.'); }
function failure(error: unknown, issued = false): AppError {
  if (get(error, 'code') === 4001) return new AppError('user-rejected', 'You declined the wallet request.');
  return issued ? new AppError('submission-unknown', 'The wallet did not return a verified transaction hash. Check the original attempt before trying again.') : unavailable();
}
function provider(value: unknown): Provider {
  const request = get(value, 'request');
  if (typeof value !== 'object' || value === null || typeof request !== 'function') throw unavailable();
  return { raw: value, request: request as Method };
}
function connectionTime(entry: Entry): number | undefined {
  const value = entry.descriptor.connectedAt;
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw changed();
  return value;
}
async function connected(entry: Entry): Promise<void> {
  const method = entry.descriptor.isConnected;
  if (method === undefined) return;
  if (typeof method !== 'function' || await method.call(entry.descriptor) !== true) throw changed();
}
function chainId(value: unknown): number {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{1,14}$/i.test(value)) throw unavailable();
  const chain = Number(BigInt(value));
  if (!Number.isSafeInteger(chain) || chain <= 0) throw unavailable();
  return chain;
}
function includesAccount(value: unknown, address: Address): boolean {
  try { return Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(item => typeof item === 'string' && addressPattern.test(item)) && value.some(item => item.toLowerCase() === address); }
  catch { return false; }
}
function identity(wallet: PrivyWalletDescriptor): Identity | null {
  try {
    if (wallet.type !== 'ethereum' || !addressPattern.test(wallet.address) || typeof wallet.walletClientType !== 'string' || typeof wallet.connectorType !== 'string') return null;
    const metadata = wallet.meta?.id;
    if (metadata !== undefined && (typeof metadata !== 'string' || metadata.length > 253)) return null;
    if (wallet.walletIndex !== undefined && (!Number.isSafeInteger(wallet.walletIndex) || wallet.walletIndex < 0)) return null;
    if (wallet.imported !== undefined && typeof wallet.imported !== 'boolean') return null;
    const address = wallet.address.toLowerCase() as Address;
    const embedded = wallet.walletClientType === 'privy' || wallet.walletClientType === 'privy-v2';
    const names: Record<string, string> = { metamask: 'MetaMask', rabby_wallet: 'Rabby', okx_wallet: 'OKX', coinbase_wallet: 'Base' };
    return { key: JSON.stringify(['ethereum', address, wallet.walletClientType, wallet.connectorType, metadata ?? null, wallet.walletIndex ?? null, wallet.imported ?? null]), address, embedded, label: embedded ? 'Telegram wallet' : names[wallet.walletClientType] ?? 'External wallet' };
  } catch { return null; }
}

/** Fresh implementation of the audited identity and dispatch contracts. No SDK callbacks grant authority. */
export function createPrivyWallet(options: { configured: boolean; documentScope?: object; modalTimeoutMs?: number }): PrivyWalletController {
  const scope = options.documentScope ?? (typeof document === 'undefined' ? {} : document);
  const owner = {};
  const intent = documentIntents.get(scope) ?? { lastUser: null, preference: null, explicit: false, disconnected: false, epoch: 0, owner };
  intent.owner = owner;
  intent.epoch += 1;
  documentIntents.set(scope, intent);
  const instance = ++serial;
  const listeners = new Set<() => void>();
  const ids = new Map<string, string>();
  const issuedObjects = new WeakSet<object>();
  const issuedCalls = new Set<string>();
  let snapshot: PrivySnapshot = blank;
  let driver: PrivyDriver | null = null;
  let failed = !options.configured;
  let disposed = false;
  let active: Binding | null = null;
  let sequence = 0;
  let sending = false;
  let switching = false;
  let operation: Promise<void> | null = null;
  let autoPending = false;
  let selection: { id: string; promise: Promise<WalletSession>; reject(error: AppError): void; cancelled: boolean } | null = null;
  let modal: { kind: 'login' | 'connect'; promise: Promise<void>; resolve(): void; reject(error: AppError): void; opened: boolean; cancelled: boolean; timer: ReturnType<typeof setTimeout> } | null = null;

  function owns(): boolean { return !disposed && intent.owner === owner; }
  function notify(): void { if (owns()) for (const listener of [...listeners]) { try { listener(); } catch { /* Observers have no authority. */ } } }
  function authenticated(): boolean { return owns() && !failed && !!driver && snapshot.ready && snapshot.authenticated && typeof snapshot.userId === 'string' && snapshot.userId.length > 0 && !intent.disconnected; }
  function entries(): Entry[] {
    if (!authenticated() || !snapshot.walletsReady || !Array.isArray(snapshot.wallets) || snapshot.wallets.length > 100) return [];
    const result: Entry[] = [];
    for (const descriptor of snapshot.wallets) {
      const value = identity(descriptor);
      if (!value) continue;
      const compound = `${snapshot.userId}:${value.key}`;
      let id = ids.get(compound);
      if (!id) { id = `telegram-wallet-${instance}-${ids.size + 1}`; ids.set(compound, id); }
      result.push({ ...value, descriptor, id });
    }
    return result;
  }
  function unique(entry: Identity): Entry | null {
    const list = entries();
    // Address-only controls cannot distinguish colliding descriptors either.
    const matches = list.filter(item => item.key === entry.key);
    return matches.length === 1 && list.filter(item => item.address === entry.address).length === 1 ? matches[0]! : null;
  }
  function retire(binding: Binding | null, forget = false): void {
    if (binding && !binding.retired) { binding.retired = true; binding.revision += 1; binding.remove(); }
    if (active === binding) active = null;
    if (forget) { intent.preference = null; intent.explicit = true; }
  }
  function invalidate(forget = false): void { intent.epoch += 1; retire(active, forget); }
  function current(expected: WalletSession): Binding {
    const binding = active;
    const resolved = binding ? unique(binding.entry) : null;
    if (!authenticated() || !snapshot.walletsReady || !binding || binding.retired || binding.session.id !== expected.id || binding.session.address !== expected.address.toLowerCase() || binding.session.chainId !== expected.chainId || !resolved || connectionTime(resolved) !== binding.connectedAt) throw changed();
    if (selection || modal || (switching && binding.switching === null)) throw busy();
    return binding;
  }
  function exact(capability: Provider): boolean { return get(capability.raw, 'request') === capability.request; }
  function watch(binding: Binding, capability: Provider): () => void {
    let on: unknown; let off: unknown;
    try { on = Reflect.get(capability.raw, 'on'); off = Reflect.get(capability.raw, 'removeListener'); } catch { throw unavailable(); }
    if (on === undefined && off === undefined) return () => undefined;
    if (typeof on !== 'function' || typeof off !== 'function') throw unavailable();
    const invalid = () => { if (active === binding) invalidate(true); else retire(binding); notify(); };
    const events: [string, (value?: unknown) => void][] = [
      ['accountsChanged', value => { if (!includesAccount(value, binding.entry.address)) invalid(); else binding.revision += 1; }],
      ['chainChanged', value => { try { const next = chainId(value); binding.revision += 1; if (next !== binding.session.chainId && next !== binding.switching) invalid(); } catch { invalid(); } }],
      ['disconnect', invalid],
    ];
    const guarded = events.map(([name, listener]) => [name, (value?: unknown) => { if (owns() && !binding.retired) listener(value); }] as const);
    const remove = () => { for (const [name, listener] of guarded) { try { Reflect.apply(off as Method, capability.raw, [name, listener]); } catch { /* Late callbacks are fenced. */ } } };
    try { for (const [name, listener] of guarded) Reflect.apply(on as Method, capability.raw, [name, listener]); }
    catch { remove(); throw unavailable(); }
    return remove;
  }
  async function reads(capability: Provider, address: Address, expectedChain: number | undefined, guard: () => void): Promise<number> {
    const read = async (method: string): Promise<unknown> => {
      guard(); if (!exact(capability)) throw changed(); guard();
      let value: unknown;
      try { value = await Reflect.apply(capability.request, capability.raw, [{ method }]); }
      catch (error) { throw failure(error); }
      guard(); if (!exact(capability)) throw changed(); guard();
      return value;
    };
    if (!includesAccount(await read('eth_accounts'), address)) throw changed();
    const first = chainId(await read('eth_chainId'));
    if (!includesAccount(await read('eth_accounts'), address)) throw changed();
    const second = chainId(await read('eth_chainId'));
    if (first !== second || (expectedChain !== undefined && second !== expectedChain)) throw new AppError('wrong-chain', 'Your wallet network changed. Review again on the required network.');
    return second;
  }
  function session(entry: Entry, network: number): WalletSession { return Object.freeze({ id: `telegram-${instance}-${++sequence}`, address: entry.address, chainId: network, label: entry.label }); }
  async function acquire(entry: Entry, guard: () => void): Promise<Binding> {
    guard();
    const fresh = unique(entry);
    if (!fresh || typeof get(fresh.descriptor, 'getEthereumProvider') !== 'function') throw changed();
    await connected(fresh); guard();
    const capability = provider(await fresh.descriptor.getEthereumProvider());
    guard();
    const binding: Binding = { entry: fresh, provider: capability, session: session(fresh, 1), connectedAt: connectionTime(fresh), retired: false, revision: 0, switching: null, remove: () => undefined };
    try {
      binding.remove = watch(binding, capability);
      const revision = binding.revision;
      const network = await reads(capability, entry.address, undefined, () => { guard(); if (binding.retired || binding.revision !== revision || !unique(entry)) throw changed(); });
      guard();
      binding.session = session(fresh, network);
      return binding;
    } catch (error) { retire(binding); throw error; }
  }
  function accept(binding: Binding): void {
    retire(active);
    active = binding;
    intent.preference = { userId: snapshot.userId!, key: binding.entry.key };
    intent.explicit = false;
    notify();
  }
  function autoAccept(): void {
    if (!authenticated() || !snapshot.walletsReady || active || selection || autoPending || intent.disconnected) return;
    const list = entries();
    const candidate = intent.preference?.userId === snapshot.userId
      ? list.find(entry => entry.key === intent.preference!.key)
      : !intent.explicit && list.filter(entry => entry.embedded).length === 1 ? list.find(entry => entry.embedded) : undefined;
    if (!candidate || !unique(candidate)) return;
    autoPending = true;
    const epoch = intent.epoch;
    const guard = () => { if (!authenticated() || intent.epoch !== epoch || selection || !unique(candidate)) throw changed(); };
    void acquire(candidate, guard).then(binding => { try { guard(); accept(binding); } catch { retire(binding); } }).catch(() => { /* Hydration failures never select another wallet. */ }).finally(() => { autoPending = false; notify(); });
  }
  function cancelConnect(): void {
    intent.epoch += 1;
    if (selection) { selection.cancelled = true; selection.reject(cancelled()); selection = null; }
    if (modal && !modal.cancelled) { modal.cancelled = true; modal.reject(cancelled()); intent.explicit = true; }
    notify();
  }
  async function verify(expected: WalletSession, signal?: AbortSignal, maxReadMs = 15_000): Promise<Provider> {
    if (signal?.aborted) throw cancelled();
    if (!Number.isFinite(maxReadMs) || maxReadMs <= 0 || maxReadMs > 15_000) throw new AppError('expired', 'This review expired. Refresh it before signing.');
    const binding = current(expected);
    const epoch = intent.epoch;
    const revision = binding.revision;
    let live = true;
    let cleanup: () => void = () => undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const guard = () => { if (!live || signal?.aborted) throw cancelled(); if (intent.epoch !== epoch || current(expected) !== binding || binding.revision !== revision) throw changed(); };
    const work = (async () => {
      guard();
      const entry = unique(binding.entry);
      if (!entry) throw changed();
      await connected(entry); guard();
      const next = provider(await entry.descriptor.getEthereumProvider());
      guard();
      if (!entry.embedded && (next.raw !== binding.provider.raw || next.request !== binding.provider.request)) throw changed();
      if (next.raw !== binding.provider.raw) cleanup = watch(binding, next);
      await reads(next, expected.address, expected.chainId, guard);
      guard();
      if (next.raw !== binding.provider.raw) { binding.remove(); binding.remove = cleanup; cleanup = () => undefined; }
      binding.provider = next;
      return next;
    })();
    const boundary = new Promise<never>((_, reject) => {
      abort = () => reject(cancelled()); signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(() => reject(new AppError('unavailable', 'Wallet checks took too long. No transaction request was made.')), maxReadMs);
    });
    try { return await Promise.race([work, boundary]); }
    catch (error) { if (error instanceof AppError && ['wallet-changed', 'wrong-chain'].includes(error.code)) { retire(binding, true); notify(); } throw error; }
    finally { live = false; clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); cleanup(); }
  }
  function openModal(kind: 'login' | 'connect'): Promise<void> {
    if (!owns() || failed || !driver || !snapshot.ready) return Promise.reject(unavailable());
    if (modal) return modal.kind === kind && !modal.cancelled ? modal.promise : Promise.reject(busy());
    if (sending || switching || selection || operation || snapshot.modalOpen) return Promise.reject(busy());
    if (kind === 'connect' && !authenticated()) return Promise.reject(unavailable());
    if (kind === 'login') intent.disconnected = false;
    if (kind === 'login' && authenticated()) { autoAccept(); notify(); return Promise.resolve(); }
    let resolve!: () => void;
    let reject!: (error: AppError) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const attempt = { kind, promise, resolve, reject, opened: false, cancelled: false, timer: setTimeout(() => {
      if (modal !== attempt || attempt.opened) return;
      modal = null; intent.explicit = true; reject(unavailable()); notify();
    }, options.modalTimeoutMs ?? 15_000) };
    modal = attempt;
    try { kind === 'login' ? driver.login() : driver.connectWallet(); }
    catch (error) { clearTimeout(attempt.timer); modal = null; reject(failure(error)); }
    notify();
    return promise;
  }
  function runOperation(action: () => Promise<unknown>): Promise<void> {
    if (operation || sending || switching || modal || selection || snapshot.modalOpen) return Promise.reject(busy());
    const pending = (async () => { try { await action(); } catch (error) { throw failure(error); } })();
    operation = pending;
    void pending.finally(() => { if (operation === pending) operation = null; notify(); }).catch(() => undefined);
    notify();
    return pending;
  }
  const management: WalletManagement = {
    status(): WalletAuthStatus {
      const ready = authenticated() && snapshot.walletsReady;
      const state = !owns() || failed ? 'unavailable' : !driver || !snapshot.ready ? 'loading' : !authenticated() ? 'signed-out' : !snapshot.walletsReady || autoPending ? 'hydrating' : active ? 'connected' : 'choose-wallet';
      const messages = { unavailable: 'Telegram authentication is not configured or could not load. Continue on the public website to use an external wallet.', loading: 'Loading Telegram authentication…', 'signed-out': 'Connect your Telegram account to access its wallet.', hydrating: 'Checking the wallets for this Telegram account…', 'choose-wallet': 'Choose a wallet for this account. Connecting another wallet does not select it.', connected: 'Your selected wallet confirms every transaction.' };
      return Object.freeze({ state, message: messages[state], canLogin: owns() && !failed && !!driver && snapshot.ready && !authenticated(), canConnectAnother: ready, canCreateWallet: ready && !entries().some(entry => entry.embedded), canExportWallet: ready && !!active?.entry.embedded, modalOpen: snapshot.modalOpen });
    },
    login() { return openModal('login'); },
    connectAnother() { return openModal('connect'); },
    createWallet() {
      if (!management.status().canCreateWallet || !driver) return Promise.reject(unavailable());
      intent.explicit = true;
      const selectedDriver = driver;
      return runOperation(() => selectedDriver.createWallet());
    },
    exportWallet() {
      if (!management.status().canExportWallet || !active || !driver) return Promise.reject(unavailable());
      const binding = current(active.session);
      const selectedDriver = driver;
      return runOperation(() => selectedDriver.exportWallet(binding.entry.address));
    },
    setTheme(theme) { if (owns()) driver?.setTheme(theme); },
    async logout() {
      intent.disconnected = true; intent.explicit = true; intent.preference = null;
      cancelConnect(); invalidate(); notify();
      try { await driver?.logout(); } catch { throw unavailable(); }
    },
  };
  const wallet: PrivyWalletController = {
    management,
    attach(next) { if (owns()) { driver = next; failed = !options.configured; invalidate(); notify(); } },
    detach(previous) { if (driver !== previous) return; driver = null; snapshot = blank; cancelConnect(); invalidate(); notify(); },
    update(next) {
      if (!owns() || !driver || failed) return;
      const priorUser = snapshot.authenticated ? snapshot.userId : null;
      snapshot = next;
      const user = next.ready && next.authenticated && typeof next.userId === 'string' && next.userId ? next.userId : null;
      if (user && intent.lastUser !== user) {
        if (intent.lastUser !== null) { invalidate(true); cancelConnect(); }
        intent.lastUser = user;
      }
      if (!next.ready) invalidate();
      else if (!user) { if (priorUser) { invalidate(true); cancelConnect(); } else retire(active); }
      if (!next.walletsReady) invalidate();
      else if (authenticated() && intent.preference?.userId === user) {
        const matches = entries().filter(entry => entry.key === intent.preference!.key);
        if (matches.length !== 1 || !unique(matches[0]!)) invalidate(true);
      }
      if (active) {
        try { const resolved = unique(active.entry); if (!resolved || (active.switching === null && connectionTime(resolved) !== active.connectedAt)) invalidate(true); }
        catch { invalidate(true); }
      }
      if (modal) {
        if (next.modalOpen) { modal.opened = true; clearTimeout(modal.timer); }
        else if (modal.opened) {
          const completed = modal; modal = null; clearTimeout(completed.timer);
          if (!completed.cancelled) {
            if (completed.kind === 'login' && !authenticated()) completed.reject(cancelled()); else completed.resolve();
          }
        }
      }
      autoAccept(); notify();
    },
    unavailable() { failed = true; cancelConnect(); invalidate(); notify(); },
    choices(): readonly WalletChoice[] { return Object.freeze(entries().map(entry => Object.freeze({ id: entry.id, name: `${entry.label} · ${entry.address.slice(0, 6)}…${entry.address.slice(-4)}`, available: !!unique(entry), action: 'connect' as const }))); },
    session() { return authenticated() && snapshot.walletsReady && active && !active.retired && unique(active.entry) ? active.session : null; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect(id) {
      if (selection) return selection.id === id && !selection.cancelled ? selection.promise : Promise.reject(busy());
      if (sending || switching || modal || operation || snapshot.modalOpen) return Promise.reject(busy());
      const entry = entries().find(item => item.id === id);
      if (!entry || !unique(entry)) return Promise.reject(unavailable());
      intent.epoch += 1;
      const epoch = intent.epoch;
      let resolve!: (value: WalletSession) => void;
      let reject!: (error: AppError) => void;
      const promise = new Promise<WalletSession>((yes, no) => { resolve = yes; reject = no; });
      const attempt = { id, promise, reject, cancelled: false };
      selection = attempt;
      const guard = () => { if (selection !== attempt || attempt.cancelled || !authenticated() || intent.epoch !== epoch || !unique(entry)) throw cancelled(); };
      void acquire(entry, guard).then(binding => {
        try { guard(); selection = null; accept(binding); resolve(binding.session); } catch (error) { retire(binding); reject(error instanceof AppError ? error : changed()); }
      }).catch(error => reject(error instanceof AppError ? error : unavailable())).finally(() => { if (selection === attempt) selection = null; notify(); });
      notify(); return promise;
    },
    cancelConnect,
    disconnect() { void management.logout().catch(() => undefined); },
    async assertSession(expected, signal, maxReadMs) { await verify(expected, signal, maxReadMs); },
    async send(call, expected, guard) {
      if (sending || switching || selection || modal || operation || snapshot.modalOpen) throw busy();
      if (!guard || typeof guard.beforeDispatch !== 'function' || !guard.signal) throw new AppError('policy', 'The wallet request is missing review authorization.');
      const binding = current(expected);
      const copy: ReviewedCall = { chainId: call.chainId, from: call.from, to: call.to, data: call.data, value: call.value, nonce: call.nonce };
      if (![1, 8453].includes(copy.chainId) || copy.chainId !== expected.chainId) throw new AppError('wrong-chain', 'Select the reviewed network before confirming.');
      if (typeof copy.from !== 'string' || !addressPattern.test(copy.from) || copy.from.toLowerCase() !== expected.address.toLowerCase() || typeof copy.to !== 'string' || !addressPattern.test(copy.to) || typeof copy.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(copy.data) || typeof copy.value !== 'bigint' || copy.value < 0n || copy.value >= 2n ** 256n || !Number.isSafeInteger(copy.nonce) || copy.nonce < 0) throw new AppError('policy', 'The reviewed transaction fields are not valid for this wallet.');
      const fingerprint = [copy.chainId, copy.from.toLowerCase(), copy.to.toLowerCase(), copy.data.toLowerCase(), copy.value, copy.nonce].join(':');
      if (issuedObjects.has(call) || issuedCalls.has(fingerprint)) throw new AppError('policy', 'This wallet request was already issued. Check its original outcome.');
      sending = true;
      try {
        const capability = await verify(expected, guard.signal, guard.maxReadMs);
        if (current(expected) !== binding || !driver || !exact(capability)) throw changed();
        const selectedDriver = driver;
        const transaction = Object.freeze({ from: copy.from, to: copy.to, data: copy.data, value: `0x${copy.value.toString(16)}`, nonce: `0x${copy.nonce.toString(16)}`, chainId: `0x${copy.chainId.toString(16)}` });
        guard.beforeDispatch();
        if (snapshot.modalOpen) throw busy();
        if (current(expected) !== binding || driver !== selectedDriver || !exact(capability)) throw changed();
        // A hostile request getter can invalidate the session during exact().
        if (current(expected) !== binding) throw changed();
        issuedObjects.add(call); issuedCalls.add(fingerprint);
        let result: unknown;
        try {
          result = binding.entry.embedded
            ? await selectedDriver.sendTransaction(Object.freeze(copy), expected.address)
            : await Reflect.apply(capability.request, capability.raw, [{ method: 'eth_sendTransaction', params: [transaction] }]);
        } catch (error) { const reported = failure(error, true); if (reported.code === 'user-rejected') issuedCalls.delete(fingerprint); throw reported; }
        const hash = binding.entry.embedded ? get(result, 'hash') : result;
        if (typeof hash !== 'string' || !hashPattern.test(hash)) throw failure(undefined, true);
        return hash.toLowerCase() as Hash;
      } finally { sending = false; notify(); }
    },
    switchToEthereum() { return wallet.switchChain!(1); },
    async switchChain(target) {
      if (target !== 1 && target !== 8453) throw new AppError('wrong-chain', 'This network is not supported.');
      if (sending || switching || selection || modal || operation || snapshot.modalOpen) throw busy();
      const expected = wallet.session(); if (!expected) throw changed();
      const binding = current(expected);
      await verify(expected);
      if (expected.chainId === target) return;
      if (sending || switching || selection || modal || operation || snapshot.modalOpen || current(expected) !== binding) throw busy();
      switching = true; binding.switching = target; intent.epoch += 1;
      const epoch = intent.epoch;
      const guard = () => { if (!authenticated() || intent.epoch !== epoch || active !== binding || binding.retired || !unique(binding.entry)) throw changed(); };
      let removeFresh: () => void = () => undefined;
      try {
        const entry = unique(binding.entry)!;
        guard(); await entry.descriptor.switchChain(target); guard();
        const fresh = unique(binding.entry); if (!fresh) throw changed();
        const capability = provider(await fresh.descriptor.getEthereumProvider()); guard();
        if (!entry.embedded && (capability.raw !== binding.provider.raw || capability.request !== binding.provider.request)) throw changed();
        if (capability.raw !== binding.provider.raw) removeFresh = watch(binding, capability);
        const revision = binding.revision;
        await reads(capability, expected.address, target, () => { guard(); if (binding.revision !== revision) throw changed(); });
        guard(); binding.remove(); binding.provider = capability; removeFresh(); removeFresh = () => undefined; binding.remove = watch(binding, capability); binding.connectedAt = connectionTime(fresh); binding.session = session(fresh, target); notify();
      } catch (error) { retire(binding, true); notify(); throw error instanceof AppError ? error : failure(error); }
      finally { removeFresh(); binding.switching = null; switching = false; }
    },
    dispose() {
      if (disposed) return;
      cancelConnect(); invalidate(); disposed = true; driver = null;
      if (modal) { clearTimeout(modal.timer); modal = null; }
      listeners.clear();
    },
  };
  return wallet;
}
