'use client';

import { createElement, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import {
  useConnectWallet,
  useLogin,
  useModalStatus,
  useLogout,
  usePrivy,
  useSendTransaction,
  useWallets,
  type ConnectedWallet,
  type SendTransactionModalUIOptions,
} from '@privy-io/react-auth';
import { getInitData, isTelegramLaunchContext } from '@/lib/telegram';
import { useTelegramReconnect } from '@/lib/wallet/telegramReconnect';
import { PRIVY_PROMPT_OPEN_GRACE_MS, WalletConnectCancelledError, stepPrivyPrompt, watchPrivyPrompt, type PrivyPromptStep, type PrivyPromptWatch } from './connectWatch';
import { FxWalletContext } from './context';
import { asChainNumber, asHexQuantity } from './helpers';
import { FX_CHAIN_IDS, type FxChainId, type FxPrivyWallet, type FxSelectedWallet, type FxWalletTransaction, type FxWalletTransactionOptions } from './types';

const PRIVY_SUCCESS_MODAL_CLOSE_TIMEOUT_MS = 60_000;
const PRIVY_SUCCESS_MODAL_POLL_INTERVAL_MS = 100;

function isEmbedded(wallet: ConnectedWallet | undefined): boolean {
  return wallet?.walletClientType === 'privy' || wallet?.walletClientType === 'privy-v2';
}

type PendingConnection = {
  kind: 'login' | 'wallet';
  resolve: () => void;
  reject: (cause: Error) => void;
  /** What has been observed about Privy's prompt for this request. */
  watch: PrivyPromptWatch;
  /** Ends the request if Privy never shows a prompt for it. */
  openTimer?: ReturnType<typeof setTimeout>;
};

function cancellation(kind: PendingConnection['kind']): WalletConnectCancelledError {
  return new WalletConnectCancelledError(kind === 'login' ? 'Sign-in cancelled.' : 'Wallet connection was cancelled.');
}

/** Settle the current request from one observed step. A superseded request stays untouched. */
function settleConnection(pendingRef: MutableRefObject<PendingConnection | null>, pending: PendingConnection, step: PrivyPromptStep): void {
  if (pendingRef.current !== pending) return;
  if (step.outcome === 'pending') {
    pending.watch = step.watch;
    return;
  }
  pendingRef.current = null;
  if (pending.openTimer !== undefined) clearTimeout(pending.openTimer);
  switch (step.outcome) {
    case 'resolved':
      pending.resolve();
      return;
    case 'cancelled':
      pending.reject(cancellation(pending.kind));
      return;
    case 'unavailable':
      pending.reject(new Error('The wallet window did not open. Try again.'));
      return;
    case 'failed':
      pending.reject(new Error(
        pending.kind === 'login' ? 'Sign-in failed. Please try again.' : 'Wallet connection failed. Please try again.',
        { cause: step.code },
      ));
      return;
  }
}

/** End the current request without an outcome from Privy (superseded, signed out, unmounted). */
function retireConnection(pendingRef: MutableRefObject<PendingConnection | null>, cause: Error): void {
  const pending = pendingRef.current;
  if (!pending) return;
  pendingRef.current = null;
  if (pending.openTimer !== undefined) clearTimeout(pending.openTimer);
  pending.reject(cause);
}

/**
 * Thin adapter over Privy's user-owned wallet APIs.
 *
 * - Embedded wallets use `useSendTransaction`, which opens Privy's visible
 *   confirmation modal for every transaction.
 * - Connected external wallets receive the same request through their EIP-1193
 *   provider, which delegates confirmation to that wallet's own UI.
 * - No FxAeon backend or private-key material is involved.
 */
function usePrivyWalletAdapter(): FxPrivyWallet {
  const { ready, authenticated, user } = usePrivy();
  const { isOpen: privyModalOpen } = useModalStatus();
  const reconnectTelegram = useTelegramReconnect();
  const { logout } = useLogout();
  const [selectedAddress, setSelectedAddress] = useState<string>();
  const [connectionVersion, setConnectionVersion] = useState(0);
  const mountedRef = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // Privy ignores login() while it holds any non-guest user, so such a
  // session is treated as signed in when choosing the connection path.
  const privySessionRef = useRef(false);
  privySessionRef.current = Boolean(user && !user.isGuest);
  const privyModalOpenRef = useRef(privyModalOpen);
  const walletSessionKeyRef = useRef('');
  const previousEmbeddedPromptRef = useRef<{ walletSessionKey: string } | null>(null);
  const connectPendingRef = useRef<PendingConnection | null>(null);
  const { login } = useLogin({
    onComplete: ({ user, loginAccount }) => {
      const pending = connectPendingRef.current;
      if (!pending || pending.kind !== 'login') return;
      if (!mountedRef.current) {
        retireConnection(connectPendingRef, cancellation('login'));
        return;
      }
      // Privy's user.wallet is the first linked wallet, which need not be
      // the external wallet the user selected for this login.
      const loginAddress = loginAccount?.type === 'wallet' && loginAccount.chainType === 'ethereum'
        ? loginAccount.address : user.wallet?.address;
      if (loginAddress) setSelectedAddress(loginAddress);
      settleConnection(connectPendingRef, pending, { outcome: 'resolved' });
    },
    onError: (cause) => {
      const pending = connectPendingRef.current;
      if (!pending || pending.kind !== 'login') return;
      settleConnection(connectPendingRef, pending, stepPrivyPrompt(pending.watch, { type: 'error', code: cause, modalOpen: privyModalOpenRef.current }));
    },
  });
  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet }) => {
      const pending = connectPendingRef.current;
      // Privy may deliver a late callback after a cancelled/unmounted modal.
      // Without an active waiter it must not resurrect the selected wallet.
      if (!pending || pending.kind !== 'wallet') return;
      if (!mountedRef.current) {
        retireConnection(connectPendingRef, cancellation('wallet'));
        return;
      }
      setSelectedAddress(wallet.address);
      setConnectionVersion((version) => version + 1);
      settleConnection(connectPendingRef, pending, { outcome: 'resolved' });
    },
    onError: (cause) => {
      const pending = connectPendingRef.current;
      if (!pending || pending.kind !== 'wallet') return;
      settleConnection(connectPendingRef, pending, stepPrivyPrompt(pending.watch, { type: 'error', code: cause, modalOpen: privyModalOpenRef.current }));
    },
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      retireConnection(connectPendingRef, new WalletConnectCancelledError());
    };
  }, []);
  // Privy reports nothing when its connect-only modal is dismissed with the
  // backdrop or Escape, and a login error may arrive while its modal still
  // offers a retry. The modal closing without a success callback is
  // therefore the person ending the request.
  useEffect(() => {
    const pending = connectPendingRef.current;
    if (pending) settleConnection(connectPendingRef, pending, stepPrivyPrompt(pending.watch, { type: 'modal', open: privyModalOpen }));
  }, [privyModalOpen]);
  const { wallets } = useWallets();
  const { sendTransaction: sendEmbeddedTransaction } = useSendTransaction();
  // A Telegram launch can finish Privy's seamless authentication shortly
  // after the provider has rendered. Keep the current value in a ref so a
  // click made during that hand-off can await the same session rather than
  // running its action callback against an unauthenticated wallet.
  const authenticatedRef = useRef(authenticated);

  useEffect(() => {
    authenticatedRef.current = authenticated;
  }, [authenticated]);

  const selectedWallet = useMemo(() => {
    const selected = selectedAddress
      ? wallets.find((wallet) => wallet.address.toLowerCase() === selectedAddress.toLowerCase())
      : undefined;
    if (selected) return selected as FxSelectedWallet;

    // Prefer the embedded wallet for protocol interactions because Privy can
    // guarantee its explicit confirmation modal. The user may select an
    // external wallet when one is connected.
    return (
      wallets.find((wallet) => isEmbedded(wallet)) ?? wallets.find((wallet) => wallet.type === 'ethereum')
    ) as FxSelectedWallet | undefined;
  }, [selectedAddress, wallets]);
  const selectedWalletRef = useRef<FxSelectedWallet | undefined>(selectedWallet);
  useEffect(() => {
    selectedWalletRef.current = selectedWallet;
  }, [selectedWallet]);

  const selectedChainId = useMemo(() => {
    const chainId = asChainNumber(selectedWallet?.chainId);
    return chainId === FX_CHAIN_IDS.ethereum || chainId === FX_CHAIN_IDS.base
      ? chainId
      : undefined;
  }, [selectedWallet]);

  // Privy's send promise resolves on broadcast, while its confirmation UI may
  // remain on the submitted screen. Record only the session identity here;
  // the next embedded send consults useModalStatus before opening another UI.
  const walletSessionKey = JSON.stringify([
    user?.id ?? '',
    selectedWallet?.address.toLowerCase() ?? '',
    selectedChainId ?? null,
    connectionVersion,
    authenticated,
    ready,
  ]);
  privyModalOpenRef.current = privyModalOpen;
  walletSessionKeyRef.current = walletSessionKey;

  const awaitPreviousEmbeddedPromptClose = useCallback(async (sessionKey: string) => {
    const previous = previousEmbeddedPromptRef.current;
    if (!previous) return;
    if (previous.walletSessionKey !== sessionKey) {
      previousEmbeddedPromptRef.current = null;
      throw new Error('Wallet or session changed after the previous transaction. Reopen the action to continue.');
    }
    if (!privyModalOpenRef.current) {
      previousEmbeddedPromptRef.current = null;
      return;
    }

    const deadline = Date.now() + PRIVY_SUCCESS_MODAL_CLOSE_TIMEOUT_MS;
    while (true) {
      if (!mountedRef.current) {
        previousEmbeddedPromptRef.current = null;
        throw new Error('Wallet session ended while waiting for the transaction screen to close. Reopen the action to continue.');
      }
      if (walletSessionKeyRef.current !== sessionKey) {
        previousEmbeddedPromptRef.current = null;
        throw new Error('Wallet or session changed while waiting for the transaction screen to close. Reopen the action to continue.');
      }
      if (!privyModalOpenRef.current) {
        previousEmbeddedPromptRef.current = null;
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error('Close the Privy transaction screen, then retry to continue.');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, PRIVY_SUCCESS_MODAL_POLL_INTERVAL_MS));
    }
  }, []);

  useEffect(() => {
    if (!selectedAddress || !wallets.some((wallet) => wallet.address.toLowerCase() === selectedAddress.toLowerCase())) {
      const next = selectedWallet?.address;
      if (next && next !== selectedAddress) setSelectedAddress(next);
    }
  }, [selectedAddress, selectedWallet, wallets]);

  const selectWallet = useCallback((address: string) => {
    const wallet = wallets.find((candidate) => candidate.address.toLowerCase() === address.toLowerCase());
    if (wallet) setSelectedAddress(wallet.address);
  }, [wallets]);

  // Register the request before Privy opens its prompt, so its callbacks, the
  // modal status, and the open grace period can each settle it.
  const beginConnection = useCallback((kind: PendingConnection['kind'], resolve: () => void, reject: (cause: Error) => void) => {
    retireConnection(connectPendingRef, new WalletConnectCancelledError('Wallet connection was superseded.'));
    const pending: PendingConnection = { kind, resolve, reject, watch: watchPrivyPrompt(privyModalOpenRef.current) };
    connectPendingRef.current = pending;
    // Before readiness, login() waits for Privy to initialize, so only a
    // ready SDK is held to showing its prompt promptly.
    if (readyRef.current) {
      pending.openTimer = setTimeout(() => {
        settleConnection(connectPendingRef, pending, stepPrivyPrompt(pending.watch, { type: 'open-timeout' }));
      }, PRIVY_PROMPT_OPEN_GRACE_MS);
    }
    return pending;
  }, []);

  const connectExternalWallet = useCallback(() => new Promise<void>((resolve, reject) => {
    const pending = beginConnection('wallet', resolve, reject);
    try {
      // The hook currently returns void, but resolving this through a promise
      // also handles SDK versions that return an async modal operation.
      void Promise.resolve(connectWallet()).catch((cause) => {
        if (connectPendingRef.current !== pending) return;
        retireConnection(connectPendingRef, cause instanceof Error ? cause : new Error('Wallet connection failed. Please try again.'));
      });
    } catch (cause) {
      retireConnection(connectPendingRef, cause instanceof Error ? cause : new Error('Wallet connection failed. Please try again.'));
    }
  }), [beginConnection, connectWallet]);

  const connectWithPrivyLogin = useCallback(() => new Promise<void>((resolve, reject) => {
    const pending = beginConnection('login', resolve, reject);
    try {
      // Keep the dashboard as the authority for enabled account methods. The
      // current app enables wallet and email; Telegram becomes available here
      // automatically when its Privy dashboard setting is enabled.
      void Promise.resolve(login()).catch((cause) => {
        if (connectPendingRef.current !== pending) return;
        retireConnection(connectPendingRef, cause instanceof Error ? cause : new Error('Sign-in failed. Please try again.'));
      });
    } catch (cause) {
      retireConnection(connectPendingRef, cause instanceof Error ? cause : new Error('Sign-in failed. Please try again.'));
    }
  }), [beginConnection, login]);

  const connect = useCallback(async ({ external = false }: { external?: boolean } = {}) => {
    if (external) {
      await connectExternalWallet();
      return;
    }
    if (isTelegramLaunchContext()) {
      if (authenticatedRef.current && isEmbedded(selectedWalletRef.current)) return;
      if (authenticatedRef.current) {
        await connectExternalWallet();
        return;
      }
      // Generic login opens Telegram's legacy web widget and can copy the
      // signed launch hash into its return URL. Reinitialize seamless auth
      // instead; signed data is consumed by Privy at the provider boundary.
      if (!getInitData()) throw new Error('Reopen FxAeon from Telegram to sign in again.');
      reconnectTelegram();
      return;
    }
    // login() is a silent no-op while Privy holds a session, so a session
    // goes straight to the wallet selector instead.
    if (authenticated || privySessionRef.current) {
      await connectExternalWallet();
      return;
    }
    await connectWithPrivyLogin();
  }, [authenticated, connectExternalWallet, connectWithPrivyLogin, reconnectTelegram]);

  const disconnect = useCallback(async () => {
    retireConnection(connectPendingRef, new WalletConnectCancelledError());
    await logout();
    authenticatedRef.current = false;
    setSelectedAddress(undefined);
  }, [logout]);

  const switchChain = useCallback(async (chainId: FxChainId) => {
    if (!selectedWallet) throw new Error('Connect a wallet before switching networks.');
    await selectedWallet.switchChain(chainId);
  }, [selectedWallet]);

  const waitForPreviousConfirmationClose = useCallback(async () => {
    if (!isEmbedded(selectedWallet)) return;
    await awaitPreviousEmbeddedPromptClose(walletSessionKey);
  }, [selectedWallet, awaitPreviousEmbeddedPromptClose, walletSessionKey]);

  const sendTransaction = useCallback(async (
    transaction: FxWalletTransaction,
    options?: FxWalletTransactionOptions
  ) => {
    if (transaction.chainId !== FX_CHAIN_IDS.ethereum && transaction.chainId !== FX_CHAIN_IDS.base) {
      throw new Error('FxAeon only signs transactions on Ethereum or Base.');
    }
    if (!authenticated || !selectedWallet || !selectedWallet.address) {
      throw new Error('Connect a wallet before signing a transaction.');
    }
    const sessionKey = walletSessionKey;
    if (isEmbedded(selectedWallet) && previousEmbeddedPromptRef.current) {
      const previous = previousEmbeddedPromptRef.current;
      if (previous.walletSessionKey !== sessionKey) {
        previousEmbeddedPromptRef.current = null;
        throw new Error('Wallet or session changed after the previous transaction. Reopen the action to continue.');
      }
      if (privyModalOpenRef.current) {
        throw new Error('Close the Privy transaction screen and retry so the action can be checked again.');
      }
      previousEmbeddedPromptRef.current = null;
    }
    if (!mountedRef.current || walletSessionKeyRef.current !== sessionKey) {
      throw new Error('Wallet or session changed before the next transaction. Reopen the action to continue.');
    }
    if (transaction.from && transaction.from.toLowerCase() !== selectedWallet.address.toLowerCase()) {
      throw new Error('Transaction sender does not match the selected wallet.');
    }

    const currentChain = asChainNumber(selectedWallet.chainId);
    // An absent/unknown wallet chain is not equivalent to the requested
    // chain. Ask the wallet to switch in that case, then independently verify
    // the provider below before sending an external-wallet transaction.
    if (currentChain !== transaction.chainId) {
      await selectedWallet.switchChain(transaction.chainId);
    }

    const request = {
      from: selectedWallet.address,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
      nonce: transaction.nonce,
      gasLimit: transaction.gasLimit,
      gasPrice: transaction.gasPrice,
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
      chainId: transaction.chainId,
    };

    const uiOptions: SendTransactionModalUIOptions = {
      showWalletUIs: true,
      description: options?.description ?? 'Review this f(x) transaction in your wallet.',
      buttonText: options?.buttonText ?? 'Approve transaction',
      successHeader: options?.successHeader ?? 'Transaction submitted',
      successDescription: options?.successDescription ?? 'Your transaction is now being confirmed on-chain.',
      isCancellable: true,
      transactionInfo: options?.action ? { action: options.action } : undefined,
    };

    // Independently verify the provider immediately before either signing
    // path. Privy's hook remains the embedded-wallet prompt authority, but
    // selected React state alone must never establish chain/account identity.
    const provider = await selectedWallet.getEthereumProvider();
    const providerChain = await provider.request({ method: 'eth_chainId' });
    if (asChainNumber(typeof providerChain === 'string' ? providerChain : String(providerChain)) !== transaction.chainId) {
      throw new Error('The connected wallet is on the wrong network. Switch chains and try again.');
    }
    const providerAccounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(providerAccounts) || !providerAccounts.some(
      (account): account is string => typeof account === 'string'
        && account.toLowerCase() === selectedWallet.address.toLowerCase(),
    )) {
      throw new Error('The connected wallet account does not match the selected signing wallet.');
    }

    if (isEmbedded(selectedWallet)) {
      const result = await sendEmbeddedTransaction(request, {
        address: selectedWallet.address,
        uiOptions,
      });
      // Return the broadcast hash immediately so the transaction runner can
      // journal and receipt-track it. Only a later send may wait for this
      // success screen to close.
      previousEmbeddedPromptRef.current = { walletSessionKey: sessionKey };
      return result;
    }

    const providerRequest: Record<string, string> = {
      from: selectedWallet.address,
      to: transaction.to,
    };
    const data = transaction.data;
    if (data !== undefined) providerRequest.data = data;
    const value = asHexQuantity(transaction.value);
    if (value !== undefined) providerRequest.value = value;
    const nonce = asHexQuantity(transaction.nonce);
    if (nonce !== undefined) providerRequest.nonce = nonce;
    const gas = asHexQuantity(transaction.gasLimit);
    if (gas !== undefined) providerRequest.gas = gas;
    // Application-selected fee tiers are part of Privy's embedded signing
    // request. External wallet providers own their fee UI and pricing, so do
    // not pin app gas caps into eth_sendTransaction.
    const result = await provider.request({
      method: 'eth_sendTransaction',
      params: [providerRequest],
    });
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
      throw new Error('The connected wallet returned an invalid transaction hash.');
    }
    return { hash: result as `0x${string}` };
  }, [authenticated, selectedWallet, sendEmbeddedTransaction, walletSessionKey]);

  return {
    // Privy's provider readiness is the gate for opening its login and wallet
    // flows. The wallet list can hydrate a little later (especially on a cold
    // custom-origin or Telegram launch); treating that secondary feed as a
    // provider outage made routes replace a usable connect CTA with
    // “Wallet provider is unavailable.” Consumers already handle an empty
    // wallet list as the disconnected state, and the list will re-render when
    // the wallet list changes.
    ready,
    authenticated,
    connectionVersion,
    wallets,
    selectedWallet,
    chainId: selectedChainId,
    address: selectedWallet?.address,
    isEmbedded: isEmbedded(selectedWallet),
    promptOpen: privyModalOpen,
    connect,
    disconnect,
    selectWallet,
    switchChain,
    sendTransaction,
    waitForPreviousConfirmationClose,
  };
}

/** Bridge Privy's hooks into a small app-owned context mounted once. */
export function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const wallet = usePrivyWalletAdapter();
  return createElement(FxWalletContext.Provider, { value: wallet }, children);
}
