import { AppError } from '../domain/errors.ts';
import type { Address, Hash, ReviewedCall, WalletChoice, WalletPort, WalletSession } from '../domain/ports.ts';
import { absentWalletAction, walletCatalog, walletPlatform } from './catalog.ts';
import type { WalletPlatform } from './catalog.ts';

type Method = (...args: unknown[]) => unknown;
type Request = { method: string; params?: readonly unknown[] };
type Capability = { raw: object; request: Method };
type Announcement = Capability & { id: string; brand: string | null; name: string; blocked: boolean };
type Binding = Capability & {
  choiceId: string;
  label: string;
  version: number;
  retired: boolean;
  switching: 1 | 8453 | null;
  session: WalletSession | null;
  rememberedAccount: boolean;
  remove: () => void;
};

export interface BrowserWalletEnvironment {
  readonly events: EventTarget;
  /** Accessed afresh at each boundary. Never captured as signer authority. */
  readonly injected: () => unknown;
  readonly platform?: () => WalletPlatform;
  /** Only a public provider identity and public address may be persisted. */
  readonly preference?: { load(): unknown; save(value: { provider: string; address: Address } | null): void };
}

export interface BrowserWalletPort extends WalletPort {
  /** Cancel a chooser without disconnecting an already accepted wallet. */
  cancelConnect(): void;
}

const brands: Readonly<Record<string, { name: string; aliases: readonly string[] }>> = {
  'io.metamask': { name: 'MetaMask', aliases: ['MetaMask', 'MetaMask Mobile'] },
  'io.rabby': { name: 'Rabby', aliases: ['Rabby', 'Rabby Wallet'] },
  'com.coinbase.wallet': { name: 'Base', aliases: ['Coinbase Wallet', 'Base', 'Base Wallet'] },
  'io.zerion': { name: 'Zerion', aliases: ['Zerion'] },
  'com.okex.wallet': { name: 'OKX', aliases: ['OKX Wallet'] },
};
const INJECTED_ID = 'injected:generic';
const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let documentSequence = 0;

function property(value: unknown, key: string): { ok: boolean; value: unknown } {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return { ok: false, value: undefined };
  try { return { ok: true, value: Reflect.get(value, key) }; }
  catch { return { ok: false, value: undefined }; }
}

function capability(value: unknown): Capability | null {
  if (typeof value !== 'object' || value === null) return null;
  const request = property(value, 'request');
  return request.ok && typeof request.value === 'function' ? { raw: value, request: request.value as Method } : null;
}

function changed(): AppError { return new AppError('wallet-changed', 'Your wallet session changed. Connect again and review the trade.'); }
function cancelled(): AppError { return new AppError('cancelled', 'Wallet connection was cancelled.'); }
function busy(): AppError { return new AppError('busy', 'A wallet request is already open. Finish or dismiss it in your wallet.'); }
function unavailable(): AppError { return new AppError('unavailable', 'This wallet could not be verified. Choose an available wallet again.'); }
function rpcError(error: unknown, issued = false): AppError {
  if (property(error, 'code').value === 4001) return new AppError('user-rejected', 'You declined the wallet request.');
  return issued
    ? new AppError('submission-unknown', 'The wallet did not return a verified transaction hash. Check the original attempt before making another trade.')
    : unavailable();
}

async function readBoundary<T>(work: Promise<T>, signal: AbortSignal | undefined, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const boundary = new Promise<never>((_, reject) => {
    cancel = () => reject(new AppError('cancelled', 'The wallet check was cancelled before a transaction request.'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    timer = setTimeout(() => reject(new AppError('unavailable', 'Wallet checks took too long. No transaction request was made.')), milliseconds);
  });
  try { return await Promise.race([work, boundary]); }
  finally { clearTimeout(timer); if (cancel) signal?.removeEventListener('abort', cancel); }
}

function firstAccount(value: unknown, remembered?: Address): Address {
  try {
    if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw unavailable();
    for (const item of value) if (typeof item !== 'string' || !addressPattern.test(item)) throw unavailable();
    const selected = remembered && value.find(item => item.toLowerCase() === remembered);
    return ((selected || value[0]) as string).toLowerCase() as Address;
  } catch { throw unavailable(); }
}

function chain(value: unknown): number {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value) || value.length > 16) throw unavailable();
  const parsed = Number(BigInt(value));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw unavailable();
  return parsed;
}

function defaultEnvironment(): BrowserWalletEnvironment {
  return typeof window === 'undefined'
    ? { events: new EventTarget(), injected: () => undefined }
    : { events: window, injected: () => property(window, 'ethereum').value, preference: {
      load() { try { const value = window.localStorage.getItem('fxaeon.wallet.preference.v1'); return value && value.length < 1024 ? JSON.parse(value) : null; } catch { return null; } },
      save(value) { try { if (value) window.localStorage.setItem('fxaeon.wallet.preference.v1', JSON.stringify(value)); else window.localStorage.removeItem('fxaeon.wallet.preference.v1'); } catch { /* Memory-only explicit selection remains available. */ } },
    } };
}

/** EIP-6963 metadata is a display claim. Only the selected raw capability signs. */
export function createBrowserWallet(environment: BrowserWalletEnvironment = defaultEnvironment()): BrowserWalletPort {
  const instance = ++documentSequence;
  const announcements = new Map<string, Announcement>();
  const blockedBrands = new Set<string>();
  const listeners = new Set<() => void>();
  const issuedObjects = new WeakSet<object>();
  const unresolvedOrSubmittedCalls = new Set<string>();
  let sequence = 0;
  let disposed = false;
  let active: Binding | null = null;
  let sending = false;
  let switching = false;
  let refreshing = false;
  let restoreAttempted = false;
  let remembered: { provider: string; address: Address } | null = null;
  try {
    const saved = environment.preference?.load();
    const rdns = property(saved, 'provider').value;
    const address = property(saved, 'address').value;
    if (typeof rdns === 'string' && Object.hasOwn(brands, rdns) && typeof address === 'string' && addressPattern.test(address)) remembered = { provider: rdns, address: address.toLowerCase() as Address };
  } catch { /* Invalid local preferences cannot initiate a provider request. */ }
  let pending: { id: string; binding: Binding; promise: Promise<WalletSession>; cancelled: boolean; automatic: boolean; reject: (error: AppError) => void } | null = null;

  function savePreference(value: { provider: string; address: Address } | null): void {
    remembered = value;
    try { environment.preference?.save(value); } catch { /* No wallet authority depends on storage. */ }
  }

  function notify(): void {
    if (disposed) return;
    for (const listener of [...listeners]) { try { listener(); } catch { /* UI observers cannot change authority. */ } }
  }

  function fallback(): Capability | null {
    try {
      let raw = environment.injected();
      const nested = property(raw, 'providers');
      if (!nested.ok) return null;
      if (nested.value !== undefined) {
        if (!Array.isArray(nested.value) || nested.value.length !== 1) return null;
        raw = nested.value[0];
      }
      const result = capability(raw);
      if (!result || [...announcements.values()].some(entry => entry.raw === result.raw)) return null;
      return result;
    } catch { return null; }
  }

  function resolve(id: string): Capability | null {
    if (disposed) return null;
    if (id === INJECTED_ID) return fallback();
    const entry = announcements.get(id);
    if (!entry || entry.blocked || (entry.brand !== null && blockedBrands.has(entry.brand))) return null;
    const current = capability(entry.raw);
    return current?.request === entry.request ? current : null;
  }

  function exact(binding: Binding): boolean {
    const current = resolve(binding.choiceId);
    return !disposed && !binding.retired && current?.raw === binding.raw && current.request === binding.request;
  }

  function retire(binding: Binding, preservePreference = false): void {
    if (binding.retired) return;
    binding.retired = true;
    binding.version += 1;
    binding.remove();
    if (active === binding) { active = null; if (!preservePreference) savePreference(null); notify(); }
    if (pending?.binding === binding && !pending.cancelled) {
      pending.cancelled = true;
      pending.reject(changed());
    }
  }

  function checkDiscovery(): void {
    if (active && !exact(active)) retire(active);
    if (pending && !exact(pending.binding)) retire(pending.binding);
  }

  function announce(event: Event): void {
    if (disposed) return;
    const detail = property(event, 'detail').value;
    const info = property(detail, 'info').value;
    const uuid = property(info, 'uuid').value;
    const rdns = property(info, 'rdns').value;
    const suppliedName = property(info, 'name').value;
    const raw = capability(property(detail, 'provider').value);
    if (!raw || typeof uuid !== 'string' || !uuidPattern.test(uuid) || typeof rdns !== 'string' || rdns.length > 253) return;
    const canonicalRdns = rdns === 'io.metamask.mobile' ? 'io.metamask' : rdns;
    const brand = Object.hasOwn(brands, canonicalRdns) ? canonicalRdns : null;
    const known = brand === null ? undefined : brands[brand];
    const conflictingName = known !== undefined && (typeof suppliedName !== 'string' || !known.aliases.includes(suppliedName));
    const sameObject = [...announcements.values()].filter(entry => entry.raw === raw.raw);
    const conflictingObject = sameObject.some(entry => entry.brand !== brand || entry.request !== raw.request);
    if (conflictingObject) for (const entry of sameObject) entry.blocked = true;
    if (conflictingName && brand) blockedBrands.add(brand);
    const id = `eip6963:${uuid.toLowerCase()}`;
    const previous = announcements.get(id);
    if (previous) {
      if (previous.raw !== raw.raw || previous.request !== raw.request || previous.brand !== brand || conflictingName) previous.blocked = true;
    } else if ((sameObject.length === 0 || conflictingObject) && announcements.size < 32) {
      // Never read or render the provider's icon. Names are authored local text.
      announcements.set(id, { ...raw, id, brand, name: known?.name ?? `Announced browser wallet ${announcements.size + 1}`, blocked: conflictingName || conflictingObject });
    }
    if (brand && [...announcements.values()].some(entry => entry.brand === brand && entry.raw !== raw.raw)) blockedBrands.add(brand);
    checkDiscovery();
    notify();
    restoreSelected();
  }

  function requestDiscovery(): void {
    checkDiscovery();
    if (!disposed) environment.events.dispatchEvent(new Event('eip6963:requestProvider'));
    refreshSelected();
  }

  function refreshSelected(): void {
    const expected = active?.session;
    if (!expected || pending || sending || switching || refreshing || disposed) return;
    refreshing = true;
    void wallet.assertSession(expected).catch(() => { /* Fresh send checks still fail closed; no reconnect or replay. */ }).finally(() => { refreshing = false; });
  }

  function bind(choiceId: string, selected: Capability, label: string): Binding {
    const binding: Binding = { ...selected, choiceId, label, version: 0, retired: false, switching: null, session: null, rememberedAccount: false, remove: () => undefined };
    const on = property(selected.raw, 'on');
    const off = property(selected.raw, 'removeListener');
    if (!on.ok || !off.ok) throw unavailable();
    if (on.value === undefined && off.value === undefined) return binding;
    if (typeof on.value !== 'function' || typeof off.value !== 'function') throw unavailable();
    const subscriptions: [string, (value?: unknown) => void][] = [
      ['accountsChanged', value => {
        if (binding.retired) return;
        binding.version += 1;
        if (!binding.session) return;
        try { if (firstAccount(value, binding.rememberedAccount ? binding.session.address : undefined) !== binding.session.address) retire(binding); }
        catch { retire(binding); }
      }],
      ['chainChanged', value => {
        if (binding.retired) return;
        binding.version += 1;
        if (!binding.session) return;
        try {
          const next = chain(value);
          if (binding.switching === next) return;
          if (next !== binding.session.chainId) retire(binding);
        } catch { retire(binding); }
      }],
      ['disconnect', () => retire(binding)],
      ['connect', () => { if (!binding.retired) { binding.version += 1; refreshSelected(); } }],
    ];
    binding.remove = () => {
      for (const [name, listener] of subscriptions) {
        try { Reflect.apply(off.value as Method, selected.raw, [name, listener]); } catch { /* Retired callbacks are fenced. */ }
      }
    };
    try { for (const [name, listener] of subscriptions) Reflect.apply(on.value as Method, selected.raw, [name, listener]); }
    catch { binding.retired = true; binding.remove(); throw unavailable(); }
    return binding;
  }

  async function read(binding: Binding, method: string): Promise<unknown> {
    try { return await Reflect.apply(binding.request, binding.raw, [{ method } satisfies Request]); }
    catch (error) { throw rpcError(error); }
  }

  async function doubleRead(binding: Binding, guard: () => void, address?: Address, chainId?: number): Promise<{ address: Address; chainId: number }> {
    const version = binding.version;
    const check = () => {
      guard();
      if (!exact(binding) || binding.version !== version) throw changed();
      guard(); // A hostile property getter may have retired the session.
    };
    check();
    const first = firstAccount(await read(binding, 'eth_accounts'), binding.rememberedAccount ? address : undefined);
    check();
    const firstChain = chain(await read(binding, 'eth_chainId'));
    check();
    const second = firstAccount(await read(binding, 'eth_accounts'), binding.rememberedAccount ? address : undefined);
    check();
    const secondChain = chain(await read(binding, 'eth_chainId'));
    check();
    if (first !== second || (address !== undefined && second !== address)) throw changed();
    if (firstChain !== secondChain || (chainId !== undefined && secondChain !== chainId)) throw new AppError('wrong-chain', 'The wallet network changed. Choose the required network and review again.');
    return { address: second, chainId: secondChain };
  }

  function expectedBinding(expected: WalletSession, allowSwitch = false): Binding {
    const binding = active;
    if (!binding?.session || binding.session.id !== expected.id || binding.session.address !== expected.address.toLowerCase() || binding.session.chainId !== expected.chainId) throw changed();
    if (pending || (switching && !allowSwitch)) throw busy();
    if (!exact(binding) || active !== binding) { retire(binding); throw changed(); }
    return binding;
  }

  function sessionFor(binding: Binding, address: Address, chainId: number): WalletSession {
    return Object.freeze({ id: `wallet-${instance}-${++sequence}`, address, chainId, label: binding.label });
  }

  function cancelConnect(): void {
    if (!pending || pending.cancelled) return;
    pending.cancelled = true;
    pending.reject(cancelled());
    retire(pending.binding);
    notify();
    // Keep the prompt lock until its underlying request settles. Cancellation
    // cannot close a wallet's native modal or justify opening a second one.
  }

  function restoreSelected(): void {
    if (!remembered || restoreAttempted || active || pending || disposed) return;
    const saved = remembered;
    const candidates = [...announcements.values()].filter(entry => entry.brand === saved.provider && resolve(entry.id));
    if (candidates.length !== 1) return;
    const selected = candidates[0]!;
    restoreAttempted = true;
    let binding: Binding;
    try { binding = bind(selected.id, selected, selected.name); binding.rememberedAccount = true; }
    catch { return; }
    let resolvePromise!: (value: WalletSession) => void;
    let rejectPromise!: (error: AppError) => void;
    const promise = new Promise<WalletSession>((yes, no) => { resolvePromise = yes; rejectPromise = no; });
    void promise.catch(() => undefined);
    const attempt = { id: selected.id, binding, promise, cancelled: false, automatic: true, reject: rejectPromise };
    pending = attempt;
    const guard = () => { if (disposed || pending !== attempt || attempt.cancelled || binding.retired || remembered !== saved) throw cancelled(); };
    void doubleRead(binding, guard, saved.address).then(fresh => {
      guard();
      if (fresh.chainId !== 1 && fresh.chainId !== 8453) throw new AppError('wrong-chain', 'Choose a supported network before restoring this wallet.');
      binding.session = sessionFor(binding, fresh.address, fresh.chainId);
      active = binding; pending = null; notify();
      if (active !== binding || binding.retired) throw changed();
      resolvePromise(binding.session);
    }).catch(error => { retire(binding); rejectPromise(error instanceof AppError ? error : unavailable()); }).finally(() => { if (pending === attempt) pending = null; });
  }

  const wallet: BrowserWalletPort = {
    choices() {
      checkDiscovery();
      if (disposed) return [];
      const platform = environment.platform?.() ?? walletPlatform();
      const entries = [...announcements.values()];
      const choices: WalletChoice[] = walletCatalog.map(item => {
        const found = entries.find(entry => entry.brand === item.rdns);
        if (found) return Object.freeze({ id: found.id, name: item.name, available: resolve(found.id) !== null, action: 'connect' as const });
        return Object.freeze({ id: `wallet:${item.id}`, name: item.name, available: true, action: absentWalletAction(item.id, platform) });
      });
      for (const entry of entries) {
        if (!walletCatalog.some(item => item.rdns === entry.brand)) choices.push(Object.freeze({ id: entry.id, name: entry.name, available: resolve(entry.id) !== null, action: 'connect' }));
      }
      if (fallback()) choices.push(Object.freeze({ id: INJECTED_ID, name: 'Injected browser wallet (unverified)', available: true, action: 'connect' }));
      return Object.freeze(choices);
    },
    session() { checkDiscovery(); return active?.session ?? null; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect(choiceId) {
      if (disposed) return Promise.reject(cancelled());
      if (pending?.automatic) { cancelConnect(); pending = null; }
      if (pending) return pending.id === choiceId && !pending.cancelled ? pending.promise : Promise.reject(busy());
      if (switching) return Promise.reject(busy());
      const selected = resolve(choiceId);
      const choice = wallet.choices().find(item => item.id === choiceId && item.available && item.action === 'connect');
      if (!selected || !choice) return Promise.reject(unavailable());
      let binding: Binding;
      try { binding = bind(choiceId, selected, choice.name); } catch (error) { return Promise.reject(error); }
      let resolvePromise!: (value: WalletSession) => void;
      let rejectPromise!: (error: AppError) => void;
      const promise = new Promise<WalletSession>((resolveValue, rejectValue) => { resolvePromise = resolveValue; rejectPromise = rejectValue; });
      const attempt = { id: choiceId, binding, promise, cancelled: false, automatic: false, reject: rejectPromise };
      pending = attempt;
      const guard = () => { if (disposed || attempt.cancelled || pending !== attempt || binding.retired) throw cancelled(); };
      void (async () => {
        try {
          guard();
          if (!exact(binding)) throw changed();
          guard();
          const account = firstAccount(await read(binding, 'eth_requestAccounts'));
          guard();
          const fresh = await doubleRead(binding, guard, account);
          guard();
          if (active) retire(active);
          guard();
          binding.session = sessionFor(binding, fresh.address, fresh.chainId);
          active = binding;
          const brand = announcements.get(choiceId)?.brand;
          savePreference(brand ? { provider: brand, address: fresh.address } : null);
          pending = null;
          notify();
          if (active !== binding || binding.retired) throw changed();
          resolvePromise(binding.session);
        } catch (error) {
          rejectPromise(error instanceof AppError ? error : unavailable());
          retire(binding);
        } finally {
          if (pending === attempt) pending = null;
        }
      })();
      return promise;
    },
    cancelConnect,
    disconnect() { restoreAttempted = true; savePreference(null); cancelConnect(); if (active) retire(active); },
    async assertSession(expected, signal, maxReadMs = 15_000) {
      if (signal?.aborted) throw new AppError('cancelled', 'The wallet check was cancelled before a transaction request.');
      if (!Number.isFinite(maxReadMs) || maxReadMs <= 0 || maxReadMs > 15_000) throw new AppError('expired', 'This review is no longer current. Refresh before signing.');
      const binding = expectedBinding(expected);
      try {
        await readBoundary(doubleRead(binding, () => { if (expectedBinding(expected) !== binding) throw changed(); }, expected.address, expected.chainId), signal, maxReadMs);
      } catch (error) {
        if (!(error instanceof AppError && ['busy', 'cancelled', 'unavailable', 'expired'].includes(error.code))) retire(binding);
        throw error;
      }
    },
    async send(call, expected, guard) {
      if (sending || switching || pending) throw busy();
      if (!guard || typeof guard.beforeDispatch !== 'function' || !guard.signal) throw new AppError('policy', 'The wallet request is missing its review authorization.');
      const binding = expectedBinding(expected);
      const snapshot: ReviewedCall = { chainId: call.chainId, from: call.from, to: call.to, data: call.data, value: call.value, nonce: call.nonce };
      if (![1, 8453].includes(snapshot.chainId) || expected.chainId !== snapshot.chainId) throw new AppError('wrong-chain', 'Choose the reviewed network before confirming this transaction.');
      if (typeof snapshot.from !== 'string' || !addressPattern.test(snapshot.from) || snapshot.from.toLowerCase() !== expected.address.toLowerCase()
        || typeof snapshot.to !== 'string' || !addressPattern.test(snapshot.to)
        || typeof snapshot.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(snapshot.data)
        || typeof snapshot.value !== 'bigint' || snapshot.value < 0n || snapshot.value >= 2n ** 256n
        || !Number.isSafeInteger(snapshot.nonce) || snapshot.nonce < 0) throw new AppError('policy', 'The transaction does not match the selected wallet or valid Ethereum transaction fields.');
      const fingerprint = [snapshot.chainId, snapshot.from.toLowerCase(), snapshot.to.toLowerCase(), snapshot.data.toLowerCase(), snapshot.value.toString(), snapshot.nonce].join(':');
      if (issuedObjects.has(call) || unresolvedOrSubmittedCalls.has(fingerprint)) throw new AppError('policy', 'This reviewed wallet request has already been issued. Check its original outcome before starting another trade.');
      sending = true;
      try {
        await wallet.assertSession(expected, guard.signal, guard.maxReadMs);
        if (expectedBinding(expected) !== binding) throw changed();
        // No await or alternate-provider lookup between the final fence and
        // this exact raw method dispatch. Fees remain the external wallet's.
        const transaction = Object.freeze({ from: snapshot.from, to: snapshot.to, data: snapshot.data, value: `0x${snapshot.value.toString(16)}`, nonce: `0x${snapshot.nonce.toString(16)}`, chainId: `0x${snapshot.chainId.toString(16)}` });
        guard.beforeDispatch();
        if (expectedBinding(expected) !== binding) throw changed();
        issuedObjects.add(call);
        unresolvedOrSubmittedCalls.add(fingerprint);
        let result: unknown;
        try { result = await Reflect.apply(binding.request, binding.raw, [{ method: 'eth_sendTransaction', params: [transaction] } satisfies Request]); }
        catch (error) {
          const failure = rpcError(error, true);
          // A new explicit review can retry a definite rejection. The old
          // reviewed object stays consumed; unknown outcomes keep both fences.
          if (failure.code === 'user-rejected') unresolvedOrSubmittedCalls.delete(fingerprint);
          throw failure;
        }
        // A dispatched request belongs to its original runner even after
        // disconnect, disposal or replacement. Never replay or switch signer.
        if (typeof result !== 'string' || !hashPattern.test(result)) throw rpcError(undefined, true);
        return result.toLowerCase() as Hash;
      } finally { sending = false; }
    },
    switchToEthereum() { return wallet.switchChain!(1); },
    async switchChain(chainId) {
      if (chainId !== 1 && chainId !== 8453) throw new AppError('wrong-chain', 'This network is not supported.');
      if (sending || switching || pending) throw busy();
      const expected = wallet.session();
      if (!expected) throw changed();
      const binding = expectedBinding(expected);
      await wallet.assertSession(expected);
      if (expected.chainId === chainId) return;
      if (sending || switching || pending || expectedBinding(expected) !== binding) throw busy();
      switching = true;
      binding.switching = chainId;
      try {
        if (expectedBinding(expected, true) !== binding) throw changed();
        try { await Reflect.apply(binding.request, binding.raw, [{ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chainId.toString(16)}` }] } satisfies Request]); }
        catch (error) { throw rpcError(error); }
        const guard = () => { if (active !== binding || binding.retired || disposed || pending) throw changed(); };
        const fresh = await doubleRead(binding, guard, expected.address, chainId);
        guard();
        binding.session = sessionFor(binding, fresh.address, fresh.chainId);
        notify();
      } catch (error) {
        retire(binding);
        throw error;
      } finally { binding.switching = null; switching = false; }
    },
    dispose() {
      if (disposed) return;
      cancelConnect(); if (active) retire(active, true);
      disposed = true;
      listeners.clear();
      environment.events.removeEventListener('eip6963:announceProvider', announce);
      environment.events.removeEventListener('focus', requestDiscovery);
      environment.events.removeEventListener('ethereum#initialized', requestDiscovery);
    },
  };

  environment.events.addEventListener('eip6963:announceProvider', announce);
  environment.events.addEventListener('focus', requestDiscovery);
  environment.events.addEventListener('ethereum#initialized', requestDiscovery);
  requestDiscovery();
  return wallet;
}
