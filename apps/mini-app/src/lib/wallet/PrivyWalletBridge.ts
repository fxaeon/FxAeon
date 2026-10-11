'use client';

import { createElement, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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
import { WalletConnectCancelledError } from './connectWatch';
import { privySessionIntentFor } from './privySessionIntent';
import { createPrivyConnectionIntent } from './privyConnectionIntent';
import { createPrivyDispatchAuthority } from './privyDispatchAuthority';
import { FxWalletContext } from './context';
import { asChainNumber, asHexQuantity } from './helpers';
import { FX_CHAIN_IDS, type FxChainId, type FxPrivyWallet, type FxSelectedWallet, type FxWalletTransaction, type FxWalletTransactionOptions } from './types';

const PRIVY_SUCCESS_MODAL_CLOSE_TIMEOUT_MS = 60_000;
const PRIVY_SUCCESS_MODAL_POLL_INTERVAL_MS = 100;

function isEmbedded(wallet: ConnectedWallet | undefined): boolean {
  return wallet?.walletClientType === 'privy' || wallet?.walletClientType === 'privy-v2';
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
  const { ready, authenticated: sdkAuthenticated, user } = usePrivy();
  const [sessionIntent] = useState(() => privySessionIntentFor(typeof window === 'undefined' ? {} : window));
  const locallyDisconnected = useSyncExternalStore(sessionIntent.subscribe, sessionIntent.isBlocked, () => false);
  const authenticated = sdkAuthenticated && !locallyDisconnected;
  const { isOpen: privyModalOpen } = useModalStatus();
  const reconnectTelegram = useTelegramReconnect();
  const { logout } = useLogout();
  const [connectionVersion, setConnectionVersion] = useState(0);
  const mountedRef = useRef(false);
  const [dispatchAuthority] = useState(createPrivyDispatchAuthority);
  // Privy ignores login() while it holds any non-guest user, so such a
  // session is treated as signed in when choosing the connection path.
  const privySessionRef = useRef(false);
  privySessionRef.current = Boolean(user && !user.isGuest);
  const privyModalOpenRef = useRef(privyModalOpen);
  const walletSessionKeyRef = useRef('');
  const previousEmbeddedPromptRef = useRef<{ walletSessionKey: string } | null>(null);
  const [connectionIntent] = useState(createPrivyConnectionIntent);
  // These SDK callbacks are global, not scoped to an invocation. Subscribe
  // to none: delayed success/error from A must never accept a wallet for B.
  const { login } = useLogin();
  const { connectWallet } = useConnectWallet();
  useEffect(() => {
    mountedRef.current = true;
    dispatchAuthority.setMounted(true);
    return () => {
      mountedRef.current = false;
      dispatchAuthority.setMounted(false);
      connectionIntent.retire();
    };
  }, [connectionIntent, dispatchAuthority]);
  useEffect(() => {
    connectionIntent.observeModal(privyModalOpen);
  }, [connectionIntent, privyModalOpen]);
  const { wallets, ready: walletsReady } = useWallets();
  const selectionStateRef = useRef({ ready, walletsReady, authenticated, userId: user?.id, wallets });
  selectionStateRef.current = { ready, walletsReady, authenticated, userId: user?.id, wallets };
  const { sendTransaction: sendEmbeddedTransaction } = useSendTransaction();
  // A Telegram launch can finish Privy's seamless authentication shortly
  // after the provider has rendered. Keep the current value in a ref so a
  // click made during that hand-off can await the same session rather than
  // running its action callback against an unauthenticated wallet.
  const authenticatedRef = useRef(authenticated);

  authenticatedRef.current = authenticated;

  const selectedWallet = sessionIntent.resolveWallet(selectionStateRef.current) as FxSelectedWallet | undefined;
  // Publish before a held preflight resumes, including account/user changes.
  dispatchAuthority.update({ ready: ready && walletsReady, authenticated, userId: user?.id, wallet: selectedWallet });
  const selectedWalletRef = useRef<FxSelectedWallet | undefined>(selectedWallet);
  selectedWalletRef.current = selectedWallet;

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

  const selectWallet = useCallback((address: string) => {
    const current = selectionStateRef.current;
    if (!mountedRef.current) return;
    const wallet = sessionIntent.selectWallet(current, address);
    if (!wallet) return;
    dispatchAuthority.invalidate();
    dispatchAuthority.update({ ready: current.ready, authenticated: current.authenticated, userId: current.userId, wallet });
    // A retained send callback cannot start another preflight before React
    // publishes the new connectionVersion, even for same-address selection.
    walletSessionKeyRef.current = '';
    connectionIntent.retire();
    // Reselecting the same account is still a new deliberate signing intent.
    setConnectionVersion((version) => version + 1);
  }, [connectionIntent, dispatchAuthority, sessionIntent]);

  const connectExternalWallet = useCallback(() => connectionIntent.start(
    () => connectWallet(), privyModalOpenRef.current, ready,
  ), [connectionIntent, connectWallet, ready]);
  const connectWithPrivyLogin = useCallback((emailOnly = false) => connectionIntent.start(
    () => emailOnly ? login({ loginMethods: ['email'] }) : login(), privyModalOpenRef.current, ready,
  ), [connectionIntent, login, ready]);

  const connect = useCallback(async ({ external = false, loginMethod }: { external?: boolean; loginMethod?: 'email' } = {}) => {
    if (!mountedRef.current) throw new WalletConnectCancelledError();
    const currentlyAuthenticated = !sessionIntent.isBlocked() && authenticatedRef.current;
    if (loginMethod === 'email') {
      sessionIntent.resume();
      await connectWithPrivyLogin(true);
      return;
    }
    if (external) {
      sessionIntent.resume();
      await connectExternalWallet();
      return;
    }
    if (isTelegramLaunchContext()) {
      if (currentlyAuthenticated && isEmbedded(selectedWalletRef.current)) return;
      if (currentlyAuthenticated) {
        await connectExternalWallet();
        return;
      }
      // Generic login opens Telegram's legacy web widget and can copy the
      // signed launch hash into its return URL. Reinitialize seamless auth
      // instead; signed data is consumed by Privy at the provider boundary.
      if (!getInitData()) throw new Error('Reopen FxAeon from Telegram to sign in again.');
      const wasBlocked = sessionIntent.isBlocked();
      sessionIntent.resume();
      try { reconnectTelegram(); } catch (cause) { if (wasBlocked) sessionIntent.block(); throw cause; }
      return;
    }
    // login() is a silent no-op while Privy holds a session, so a session
    // goes straight to the wallet selector instead.
    if (currentlyAuthenticated || (!sessionIntent.isBlocked() && privySessionRef.current)) {
      await connectExternalWallet();
      return;
    }
    sessionIntent.resume();
    await connectWithPrivyLogin();
  }, [connectExternalWallet, connectWithPrivyLogin, reconnectTelegram, sessionIntent]);

  const disconnect = useCallback(async () => {
    sessionIntent.block();
    dispatchAuthority.invalidate();
    dispatchAuthority.update({ ready: false, authenticated: false });
    authenticatedRef.current = false;
    selectionStateRef.current = { ...selectionStateRef.current, authenticated: false };
    connectionIntent.retire();
    await logout();
  }, [connectionIntent, dispatchAuthority, logout, sessionIntent]);

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
    // Capture only after all synchronous request preparation has succeeded.
    const ticket = dispatchAuthority.capture(selectedWallet);
    return ticket.run(transaction.chainId, async (provider, signingWallet) => {
      if (isEmbedded(signingWallet)) {
        const dispatchSessionKey = walletSessionKeyRef.current;
        const result = await sendEmbeddedTransaction(request, {
          address: signingWallet.address,
          uiOptions,
        });
        // Hashes always survive retirement. Only still-current sessions may
        // retain modal bookkeeping for a subsequent transaction.
        if (ticket.isCurrent()) {
          previousEmbeddedPromptRef.current = { walletSessionKey: dispatchSessionKey };
        }
        return result;
      }
      const result = await provider.request({
        method: 'eth_sendTransaction',
        params: [providerRequest],
      });
      if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
        throw new Error('The connected wallet returned an invalid transaction hash.');
      }
      return { hash: result as `0x${string}` };
    });
  }, [authenticated, selectedWallet, sendEmbeddedTransaction, walletSessionKey, dispatchAuthority]);

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
    selectionRequired: walletsReady && authenticated && !selectedWallet && wallets.some((wallet) => wallet.type === 'ethereum'),
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
