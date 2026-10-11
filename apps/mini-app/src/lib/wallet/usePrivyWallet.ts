'use client';

import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { assertLocalForkRpcUrl, configuredRpcUrls } from '@/lib/fx/config';
import { isTelegramLaunchContext } from '@/lib/telegram';
import { switchBrowserChain as switchBrowserChainWithConfig } from './switchBrowserChain';
import { getDiscoveredEip6963Providers, recordEip6963Announcement, selectEip6963Provider, shouldBindEip6963ProviderEvents, shouldPromptEip6963Provider, waitForWalletProvider, type DiscoveredEip6963Provider, type Eip6963Announcement } from './eip6963';
import { FxWalletContext } from './context';
import { asChainNumber, asHexQuantity } from './helpers';
import { FX_CHAIN_IDS, type FxChainId, type FxPrivyWallet, type FxSelectedWallet, type FxWalletTransaction } from './types';
import { ExternalWalletDialog } from '@/components/ExternalWalletDialog';
import { WalletConnectCancelledError } from './connectWatch';

export { usePrivyWallet } from './context';
export { FX_CHAIN_IDS, type FxChainId, type FxPrivyWallet, type FxSelectedWallet, type FxWalletTransaction, type FxWalletTransactionOptions } from './types';

const BROWSER_DISCONNECTED_KEY = 'fxaeon:browser-wallet-disconnected';

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

let eip6963Requested = false;

function discoverEip6963(onChange?: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Announcement>).detail;
    if (recordEip6963Announcement(detail)) onChange?.();
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  if (!eip6963Requested) {
    eip6963Requested = true;
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  }
  return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
}

function browserProvider(): Eip1193Provider | undefined {
  if (typeof window === 'undefined') return undefined;
  if (process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE === '1') {
    const address = process.env.NEXT_PUBLIC_FX_SCREENSHOT_WALLET_ADDRESS;
    const rpcUrl = process.env.NEXT_PUBLIC_FX_ANVIL_RPC_URL;
    if (address && rpcUrl) return screenshotProvider(address, rpcUrl);
  }
  const preferred = window.localStorage.getItem('fxaeon:wallet-provider-rdns');
  return (selectEip6963Provider(preferred)?.provider)
    ?? window.ethereum
    ?? getDiscoveredEip6963Providers()[0]?.provider;
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

function walletDescriptor(provider: Eip1193Provider, address: string, chainId?: number): FxSelectedWallet {
  const selectedChain = chainId === FX_CHAIN_IDS.ethereum || chainId === FX_CHAIN_IDS.base ? chainId : undefined;
  return {
    address,
    type: 'ethereum',
    walletClientType: 'browser',
    chainId: selectedChain ? `eip155:${selectedChain}` : undefined,
    getEthereumProvider: async () => provider,
    switchChain: async (nextChain: FxChainId) => switchBrowserChain(provider, nextChain),
  } as unknown as FxSelectedWallet;
}

async function switchBrowserChain(provider: Eip1193Provider, chainId: FxChainId): Promise<void> {
  return switchBrowserChainWithConfig(provider, chainId, () => {
    const localForkRpcUrl = process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE === '1'
      ? process.env.NEXT_PUBLIC_FX_ANVIL_RPC_URL
      : undefined;
    return localForkRpcUrl ? { localForkRpcUrl } : { configuredRpcUrls: configuredRpcUrls(chainId) };
  });
}

/** External wallets for browser mode, also used by builds without Privy. */
export function BrowserWalletProvider({ children, allowTelegramHost = false }: {
  children: ReactNode;
  /** The configured app explicitly chose browser mode despite loose host hints. */
  allowTelegramHost?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [, setProviderVersion] = useState(0);
  const [chooser, setChooser] = useState<readonly DiscoveredEip6963Provider[] | null>(null);
  const pendingChoiceRef = useRef<{ resolve: (choice: DiscoveredEip6963Provider) => void; reject: (reason: Error) => void } | null>(null);
  const [address, setAddress] = useState<string>();
  const [chainId, setChainId] = useState<FxChainId>();
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<Eip1193Provider>();
  const explicitProviderSelectionRef = useRef(false);
  const provider = selectedProvider ?? browserProvider();
  const discoveryAbortRef = useRef<AbortController | null>(null);
  const connectAttemptRef = useRef(0);
  const boundProviderRef = useRef<Eip1193Provider | undefined>(undefined);
  const currentProviderRef = useRef(provider);
  currentProviderRef.current = provider;
  const currentAddressRef = useRef(address);
  currentAddressRef.current = address;
  const chainEventVersionRef = useRef(0);
  const identityEventVersionRef = useRef(0);

  const sync = useCallback(async (requestAccounts = false, providerOverride?: Eip1193Provider, attempt = connectAttemptRef.current) => {
    const startingProvider = currentProviderRef.current;
    const identityVersion = identityEventVersionRef.current;
    const chainVersion = chainEventVersionRef.current;
    const currentAttempt = () => attempt === connectAttemptRef.current
      // A first explicit selection updates the preferred extension before its
      // account prompt resolves. Keep that captured provider, while silent
      // restores may only publish for the provider they started with.
      && (requestAccounts || currentProviderRef.current === startingProvider);
    const ensureCurrent = () => { if (!currentAttempt()) throw new WalletConnectCancelledError(); };
    if (!allowTelegramHost && isTelegramLaunchContext()) {
      // The no-Privy build is also used by the static client/E2E harness. A
      // Telegram host must never fall through to browser-wallet discovery,
      // but it also cannot authenticate without Privy's launch-data flow.
      // Keep the provider in a quiet, disconnected state so the CTA remains
      // usable and never paints a misleading browser-wallet error.
      return;
    }
    const currentProvider = providerOverride ?? currentProviderRef.current;
    if (!currentProvider) {
      throw new Error('No browser wallet detected. Install MetaMask, Coinbase Wallet, or another EVM wallet to continue.');
    }
    if (!requestAccounts && window.localStorage.getItem(BROWSER_DISCONNECTED_KEY) === '1') {
      currentAddressRef.current = undefined;
      setAddress(undefined);
      setChainId(undefined);
      return;
    }
    const accounts = await currentProvider.request({ method: requestAccounts ? 'eth_requestAccounts' : 'eth_accounts' });
    ensureCurrent();
    if (!requestAccounts && (identityEventVersionRef.current !== identityVersion || chainEventVersionRef.current !== chainVersion)) throw new WalletConnectCancelledError();
    const nextAddress = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : undefined;
    if (requestAccounts && !nextAddress) throw new WalletConnectCancelledError();
    const accountsVersion = identityEventVersionRef.current;
    const accountsChainVersion = chainEventVersionRef.current;
    const rawChain = await currentProvider.request({ method: 'eth_chainId' });
    ensureCurrent();
    if (identityEventVersionRef.current !== accountsVersion || chainEventVersionRef.current !== accountsChainVersion) throw new WalletConnectCancelledError();
    currentAddressRef.current = nextAddress;
    if (nextAddress) {
      currentProviderRef.current = currentProvider;
      setSelectedProvider(currentProvider);
      if (requestAccounts) explicitProviderSelectionRef.current = true;
    }
    setAddress(nextAddress);
    if (requestAccounts && nextAddress) setConnectionVersion((version) => version + 1);
    const parsed = asChainNumber(typeof rawChain === 'string' ? rawChain : String(rawChain));
    setChainId(parsed === FX_CHAIN_IDS.ethereum || parsed === FX_CHAIN_IDS.base ? parsed : undefined);
  }, [allowTelegramHost]);

  useEffect(() => {
    const previous = boundProviderRef.current;
    boundProviderRef.current = provider;
    // An EIP-6963 provider can be replaced while retaining the same account.
    // Bump the identity version so action rails waiting on a connection event
    // cannot mistake the old provider for the newly selected one.
    if (previous && provider && previous !== provider && address) {
      setConnectionVersion((version) => version + 1);
    }
  }, [address, provider]);

  useEffect(() => {
    const stopDiscovery = discoverEip6963(() => {
      const preferred = window.localStorage.getItem('fxaeon:wallet-provider-rdns');
      if (selectedProvider && (explicitProviderSelectionRef.current || !shouldPromptEip6963Provider(preferred))) return;
      if (shouldPromptEip6963Provider(preferred)) {
        identityEventVersionRef.current += 1;
        // A late second announcement invalidates any legacy auto-bind that may
        // have occurred during the single-provider discovery window.
        setAddress(undefined);
        setChainId(undefined);
        currentAddressRef.current = undefined;
        setSelectedProvider(undefined);
      }
      setProviderVersion((version) => version + 1);
    });
    let cancelled = false;
    // Give EIP-6963 announcements a short discovery window before restoring
    // an existing account. This prevents a legacy window.ethereum account
    // from becoming the session while the user still has multiple providers
    // to choose from.
    const autoSyncTimer = window.setTimeout(() => {
      const preferred = window.localStorage.getItem('fxaeon:wallet-provider-rdns');
      if (!shouldBindEip6963ProviderEvents(preferred)) {
        setReady(true);
        return;
      }
      void sync().catch(() => undefined).finally(() => { if (!cancelled) setReady(true); });
    }, 200);
    let listenersAttached = false;
    const onAccounts = (...args: unknown[]) => {
      if (currentProviderRef.current !== provider) return;
      identityEventVersionRef.current += 1;
      if (window.localStorage.getItem(BROWSER_DISCONNECTED_KEY) === '1') {
        currentAddressRef.current = undefined;
        setAddress(undefined);
        setChainId(undefined);
        return;
      }
      const accounts = Array.isArray(args[0]) ? args[0] : [];
      const nextAddress = typeof accounts[0] === 'string' ? accounts[0] : undefined;
      currentAddressRef.current = nextAddress;
      setAddress(nextAddress);
    };
    const onChain = (...args: unknown[]) => {
      if (currentProviderRef.current !== provider) return;
      chainEventVersionRef.current += 1;
      const parsed = asChainNumber(typeof args[0] === 'string' ? args[0] : undefined);
      setChainId(parsed === FX_CHAIN_IDS.ethereum || parsed === FX_CHAIN_IDS.base ? parsed : undefined);
    };
    const onDisconnect = () => {
      if (currentProviderRef.current !== provider) return;
      identityEventVersionRef.current += 1;
      currentAddressRef.current = undefined;
      setAddress(undefined); setChainId(undefined);
    };
    const attachListeners = () => {
      if (!provider?.on || listenersAttached) return;
      provider.on('accountsChanged', onAccounts);
      provider.on('chainChanged', onChain);
      provider.on('disconnect', onDisconnect);
      listenersAttached = true;
    };
    if (selectedProvider) attachListeners();
    const attachTimer = window.setTimeout(() => {
      const preferred = window.localStorage.getItem('fxaeon:wallet-provider-rdns');
      if (selectedProvider || shouldBindEip6963ProviderEvents(preferred)) attachListeners();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(autoSyncTimer);
      window.clearTimeout(attachTimer);
      if (listenersAttached) {
        provider?.removeListener?.('accountsChanged', onAccounts);
        provider?.removeListener?.('chainChanged', onChain);
        provider?.removeListener?.('disconnect', onDisconnect);
      }
      stopDiscovery();
    };
  }, [provider, selectedProvider, sync]);

  const connect = useCallback(async () => {
    if (!allowTelegramHost && isTelegramLaunchContext()) {
      // Telegram authentication is owned by the Privy adapter above when it
      // is configured. In the intentionally no-Privy/static build there is no
      // safe auth action to invoke; resolve quietly rather than reporting a
      // browser-wallet or Telegram-popup error in the host UI.
      return;
    }
    window.localStorage.removeItem(BROWSER_DISCONNECTED_KEY);
    const attempt = ++connectAttemptRef.current;
    const discoveryAbort = new AbortController();
    discoveryAbortRef.current?.abort();
    discoveryAbortRef.current = discoveryAbort;
    try {
      // Readiness only means the initial restore window has completed. A
      // wallet extension can still inject window.ethereum or announce via
      // EIP-6963 after that point, so hold this user initiated request until
      // there is a concrete provider to pass to sync(true).
      const availableProvider = await waitForWalletProvider(
        browserProvider,
        window,
        { signal: discoveryAbort.signal },
      ).catch((cause) => {
        if (discoveryAbort.signal.aborted) throw cause;
        return undefined;
      });
      const providers = getDiscoveredEip6963Providers();
      const preferred = window.localStorage.getItem('fxaeon:wallet-provider-rdns');
      let selected: DiscoveredEip6963Provider | undefined = preferred
        ? providers.find((candidate) => candidate.rdns === preferred)
        : undefined;
      // An explicit reconnect is also the user's opportunity to switch
      // between announced wallets. The preferred provider is used for silent
      // restore above, but should not silently win a user initiated choice.
      if (providers.length > 1 || !availableProvider) {
        selected = await new Promise<DiscoveredEip6963Provider>((resolve, reject) => {
          pendingChoiceRef.current = { resolve, reject };
          setChooser(providers);
        });
        if (attempt !== connectAttemptRef.current) throw new WalletConnectCancelledError();
        window.localStorage.setItem('fxaeon:wallet-provider-rdns', selected.rdns);
        setProviderVersion((version) => version + 1);
      }
      await sync(true, selected?.provider ?? availableProvider, attempt);
    } catch (cause) {
      if (!discoveryAbort.signal.aborted && attempt === connectAttemptRef.current && !currentAddressRef.current) window.localStorage.setItem(BROWSER_DISCONNECTED_KEY, '1');
      throw cause;
    } finally {
      if (discoveryAbortRef.current === discoveryAbort) discoveryAbortRef.current = null;
    }
  }, [allowTelegramHost, sync]);
  useEffect(() => () => {
    // Invalidate restores/connects before a provider request can resolve, so
    // no late result updates state after this provider unmounts.
    connectAttemptRef.current += 1;
    discoveryAbortRef.current?.abort();
    pendingChoiceRef.current?.reject(new WalletConnectCancelledError());
    pendingChoiceRef.current = null;
  }, []);
  const disconnect = useCallback(async () => {
    connectAttemptRef.current += 1;
    discoveryAbortRef.current?.abort();
    discoveryAbortRef.current = null;
    const pending = pendingChoiceRef.current;
    pendingChoiceRef.current = null;
    setChooser(null);
    pending?.reject(new WalletConnectCancelledError());
    window.localStorage.setItem(BROWSER_DISCONNECTED_KEY, '1');
    currentAddressRef.current = undefined;
    setAddress(undefined);
    setChainId(undefined);
    const currentProvider = currentProviderRef.current;
    explicitProviderSelectionRef.current = false;
    setSelectedProvider(undefined);
    if (!currentProvider) return;
    try {
      await currentProvider.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // EIP-1193 has no universal disconnect method. The app-level marker
      // still ends this session when a wallet does not implement revocation.
    }
  }, []);
  const selectedWallet = useMemo(
    () => address && provider ? walletDescriptor(provider, address, chainId) : undefined,
    [address, chainId, provider],
  );
  const switchChain = useCallback(async (nextChain: FxChainId) => {
    const switchProvider = provider;
    const switchWallet = selectedWallet;
    if (!switchProvider || !switchWallet) throw new Error('Connect a browser wallet before switching networks.');
    const attempt = connectAttemptRef.current;
    const switchAddress = switchWallet.address.toLowerCase();
    const isCurrent = () => attempt === connectAttemptRef.current
      && currentProviderRef.current === switchProvider
      && currentAddressRef.current?.toLowerCase() === switchAddress;
    await switchBrowserChain(switchProvider, nextChain);
    if (!isCurrent()) throw new Error('The selected wallet changed while switching networks.');
    const rawChain = await switchProvider.request({ method: 'eth_chainId' });
    if (!isCurrent()) throw new Error('The selected wallet changed while checking the switched network.');
    const parsedChain = asChainNumber(typeof rawChain === 'string' ? rawChain : String(rawChain));
    const actualChain = parsedChain === FX_CHAIN_IDS.ethereum || parsedChain === FX_CHAIN_IDS.base
      ? parsedChain : undefined;
    // Publish what the provider actually reports, including an unsupported
    // result as undefined, before rejecting a mismatch with the requested
    // network. Never write this state after account/provider teardown.
    setChainId(actualChain);
    if (actualChain !== nextChain) {
      throw new Error(`Wallet network switch reported ${parsedChain === undefined ? 'an unsupported network' : `chain ${parsedChain}`} instead of chain ${nextChain}.`);
    }
  }, [provider, selectedWallet]);
  const sendTransaction = useCallback(async (transaction: FxWalletTransaction) => {
    if (!provider || !selectedWallet?.address) throw new Error('Connect a browser wallet before signing a transaction.');
    const attempt = connectAttemptRef.current;
    const ensureCurrent = () => {
      if (attempt !== connectAttemptRef.current || currentProviderRef.current !== provider || currentAddressRef.current?.toLowerCase() !== selectedWallet.address.toLowerCase()) throw new Error('The selected wallet changed before signing.');
    };
    if (transaction.from && transaction.from.toLowerCase() !== selectedWallet.address.toLowerCase()) throw new Error('Transaction sender does not match the selected wallet.');
    if (chainId !== transaction.chainId) {
      await switchBrowserChain(provider, transaction.chainId);
      ensureCurrent();
    }
    const chainEventVersion = chainEventVersionRef.current;
    const providerChain = await provider.request({ method: 'eth_chainId' });
    ensureCurrent();
    if (chainEventVersion !== chainEventVersionRef.current) throw new Error('The wallet network changed before signing. Review the transaction and try again.');
    if (asChainNumber(typeof providerChain === 'string' ? providerChain : String(providerChain)) !== transaction.chainId) throw new Error('The connected wallet is on the wrong network. Switch chains and try again.');
    setChainId(transaction.chainId);
    const accounts = await provider.request({ method: 'eth_accounts' });
    ensureCurrent();
    if (chainEventVersion !== chainEventVersionRef.current) throw new Error('The wallet network changed before signing. Review the transaction and try again.');
    if (!Array.isArray(accounts) || !accounts.some((account): account is string => typeof account === 'string' && account.toLowerCase() === selectedWallet.address!.toLowerCase())) throw new Error('The connected wallet account does not match the selected wallet.');
    const request: Record<string, string> = { from: selectedWallet.address, to: transaction.to, chainId: `0x${transaction.chainId.toString(16)}` };
    if (transaction.data !== undefined) request.data = transaction.data;
    for (const [key, value] of [['value', transaction.value], ['nonce', transaction.nonce], ['gas', transaction.gasLimit], ['gasPrice', transaction.gasPrice], ['maxFeePerGas', transaction.maxFeePerGas], ['maxPriorityFeePerGas', transaction.maxPriorityFeePerGas] ] as const) {
      const normalized = asHexQuantity(value);
      if (normalized !== undefined) request[key] = normalized;
    }
    const result = await provider.request({ method: 'eth_sendTransaction', params: [request] });
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('The connected wallet returned an invalid transaction hash.');
    return { hash: result as `0x${string}` };
  }, [chainId, provider, selectedWallet]);
  const wallet: FxPrivyWallet = useMemo(() => ({
    ready,
    authenticated: Boolean(address),
    connectionVersion,
    wallets: selectedWallet ? [selectedWallet] : [],
    selectedWallet,
    chainId,
    address,
    isEmbedded: false,
    promptOpen: Boolean(chooser),
    connect,
    disconnect,
    selectWallet: () => undefined,
    switchChain,
    sendTransaction,
  }), [address, chainId, chooser, connect, connectionVersion, disconnect, ready, selectedWallet, sendTransaction, switchChain]);
  const chooseProvider = useCallback((choice: DiscoveredEip6963Provider) => {
    const pending = pendingChoiceRef.current;
    pendingChoiceRef.current = null;
    setChooser(null);
    pending?.resolve(choice);
  }, []);
  const cancelProviderChoice = useCallback(() => {
    const pending = pendingChoiceRef.current;
    pendingChoiceRef.current = null;
    setChooser(null);
    pending?.reject(new WalletConnectCancelledError());
  }, []);
  return createElement(
    FxWalletContext.Provider,
    { value: wallet },
    createElement(ReactFragment, null, children, chooser
      ? createElement(ExternalWalletDialog, { providers: chooser, onChoose: chooseProvider, onCancel: cancelProviderChoice })
      : null),
  );
}

function ReactFragment({ children }: { children: ReactNode }) {
  return children;
}

/** Backwards-compatible name for builds that intentionally omit Privy. */
export function UnavailableWalletProvider({ children }: { children: ReactNode }) {
  return createElement(BrowserWalletProvider, null, children);
}
