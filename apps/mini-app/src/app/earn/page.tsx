'use client';

import { useNavigationInputs } from '@/lib/useNavigationInputs';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, Check, ExternalLink, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { AppShell } from '@/components/ui';
import { ChoiceCards, Disclosure, MetricRows, PageHeading, ProductSurface, StatusNotice } from '@/components/ProductUI';
import { freshDisplayPrices } from '@/lib/displayPrices';
import { fxSaveShareUsdValue } from '@/lib/fxSaveShareValue';
import { ActionReview, type ActionReviewStage } from '@/components/ActionReview';
import { isReviewInputStage } from '@/components/review/actionReviewTypes';
import { planClaimWithPreview } from '@/components/review/claimPreviewPresentation';
import { AmountField, Segmented, TokenSelect, useWalletTokenBalances, type TokenBalanceMap } from '@/components/ProtocolForm';
import { TransactionSettings } from '@/components/TransactionSettings';
import { EarnSections } from '@/components/ProductSections';
import { useUsdPrices } from '@/components/PriceProvider';
import { formatUsd } from '@/lib/prices';
import { fxSaveUsdValue, fxSaveVaultUsdValue, normalizedFxSaveAssetsWei } from '@/lib/fxSaveUnits';
import {
  assertConfiguredPublicClientChain,
  getFxReadFacade,
  withReadDeadline,
  MAX_FX_SLIPPAGE_PERCENT,
  planDepositFxSave,
  planRedeem,
  planWithdrawFxSave,
  restoreSignatureRequiredDraftFromSearch,
  signatureDraftIdFromSearch,
  type SignatureDraftState,
} from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent, SETTINGS_KEY, SETTINGS_UPDATED_EVENT } from '@/lib/settings';
import { userSafeError } from '@/lib/errors';
import { resetTransactionAmounts } from '@/lib/transactionState';
import { claimAvailability, cooldownRefreshDelayMs, createEarnReadGuard } from '@/lib/earnState';
import { selectWalletTasks } from '@/lib/taskState';
import { fetchFxSaveApy, type FxSaveApyResponse } from '@/lib/fxSaveApy';
import { formatAmount, parseAmount, type SaveToken } from '@/app/trade/fxUi';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import { formatUnits } from 'viem';
import { amountBlocker } from '@/lib/formBlockers';
import presentation from '@/components/SavingsWorkspace.module.css';
import { ActionWorkspace } from '@/components/ProductLayout';
import { MissingValue, ValueOrSkeleton } from '@/components/MissingValue';
import { useFxSaveClaimable } from '@/components/WalletDataProvider';
import { useRefreshAction } from '@/lib/useRefreshAction';
import TokenIcon, { ChainIcon } from '@/components/TokenIcon';
import { MobileFlowSheet } from '@/components/MobileFlowSheet';
import { MetricLabel } from '@/components/InfoHelp';
import { FxSaveHistory } from '@/components/FxSaveHistory';

type EarnMode = 'deposit' | 'withdraw' | 'claim';

const EARN_DRAFT_SCOPES = [
  { mode: 'deposit', operation: 'depositFxSave', actionKey: 'earn:deposit' },
  { mode: 'withdraw', operation: 'withdrawFxSave', actionKey: 'earn:withdraw' },
  { mode: 'claim', operation: 'getRedeemTx', actionKey: 'earn:claim' },
] as const;

function isEarnMode(value: unknown): value is EarnMode {
  return value === 'deposit' || value === 'withdraw' || value === 'claim';
}

function isSaveToken(value: unknown): value is SaveToken {
  return value === 'fxUSD' || value === 'usdc' || value === 'fxUSDBasePool';
}

function isEarnResumePath(value: string): boolean {
  try {
    return new URL(value, 'https://fxaeon.local').pathname === '/earn';
  } catch {
    return false;
  }
}

/**
 * Restore only the small, primitive form snapshot written by ActionReview.
 * The draft id is never enough on its own: operation, stable action identity,
 * Ethereum scope, wallet, and same-origin route must all match first.
 */
function restoreEarnDraft(search: string, walletAddress: string): SignatureDraftState | undefined {
  for (const scope of EARN_DRAFT_SCOPES) {
    const restored = restoreSignatureRequiredDraftFromSearch(search, {
      walletAddress: walletAddress as `0x${string}`,
      chainId: 1,
      operation: scope.operation,
      actionKey: scope.actionKey,
    });
    if (!restored || !isEarnResumePath(restored.draft.resumePath)) continue;
    const state = restored.formState;
    if (
      state.mode !== scope.mode
      || !isEarnMode(state.mode)
      || !isSaveToken(state.token)
      || (state.amount !== undefined && typeof state.amount !== 'string')
      || (state.shares !== undefined && typeof state.shares !== 'string')
      || (state.slippage !== undefined && typeof state.slippage !== 'string')
      || (state.instant !== undefined && typeof state.instant !== 'boolean')
    ) continue;
    return state;
  }
  return undefined;
}

function labelToken(token: SaveToken): string {
  return tokenSymbol(token);
}

export default function EarnPage() {
  const wallet = usePrivyWallet();
  const claimableQuery = useFxSaveClaimable({ address: wallet.address, enabled: Boolean(wallet.address) });
  const refreshClaimable = claimableQuery.refresh;
  const priceSnapshot = useUsdPrices();
  const refreshIdentity = `${wallet.address?.toLowerCase() ?? ''}:${wallet.chainId ?? ''}`;
  const refreshAction = useRefreshAction(refreshIdentity);
  const runRefreshAction = refreshAction.run;
  const [mode, setMode] = useState<EarnMode>('deposit');
  const [token, setToken] = useState<SaveToken>('fxUSD');
  const [amount, setAmount] = useState('');
  const [shares, setShares] = useState('');
  // A new withdrawal starts with the no-instant-fee path. Explicit selections
  // and signature-required drafts remain authoritative after that.
  const [instant, setInstant] = useState(false);
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PERCENT));
  const savedSlippageRef = useRef(DEFAULT_SLIPPAGE_PERCENT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<SaveConfig | null>(null);
  const [data, setData] = useState<SaveData | null>(null);
  const [readWarnings, setReadWarnings] = useState<string[]>([]);
  const [fxSaveApy, setFxSaveApy] = useState<FxSaveApyResponse | null>(null);
  const [fxSaveApyStatus, setFxSaveApyStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [reviewRevision, setReviewRevision] = useState(0);
  const [resumeReview, setResumeReview] = useState(0);
  const [reviewStage, setReviewStage] = useState<ActionReviewStage>('input');
  const earningsSummaryRef = useRef<HTMLDivElement>(null);
  const [viewEarningsRequested, setViewEarningsRequested] = useState(false);
  const claimTriggerRef = useRef<HTMLButtonElement>(null);
  const restoredDraftIdRef = useRef<string | null>(null);
  const contextAppliedRef = useRef(false);
  const previousWalletContextRef = useRef<string | null>(null);
  const lastConnectedWalletRef = useRef<string | null>(null);
  const lastConnectedChainRef = useRef<number | undefined>(undefined);
  const readGuard = useRef(createEarnReadGuard());
  const dataRef = useRef<SaveData | null>(null);
  const configRef = useRef<SaveConfig | null>(null);
  const refreshApyRef = useRef<() => Promise<void>>(async () => undefined);
  const fxSaveApyRef = useRef<FxSaveApyResponse | null>(null);
  fxSaveApyRef.current = fxSaveApy;
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { configRef.current = config; }, [config]);
  // fxSAVE routes are Ethereum-only even when the connected wallet is
  // currently displaying another supported chain. Read the selected address
  // against Ethereum's reviewed public client, not wallet.chainId.
  const balanceSnapshot = useWalletTokenBalances(wallet.address, 1);
  const refreshBalances = balanceSnapshot.refresh;
  const refreshPrices = priceSnapshot.refresh;
  const saveBalances = useMemo<TokenBalanceMap | undefined>(() => {
    if (balanceSnapshot.status === 'idle') return undefined;
    return {
      ...balanceSnapshot.balances,
      usdc: balanceSnapshot.balances.USDC,
    };
  }, [balanceSnapshot.balances, balanceSnapshot.status]);
  const saveBalanceStatus = wallet.address
    ? (balanceSnapshot.status === 'idle' ? 'loading' : balanceSnapshot.status)
    : undefined;
  const resetEarnContext = useCallback((nextMode: EarnMode = 'deposit', nextToken: SaveToken = 'fxUSD', preserveWithdrawalMethod = false) => {
    const defaults = resetTransactionAmounts();
    setMode(nextMode);
    setToken(nextToken);
    setAmount(defaults.amount);
    setShares(defaults.shares);
    if (!preserveWithdrawalMethod) setInstant(false);
    setReviewStage('input');
    setReviewRevision((revision) => revision + 1);
  }, []);

  const changeMode = useCallback((nextMode: EarnMode) => {
    resetEarnContext(nextMode, 'fxUSD', true);
  }, [resetEarnContext]);

  const changeToken = useCallback((nextToken: SaveToken) => {
    resetEarnContext(mode, nextToken, true);
  }, [mode, resetEarnContext]);

  useEffect(() => {
    const context = `${wallet.address?.toLowerCase() ?? ''}:${wallet.chainId ?? ''}`;
    const previous = previousWalletContextRef.current;
    const currentAddress = wallet.address?.toLowerCase() ?? null;
    const walletChanged = Boolean(lastConnectedWalletRef.current)
      && lastConnectedWalletRef.current !== currentAddress;
    const chainChanged = wallet.chainId !== undefined
      && lastConnectedChainRef.current !== undefined
      && lastConnectedChainRef.current !== wallet.chainId;
    if (previous !== null && previous !== context && (walletChanged || chainChanged)) {
      // Keep a submitted hash and its result tied to the original wallet.
      // Preserve the old refs so Edit applies this reset on input.
      if (reviewStage === 'executing' || reviewStage === 'result') return;
      resetEarnContext();
    }
    previousWalletContextRef.current = context;
    if (currentAddress) lastConnectedWalletRef.current = currentAddress;
    if (wallet.chainId !== undefined) lastConnectedChainRef.current = wallet.chainId;
  }, [resetEarnContext, reviewStage, wallet.address, wallet.chainId]);

  useEffect(() => {
    savedSlippageRef.current = readSlippagePercent();
    setSlippage(String(savedSlippageRef.current));
  }, []);
  useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      if (event.type === 'storage' && (event as StorageEvent).key !== SETTINGS_KEY) return;
      const savedSlippage = readSlippagePercent();
      // A gas-only update must not replace the slippage of a resumed draft.
      // Explicit choices in this form also apply when the saved value is the
      // same, via TransactionSettings' controlled change callback.
      if (savedSlippage !== savedSlippageRef.current) setSlippage(String(savedSlippage));
      savedSlippageRef.current = savedSlippage;
    };
    window.addEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
    window.addEventListener('storage', onSettingsUpdated);
    return () => { window.removeEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated); window.removeEventListener('storage', onSettingsUpdated); };
  }, []);

  useEffect(() => {
    if (contextAppliedRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('fxDraft')) return;
    const nextMode = params.get('mode');
    const nextToken = params.get('token');
    if (nextMode === 'deposit' || nextMode === 'withdraw' || nextMode === 'claim') setMode(nextMode);
    if (isSaveToken(nextToken)) setToken(nextToken);
    contextAppliedRef.current = true;
  }, []);

  // History links carry only an opaque local draft id. Consume it once the
  // matching wallet is available, then remove it with replaceState so a
  // reload cannot repeatedly reapply an old form snapshot.
  useEffect(() => {
    if (reviewStage === 'executing' || reviewStage === 'result') return;
    if (typeof window === 'undefined' || !wallet.address || wallet.chainId !== 1) return;
    const draftId = signatureDraftIdFromSearch(window.location.search);
    if (!draftId || restoredDraftIdRef.current === draftId) return;
    const state = restoreEarnDraft(window.location.search, wallet.address);
    restoredDraftIdRef.current = draftId;
    if (!state) return;
    const restoredMode = state.mode;
    if (!isEarnMode(restoredMode)) return;
    setMode(restoredMode);
    if (isSaveToken(state.token)) setToken(state.token);
    if (typeof state.amount === 'string') setAmount(state.amount);
    if (typeof state.shares === 'string') setShares(state.shares);
    if (typeof state.instant === 'boolean') setInstant(state.instant);
    if (typeof state.slippage === 'string') setSlippage(state.slippage);
    setReviewStage('input');
    setReviewRevision((revision) => revision + 1);
    setResumeReview((revision) => revision + 1);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('fxDraft');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // History is optional in embedded/older webviews; restoration is still
      // complete when the URL cannot be rewritten.
    }
  }, [reviewStage, wallet.address, wallet.chainId]);

  const draftState = useMemo<SignatureDraftState>(() => ({
    mode,
    token,
    amount,
    shares,
    instant,
    slippage,
  }), [amount, instant, mode, shares, slippage, token]);


  useNavigationInputs({ page: 'earn', identity: `${wallet.address?.toLowerCase() ?? 'disconnected'}:${wallet.chainId ?? ''}`, ready: wallet.ready, stage: reviewStage, value: draftState, restore: (state) => {
    setMode(state.mode as EarnMode); setToken(state.token as SaveToken);
    setAmount(state.amount as string); setShares(state.shares as string);
    setInstant(state.instant as boolean); setSlippage(state.slippage as string);
  } });

  // APY is display-only data from the official f(x) feed. It is independent
  // from SDK reads and can never affect a transaction plan or review.
  useEffect(() => {
    let disposed = false;
    let inFlight: Promise<void> | null = null;
    let controller: AbortController | null = null;

    const loadApy = (): Promise<void> => {
      // Do not create network work for a hidden/offline tab. The recovery
      // events below provide one retry when the route becomes usable again.
      if (disposed || document.visibilityState !== 'visible' || !navigator.onLine) return Promise.resolve();
      if (inFlight) return inFlight;
      controller = new AbortController();
      if (!fxSaveApyRef.current) setFxSaveApyStatus('loading');
      const request = fetchFxSaveApy(controller.signal)
        .then((snapshot) => {
          if (disposed || controller?.signal.aborted) return;
          setFxSaveApy(snapshot);
          setFxSaveApyStatus('ready');
        })
        .catch(() => {
          if (disposed || controller?.signal.aborted) return;
          setFxSaveApyStatus('unavailable');
        })
        .finally(() => {
          if (inFlight === request) inFlight = null;
          controller = null;
        });
      inFlight = request;
      return request;
    };

    refreshApyRef.current = loadApy;
    loadApy();
    const marketRefresh = window.setInterval(loadApy, 60_000);
    const suspend = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) controller?.abort();
    };
    const recover = () => {
      suspend();
      loadApy();
    };
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('online', recover);
    window.addEventListener('offline', suspend);
    return () => {
      disposed = true;
      window.clearInterval(marketRefresh);
      controller?.abort();
      refreshApyRef.current = async () => undefined;
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('online', recover);
      window.removeEventListener('offline', suspend);
    };
  }, []);

  const load = useCallback(async (force = false) => {
    const request = readGuard.current.begin(force);
    if (request === null) return;
    const address = wallet.address;
    setLoading(true);
    setError('');
    try {
      await withReadDeadline(assertConfiguredPublicClientChain(1));
      const sdk = getFxReadFacade();
      if (!address) {
        const result = await Promise.allSettled([sdk.getFxSaveConfig({})]);
        if (!readGuard.current.isCurrent(request)) return;
        if (result[0].status === 'fulfilled') {
          setConfig(result[0].value);
          setError('');
          setReadWarnings([]);
        } else {
          setError('');
          setReadWarnings(['vault configuration']);
        }
        setData(null);
        return;
      }
      const [nextConfig, balance, redeemStatus] = await Promise.allSettled([
        sdk.getFxSaveConfig({}),
        sdk.getFxSaveBalance({ userAddress: address }),
        sdk.getFxSaveRedeemStatus({ userAddress: address }),
      ]);
      if (!readGuard.current.isCurrent(request)) return;
      const previous = dataRef.current?.walletAddress?.toLowerCase() === address.toLowerCase() ? dataRef.current : null;
      const nextConfigValue = nextConfig.status === 'fulfilled' ? nextConfig.value : configRef.current;
      const nextData: SaveData = {
        walletAddress: address,
        balance: balance.status === 'fulfilled' ? balance.value : previous?.balance ?? null,
        redeemStatus: redeemStatus.status === 'fulfilled' ? redeemStatus.value : previous?.redeemStatus ?? null,
        claimable: null,
      };
      setConfig(nextConfigValue);
      setData(nextData);
      const warnings: string[] = [];
      if (nextConfig.status === 'rejected') warnings.push('vault configuration');
      if (balance.status === 'rejected') warnings.push('balance');
      if (redeemStatus.status === 'rejected') warnings.push('redemption status');
      setReadWarnings(warnings);
      setError('');
    } catch (cause) {
      if (!readGuard.current.isCurrent(request)) return;
      setError(userSafeError(cause, ''));
      // A failed chain guard means none of the account-scoped reads are
      // current. Keep any previous snapshot visible for context, but prevent
      // every planner from treating it as authorization for a new action.
      setReadWarnings(address ? ['vault configuration', 'balance', 'redemption status'] : ['vault configuration']);
    } finally {
      readGuard.current.finish(request);
      if (readGuard.current.isCurrent(request)) setLoading(false);
    }
  }, [wallet.address]);

  useEffect(() => {
    const guard = readGuard.current;
    guard.invalidate();
    guard.activate();
    void load(true);
    return () => guard.invalidate();
  }, [load]);

  const walletDataBase = data?.walletAddress.toLowerCase() === wallet.address?.toLowerCase() ? data : null;
  const walletData = useMemo(() => walletDataBase
    ? { ...walletDataBase, claimable: claimableQuery.status === 'ready' ? claimableQuery.data : null }
    : null, [claimableQuery.data, claimableQuery.status, walletDataBase]);
  const activeReadWarnings = claimableQuery.status === 'unavailable' ? [...readWarnings, 'claim status'] : readWarnings;
  const claimable = walletData?.claimable;
  const hasWalletData = walletData !== null;
  const cooldownState = claimable ?? walletData?.redeemStatus;
  const hasCooldownState = cooldownState !== null && cooldownState !== undefined;
  const cooldownPending = Boolean(cooldownState?.hasPendingRedeem);
  const cooldownComplete = Boolean(cooldownState?.isCooldownComplete);
  const cooldownRedeemableAt = cooldownState?.redeemableAt ?? null;
  useEffect(() => {
    if (!hasWalletData || !hasCooldownState || cooldownComplete || !cooldownPending) return;
    const delay = cooldownRefreshDelayMs(cooldownRedeemableAt);
    if (delay === null) return;
    const refreshWhenForeground = () => {
      if (document.visibilityState === 'visible') void Promise.allSettled([load(false), refreshClaimable()]);
    };
    const timer = window.setTimeout(refreshWhenForeground, delay);
    window.addEventListener('focus', refreshWhenForeground);
    document.addEventListener('visibilitychange', refreshWhenForeground);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refreshWhenForeground);
      document.removeEventListener('visibilitychange', refreshWhenForeground);
    };
  }, [cooldownComplete, cooldownPending, cooldownRedeemableAt, hasCooldownState, hasWalletData, load, refreshClaimable]);

  const planBuilder = useMemo(() => {
    if (!wallet.address) return null;
    if (readWarnings.includes('vault configuration')) return null;
    if (mode === 'claim') {
      if (claimableQuery.status !== 'ready' || !claimAvailability(walletData?.claimable).canReview) return null;
      return () => planClaimWithPreview(
        () => planRedeem({ userAddress: wallet.address! }),
        () => getFxReadFacade().getFxSaveClaimable({ userAddress: wallet.address! }),
        wallet.address!,
      );
    }
    if (mode === 'deposit') {
      if (readWarnings.includes('balance')) return null;
      const amountWei = parseAmount(amount, token === 'usdc' ? 'USDC' : token === 'fxUSDBasePool' ? 'fxUSDBasePool' : 'fxUSD');
      if (!amountWei) return null;
      return () => planDepositFxSave({
        userAddress: wallet.address!,
        tokenIn: token,
        amount: amountWei,
      });
    }
    const sharesWei = shares.toLowerCase() === 'all'
      ? walletData?.balance?.balanceWei ?? null
      : parseAmount(shares, 'fxSAVE');
    if (readWarnings.includes('balance') || !sharesWei || !walletData?.balance || sharesWei > walletData.balance.balanceWei) return null;
    const slippageValue = Number(slippage);
    if (instant && token !== 'fxUSDBasePool' && (!Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT)) return null;
    return () => planWithdrawFxSave({
      userAddress: wallet.address!,
      tokenOut: token,
      amount: sharesWei,
      instant: token === 'fxUSDBasePool' ? false : instant,
      slippage: instant && token !== 'fxUSDBasePool' ? slippageValue : undefined,
    });
  }, [amount, claimableQuery.status, instant, mode, readWarnings, shares, slippage, token, wallet.address, walletData]);

  const claimState = claimAvailability(walletData?.claimable);
  const refreshEarn = useCallback(() => runRefreshAction([
    () => load(true), refreshBalances, refreshClaimable, refreshPrices, () => refreshApyRef.current(),
  ]), [load, refreshBalances, refreshClaimable, refreshPrices, runRefreshAction]);
  const reviewLabel = mode === 'claim' ? 'Review claim' : mode === 'withdraw' ? 'Review withdrawal' : 'Review deposit';
  // Deposit and withdrawal say what is missing; the exact share balance (not the
  // display-rounded one) decides whether a withdrawal fits.
  const reviewBlocker = !wallet.address || mode === 'claim' ? null
    : mode === 'deposit'
      ? amountBlocker(amount, token === 'usdc' ? 6 : 18, labelToken(token), saveBalances?.[token], { emptyLabel: `No ${labelToken(token)} to deposit` })
      : amountBlocker(shares, 18, 'fxSAVE', walletData?.balance ? { status: 'ready', amount: formatUnits(walletData.balance.balanceWei, 18) } : undefined, { allowAll: true, emptyLabel: 'No fxSAVE to withdraw' });
  const operationLabel = mode === 'claim' ? 'Claim withdrawal' : mode === 'withdraw' ? 'Withdraw fxSAVE' : 'Deposit into fxSAVE';
  const warningTitle = activeReadWarnings.includes('balance') ? 'fxSAVE balance unavailable'
    : activeReadWarnings.includes('claim status') || activeReadWarnings.includes('redemption status') ? 'Withdrawal status unavailable'
      : 'Vault data unavailable';
  const inputStage = isReviewInputStage(reviewStage);
  useEffect(() => {
    if (!viewEarningsRequested || !inputStage) return;
    const frame = window.requestAnimationFrame(() => {
      const summary = earningsSummaryRef.current;
      if (!summary) return;
      summary.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      summary.focus({ preventScroll: true });
      setViewEarningsRequested(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inputStage, viewEarningsRequested]);

  return (
    <AppShell>
      <ActionWorkspace className={presentation.workspace} density="compact">
        <PageHeading title="Earn" />
        <div className={presentation.vaultLayout} data-review={!inputStage || mode === 'claim'} data-claim-flow={mode === 'claim'}>
        {(inputStage || mode === 'claim') && <div ref={earningsSummaryRef} tabIndex={-1} role="region" aria-label="Your fxSAVE earnings" className={presentation.summarySlot} data-claim-background={mode === 'claim'}>
        <SavingsSummary data={walletData} loading={loading || refreshAction.refreshing} connected={Boolean(wallet.address)} onRefresh={refreshEarn}
          readWarnings={activeReadWarnings} config={config} fxSaveApy={fxSaveApy} fxSaveApyStatus={fxSaveApyStatus}
          onClaim={() => changeMode('claim')} claimTriggerRef={claimTriggerRef} />
        </div>}
        <EarnClaimSheet mode={mode} stage={reviewStage} onClose={() => changeMode('withdraw')} triggerRef={claimTriggerRef}>
        <ProductSurface data-result-container className={presentation.panel} data-flow-stage={reviewStage} data-claim-flow={mode === 'claim'}>
          <ActionReview
            key={reviewRevision}
            surface="content"
            planBuilder={planBuilder}
            disabled={mode === 'claim' && Boolean(wallet.address) && !claimState.canReview}
            blocker={reviewBlocker}
            label={reviewLabel}
            operationLabel={operationLabel}
            draftActionKey={mode === 'claim' ? 'earn:claim' : mode === 'withdraw' ? 'earn:withdraw' : 'earn:deposit'}
            draftResumePath="/earn"
            draftState={draftState}
            resumeReview={resumeReview}
            onStageChange={setReviewStage}
            onComplete={refreshEarn}
            onViewEarnings={() => setViewEarningsRequested(true)}
            savingsApy={fxSaveApy}
            savingsApyStatus={fxSaveApyStatus}
            editor={<>
              {mode !== 'claim' ? <div className={presentation.actionTabs}>
                <Segmented value={mode} onChange={changeMode} ariaLabel="fxSAVE action" options={[
                  { value: 'deposit', label: 'Deposit' }, { value: 'withdraw', label: 'Withdraw' },
                ]} />
                <TransactionSettings scope="fxSAVE" slippage={mode === 'withdraw' && instant && token !== 'fxUSDBasePool'} slippagePercent={slippage} onSlippageChange={setSlippage} />
              </div> : <div className={presentation.claimHeading}>
                <button type="button" onClick={() => changeMode('withdraw')} className={presentation.back}><ArrowLeft size={17} aria-hidden="true" />Back to fxSAVE</button>
                <h2>Withdrawal details</h2>
              </div>}
              {wallet.address && (activeReadWarnings.some(warning => warning !== 'vault configuration') || mode === 'claim' && (activeReadWarnings.length > 0 || error)) && <StatusNotice tone="warning" title={warningTitle}
                action={<button type="button" aria-label="Retry fxSAVE data" title="Retry fxSAVE data" className={presentation.retryButton}
                  disabled={loading || refreshAction.refreshing} onClick={() => void refreshEarn()}><RefreshCw size={16} aria-hidden="true" /></button>} />}
              {loading && !walletData && wallet.address && <span role="status" className="sr-only">Reading fxSAVE data</span>}
              <EarnActionEditor mode={mode} token={token} onTokenChange={changeToken} amount={amount} onAmountChange={setAmount}
                shares={shares} onSharesChange={setShares} instant={instant} onInstantChange={setInstant}
                config={activeReadWarnings.includes('vault configuration') ? null : config} walletData={walletData}
                estimateConfig={activeReadWarnings.includes('vault configuration') ? null : config}
                configLoading={loading} onRetryConfig={() => void load(true)}
                onDeposit={() => changeMode('deposit')}
                balances={saveBalances} balanceStatus={saveBalanceStatus} balanceUnavailable={readWarnings.includes('balance')} />
            </>}
          />
        </ProductSurface>
        </EarnClaimSheet>
        {inputStage && mode !== 'claim' && <div className={presentation.historySlot}><FxSaveHistory /></div>}
        {inputStage && mode !== 'claim' && <div className={presentation.vaultInfo}>
          <EarnSections cooldown={config && !readWarnings.includes('vault configuration') ? formatCooldown(config.cooldownPeriodSeconds) : null} instantFee={config && !readWarnings.includes('vault configuration') ? formatRatio(config.instantRedeemFeeRatio) : null}
            vaultStatus={readWarnings.includes('vault configuration') ? 'unavailable' : 'loading'} showWithdrawalTerms
            termsNotice={<VaultTermsStatus loading={loading} onRetry={() => void load(true)} />} />
          <VaultDetails config={readWarnings.includes('vault configuration') ? null : config} />
        </div>}
        </div>
      </ActionWorkspace>
    </AppShell>
  );
}

/** Keep the claim editor and its review in one mobile dialog. The shared sheet
 * context suppresses ActionReview's nested sheet, retaining one focus trap and
 * one Back stop as the stage changes. Desktop stays inline. */
function EarnClaimSheet({ mode, stage, children, onClose, triggerRef }: {
  mode: EarnMode; stage: ActionReviewStage; children: ReactNode; onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
}) {
  if (mode !== 'claim') return <>{children}</>;
  return <MobileFlowSheet title={isReviewInputStage(stage) ? 'Withdrawal details' : stage === 'result' ? 'Transaction details' : 'Review claim'}
    onClose={onClose} triggerRef={triggerRef} dismissible={stage !== 'planning' && stage !== 'executing'}>
    {children}
  </MobileFlowSheet>;
}

type SaveConfig = Awaited<ReturnType<ReturnType<typeof getFxReadFacade>['getFxSaveConfig']>>;
type SaveData = {
  walletAddress: string;
  balance: Awaited<ReturnType<ReturnType<typeof getFxReadFacade>['getFxSaveBalance']>> | null;
  redeemStatus: Awaited<ReturnType<ReturnType<typeof getFxReadFacade>['getFxSaveRedeemStatus']>> | null;
  claimable: Awaited<ReturnType<ReturnType<typeof getFxReadFacade>['getFxSaveClaimable']>> | null;
};

function SavingsSummary({ data, loading, connected, onRefresh, readWarnings, config, fxSaveApy, fxSaveApyStatus, onClaim, claimTriggerRef }: {
  data: SaveData | null; loading: boolean; connected: boolean; onRefresh: () => Promise<void>; readWarnings: readonly string[];
  config: SaveConfig | null;
  fxSaveApy: FxSaveApyResponse | null; fxSaveApyStatus: 'loading' | 'ready' | 'unavailable'; onClaim: () => void;
  claimTriggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const snapshot = useUsdPrices();
  const prices = freshDisplayPrices(snapshot);
  const shareValueUsd = fxSaveShareUsdValue(snapshot);
  const balance = data?.balance;
  const assetsWei = balance ? normalizedFxSaveAssetsWei(balance.balanceWei, balance.assetsWei) : undefined;
  const value = fxSaveUsdValue('assetsWei', assetsWei, prices);
  const tvlUsd = fxSaveVaultUsdValue(readWarnings.includes('vault configuration') ? undefined : config?.totalAssetsWei, prices, fxSaveApy);
  const empty = balance?.balanceWei === 0n;
  const balanceUnavailable = connected && !balance;
  const lastVerified = Boolean(balance) && readWarnings.includes('balance');
  const claim = claimAvailability(data?.claimable);
  const redemption = data?.claimable ?? data?.redeemStatus;
  const hasPending = Boolean(data?.claimable?.hasPendingRedeem || data?.redeemStatus?.hasPendingRedeem);
  const claimUnavailable = readWarnings.includes('claim status') || readWarnings.includes('redemption status');
  const withdrawalTask = selectWalletTasks({ walletAddress: data?.walletAddress ?? '', transactions: [], claimable: claimUnavailable ? null : data?.claimable })
    .find((task) => task.kind === 'withdrawal');
  return <div className={presentation.overview}>
    <div className={presentation.vaultIdentity}>
      <TokenIcon symbol="fxSAVE" size={48} />
      <div><h2>fxSAVE</h2><p>Stability Pool vault</p></div>
      <span className={presentation.network}><ChainIcon chainId={1} size={16} />Ethereum</span>
      {connected && <button type="button" disabled={loading} onClick={() => void onRefresh()} aria-label="Refresh fxSAVE state" className={presentation.refresh}>
        <RefreshCw size={16} aria-hidden="true" className={loading ? 'animate-spin' : ''} />
      </button>}
    </div>
    <div className={presentation.balanceTop}>
      <div className={presentation.rate}>
        <small><MetricLabel minimalHelp label="APY" definition="fxSaveApy" /></small>
        <strong>{fxSaveApy
          ? <ValueOrSkeleton value={`${fxSaveApy.apy.toFixed(2)}%`} width="sm" label="fxSAVE APY" />
          : <MissingValue width="sm" status={fxSaveApyStatus === 'loading' ? 'loading' : 'unavailable'} label={fxSaveApyStatus === 'loading' ? 'Loading fxSAVE APY' : 'fxSAVE APY unavailable'} />}</strong>
        {fxSaveApy && fxSaveApyStatus === 'unavailable' && <span className={presentation.marketFreshness}>Last verified APY · refresh unavailable</span>}
      </div>
      <div className={presentation.balanceCopy} data-connected={connected}>
        <p><MetricLabel minimalHelp label={!connected ? 'Vault holdings' : balanceUnavailable ? 'fxSAVE balance' : lastVerified ? 'Last verified fxSAVE value' : 'Your fxSAVE value'} definition={!connected ? 'vaultHoldings' : 'fxSaveShares'} /></p>
        {!connected ? <>
          <h2 title={tvlUsd !== null ? formatUsd(tvlUsd) : undefined}>{tvlUsd !== null
            ? formatVaultUsd(tvlUsd)
            : <MissingValue width="md" status={readWarnings.includes('vault configuration') || fxSaveApyStatus === 'unavailable' ? 'unavailable' : 'loading'} label="Vault holdings in USD" />}</h2>
          {config && !readWarnings.includes('vault configuration') && <small>{formatDisplayAmount(config.totalAssetsWei)} fxSP</small>}
        </> : balanceUnavailable ? <>
          <h2><MissingValue width="md" status={loading ? 'loading' : 'unavailable'} label={loading ? 'Loading fxSAVE balance' : 'fxSAVE balance unavailable'} /></h2>
        </> : empty ? <>
          <h2>$0.00</h2>
          <small>0 fxSAVE</small>
        </> : <>
          <h2>{value === null
            ? <MissingValue width="xl" status={loading || snapshot.status === 'loading' ? 'loading' : 'unavailable'} label={loading || snapshot.status === 'loading' ? 'Loading fxSAVE position value' : 'fxSAVE position value unavailable'} />
            : <ValueOrSkeleton value={formatUsd(value)} width="xl" label="fxSAVE position value" />}</h2>
          <small>{formatDisplayAmount(balance!.balanceWei)} fxSAVE</small>
        </>}
      </div>
    </div>
    <dl className={presentation.vaultHoldings}>
      <div><dt><MetricLabel minimalHelp label="Value per fxSAVE" definition="fxSaveShares" /></dt><dd>{shareValueUsd !== null
        ? formatUsd(shareValueUsd, 4)
        : snapshot.status === 'loading' ? <MissingValue width="sm" status="loading" label="Loading value per fxSAVE" />
          : <span className={presentation.unavailableMetric}>Unavailable</span>}</dd></div>
      {connected && <div><dt><MetricLabel minimalHelp label="Vault holdings" definition="vaultHoldings" /></dt><dd title={tvlUsd !== null ? formatUsd(tvlUsd) : undefined}>{tvlUsd !== null
        ? formatVaultUsd(tvlUsd)
        : <MissingValue width="sm" status={fxSaveApyStatus === 'loading' ? 'loading' : 'unavailable'} label="Vault holdings in USD" />}</dd></div>}
    </dl>
    {hasPending && <div className={presentation.pendingTask}>
      {!claimUnavailable && claim.status === 'ready'
        ? <ReadyClaimBanner onClaim={onClaim} claimTriggerRef={claimTriggerRef} />
        : <StatusNotice title={claimUnavailable ? 'Withdrawal status unavailable' : withdrawalTask?.title ?? 'Withdrawal pending'}
          tone="neutral" action={<button ref={claimTriggerRef} type="button" onClick={onClaim}>View</button>}>
          {claimUnavailable ? 'Refresh to check the current withdrawal status.' : withdrawalTask?.detail ?? (redemption?.redeemableAt ? `Available ${formatTimestamp(redemption.redeemableAt)}` : 'Waiting for the configured cooldown.')}
        </StatusNotice>}
    </div>}
  </div>;
}

/** Only rendered from a fresh, wallet-scoped claimable result. Keep the action
 * prominent without repeating the explanation already in the claim sheet. */
function ReadyClaimBanner({ onClaim, claimTriggerRef }: {
  onClaim: () => void; claimTriggerRef: RefObject<HTMLButtonElement | null>;
}) {
  return <div className={presentation.readyClaim} role="status">
    <span><Check size={17} aria-hidden="true" /><strong>Ready to claim</strong></span>
    <button ref={claimTriggerRef} type="button" onClick={onClaim}>Review claim</button>
  </div>;
}

function VaultTermsStatus({ loading, onRetry, direct = false }: { loading: boolean; onRetry: () => void; direct?: boolean }) {
  return <div className={presentation.termsStatus}>
    <span role="status">{loading ? 'Checking vault terms…' : direct ? 'Vault terms unavailable.' : 'Cooldown and fee unavailable.'}</span>
    <button type="button" onClick={onRetry} disabled={loading} aria-label="Retry vault terms">Retry</button>
  </div>;
}

function EarnActionEditor({ mode, token, onTokenChange, amount, onAmountChange, shares, onSharesChange, instant, onInstantChange,
  config, estimateConfig, configLoading, onRetryConfig, onDeposit, walletData, balances, balanceStatus, balanceUnavailable,
}: {
  mode: EarnMode; token: SaveToken; onTokenChange: (value: SaveToken) => void; amount: string; onAmountChange: (value: string) => void;
  shares: string; onSharesChange: (value: string) => void; instant: boolean; onInstantChange: (value: boolean) => void;
  config: SaveConfig | null; estimateConfig: SaveConfig | null; onDeposit: () => void; walletData?: SaveData | null;
  configLoading: boolean; onRetryConfig: () => void;
  balances?: TokenBalanceMap; balanceStatus?: 'loading' | 'ready' | 'unavailable' | 'disconnected'; balanceUnavailable: boolean;
}) {
  const disconnected = { status: 'disconnected' as const };
  const amountBalance = walletData ? balances?.[token] ?? { status: balanceStatus ?? 'loading' as const } : disconnected;
  // The exact share balance: the field rounds its own figure down, and its
  // presets and over-balance check must agree with the review's exact limit.
  const shareBalance = !walletData ? disconnected : balanceUnavailable ? { status: 'unavailable' as const }
    : walletData.balance ? { status: 'ready' as const, amount: formatUnits(walletData.balance.balanceWei, 18) } : { status: 'loading' as const };
  const directEstimate = directFxSaveEstimate(mode, token, amount, shares, estimateConfig, walletData?.balance?.balanceWei);
  const zeroExternalBalance = mode === 'deposit' && amountBalance.status === 'ready'
    && typeof amountBalance.amount === 'string' && /^0+(?:\.0+)?$/.test(amountBalance.amount);
  const zeroShareBalance = mode === 'withdraw' && shareBalance.status === 'ready'
    && typeof shareBalance.amount === 'string' && /^0+(?:\.0+)?$/.test(shareBalance.amount);
  const picker = <TokenSelect compact label={mode === 'deposit' ? 'Asset' : 'Receive'} value={token}
    options={['fxUSD', 'usdc', 'fxUSDBasePool'] as const} onChange={onTokenChange} balances={balances} balanceStatus={walletData ? balanceStatus : 'disconnected'} />;
  return <div className={presentation.editor}>
    {mode === 'deposit' && <>
      {/* "Amount", as on Withdraw, Trade and Move: the Deposit tab above already names the action. */}
      <AmountField label="Amount" symbol={labelToken(token)} value={amount} onChange={onAmountChange}
        compact showShortcuts maxDecimals={token === 'usdc' ? 6 : 18} balanceState={amountBalance} tokenSelector={picker} />
      {zeroExternalBalance && <p className={presentation.fundingGuide}>
        No {labelToken(token)} available. <Link href="/qr">Receive assets on Ethereum</Link> or choose an asset with a balance.
      </p>}
      <section className={presentation.outcome} aria-label="Deposit outcome">
        {directEstimate
          ? <EstimateRow label="Estimated fxSAVE received" value={directEstimate} note="Based on current vault assets and share supply." />
          : <div className={presentation.outcomeRow}><span>Receive</span><strong><TokenIcon symbol="fxSAVE" size={18} />fxSAVE</strong></div>}
      </section>
    </>}
    {mode === 'withdraw' && <>
      <AmountField label="Amount" symbol="fxSAVE" value={shares} onChange={onSharesChange}
        compact showShortcuts balanceState={shareBalance} allowAll maxDecimals={18} />
      {zeroShareBalance && <p className={presentation.fundingGuide}>No fxSAVE yet. <button type="button" onClick={onDeposit}>Switch to Deposit</button> using fxUSD, USDC, or fxSP.</p>}
      <div className={presentation.receiveRow}><span>{instant && token !== 'fxUSDBasePool' ? 'Receive asset' : 'Withdrawal route'}</span>{picker}</div>
      {token !== 'fxUSDBasePool' && <div className={presentation.withdrawOptions}>
        <ChoiceCards value={!instant ? 'cooldown' : 'instant'}
          onChange={(value) => onInstantChange(value === 'instant')} label="Withdrawal method" options={[
            { value: 'cooldown', label: 'After cooldown', description: config ? `${formatCooldown(config.cooldownPeriodSeconds)} · no instant fee` : undefined },
            { value: 'instant', label: 'Instant', description: config ? 'Fee quoted in review' : undefined },
          ]} />
      </div>}
      {!config && <VaultTermsStatus loading={configLoading} onRetry={onRetryConfig} direct={token === 'fxUSDBasePool'} />}
      <section className={presentation.outcome} aria-label="Withdrawal outcome">
      {directEstimate && <EstimateRow label="Estimated fxSP received" value={directEstimate} note="Based on current vault assets and share supply." />}
      {!directEstimate && <div className={presentation.outcomeRow}><span>{token !== 'fxUSDBasePool' && !instant ? 'Claim later' : 'Receive'}</span><strong>{token !== 'fxUSDBasePool' && !instant ? 'fxUSD + USDC' : labelToken(token)}</strong></div>}
      {token === 'fxUSDBasePool' && <p className={presentation.outcomeNote}>Direct redemption to fxSP has no cooldown or queued claim.</p>}
      {token !== 'fxUSDBasePool' && !instant && <p className={presentation.outcomeNote}>Network fees apply to the withdrawal request and claim.</p>}
      </section>
    </>}
    {mode === 'claim' && (walletData ? <ClaimState data={walletData} /> : <p className={presentation.helper}>Connect the requesting wallet to view its withdrawal.</p>)}
  </div>;
}

function directFxSaveEstimate(
  mode: EarnMode,
  token: SaveToken,
  amount: string,
  shares: string,
  config: SaveConfig | null,
  walletShareBalance?: bigint,
): string | undefined {
  if (!config || config.totalAssetsWei <= 0n || config.totalSupplyWei <= 0n) return undefined;
  if (mode === 'deposit' && token === 'fxUSDBasePool') {
    const depositWei = parseAmount(amount, 'fxUSDBasePool');
    return depositWei && depositWei > 0n
      ? `≈ ${formatDisplayAmount(depositWei * config.totalSupplyWei / config.totalAssetsWei)} fxSAVE`
      : undefined;
  }
  if (mode === 'withdraw' && token === 'fxUSDBasePool') {
    const sharesWei = shares.toLowerCase() === 'all' ? walletShareBalance : parseAmount(shares, 'fxSAVE');
    return sharesWei && sharesWei > 0n
      ? `≈ ${formatDisplayAmount(sharesWei * config.totalAssetsWei / config.totalSupplyWei)} fxSP`
      : undefined;
  }
  return undefined;
}

function EstimateRow({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className={presentation.estimateRow}>
    <div><span><MetricLabel minimalHelp label={label} help={note} /></span><strong>{value}</strong></div>
  </div>;
}

function ClaimState({ data }: { data: SaveData }) {
  const state = claimAvailability(data.claimable);
  if (state.status === 'unavailable') return <StatusNotice tone="warning" title="Claim status unavailable">{state.message}</StatusNotice>;
  if (state.status === 'empty') return <StatusNotice tone="neutral" title="No withdrawal queued">{state.message}</StatusNotice>;
  // Only the wallet-scoped, fresh claimable read can supply this card. A
  // redeem-status fallback must not imply the claim is ready or expose a
  // previous wallet's amounts. Pending shares are fxSP, not fxSAVE.
  const pending = data.claimable!.pendingSharesWei;
  const pendingAmount = formatDisplayAmount(pending);
  const exactPendingAmount = formatUnits(pending, 18);
  // Keep a non-zero queued share amount readable when five-decimal truncation
  // would otherwise display it as zero. The exact value is visible in this
  // rare case; ordinary long values remain compact.
  const visiblePendingAmount = pending > 0n && pendingAmount.replace(/,/g, '') === '0' ? exactPendingAmount : pendingAmount;
  const shortenedPendingAmount = visiblePendingAmount.replace(/,/g, '') !== exactPendingAmount;
  const preview = data.claimable?.previewReceive;
  const redeemableAt = data.claimable?.redeemableAt;
  const ready = state.status === 'ready';
  return <section className={presentation.claimState} aria-label="Withdrawal details" data-claim-status={state.status}>
    <div className={presentation.claimResultHeading}>
      <span className={presentation.claimResultIcon}><Check size={23} aria-hidden="true" /></span>
      <div className={presentation.claimResultCopy}>
        <h3>{ready ? 'Withdrawal ready' : 'Withdrawal queued'}</h3>
        {ready ? <p>Your queued redemption can now be claimed.</p>
          : <p className={presentation.claimProduct}><TokenIcon symbol="fxSAVE" size={14} />fxSAVE<span aria-hidden="true">·</span><ChainIcon chainId={1} size={14} />Ethereum</p>}
      </div>
    </div>
    <dl className={presentation.claimRows}>
      <div><dt>Amount queued</dt><dd>{shortenedPendingAmount ? '≈ ' : ''}{visiblePendingAmount} fxSP</dd></div>
      {ready && <div><dt>Claimable assets</dt><dd>fxUSD / USDC</dd></div>}
      <div><dt>Claim status</dt><dd className={ready ? presentation.claimReady : undefined}>{ready ? 'Ready to claim' : 'Waiting'}</dd></div>
      {!ready && redeemableAt ? <div><dt>Available to claim</dt><dd>{formatTimestamp(redeemableAt)}</dd></div> : null}
      {/* The live preview is display-only. Never present it as a minimum or receipt. */}
      {preview && <>
        <div className={presentation.claimPreviewStart}><dt>fxUSD to receive</dt><dd>≈ {formatDisplayAmount(preview.amountYieldOutWei)} fxUSD</dd></div>
        <div><dt>USDC to receive</dt><dd>≈ {formatDisplayAmount(preview.amountStableOutWei, 6)} USDC</dd></div>
      </>}
    </dl>
    <p className={presentation.claimCaveat}>
      {!ready && <>No payout yet. </>}
      {preview ? 'Amounts are estimates. A fresh read is required before review. ' : 'Claimable amounts require fresh contract reads before review. '}
      {!ready && !redeemableAt && <>Waiting for the configured cooldown. </>}
      Final amounts may change.
    </p>
  </section>;
}

function VaultDetails({ config }: { config: SaveConfig | null }) {
  return <Disclosure title="Vault details & transparency">
    {/* Withdrawal terms are available in the adjacent disclosure. */}
    {config ? <MetricRows rows={[
      { label: 'fxSAVE supply', value: `${formatDisplayAmount(config.totalSupplyWei)} fxSAVE` },
      { label: 'Expense ratio', value: formatVaultRatio(config.expenseRatio) },
      { label: 'Harvester ratio', value: formatVaultRatio(config.harvesterRatio) },
      // The vault stakes idle fxSP in batches once it reaches this amount.
      { label: 'Batch deposit threshold', value: `${formatDisplayAmount(config.threshold)} fxSP` },
    ]} /> : <p className={presentation.helper}>Vault details unavailable. Retry to load them.</p>}
    <VaultRiskNotice />
  </Disclosure>;
}

function VaultRiskNotice() {
  return <aside className={presentation.riskSummary} aria-label="fxSAVE risks">
    <nav aria-label="Protocol risk and audit resources">
      <a href="https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/stability-pool" target="_blank" rel="noopener noreferrer">Protocol risks<ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
      <a href="https://fxprotocol.gitbook.io/fx-docs/risk-management/audit-reports" target="_blank" rel="noopener noreferrer">Protocol audits<ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
    </nav>
  </aside>;
}

function formatVaultUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

function formatDisplayAmount(value: bigint | undefined, decimals = 18, digits = 5): string {
  const formatted = formatAmount(value, decimals, digits);
  if (formatted === '—') return formatted;
  const [integer, fraction] = formatted.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}
/** The base pool's instant fee ratio has 1e18 precision. */
function formatRatio(value: bigint): string { return `${formatDisplayAmount(value, 16)}%`; }
/** fxSAVE's own expense and harvester ratios have 1e9 precision (a 0.01% bounty reads 100000). */
function formatVaultRatio(value: bigint): string { return `${formatDisplayAmount(value, 7)}%`; }
function formatCooldown(seconds: bigint): string {
  if (seconds % 3600n === 0n) return `${seconds / 3600n}h`;
  if (seconds % 60n === 0n) return `${seconds / 60n}m`;
  return `${seconds}s`;
}
function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp * 1000));
}
