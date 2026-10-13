'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, ChevronRight, Gauge, Layers2, RefreshCw, X } from 'lucide-react';
import Link from 'next/link';
import { AppShell, Card, EmptyState } from '@/components/ui';
import { ActionReview, type ActionReviewStage } from '@/components/ActionReview';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import {
  positionIsStale,
  ProtocolPositionCard,
  ProtocolPositionDetails,
  ProtocolPositionList,
  ProtocolPositionNotice,
  ProtocolPositionSkeleton,
} from '@/components/ProtocolPositionCard';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import { AmountField, LeverageField, RangeField, Segmented, TokenSelect, tokenBalanceFor, useWalletTokenBalances, type TokenBalanceView } from '@/components/ProtocolForm';
import { leverageDebtLabel } from '@/lib/leverageShare';
import { TransactionSettings } from '@/components/TransactionSettings';
import { MAX_FX_SLIPPAGE_PERCENT, clampLeverage, leverageBoundsFor, planAdjustPositionLeverage, planIncreasePosition, planReducePosition, prepareLeverageReview, readLeverageBounds, readSignatureRequiredDraft, restoreSignatureRequiredDraftFromSearch, signatureDraftIdFromSearch, type LeverageBounds, type SignatureDraftState } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/trade-surfaces.module.css';
import { groupDigits, positiveDecimal } from '@/lib/amount';
import { positionCollateralSymbol } from '@/lib/positionUnits';
import { DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent, SETTINGS_KEY, SETTINGS_UPDATED_EVENT } from '@/lib/settings';
import { haptic } from '@/lib/telegram';
import { resetTransactionAmounts } from '@/lib/transactionState';
import {
  getSdkReductionAmountWei,
  formatAmount,
  parseAmount,
  positionKey,
  positionCollateralDecimals,
  positionDebtDecimals,
  positionInputTokenOptions,
  positionOutputTokenOptions,
  positionTargetLeverage,
  tokenAddress,
  tokenDecimals,
  type UiPosition,
  type UiToken,
} from '@/app/trade/fxUi';

type PositionAction = 'increase' | 'reduce' | 'close' | 'leverage';

function tokenForPositionAction(position: UiPosition | undefined, action: PositionAction): UiToken {
  if (!position) return 'ETH';
  const options = action === 'reduce' || action === 'close'
    ? positionOutputTokenOptions(position.market, position.side)
    : positionInputTokenOptions(position.market);
  return options[0] ?? 'ETH';
}

/** Marks a history entry this page pushed to open one position over the list. */
const POSITION_VIEW_STATE = 'fxaeonPositionView';
/** Wide screens keep the list beside the selected position (see the grid's breakpoint). */
const WIDE_LAYOUT_QUERY = '(min-width: 840px)';

function historyState(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return state && typeof state === 'object' ? { ...state as Record<string, unknown> } : {};
}

function withoutPositionView(): Record<string, unknown> {
  const state = historyState();
  delete state[POSITION_VIEW_STATE];
  return state;
}

/** Write the view to history; a document without a real URL keeps it in memory only. */
function writeHistory(mode: 'push' | 'replace', state: Record<string, unknown>, href: string): void {
  try {
    if (mode === 'push') window.history.pushState(state, '', href);
    else window.history.replaceState(state, '', href);
  } catch {
    // The view still changes; only its history entry is skipped.
  }
}

function positionViewHref(key?: string, action?: PositionAction): string {
  const query = key ? `?position=${encodeURIComponent(key)}${action && action !== 'increase' ? `&action=${encodeURIComponent(action)}` : ''}` : '';
  return `${window.location.pathname}${query}${window.location.hash}`;
}

/** The element that scrolls the page: the app shell's content area, or the document. */
function scrollRoot(): HTMLElement | null {
  const content = document.querySelector<HTMLElement>('[data-shell-content]');
  if (content && /(auto|scroll)/.test(getComputedStyle(content).overflowY)) return content;
  return document.scrollingElement as HTMLElement | null;
}

/**
 * Swap between the list and one position. A view transition carries the
 * tapped row into the position's details where supported and motion is
 * welcome; otherwise the views simply swap.
 */
function swapPositionView(update: () => void, finish?: () => void): void {
  const doc = document as Document & { startViewTransition?: (callback: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    finish?.();
    return;
  }
  const transition = doc.startViewTransition(() => { flushSync(update); });
  void transition.finished.catch(() => undefined).finally(() => finish?.());
}

function positionRow(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-position-key="${CSS.escape(key)}"]`);
}

export default function PositionsPage() {
  const wallet = usePrivyWallet();
  const positionState = useProtocolPositions();
  const positions = positionState.positions;
  const [selectedKey, setSelectedKey] = useState('');
  const [action, setAction] = useState<PositionAction>('increase');
  const [token, setToken] = useState<UiToken>('ETH');
  const [amount, setAmount] = useState('');
  const [fraction, setFraction] = useState(25);
  const [leverage, setLeverage] = useState(2);
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PERCENT));
  const [leverageBounds, setLeverageBounds] = useState<LeverageBounds>(() => leverageBoundsFor('ETH', 'long'));
  const [reviewRevision, setReviewRevision] = useState(0);
  const [resumeReview, setResumeReview] = useState(0);
  const [reviewStage, setReviewStage] = useState<ActionReviewStage>('input');
  const [reviewPosition, setReviewPosition] = useState<UiPosition | null>(null);
  // On phones the page shows the list or one position. `?position=` names the
  // open one, so links, refreshes, browser Back and Telegram Back agree.
  const [positionViewOpen, setPositionViewOpen] = useState(false);
  const positionViewOpenRef = useRef(false);
  positionViewOpenRef.current = positionViewOpen;
  const listScrollRef = useRef(0);
  const managerRef = useRef<HTMLElement>(null);
  const handledDeepLinkRef = useRef('');
  const previousWalletContextRef = useRef<string | null>(null);
  const lastConnectedWalletRef = useRef<string | null>(null);
  const lastConnectedChainRef = useRef<number | undefined>(undefined);
  const restoredDraftRef = useRef<string | null>(null);
  const pendingRestoredInputsRef = useRef<{ positionKey: string; token?: UiToken; leverage?: number } | null>(null);
  const walletBalances = useWalletTokenBalances(wallet.address, 1);
  const balanceStatus = walletBalances.status === 'idle' ? 'loading' as const : walletBalances.status;
  const tokenBalanceProps = wallet.address ? { balances: walletBalances.balances, balanceStatus } : {};
  const selectedTokenBalance: TokenBalanceView | undefined = wallet.address
    ? tokenBalanceFor(walletBalances.balances, token) ?? { status: balanceStatus === 'ready' ? 'unavailable' : balanceStatus }
    : undefined;

  // Keep unsigned recovery snapshots limited to editable primitive fields.
  // ActionReview stores this alongside the local signature-required hint; it
  // never contains calldata, quotes, nonces, or a prepared route.
  const draftState = useMemo<SignatureDraftState>(() => ({
    positionKey: selectedKey,
    action,
    token,
    amount,
    fraction: String(fraction),
    leverage: String(leverage),
    slippage,
  }), [action, amount, fraction, leverage, selectedKey, slippage, token]);

  const resetTransactionContext = useCallback((nextAction: PositionAction = 'increase', nextToken: UiToken = 'ETH') => {
    const defaults = resetTransactionAmounts();
    setAction(nextAction);
    setToken(nextToken);
    setAmount(defaults.amount);
    setFraction(nextAction === 'close' ? 100 : defaults.fraction);
    setLeverage(defaults.leverage);
    setReviewStage('input');
    setReviewPosition(null);
    // Remounting the review state machine immediately discards a prepared
    // route, including a route that was just displayed in the review sheet.
    setReviewRevision((revision) => revision + 1);
  }, []);

  const deepLinkKeyFor = useCallback((key: string, nextAction: PositionAction) => (
    `${wallet.address?.toLowerCase() ?? ''}:${wallet.chainId ?? ''}:${key}:${nextAction}`
  ), [wallet.address, wallet.chainId]);

  /** Tap a row: on phones the position replaces the list (one history step); wide screens select it in place. */
  const openPosition = useCallback((key: string) => {
    const position = positions.find((item) => positionKey(item) === key);
    if (!position) return;
    haptic('selection');
    // The URL now names this position; its query must not reset the form again.
    handledDeepLinkRef.current = deepLinkKeyFor(key, 'increase');
    const select = () => {
      setSelectedKey(key);
      resetTransactionContext('increase', tokenForPositionAction(position, 'increase'));
      setPositionViewOpen(true);
    };
    if (window.matchMedia(WIDE_LAYOUT_QUERY).matches) {
      writeHistory('replace', withoutPositionView(), positionViewHref(key));
      select();
      return;
    }
    const root = scrollRoot();
    listScrollRef.current = root?.scrollTop ?? 0;
    const row = positionRow(key);
    if (row) row.style.viewTransitionName = 'position-focus';
    swapPositionView(() => {
      writeHistory('push', { ...historyState(), [POSITION_VIEW_STATE]: key }, positionViewHref(key));
      select();
      if (row) row.style.viewTransitionName = '';
      root?.scrollTo({ top: 0 });
    });
  }, [deepLinkKeyFor, positions, resetTransactionContext]);

  /** Back to the list, where the list was left. */
  const showPositionList = useCallback((fromKey?: string) => {
    const restore = listScrollRef.current;
    let row: HTMLElement | null = null;
    swapPositionView(() => {
      setPositionViewOpen(false);
      row = fromKey ? positionRow(fromKey) : null;
      if (row) row.style.viewTransitionName = 'position-focus';
      scrollRoot()?.scrollTo({ top: restore });
    }, () => { if (row) row.style.viewTransitionName = ''; });
  }, []);

  const closePosition = useCallback(() => {
    // A position opened from the list goes back one step; one reached by a
    // link replaces its entry, so Back still leaves for the page before.
    if (historyState()[POSITION_VIEW_STATE]) {
      window.history.back();
      return;
    }
    writeHistory('replace', withoutPositionView(), positionViewHref());
    showPositionList(selectedKey);
  }, [selectedKey, showPositionList]);

  const changeAction = useCallback((nextAction: PositionAction) => {
    const position = positions.find((item) => positionKey(item) === selectedKey);
    resetTransactionContext(nextAction, tokenForPositionAction(position, nextAction));
  }, [positions, resetTransactionContext, selectedKey]);

  const changeToken = useCallback((nextToken: UiToken) => {
    setToken(nextToken);
    setAmount('');
    setReviewRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    const context = `${wallet.address?.toLowerCase() ?? ''}:${wallet.chainId ?? ''}`;
    const previous = previousWalletContextRef.current;
    const currentAddress = wallet.address?.toLowerCase() ?? null;
    const walletChanged = Boolean(lastConnectedWalletRef.current)
      && lastConnectedWalletRef.current !== currentAddress;
    const chainChanged = wallet.chainId !== undefined
      && lastConnectedChainRef.current !== undefined
      && lastConnectedChainRef.current !== wallet.chainId;
    const preserveSubmittedResult = reviewStage === 'executing' || reviewStage === 'result';
    if (previous !== null && previous !== context && (walletChanged || chainChanged) && !preserveSubmittedResult) {
      setSelectedKey('');
      resetTransactionContext();
      // Another wallet's positions start from their list.
      if (new URLSearchParams(window.location.search).has('position')) {
        writeHistory('replace', withoutPositionView(), positionViewHref());
      }
      setPositionViewOpen(false);
    }
    if (previous !== null && previous !== context && (walletChanged || chainChanged) && preserveSubmittedResult) return;
    previousWalletContextRef.current = context;
    if (currentAddress) lastConnectedWalletRef.current = currentAddress;
    if (wallet.chainId !== undefined) lastConnectedChainRef.current = wallet.chainId;
  }, [resetTransactionContext, reviewStage, wallet.address, wallet.chainId]);

  useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      if (event.type === 'storage' && (event as StorageEvent).key !== SETTINGS_KEY) return;
      setSlippage(String(readSlippagePercent()));
    };
    window.addEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
    window.addEventListener('storage', onSettingsUpdated);
    return () => { window.removeEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated); window.removeEventListener('storage', onSettingsUpdated); };
  }, []);

  useEffect(() => {
    setSlippage(String(readSlippagePercent()));
  }, []);
  useEffect(() => {
    setSelectedKey((current) => current && positions.some((position) => positionKey(position) === current)
      ? current
      : positions[0] ? positionKey(positions[0]) : '');
  }, [positions]);

  // Trade and portfolio rows open their position here. Keep this query-driven
  // so browser refreshes and shared links behave like an in-app selection.
  useEffect(() => {
    if (reviewStage === 'executing' || reviewStage === 'result') return;
    if (typeof window === 'undefined' || !positions.length) return;
    const params = new URLSearchParams(window.location.search);
    const key = params.get('position');
    const linkedPosition = positions.find((position) => positionKey(position) === key);
    if (!key || !linkedPosition) return;
    const requestedAction = params.get('action');
    const nextAction: PositionAction = requestedAction === 'close' || requestedAction === 'reduce' || requestedAction === 'leverage'
      ? requestedAction
      : 'increase';
    const deepLinkKey = deepLinkKeyFor(key, nextAction);
    if (handledDeepLinkRef.current === deepLinkKey) return;
    handledDeepLinkRef.current = deepLinkKey;
    setSelectedKey(key);
    resetTransactionContext(nextAction, tokenForPositionAction(linkedPosition, nextAction));
    setPositionViewOpen(true);
  }, [deepLinkKeyFor, positions, resetTransactionContext, reviewStage]);

  // Browser Back and Forward move between the list and a position.
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const selectedKeyRef = useRef(selectedKey);
  selectedKeyRef.current = selectedKey;
  const reviewStageRef = useRef(reviewStage);
  reviewStageRef.current = reviewStage;
  useEffect(() => {
    const onPopState = () => {
      // A submitted transaction keeps its status in place whatever the history does.
      if (reviewStageRef.current === 'executing' || reviewStageRef.current === 'result') return;
      const key = new URLSearchParams(window.location.search).get('position');
      const position = key ? positionsRef.current.find((item) => positionKey(item) === key) : undefined;
      if (key && position) {
        if (positionViewOpenRef.current && selectedKeyRef.current === key) return;
        const root = scrollRoot();
        listScrollRef.current = root?.scrollTop ?? listScrollRef.current;
        swapPositionView(() => {
          if (selectedKeyRef.current !== key) {
            setSelectedKey(key);
            resetTransactionContext('increase', tokenForPositionAction(position, 'increase'));
          }
          setPositionViewOpen(true);
          root?.scrollTo({ top: 0 });
        });
      } else if (positionViewOpenRef.current) {
        showPositionList(selectedKeyRef.current);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [resetTransactionContext, showPositionList]);

  // A position that is gone (closed, or not this wallet's) gives way to the list.
  useEffect(() => {
    if (!positionViewOpen || reviewStage !== 'input') return;
    if (positionState.status === 'idle' || positionState.status === 'loading') return;
    const key = new URLSearchParams(window.location.search).get('position');
    if (key && positions.some((position) => positionKey(position) === key)) return;
    if (key) writeHistory('replace', withoutPositionView(), positionViewHref());
    setPositionViewOpen(false);
  }, [positionState.status, positionViewOpen, positions, reviewStage]);

  // Telegram's Back returns from a position to the list before leaving the page.
  useEffect(() => {
    if (!positionViewOpen || reviewStage !== 'input') return undefined;
    const onTelegramBack = (event: Event) => {
      const detail = (event as CustomEvent<{ consume?: () => void; isConsumed?: () => boolean }>).detail;
      // An open sheet or popover closes first; wide screens already show the list.
      if (detail?.isConsumed?.() || document.querySelector('[aria-modal="true"]') || window.matchMedia(WIDE_LAYOUT_QUERY).matches) return;
      detail?.consume?.();
      closePosition();
    };
    window.addEventListener('fxaeon:telegram-back', onTelegramBack);
    return () => window.removeEventListener('fxaeon:telegram-back', onTelegramBack);
  }, [closePosition, positionViewOpen, reviewStage]);

  const selected = positions.find((position) => positionKey(position) === selectedKey);
  const managerPosition = reviewStage === 'input' ? selected : reviewPosition ?? selected;
  const preserveActionReview = reviewStage !== 'input' && Boolean(reviewPosition);
  const handleReviewStageChange = useCallback((nextStage: ActionReviewStage) => {
    setReviewStage(nextStage);
    if (nextStage === 'input') setReviewPosition(null);
    else if (reviewStage === 'input' && selected) setReviewPosition(selected);
  }, [reviewStage, selected]);
  const selectedStale = selected ? positionIsStale(selected, positionState.failedGroups) : false;
  const selectedSplit = selected ? { side: selected.side, debtLabel: leverageDebtLabel(selected.side, selected.market) } : undefined;
  const decisionBefore = useMemo(() => managerPosition ? [
    { label: 'Collateral', value: `${groupDigits(formatAmount(managerPosition.info.rawColls, positionCollateralDecimals(managerPosition)))} ${positionCollateralSymbol(managerPosition)}` },
    { label: 'Debt', value: `${groupDigits(formatAmount(managerPosition.info.rawDebts, positionDebtDecimals(managerPosition)))} ${managerPosition.info.rawDebtsToken}` },
  ] : undefined, [managerPosition]);
  const marketTokens = selected
    ? action === 'reduce' || action === 'close'
      ? positionOutputTokenOptions(selected.market, selected.side)
      : positionInputTokenOptions(selected.market)
    : positionInputTokenOptions('ETH');
  const validAmount = positiveDecimal(amount, tokenDecimals(token));

  useEffect(() => {
    if (!selected) return;
    setToken((current) => marketTokens.includes(current) ? current : marketTokens[0]);
    // This is an editable target, not the measured position metric. Seed a
    // readable target and pass that exact displayed value into the review.
    const targetLeverage = positionTargetLeverage(selected);
    if (targetLeverage !== null) setLeverage(clampLeverage(targetLeverage, leverageBounds));
  }, [action, leverageBounds, marketTokens, selected]);

  // A selected position normally seeds a fresh leverage target from the
  // canonical read. Let a validated History draft override that seed once,
  // after the action-specific token list and current pool bounds are ready.
  useEffect(() => {
    const pending = pendingRestoredInputsRef.current;
    if (!pending || !selected || pending.positionKey !== positionKey(selected)) return;
    if (pending.token && !marketTokens.includes(pending.token)) return;
    if (pending.token) setToken(pending.token);
    if (pending.leverage !== undefined && Number.isFinite(pending.leverage)) {
      setLeverage(clampLeverage(pending.leverage, leverageBounds));
    }
    pendingRestoredInputsRef.current = null;
  }, [leverageBounds, marketTokens, selected]);

  useEffect(() => {
    let active = true;
    if (!selected) return () => { active = false; };
    const chosenSlippage = Number(slippage);
    if (!Number.isFinite(chosenSlippage) || chosenSlippage <= 0 || chosenSlippage > MAX_FX_SLIPPAGE_PERCENT) return;
    const fallback = leverageBoundsFor(selected.market, selected.side, chosenSlippage);
    setLeverageBounds(fallback);
    void readLeverageBounds(selected.market, selected.side, undefined, chosenSlippage).then((next) => {
      if (active) setLeverageBounds(next);
    }).catch(() => {
      // Keep the conservative fallback; the SDK remains the final planner
      // authority when the user asks to review a transaction.
    });
    return () => { active = false; };
  }, [selected, slippage]);

  // History resumes carry only safe form primitives. Verify the current
  // wallet, network, operation, stable position/action key, and same-origin
  // route before restoring them. ActionReview still rebuilds and simulates a
  // fresh SDK route; no saved route or calldata is ever reused.
  useEffect(() => {
    if (reviewStage === 'executing' || reviewStage === 'result') return;
    if (typeof window === 'undefined' || !wallet.address || !wallet.chainId || !positions.length) return;
    const draftId = signatureDraftIdFromSearch(window.location.search);
    if (!draftId || restoredDraftRef.current === draftId) return;
    const draft = readSignatureRequiredDraft(draftId);
    if (!draft || draft.walletAddress.toLowerCase() !== wallet.address.toLowerCase() || draft.chainId !== wallet.chainId) return;
    try {
      if (new URL(draft.resumePath, window.location.origin).pathname !== '/positions') return;
    } catch {
      return;
    }

    const form = draft.formState;
    const formAction = form?.action;
    const nextAction: PositionAction | null = formAction === 'increase' || formAction === 'reduce' || formAction === 'close' || formAction === 'leverage'
      ? formAction
      : null;
    const expectedOperation = nextAction === 'increase'
      ? 'increasePosition'
      : nextAction === 'leverage'
        ? 'adjustPositionLeverage'
        : nextAction === 'reduce' || nextAction === 'close'
          ? 'reducePosition'
          : null;
    if (!nextAction || draft.operation !== expectedOperation) return;

    const draftPositionKey = typeof form?.positionKey === 'string' ? form.positionKey : '';
    const selectedPosition = positions.find((item) => positionKey(item) === draftPositionKey);
    if (!selectedPosition) return;
    const expectedActionKey = `position:${selectedPosition.info.positionId}:${nextAction === 'close' ? 'close' : 'manage'}`;
    if (draft.actionKey !== expectedActionKey) return;
    const restored = restoreSignatureRequiredDraftFromSearch(window.location.search, {
      walletAddress: wallet.address as `0x${string}`,
      chainId: wallet.chainId as 1 | 8453,
      operation: draft.operation,
      actionKey: expectedActionKey,
    });
    if (!restored) return;

    const allowedTokens = nextAction === 'reduce' || nextAction === 'close'
      ? positionOutputTokenOptions(selectedPosition.market, selectedPosition.side)
      : positionInputTokenOptions(selectedPosition.market);
    const nextToken = typeof form?.token === 'string' && allowedTokens.includes(form.token as UiToken)
      ? form.token as UiToken
      : allowedTokens[0];
    const nextAmount = typeof form?.amount === 'string' && form.amount.length <= 100 ? form.amount : '';
    const nextFraction = typeof form?.fraction === 'string' ? Number(form.fraction) : NaN;
    const nextLeverage = typeof form?.leverage === 'string' ? Number(form.leverage) : NaN;
    const nextSlippage = typeof form?.slippage === 'string' && form.slippage.length <= 32 ? form.slippage : slippage;

    restoredDraftRef.current = draftId;
    pendingRestoredInputsRef.current = {
      positionKey: draftPositionKey,
      token: nextToken,
      leverage: Number.isFinite(nextLeverage) ? nextLeverage : undefined,
    };
    setSelectedKey(draftPositionKey);
    setAction(nextAction);
    setToken(nextToken);
    setAmount(nextAmount);
    if (nextAction === 'close') setFraction(100);
    else if (Number.isFinite(nextFraction)) setFraction(Math.min(99, Math.max(1, Math.round(nextFraction))));
    if (Number.isFinite(nextLeverage)) setLeverage(nextLeverage);
    setSlippage(nextSlippage);
    setReviewRevision((revision) => revision + 1);
    setResumeReview((revision) => revision + 1);
    setPositionViewOpen(true);
    // Remove the opaque local id after successful validation so a refresh
    // cannot re-consume an already restored draft. The saved draft itself
    // remains available in History until the fresh route is signed/cancelled.
    // The URL keeps naming the restored position and action, which this page
    // has now applied, so its query does not reset the restored inputs.
    handledDeepLinkRef.current = deepLinkKeyFor(draftPositionKey, nextAction);
    window.history.replaceState(window.history.state, '', positionViewHref(draftPositionKey, nextAction));
  }, [deepLinkKeyFor, positions, reviewStage, slippage, wallet.address, wallet.chainId]);

  const leverageError = leverage > 0 && leverage < leverageBounds.min
    ? `Minimum pool leverage is ${leverageBounds.min.toFixed(1)}×.`
    : null;

  const planBuilder = useMemo(() => {
    if (!selected || !wallet.address || selectedStale) return null;
    const slippageValue = Number(slippage);
    if (!Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT) return null;
    const common = {
      market: selected.market,
      type: selected.side,
      positionId: selected.info.positionId,
      userAddress: wallet.address,
      slippage: slippageValue,
    } as const;
    if (action === 'increase') {
      const amountWei = validAmount ? parseAmount(validAmount, token) : null;
      if (!amountWei || !Number.isFinite(leverage) || leverage < leverageBounds.min || leverage > leverageBounds.max) return null;
      // The SDK's short-pool increase path expects the LSD leverage field,
      // while long pools use the regular leverage field. Both are exposed as
      // an editable target so an existing position can actually exercise the
      // complete official increasePosition input surface.
      return async () => {
        const prepared = await prepareLeverageReview({
          leverage,
          currentBounds: leverageBounds,
          readBounds: () => readLeverageBounds(selected.market, selected.side, undefined, slippageValue),
          buildPlan: () => planIncreasePosition({ ...common, leverage, inputTokenAddress: tokenAddress(token), amount: amountWei }),
        });
        setLeverageBounds((current) => current.min === prepared.bounds.min
          && current.max === prepared.bounds.max
          && current.source === prepared.bounds.source
          ? current
          : prepared.bounds);
        if (prepared.adjusted) {
          setLeverage(prepared.leverage);
          throw new RangeError(`Pool leverage limits changed to ${prepared.bounds.min.toFixed(1)}×–${prepared.bounds.max.toFixed(1)}×. The target was updated; review it again.`);
        }
        return prepared.plan;
      };
    }
    if (action === 'reduce' || action === 'close') {
      return async () => {
        const reductionFraction = action === 'close' ? 100 : fraction;
        const reduction = await getSdkReductionAmountWei({
          market: selected.market,
          side: selected.side,
          rawCollateralWei: selected.info.rawColls,
          rawDebtWei: selected.info.rawDebts,
          fractionBps: reductionFraction * 100,
        });
        return planReducePosition({ ...common, amount: reduction, outputTokenAddress: tokenAddress(token), isClosePosition: action === 'close' });
      };
    }
    if (!Number.isFinite(leverage) || leverage < leverageBounds.min || leverage > leverageBounds.max) return null;
    return async () => {
      const prepared = await prepareLeverageReview({
        leverage,
        currentBounds: leverageBounds,
        readBounds: () => readLeverageBounds(selected.market, selected.side, undefined, slippageValue),
        buildPlan: () => planAdjustPositionLeverage({ ...common, leverage }),
      });
      setLeverageBounds((current) => current.min === prepared.bounds.min
        && current.max === prepared.bounds.max
        && current.source === prepared.bounds.source
        ? current
        : prepared.bounds);
      if (prepared.adjusted) {
        setLeverage(prepared.leverage);
        throw new RangeError(`Pool leverage limits changed to ${prepared.bounds.min.toFixed(1)}×–${prepared.bounds.max.toFixed(1)}×. The target was updated; review it again.`);
      }
      return prepared.plan;
    };
  }, [action, fraction, leverage, leverageBounds, selected, selectedStale, slippage, token, validAmount, wallet.address]);

  const reviewLabel = action === 'close' ? 'Close position' : action === 'increase' ? 'Add to position' : action === 'reduce' ? 'Reduce position' : 'Adjust position leverage';
  const selectedLabel = managerPosition ? `${managerPosition.market} ${managerPosition.side} position` : 'position';
  const operationLabel = action === 'close'
    ? `Close ${selectedLabel}`
    : action === 'increase'
      ? `Add to ${selectedLabel}`
        : action === 'reduce'
          ? `Reduce ${selectedLabel}`
          : `Adjust ${selectedLabel} leverage`;
  const draftActionKey = selected
    ? `position:${selected.info.positionId}:${action === 'close' ? 'close' : 'manage'}`
    : undefined;
  const draftResumePath = selected
    ? `/positions?position=${encodeURIComponent(positionKey(selected))}&action=${encodeURIComponent(action)}`
    : undefined;
  // Phones show the list or one position while editing; a review takes the
  // page whichever view it started from. Wide screens show both columns.
  const positionView = reviewStage !== 'input' ? 'review' : positionViewOpen && selected ? 'position' : 'list';

  return (
    <AppShell>
      <div className={`${styles.positionsRoot} ${styles.positionsCompactRoot} ${!wallet.address ? styles.positionsDisconnectedRoot : ''}`} data-position-stage={reviewStage} data-position-view={positionView}>
      <div className={styles.positionsWorkspace}>
        <h1 className="sr-only">Positions</h1>
        {reviewStage === 'input' && <nav className={styles.positionsViews} aria-label="Trade views">
          <Link href="/trade" className="glass-press">New position</Link>
          <span aria-current="page">Positions</span>
        </nav>}
        {!wallet.address && !preserveActionReview ? (
          <div className={styles.positionsEntry}><WalletConnectCTA compact ready={wallet.ready} authenticated={wallet.authenticated} body="Choose or connect a wallet to see and manage your open positions." /></div>
        ) : positions.length > 0 || positionState.pendingPositions.length > 0 ? (
          reviewStage === 'input' ? <ProtocolPositionNotice
            status={positionState.status}
            failedGroups={positionState.failedGroups}
            hasPositions={positions.length + positionState.pendingPositions.length > 0}
            refreshing={positionState.refreshing}
            onRefresh={() => void positionState.refresh()}
          /> : null
        ) : null}
        {reviewStage === 'input' && <ConfirmedPositionCards />}
        {wallet.address && positionState.status === 'loading' && !positions.length && !positionState.pendingPositions.length && reviewStage === 'input' ? (
          <ProtocolPositionList label="Loading positions"><ProtocolPositionSkeleton /><ProtocolPositionSkeleton /></ProtocolPositionList>
        ) : wallet.address && positionState.status === 'unavailable' && !positions.length && !positionState.pendingPositions.length && reviewStage === 'input' ? (
          <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl bg-[var(--warn-dim)] py-2 pl-4 pr-2"><span className="text-[13px] text-warn">Position data is unavailable.</span><button type="button" aria-label="Retry positions" onClick={() => void positionState.refresh()} className="glass-press ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut"><RefreshCw className="h-4 w-4" aria-hidden="true" /></button></div>
        ) : wallet.address && positionState.status === 'partial' && !positions.length && !positionState.pendingPositions.length && reviewStage === 'input' ? (
          <div role="status" aria-live="polite" className="rounded-2xl bg-[var(--warn-dim)] px-4 py-3 text-[13px] text-warn">Some position data couldn’t load, so results may be incomplete.<button type="button" onClick={() => void positionState.refresh()} className="mt-2 min-h-11 rounded-lg px-2 font-semibold text-mint">Retry positions</button></div>
        ) : wallet.address && positionState.status === 'ready' && !positions.length && !positionState.pendingPositions.length && reviewStage === 'input' ? (
          <div className={styles.positionsEmpty}>
            <EmptyState icon={Layers2} title="No open positions" body="Your ETH and BTC positions will appear here." action={<Link href="/trade" className="button button-primary inline-flex min-h-11 items-center justify-center rounded-full px-5 font-medium">Open a position</Link>} />
          </div>
        ) : wallet.address && positions.length > 0 || preserveActionReview ? (
          <div className={styles.positionManagerGrid} data-review={reviewStage !== 'input' || undefined}>
            <section className={styles.positionsColumn} aria-labelledby="open-positions-heading">
              <div className={styles.positionSectionHeader}>
                <div><h2 id="open-positions-heading">Open positions</h2></div>
                <span>{positions.length} open</span>
              </div>
              {/* A tap opens the position: its figures, actions and form together. */}
              <ProtocolPositionList label="Open positions">
                {positions.map((position) => {
                  const key = positionKey(position);
                  return <ProtocolPositionCard key={key} position={position} selected={key === selectedKey} onSelect={() => openPosition(key)} />;
                })}
              </ProtocolPositionList>
            </section>

            <section ref={managerRef} className={styles.positionManageColumn} aria-label={reviewStage === 'input' ? undefined : `${operationLabel} review`} aria-labelledby={reviewStage === 'input' ? 'manage-position-heading' : undefined}>
              {reviewStage === 'input' && <div className={styles.positionViewBar}>
                <button type="button" onClick={closePosition} className={`${styles.positionBack} glass-press`}><ArrowLeft aria-hidden="true" />All positions</button>
                <TransactionSettings slippage />
              </div>}
              {reviewStage === 'input' && selected && <ProtocolPositionDetails position={selected} headingId="manage-position-heading" className={styles.positionFocus} />}
              {reviewStage === 'input' && selected?.side === 'long' && <Link href={`/borrow?market=${selected.market}&position=${selected.info.positionId}`} className={`${styles.borrowAgainst} glass-press`}>Borrow against this position<ChevronRight aria-hidden="true" /></Link>}
              {reviewStage === 'input' && selectedStale && <span role="status" aria-label="Refreshing selected position" className="skeleton block h-8 rounded-xl" />}

              <Card className={`${styles.actionPanel} ${styles.positionActionCard} ${reviewStage === 'input' ? '' : styles.positionActionCardReview}`}>
                {reviewStage === 'input' && <div className={styles.positionActions}><Segmented value={action} onChange={changeAction} ariaLabel="Position action" options={[{ value: 'increase', label: 'Add' }, { value: 'reduce', label: 'Reduce' }, { value: 'leverage', label: 'Leverage' }, { value: 'close', label: 'Close' }]} /></div>}
                <ActionReview
                  key={reviewRevision}
                  surface="content"
                  planBuilder={planBuilder}
                  label={reviewLabel}
                  operationLabel={operationLabel}
                  destructive={action === 'close'}
                  onStageChange={handleReviewStageChange}
                  draftState={draftState}
                  draftActionKey={draftActionKey}
                  draftResumePath={draftResumePath}
                  resumeReview={resumeReview}
                  decisionBefore={decisionBefore}
                  editor={(
                    <div className={styles.positionEditor}>
                      {action === 'increase' && <div className={styles.fieldStack}><Header icon={ArrowUpRight} title="Increase exposure" body="Add collateral and choose the target leverage for this position." /><AmountField label="Amount to add" symbol={token} value={amount} onChange={setAmount} maxDecimals={tokenDecimals(token)} balanceState={selectedTokenBalance} tokenSelector={<TokenSelect compact label="Input asset" value={token} options={marketTokens} onChange={changeToken} {...tokenBalanceProps} />} /><LeverageField label="Target leverage" value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} split={selectedSplit} /></div>}
                      {action === 'reduce' && <div className={styles.fieldStack}><Header icon={ArrowDownRight} title="Reduce exposure" body="Choose how much of this position to reduce and what asset to receive." /><RangeField label="Position reduction" value={fraction} onChange={setFraction} min={1} max={99} step={1} suffix="%" /><div className="grid grid-cols-3 gap-2">{[25, 50, 75].map((value) => <button key={value} type="button" aria-pressed={fraction === value} onClick={() => setFraction(value)} className={`glass-press min-h-11 rounded-xl text-[12px] font-semibold tabular-nums transition-colors ${fraction === value ? 'bg-[var(--mint-dim)] text-mint' : 'bg-[var(--surface-2)] text-mut hover:text-[var(--text)]'}`}>{value}%</button>)}</div><TokenSelect label="Receive asset" value={token} options={marketTokens} onChange={changeToken} {...tokenBalanceProps} /></div>}
                      {action === 'close' && <div className={styles.fieldStack}><Header icon={X} title="Close the full position" body="Close 100% of this position and choose the asset returned to your wallet." /><div className={styles.closeNotice}><strong>Full close</strong><span>All remaining collateral and debt</span><small>Review the route, limits, approvals, and transaction count before signing.</small></div><TokenSelect label="Receive asset" value={token} options={marketTokens} onChange={changeToken} {...tokenBalanceProps} /></div>}
                      {action === 'leverage' && <div className={styles.fieldStack}><Header icon={Gauge} title="Adjust leverage" body="Set the target leverage for this position." /><LeverageField label="Target leverage" value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} split={selectedSplit} /></div>}
                    </div>
                  )}
                  onComplete={async (_execution, confirmedRoute) => {
                    await Promise.all([positionState.refresh(), walletBalances.refresh()]);
                    const completedPosition = reviewPosition ?? selected;
                    if (action === 'close' && completedPosition && confirmedRoute.details?.positionId === completedPosition.info.positionId) {
                      await positionState.reconcileClosedPosition(completedPosition);
                    }
                  }}
                />
              </Card>
            </section>
          </div>
        ) : null}
      </div>
      </div>
    </AppShell>
  );
}

function Header({ icon: Icon, title, body }: { icon: typeof ArrowUpRight; title: string; body: string }) { return <div><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-mint" aria-hidden="true" /><h2 className="text-[15px] font-semibold">{title}</h2></div><p className="mt-1 text-[12px] text-mut">{body}</p></div>; }
