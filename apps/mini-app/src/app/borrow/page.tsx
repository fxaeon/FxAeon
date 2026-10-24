'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AppShell } from '@/components/ui';
import { formatUnits } from 'viem';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { PositionsPageHeader } from '@/components/PositionsPageHeader';
import TokenIcon, { ChainIcon } from '@/components/TokenIcon';
import { isReviewInputStage } from '@/components/review/actionReviewTypes';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { PageHeading, ProductSurface, StatusNotice } from '@/components/ProductUI';
import { BorrowPositionCard, BorrowPositionManager, BorrowPositionsState } from '@/components/BorrowPositionCards';
import { freshDisplayPrices } from '@/lib/displayPrices';
import { withReadDeadline } from '@/lib/fx/readFacade';
import { borrowFundingDisplay } from '@/lib/fx/borrowFunding';
import { BorrowFundingHistory } from '@/components/BorrowFundingHistory';
import { useBorrowFundingRate } from '@/lib/fx/useBorrowFundingRate';
import { calculateVerifiedNativeMax } from '@/lib/fx/nativeMax';
import { useNativeMax } from '@/lib/fx/useNativeMax';
import { routeGasCostCache } from '@/lib/fx/gasCost';
import { fetchGasTierQuotes, selectedGasTierQuote } from '@/lib/fx/gasFeePolicy';
import { readGasTier, SETTINGS_KEY, SETTINGS_UPDATED_EVENT } from '@/lib/settings';
import { borrowLtvCeiling, formatBorrowBasisPoints } from '@/components/review/borrowLimitPresentation';
import { ReviewFactValue } from '@/components/review/ReviewFactValue';
import { formatReviewFactValue } from '@/components/review/reviewFactFormatting';
import { MetricLabel } from '@/components/InfoHelp';
import { confirmedPositionReadback, type ConfirmedPositionReadback } from '@/components/review/positionReview';
import { ActionReview, type ActionReviewStage } from '@/components/ActionReview';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ProtocolPositionNotice } from '@/components/ProtocolPositionCard';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import { AmountField, Segmented, TokenSelect, useWalletTokenBalances } from '@/components/ProtocolForm';
import { useUsdPrices } from '@/components/PriceProvider';
import {
  planDepositAndMint,
  planRepayAndWithdraw,
  readDebtRatioRange,
  type DebtRatioRange,
  restoreSignatureRequiredDraftFromSearch,
  signatureDraftIdFromSearch,
  type PlannedRoute,
  type SignatureDraftState,
  type TransactionExecutionResult,
} from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import {
  ETH_MARKET_TOKENS,
  BTC_MARKET_TOKENS,
  parseZeroAmount,
  positionCollateralDecimals,
  positionDebtDecimals,
  positionIsStale,
  positionKey,
  tokenAddress,
  tokenDecimals,
  type UiMarket,
  type UiPosition,
  type UiToken,
} from '@/app/trade/fxUi';
import presentation from '@/components/BorrowWorkspace.module.css';
import { ActionWorkspace } from '@/components/ProductLayout';
import { borrowSelectionIsActionable } from './selectionEligibility';
import { positionCollateralSymbol } from '@/lib/positionUnits';
import { positionTokenPresentation } from '@/lib/positionPresentation';
import { priceKeyForSymbol } from '@/lib/prices';
import { resetTransactionAmounts } from '@/lib/transactionState';
import { TransactionSettings } from '@/components/TransactionSettings';
import { BorrowSections } from '@/components/ProductSections';
import { BorrowSensitivity } from '@/components/BorrowSensitivity';
import { borrowCapacity, borrowMaximumPreset, BORROW_LIMIT_GUARD_BPS, collateralUsdWad, loanToValueBps, tokenAmountForUsdWad, withdrawableCollateralUsd } from '@/lib/fx/borrowLimits';
import { formatSignificantDecimal, formatSignificantDecimalUp } from '@/lib/amount';
import { amountBlocker } from '@/lib/formBlockers';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';

type BorrowMode = 'mint' | 'manage';
type ManagementAction = 'none' | 'add' | 'borrow' | 'repay' | 'withdraw' | 'combined';

const BORROW_DRAFT_SCOPES = [
  { mode: 'mint', operation: 'depositAndMint', actionKey: 'borrow:new' },
  { mode: 'mint', operation: 'depositAndMint', actionKey: 'borrow:add' },
  { mode: 'manage', operation: 'repayAndWithdraw', actionKey: 'borrow:manage' },
] as const;

function isBorrowMode(value: unknown): value is BorrowMode {
  return value === 'mint' || value === 'manage';
}

function isBorrowMarket(value: unknown): value is UiMarket {
  return value === 'ETH' || value === 'BTC';
}

function isBorrowToken(value: unknown): value is UiToken {
  return typeof value === 'string' && (
    ETH_MARKET_TOKENS.includes(value as UiToken) || BTC_MARKET_TOKENS.includes(value as UiToken)
  );
}

function isBorrowResumePath(value: string): boolean {
  try {
    const url = new URL(value, 'https://fxaeon.local');
    return url.origin === 'https://fxaeon.local' && url.pathname === '/borrow';
  } catch {
    return false;
  }
}

type BorrowDraftRestore = {
  state: SignatureDraftState;
  actionKey: (typeof BORROW_DRAFT_SCOPES)[number]['actionKey'];
};

/** Restore only validated primitive form state from this wallet's History. */
function restoreBorrowDraft(search: string, walletAddress: string): BorrowDraftRestore | undefined {
  for (const scope of BORROW_DRAFT_SCOPES) {
    const restored = restoreSignatureRequiredDraftFromSearch(search, {
      walletAddress: walletAddress as `0x${string}`,
      chainId: 1,
      operation: scope.operation,
      actionKey: scope.actionKey,
    });
    if (!restored || !isBorrowResumePath(restored.draft.resumePath)) continue;
    const state = restored.formState;
    if (
      state.mode !== scope.mode
      || !isBorrowMode(state.mode)
      || (state.market !== undefined && !isBorrowMarket(state.market))
      || (state.token !== undefined && !isBorrowToken(state.token))
      || (state.deposit !== undefined && typeof state.deposit !== 'string')
      || (state.mint !== undefined && typeof state.mint !== 'string')
      || (state.repay !== undefined && typeof state.repay !== 'string')
      || (state.withdraw !== undefined && typeof state.withdraw !== 'string')
      || (state.selectedKey !== undefined && typeof state.selectedKey !== 'string')
    ) continue;
    return { state, actionKey: scope.actionKey };
  }
  return undefined;
}

const EMPTY_POSITIONS: UiPosition[] = [];
const ETH_COLLATERAL_TOKENS = ETH_MARKET_TOKENS.filter((item) => !['USDC', 'USDT', 'fxUSD'].includes(item));
const BTC_COLLATERAL_TOKENS = BTC_MARKET_TOKENS.filter((item) => item === 'WBTC');
const COLLATERAL_TOKENS = [...ETH_COLLATERAL_TOKENS, ...BTC_COLLATERAL_TOKENS];

function collateralTokensForMarket(market: UiMarket): readonly UiToken[] {
  return market === 'ETH' ? ETH_COLLATERAL_TOKENS : BTC_COLLATERAL_TOKENS;
}

export default function BorrowPage() {
  const wallet = usePrivyWallet();
  const sharedPositions = useProtocolPositions();
  const trackConfirmedPosition = sharedPositions.trackConfirmedPosition;
  const [mode, setMode] = useState<BorrowMode>('mint');
  const [managementAction, setManagementAction] = useState<ManagementAction>('none');
  const [market, setMarket] = useState<UiMarket>('ETH');
  const [selectedKey, setSelectedKey] = useState('new');
  const [token, setToken] = useState<UiToken>('ETH');
  const [deposit, setDeposit] = useState('');
  const [mint, setMint] = useState('');
  const [repay, setRepay] = useState('');
  const [withdraw, setWithdraw] = useState('');
  const [reviewRevision, setReviewRevision] = useState(0);
  const [resumeReview, setResumeReview] = useState(0);
  const [reviewStage, setReviewStage] = useState<ActionReviewStage>('input');
  const [confirmedPosition, setConfirmedPosition] = useState<ConfirmedPositionReadback | null>(null);
  const managerTriggerRef = useRef<HTMLElement>(null);
  const overviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const managerSnapshotRef = useRef<UiPosition | null>(null);
  const deepLinkApplied = useRef(false);
  const previousWalletContextRef = useRef<string | null>(null);
  const lastConnectedWalletRef = useRef<string | null>(null);
  const lastConnectedChainRef = useRef<number | undefined>(undefined);
  const restoredDraftRef = useRef<string | null>(null);
  // Borrowing is Ethereum-only in the official SDK. Keep the read tied to the
  // selected address while using Ethereum's reviewed client regardless of the
  // wallet's currently displayed chain.
  const balanceSnapshot = useWalletTokenBalances(wallet.address, 1);
  const refreshBalances = balanceSnapshot.refresh;
  const balanceStatus = wallet.address
    ? (balanceSnapshot.status === 'idle' ? 'loading' : balanceSnapshot.status)
    : undefined;
  const balanceStateFor = (key: string) => wallet.address
    ? balanceSnapshot.balances[key] ?? { status: balanceStatus ?? 'loading' as const }
    : undefined;
  const refreshPositions = sharedPositions.refresh;
  const refreshAfterAction = useCallback(async (execution: TransactionExecutionResult, route: PlannedRoute) => {
    const confirmedAt = Date.now();
    await trackConfirmedPosition(execution, route);
    const [read] = await Promise.all([refreshPositions({ afterConfirmation: true }), refreshBalances()]);
    setConfirmedPosition(confirmedPositionReadback(execution, route, read, confirmedAt));
  }, [refreshBalances, refreshPositions, trackConfirmedPosition]);

  useEffect(() => {
    deepLinkApplied.current = false;
  }, [wallet.address]);

  const positions = useMemo(() => {
    const currentAddress = sharedPositions.walletAddress?.toLowerCase();
    const walletAddress = wallet.address?.toLowerCase();
    if (!walletAddress || currentAddress !== walletAddress) return EMPTY_POSITIONS;
    return sharedPositions.positions.filter((position) => position.side === 'long');
  }, [sharedPositions.positions, sharedPositions.walletAddress, wallet.address]);
  const selected = positions.find((position) => positionKey(position) === selectedKey);
  const selectedStale = selected ? positionIsStale(selected, sharedPositions.failedGroups) : false;
  const selectedActionable = borrowSelectionIsActionable({
    walletAddress: wallet.address,
    snapshotWalletAddress: sharedPositions.walletAddress,
    selectedKey,
    hasSelectedPosition: Boolean(selected),
    selectedStale,
  });
  const [gasTier, setGasTier] = useState(readGasTier);
  useEffect(() => {
    const update = (event: Event) => {
      if (event.type !== 'storage' || (event as StorageEvent).key === SETTINGS_KEY) setGasTier(readGasTier());
    };
    window.addEventListener(SETTINGS_UPDATED_EVENT, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(SETTINGS_UPDATED_EVENT, update); window.removeEventListener('storage', update); };
  }, []);
  const maxBalance = balanceSnapshot.balances.ETH;
  const maxBalanceWei = maxBalance?.status === 'ready' && maxBalance.amount ? parseZeroAmount(maxBalance.amount, 'ETH') : null;
  const maxDebtWei = parseZeroAmount(mint, 'fxUSD');
  const nativeMaxContext = reviewStage === 'input' && mode === 'mint' && (selectedKey === 'new' || managementAction === 'add' || managementAction === 'combined')
    && token === 'ETH' && wallet.address && maxBalanceWei && maxDebtWei !== null && selectedActionable
    ? JSON.stringify(['borrow', wallet.address.toLowerCase(), wallet.chainId, wallet.isEmbedded, maxBalanceWei.toString(), market, selectedKey,
      selected?.info.rawDebts.toString(), selected?.info.rawColls.toString(), maxDebtWei.toString(), gasTier])
    : null;
  const nativeMax = useNativeMax({
    contextKey: nativeMaxContext,
    calculate: () => calculateVerifiedNativeMax({
      balanceWei: maxBalanceWei!, initialCandidateWei: parseZeroAmount(deposit, 'ETH') ?? undefined,
      buildRoutes: async (amountWei) => {
        const route = await planDepositAndMint({ market, positionId: selectedKey === 'new' ? 0 : selected!.info.positionId,
          userAddress: wallet.address!, depositTokenAddress: tokenAddress('ETH'), depositAmount: amountWei, mintAmount: maxDebtWei! });
        return Array.isArray(route) ? route : [route];
      },
      estimateRoutes: async (routes) => {
        const feeTierQuote = wallet.isEmbedded ? selectedGasTierQuote(await fetchGasTierQuotes(1), gasTier) : undefined;
        return Promise.all(routes.map((route) => routeGasCostCache.getOrRefresh(route, { feeTierQuote })));
      },
    }),
    onAmount: (maximum) => setDeposit(maximum === null ? '' : formatUnits(maximum, 18)),
  });
  const { cancel: cancelNativeMax } = nativeMax;
  const decisionBefore = useMemo(() => selected ? [
    { label: 'Collateral', value: formatPositionCollateral(selected) },
    { label: 'Debt', value: formatPositionDebt(selected) },
  ] : undefined, [selected]);
  // Borrowing limits come from the pool's own debt-ratio range (the one Trade's
  // leverage bounds use), applied to collateral at display prices with a guard.
  const limitMarket = selected?.market ?? market;
  const funding = useBorrowFundingRate(limitMarket);
  const fundingDisplay = funding.rate ? borrowFundingDisplay(funding.rate) : null;
  const [limitRevision, setLimitRevision] = useState(0);
  const [poolLimit, setPoolLimit] = useState<{ market: UiMarket; range: DebtRatioRange | null; pending: boolean }>({ market: 'ETH', range: null, pending: true });
  // Never carry one pool's verified range into a newly selected market, even
  // during the render before its effect starts the replacement read.
  const debtRange = poolLimit.market === limitMarket ? poolLimit.range : null;
  const limitPending = poolLimit.market !== limitMarket || poolLimit.pending;
  useEffect(() => {
    let active = true;
    setPoolLimit({ market: limitMarket, range: null, pending: true });
    void withReadDeadline(readDebtRatioRange(limitMarket, 'long')).then((range) => {
      if (range.source !== 'live' || range.min < 0n || range.max <= range.min || range.max >= 10n ** 18n) throw new Error('Invalid live borrowing limit');
      if (active) setPoolLimit({ market: limitMarket, range, pending: false });
    }).catch(() => { if (active) setPoolLimit({ market: limitMarket, range: null, pending: false }); });
    return () => { active = false; };
  }, [limitMarket, limitRevision]);
  const retryLimit = <button type="button" className={presentation.retryLimit} aria-label="Retry borrowing limit" disabled={limitPending} onClick={() => setLimitRevision(revision => revision + 1)}><RefreshCw size={14} aria-hidden="true" />Retry</button>;
  const limitPrices = freshDisplayPrices(useUsdPrices());
  const limitPrice = (symbol: string): number | undefined => {
    const key = priceKeyForSymbol(symbol);
    return key ? limitPrices[key] : undefined;
  };
  // Exact 18-decimal USD, so collateral worth a fraction of a cent still has a limit.
  const valueUsd = (raw: bigint, decimals: number, symbol: string): bigint | null => collateralUsdWad(raw, decimals, limitPrice(symbol));
  const collateralTokens = selectedKey === 'new' ? COLLATERAL_TOKENS : collateralTokensForMarket(market);
  const withdrawalTokens = collateralTokensForMarket(selected?.market ?? market);
  const activeTokenOptions = mode === 'manage' ? withdrawalTokens : collateralTokens;

  const draftState = useMemo<SignatureDraftState>(() => ({
    mode,
    market,
    selectedKey,
    token,
    deposit,
    mint,
    repay,
    withdraw,
  }), [deposit, market, mint, mode, repay, selectedKey, token, withdraw]);
  const draftActionKey = mode === 'manage'
    ? 'borrow:manage'
    : selectedKey === 'new'
      ? 'borrow:new'
      : 'borrow:add';

  const resetTransactionContext = useCallback((nextToken: UiToken = 'ETH') => {
    cancelNativeMax();
    const defaults = resetTransactionAmounts();
    setToken(nextToken);
    setDeposit(defaults.deposit);
    setMint(defaults.mint);
    setRepay(defaults.repay);
    setWithdraw(defaults.withdraw);
    setReviewStage('input');
    // Remounting the review state machine immediately discards a prepared
    // route, including a route that was just displayed in the review sheet.
    setReviewRevision((revision) => revision + 1);
  }, [cancelNativeMax]);

  const changeMode = useCallback((nextMode: BorrowMode) => {
    setMode(nextMode);
    resetTransactionContext(collateralTokensForMarket(market)[0]);
  }, [market, resetTransactionContext]);

  const changePosition = useCallback((nextKey: string) => {
    const next = positions.find((position) => positionKey(position) === nextKey);
    if (!next) return;
    setManagementAction('add');
    setMode('mint');
    setMarket(next.market);
    setSelectedKey(nextKey);
    resetTransactionContext(collateralTokensForMarket(next.market)[0]);
  }, [positions, resetTransactionContext]);

  const changeToken = useCallback((nextToken: UiToken) => {
    if (selectedKey === 'new') setMarket(nextToken === 'WBTC' ? 'BTC' : 'ETH');
    resetTransactionContext(nextToken);
    if (selectedKey === 'new') setMint(mint);
  }, [mint, resetTransactionContext, selectedKey]);

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
      // Preserve an in-flight execution and its result for the wallet that
      // submitted it. Keeping the refs lets Edit apply this reset on input.
      if (reviewStage === 'executing' || reviewStage === 'result') return;
      setManagementAction('none');
      setMode('mint');
      setMarket('ETH');
      setSelectedKey('new');
      resetTransactionContext('ETH');
    }
    previousWalletContextRef.current = context;
    if (currentAddress) lastConnectedWalletRef.current = currentAddress;
    if (wallet.chainId !== undefined) lastConnectedChainRef.current = wallet.chainId;
  }, [resetTransactionContext, reviewStage, wallet.address, wallet.chainId]);

  // History links carry only an opaque local-draft id. Restore the validated
  // primitive form after the exact Ethereum wallet is available, then consume
  // the query id so a reload cannot replay the same snapshot. ActionReview
  // still plans and simulates a fresh SDK route before signing.
  useEffect(() => {
    if (reviewStage === 'executing' || reviewStage === 'result') return;
    if (typeof window === 'undefined' || !wallet.address || wallet.chainId !== 1) return;
    const draftId = signatureDraftIdFromSearch(window.location.search);
    if (!draftId) return;
    const attemptKey = `${draftId}:${wallet.address.toLowerCase()}:${wallet.chainId}`;
    if (restoredDraftRef.current === attemptKey) return;
    const restored = restoreBorrowDraft(window.location.search, wallet.address);
    if (!restored) {
      restoredDraftRef.current = attemptKey;
      return;
    }

    const { state, actionKey } = restored;
    const restoredMode = state.mode;
    if (!isBorrowMode(restoredMode)) {
      restoredDraftRef.current = attemptKey;
      return;
    }
    const restoredMarket = isBorrowMarket(state.market) ? state.market : 'ETH';
    const restoredPositionKey = typeof state.selectedKey === 'string' ? state.selectedKey : '';
    if ((actionKey === 'borrow:new' && restoredPositionKey !== 'new')
      || (actionKey === 'borrow:add' && (!restoredPositionKey || restoredPositionKey === 'new'))
      || (actionKey === 'borrow:manage' && (!restoredPositionKey || restoredPositionKey === 'new'))) {
      restoredDraftRef.current = attemptKey;
      return;
    }
    // Existing-position drafts must wait for the provider snapshot so a
    // temporary empty loading state cannot silently turn an add/manage action
    // into a new position.
    if (restoredPositionKey !== 'new') {
      const restoredPosition = positions.find((position) => positionKey(position) === restoredPositionKey);
      if (!restoredPosition) {
        const positionsForWallet = sharedPositions.walletAddress?.toLowerCase() === wallet.address.toLowerCase();
        const readSettled = sharedPositions.status !== 'loading' && sharedPositions.status !== 'idle';
        if (!positionsForWallet || !readSettled) return;
        restoredDraftRef.current = attemptKey;
        return;
      }
      if (restoredPosition.market !== restoredMarket) {
        restoredDraftRef.current = attemptKey;
        return;
      }
    }

    const restoredTokens = collateralTokensForMarket(restoredMarket);
    const restoredToken = typeof state.token === 'string' && restoredTokens.includes(state.token as UiToken)
      ? state.token as UiToken
      : restoredTokens[0];
    restoredDraftRef.current = attemptKey;
    setMode(restoredMode);
    setManagementAction('combined');
    setMarket(restoredMarket);
    setSelectedKey(restoredPositionKey);
    setToken(restoredToken);
    if (typeof state.deposit === 'string') setDeposit(state.deposit);
    if (typeof state.mint === 'string') setMint(state.mint);
    if (typeof state.repay === 'string') setRepay(state.repay);
    if (typeof state.withdraw === 'string') setWithdraw(state.withdraw);
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
  }, [positions, reviewStage, sharedPositions.status, sharedPositions.walletAddress, wallet.address, wallet.chainId]);

  useEffect(() => {
    if (
      reviewStage === 'executing'
      || reviewStage === 'result'
      || deepLinkApplied.current
      || !wallet.address
      || sharedPositions.walletAddress?.toLowerCase() !== wallet.address.toLowerCase()
    ) return;
    deepLinkApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    const requestedMarket = params.get('market');
    const requestedId = Number(params.get('position'));
    if ((requestedMarket !== 'ETH' && requestedMarket !== 'BTC') || !Number.isSafeInteger(requestedId) || requestedId <= 0) return;
    const requested = positions.find((position) => (
      position.side === 'long'
      && position.market === requestedMarket
      && position.info.positionId === requestedId
    ));
    if (!requested) return;
    setMode('mint');
    setManagementAction('combined');
    setMarket(requested.market);
    setSelectedKey(positionKey(requested));
    resetTransactionContext(collateralTokensForMarket(requested.market)[0]);
  }, [positions, resetTransactionContext, reviewStage, sharedPositions.walletAddress, wallet.address]);

  useEffect(() => {
    setSelectedKey((current) => {
      // Never retarget already-entered amounts when a selected position vanishes.
      if (mode === 'mint') return current || 'new';
      return current && current !== 'new' ? current : positions[0] ? positionKey(positions[0]) : '';
    });
  }, [mode, positions]);

  useEffect(() => {
    if (mode === 'manage' && selected) setMarket(selected.market);
  }, [mode, selected]);

  useEffect(() => {
    if (!activeTokenOptions.includes(token)) setToken(activeTokenOptions[0]);
  }, [activeTokenOptions, token]);

  const planBuilder = useMemo(() => {
    if (!wallet.address) return null;
    if (!selectedActionable) return null;
    if (mode === 'mint') {
      const depositWei = parseZeroAmount(deposit, token);
      const mintWei = parseZeroAmount(mint, 'fxUSD');
      if (depositWei === null || mintWei === null || (depositWei === 0n && mintWei === 0n) || selectedKey === 'new' && depositWei === 0n) return null;
      return () => planDepositAndMint({
        market,
        positionId: selectedKey === 'new' ? 0 : selected?.info.positionId ?? 0,
        userAddress: wallet.address!,
        depositTokenAddress: tokenAddress(token),
        depositAmount: depositWei,
        mintAmount: mintWei,
      });
    }
    if (!selected) return null;
    const repayWei = repay.toLowerCase() === 'all' ? selected.info.rawDebts : parseZeroAmount(repay, 'fxUSD');
    const withdrawWei = parseZeroAmount(withdraw, token);
    if (repayWei === null || withdrawWei === null || (repayWei === 0n && withdrawWei === 0n)) return null;
    return () => planRepayAndWithdraw({
      market: selected.market,
      positionId: selected.info.positionId,
      userAddress: wallet.address!,
      repayAmount: repayWei,
      withdrawAmount: withdrawWei,
      withdrawTokenAddress: tokenAddress(token),
    });
  }, [deposit, market, mint, mode, repay, selected, selectedActionable, selectedKey, token, wallet.address, withdraw]);

  const walletAddress = wallet.address?.toLowerCase();
  const initialRead = Boolean(walletAddress)
    && (sharedPositions.walletAddress?.toLowerCase() !== walletAddress
      || (sharedPositions.status === 'loading' && sharedPositions.lastVerifiedAt === null));
  const longPoolReadUnavailable = sharedPositions.status === 'unavailable'
    || sharedPositions.failedGroups.some((group) => group.side === 'long');
  const positionReadUnavailable = Boolean(walletAddress)
    && longPoolReadUnavailable
    && positions.length === 0;
  const repayRequested = repay.trim().toLowerCase() === 'all' || (parseZeroAmount(repay, 'fxUSD') ?? 0n) > 0n;
  const withdrawalRequested = (parseZeroAmount(withdraw, token) ?? 0n) > 0n;
  const manageOperationLabel = repayRequested && withdrawalRequested
    ? 'Repay fxUSD and withdraw collateral'
    : repayRequested
      ? 'Repay fxUSD'
      : withdrawalRequested
        ? 'Withdraw collateral'
        : 'Manage debt';

  const newPosition = mode === 'mint' && selectedKey === 'new';
  const view = newPosition ? 'new' : 'positions';
  const chooseView = (next: 'new' | 'positions') => {
    setManagementAction('none');
    if (next === 'new') {
      setMode('mint'); setSelectedKey('new'); resetTransactionContext(collateralTokensForMarket(market)[0]);
      requestAnimationFrame(() => overviewHeadingRef.current?.focus({ preventScroll: true }));
    } else {
      const first = selected ?? positions[0];
      setMode('manage'); setSelectedKey(first ? positionKey(first) : '');
      if (first) setMarket(first.market);
      resetTransactionContext(collateralTokensForMarket(first?.market ?? market)[0]);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-borrow-positions-heading]')?.focus({ preventScroll: true }));
    }
  };
  const chooseManagement = (action: ManagementAction) => {
    if (!selected || selectedStale) return;
    setManagementAction(action);
    if (action !== 'combined') changeMode(action === 'add' || action === 'borrow' ? 'mint' : 'manage');
  };
  const showDeposit = newPosition || mode === 'mint' && (managementAction === 'add' || managementAction === 'combined');
  const showMint = newPosition || mode === 'mint' && (managementAction === 'borrow' || managementAction === 'combined');
  const showRepay = mode === 'manage' && (managementAction === 'repay' || managementAction === 'combined');
  const showWithdraw = mode === 'manage' && (managementAction === 'withdraw' || managementAction === 'combined');
  const existingCollateralUsd = selected ? valueUsd(selected.info.rawColls, positionCollateralDecimals(selected), selected.info.rawCollsToken) : 0n;
  const existingDebt = selected?.info.rawDebts ?? 0n;
  const depositWei = parseZeroAmount(deposit, token);
  const mintWei = parseZeroAmount(mint, 'fxUSD');
  const depositUsd = depositWei === null ? null : valueUsd(depositWei, tokenDecimals(token), token);
  const collateralAfterUsd = mode === 'mint' && existingCollateralUsd !== null && depositUsd !== null ? existingCollateralUsd + depositUsd : null;
  const capacity = debtRange && collateralAfterUsd !== null && collateralAfterUsd > 0n ? borrowCapacity({ collateralUsd: collateralAfterUsd, existingDebt, range: debtRange }) : null;
  const collateralEntered = Boolean(depositWei && depositWei > 0n) || Boolean(selected && selected.info.rawColls > 0n);
  const limitBps = debtRange ? debtRange.max * (10_000n - BORROW_LIMIT_GUARD_BPS) / 10n ** 18n : 0n;
  const debtAfter = existingDebt + (mintWei ?? 0n);
  const ltvBps = capacity && collateralAfterUsd !== null ? loanToValueBps(debtAfter, collateralAfterUsd) : null;
  // The position's loan-to-value now, against the live limit, stated as the
  // meter states them, so the review can show before → after. Verified figures
  // only: a current position, a fresh price and the pool's live range.
  const currentLtv = selected && !selectedStale && debtRange && existingCollateralUsd !== null && existingCollateralUsd > 0n && limitBps > 0n
    ? `${borrowLtvCeiling(existingDebt, existingCollateralUsd)} of ${formatBorrowBasisPoints(limitBps)} limit`
    : null;
  const reviewBefore = useMemo(() => decisionBefore && currentLtv
    ? [...decisionBefore, { label: 'Loan-to-value', value: currentLtv }]
    : decisionBefore, [currentLtv, decisionBefore]);
  // A ceiling rounds down (what may still be borrowed) and a floor rounds up
  // (what must be borrowed), so a figure shown is always safe to type.
  const fxUsdLimit = (value: bigint) => formatSignificantDecimal(formatUnits(value, 18), 4);
  const fxUsdMinimum = (value: bigint) => formatSignificantDecimalUp(formatUnits(value, 18), 4);
  const symbol = tokenSymbol(token);
  const mintBlocker = (): string | null => {
    if (showDeposit) {
      const depositIssue = amountBlocker(deposit, tokenDecimals(token), symbol, balanceStateFor(token), { emptyLabel: `No ${symbol} available`, optional: !newPosition && showMint });
      if (depositIssue === 'Enter an amount') { if (newPosition) return 'Enter collateral'; }
      else if (depositIssue) return depositIssue;
    }
    if (showMint && mint.trim() && mintWei === null) return 'Enter a valid amount';
    if (newPosition && !mintWei) return 'Enter an amount to borrow';
    if (!mintWei && !depositWei) return 'Enter an amount';
    if (capacity && mintWei) {
      if (mintWei > capacity.maxAdditional) return capacity.maxAdditional > 0n ? `Borrow at most ${fxUsdLimit(capacity.maxAdditional)} fxUSD` : 'Add collateral to borrow';
      if (mintWei < capacity.minAdditional) return `Borrow at least ${fxUsdMinimum(capacity.minAdditional)} fxUSD`;
    }
    return null;
  };
  const manageBlocker = (): string | null => {
    if (!selected) return null;
    const repayAll = repay.trim().toLowerCase() === 'all';
    const repayWei = repayAll ? selected.info.rawDebts : parseZeroAmount(repay, 'fxUSD');
    const withdrawWei = parseZeroAmount(withdraw, token);
    if (repay.trim() && repayWei === null) return 'Enter a valid amount';
    if (withdraw.trim() && withdrawWei === null) return 'Enter a valid amount';
    if (!repayWei && !withdrawWei) return showRepay && !showWithdraw ? 'Enter an amount to repay' : showWithdraw && !showRepay ? 'Enter an amount to withdraw' : 'Enter an amount';
    if (repayWei && repayWei > selected.info.rawDebts) return 'Repay at most your debt';
    if (repayWei && !repayAll) {
      const repayIssue = amountBlocker(repay, 18, 'fxUSD', balanceStateFor('fxUSD'));
      if (repayIssue?.startsWith('Insufficient')) return repayIssue;
    }
    if (withdrawWei && existingCollateralUsd !== null && debtRange) {
      const withdrawableUsd = withdrawableCollateralUsd(existingCollateralUsd, selected.info.rawDebts - (repayWei ?? 0n), debtRange);
      const withdrawUsd = valueUsd(withdrawWei, tokenDecimals(token), token);
      if (withdrawUsd !== null && withdrawUsd > withdrawableUsd) {
        const withdrawableWei = tokenAmountForUsdWad(withdrawableUsd, tokenDecimals(token), limitPrice(token));
        if (withdrawableUsd === 0n || withdrawableWei === null || withdrawableWei === 0n) return 'Repay debt to withdraw';
        return `Withdraw at most ${formatSignificantDecimal(formatUnits(withdrawableWei, tokenDecimals(token)), 4)} ${symbol}`;
      }
    }
    return null;
  };
  // The collateral that can leave at current prices, after any repayment entered
  // beside it: the withdrawal hint and its blocker name the same figure.
  const withdrawLimitWei = (() => {
    if (!selected || existingCollateralUsd === null) return null;
    const repaid = repay.trim().toLowerCase() === 'all' ? selected.info.rawDebts : parseZeroAmount(repay, 'fxUSD') ?? 0n;
    const remainingDebt = selected.info.rawDebts > repaid ? selected.info.rawDebts - repaid : 0n;
    if (!debtRange) return remainingDebt === 0n ? tokenAmountForUsdWad(existingCollateralUsd, tokenDecimals(token), limitPrice(token)) : null;
    return tokenAmountForUsdWad(withdrawableCollateralUsd(existingCollateralUsd, remainingDebt, debtRange), tokenDecimals(token), limitPrice(token));
  })();
  // A BTC position has one collateral asset: the field then names it rather than offering a one-row picker.
  const picker = activeTokenOptions.length > 1 ? <TokenSelect compact label={mode === 'manage' ? 'Receive collateral as' : 'Collateral asset'} value={token}
    options={activeTokenOptions} onChange={changeToken} balances={wallet.address ? balanceSnapshot.balances : undefined}
    balanceStatus={wallet.address ? balanceStatus : 'disconnected'} /> : undefined;
  const collateralBalance = balanceStateFor(token);
  const emptyCollateral = wallet.address && showDeposit && collateralBalance?.status === 'ready' && Number(collateralBalance.amount) === 0;
  const showPositionEstimate = mode === 'mint' && mintWei !== null && depositWei !== null && !selectedStale && (newPosition || Boolean(selected)) && (mintWei > 0n || depositWei > 0n);
  const repayPreviewWei = repay.trim().toLowerCase() === 'all' ? existingDebt : parseZeroAmount(repay, 'fxUSD');
  const withdrawPreviewWei = parseZeroAmount(withdraw, token);
  const showManageEstimate = mode === 'manage' && selected && !selectedStale
    && repayPreviewWei !== null && repayPreviewWei <= existingDebt && withdrawPreviewWei !== null
    && (repayPreviewWei > 0n || withdrawPreviewWei > 0n);
  const previousLtv = newPosition ? 'No position' : existingCollateralUsd !== null && existingCollateralUsd > 0n
    ? borrowLtvCeiling(existingDebt, existingCollateralUsd) : null;
  const actionTitle = managementAction === 'combined'
    ? mode === 'mint' ? 'Add collateral and borrow' : 'Repay and withdraw'
    : managementAction === 'add' ? 'Add collateral'
      : managementAction === 'borrow' ? 'Borrow more'
        : managementAction === 'repay' ? 'Repay debt' : 'Withdraw collateral';
  const actionEditor = <div className={presentation.editor}>
    {!newPosition && <h2 className="sr-only">{actionTitle}</h2>}
    {/* Collateral first: the borrowing limit below is computed from it. */}
    {showDeposit && <AmountField compact label={newPosition ? 'Collateral' : 'Collateral to add'} symbol={token} value={deposit}
      onChange={(value) => { cancelNativeMax(); setDeposit(value); }} allowZero maxDecimals={tokenDecimals(token)}
      balanceState={balanceStateFor(token)} tokenSelector={picker} showPercentages={newPosition}
      maxAmount={token === 'ETH' ? null : undefined} onMax={token === 'ETH' ? nativeMax.resolveMax : undefined}
      maxPending={token === 'ETH' && nativeMax.pending} constraintError={token === 'ETH' ? nativeMax.error : undefined} />}
    {showMint && <AmountField compact label={newPosition ? 'fxUSD to borrow' : 'Additional fxUSD to borrow'} symbol="fxUSD" value={mint}
      onChange={setMint} allowZero maxDecimals={18} showPercentages={false} showMax={Boolean(capacity && capacity.maxAdditional > 0n)}
      maxLabel="Use borrowing maximum"
      maxAmount={capacity && capacity.maxAdditional > 0n ? formatUnits(borrowMaximumPreset(capacity.maxAdditional, capacity.minAdditional), 18) : null}
      hint={capacity ? (capacity.maxAdditional > 0n ? `Up to ${fxUsdLimit(capacity.maxAdditional)} fxUSD with this collateral` : 'This collateral cannot borrow more')
        : !debtRange ? limitPending ? 'Checking the live borrowing limit' : 'Live borrowing limit unavailable'
        : collateralEntered ? 'Your limit shows once prices are available'
        : newPosition ? 'Enter collateral above to see your limit' : undefined} />}
    {showRepay && <AmountField compact label="Repay amount" symbol="fxUSD" value={repay} onChange={setRepay} allowAll allowZero maxDecimals={18}
      balanceState={balanceStateFor('fxUSD')} showPercentages={false} hint={selected ? `Debt: ${formatReviewFactValue({ label: 'Debt', value: formatPositionDebt(selected) }).display}` : undefined} />}
    {showWithdraw && <AmountField compact label="Collateral to withdraw" symbol={token} value={withdraw} onChange={setWithdraw}
      allowZero maxDecimals={tokenDecimals(token)} showMax={false} showPercentages={false} tokenSelector={picker}
      hint={withdrawLimitWei === null ? !debtRange ? limitPending ? 'Checking the live borrowing limit' : 'Live borrowing limit unavailable' : 'Your limit shows once prices are available'
        : withdrawLimitWei > 0n ? `Up to ${formatSignificantDecimal(formatUnits(withdrawLimitWei, tokenDecimals(token)), 4)} ${symbol} at current prices`
        : 'Repay debt to withdraw collateral'} />}
    {!newPosition && !debtRange && !limitPending && (showMint || showWithdraw) && <div className={presentation.helper}>{retryLimit}</div>}
    {showPositionEstimate && <section className={presentation.outcome} aria-label="Estimated borrowing outcome">
      <div className={presentation.outcomeHeading}><span>Current → estimated</span></div>
      <dl className={presentation.outcomeRows}>
        <div><dt>Total debt</dt><dd><span><ReviewFactValue fact={{ label: 'Current debt', value: `${positionTokenPresentation(existingDebt, 18).text} fxUSD` }} /></span><span aria-hidden="true"> → </span><strong><ReviewFactValue fact={{ label: 'Estimated debt', value: `${positionTokenPresentation(debtAfter, 18).text} fxUSD` }} /></strong></dd></div>
      </dl>
      {ltvBps !== null && collateralAfterUsd !== null && limitBps > 0n && debtRange && <BorrowLimitMeter debt={debtAfter} collateralUsd={collateralAfterUsd} limitBps={limitBps} before={previousLtv} />}
    </section>}
    {showManageEstimate && <section className={presentation.outcome} aria-label="Estimated position changes">
      <div className={presentation.outcomeHeading}><span>Current → estimated</span></div>
      <dl className={presentation.outcomeRows}>
        <div><dt>Total debt</dt><dd><span><ReviewFactValue fact={{ label: 'Current debt', value: `${positionTokenPresentation(existingDebt, 18).text} fxUSD` }} /></span><span aria-hidden="true"> → </span><strong><ReviewFactValue fact={{ label: 'Estimated debt', value: `${positionTokenPresentation(existingDebt - repayPreviewWei!, 18).text} fxUSD` }} /></strong></dd></div>
        {withdrawPreviewWei! > 0n && <div><dt>Receive asset</dt><dd>{symbol}</dd></div>}
      </dl>
    </section>}
    {emptyCollateral && <p className={presentation.fundingHint}>Add {symbol} to your wallet to supply collateral. <Link href="/qr">Receive {symbol}</Link></p>}
    {withdrawalRequested && <p className={presentation.helper}>Withdrawing collateral can increase liquidation risk.</p>}
    {!newPosition && managementAction !== 'combined' && <button type="button" className={presentation.combined} onClick={() => setManagementAction('combined')}>
      {mode === 'mint' ? 'Add collateral and borrow together' : 'Repay and withdraw together'}
    </button>}
  </div>;
  const inputStage = isReviewInputStage(reviewStage);
  const showAction = newPosition || Boolean(selected && managementAction !== 'none') || !inputStage;
  const reviewBlocker = !wallet.address || !showAction ? null : mode === 'mint' ? mintBlocker() : manageBlocker();
  const reviewLabel = mode === 'mint' ? 'Review borrowing' : repayRequested && !withdrawalRequested ? 'Review repayment' : 'Review position changes';
  if (inputStage && selected) managerSnapshotRef.current = selected;
  const managerPosition = inputStage ? selected : managerSnapshotRef.current ?? selected;
  const managerOpen = view === 'positions' && Boolean(managerPosition) && (managementAction !== 'none' || !inputStage);
  const closeManager = () => {
    if (reviewStage === 'executing') return;
    setManagementAction('none');
    resetTransactionContext(token);
  };
  const review = showAction && <div data-flow-stage={reviewStage} className={presentation.action}>
    <ActionReview key={reviewRevision} surface="content" planBuilder={newPosition || !initialRead && !positionReadUnavailable ? planBuilder : null}
      blocker={reviewBlocker} label={reviewLabel} operationLabel={mode === 'mint' ? selected ? 'Update collateral position' : 'Open collateral position' : manageOperationLabel}
      draftActionKey={draftActionKey} draftResumePath="/borrow" draftState={draftState} resumeReview={resumeReview}
      decisionBefore={reviewBefore} editor={actionEditor} onStageChange={setReviewStage} onComplete={refreshAfterAction}
      confirmedPosition={confirmedPosition} onReturnToPosition={({ key }) => {
        // Return within Borrow, preserving the position identity, not the old quote.
        const latest = positions.find(position => positionKey(position) === key);
        if (latest) { changePosition(key); return; }
        setMode('manage'); setSelectedKey(key); setManagementAction('none'); resetTransactionContext(token);
        void refreshPositions();
      }} />
  </div>;

  return <AppShell>
    <ActionWorkspace className={presentation.workspace} data-view={view}>
      {view === 'new' && <PageHeading title="Borrow" />}
      <ConfirmedPositionCards />
      {view === 'positions' ? <>
        <PositionsPageHeader product="Borrow" onReturn={() => chooseView('new')} />
        <section className={presentation.positionsContent} data-testid="borrow-workspace-card" aria-label="Your borrowing positions">
          {wallet.address && !initialRead && !positionReadUnavailable && positions.length > 0 && <>
            <div className={presentation.positionsToolbar}><h2>Open positions <span>{positions.length}</span></h2>
              <button type="button" aria-label="Refresh borrowing positions" disabled={sharedPositions.refreshing} onClick={() => void refreshPositions()}><RefreshCw size={17} aria-hidden="true" /></button>
            </div>
            <ProtocolPositionNotice status={sharedPositions.status} failedGroups={sharedPositions.failedGroups} hasPositions refreshing={sharedPositions.refreshing} onRefresh={() => void refreshPositions()} compact />
          </>}
          {!wallet.address ? <BorrowPositionsState kind="disconnected"><ConnectWalletButton className="button button-primary">Connect wallet</ConnectWalletButton></BorrowPositionsState>
            : initialRead ? <BorrowPositionsState kind="loading" />
              : positionReadUnavailable ? <BorrowPositionsState kind="unavailable" refreshing={sharedPositions.refreshing} onRetry={() => void refreshPositions()} />
                : positions.length === 0 ? <BorrowPositionsState kind="empty"><button type="button" className="button button-primary" onClick={() => chooseView('new')}>Start borrowing</button></BorrowPositionsState>
                  : <div className={presentation.positionGrid}>
                    {positions.map(position => <BorrowPositionCard key={positionKey(position)} position={position} stale={positionIsStale(position, sharedPositions.failedGroups)} onOpen={trigger => { managerTriggerRef.current = trigger; changePosition(positionKey(position)); }} />)}
                  </div>}
          {!selected && selectedKey && positions.length > 0 && !initialRead && !positionReadUnavailable && <StatusNotice title="Choose a current position">The selected position is no longer available. Choose another position to manage.</StatusNotice>}
        </section>
        {managerOpen && managerPosition && <BorrowPositionManager position={managerPosition} stale={selectedStale} inputStage={inputStage} locked={reviewStage === 'executing'} triggerRef={managerTriggerRef} onClose={closeManager}>
          {inputStage && <div className={presentation.management} role="group" aria-label="Manage collateral position">
            {([{ value: 'add', label: 'Add collateral', short: 'Add' }, { value: 'borrow', label: 'Borrow more', short: 'Borrow' }, { value: 'repay', label: 'Repay debt', short: 'Repay' }, { value: 'withdraw', label: 'Withdraw collateral', short: 'Withdraw' }] as const).map(action =>
              <button key={action.value} type="button" aria-label={action.label} aria-pressed={managementAction === action.value} disabled={selectedStale || initialRead} onClick={() => chooseManagement(action.value)}>{action.short}</button>)}
          </div>}
          {inputStage && selectedStale && <StatusNotice title="Refresh this position to continue" action={<button type="button" disabled={sharedPositions.refreshing} onClick={() => void refreshPositions()}>Refresh</button>}>The latest collateral and debt could not be verified.</StatusNotice>}
          {review}
        </BorrowPositionManager>}
      </> : <>
      <div className={presentation.layout} data-review={!inputStage}>
      {inputStage && <section className={presentation.overview} aria-label="fxUSD borrowing overview">
        <div className={presentation.vaultIdentity}>
          <TokenIcon symbol="fxUSD" size={48} />
          <div><h2 ref={overviewHeadingRef} tabIndex={-1}>Borrow fxUSD</h2><p>ETH or BTC collateral</p></div>
          <span className={presentation.network}><ChainIcon chainId={1} size={16} />Ethereum</span>
        </div>
        <dl className={presentation.metrics}>
          <div><dt><MetricLabel minimalHelp label="Funding status" definition="borrowRate" help={fundingDisplay?.title ?? (funding.status !== 'loading' ? <>The current funding rate could not be verified. <a href="https://fx.aladdin.club/v2/fxmint" target="_blank" rel="noopener noreferrer">View funding on f(x)<span className="sr-only"> (opens in a new tab)</span></a>.</> : undefined)} /></dt><dd className={fundingDisplay ? presentation.fundingValue : presentation.rateUnavailable}>{fundingDisplay?.value ?? '—'}</dd><small role="status">{fundingDisplay ? `${fundingDisplay.status}${funding.rate?.netRatio === undefined ? ' · Gross charge' : ''}` : funding.status === 'loading' ? 'Checking rate' : 'Not quoted'}</small></div>
          <div><dt><MetricLabel minimalHelp label="Pool maximum LTV" help="The protocol ceiling is not the form’s borrowing limit. The form reserves a buffer for the SDK range and display-price differences; the reviewed route and simulation determine whether the action can proceed." /></dt><dd>{debtRange ? `${(Number(debtRange.max / 10n ** 15n) / 10).toFixed(1)}%` : '—'}</dd>{!debtRange && <><small role="status">{limitPending ? 'Checking live limit' : 'Live limit unavailable'}</small>{!limitPending && retryLimit}</>}</div>
        </dl>
      </section>}
      <ProductSurface className={presentation.card} data-testid="borrow-workspace-card">
      {inputStage && <div className={presentation.viewTabs}>
        <Segmented value={view} onChange={chooseView} ariaLabel="Borrow workspace" options={[
          { value: 'new', label: 'New position' }, { value: 'positions', label: 'Your positions' },
        ]} />
        <TransactionSettings scope="Borrow" />
      </div>}
      {review}
      </ProductSurface>
      {/* A limit, so rounded down to the tenth of a percent. */}
      {inputStage && <div className={presentation.details}>
        <BorrowFundingHistory market={limitMarket} rate={funding.rate} status={funding.status} />
        {ltvBps !== null && collateralAfterUsd !== null && debtAfter > 0n && limitBps > 0n && <BorrowSensitivity debt={debtAfter} collateralUsd={collateralAfterUsd} limitBps={limitBps} />}
        <BorrowSections ltvLimit={debtRange ? `${(Number(debtRange.max / 10n ** 15n) / 10).toFixed(1)}%` : 'Unavailable'} />
      </div>}
      </div>
      </>}
    </ActionWorkspace>
  </AppShell>;
}

/** Loan-to-value against the borrowing limit, filling toward it as the borrow grows. */
function BorrowLimitMeter({ debt, collateralUsd, limitBps, before }: { debt: bigint; collateralUsd: bigint; limitBps: bigint; before?: string | null }) {
  const ltvBps = debt * 10_000n / collateralUsd;
  const used = Number(ltvBps * 1000n / limitBps) / 10;
  const tone = used > 100 ? 'over' : used >= 85 ? 'near' : 'ok';
  const ltvLabel = borrowLtvCeiling(debt, collateralUsd);
  const limitLabel = formatBorrowBasisPoints(limitBps);
  return <div className={presentation.limitMeter} data-tone={tone}>
    <div className={presentation.limitMeterRow}>
      <MetricLabel label="Loan-to-value" definition="loanToValue" />
      <strong>{before && <><small>{before}</small><span aria-hidden="true"> → </span></>}{ltvLabel}</strong>
    </div>
    <div className={presentation.limitCaption}><MetricLabel label="Borrowing limit" help="This is lower than the pool maximum because the form reserves a safety buffer. It uses display prices, not a guaranteed borrowing quote; the route is checked again before signing." /><span>{limitLabel}</span></div>
    <div className={presentation.limitTrack} role="meter" aria-label="Loan-to-value against the borrowing limit"
      aria-valuemin={0} aria-valuemax={Number(limitBps) / 100} aria-valuenow={Math.min(Number(ltvBps), Number(limitBps)) / 100} aria-valuetext={`${ltvLabel} of a ${limitLabel} limit`}>
      <span style={{ '--fill': `${Math.min(used, 100)}%` } as CSSProperties} />
    </div>
  </div>;
}

function formatPositionCollateral(position: UiPosition): string { return `${positionTokenPresentation(position.info.rawColls, positionCollateralDecimals(position)).text} ${positionCollateralSymbol(position)}`; }
function formatPositionDebt(position: UiPosition): string { return `${positionTokenPresentation(position.info.rawDebts, positionDebtDecimals(position)).text} ${position.info.rawDebtsToken}`; }
