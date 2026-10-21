'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { loadPositionRefresh } from '@/lib/positionRefreshQueue';
import { PositionRefreshActivityContext } from './PositionRefreshActivity';
import {
  createPositionReadGuard,
  mergeVerifiedPositions,
  newlyVerifiedPositions,
  positionKey,
  readAllPositionsDetailed,
  readCanonicalPositionState,
  unavailablePositionResult,
  type PositionGroupFailure,
  type PositionGroup,
  type PositionReadResult,
  type UiPosition,
} from '@/app/trade/fxUi';
import { usePrivyWallet } from '@/lib/wallet';
import { deriveConfirmedPositionHint, readConfirmedPosition, verifyConfirmedPositionHint, type ConfirmedPositionHint } from '@/lib/confirmedPositions';
import { confirmedPositionHintKey, confirmedPositionStorageKey, parseStoredPositionHints, savePositionHints, type StoredPositionHint } from '@/lib/confirmedPositionStorage';
import { getEthereumClient, type PlannedRoute, type TransactionExecutionResult } from '@/lib/fx';
import { useRealtimeChainState } from '@/components/WalletDataProvider';
import { isForegroundOnline, subscribeToForegroundResume } from '@/lib/foreground';

export type ProtocolPositionStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';

export interface ProtocolPositionRefreshResult extends PositionReadResult {
  newPositions: UiPosition[];
  readStartedAt?: number;
  readCompletedAt?: number;
}

interface ProtocolPositionSnapshot {
  walletAddress: string | null;
  positions: UiPosition[];
  status: ProtocolPositionStatus;
  failedGroups: PositionGroupFailure[];
  lastVerifiedAt: number | null;
  refreshing: boolean;
  verifiedGroups: PositionGroup[];
}

export interface ProtocolPositionContextValue extends ProtocolPositionSnapshot {
  refresh: (options?: { afterConfirmation?: boolean }) => Promise<ProtocolPositionRefreshResult>;
  pendingPositions: ConfirmedPositionHint[];
  checkingConfirmedPositions: boolean;
  refreshConfirmedPositions: () => Promise<void>;
  trackConfirmedPosition: (execution: TransactionExecutionResult, route: PlannedRoute) => Promise<boolean>;
  reconcileClosedPosition: (position: Pick<UiPosition, 'market' | 'side'> & { info: Pick<UiPosition['info'], 'positionId'> }) => Promise<boolean>;
}

const EMPTY_RESULT: ProtocolPositionRefreshResult = {
  positions: [],
  successfulGroups: [],
  failedGroups: [],
  status: 'unavailable',
  newPositions: [],
};

const POSITION_READ_RETRY_DELAYS_MS = [2_000, 5_000] as const;

function emptySnapshot(walletAddress: string | null = null): ProtocolPositionSnapshot {
  return {
    walletAddress,
    positions: [],
    status: walletAddress ? 'loading' : 'idle',
    failedGroups: [],
    lastVerifiedAt: null,
    refreshing: false,
    verifiedGroups: [],
  };
}

const ProtocolPositionContext = createContext<ProtocolPositionContextValue | null>(null);

export default function ProtocolPositionProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const wallet = usePrivyWallet();
  const address = wallet.ready && wallet.authenticated ? wallet.address?.toLowerCase() ?? null : null;

  // Keep the session mounted across wallet hydration. A keyed remount here
  // also remounts product forms, which discards an explicitly entered trade
  // amount while the first wallet connection publishes its address. The
  // session masks its stale snapshot synchronously and its guarded effect
  // invalidates in-flight reads for the next wallet.
  return <ProtocolPositionSession address={address} enabled={enabled}>{children}</ProtocolPositionSession>;
}

function ProtocolPositionSession({ address, enabled, children }: { address: string | null; enabled: boolean; children: ReactNode }) {
  const [automaticRefreshPauses, setAutomaticRefreshPauses] = useState(0);
  const automaticRefreshPausesRef = useRef(0);
  const acquireRefreshPause = useCallback(() => {
    automaticRefreshPausesRef.current += 1;
    setAutomaticRefreshPauses(automaticRefreshPausesRef.current);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      automaticRefreshPausesRef.current -= 1;
      setAutomaticRefreshPauses(automaticRefreshPausesRef.current);
    };
  }, []);
  const [snapshot, setSnapshot] = useState<ProtocolPositionSnapshot>(() => emptySnapshot(enabled ? address : null));
  const snapshotRef = useRef(snapshot);
  const readGuardRef = useRef(createPositionReadGuard());
  const [pendingPositions, setPendingPositions] = useState<ConfirmedPositionHint[]>([]);
  const [checkingConfirmedPositions, setCheckingConfirmedPositions] = useState(false);
  const hintRecords = useRef<StoredPositionHint[]>([]);
  const sessionGeneration = useRef(0);
  const sessionActive = useRef(false);
  const hintRead = useRef<number | null>(null);
  const hintSequence = useRef(0);
  const closedPositionKeysRef = useRef(new Set<string>());
  const fullRefreshRef = useRef<((wallet: string) => Promise<ProtocolPositionRefreshResult>) | null>(null);
  const positionRetryTimerRef = useRef<number | null>(null);
  const positionRetryAttemptsRef = useRef(0);
  const schedulePositionRetryRef = useRef<((walletAddress: string, generation: number) => void) | null>(null);
  const realtimeEthereum = useRealtimeChainState(1) as import('@/lib/realtimeChain').RealtimeChainState;

  const commit = useCallback((next: ProtocolPositionSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const persistHints = useCallback(() => {
    if (!address) return;
    try { savePositionHints(window.localStorage, address, hintRecords.current); } catch { /* Private browsing. */ }
  }, [address]);

  const removeHint = useCallback((key: string) => {
    hintRecords.current = hintRecords.current.filter(({ hint }) => confirmedPositionHintKey(hint) !== key);
    setPendingPositions((items) => items.filter((hint) => confirmedPositionHintKey(hint) !== key));
    persistHints();
  }, [persistHints]);

  const refreshConfirmedPositions = useCallback(async () => {
    if (!address || !sessionActive.current || hintRead.current !== null || !hintRecords.current.length) return;
    const generation = sessionGeneration.current;
    const batch = ++hintSequence.current;
    hintRead.current = batch;
    setCheckingConfirmedPositions(true);
    const isCurrent = () => sessionActive.current && sessionGeneration.current === generation && hintRead.current === batch;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const reads = Promise.all(hintRecords.current.map(async ({ hint }) => {
        const key = confirmedPositionHintKey(hint);
        const hintIsCurrent = () => isCurrent() && hintRecords.current.some((item) => confirmedPositionHintKey(item.hint) === key && item.hint.transactionHash === hint.transactionHash);
        try {
          const verified = await verifyConfirmedPositionHint(hint, address);
          if (!hintIsCurrent()) return;
          if (!verified) { removeHint(key); return; }
          if (snapshotRef.current.positions.some((position) => positionKey(position) === key)) { removeHint(key); return; }
          setPendingPositions((items) => items.some((item) => confirmedPositionHintKey(item) === key) ? items : [...items, hint]);
          const position = await readConfirmedPosition(hint, address);
          if (!hintIsCurrent() || !position) return;
          // Supersede any older all-market request; it may have captured an
          // empty index before this exact, receipt-bound position was visible.
          readGuardRef.current.begin();
          const current = snapshotRef.current;
          commit({ ...current, positions: [...current.positions.filter((item) => positionKey(item) !== key), position],
            // One verified position improves unavailable/loading to partial,
            // but cannot establish freshness for the rest of its pool group.
            status: current.status === 'loading' || current.status === 'unavailable' ? 'partial' : current.status, refreshing: false });
          removeHint(key);
          void fullRefreshRef.current?.(address);
        } catch {
          // An unavailable RPC/index is not evidence the successful trade failed.
          // Keep only previously verified hints visible; restored hints stay hidden.
        }
      }));
      // A hung indexer must not permanently lock every manual retry. The batch
      // token also prevents late responses from a timed-out batch changing state.
      await Promise.race([reads, new Promise<void>((resolve) => { deadline = setTimeout(resolve, 25_000); })]);
    } finally {
      if (deadline) clearTimeout(deadline);
      if (isCurrent()) { hintRead.current = null; setCheckingConfirmedPositions(false); }
    }
  }, [address, commit, removeHint]);

  const trackConfirmedPosition = useCallback(async (execution: TransactionExecutionResult, route: PlannedRoute) => {
    if (!address || !sessionActive.current) return false;
    const generation = sessionGeneration.current;
    const hint = deriveConfirmedPositionHint({ route, result: execution, walletAddress: address });
    if (!hint) return false;
    const key = confirmedPositionHintKey(hint);
    // Preserve the receipt-derived discovery hint even if the next RPC read is
    // unavailable. It stays hidden until refresh verifies ownership and receipt.
    hintRecords.current = [...hintRecords.current.filter((item) => confirmedPositionHintKey(item.hint) !== key), { hint, addedAt: Date.now() }].slice(-12);
    persistHints();
    const retainedKeys = new Set(hintRecords.current.map((item) => confirmedPositionHintKey(item.hint)));
    setPendingPositions((items) => items.filter((item) => retainedKeys.has(confirmedPositionHintKey(item))));
    if (generation !== sessionGeneration.current) return false;
    // Do not hold the confirmed transaction screen open while the index catches up.
    void refreshConfirmedPositions();
    void fullRefreshRef.current?.(address);
    return true;
  }, [address, persistHints, refreshConfirmedPositions]);

  const loadAddressImpl = useCallback(async (walletAddress: string): Promise<ProtocolPositionRefreshResult> => {
    const requestId = readGuardRef.current.begin();
    if (requestId === null) return EMPTY_RESULT;
    const walletGeneration = sessionGeneration.current;
    const readStartedAt = Date.now();
    const current = snapshotRef.current.walletAddress?.toLowerCase() === walletAddress.toLowerCase()
      ? snapshotRef.current
      : emptySnapshot(walletAddress);

    commit({
      ...current,
      walletAddress,
      status: current.lastVerifiedAt === null ? 'loading' : current.status,
      refreshing: current.lastVerifiedAt !== null,
    });

    try {
      const result = await readAllPositionsDetailed(walletAddress);
      if (!readGuardRef.current.isCurrent(requestId)) return EMPTY_RESULT;

      const merged = mergeVerifiedPositions(current.positions, result)
        .filter((position) => !closedPositionKeysRef.current.has(positionKey(position)));
      // Only call an ID newly minted when its group had a verified baseline
      // immediately before this refresh. A recovered pool may reveal older
      // positions and must not be presented as a just-confirmed transaction.
      const newPositions = current.lastVerifiedAt === null
        ? []
        : newlyVerifiedPositions(current.positions, result, current.verifiedGroups);
      commit({
        walletAddress,
        positions: merged,
        status: result.status,
        failedGroups: result.failedGroups,
        lastVerifiedAt: result.successfulGroups.length > 0 ? Date.now() : current.lastVerifiedAt,
        refreshing: false,
        verifiedGroups: result.successfulGroups,
      });
      if (result.failedGroups.length === 0) {
        positionRetryAttemptsRef.current = 0;
        if (positionRetryTimerRef.current !== null) window.clearTimeout(positionRetryTimerRef.current);
        positionRetryTimerRef.current = null;
      } else {
        schedulePositionRetryRef.current?.(walletAddress, walletGeneration);
      }
      return { ...result, newPositions, readStartedAt, readCompletedAt: Date.now() };
    } catch (reason) {
      if (readGuardRef.current.isCurrent(requestId)) {
        const result = unavailablePositionResult(reason);
        commit({
          ...current,
          walletAddress,
          status: 'unavailable',
          failedGroups: result.failedGroups,
          refreshing: false,
          verifiedGroups: [],
        });
        schedulePositionRetryRef.current?.(walletAddress, walletGeneration);
      }
      return EMPTY_RESULT;
    }
  }, [commit]);
  const pendingLoadRef = useRef<{ address: string; promise: Promise<ProtocolPositionRefreshResult> } | null>(null);
  const loadAddress = useCallback((walletAddress: string, afterConfirmation = false) =>
    loadPositionRefresh(pendingLoadRef, walletAddress, loadAddressImpl, afterConfirmation), [loadAddressImpl]);

  const schedulePositionRetry = useCallback((walletAddress: string, generation: number) => {
    if (positionRetryTimerRef.current !== null || positionRetryAttemptsRef.current >= POSITION_READ_RETRY_DELAYS_MS.length
      || !sessionActive.current || generation !== sessionGeneration.current
      || address?.toLowerCase() !== walletAddress.toLowerCase()
      || !isForegroundOnline()) return;
    const delay = POSITION_READ_RETRY_DELAYS_MS[positionRetryAttemptsRef.current++];
    positionRetryTimerRef.current = window.setTimeout(() => {
      positionRetryTimerRef.current = null;
      if (!sessionActive.current || generation !== sessionGeneration.current
        || address?.toLowerCase() !== walletAddress.toLowerCase()
        || !isForegroundOnline()) return;
      void fullRefreshRef.current?.(walletAddress);
    }, delay);
  }, [address]);
  schedulePositionRetryRef.current = schedulePositionRetry;

  const lastRealtimeBlock = useRef<bigint | null>(null);
  useEffect(() => {
    // Keep the last snapshot while review work has priority. Do not consume
    // the block here: releasing the final pause catches up once to the latest.
    if (automaticRefreshPausesRef.current > 0) return;
    if (!enabled || !address || !realtimeEthereum.latestBlockNumber || (realtimeEthereum.status !== 'live' && realtimeEthereum.status !== 'polling')) return;
    if (lastRealtimeBlock.current === realtimeEthereum.latestBlockNumber) return;
    lastRealtimeBlock.current = realtimeEthereum.latestBlockNumber;
    void loadAddress(address);
  }, [address, automaticRefreshPauses, enabled, loadAddress, realtimeEthereum.latestBlockNumber, realtimeEthereum.status]);

  fullRefreshRef.current = loadAddress;

  const reconcileClosedPosition = useCallback(async (position: Pick<UiPosition, 'market' | 'side'> & { info: Pick<UiPosition['info'], 'positionId'> }) => {
    if (!address || !sessionActive.current) return false;
    const generation = sessionGeneration.current;
    const key = `${position.market}:${position.side}:${position.info.positionId}`;
    try {
      const [collateral, debt] = await readCanonicalPositionState({
        client: getEthereumClient(),
        group: { market: position.market, side: position.side },
        positionId: position.info.positionId,
      });
      if (!sessionActive.current || sessionGeneration.current !== generation) return false;
      if (collateral !== 0n || debt !== 0n) return false;
      // Invalidate any all-group read that was already in flight, then keep
      // suppressing the indexer's historical row until its next refresh omits
      // it. The canonical zero read is receipt-bound by the caller's
      // post-confirm lifecycle; no optimistic deletion is allowed.
      readGuardRef.current.begin();
      closedPositionKeysRef.current.add(key);
      commit({ ...snapshotRef.current, positions: snapshotRef.current.positions.filter((item) => positionKey(item) !== key) });
      return true;
    } catch {
      return false;
    }
  }, [address, commit]);

  useEffect(() => {
    const guard = readGuardRef.current;
    // The provider stays mounted so product forms keep their explicit input,
    // but every wallet-scoped reader still gets a complete session boundary.
    // In particular, do not let a same-address reconnect reuse an old pending
    // read or receipt hint after the disconnected session was torn down.
    guard.invalidate();
    sessionActive.current = false;
    sessionGeneration.current += 1;
    hintRead.current = null;
    hintSequence.current += 1;
    hintRecords.current = [];
    closedPositionKeysRef.current = new Set<string>();
    if (positionRetryTimerRef.current !== null) window.clearTimeout(positionRetryTimerRef.current);
    positionRetryTimerRef.current = null;
    positionRetryAttemptsRef.current = 0;
    pendingLoadRef.current = null;
    lastRealtimeBlock.current = null;
    commit(emptySnapshot(enabled ? address : null));
    setPendingPositions([]);
    setCheckingConfirmedPositions(false);
    if (!enabled) return undefined;
    guard.activate();
    sessionActive.current = true;
    sessionGeneration.current += 1;
    hintRead.current = null;
    if (address) {
      try { hintRecords.current = parseStoredPositionHints(window.localStorage.getItem(confirmedPositionStorageKey(address)), address); } catch { hintRecords.current = []; }
      void refreshConfirmedPositions();
    }
    if (address) void loadAddress(address);
    // Bounded foreground polling covers ordinary index lag. Afterwards, focus
    // or the explicit refresh button retries without indefinite background RPCs.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && hintRecords.current.some((record) => Date.now() - record.addedAt < 90_000)) void refreshConfirmedPositions();
    }, 5_000);
    const unsubscribeResume = subscribeToForegroundResume(() => {
      void refreshConfirmedPositions();
      if (address) void loadAddress(address);
    });
    return () => {
      guard.invalidate();
      sessionActive.current = false;
      sessionGeneration.current += 1;
      if (positionRetryTimerRef.current !== null) window.clearTimeout(positionRetryTimerRef.current);
      positionRetryTimerRef.current = null;
      window.clearInterval(timer);
      unsubscribeResume();
    };
  }, [address, commit, enabled, loadAddress, refreshConfirmedPositions]);

  const refresh = useCallback(async (options?: { afterConfirmation?: boolean }) => {
    if (!enabled || !address) return EMPTY_RESULT;
    void refreshConfirmedPositions();
    if (positionRetryTimerRef.current !== null) window.clearTimeout(positionRetryTimerRef.current);
    positionRetryTimerRef.current = null;
    positionRetryAttemptsRef.current = 0;
    return loadAddress(address, options?.afterConfirmation === true);
  }, [address, enabled, loadAddress, refreshConfirmedPositions]);

  // Effects run after render, so hide the previous wallet's verified rows for
  // the transition frame without remounting children that own user input.
  const visibleSnapshot = useMemo(() => (
    enabled && address && snapshot.walletAddress?.toLowerCase() === address.toLowerCase()
      ? snapshot
      : emptySnapshot(enabled && address ? address : null)
  ), [address, enabled, snapshot]);
  const visiblePendingPositions = useMemo(() => (
    enabled && address
      ? pendingPositions.filter((hint) => hint.walletAddress.toLowerCase() === address.toLowerCase())
      : []
  ), [address, enabled, pendingPositions]);
  const visibleCheckingConfirmedPositions = enabled && address
    && snapshot.walletAddress?.toLowerCase() === address.toLowerCase()
    ? checkingConfirmedPositions : false;
  const value = useMemo<ProtocolPositionContextValue>(() => ({ ...visibleSnapshot, refresh,
    pendingPositions: visiblePendingPositions.filter((hint) => !visibleSnapshot.positions.some((position) => positionKey(position) === confirmedPositionHintKey(hint))),
    checkingConfirmedPositions: visibleCheckingConfirmedPositions, refreshConfirmedPositions, trackConfirmedPosition, reconcileClosedPosition,
  }), [refresh, visibleSnapshot, visiblePendingPositions, visibleCheckingConfirmedPositions, refreshConfirmedPositions, trackConfirmedPosition, reconcileClosedPosition]);
  return <PositionRefreshActivityContext.Provider value={acquireRefreshPause}>
    <ProtocolPositionContext.Provider value={value}>{children}</ProtocolPositionContext.Provider>
  </PositionRefreshActivityContext.Provider>;
}

export function useProtocolPositions(): ProtocolPositionContextValue {
  const value = useContext(ProtocolPositionContext);
  if (!value) throw new Error('useProtocolPositions must be used inside ProtocolPositionProvider');
  return value;
}
