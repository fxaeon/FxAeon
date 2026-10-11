'use client';

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { userSafeError } from '@/lib/errors';
import { haptic } from '@/lib/telegram';
import { isWalletConnectCancellation, usePrivyWallet } from '@/lib/wallet';
import { WALLET_ADDRESS_SETTLE_MS, connectWatchdog } from '@/lib/wallet/connectWatch';
import styles from './ConnectWalletButton.module.css';

type ConnectWalletButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick' | 'type'> & {
  children: ReactNode;
  loadingLabel?: ReactNode;
  onConnectStart?: () => void;
  onConnected?: () => void | Promise<void>;
  onConnectError?: () => void;
  /** Complete a queued action when the wallet authenticated during hydration. */
  resumeIfConnected?: boolean;
};

type ConnectNotice =
  /** The connection failed; the message is already safe to show. */
  | { kind: 'error'; message: string }
  /** The wallet provider never became ready for a queued click. */
  | { kind: 'unavailable' }
  /** A request ran out of time while no wallet prompt was on screen. */
  | { kind: 'stalled' };

type PendingAddress = {
  requestId: number;
  baselineAddress?: string;
  baselineVersion: number;
  resolve: (published: boolean) => void;
  reject: (cause: Error) => void;
};

function noticeText(notice: ConnectNotice): string {
  if (notice.kind === 'error') return notice.message;
  if (notice.kind === 'unavailable') return 'Wallet provider is unavailable.';
  return 'No response from your wallet yet. Try again when you’re ready.';
}

/** Opens the configured wallet selector over the current route. */
export default function ConnectWalletButton({ children, loadingLabel = 'Opening wallet…', className = '', disabled, onConnectStart, onConnected, onConnectError, resumeIfConnected = false, ...props }: ConnectWalletButtonProps) {
  const wallet = usePrivyWallet();
  const { connect: connectWallet, ready, authenticated, address, connectionVersion, promptOpen = false } = wallet;
  const [connecting, setConnecting] = useState(false);
  const [queued, setQueued] = useState(false);
  const [notice, setNotice] = useState<ConnectNotice | null>(null);
  const connectingRef = useRef(false);
  const queuedRef = useRef(false);
  const walletAddressRef = useRef(address);
  const connectionVersionRef = useRef(connectionVersion);
  const connectionRequestRef = useRef(0);
  const mountedRef = useRef(false);
  const onConnectErrorRef = useRef(onConnectError);
  onConnectErrorRef.current = onConnectError;
  const pendingAddressRef = useRef<PendingAddress | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    walletAddressRef.current = address;
    const pending = pendingAddressRef.current;
    if (pending && address && pending.requestId === connectionRequestRef.current && (!pending.baselineAddress || address.toLowerCase() !== pending.baselineAddress.toLowerCase())) {
      pendingAddressRef.current = null;
      pending.resolve(true);
    }
    // A connected wallet makes any earlier notice moot.
    if (address) setNotice(null);
  }, [address]);

  useEffect(() => {
    connectionVersionRef.current = connectionVersion;
    const pending = pendingAddressRef.current;
    if (pending && walletAddressRef.current && connectionVersion > pending.baselineVersion && pending.requestId === connectionRequestRef.current) {
      pendingAddressRef.current = null;
      pending.resolve(true);
    }
  }, [connectionVersion]);

  useEffect(() => {
    // A provider that became ready is no longer unavailable; the next click works.
    if (ready) setNotice((current) => (current?.kind === 'unavailable' ? null : current));
  }, [ready]);

  useEffect(() => () => {
    connectionRequestRef.current += 1;
    pendingAddressRef.current?.reject(new Error('Wallet connection was cancelled.'));
    pendingAddressRef.current = null;
    connectingRef.current = false;
    queuedRef.current = false;
  }, []);

  /** Resolves true once the connection is observable, or false if it never publishes an address. */
  const waitForWalletAddress = useCallback((requestId: number, baselineAddress: string | undefined, baselineVersion: number) => {
    if (requestId !== connectionRequestRef.current) return Promise.reject(new Error('Wallet connection was cancelled.'));
    if (connectionVersionRef.current > baselineVersion || (walletAddressRef.current && (!baselineAddress || walletAddressRef.current.toLowerCase() !== baselineAddress.toLowerCase()))) return Promise.resolve(true);
    return new Promise<boolean>((resolve, reject) => {
      // A sign-in can finish without publishing a wallet, for example an
      // account that still needs one. Stop waiting rather than hold forever.
      const timer = window.setTimeout(() => {
        if (pendingAddressRef.current?.requestId === requestId) pendingAddressRef.current = null;
        resolve(false);
      }, WALLET_ADDRESS_SETTLE_MS);
      pendingAddressRef.current = {
        requestId,
        baselineAddress,
        baselineVersion,
        resolve: (published) => { window.clearTimeout(timer); resolve(published); },
        reject: (cause) => { window.clearTimeout(timer); reject(cause); },
      };
    });
  }, []);

  const connectNow = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    const requestId = ++connectionRequestRef.current;
    const baselineAddress = walletAddressRef.current;
    const baselineVersion = connectionVersionRef.current;
    const isCurrent = () => mountedRef.current && requestId === connectionRequestRef.current;
    queuedRef.current = false;
    setQueued(false);
    setConnecting(true);
    setNotice(null);
    try {
      // A Telegram/Privy launch can finish between the click and provider
      // readiness. Treat that as the requested connection completing; opening
      // the selector again would be a surprising second prompt and strands
      // action rails that are waiting to resume.
      if (resumeIfConnected && authenticated && address) {
        if (!isCurrent()) return;
        await onConnected?.();
        if (!isCurrent()) return;
        haptic('success');
        return;
      }
      // Telegram WebViews do not expose an injected browser wallet reliably.
      // The adapter owns the seamless Privy launch-data flow and fails with a
      // Telegram-specific message when it is not available. Keep the CTA
      // route-stable; normal browsers retain explicit EIP-1193 discovery.
      await connectWallet();
      // Privy can resolve its selector before React publishes the selected
      // wallet. Do not advance an action rail or caller callback until an
      // address is observable in the shared wallet state; a sign-in that
      // publishes none ends quietly, and the surrounding UI offers the next step.
      if (onConnected && !(await waitForWalletAddress(requestId, baselineAddress, baselineVersion))) {
        if (isCurrent()) onConnectError?.();
        return;
      }
      if (!isCurrent()) return;
      await onConnected?.();
      if (!isCurrent()) return;
      haptic('success');
    } catch (cause) {
      if (!isCurrent()) return;
      onConnectError?.();
      // Closing the wallet prompt is a choice, not a failure: the button
      // returns to its label without a toast.
      if (isWalletConnectCancellation(cause)) return;
      setNotice({ kind: 'error', message: userSafeError(cause, 'Wallet connection was cancelled.') });
      haptic('error');
    } finally {
      if (pendingAddressRef.current?.requestId === requestId) pendingAddressRef.current = null;
      if (mountedRef.current && requestId === connectionRequestRef.current) {
        connectingRef.current = false;
        setConnecting(false);
      }
    }
  }, [address, authenticated, connectWallet, onConnectError, onConnected, resumeIfConnected, waitForWalletAddress]);

  // Provider hydration is intentionally asynchronous (Privy and browser
  // EIP-6963 discovery both settle after the shell can render). A click made
  // during that window is a user intent, not an error: replay it once the
  // adapter is ready so the user never has to click twice.
  useEffect(() => {
    if (!queued || connectingRef.current || (!ready && !(resumeIfConnected && authenticated && address))) return;
    void connectNow();
  }, [address, authenticated, connectNow, queued, ready, resumeIfConnected]);

  // Every wait is bounded. A queued click gives the provider a fixed time to
  // become ready, and a running request has a longer limit. Both pause while
  // a wallet prompt is visible: an open prompt belongs to the person.
  const watchdog = connectWatchdog({ queued, connecting, ready, promptOpen });
  const watchdogKind = watchdog.kind;
  const watchdogMs = watchdog.kind === 'none' ? 0 : watchdog.ms;
  useEffect(() => {
    if (watchdogKind === 'none') return;
    const requestId = connectionRequestRef.current;
    const timer = window.setTimeout(() => {
      if (!mountedRef.current) return;
      if (watchdogKind === 'provider-ready') {
        if (!queuedRef.current || connectingRef.current) return;
        queuedRef.current = false;
        setQueued(false);
        onConnectErrorRef.current?.();
        setNotice({ kind: 'unavailable' });
        haptic('warning');
        return;
      }
      if (requestId !== connectionRequestRef.current || !connectingRef.current) return;
      // Retire the request so a late result cannot resume the caller.
      connectionRequestRef.current += 1;
      const pendingAddress = pendingAddressRef.current;
      pendingAddressRef.current = null;
      pendingAddress?.reject(new Error('Wallet connection timed out.'));
      connectingRef.current = false;
      setConnecting(false);
      onConnectErrorRef.current?.();
      setNotice({ kind: 'stalled' });
    }, watchdogMs);
    return () => window.clearTimeout(timer);
  }, [watchdogKind, watchdogMs]);

  const connect = () => {
    if (connectingRef.current || queuedRef.current || queued) return;
    setNotice(null);
    queuedRef.current = true;
    setQueued(true);
    onConnectStart?.();
    if (ready) void connectNow();
  };

  const opening = queued || connecting;
  // A disabled action is a deliberate product constraint, not a provider
  // hydration state. Respect it at every readiness stage so an invalid form
  // cannot queue a connection that later auto-submits a different action.
  // Keep a busy opener focusable: disabling it before the modal mounts makes
  // the browser drop focus, so the dialog cannot remember or restore it.
  // The synchronous connect guard still blocks duplicate requests; explicit
  // product constraints retain native disabled behavior.
  const isDisabled = Boolean(disabled);

  // An authenticated Privy account may have only unaccepted external
  // candidates. Offer a deliberate route to the existing choices instead of
  // reopening the SDK or silently navigating away from a draft/action.
  if (wallet.selectionRequired && !opening && !isDisabled) {
    return <Link href="/settings" className={className} id={props.id} title={props.title}
      aria-label="Choose wallet" data-wallet-connect-trigger>Choose wallet</Link>;
  }

  return (
    <>
      <button
        {...props}
        type="button"
        data-wallet-connect-trigger
        className={className}
        disabled={isDisabled}
        aria-disabled={opening || isDisabled || undefined}
        aria-busy={opening || undefined}
        onClick={(event) => {
          // Some touch browsers do not focus a button on pointer activation.
          // Record the real opener through focus before opening the dialog.
          if (!connectingRef.current && !queuedRef.current) event.currentTarget.focus({ preventScroll: true });
          void connect();
        }}
      >
        {opening && <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />}
        {opening ? loadingLabel : children}
      </button>
      {notice && (
        <span
          role={notice.kind === 'stalled' ? 'status' : 'alert'}
          className={`wallet-connect-toast ${styles.notice}`}
          data-tone={notice.kind === 'stalled' ? 'calm' : undefined}
        >
          <span>{noticeText(notice)}</span>
          {notice.kind === 'unavailable' && (
            <button type="button" className={styles.noticeAction} aria-label="Retry wallet provider" onClick={() => window.location.reload()}>
              Retry
            </button>
          )}
        </span>
      )}
    </>
  );
}
