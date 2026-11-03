'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { startRegistration, startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import { keccak256, type Client, type Hex } from 'viem';
import { getPublicClient } from '@/lib/fx/clients';
import { JOURNAL_UPDATED_EVENT, readPendingHashJournal } from '@/lib/fx/journal';
import { FxWalletContext } from '@/lib/wallet/context';
import type { FxChainId, FxPrivyWallet, FxSelectedWallet, FxWalletTransaction } from '@/lib/wallet/types';
import { getWebApp, waitForTelegramWebApp } from '@/lib/telegram';
import { requestTelegramWriteAccess, TelegramWriteAccessError } from '@/lib/telegramWriteAccess';
import { currentTelegramLaunchData, webAppUrl } from '@/lib/telegramAdmission';
import {
  miniappAccess, miniappTransaction, pollHandoff, validatedHandoffUrl, isWalletResult, isSignResult, HANDOFF_TIMEOUT_MS,
  MiniappAccessError, accessErrorMessage, verifySigningChallenge, challengeCommitment, type MiniappAccessStatus, type MiniappWallet, type MiniappTransaction, type SignResult, type EmailDelivery,
  readPendingOperation, savePendingOperation, clearPendingOperation, type PendingOperationHint, type TransactionOperation,
} from '@/lib/miniappAccess';
import WalletRouteProviders from '@/components/WalletRouteProviders';
import FxLogo from '@/components/FxLogo';
import { AdmissionScreen, type AdmissionAction, type AdmissionScreenState } from './AdmissionScreen';
import { WalletApprovalDetails } from './WalletApprovalDetails';
import styles from '@/app/wallet-approval/WalletApproval.module.css';
import admissionStyles from './AdmissionScreen.module.css';

const READ_METHODS = new Set(['eth_blockNumber', 'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getLogs']);

/** Compatibility descriptor only. Signing is exclusively FxPrivyWallet.sendTransaction. */
export function passkeyWalletDescriptor(wallet: MiniappWallet, chainId: FxChainId, assertCurrent: () => void, switchChain: (chainId: FxChainId) => Promise<void>): FxSelectedWallet {
  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      assertCurrent();
      if (method === 'eth_accounts') return [wallet.address];
      if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
      if (!READ_METHODS.has(method)) throw new Error('This provider supports read queries only. Use the reviewed transaction flow.');
      const result = await (getPublicClient(chainId) as unknown as Client).request({ method, params } as never);
      assertCurrent();
      return result;
    },
    on: () => undefined,
    removeListener: () => undefined,
  };
  return {
    address: wallet.address, type: 'ethereum', walletClientType: 'telegram-passkey', chainId: `eip155:${chainId}`,
    getEthereumProvider: async () => { assertCurrent(); return provider; }, switchChain,
  } as unknown as FxSelectedWallet;
}

type Operation = { generation: number; controller: AbortController; launchData: string };
type PreparedHandoff = { open: () => boolean };
type PendingSign = {
  transaction: MiniappTransaction; generation: number; walletId: string; chainId: FxChainId; launchData: string;
  resolve: (result: SignResult) => void; reject: (error: Error) => void;
  submitted: boolean; handedOff: boolean;
  challengeId?: string;
};
type Recovery = { operation: TransactionOperation | null; hint: PendingOperationHint | null; wallet: MiniappWallet };
const cancelled = () => Object.assign(new Error('Wallet approval was cancelled.'), { name: 'AbortError', code: 4001 });

function durablyReceived(request: PendingSign, hash: string): boolean {
  try {
    const matches = (record: { hash?: string; walletAddress?: string; chainId?: number; to?: string; dataHash?: string; valueWei?: string; nonce?: number }) =>
      record.hash?.toLowerCase() === hash.toLowerCase() && record.walletAddress?.toLowerCase() === request.transaction.from.toLowerCase()
      && record.chainId === request.chainId && record.to?.toLowerCase() === request.transaction.to.toLowerCase()
      && record.dataHash === keccak256(request.transaction.data as Hex) && record.valueWei === BigInt(request.transaction.value).toString()
      && (request.transaction.nonce === undefined || BigInt(record.nonce ?? -1) === BigInt(request.transaction.nonce));
    const record = readPendingHashJournal().find(matches);
    if (!record) return false;
    // The journal deliberately falls back to memory on storage failure. That
    // is not durable delivery: require its actual persisted event as well.
    const stored = JSON.parse(localStorage.getItem(`fxaeon:pending-event:v6:${encodeURIComponent(record.id)}:${record.status}`) ?? 'null');
    return stored !== null && matches(stored);
  } catch { return false; }
}

export default function TelegramPasskeyProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [view, setView] = useState<AdmissionScreenState>('checking');
  const [status, setStatus] = useState<MiniappAccessStatus>();
  const [session, setSession] = useState<MiniappWallet>();
  const [chainId, setChainId] = useState<FxChainId>(1);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [emailDelivery, setEmailDelivery] = useState<EmailDelivery>();
  const [opened, setOpened] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [pending, setPending] = useState<PendingSign>();
  const [browserPending, setBrowserPending] = useState(false);
  const [preparedHandoff, setPreparedHandoff] = useState<PreparedHandoff>();
  const [preparingSetup, setPreparingSetup] = useState(false);
  const warmAttempt = useRef<number | null>(null);
  const preparedHandoffRef = useRef<PreparedHandoff | undefined>(undefined);
  const [mobile, setMobile] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const recoveryRef = useRef<Recovery | null>(null);
  const confirmationWaiters = useRef<Array<() => void>>([]);
  const liveDelivery = useRef<{ request: PendingSign; hash: string } | null>(null);
  const sessionRef = useRef(session);
  const sessionLaunch = useRef('');
  const chainRef = useRef(chainId);
  const statusRef = useRef(status);
  const statusLaunch = useRef('');
  const generation = useRef(0);
  const active = useRef<Operation | null>(null);
  const signing = useRef<PendingSign | null>(null);
  const uncertainSign = useRef(false);
  const mounted = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const assertOperation = useCallback((operation: Operation) => {
    if (!mounted.current || operation.generation !== generation.current || operation.controller.signal.aborted
      || operation.launchData !== currentTelegramLaunchData()) throw cancelled();
  }, []);
  const begin = useCallback((background = false): Operation => {
    if (active.current) throw new Error('An approval is already in progress.');
    const operation = { generation: generation.current, controller: new AbortController(), launchData: currentTelegramLaunchData() };
    active.current = operation;
    if (!background) setBusy(true);
    setError('');
    return operation;
  }, []);
  const finish = useCallback((operation: Operation) => {
    if (active.current !== operation) return;
    active.current = null;
    if (mounted.current) { setBusy(false); setBrowserPending(false); }
  }, []);
  const invalidate = useCallback(() => {
    generation.current += 1;
    active.current?.controller.abort(); active.current = null;
    WebAuthnAbortService.cancelCeremony();
    liveDelivery.current = null;
    const request = signing.current;
    if (request) {
      uncertainSign.current ||= request.submitted || request.handedOff;
      request.reject(uncertainSign.current ? new MiniappAccessError('unavailable', true) : cancelled());
      signing.current = null;
      if (!request.submitted && !request.handedOff && request.challengeId) clearPendingOperation(request.walletId, request.launchData, request.challengeId);
      if ((request.submitted || request.handedOff) && sessionRef.current && mounted.current) {
        const next: Recovery = { wallet: sessionRef.current, operation: null, hint: readPendingOperation(request.walletId, request.launchData) };
        recoveryRef.current = next; setRecovery(next);
      }
    }
    confirmationWaiters.current.splice(0).forEach(resolve => resolve());
    if (mounted.current) { setPending(undefined); setBusy(false); setPreparingSetup(false); setBrowserPending(false); setConnectionVersion(value => value + 1); }
  }, []);
  const acceptWallet = useCallback((wallet: MiniappWallet) => {
    sessionLaunch.current = currentTelegramLaunchData();
    sessionRef.current = wallet; setSession(wallet); setDisconnected(false);
    setConnectionVersion(value => value + 1);
  }, []);
  const applyStatus = useCallback((next: MiniappAccessStatus, openExisting = false) => {
    statusLaunch.current = currentTelegramLaunchData();
    setEmailDelivery(next.emailDelivery);
    statusRef.current = next; setStatus(next);
    if (next.state === 'ready' && next.wallet) {
      acceptWallet(next.wallet); setView('ready'); if (openExisting) setOpened(true);
    } else {
      sessionRef.current = undefined; setSession(undefined); setOpened(false);
      setView(next.state === 'new' ? next.cohortFull ? 'full' : 'intro'
        : next.state === 'waiting' ? next.emailVerified ? 'verified' : next.telegramNotify ? 'waiting' : 'alerts-off'
          : 'invited');
    }
  }, [acceptWallet]);
  const recoverOperation = useCallback(async (wallet: MiniappWallet, operation: Operation) => {
    let hint = readPendingOperation(wallet.id, operation.launchData);
    const options = { signal: operation.controller.signal, launchData: operation.launchData };
    let result = await miniappAccess('transaction/status', hint ? { id: hint.challengeId } : {}, options);
    assertOperation(operation);
    if (hint && result.operation && result.operation.id !== hint.challengeId) throw new MiniappAccessError('transaction_unresolved', true);
    // A prepared hint cannot have dispatched: dispatching/handoff is persisted
    // before submission/browser opening. Only that phase may clear on an exact
    // empty lookup; uncertain phases still require an exact terminal record.
    if (hint && ((!result.operation && hint.phase === 'prepared')
      || (result.operation?.acknowledged
        && (result.operation.state === 'rejected' || result.operation.state === 'submitted')))) {
      clearPendingOperation(wallet.id, operation.launchData, hint.challengeId);
      hint = null;
      result = await miniappAccess('transaction/status', {}, options);
      assertOperation(operation);
    }
    if (result.operation) {
      if (result.operation.state === 'rejected' || result.operation.acknowledged) throw new MiniappAccessError('transaction_unresolved', true);
      hint = { challengeId: result.operation.id, phase: result.operation.state === 'submitted' ? 'submitted' : 'dispatching' };
      savePendingOperation(wallet.id, operation.launchData, hint);
    }
    const next = result.operation || hint ? { operation: result.operation, hint, wallet } : null;
    recoveryRef.current = next; setRecovery(next); uncertainSign.current = Boolean(next);
  }, [assertOperation]);
  const refresh = useCallback(async (openExisting = true) => {
    const operation = begin();
    try {
      const next = await miniappAccess('status', {}, { signal: operation.controller.signal, launchData: operation.launchData });
      assertOperation(operation);
      if (next.state === 'ready' && next.wallet) await recoverOperation(next.wallet, operation);
      assertOperation(operation); applyStatus(next, openExisting);
    } catch (cause) {
      if (mounted.current && generation.current === operation.generation) { setError(accessErrorMessage(cause)); setView('join-error'); }
      throw cause;
    } finally { finish(operation); }
  }, [applyStatus, assertOperation, begin, finish, recoverOperation]);

  // Platform readiness belongs to this mount, not to an approval generation.
  // Back/Cancel may invalidate an operation while the bridge is still loading.
  useEffect(() => {
    let disposed = false;
    void waitForTelegramWebApp().then(() => {
      if (disposed) return;
      setMobile(['android', 'android_x', 'ios', 'web', 'weba', 'webk'].includes(getWebApp()?.platform ?? ''));
      setBridgeReady(true);
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    mounted.current = true;
    const version = generation.current;
    const hasLaunch = Boolean(currentTelegramLaunchData());
    const bridge = waitForTelegramWebApp();
    // The server can verify launch data before the UI bridge has loaded.
    void (hasLaunch ? Promise.resolve() : bridge).then(() => {
      if (!mounted.current || generation.current !== version) return;
      void refresh().catch(() => undefined);
    });
    return () => { mounted.current = false; invalidate(); };
  }, [invalidate, refresh]);

  useEffect(() => {
    if ((pending || recovery) && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [pending, recovery, opened]);

  const disconnect = useCallback(async () => {
    invalidate(); sessionRef.current = undefined; setSession(undefined);
    setDisconnected(true); setOpened(false); setError(''); setConnectionVersion(value => value + 1);
  }, [invalidate]);
  const switchChain = useCallback(async (next: FxChainId) => {
    if (next !== 1 && next !== 8453) throw new Error('Unsupported network.');
    if (chainRef.current === next) return;
    invalidate(); chainRef.current = next; setChainId(next);
  }, [invalidate]);
  const sendTransaction = useCallback((transaction: FxWalletTransaction): Promise<SignResult> => {
    const wallet = sessionRef.current;
    if (!wallet) return Promise.reject(new Error('Connect your Telegram wallet before continuing.'));
    if (sessionLaunch.current !== currentTelegramLaunchData()) return Promise.reject(new Error('The Telegram account changed. Reopen FxAeon.'));
    if (active.current || signing.current) return Promise.reject(new Error('An approval is already in progress.'));
    if (uncertainSign.current || recoveryRef.current || readPendingOperation(wallet.id, currentTelegramLaunchData())) return Promise.reject(new MiniappAccessError('transaction_unresolved', true));
    if (transaction.chainId !== chainRef.current) return Promise.reject(new Error('The network changed. Review the transaction again.'));
    let snapshot: MiniappTransaction;
    try { snapshot = miniappTransaction(transaction, wallet.address); } catch (cause) { return Promise.reject(cause); }
    return new Promise((resolve, reject) => {
      const request: PendingSign = { transaction: snapshot, generation: generation.current, walletId: wallet.id,
        chainId: chainRef.current, launchData: currentTelegramLaunchData(), resolve, reject, submitted: false, handedOff: false };
      signing.current = request; setPending(request); setError('');
    });
  }, []);
  const assertSigning = (request: PendingSign, operation: Operation) => {
    assertOperation(operation);
    if (request !== signing.current || request.generation !== generation.current || request.walletId !== sessionRef.current?.id
      || request.transaction.from.toLowerCase() !== sessionRef.current?.address.toLowerCase()
      || request.chainId !== chainRef.current || request.launchData !== currentTelegramLaunchData()) throw cancelled();
  };

  const openHandoff = async (challengeId: string, challenge: string, operation: Operation, deadline: number, request?: PendingSign, warmSetup = false) => {
    const commitment = await challengeCommitment(challenge, request?.transaction);
    assertOperation(operation); if (request) assertSigning(request, operation);
    const result = await miniappAccess('handoff/create', { challengeId }, { signal: operation.controller.signal, launchData: operation.launchData });
    assertOperation(operation); if (request) assertSigning(request, operation);
    if (Date.now() >= deadline) throw new MiniappAccessError('handoff_expired');
    const destination = new URL(validatedHandoffUrl(result.url, window.location.origin));
    destination.hash = new URLSearchParams({ token: new URLSearchParams(destination.hash.slice(1)).get('token')!, commitment }).toString();
    // Telegram only accepts open_link within one second of a user gesture.
    // Network preparation must finish before a fresh explicit click opens it.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (cause?: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        operation.controller.signal.removeEventListener('abort', onAbort);
        if (preparedHandoffRef.current === prepared) {
          preparedHandoffRef.current = undefined;
          if (mounted.current) setPreparedHandoff(undefined);
        }
        if (cause) reject(cause); else resolve();
      };
      const onAbort = () => settle(cancelled());
      const prepared: PreparedHandoff = { open: () => {
        if (settled || preparedHandoffRef.current !== prepared) return false;
        try {
          assertOperation(operation); if (request) assertSigning(request, operation);
          if (Date.now() >= deadline) throw new MiniappAccessError('handoff_expired');
          const webApp = getWebApp();
          if (!webApp?.openLink) throw new Error('Telegram bridge unavailable.');
          if (request) {
            verifySigningChallenge(challenge, request.transaction, request.walletId);
            // Persist uncertainty before the browser can submit anything.
            savePendingOperation(request.walletId, request.launchData, { challengeId, phase: 'handoff' });
            request.handedOff = true;
          }
          // No await between the fresh click and the native event.
          webApp.openLink(destination.href, { try_instant_view: false });
          setBrowserPending(true);
          settle();
          return true;
        } catch (cause) { settle(cause); return false; }
      } };
      const timer = window.setTimeout(() => settle(new MiniappAccessError('handoff_expired')), Math.max(0, deadline - Date.now()));
      operation.controller.signal.addEventListener('abort', onAbort, { once: true });
      preparedHandoffRef.current = prepared;
      setPreparedHandoff(prepared);
      if (warmSetup) setPreparingSetup(false);
    });
    assertOperation(operation); if (request) assertSigning(request, operation);
    const completed = await pollHandoff(challengeId, { signal: operation.controller.signal, launchData: operation.launchData,
      assertCurrent: () => { assertOperation(operation); if (request) assertSigning(request, operation); } });
    assertOperation(operation); if (request) assertSigning(request, operation);
    return completed;
  };

  const browserForPasskey = (requested: boolean): boolean | null => {
    // The bounded bridge wait may time out. Never infer desktop from absence,
    // and re-read on each click so a bridge arriving later can recover.
    const platform = getWebApp()?.platform;
    const isMobile = platform === 'ios' || platform === 'android' || platform === 'android_x';
    const useHandoff = isMobile || ['web', 'weba', 'webk'].includes(platform ?? '');
    setMobile(useHandoff);
    if (!useHandoff && !['tdesktop', 'macos', 'unigram'].includes(platform ?? '')) {
      setError('Telegram isn’t ready. Try again, or reopen this Mini App in Telegram.');
      return null;
    }
    return requested || useHandoff;
  };

  const approveTransaction = async (browser: boolean) => {
    const request = signing.current;
    if (!bridgeReady || !request || active.current) return;
    const useBrowser = browserForPasskey(browser);
    if (useBrowser === null) return;
    const operation = begin();
    try {
      assertSigning(request, operation);
      const deadline = Date.now() + HANDOFF_TIMEOUT_MS;
      const challenge = await miniappAccess('sign/options', { transaction: request.transaction }, { signal: operation.controller.signal, launchData: operation.launchData });
      assertSigning(request, operation);
      verifySigningChallenge(challenge.options.challenge, request.transaction, request.walletId);
      request.challengeId = challenge.challengeId;
      savePendingOperation(request.walletId, request.launchData, { challengeId: challenge.challengeId, phase: 'prepared' });
      let result: SignResult;
      if (useBrowser) {
        const completed = await openHandoff(challenge.challengeId, challenge.options.challenge, operation, deadline, request);
        if (!isSignResult(completed)) throw new MiniappAccessError('unavailable', true);
        result = completed;
      } else {
        const response = await startAuthentication({ optionsJSON: challenge.options });
        assertSigning(request, operation);
        verifySigningChallenge(challenge.options.challenge, request.transaction, request.walletId);
        savePendingOperation(request.walletId, request.launchData, { challengeId: challenge.challengeId, phase: 'dispatching' });
        request.submitted = true;
        result = await miniappAccess('sign/complete', { challengeId: challenge.challengeId, response }, { signal: operation.controller.signal, launchData: operation.launchData });
      }
      assertSigning(request, operation);
      const hint: PendingOperationHint = { challengeId: challenge.challengeId, phase: 'submitted' };
      savePendingOperation(request.walletId, request.launchData, hint);
      const next: Recovery = { wallet: sessionRef.current!, hint,
        operation: { id: challenge.challengeId, state: 'submitted', hash: result.hash, chainId: request.chainId, acknowledged: false } };
      recoveryRef.current = next; setRecovery(next); uncertainSign.current = true;
      liveDelivery.current = { request, hash: result.hash };
      request.resolve(result); signing.current = null; setPending(undefined);
    } catch (cause) {
      if (signing.current === request) {
        uncertainSign.current ||= request.submitted || request.handedOff;
        request.reject(uncertainSign.current ? new MiniappAccessError('unavailable', true) : cause instanceof Error ? cause : new Error('Approval failed.'));
        signing.current = null; setPending(undefined);
        if (!request.submitted && !request.handedOff && request.challengeId) clearPendingOperation(request.walletId, request.launchData, request.challengeId);
        if (uncertainSign.current && request.challengeId && sessionRef.current) {
          const next: Recovery = { wallet: sessionRef.current, hint: readPendingOperation(request.walletId, request.launchData), operation: null };
          recoveryRef.current = next; setRecovery(next);
        }
      }
    } finally { finish(operation); }
  };

  const setupWallet = async (browser: boolean, warm = false) => {
    if (!bridgeReady || active.current) return;
    const useBrowser = browserForPasskey(browser);
    if (useBrowser === null) return;
    const operation = begin(warm);
    if (warm) setPreparingSetup(true);
    try {
      // Re-read before every attempt: registration may have bound a credential
      // even if its completion response was lost. Never register over that key.
      const current = await miniappAccess('status', {}, { signal: operation.controller.signal, launchData: operation.launchData });
      assertOperation(operation); statusLaunch.current = operation.launchData; statusRef.current = current; setStatus(current);
      if (current.state === 'ready' && current.wallet) { await recoverOperation(current.wallet, operation); assertOperation(operation); applyStatus(current, true); if (pathname === '/login' || pathname === '/login/') router.replace('/'); return; }
      if (current.state !== 'approved') { applyStatus(current); return; }
      if (warm && current.hasCredential) return;
      let wallet: MiniappWallet;
      if (current.hasCredential) {
        const result = await miniappAccess('wallet/retry', {}, { signal: operation.controller.signal, launchData: operation.launchData });
        assertOperation(operation); wallet = result.wallet;
      } else {
        const deadline = Date.now() + HANDOFF_TIMEOUT_MS;
        const challenge = await miniappAccess('register/options', {}, { signal: operation.controller.signal, launchData: operation.launchData });
        assertOperation(operation);
        if (useBrowser) {
          const result = await openHandoff(challenge.challengeId, challenge.options.challenge, operation, deadline, undefined, warm);
          if (!isWalletResult(result)) throw new MiniappAccessError('unavailable', true);
          wallet = result.wallet;
        } else {
          const response = await startRegistration({ optionsJSON: challenge.options });
          assertOperation(operation);
          // Once sent, any retry checks the bound credential on the server first.
          const result = await miniappAccess('register/complete', { challengeId: challenge.challengeId, response }, { signal: operation.controller.signal, launchData: operation.launchData });
          assertOperation(operation); wallet = result.wallet;
        }
      }
      assertOperation(operation);
      await recoverOperation(wallet, operation); assertOperation(operation);
      applyStatus({ ...current, state: 'ready', hasCredential: true, wallet }, true);
      if (pathname === '/login' || pathname === '/login/') router.replace('/');
    } catch (cause) {
      if (mounted.current && operation.generation === generation.current) { if (!warm) setView('setup-error'); setError(accessErrorMessage(cause)); }
    } finally { if (mounted.current && operation.generation === generation.current) setPreparingSetup(false); finish(operation); }
  };

  const setupWalletRef = useRef(setupWallet);
  setupWalletRef.current = setupWallet;
  useEffect(() => {
    if (view !== 'invited' || !bridgeReady || !mobile || status?.state !== 'approved' || status.hasCredential
      || active.current || warmAttempt.current === generation.current) return;
    warmAttempt.current = generation.current;
    void setupWalletRef.current(true, true);
  }, [view, bridgeReady, mobile, status?.state, status?.hasCredential, busy]);

  const acknowledgeTransaction = useCallback(async () => {
    const recovered = recoveryRef.current;
    if (active.current || !recovered?.operation || recovered.operation.state !== 'submitted' || !recovered.operation.hash) return;
    liveDelivery.current = null;
    const operation = begin();
    try {
      if (sessionRef.current?.id !== recovered.wallet.id || sessionLaunch.current !== operation.launchData) throw cancelled();
      savePendingOperation(recovered.wallet.id, operation.launchData, { challengeId: recovered.operation.id, phase: 'acknowledging' });
      await miniappAccess('transaction/ack', { id: recovered.operation.id, hash: recovered.operation.hash },
        { signal: operation.controller.signal, launchData: operation.launchData });
      assertOperation(operation);
      clearPendingOperation(recovered.wallet.id, operation.launchData, recovered.operation.id);
      recoveryRef.current = null; setRecovery(null); uncertainSign.current = false;
      confirmationWaiters.current.splice(0).forEach(resolve => resolve());
    } catch (cause) { if (operation.generation === generation.current) setError(accessErrorMessage(cause)); }
    finally { finish(operation); }
  }, [assertOperation, begin, finish]);

  useEffect(() => {
    const received = () => {
      const delivery = liveDelivery.current;
      if (!delivery || active.current || delivery.request.generation !== generation.current
        || delivery.request.launchData !== currentTelegramLaunchData() || delivery.request.walletId !== sessionRef.current?.id) return;
      if (durablyReceived(delivery.request, delivery.hash)) void acknowledgeTransaction();
    };
    window.addEventListener(JOURNAL_UPDATED_EVENT, received);
    received();
    return () => window.removeEventListener(JOURNAL_UPDATED_EVENT, received);
  }, [acknowledgeTransaction, busy, recovery]);

  const act = async (action: AdmissionAction) => {
    if (action === 'defer-setup') { invalidate(); warmAttempt.current = generation.current; getWebApp()?.close(); return; }
    if (action === 'setup-wallet' && preparedHandoffRef.current) {
      if (preparedHandoffRef.current.open()) { setBusy(true); setView('passkey'); }
      return;
    }
    if (active.current) return;
    if (action === 'setup-wallet' || action === 'retry-setup') {
      const useBrowser = browserForPasskey(false);
      if (useBrowser === null) return;
      if (useBrowser && !statusRef.current?.hasCredential) { setView('invited'); warmAttempt.current = generation.current; void setupWallet(true, true); }
      else void setupWallet(false);
      return;
    }
    if (action === 'add-email') { setView('email'); setError(''); return; }
    if (action === 'back-to-waitlist') { await refresh(false).catch(() => undefined); return; }
    if (action === 'open-app') {
      if (sessionRef.current) { setOpened(true); if (pathname === '/login' || pathname === '/login/') router.replace('/'); }
      return;
    }
    if (action === 'done') { getWebApp()?.close(); return; }
    if (action === 'open-web') { getWebApp()?.openLink?.(webAppUrl(window.location.pathname), { try_instant_view: false }); return; }
    if (action === 'retry-join') { await refresh().catch(() => undefined); return; }
    const operation = begin();
    try {
      const options = { signal: operation.controller.signal, launchData: operation.launchData };
      if (action === 'submit-email') {
        const result = await miniappAccess('email/request', { email: email.trim() }, options);
        assertOperation(operation); setEmailDelivery(result.delivery); setView(result.delivery?.state === 'verified' ? 'verified' : 'verify');
      } else if (action === 'retry-email') {
        const result = await miniappAccess('email/retry', {}, options);
        assertOperation(operation); setEmailDelivery(result.delivery); setView(result.delivery?.state === 'verified' ? 'verified' : 'verify');
      } else if (action === 'check-email-status') {
        const next = await miniappAccess('status', {}, options);
        assertOperation(operation); applyStatus(next);
        if (next.state === 'waiting' && !next.emailVerified) setView('verify');
      } else if (action === 'join') {
        const next = await miniappAccess('join', { notify: statusRef.current?.telegramNotify === true }, options);
        assertOperation(operation); applyStatus(next);
      } else if (action === 'allow-notifications') {
        // Only the authenticated API may supply an existing permission grant.
        // The explicit click still persists this user's notification preference.
        const allowed = (statusLaunch.current === operation.launchData && statusRef.current?.telegramWriteAllowed === true)
          || await requestTelegramWriteAccess(getWebApp(), { signal: operation.controller.signal });
        assertOperation(operation);
        const next = await miniappAccess('notify', { allowed }, options);
        assertOperation(operation); applyStatus(next);
      }
    } catch (cause) {
      if (mounted.current && operation.generation === generation.current) {
        setError(cause instanceof TelegramWriteAccessError ? cause.message : accessErrorMessage(cause));
        if (action === 'join') setView('join-error');
      }
    } finally { finish(operation); }
  };

  const selectedWallet = useMemo(() => {
    if (!session) return undefined;
    const version = generation.current;
    const launchData = sessionLaunch.current;
    return passkeyWalletDescriptor(session, chainId, () => {
      if (!mounted.current || generation.current !== version || sessionRef.current !== session || chainRef.current !== chainId
        || launchData !== currentTelegramLaunchData()) throw cancelled();
    }, switchChain);
    // Cancellation invalidates prior descriptors even when the address is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, chainId, switchChain, connectionVersion]);
  const wallet = useMemo<FxPrivyWallet>(() => ({
    ready: true, authenticated: Boolean(session), connectionVersion, wallets: selectedWallet ? [selectedWallet] : [], selectedWallet,
    address: session?.address, chainId: session ? chainId : undefined, isEmbedded: true, promptOpen: Boolean(pending),
    connect: async () => { await refresh(); if (!sessionRef.current) throw new Error('Your Telegram wallet is not ready.'); },
    disconnect, switchChain, sendTransaction,
    waitForPreviousConfirmationClose: () => recoveryRef.current ? new Promise<void>(resolve => { confirmationWaiters.current.push(resolve); }) : Promise.resolve(),
    selectWallet: address => { if (address.toLowerCase() !== sessionRef.current?.address.toLowerCase()) throw new Error('This Telegram account has one wallet.'); },
  }), [session, selectedWallet, chainId, connectionVersion, pending, refresh, disconnect, switchChain, sendTransaction]);

  if (session && opened && pathname !== '/login' && pathname !== '/login/') return <FxWalletContext.Provider value={wallet}>
    <WalletRouteProviders>{children}</WalletRouteProviders>
    {recovery ? <dialog ref={dialog} className={styles.dialog} aria-labelledby="passkey-recovery-title" onCancel={event => event.preventDefault()}>
      <FxLogo size={32} /><h1 id="passkey-recovery-title">{recovery.operation?.state === 'submitted' ? 'Transaction submitted.' : 'Check your transaction.'}</h1>
      {recovery.operation?.hash ? <><p>Review this transaction before continuing.</p><p className={styles.hash}>{recovery.operation.hash}</p>
        <button className={styles.primary} disabled={busy} onClick={() => void acknowledgeTransaction()}>I’ve reviewed this transaction</button></>
        : <><p>We can’t confirm the result yet.</p><button className={styles.primary} disabled={busy} onClick={() => void refresh().catch(() => undefined)}>Check status</button></>}
      {error && <p role="alert">{error}</p>}
      <button className={styles.secondary} disabled={busy} onClick={() => void disconnect()}>Disconnect wallet</button>
    </dialog> : pending && <dialog ref={dialog} className={styles.dialog} aria-labelledby="passkey-approval-title" onCancel={event => { event.preventDefault(); invalidate(); }}>
      <FxLogo size={32} /><h1 id="passkey-approval-title">Approve transaction.</h1>
      <WalletApprovalDetails transaction={pending.transaction} walletId={pending.walletId} />
      {error && <p role="alert">{error}</p>}
      {browserPending && <p role="status">Complete approval in your browser. Waiting up to five minutes.</p>}
      {!bridgeReady && <p role="status">Checking Telegram…</p>}
      {preparedHandoff ? <><p role="status">Ready to open your browser.</p><button className={styles.primary} onClick={preparedHandoff.open}>Continue in browser</button></> : <>
        <button className={styles.primary} disabled={busy || !bridgeReady} onClick={() => void approveTransaction(mobile)}>{mobile ? 'Continue in browser' : 'Approve with passkey'}</button>
        {!mobile && <button className={styles.secondary} disabled={busy || !bridgeReady} onClick={() => void approveTransaction(true)}>Continue in browser</button>}
      </>}
      <button className={styles.secondary} onClick={invalidate}>{browserPending ? 'Stop waiting' : 'Cancel'}</button>
    </dialog>}
  </FxWalletContext.Provider>;
  if (disconnected) return <main className={styles.screen}><div className={styles.panel}><FxLogo size={32} /><h1>Wallet disconnected.</h1>
    {error && <p role="alert">{error}</p>}<button className={styles.primary} disabled={busy} onClick={() => void refresh().catch(() => undefined)}>Reconnect Telegram wallet</button></div></main>;
  if (view === 'passkey') return <main className={admissionStyles.screen} aria-labelledby="passkey-setup-title"><div className={admissionStyles.panel}>
    <header className={admissionStyles.header}><FxLogo size={32} /></header>
    <div className={admissionStyles.content}><div className={admissionStyles.copy}><div className={admissionStyles.message}>
    <h1 id="passkey-setup-title" className={admissionStyles.title}>Secure your wallet.</h1>
    <p className={admissionStyles.lead}>{status?.hasCredential ? 'Your passkey is registered. Finish setting up your wallet.' : 'Create a passkey with your fingerprint, face, or device PIN.'}</p>
    </div></div><div className={admissionStyles.actions} aria-busy={busy}>
    {!status?.hasCredential && <p className={admissionStyles.detail}>Keep your passkey synced or backed up so you can use it again.</p>}
    {error && <p role="alert">{error}</p>}{browserPending && <p role="status">Complete setup in your browser. Waiting up to five minutes.</p>}
    {!bridgeReady && <p role="status">Checking Telegram…</p>}
    {preparedHandoff ? <><p role="status">Ready to open your browser.</p><button className={admissionStyles.primary} onClick={preparedHandoff.open}>Continue in browser</button></> : <>
      <button className={admissionStyles.primary} disabled={busy || !bridgeReady} onClick={() => void setupWallet(mobile)}>{status?.hasCredential ? 'Finish wallet setup' : mobile ? 'Continue in browser' : 'Create passkey'}</button>
      {!mobile && !status?.hasCredential && <button className={admissionStyles.secondary} disabled={busy || !bridgeReady} onClick={() => void setupWallet(true)}>Continue in browser</button>}
    </>}
    <button className={admissionStyles.secondary} onClick={() => { invalidate(); warmAttempt.current = generation.current; setView('invited'); }}>{browserPending ? 'Stop waiting' : 'Back'}</button>
  </div></div></div></main>;
  const common = { notificationPermission: status?.telegramNotify ? 'granted' as const : status ? 'denied' as const : 'unknown' as const,
    emailDelivery: emailDelivery?.state, busy, error, onAction: (action: AdmissionAction) => { void act(action); },
    ...(view === 'invited' ? {
      primaryDisabled: !bridgeReady || preparingSetup, primaryLabel: error && mobile && !preparingSetup ? 'Try again' : undefined,
      statusMessage: !bridgeReady ? 'Checking Telegram…' : preparingSetup ? 'Preparing secure setup…' : undefined,
      setupHint: mobile && !status?.hasCredential ? 'Keep your passkey synced or backed up so you can use it again.' : undefined,
    } : {}) };
  return view === 'email' ? <AdmissionScreen {...common} state="email" email={email} onEmailChange={setEmail} />
    : <AdmissionScreen {...common} state={view} />;
}
