'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AppShell } from '@/components/ui';
import { formatUnits } from 'viem';
import TokenIcon from '@/components/TokenIcon';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { MetricRows, PageHeading, ProductNav, ProductSurface, StatusNotice } from '@/components/ProductUI';
import { freshDisplayPrices } from '@/lib/displayPrices';
import { calculateNativeMax, nativeMaxErrorMessage } from '@/lib/fx/nativeMax';
import { fetchGasTierQuotes, selectedGasTierQuote } from '@/lib/fx/gasFeePolicy';
import { readGasTier } from '@/lib/settings';
import { estimatePlannedRouteCost } from '@/lib/fx';
import { ActionReview, type ActionReviewStage } from '@/components/ActionReview';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ProtocolPositionNotice } from '@/components/ProtocolPositionCard';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import { AmountField, Segmented, TokenSelect, useWalletTokenBalances } from '@/components/ProtocolForm';
import { useUsdPrices } from '@/components/PriceProvider';
import {
  fallbackDebtRatioRange,
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
  formatAmount,
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
import { calculatePositionUsdValuation, formatUsdCents } from '@/lib/positionValuation';
import { positionCollateralSymbol } from '@/lib/positionUnits';
import { priceKeyForSymbol } from '@/lib/prices';
import { resetTransactionAmounts } from '@/lib/transactionState';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { TransactionSettings } from '@/components/TransactionSettings';
import { BorrowSections } from '@/components/ProductSections';
import { borrowCapacity, BORROW_LIMIT_GUARD_BPS, collateralUsdWad, loanToValueBps, tokenAmountForUsdWad, withdrawableCollateralUsd } from '@/lib/fx/borrowLimits';
import { formatSignificantDecimal, formatSignificantDecimalUp, groupDigits } from '@/lib/amount';
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
    await trackConfirmedPosition(execution, route);
    await Promise.all([refreshPositions(), refreshBalances()]);
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
  const decisionBefore = useMemo(() => selected ? [
    { label: 'Collateral', value: formatPositionCollateral(selected) },
    { label: 'Debt', value: formatPositionDebt(selected) },
  ] : undefined, [selected]);
  // Borrowing limits come from the pool's own debt-ratio range (the one Trade's
  // leverage bounds use), applied to collateral at display prices with a guard.
  const limitMarket = selected?.market ?? market;
  const [debtRange, setDebtRange] = useState<DebtRatioRange>(() => fallbackDebtRatioRange('ETH', 'long'));
  useEffect(() => {
    let active = true;
    setDebtRange(fallbackDebtRatioRange(limitMarket, 'long'));
    void readDebtRatioRange(limitMarket, 'long').then((range) => { if (active) setDebtRange(range); }).catch(() => undefined);
    return () => { active = false; };
  }, [limitMarket]);
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
  }, []);

  const changeMode = useCallback((nextMode: BorrowMode) => {
    setMode(nextMode);
    resetTransactionContext(collateralTokensForMarket(market)[0]);
  }, [market, resetTransactionContext]);

  const changePosition = useCallback((nextKey: string) => {
    const next = positions.find((position) => positionKey(position) === nextKey);
    if (!next) return;
    setManagementAction('none');
    setMode('manage');
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

  const [nativeMaxPending, setNativeMaxPending] = useState(false);
  const [nativeMaxError, setNativeMaxError] = useState<string | null>(null);
  const maxRequest = useRef(0);
  const maxMounted = useRef(true);
  const maxContext = useRef('');
  const maxContextKey = JSON.stringify([wallet.address, wallet.chainId, wallet.isEmbedded, market, selectedKey, token, deposit, mint, balanceSnapshot.balances.ETH?.amount]);
  maxContext.current = maxContextKey;
  useEffect(() => { maxMounted.current = true; return () => { maxMounted.current = false; maxRequest.current += 1; }; }, []);
  useEffect(() => { maxRequest.current += 1; setNativeMaxPending(false); setNativeMaxError(null); }, [maxContextKey]);
  const resolveNativeMax = useCallback(async () => {
    const balance = balanceSnapshot.balances.ETH;
    if (token !== 'ETH' || !wallet.address || nativeMaxPending || selectedStale || selectedKey !== 'new' && !selected
      || balance?.status !== 'ready' || !balance.amount) return;
    const balanceWei = parseZeroAmount(balance.amount, 'ETH');
    const debtWei = parseZeroAmount(mint, 'fxUSD');
    if (!balanceWei || debtWei === null) return;
    const request = ++maxRequest.current;
    const context = maxContext.current;
    const current = () => maxMounted.current && request === maxRequest.current && context === maxContext.current;
    setNativeMaxPending(true); setNativeMaxError(null);
    try {
      const maximum = await calculateNativeMax({ balanceWei, initialCandidateWei: parseZeroAmount(deposit, 'ETH') ?? undefined,
        buildRoutes: async (amountWei) => {
          const route = await planDepositAndMint({ market, positionId: selectedKey === 'new' ? 0 : selected!.info.positionId,
            userAddress: wallet.address!, depositTokenAddress: tokenAddress('ETH'), depositAmount: amountWei, mintAmount: debtWei });
          return Array.isArray(route) ? route : [route];
        },
        estimateRoutes: async (routes, signal) => {
          const feeTierQuote = wallet.isEmbedded
            ? selectedGasTierQuote(await fetchGasTierQuotes(1), readGasTier())
            : undefined;
          return Promise.all(routes.map((route) => estimatePlannedRouteCost(route, { feeTierQuote, signal })));
        }, isCurrent: current,
      });
      if (!current()) return;
      setNativeMaxPending(false);
      setDeposit(formatUnits(maximum, 18));
    } catch (error) {
      if (current()) setNativeMaxError(nativeMaxErrorMessage(error));
    } finally { if (current()) setNativeMaxPending(false); }
  }, [balanceSnapshot.balances.ETH, deposit, market, mint, nativeMaxPending, selected, selectedKey, selectedStale, token, wallet.address, wallet.isEmbedded]);

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
    } else {
      const first = selected ?? positions[0];
      setMode('manage'); setSelectedKey(first ? positionKey(first) : '');
      if (first) setMarket(first.market);
      resetTransactionContext(collateralTokensForMarket(first?.market ?? market)[0]);
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
  const capacity = collateralAfterUsd !== null && collateralAfterUsd > 0n ? borrowCapacity({ collateralUsd: collateralAfterUsd, existingDebt, range: debtRange }) : null;
  const collateralEntered = Boolean(depositWei && depositWei > 0n) || Boolean(selected && selected.info.rawColls > 0n);
  const limitBps = debtRange.max * (10_000n - BORROW_LIMIT_GUARD_BPS) / 10n ** 18n;
  const debtAfter = existingDebt + (mintWei ?? 0n);
  const ltvBps = capacity && collateralAfterUsd !== null ? loanToValueBps(debtAfter, collateralAfterUsd) : null;
  // The position's loan-to-value now, against the live limit, stated as the
  // meter states them, so the review can show before → after. Verified figures
  // only: a current position, a fresh price and the pool's live range.
  const currentLtv = selected && !selectedStale && debtRange.source === 'live' && existingCollateralUsd !== null && existingCollateralUsd > 0n && limitBps > 0n
    ? `${formatTenths(loanToValueTenthsUp(existingDebt, existingCollateralUsd))} of ${formatTenths(limitBps / 10n)} limit`
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
    if (withdrawWei && existingCollateralUsd !== null) {
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
    return tokenAmountForUsdWad(withdrawableCollateralUsd(existingCollateralUsd, remainingDebt, debtRange), tokenDecimals(token), limitPrice(token));
  })();
  // A BTC position has one collateral asset: the field then names it rather than offering a one-row picker.
  const picker = activeTokenOptions.length > 1 ? <TokenSelect compact label={mode === 'manage' ? 'Receive collateral as' : 'Collateral asset'} value={token}
    options={activeTokenOptions} onChange={changeToken} balances={wallet.address ? balanceSnapshot.balances : undefined}
    balanceStatus={wallet.address ? balanceStatus : 'disconnected'} /> : undefined;
  const actionEditor = <div className={presentation.editor}>
    {!newPosition && <h2 className={presentation.formTitle}>{mode === 'mint' ? 'Add collateral or borrow' : 'Repay or withdraw'}</h2>}
    {/* Collateral first: the borrowing limit below is computed from it. */}
    {showDeposit && <AmountField label={newPosition ? 'Collateral' : 'Collateral to add'} symbol={token} value={deposit}
      onChange={(value) => { setNativeMaxError(null); setDeposit(value); }} allowZero maxDecimals={tokenDecimals(token)}
      balanceState={balanceStateFor(token)} tokenSelector={picker}
      maxAmount={token === 'ETH' ? null : undefined} onMax={token === 'ETH' ? resolveNativeMax : undefined}
      maxPending={token === 'ETH' && nativeMaxPending} constraintError={token === 'ETH' ? nativeMaxError : undefined} />}
    {showMint && <AmountField label={newPosition ? 'fxUSD to borrow' : 'Additional fxUSD to borrow'} symbol="fxUSD" value={mint}
      onChange={setMint} allowZero maxDecimals={18} showPercentages={false} showMax={Boolean(capacity && capacity.maxAdditional > 0n)}
      maxAmount={capacity && capacity.maxAdditional > 0n ? formatUnits(capacity.maxAdditional, 18) : null}
      hint={capacity ? (capacity.maxAdditional > 0n ? `Up to ${fxUsdLimit(capacity.maxAdditional)} fxUSD with this collateral` : 'This collateral cannot borrow more')
        : collateralEntered ? 'Your limit shows once prices are available'
        : newPosition ? 'Enter collateral above to see your limit' : undefined} />}
    {showRepay && <AmountField label="Repay amount" symbol="fxUSD" value={repay} onChange={setRepay} allowAll allowZero maxDecimals={18}
      balanceState={balanceStateFor('fxUSD')} hint={selected ? `Debt: ${formatPositionDebt(selected)}` : undefined} />}
    {showWithdraw && <AmountField label="Collateral to withdraw" symbol={token} value={withdraw} onChange={setWithdraw}
      allowZero maxDecimals={tokenDecimals(token)} showMax={false} showPercentages={false} tokenSelector={picker}
      hint={withdrawLimitWei === null ? 'Your limit shows once prices are available'
        : withdrawLimitWei > 0n ? `Up to ${formatSignificantDecimal(formatUnits(withdrawLimitWei, tokenDecimals(token)), 4)} ${symbol} at current prices`
        : 'Repay debt to withdraw collateral'} />}
    {mode === 'mint' && ltvBps !== null && collateralAfterUsd !== null && limitBps > 0n && <BorrowLimitMeter debt={debtAfter} collateralUsd={collateralAfterUsd} limitBps={limitBps} />}
    {withdrawalRequested && <p className={presentation.helper}>Withdrawing collateral can increase liquidation risk.</p>}
    {!newPosition && managementAction !== 'combined' && <button type="button" className={presentation.combined} onClick={() => setManagementAction('combined')}>
      {mode === 'mint' ? 'Add collateral and borrow together' : 'Repay and withdraw together'}
    </button>}
  </div>;
  const showAction = newPosition || Boolean(selected && managementAction !== 'none') || reviewStage !== 'input';
  const reviewBlocker = !wallet.address || !showAction ? null : mode === 'mint' ? mintBlocker() : manageBlocker();
  const reviewLabel = mode === 'mint' ? 'Review borrowing' : repayRequested && !withdrawalRequested ? 'Review repayment' : 'Review position changes';

  return <AppShell>
    <ActionWorkspace className={presentation.workspace}>
      <PageHeading title="Borrow" />
      {reviewStage === 'input' && <ProductNav current="borrow" />}
      <ConfirmedPositionCards />
      <div className={presentation.layout} data-review={reviewStage !== 'input'}>
      {reviewStage === 'input' && <section className={presentation.overview} aria-label="fxUSD borrowing overview">
        <div className={presentation.vaultIdentity}>
          <TokenIcon symbol="fxUSD" size={36} />
          <div><h2>fxUSD</h2><p>Ethereum</p></div>
        </div>
        <dl className={presentation.metrics}>
          <div><dt>Maximum LTV</dt><dd>{debtRange.source === 'live' ? `${(Number(debtRange.max / 10n ** 15n) / 10).toFixed(1)}%` : '—'}</dd><small>{debtRange.source === 'live' ? 'Pool limit' : 'Live limit unavailable'}</small></div>
          <div><dt>Annual interest</dt><dd>0%</dd><small>Normal conditions · fees apply</small></div>
        </dl>
        <p className={presentation.riskNote}>Borrow against ETH or BTC. Keep collateral above the required limit to reduce liquidation risk.</p>
      </section>}
      <ProductSurface className={presentation.card} data-testid="borrow-workspace-card">
      {reviewStage === 'input' && <div className={presentation.viewTabs}>
        <Segmented value={view} onChange={chooseView} ariaLabel="Borrow workspace" options={[
          { value: 'new', label: 'New position' }, { value: 'positions', label: 'Your positions' },
        ]} />
        <TransactionSettings />
      </div>}
      {view === 'positions' && wallet.address && initialRead && <StatusNotice>Reading your collateral positions…</StatusNotice>}
      {view === 'positions' && wallet.address && !initialRead && positionReadUnavailable && <ProtocolPositionNotice status="unavailable"
        failedGroups={sharedPositions.failedGroups} hasPositions={false} refreshing={sharedPositions.refreshing}
        onRefresh={() => void refreshPositions()} compact />}
      {view === 'positions' && wallet.address && !initialRead && !positionReadUnavailable && <ProtocolPositionNotice status={sharedPositions.status}
        failedGroups={sharedPositions.failedGroups} hasPositions={positions.length > 0} refreshing={sharedPositions.refreshing} onRefresh={() => void refreshPositions()} compact />}
      {view === 'positions' && reviewStage === 'input' && <>
        {!wallet.address ? <div className={presentation.empty}><p className={presentation.helper}>Connect the wallet that holds your collateral position.</p><ConnectWalletButton className="button button-primary mt-2 w-full">Connect wallet</ConnectWalletButton></div>
          : !initialRead && !positionReadUnavailable && positions.length === 0 ? <div className={presentation.empty}>
            <h2>No borrowing positions</h2><p className={presentation.helper}>Open an ETH or BTC collateral position to borrow fxUSD.</p>
            <button type="button" className="button button-primary" onClick={() => chooseView('new')}>Start borrowing</button>
          </div> : selected ? <div className={presentation.position}>
            {positions.length > 1 && <PositionSelect value={selectedKey} positions={positions} onChange={changePosition} />}
            <PositionSummary position={selected} />
            <div className={presentation.management} role="group" aria-label="Manage collateral position">
              {([{ value: 'add', label: 'Add collateral' }, { value: 'borrow', label: 'Borrow more' }, { value: 'repay', label: 'Repay debt' }, { value: 'withdraw', label: 'Withdraw collateral' }] as const).map((action) =>
                <button key={action.value} type="button" aria-pressed={managementAction === action.value} disabled={selectedStale || initialRead}
                  onClick={() => chooseManagement(action.value)}>{action.label}</button>)}
            </div>
          </div> : !initialRead && !positionReadUnavailable ? <StatusNotice title="Choose a current position" tone="warning">The selected position is no longer available. Choose New position to start another one.</StatusNotice> : null}
      </>}
      {showAction && <div data-flow-stage={reviewStage} className={presentation.action}>
        <ActionReview key={reviewRevision} surface="content" planBuilder={newPosition || !initialRead && !positionReadUnavailable ? planBuilder : null}
          blocker={reviewBlocker} label={reviewLabel} operationLabel={mode === 'mint' ? selected ? 'Update collateral position' : 'Open collateral position' : manageOperationLabel}
          draftActionKey={draftActionKey} draftResumePath="/borrow" draftState={draftState} resumeReview={resumeReview}
          decisionBefore={reviewBefore} editor={actionEditor} onStageChange={setReviewStage} onComplete={refreshAfterAction} />
      </div>}
      </ProductSurface>
      {/* A limit, so rounded down to the tenth of a percent. */}
      {reviewStage === 'input' && <div className={presentation.details}><BorrowSections ltvLimit={debtRange.source === 'live' ? `${(Number(debtRange.max / 10n ** 15n) / 10).toFixed(1)}%` : 'Unavailable'} /></div>}
      </div>
    </ActionWorkspace>
  </AppShell>;
}

/** Loan-to-value in tenths of a percent, rounded up: a risk figure never reads lower than it is. */
function loanToValueTenthsUp(debt: bigint, collateralUsd: bigint): bigint { return (debt * 1000n + collateralUsd - 1n) / collateralUsd; }
function formatTenths(tenths: bigint): string { return `${(Number(tenths) / 10).toFixed(1)}%`; }

/** Loan-to-value against the borrowing limit, filling toward it as the borrow grows. */
function BorrowLimitMeter({ debt, collateralUsd, limitBps }: { debt: bigint; collateralUsd: bigint; limitBps: bigint }) {
  const ltvBps = debt * 10_000n / collateralUsd;
  const used = Number(ltvBps * 1000n / limitBps) / 10;
  const tone = used > 100 ? 'over' : used >= 85 ? 'near' : 'ok';
  // In tenths of a percent: the loan-to-value rounds up and the limit down, so
  // the room the meter shows is never more than the room there is.
  const ltvTenths = loanToValueTenthsUp(debt, collateralUsd);
  const limitTenths = limitBps / 10n;
  const percent = formatTenths;
  return <div className={presentation.limitMeter} data-tone={tone}>
    <div className={presentation.limitMeterRow}>
      <span>Loan-to-value</span>
      <strong>{percent(ltvTenths)}<small> of {percent(limitTenths)} limit</small></strong>
    </div>
    <div className={presentation.limitTrack} role="meter" aria-label="Loan-to-value against the borrowing limit"
      aria-valuemin={0} aria-valuemax={Number(limitBps) / 100} aria-valuenow={Math.min(Number(ltvBps), Number(limitBps)) / 100} aria-valuetext={`${percent(ltvTenths)} of a ${percent(limitTenths)} limit`}>
      <span style={{ '--fill': `${Math.min(used, 100)}%` } as CSSProperties} />
    </div>
  </div>;
}

function PositionSelect({ value, positions, onChange }: { value: string; positions: UiPosition[]; onChange: (value: string) => void }) {
  return <label className={presentation.positionSelect}>
    <span>Collateral position</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {positions.map((position) => <option key={positionKey(position)} value={positionKey(position)}>
        {position.market} position #{position.info.positionId} · {formatPositionDebt(position)} debt
      </option>)}
    </select>
  </label>;
}
function PositionSummary({ position }: { position: UiPosition }) {
  const snapshot = useUsdPrices();
  const prices = freshDisplayPrices(snapshot);
  const collateralKey = priceKeyForSymbol(position.info.rawCollsToken);
  const debtKey = priceKeyForSymbol(position.info.rawDebtsToken);
  const valuation = calculatePositionUsdValuation({ collateralRaw: position.info.rawColls, collateralDecimals: positionCollateralDecimals(position),
    collateralPrice: collateralKey ? prices[collateralKey] : undefined, debtRaw: position.info.rawDebts, debtDecimals: positionDebtDecimals(position), debtPrice: debtKey ? prices[debtKey] : undefined });
  // Rounded up to the tenth, like the form's meter: a risk figure never reads lower than it is.
  const ltv = valuation.collateralUsdCents !== null && valuation.collateralUsdCents > 0n && valuation.debtUsdCents !== null
    ? formatTenths(loanToValueTenthsUp(valuation.debtUsdCents, valuation.collateralUsdCents)) : '—';
  return <div className={presentation.positionSummary}>
    <div className={presentation.positionIdentity}><TokenIcon symbol={position.market === 'BTC' ? 'WBTC' : 'ETH'} size={34} />
      <div><h2>{position.market} position #{position.info.positionId}</h2><p>Ethereum</p></div></div>
    <MetricRows label="Current collateral position" rows={[
      { label: 'Collateral', value: formatPositionCollateral(position), detail: valuation.collateralUsdCents !== null ? `≈ ${formatUsdCents(valuation.collateralUsdCents)}` : 'Value unavailable' },
      { label: 'Debt', value: formatPositionDebt(position), detail: valuation.debtUsdCents !== null ? `≈ ${formatUsdCents(valuation.debtUsdCents)}` : 'Value unavailable' },
      { label: 'Net position value', value: <ValueOrSkeleton value={valuation.netEquityUsdCents !== null ? formatUsdCents(valuation.netEquityUsdCents) : '—'} status={snapshot.status === 'loading' ? 'loading' : 'unavailable'} />, emphasis: true },
      { label: 'Loan-to-value', value: ltv },
    ]} />
  </div>;
}
function formatPositionCollateral(position: UiPosition): string { return `${groupDigits(formatAmount(position.info.rawColls, positionCollateralDecimals(position)))} ${positionCollateralSymbol(position)}`; }
function formatPositionDebt(position: UiPosition): string { return `${groupDigits(formatAmount(position.info.rawDebts, positionDebtDecimals(position)))} ${position.info.rawDebtsToken}`; }
