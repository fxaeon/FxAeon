'use client';

import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { assertLocalForkRpcUrl, configuredRpcUrls } from '@/lib/fx/config';
import { isTelegramLaunchContext } from '@/lib/telegram';
import type { Client } from 'viem';
import { getPublicClient } from '@/lib/fx/clients';
import { createBrowserWagmiSessionOwner, type Candidate, type DisplayProjection } from './browserWagmiSessionOwner';
import { readWalletProviderSnapshot, readLegacyWalletProviderSnapshot } from './walletProviderSnapshot';
import { walletIdentityRdns } from './walletIdentity';
import { getDiscoveredEip6963Providers, recordEip6963Announcement, type Eip6963Announcement } from './eip6963';
import { buildWalletChoices, type WalletChoice } from './walletCatalog';
import { resolveWalletConnectionRoute, resolveWalletEnvironment } from './walletConnectionRoutes';
import { createExternalWalletConnection, validWalletAccounts, type ExternalWalletAttemptState } from './externalWalletConnection';
import { FxWalletContext } from './context';
import { asHexQuantity } from './helpers';
import { type FxChainId, type FxPrivyWallet, type FxSelectedWallet, type FxWalletTransaction } from './types';
import { ExternalWalletDialog } from '@/components/ExternalWalletDialog';

export { usePrivyWallet } from './context';
export { FX_CHAIN_IDS, type FxChainId, type FxPrivyWallet, type FxSelectedWallet, type FxWalletTransaction, type FxWalletTransactionOptions } from './types';

const BROWSER_DISCONNECTED_KEY = 'fxaeon:browser-wallet-disconnected';

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

function discoverEip6963(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Announcement>).detail;
    if (recordEip6963Announcement(detail)) onChange();
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  // Request on every mount; StrictMode/unmount must not consume discovery forever.
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
}

function configuredScreenshotProvider(): Eip1193Provider | undefined {
  if (typeof window === 'undefined' || process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE !== '1') return undefined;
  const address = process.env.NEXT_PUBLIC_FX_SCREENSHOT_WALLET_ADDRESS;
  const rpcUrl = process.env.NEXT_PUBLIC_FX_ANVIL_RPC_URL;
  return address && rpcUrl ? screenshotProvider(address, rpcUrl) : undefined;
}

function legacyBrowserProvider(): Eip1193Provider | undefined {
  try {
    const candidate = typeof window === 'undefined' ? undefined : window.ethereum;
    return typeof candidate?.request === 'function' ? candidate : undefined;
  } catch { return undefined; }
}

function legacyBrowserProviders() {
  return readLegacyWalletProviderSnapshot(providerSnapshot(), typeof window === 'undefined' ? undefined : window);
}

const BROWSER_ADDRESS_KEY = 'fxaeon:browser-wallet-address';
const BROWSER_PROVIDER_KEY = 'fxaeon:wallet-provider-rdns';
function readPreference(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function savePreference(key: string, value?: string): void {
  try { if (value === undefined) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value); } catch { /* Storage denial must not change session authority. */ }
}

let screenshotProviderInstance: Eip1193Provider | undefined;
function screenshotProvider(address: string, rpcUrl: string): Eip1193Provider {
  if (screenshotProviderInstance) return screenshotProviderInstance;
  const normalizedAddress = address.toLowerCase();
  const localRpc = assertLocalForkRpcUrl(rpcUrl, 'Screenshot fork RPC URL');
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  screenshotProviderInstance = {
    request: async ({ method, params }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [normalizedAddress];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      if (method === 'eth_sendTransaction') throw new Error('Screenshot fork wallet is read-only.');
      const response = await fetch(localRpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params ?? [] }),
      });
      if (!response.ok) throw new Error(`Screenshot fork RPC returned HTTP ${response.status}`);
      const payload = await response.json() as { result?: unknown; error?: { message?: string } };
      if (payload.error) throw new Error(payload.error.message ?? 'Screenshot fork RPC request failed');
      return payload.result;
    },
    on: (event, listener) => { (listeners.get(event) ?? (listeners.set(event, new Set()), listeners.get(event)!)).add(listener); },
    removeListener: (event, listener) => { listeners.get(event)?.delete(listener); },
  };
  return screenshotProviderInstance;
}

function providerSnapshot() {
  return readWalletProviderSnapshot(getDiscoveredEip6963Providers(), typeof window === 'undefined' ? undefined : window);
}

function savedWalletChoice(rdns: string | null) {
  if (!rdns) return undefined;
  return buildWalletChoices(providerSnapshot()).find((choice) => choice.rdns === walletIdentityRdns(rdns)
    && choice.injected === 'available' && choice.provider);
}

function browserChainConfig(chainId: FxChainId) {
  const localForkRpcUrl = process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE === '1'
    ? process.env.NEXT_PUBLIC_FX_ANVIL_RPC_URL : undefined;
  return localForkRpcUrl ? { localForkRpcUrl } : { configuredRpcUrls: configuredRpcUrls(chainId) };
}

type SessionOwner = ReturnType<typeof createBrowserWagmiSessionOwner>;
type PendingSession = { candidate: Candidate; choice: WalletChoice; acceptIdentity: () => void };

function walletDescriptor(session: DisplayProjection, owner: SessionOwner): FxSelectedWallet {
  return {
    address: session.address,
    type: 'ethereum',
    walletClientType: 'browser',
    chainId: session.chainId ? `eip155:${session.chainId}` : undefined,
    // Expose only the fenced facade. Raw identity/config/connector stay private.
    getEthereumProvider: async () => session.provider,
    switchChain: (nextChain: FxChainId) => owner.switchChain(nextChain),
  } as unknown as FxSelectedWallet;
}

/** Browser Wagmi session owner; Telegram mounts its separate Privy branch. */
export function BrowserWalletProvider({ children, allowTelegramHost = false }: {
  children: ReactNode;
  allowTelegramHost?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [, setProviderVersion] = useState(0);
  const [connectionState, setConnectionState] = useState<ExternalWalletAttemptState>({ status: 'closed' });
  const [session, setSession] = useState<DisplayProjection>();
  const [connectionVersion, setConnectionVersion] = useState(0);
  const connectAttemptRef = useRef(0);
  const chosenWalletRef = useRef<WalletChoice | null>(null);
  const restoreAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const ownerRef = useRef<SessionOwner | null>(null);
  if (!ownerRef.current) {
    // Constructing the owner performs no discovery/config/connector setup.
    // Only an explicit selection or validated saved selection creates one.
    ownerRef.current = createBrowserWagmiSessionOwner({
      resolveRpcConfig: browserChainConfig,
      clientForChain: (chainId) => getPublicClient(chainId) as unknown as Client,
      onDisplay: (next) => {
        if (!mountedRef.current) return;
        setSession(next);
        if (next) savePreference(BROWSER_ADDRESS_KEY, next.address);
      },
    });
  }
  const owner = ownerRef.current;
  const connectionRef = useRef<ReturnType<typeof createExternalWalletConnection<PendingSession>> | null>(null);
  if (!connectionRef.current) {
    connectionRef.current = createExternalWalletConnection<PendingSession>({
      onState: setConnectionState,
      onInvalidate: () => {
        connectAttemptRef.current += 1;
        owner.interruptWrites();
        restoreAbortRef.current?.abort();
        restoreAbortRef.current = null;
      },
      onDiscard: ({ candidate }) => owner.discard(candidate),
      onCommit: ({ candidate, choice, acceptIdentity }) => {
        const accepted = owner.promote(candidate);
        acceptIdentity();
        setConnectionVersion((version) => version + 1);
        savePreference(BROWSER_DISCONNECTED_KEY);
        savePreference(BROWSER_PROVIDER_KEY, choice.rdns && !/^unknown-wallet-\d+$/.test(choice.rdns) ? choice.rdns : undefined);
        savePreference(BROWSER_ADDRESS_KEY, accepted.address);
      },
    });
  }
  const connection = connectionRef.current;

  useEffect(() => {
    mountedRef.current = true;
    if (!allowTelegramHost && isTelegramLaunchContext()) { setReady(true); return; }
    let mounted = true;
    let restoring = false;
    let restoringProvider: Eip1193Provider | undefined;
    let restoreAgain = false;
    const restore = async () => {
      if (!mounted || owner.getActiveConfig() || connection.getState().status !== 'closed'
        || readPreference(BROWSER_DISCONNECTED_KEY) === '1') return;
      const preferred = readPreference(BROWSER_PROVIDER_KEY);
      const screenshot = configuredScreenshotProvider();
      const preferredAddress = validWalletAccounts([screenshot
        ? process.env.NEXT_PUBLIC_FX_SCREENSHOT_WALLET_ADDRESS : readPreference(BROWSER_ADDRESS_KEY)])[0];
      if (!preferredAddress) return;
      const choice = savedWalletChoice(preferred);
      const target = screenshot ?? choice?.provider;
      if (restoring) {
        // A delayed read from an obsolete namespace must not block a new
        // exact provider indefinitely. Its facade consumes the old RPC result.
        if (target !== restoringProvider) {
          restoreAgain = true;
          restoreAbortRef.current?.abort();
        }
        return;
      }
      if (!target) return;
      restoring = true;
      restoringProvider = target;
      const controller = new AbortController();
      restoreAbortRef.current = controller;
      const attempt = connectAttemptRef.current;
      let candidate: Candidate | undefined;
      try {
        candidate = owner.prepare({ provider: target, id: choice?.id ?? 'screenshot', name: choice?.name ?? 'Wallet' }, {
          mode: 'restore', preferredAddress, signal: controller.signal,
          ownsAttempt: () => mounted && attempt === connectAttemptRef.current && !controller.signal.aborted
            && readPreference(BROWSER_DISCONNECTED_KEY) !== '1' && !owner.getActiveConfig(),
          exactProvider: () => screenshot ? configuredScreenshotProvider() : savedWalletChoice(preferred)?.provider,
        });
        await candidate.ready;
        owner.promote(candidate);
      } catch { if (candidate) owner.discard(candidate); }
      finally {
        restoring = false;
        restoringProvider = undefined;
        if (restoreAbortRef.current === controller) restoreAbortRef.current = null;
        if (mounted) setReady(true);
        if (restoreAgain) { restoreAgain = false; void restore(); }
      }
    };
    const reconcile = () => {
      if (!mounted || document.visibilityState === 'hidden' || connection.getState().status !== 'closed') return;
      // Compatibility namespaces can change without an EIP-6963 announcement.
      // Retire a stale passive owner before attempting fresh saved discovery;
      // explicit selections retain their accepted exact-object authority.
      if (owner.getActiveConfig() && !owner.hasCurrentIdentity()) owner.invalidateForDiscovery();
      if (owner.getActiveConfig()) void owner.reconcile().catch(() => undefined);
      else void restore();
    };
    const stopDiscovery = discoverEip6963(() => {
      // An unrelated announcement does not interrupt an accepted signer. A
      // conflicting/replaced exact identity is fenced synchronously by owner.
      if (owner.getActiveConfig() && !owner.hasCurrentIdentity()) owner.invalidateForDiscovery();
      setProviderVersion((version) => version + 1);
      void restore();
    });
    const initial = window.setTimeout(() => { if (mounted) setReady(true); void restore(); }, 200);
    // Mobile wallet bridges can assign their documented namespace after the
    // shell becomes ready, without an announcement or initialization event.
    // Observe startup changes for a bounded window; never repeatedly retry a
    // present but unauthorized provider, or prompt from saved preferences.
    let startupProvider = savedWalletChoice(readPreference(BROWSER_PROVIDER_KEY))?.provider;
    const startupPoll = window.setInterval(() => {
      const next = savedWalletChoice(readPreference(BROWSER_PROVIDER_KEY))?.provider;
      if (next === startupProvider) return;
      startupProvider = next;
      if (!owner.getActiveConfig() || !owner.hasCurrentIdentity()) reconcile();
    }, 200);
    const stopStartupPoll = window.setTimeout(() => window.clearInterval(startupPoll), 5_000);
    window.addEventListener('focus', reconcile);
    window.addEventListener('ethereum#initialized', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      mounted = false;
      window.clearTimeout(initial);
      window.clearInterval(startupPoll);
      window.clearTimeout(stopStartupPoll);
      stopDiscovery();
      window.removeEventListener('focus', reconcile);
      window.removeEventListener('ethereum#initialized', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
      restoreAbortRef.current?.abort();
      restoreAbortRef.current = null;
    };
  }, [allowTelegramHost, connection, owner]);

  const chooserOpen = connectionState.status !== 'closed';
  useEffect(() => {
    if (!chooserOpen) return;
    // Namespace/global assignments have no standard event. Observe identities
    // only while the picker is visible; selection always takes a fresh read.
    let previous = providerSnapshot();
    let legacy = legacyBrowserProviders();
    const timer = window.setInterval(() => {
      const next = providerSnapshot();
      const nextLegacy = legacyBrowserProviders();
      if (nextLegacy.length === legacy.length && nextLegacy.every((item, index) => item.provider === legacy[index].provider && item.name === legacy[index].name)
        && next.length === previous.length
        && next.every((item, index) => item.provider === previous[index].provider && item.rdns === previous[index].rdns)) return;
      previous = next; legacy = nextLegacy;
      if (owner.getActiveConfig() && !owner.hasCurrentIdentity()) owner.invalidateForDiscovery();
      setProviderVersion((version) => version + 1);
    }, 200);
    return () => window.clearInterval(timer);
  }, [chooserOpen, owner]);

  const connect = useCallback(() => {
    if (!allowTelegramHost && isTelegramLaunchContext()) return Promise.resolve();
    return connection.open();
  }, [allowTelegramHost, connection]);
  useEffect(() => () => {
    mountedRef.current = false;
    connection.cancel();
    owner.dispose();
  }, [connection, owner]);
  const disconnect = useCallback(async () => {
    connection.cancel();
    savePreference(BROWSER_DISCONNECTED_KEY, '1');
    savePreference(BROWSER_PROVIDER_KEY);
    savePreference(BROWSER_ADDRESS_KEY);
    owner.manualDisconnect();
  }, [connection, owner]);
  const selectedWallet = useMemo(() => session ? walletDescriptor(session, owner) : undefined, [session, owner]);
  const switchChain = useCallback((nextChain: FxChainId) => owner.switchChain(nextChain), [owner]);
  const sendTransaction = useCallback(async (transaction: FxWalletTransaction) => {
    const selected = owner.getProjection();
    if (!selected) throw new Error(owner.getDisplayProjection() ? 'Your wallet is updating. Please try again.' : 'Connect a browser wallet before signing a transaction.');
    const attempt = connectAttemptRef.current;
    if (transaction.from && transaction.from.toLowerCase() !== selected.address.toLowerCase()) throw new Error('Transaction sender does not match the selected wallet.');
    if (selected.chainId !== transaction.chainId) await owner.switchChain(transaction.chainId);
    const current = owner.getProjection();
    if (attempt !== connectAttemptRef.current || !current || current.rawProvider !== selected.rawProvider
      || current.address.toLowerCase() !== selected.address.toLowerCase()) throw new Error('The selected wallet changed before signing.');
    const request: Record<string, string> = { from: selected.address, to: transaction.to, chainId: `0x${transaction.chainId.toString(16)}` };
    if (transaction.data !== undefined) request.data = transaction.data;
    for (const [key, value] of [['value', transaction.value], ['nonce', transaction.nonce], ['gas', transaction.gasLimit], ['gasPrice', transaction.gasPrice], ['maxFeePerGas', transaction.maxFeePerGas], ['maxPriorityFeePerGas', transaction.maxPriorityFeePerGas] ] as const) {
      const normalized = asHexQuantity(value);
      if (normalized !== undefined) request[key] = normalized;
    }
    const hash = await owner.sendTransaction(transaction.chainId, request);
    return { hash: hash as `0x${string}` };
  }, [owner]);
  const wallet: FxPrivyWallet = useMemo(() => ({
    ready,
    authenticated: Boolean(session),
    connectionVersion,
    wallets: selectedWallet ? [selectedWallet] : [],
    selectedWallet,
    chainId: session?.chainId,
    address: session?.address,
    isEmbedded: false,
    promptOpen: connectionState.status !== 'closed',
    connect,
    disconnect,
    selectWallet: () => undefined,
    switchChain,
    sendTransaction,
  }), [session, connectionState, connect, connectionVersion, disconnect, ready, selectedWallet, sendTransaction, switchChain]);
  const chooseWallet = useCallback((choice: WalletChoice) => {
    chosenWalletRef.current = choice;
    const environment = resolveWalletEnvironment({
      userAgent: navigator.userAgent, platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      userAgentData: (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData,
    });
    let accepted = false;
    const resolve = () => resolveWalletConnectionRoute(choice, {
      providers: providerSnapshot(),
      // An explicitly chosen legacy object remains pinned after promotion;
      // a different global must neither replace it nor become its signer.
      legacyProvider: accepted && choice.source === 'legacy' ? choice.provider : legacyBrowserProvider(),
      legacyProviders: accepted && choice.source === 'legacy' && choice.provider ? [choice.provider] : legacyBrowserProviders().map(item => item.provider),
      environment, pathname: window.location.pathname,
      location: { href: window.location.href, origin: window.location.origin },
    });
    const route = resolve();
    if (route.kind === 'browser' || route.kind === 'install' || route.kind === 'download') {
      connection.handoff(choice, route.message, () => {
        if (route.kind === 'download' && route.canReopen === false) return;
        if (route.kind !== 'install') window.location.assign(route.href);
        else {
          const link = document.createElement('a');
          link.href = route.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
          link.click();
        }
      }, { fallbackHref: route.fallbackHref, guideHref: route.guideHref, dappHref: route.dappHref, canReopen: route.canReopen ?? false });
      return;
    }
    connection.select(choice, async (signal) => {
      if (route.kind !== 'injected') throw new Error(route.message);
      const attempt = connectAttemptRef.current;
      const candidate = owner.prepare({ provider: route.provider, id: choice.id, name: choice.name }, {
        signal,
        ownsAttempt: () => !signal.aborted && attempt === connectAttemptRef.current,
        exactProvider: () => {
          // After explicit approval, ownership is pinned to that exact object.
          // Later discovery cannot replace it. A future chooser attempt still
          // resolves afresh and rejects ambiguous identities before prompting.
          if (accepted) return route.provider;
          const fresh = resolve();
          return fresh.kind === 'injected' ? fresh.provider : undefined;
        },
      });
      await candidate.ready;
      return { candidate, choice, acceptIdentity: () => { accepted = true; } };
    });
  }, [connection, owner]);
  const cancelConnection = useCallback(() => {
    if (owner.cancelDisconnectedSession()) savePreference(BROWSER_DISCONNECTED_KEY, '1');
    connection.cancel();
  }, [connection, owner]);
  const backConnection = useCallback(() => {
    if (owner.cancelDisconnectedSession()) savePreference(BROWSER_DISCONNECTED_KEY, '1');
    connection.back();
  }, [connection, owner]);
  const choices = buildWalletChoices(providerSnapshot(), legacyBrowserProviders());
  const pendingState = connectionState.status === 'pending' || connectionState.status === 'error' || connectionState.status === 'handoff' ? connectionState : null;
  // A legacy object may announce EIP-6963 while approval is pending. Its
  // canonical row replaces the neutral row, but retry still selects only that
  // same object; a replacement provider cannot inherit the previous choice.
  const promotedChoice = pendingState && chosenWalletRef.current?.source === 'legacy' && chosenWalletRef.current.provider
    ? choices.find(choice => choice.provider === chosenWalletRef.current?.provider) : undefined;
  const pending = pendingState && promotedChoice ? { ...pendingState, walletId: promotedChoice.id, name: promotedChoice.name } : pendingState;
  return createElement(
    FxWalletContext.Provider,
    { value: wallet },
    createElement(ReactFragment, null, children, connectionState.status !== 'closed'
      ? createElement(ExternalWalletDialog, { choices, pending, onChoose: chooseWallet, onBack: backConnection, onCancel: cancelConnection })
      : null),
  );
}

function ReactFragment({ children }: { children: ReactNode }) { return children; }

/** Backwards-compatible name for builds that intentionally omit Privy. */
export function UnavailableWalletProvider({ children }: { children: ReactNode }) {
  return createElement(BrowserWalletProvider, null, children);
}
