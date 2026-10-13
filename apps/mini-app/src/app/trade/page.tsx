'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Layers2 } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';
import { TransactionSettings } from '@/components/TransactionSettings';
import { TradeSections } from '@/components/ProductSections';
import { ActionWorkspace } from '@/components/ProductLayout';
import { ActionReview, type ActionReviewStage } from '@/components/ActionReview';
import { TradeMarketChart } from '@/components/MarketChart';
import {
  ProtocolPositionCard,
  ProtocolPositionList,
  ProtocolPositionNotice,
} from '@/components/ProtocolPositionCard';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import { deriveConfirmedPositionHint } from '@/lib/confirmedPositions';
import { confirmedPositionHintKey } from '@/lib/confirmedPositionStorage';
import { carryNewPosition } from '@/lib/positionBorn';
import { AmountField, LeverageField, Segmented, TokenSelect, tokenBalanceFor, useWalletTokenBalances, type TokenBalanceView } from '@/components/ProtocolForm';
import { leverageDebtLabel } from '@/lib/leverageShare';
import { MAX_FX_SLIPPAGE_PERCENT, clampLeverage, estimatePlannedRouteCost, getEthereumClient, leverageBoundsFor, planIncreasePosition, prepareLeverageReview, readLeverageBounds, readSignatureRequiredDraft, restoreSignatureRequiredDraft, signatureDraftIdFromSearch, type LeverageBounds, type PlannedRoute, type TransactionExecutionResult } from '@/lib/fx';
import { calculateNativeMax, nativeMaxErrorMessage } from '@/lib/fx/nativeMax';
import { fetchGasTierQuotes, selectedGasTierQuote } from '@/lib/fx/gasFeePolicy';
import { readGasTier } from '@/lib/settings';
import { RoutePrefetchStore, type RoutePrefetchDescriptor } from '@/lib/fx/routePrefetch';
import { TradeOutcomePreview } from '@/components/TradeOutcomePreview';
import { currentTradeOutcome, settledTradeOutcome, tradeOutcomeKey, type TradeOutcomeState } from '@/lib/tradeOutcome';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/trade-surfaces.module.css';
import { groupDigits, positiveDecimal } from '@/lib/amount';
import { amountBlocker } from '@/lib/formBlockers';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import { formatUnits } from 'viem';
import { DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent, SETTINGS_KEY, SETTINGS_UPDATED_EVENT } from '@/lib/settings';
import { readTradeDeepLinkContext, resetTransactionAmounts, type TradeDeepLinkContext } from '@/lib/transactionState';
import {
  parseAmount,
  positionInputTokenOptions,
  positionKey,
  tokenAddress,
  tokenDecimals,
  type UiMarket,
  type UiSide,
  type UiToken,
} from '@/app/trade/fxUi';

function createPrefetchSessionId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const words = cryptoApi.getRandomValues(new Uint32Array(2));
    return `trade-${words[0].toString(16)}-${words[1].toString(16)}`;
  }
  throw new Error('Secure randomness is unavailable for the trade prefetch session');
}

function positionHref(market: UiMarket, side: UiSide, positionId: string | number, action?: 'close'): string {
  const key = encodeURIComponent(`${market}:${side}:${positionId}`);
  return `/positions?position=${key}${action ? `&action=${action}` : ''}`;
}

export default function TradePage() {
  const router = useRouter();
  const wallet = usePrivyWallet();
  // Trade inputs are settled against the Ethereum FX token registry. Read
  // those funds before wallet network switching so review stays informative.
  const walletBalances = useWalletTokenBalances(wallet.address, 1, wallet.chainId);
  const positionState = useProtocolPositions();
  const [market, setMarket] = useState<UiMarket>('ETH');
  const [side, setSide] = useState<UiSide>('long');
  const [token, setToken] = useState<UiToken>('ETH');
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(2);
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PERCENT));
  const [leverageBounds, setLeverageBounds] = useState<LeverageBounds>(() => leverageBoundsFor('ETH', 'long'));
  const [highlightedPositionKey, setHighlightedPositionKey] = useState('');
  const [reviewRevision, setReviewRevision] = useState(0);
  const [resumeReview, setResumeReview] = useState(0);
  const [nativeMaxAmount, setNativeMaxAmount] = useState<string | null>(null);
  const [nativeMaxPending, setNativeMaxPending] = useState(false);
  const [nativeMaxError, setNativeMaxError] = useState<string | null>(null);
  const [reviewStage, setReviewStage] = useState<ActionReviewStage>('input');
  const reviewStageRef = useRef<ActionReviewStage>('input');
  // Counts returns to the editor, so the route is warmed again from the
  // current chain once a review has planned its own (see the warm-up below).
  const [editorEpoch, setEditorEpoch] = useState(0);
  const handleReviewStageChange = useCallback((stage: ActionReviewStage) => {
    if (stage === 'input' && reviewStageRef.current !== 'input') setEditorEpoch((epoch) => epoch + 1);
    reviewStageRef.current = stage;
    setReviewStage(stage);
  }, []);
  const [outcome, setOutcome] = useState<TradeOutcomeState | null>(null);
  const prefetchStoreRef = useRef<RoutePrefetchStore | null>(null);
  const prefetchSessionRef = useRef(createPrefetchSessionId());
  const prefetchDescriptorRef = useRef<RoutePrefetchDescriptor | null>(null);
  const [foreground, setForeground] = useState(false);
  const previousWalletContextRef = useRef<string | null>(null);
  // Connecting from the disconnected review rail must preserve the ticket.
  // Once a wallet has been selected, later account/network changes still
  // invalidate the wallet-scoped inputs and force a fresh review.
  const lastConnectedWalletRef = useRef<string | null>(null);
  const lastConnectedChainRef = useRef<number | undefined>(undefined);
  const explicitDeepLinkRef = useRef<TradeDeepLinkContext | null>(null);
  const initiallyHydratedRef = useRef(Boolean(wallet.address && wallet.chainId));
  const currentTicketRef = useRef('');
  const prefetchedTicketRef = useRef('');
  const restoredDraftRef = useRef(false);
  const nativeMaxRequestRef = useRef(0);
  const nativeMaxMountedRef = useRef(true);

  useEffect(() => {
    nativeMaxMountedRef.current = true;
    return () => {
      nativeMaxMountedRef.current = false;
      nativeMaxRequestRef.current += 1;
    };
  }, []);

  // Keep the unsigned snapshot primitive-only so History can restore the
  // editable ticket without ever persisting a quote, calldata, or route.
  // Memoising it also prevents ActionReview from rewriting the same local
  // draft on every unrelated price/position refresh.
  const draftState = useMemo(() => ({
    market,
    side,
    token,
    amount,
    leverage,
    slippage,
  }), [amount, leverage, market, side, slippage, token]);
  const draftActionKey = useMemo(() => `trade:${market}:${side}:${token}`, [market, side, token]);

  const resetTradeContext = useCallback((nextMarket: UiMarket = 'ETH', nextSide: UiSide = 'long', nextToken: UiToken = 'ETH') => {
    const defaults = resetTransactionAmounts();
    setMarket(nextMarket);
    setSide(nextSide);
    setToken(nextToken);
    setAmount(defaults.amount);
    setLeverage(defaults.leverage);
    setNativeMaxAmount(null);
    setNativeMaxError(null);
    setReviewStage('input');
    prefetchStoreRef.current?.invalidate();
    prefetchDescriptorRef.current = null;
    prefetchedTicketRef.current = '';
    setReviewRevision((revision) => revision + 1);
  }, []);

  const changeMarket = useCallback((nextMarket: UiMarket) => {
    resetTradeContext(nextMarket, side, nextMarket === 'ETH' ? 'ETH' : 'WBTC');
  }, [resetTradeContext, side]);

  const changeSide = useCallback((nextSide: UiSide) => {
    resetTradeContext(market, nextSide, token);
  }, [market, resetTradeContext, token]);

  const changeToken = useCallback((nextToken: UiToken) => {
    resetTradeContext(market, side, nextToken);
  }, [market, resetTradeContext, side]);
  currentTicketRef.current = JSON.stringify([wallet.address, wallet.chainId, wallet.isEmbedded, walletBalances.balances.ETH?.amount ?? '', market, side, token, amount, leverage, slippage, leverageBounds.min, leverageBounds.max]);

  useEffect(() => {
    const context = `${wallet.address?.toLowerCase() ?? ''}:${wallet.chainId ?? ''}`;
    const previous = previousWalletContextRef.current;
    const currentAddress = wallet.address?.toLowerCase() ?? null;
    const previousAddress = previous?.split(':')[0] ?? '';
    const walletChanged = Boolean(lastConnectedWalletRef.current)
      && lastConnectedWalletRef.current !== currentAddress;
    const chainChanged = wallet.chainId !== undefined
      && lastConnectedChainRef.current !== undefined
      && lastConnectedChainRef.current !== wallet.chainId;
    // A disconnected review rail owns the first wallet connection. Preserve
    // its editable ticket while the address/chain arrive in separate React
    // updates; identity changes after an established session still reset it.
    if (previous !== null && previous !== context && previousAddress && (walletChanged || chainChanged)) {
      // Keep ActionReview mounted after execution starts and through its
      // result screen. Its submitted route and progress belong to that wallet.
      // Leave the refs untouched so Edit can apply this reset on input.
      if (reviewStage === 'executing' || reviewStage === 'result') return;
      const explicit = explicitDeepLinkRef.current;
      const market = explicit?.market ?? 'ETH';
      const side = explicit?.side ?? 'long';
      const defaultToken = explicit?.asset && positionInputTokenOptions(market).includes(explicit.asset as UiToken)
        ? explicit.asset as UiToken
        : market === 'ETH' ? 'ETH' : 'WBTC';
      resetTradeContext(market, side, defaultToken);
      // Keep the URL context through a two-step browser-wallet hydration
      // (address first, chain second), then let normal user selections win.
      if (wallet.address && wallet.chainId) explicitDeepLinkRef.current = null;
    }
    previousWalletContextRef.current = context;
    if (currentAddress) lastConnectedWalletRef.current = currentAddress;
    if (wallet.chainId !== undefined) lastConnectedChainRef.current = wallet.chainId;
  }, [resetTradeContext, reviewStage, wallet.address, wallet.chainId]);

  useEffect(() => {
    const deepLink = readTradeDeepLinkContext(window.location.search);
    explicitDeepLinkRef.current = initiallyHydratedRef.current ? null : deepLink;
    if (deepLink) {
      setMarket(deepLink.market);
      setSide(deepLink.side);
      setToken(positionInputTokenOptions(deepLink.market).find((option) => option === deepLink.asset) ?? positionInputTokenOptions(deepLink.market)[0]);
    }
    const update = () => {
      const active = document.visibilityState === 'visible' && navigator.onLine;
      if (!active) {
        prefetchStoreRef.current?.invalidate();
        prefetchDescriptorRef.current = null;
      }
      setForeground(active);
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // History links carry only an opaque local-draft id. Restore the validated
  // primitive ticket after the wallet is known, then consume that id so a
  // refresh cannot repeatedly replay an old signature-required draft. The
  // route is planned and simulated afresh by ActionReview; no executable
  // transaction data is restored from storage.
  useEffect(() => {
    if (reviewStage === 'executing' || reviewStage === 'result') return;
    if (restoredDraftRef.current || !wallet.address || wallet.chainId !== 1) return;
    const draftId = signatureDraftIdFromSearch(window.location.search);
    if (!draftId) return;
    const draft = readSignatureRequiredDraft(draftId);
    if (!draft || draft.operation !== 'increasePosition') return;
    let resumePath: URL;
    try { resumePath = new URL(draft.resumePath, window.location.origin); } catch { return; }
    if (resumePath.origin !== window.location.origin || resumePath.pathname !== '/trade') return;
    const state = draft.formState;
    if (!state) return;
    const nextMarket = state.market === 'BTC' ? 'BTC' : state.market === 'ETH' ? 'ETH' : null;
    const nextSide = state.side === 'short' ? 'short' : state.side === 'long' ? 'long' : null;
    const nextToken = typeof state.token === 'string' && nextMarket
      && positionInputTokenOptions(nextMarket).includes(state.token as UiToken)
      ? state.token as UiToken
      : null;
    const nextAmount = typeof state.amount === 'string' && state.amount.length <= 128 && /^(?:\d+\.?\d*|\.\d+)$/.test(state.amount)
      ? state.amount
      : null;
    const nextLeverage = typeof state.leverage === 'number' && Number.isFinite(state.leverage) ? state.leverage : null;
    const nextSlippage = typeof state.slippage === 'string' && state.slippage.length <= 32 && Number.isFinite(Number(state.slippage))
      ? state.slippage
      : null;
    if (!nextMarket || !nextSide || !nextToken || nextAmount === null || nextLeverage === null || nextSlippage === null
      || nextLeverage <= 0 || Number(nextSlippage) <= 0 || Number(nextSlippage) > MAX_FX_SLIPPAGE_PERCENT
      || draft.actionKey !== `trade:${nextMarket}:${nextSide}:${nextToken}`) return;
    const restored = restoreSignatureRequiredDraft(draftId, {
      walletAddress: wallet.address as `0x${string}`,
      chainId: wallet.chainId,
      operation: 'increasePosition',
      actionKey: draft.actionKey,
    });
    if (!restored) return;
    restoredDraftRef.current = true;
    setMarket(nextMarket);
    setSide(nextSide);
    setToken(nextToken);
    setAmount(nextAmount);
    setLeverage(nextLeverage);
    setSlippage(nextSlippage);
    setReviewStage('input');
    setResumeReview((revision) => revision + 1);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('fxDraft');
    window.history.replaceState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  }, [reviewStage, wallet.address, wallet.chainId]);

  useEffect(() => {
    setSlippage(String(readSlippagePercent()));
  }, []);
  useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      if (event.type === 'storage' && (event as StorageEvent).key !== SETTINGS_KEY) return;
      setSlippage(String(readSlippagePercent()));
    };
    window.addEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
    window.addEventListener('storage', onSettingsUpdated);
    return () => { window.removeEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated); window.removeEventListener('storage', onSettingsUpdated); };
  }, []);

  const tokenOptions = positionInputTokenOptions(market);
  const sideLabel = side === 'long' ? 'Long' : 'Short';
  const validAmount = positiveDecimal(amount, tokenDecimals(token));
  const selectedTokenBalance: TokenBalanceView | undefined = wallet.address
    ? tokenBalanceFor(walletBalances.balances, token) ?? (walletBalances.status === 'loading'
      ? { status: 'loading' }
      : { status: 'unavailable', reason: walletBalances.reason })
    : undefined;

  useEffect(() => {
    let active = true;
    const chosenSlippage = Number(slippage);
    if (!Number.isFinite(chosenSlippage) || chosenSlippage <= 0 || chosenSlippage > MAX_FX_SLIPPAGE_PERCENT) return;
    const fallback = leverageBoundsFor(market, side, chosenSlippage);
    setLeverageBounds(fallback);
    void readLeverageBounds(market, side, undefined, chosenSlippage).then((next) => {
      if (active) setLeverageBounds(next);
    }).catch(() => {
      // The input remains guarded by the conservative fallback while a public
      // RPC is unavailable; the SDK is still the final route authority.
    });
    return () => { active = false; };
  }, [market, side, slippage]);

  useEffect(() => {
    setLeverage((current) => clampLeverage(current, leverageBounds));
  }, [leverageBounds]);

  const leverageError = leverage > 0 && leverage < leverageBounds.min
    ? `Minimum pool leverage is ${leverageBounds.min.toFixed(1)}×.`
    : null;

  useEffect(() => {
    if (!tokenOptions.includes(token)) setToken(tokenOptions[0]);
  }, [token, tokenOptions]);

  useEffect(() => {
    if (!highlightedPositionKey) return;
    const timer = window.setTimeout(() => setHighlightedPositionKey(''), 8_000);
    return () => window.clearTimeout(timer);
  }, [highlightedPositionKey]);

  const slippageValue = Number(slippage);

  const resolveNativeMax = useCallback(async () => {
    if (token !== 'ETH' || !wallet.address || nativeMaxPending) return;
    const balance = tokenBalanceFor(walletBalances.balances, 'ETH');
    if (!balance || balance.status !== 'ready' || !balance.amount) return;
    const balanceWei = parseAmount(balance.amount, 'ETH');
    if (!balanceWei) return;
    const ticket = currentTicketRef.current;
    const request = nativeMaxRequestRef.current + 1;
    nativeMaxRequestRef.current = request;
    const isCurrent = () => nativeMaxMountedRef.current
      && nativeMaxRequestRef.current === request
      && currentTicketRef.current === ticket;
    setNativeMaxPending(true);
    setNativeMaxError(null);
    try {
      // Gas can vary with calldata and amount. Rebuild the real candidate
      // route, then subtract only execution overhead from the wallet balance;
      // the route's native value is the ETH being deposited and must remain in
      // the spendable amount. A one wei probe is not authoritative and can be
      // rejected by the SDK's minimum amount checks.
      const entered = parseAmount(amount, 'ETH');
      const spendable = await calculateNativeMax({
        balanceWei,
        initialCandidateWei: entered ?? undefined,
        buildRoutes: (candidate) => planIncreasePosition({
          market,
          type: side,
          positionId: 0,
          userAddress: wallet.address!,
          leverage,
          inputTokenAddress: tokenAddress('ETH'),
          amount: candidate,
          slippage: slippageValue,
        }),
        estimateRoutes: async (routes, signal) => {
          const feeTierQuote = wallet.isEmbedded
            ? selectedGasTierQuote(await fetchGasTierQuotes(1), readGasTier())
            : undefined;
          return Promise.all(routes.map((route) => estimatePlannedRouteCost(route, { feeTierQuote, signal })));
        },
        isCurrent,
      });
      if (!isCurrent()) return;
      const formatted = formatUnits(spendable, 18);
      setNativeMaxPending(false);
      setNativeMaxAmount(formatted);
      setAmount(formatted);
    } catch (error) {
      if (!isCurrent()) return;
      setNativeMaxAmount(null);
      setNativeMaxError(nativeMaxErrorMessage(error));
    } finally {
      if (nativeMaxMountedRef.current && nativeMaxRequestRef.current === request) setNativeMaxPending(false);
    }
  }, [amount, leverage, market, nativeMaxPending, side, slippageValue, token, wallet.address, wallet.isEmbedded, walletBalances.balances]);

  useEffect(() => {
    setNativeMaxAmount(null);
    setNativeMaxError(null);
  }, [wallet.address, wallet.chainId, walletBalances.balances.ETH?.amount]);

  // Any ticket edit invalidates a pending reserve calculation immediately.
  // The request itself may still finish, but its generation and ticket checks
  // prevent it from writing into the newer form.
  useEffect(() => {
    nativeMaxRequestRef.current += 1;
    setNativeMaxPending(false);
    setNativeMaxError(null);
  }, [amount, leverage, market, side, slippage, token, wallet.address, wallet.chainId, wallet.isEmbedded, walletBalances.balances.ETH?.amount, leverageBounds.min, leverageBounds.max]);

  const changeLeverage = useCallback((value: number) => {
    setLeverage(value);
    setNativeMaxAmount(null);
    setNativeMaxError(null);
  }, []);

  const changeAmount = useCallback((value: string) => {
    setAmount(value);
    setNativeMaxAmount(null);
    setNativeMaxError(null);
  }, []);

  // The ticket previews the route warmed for exactly its current inputs; any
  // change gives a new key, so earlier figures can never describe this ticket.
  const warmAmountWei = validAmount ? parseAmount(validAmount, token) : null;
  const outcomeKey = wallet.address && warmAmountWei && Number.isFinite(leverage)
    && leverage >= leverageBounds.min && leverage <= leverageBounds.max
    && Number.isFinite(slippageValue) && slippageValue > 0 && slippageValue <= MAX_FX_SLIPPAGE_PERCENT
    ? tradeOutcomeKey({
      walletAddress: wallet.address, walletChainId: wallet.chainId ?? null, market, side, token,
      amountWei: warmAmountWei, leverage, slippagePercent: slippageValue,
      leverageMin: leverageBounds.min, leverageMax: leverageBounds.max,
    })
    : null;

  // Keep one short-lived route warm while the ticket is valid. This is a
  // display/review optimization only: ActionReview still simulates and
  // validates the exact route before review and before opening the wallet.
  // The ticket's outcome preview reads the same warm-up; it never plans its own.
  useEffect(() => {
    const store = prefetchStoreRef.current ?? (prefetchStoreRef.current = new RoutePrefetchStore());
    store.invalidate();
    prefetchDescriptorRef.current = null;
    const amountWei = validAmount ? parseAmount(validAmount, token) : null;
    if (!foreground || !wallet.address || !amountWei || !Number.isFinite(leverage)
      || leverage < leverageBounds.min || leverage > leverageBounds.max
      || !Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT
      || !outcomeKey) {
      return;
    }

    let active = true;
    const ticket = currentTicketRef.current;
    const key = outcomeKey;
    // A preview settles only for the warm-up still current: a newer input
    // runs this effect again and deactivates the old one first.
    const settle = (state: TradeOutcomeState) => { if (active) setOutcome(state); };
    // Warming the same ticket again (after a review, or back from the
    // background) keeps its figures in place until the new ones land; a
    // ticket whose last warm-up failed shows its placeholder while it retries.
    setOutcome((current) => current?.key === key && current.status === 'failed' ? { key, status: 'pending' } : current);
    const timer = window.setTimeout(() => {
      if (reviewStageRef.current !== 'input' || document.visibilityState !== 'visible' || !navigator.onLine) {
        settle({ key, status: 'failed' });
        return;
      }
      void (async () => {
        try {
          const blockNumber = await getEthereumClient().getBlockNumber();
          if (!active || reviewStageRef.current !== 'input' || currentTicketRef.current !== ticket || document.visibilityState !== 'visible' || !navigator.onLine) {
            settle({ key, status: 'failed' });
            return;
          }
          const descriptor: RoutePrefetchDescriptor = {
            sessionId: prefetchSessionRef.current,
            walletAddress: wallet.address!,
            walletChainId: wallet.chainId ?? null,
            routeChainId: 1,
            market,
            side,
            inputTokenAddress: tokenAddress(token),
            amountWei,
            leverage,
            slippagePercent: slippageValue,
            leverageMin: leverageBounds.min,
            leverageMax: leverageBounds.max,
            blockNumber,
          };
          prefetchDescriptorRef.current = descriptor;
          prefetchedTicketRef.current = ticket;
          void store.prime(descriptor, () => planIncreasePosition({
            market,
            type: side,
            positionId: 0,
            userAddress: wallet.address!,
            leverage,
            inputTokenAddress: tokenAddress(token),
            amount: amountWei,
            slippage: slippageValue,
          })).then(
            (routes) => settle(settledTradeOutcome(key, routes)),
            // A failed warm-up shows no preview; the review plans afresh.
            () => settle({ key, status: 'failed' }),
          );
        } catch {
          // Prefetch is best-effort. The normal plan builder remains available
          // whenever the RPC or SDK is unavailable during the warm-up.
          settle({ key, status: 'failed' });
        }
      })();
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
      store.invalidate();
      prefetchDescriptorRef.current = null;
    };
  }, [editorEpoch, foreground, leverage, leverageBounds.max, leverageBounds.min, market, outcomeKey, side, slippageValue, token, validAmount, wallet.address, wallet.chainId]);
  const shownOutcome = foreground ? currentTradeOutcome(outcome, outcomeKey) : null;

  const prefetchedPlan = useCallback(async (): Promise<PlannedRoute | readonly PlannedRoute[] | null> => {
    // Latch at the click boundary, before a pending warm-up timer or block read
    // can launch a duplicate plan. An already-started exact quote stays usable.
    reviewStageRef.current = 'planning';
    const descriptor = prefetchDescriptorRef.current;
    if (!descriptor || !prefetchStoreRef.current) return null;
    const ticket = currentTicketRef.current;
    if (prefetchedTicketRef.current !== ticket) return null;
    return prefetchStoreRef.current.readValidated(descriptor, async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine
        || currentTicketRef.current !== ticket || prefetchDescriptorRef.current !== descriptor) return null;
      const [blockNumber, bounds] = await Promise.all([
        getEthereumClient().getBlockNumber({ cacheTime: 0 }),
        readLeverageBounds(descriptor.market, descriptor.side, undefined, descriptor.slippagePercent),
      ]);
      if (document.visibilityState !== 'visible' || !navigator.onLine
        || currentTicketRef.current !== ticket || prefetchDescriptorRef.current !== descriptor) return null;
      return { ...descriptor, blockNumber, leverageMin: bounds.min, leverageMax: bounds.max };
    });
  }, []);

  const planBuilder = useMemo(() => {
    if (!wallet.address || !validAmount) return null;
    const amountWei = parseAmount(validAmount, token);
    if (!amountWei || !Number.isFinite(leverage) || leverage < leverageBounds.min || leverage > leverageBounds.max || !Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT) return null;
    return async () => {
      const prepared = await prepareLeverageReview({
        leverage,
        currentBounds: leverageBounds,
        readBounds: () => readLeverageBounds(market, side, undefined, slippageValue),
        buildPlan: () => planIncreasePosition({
        market,
        type: side,
        positionId: 0,
        userAddress: wallet.address!,
        leverage,
        inputTokenAddress: tokenAddress(token),
        amount: amountWei,
        slippage: slippageValue,
        }),
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
  }, [leverage, leverageBounds, market, side, slippageValue, token, validAmount, wallet.address]);

  // The primary action says what the ticket still needs before it can be reviewed.
  const reviewBlocker = !wallet.address ? null
    : amountBlocker(amount, tokenDecimals(token), tokenSymbol(token), selectedTokenBalance)
      ?? (leverage < leverageBounds.min || leverage > leverageBounds.max ? `Choose ${leverageBounds.min.toFixed(1)}×–${leverageBounds.max.toFixed(1)}× leverage` : null)
      ?? (!Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT ? 'Set slippage in settings' : null);

  const marketPositions = positionState.positions.filter((position) => position.market === market);
  const marketHasPendingPosition = positionState.pendingPositions.some((hint) => hint.market === market);
  const showPositionSection = Boolean(wallet.address && (
    marketPositions.length > 0 || marketHasPendingPosition
      || positionState.status === 'partial' || positionState.status === 'unavailable'
  ));
  const highlightedPosition = marketPositions.find((position) => positionKey(position) === highlightedPositionKey);
  const previewPositions = highlightedPosition
    ? [highlightedPosition, ...marketPositions.filter((position) => positionKey(position) !== highlightedPositionKey).slice(-1)]
    : marketPositions.slice(-2).reverse();

  // A confirmed result usually leads to the new position: have its page ready.
  useEffect(() => {
    if (reviewStage === 'result') router.prefetch('/positions');
  }, [reviewStage, router]);

  // "View position" on the new position's result: once the chain has returned
  // the position, the split chosen above travels into the position's own bar;
  // until then its page shows the receipt's syncing row. A second tap while
  // the page changes does nothing.
  const viewingNewPositionRef = useRef(false);
  const viewNewPosition = useCallback(({ key, href }: { key: string; href: string }) => {
    if (viewingNewPositionRef.current) return;
    viewingNewPositionRef.current = true;
    carryNewPosition({
      key,
      readable: positionState.positions.some((position) => positionKey(position) === key),
      navigate: () => router.push(href),
    });
  }, [positionState.positions, router]);

  const handleOpenComplete = async (execution: TransactionExecutionResult, route: PlannedRoute) => {
    if (execution.status !== 'confirmed' || execution.operation !== 'increasePosition' || execution.chainId !== 1
      || execution.walletAddress.toLowerCase() !== wallet.address?.toLowerCase()) return;
    void walletBalances.refresh(true);
    if (await positionState.trackConfirmedPosition(execution, route)) {
      const hint = deriveConfirmedPositionHint({ route, result: execution, walletAddress: execution.walletAddress });
      if (hint) setHighlightedPositionKey(confirmedPositionHintKey(hint));
    } else void positionState.refresh();
  };

  return (
    <AppShell tabs>
      <div className={styles.tradeRoot}>
      <ActionWorkspace className={`${styles.tradeWorkspace} trade-workspace`}>
        <header className={`${styles.tradePageHeading} trade-page-heading`}>
          <div><h1 className="text-display text-[30px] font-semibold leading-tight">Trade</h1></div>
          <div className={`${styles.tradePageActions} trade-page-actions`}>
            <Link href="/positions" className={`${styles.positionsShortcut} glass-press inline-flex min-h-11 items-center gap-2 border text-[13px] font-semibold`}><Layers2 className="h-4 w-4" aria-hidden="true" />Positions</Link>
            {/* The ticket's settings live with the route's other controls, so the form starts at its first decision. */}
            {reviewStage === 'input' && <TransactionSettings slippage />}
          </div>
        </header>

        <div className={styles.tradeLayout} data-trade-layout data-review={reviewStage !== 'input' || undefined}>
        {reviewStage === 'input' && <div className={styles.marketColumn} data-trade-market>
          <TradeMarketChart market={market} onMarketChange={changeMarket} />
        </div>}
        <div className={styles.ticketColumn} data-trade-ticket>
          {/* The editor and review deliberately share one card. ActionReview
              replaces this content in place, keeping the user's exact draft stable while the wallet is opened. */}
          <Card data-result-container className={`${styles.tradeTicket} trade-ticket ${reviewStage === 'input' ? '' : styles.tradeTicketReview}`}>
            <ActionReview
              key={reviewRevision}
              surface="content"
              planBuilder={planBuilder}
              prefetchedPlan={prefetchedPlan}
              blocker={reviewBlocker}
              label={`Open ${market} ${sideLabel}`}
              operationLabel={`Open ${market} ${sideLabel}`}
              onStageChange={handleReviewStageChange}
              preparationFacts={[
                { label: 'Amount', value: `${groupDigits(validAmount ?? amount)} ${tokenSymbol(token)}` },
                { label: 'Target leverage', value: `${leverage}×` },
                { label: 'Position', value: 'New position' },
                { label: 'Slippage', value: `${slippageValue}%` },
              ]}
              draftState={draftState}
              draftActionKey={draftActionKey}
              draftResumePath="/trade"
              resumeReview={resumeReview}
              editor={
                <>
                  <h2 className="sr-only">Open position</h2>
                  <div className={styles.sideControl}><Segmented tone="sides" value={side} onChange={changeSide} ariaLabel="Position side" options={[{ value: 'long', label: 'Long', sub: 'Price rises' }, { value: 'short', label: 'Short', sub: 'Price falls' }]} /></div>

                  <div className={styles.fieldStack}>
                    <AmountField compact label="Amount" symbol={token} value={amount} onChange={changeAmount} maxDecimals={tokenDecimals(token)} showMax showUnitPrice={false} constraintError={token === 'ETH' ? nativeMaxError : undefined} maxAmount={token === 'ETH' ? nativeMaxAmount : undefined} onMax={token === 'ETH' ? resolveNativeMax : undefined} maxPending={token === 'ETH' && nativeMaxPending} balanceState={selectedTokenBalance} tokenSelector={<TokenSelect compact label="Input asset" value={token} options={tokenOptions} onChange={changeToken} balances={wallet.address ? walletBalances.balances : undefined} balanceStatus={wallet.address ? (walletBalances.status !== 'idle' ? walletBalances.status : undefined) : 'disconnected'} />} />
                    <LeverageField label="Target leverage" value={leverage} onChange={changeLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} compact split={{ side, debtLabel: leverageDebtLabel(side, market) }} />
                    {/* Only a connected, complete ticket is warmed; a failed warm-up shows nothing. */}
                    {shownOutcome && shownOutcome.status !== 'failed' && <TradeOutcomePreview market={market} side={side} route={shownOutcome.status === 'ready' ? shownOutcome.route : null} />}
                  </div>
                </>
              }
              onComplete={handleOpenComplete}
              onViewNewPosition={viewNewPosition}
            />
          </Card>
        </div>
        </div>

        {reviewStage === 'input' && showPositionSection && (
          <section aria-labelledby="trade-open-positions-title" className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="trade-open-positions-title" className="text-[15px] font-semibold">Your positions</h2>
              <Link href="/positions" className="glass-press inline-flex min-h-11 items-center gap-1 px-1 text-[13px] font-semibold text-mint">Manage all <ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>
            </div>
            <ProtocolPositionNotice status={positionState.status} failedGroups={positionState.failedGroups} hasPositions={positionState.positions.length + positionState.pendingPositions.length > 0} refreshing={positionState.refreshing} onRefresh={() => void positionState.refresh()} compact />
            <ConfirmedPositionCards market={market} />
            {marketPositions.length > 0 && (
              // Each row opens its position, where every action and figure is.
              <ProtocolPositionList label="Your positions">
                {previewPositions.map((position) => {
                  const key = positionKey(position);
                  return <ProtocolPositionCard key={key} position={position} href={positionHref(position.market, position.side, position.info.positionId)} highlighted={key === highlightedPositionKey} />;
                })}
              </ProtocolPositionList>
            )}
          </section>
        )}
        {reviewStage === 'input' && <TradeSections market={market} side={side} leverage={leverageBounds}
          openPositions={wallet.address && positionState.status === 'ready' ? marketPositions.length : null}
          positionsStatus={!wallet.address ? 'disconnected' : positionState.status === 'ready' ? 'ready' : positionState.status === 'idle' || positionState.status === 'loading' ? 'loading' : 'unavailable'} />}
      </ActionWorkspace>
      </div>
    </AppShell>
  );
}
