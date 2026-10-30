'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FX_TOKENS, prepareRoutesForReview, runTransactionRoute, type PlannedRoute, type PlanStatus, type TransactionExecutionResult, type TransactionStepResult } from '@/lib/fx';
import { cancelSignatureRequiredDraft, removeSignatureRequiredDraft, saveSignatureRequiredDraft, shouldRemoveSignatureDraft } from '@/lib/fx';
import { routeGasCostCache, useRouteGasCost } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { useInvalidateWalletData } from '@/components/WalletDataProvider';
import { createRouteWalletRefresh } from '@/lib/walletDataRefresh';
import { haptic } from '@/lib/telegram';
import { userSafeError } from '@/lib/errors';
import { hasTransactionHash, transactionStepProgress } from '@/lib/transactionProgress';
import { chainName } from '@/components/review/ReviewProgress';
import { primaryReviewFacts } from '@/components/review/actionReviewPresentation';
import { fetchGasTierQuotes, formatGasTierQuote, selectedGasTierQuote, type GasFeeSelection } from '@/lib/fx/gasFeePolicy';
import { announceSettingsUpdated, readGasTier, readSlippagePercent, SETTINGS_KEY, SETTINGS_UPDATED_EVENT, type GasTier } from '@/lib/settings';
import { changedConsequenceFacts, reviewCompletionSessionIsCurrent, reviewGenerationIsCurrent, updatedRouteTermsRequired, type ChangedReviewFact, type ReviewTransition } from '@/components/review/actionReviewModel';
import { useActionReviewController } from '@/components/review/useActionReviewController';
import type { ActionReviewProps } from './actionReviewTypes';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import { createReviewPreparationScope } from './reviewPreparationScope';

const REVIEW_FRESHNESS_MS = 30_000;

/** A bridge receipt estimate ages from its read, including time spent preparing. */
function routeEstimateReadAt(route: PlannedRoute): number {
  const quote = route.operation === 'buildBridgeTx' && route.quote && typeof route.quote === 'object'
    ? route.quote as { receiptReadAt?: unknown } : undefined;
  const receiptReadAt = quote?.receiptReadAt;
  return Math.min(
    route.details?.fxSaveQuote?.readAt ?? Infinity,
    typeof receiptReadAt === 'number' && Number.isSafeInteger(receiptReadAt) && receiptReadAt > 0
      ? receiptReadAt : Infinity,
  );
}

function asRoutes(value: PlannedRoute | readonly PlannedRoute[]): PlannedRoute[] {
  const routes = Array.isArray(value) ? [...value] : [value];
  if (!routes.length) throw new Error('No executable transaction route was returned.');
  return routes;
}

function signatureDraftActionKey(route: PlannedRoute): string {
  const details = route.details;
  return [route.operation, details?.routeType ?? '', details?.positionId ?? '', details?.requestedAmount ?? '', details?.requestedLeverage ?? '', details?.slippagePercent ?? '', route.transactions.length].join(':').slice(0, 160);
}

export function useActionReviewLifecycle(props: ActionReviewProps) {
  const {
    planBuilder,
    prefetchedPlan,
    disabled = false,
    onComplete,
    operationLabel,
    onStageChange,
    draftState,
    draftActionKey,
    draftResumePath,
    resumeReview = 0,
  } = props;

  const wallet = usePrivyWallet();
  const invalidateWalletData = useInvalidateWalletData();
  const { stage, acceptRoute, expireQuote, clearAcceptedRoute, quoteExpired, acceptedTerms, transition: transitionStage, matchesAcceptedRoute, bindSession, clearSession, reviewSession, sessionMismatch, checkSession } = useActionReviewController();
  const [routes, setRoutes] = useState<PlannedRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PlanStatus>('planning');
  const [statusDetail, setStatusDetail] = useState('');
  const [result, setResult] = useState<TransactionExecutionResult | null>(null);
  const [stepResults, setStepResults] = useState<TransactionStepResult[]>([]);
  const [executionRoute, setExecutionRoute] = useState<PlannedRoute | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewTitle, setReviewTitle] = useState<string | null>(null);
  const [quoteChanges, setQuoteChanges] = useState<ChangedReviewFact[]>([]);
  const [networkSwitching, setNetworkSwitching] = useState(false);
  const [resumeAfterConnect, setResumeAfterConnect] = useState(false);
  const [preparedAt, setPreparedAt] = useState<number | null>(null);
  const [feeSelection, setFeeSelection] = useState<GasFeeSelection | null>(null);
  const transition = useCallback((event: ReviewTransition) => {
    transitionStage(event, status === 'awaiting-user');
  }, [status, transitionStage]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // React state updates are asynchronous; latch before any wallet request so
  // repeated clicks in the same frame cannot start a second execution.
  const busyRef = useRef(false);
  const changingFeeRef = useRef(false);
  const preparationScopeRef = useRef<ReturnType<typeof createReviewPreparationScope> | null>(null);
  const executionStepsRef = useRef<TransactionStepResult[]>([]);
  // A submitted execution keeps its route and progress visible if the active
  // wallet changes. The latch still blocks every later wallet request.
  const executionSessionInvalidatedRef = useRef(false);
  const signatureDraftIdRef = useRef<string | null>(null);
  const resumedReviewRef = useRef<number | null>(null);
  // Every asynchronous planning/execution attempt owns a generation. Route,
  // account, and component changes invalidate the generation so late SDK/RPC
  // responses can never repopulate a newer wallet session.
  const generationRef = useRef(0);
  const failedPreparationGenerationRef = useRef<number | null>(null);
  const preparedAtRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const liveWalletRef = useRef({
    authenticated: wallet.authenticated,
    address: wallet.address,
    chainId: wallet.chainId,
    connectionVersion: wallet.connectionVersion,
    isEmbedded: wallet.isEmbedded,
    waitForPreviousConfirmationClose: wallet.waitForPreviousConfirmationClose,
  });
  const onStageChangeRef = useRef(onStageChange);
  onStageChangeRef.current = onStageChange;

  const isCurrentGeneration = useCallback((generation: number) => (
    reviewGenerationIsCurrent(mountedRef.current, generationRef.current, generation)
  ), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      preparationScopeRef.current?.cancel();
    };
  }, []);

  // Keep the owning product card synchronized without depending on callback
  // identity (route pages commonly pass an inline setter).
  useEffect(() => {
    onStageChangeRef.current?.(stage);
  }, [stage]);
  liveWalletRef.current = {
    authenticated: wallet.authenticated,
    address: wallet.address,
    chainId: wallet.chainId,
    connectionVersion: wallet.connectionVersion,
    isEmbedded: wallet.isEmbedded,
    waitForPreviousConfirmationClose: wallet.waitForPreviousConfirmationClose,
  };

  const route = (stage === 'executing' || stage === 'result') && executionRoute
    ? executionRoute
    : routes[selectedRoute];
  const routeChainId = route?.chainId;
  const currentGasTier = readGasTier();
  const selectedFeeQuote = useMemo(() => {
    if (!wallet.isEmbedded || !routeChainId || feeSelection?.snapshot.chainId !== routeChainId || feeSelection.tier !== currentGasTier) return undefined;
    try { return selectedGasTierQuote(feeSelection.snapshot, feeSelection.tier); } catch { return undefined; }
  }, [currentGasTier, feeSelection, routeChainId, wallet.isEmbedded]);
  const gasCost = useRouteGasCost(route, {
    enabled: Boolean(route && stage !== 'planning' && (!wallet.isEmbedded || selectedFeeQuote)),
    feeTierQuote: selectedFeeQuote,
  });
  const intentKey = draftState === undefined ? planBuilder : JSON.stringify(draftState);
  const previousIntentKey = useRef<typeof intentKey>(intentKey);
  const liveIntentKeyRef = useRef<typeof intentKey>(intentKey);
  liveIntentKeyRef.current = intentKey;
  const previousWalletMode = useRef(wallet.isEmbedded);
  const acceptedWalletModeRef = useRef<boolean | null>(null);
  const liveActionRef = useRef({ disabled, available: Boolean(planBuilder) });
  liveActionRef.current = { disabled, available: Boolean(planBuilder) };

  useEffect(() => {
    if (stage !== 'review' || preparedAt === null) return undefined;
    const remaining = Math.max(0, REVIEW_FRESHNESS_MS - (Date.now() - preparedAt));
    const timer = window.setTimeout(() => {
      expireQuote();
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [expireQuote, preparedAt, stage]);

  const previousStageRef = useRef(stage);
  useEffect(() => {
    const previous = previousStageRef.current;
    previousStageRef.current = stage;
    // Each view that replaces the editor takes focus at its heading, so focus
    // never falls back to the page when the Review button unmounts. A failed
    // preparation returns focus to the action that tries again.
    if (stage === 'result' || stage === 'review') {
      // A phone sheet owns its initial focus (its Close control); the review leaves it there.
      if (stage === 'review' && headingRef.current?.closest('[data-mobile-review-sheet]')) return;
      headingRef.current?.focus({ preventScroll: true });
    } else if (stage === 'input' && previous === 'planning') {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [stage]);

  const reset = useCallback(() => {
    // A confirmed result is already safe to leave while its captured cache and
    // position refreshes finish. Invalidating the generation below suppresses
    // their late view updates without cancelling those completion side effects.
    if (busyRef.current && stage !== 'planning' && stage !== 'result') return;
    busyRef.current = false;
    setLoading(false);
    generationRef.current += 1;
    preparationScopeRef.current?.cancel();
    if (signatureDraftIdRef.current) {
      cancelSignatureRequiredDraft(signatureDraftIdRef.current);
      signatureDraftIdRef.current = null;
    }
    transition('return-to-input');
    setNetworkSwitching(false);
    setRoutes([]);
    setSelectedRoute(0);
    setError(null);
    setResult(null);
    setStepResults([]);
    setExecutionRoute(null);
    setFeeSelection(null);
    executionStepsRef.current = [];
    setRefreshing(false);
    setReviewTitle(null);
    clearAcceptedRoute();
    acceptedWalletModeRef.current = null;
    clearSession();
    setResumeAfterConnect(false);
    setStatus('planning');
    setStatusDetail('');
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, [clearAcceptedRoute, clearSession, stage, transition]);

  useEffect(() => {
    const invalidateForTierChange = () => {
      if (wallet.isEmbedded && !changingFeeRef.current && stage === 'review' && feeSelection && readGasTier() !== feeSelection.tier) {
        expireQuote();
        setError('Network fee preference changed. Review the updated fee before signing.');
        setStatus('reviewing');
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SETTINGS_KEY) invalidateForTierChange();
    };
    window.addEventListener(SETTINGS_UPDATED_EVENT, invalidateForTierChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SETTINGS_UPDATED_EVENT, invalidateForTierChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [expireQuote, feeSelection, stage, wallet.isEmbedded]);

  useEffect(() => {
    const onTelegramBack = (event: Event) => {
      if (stage !== 'review' && stage !== 'result' && stage !== 'planning') return;
      const detail = (event as CustomEvent<{ consume?: () => void; isConsumed?: () => boolean }>).detail;
      if (detail?.isConsumed?.()) return;
      reset();
      detail?.consume?.();
    };
    window.addEventListener('fxaeon:telegram-back', onTelegramBack);
    return () => window.removeEventListener('fxaeon:telegram-back', onTelegramBack);
  }, [reset, stage]);

  const invalidatePreparedRoute = useCallback((message: string) => {
    generationRef.current += 1;
    preparationScopeRef.current?.cancel();
    if (signatureDraftIdRef.current) {
      cancelSignatureRequiredDraft(signatureDraftIdRef.current);
      signatureDraftIdRef.current = null;
    }
    transition('return-to-input');
    setRoutes([]);
    setSelectedRoute(0);
    setResult(null);
    setStepResults([]);
    setExecutionRoute(null);
    setReviewTitle(null);
    expireQuote();
    clearSession();
    acceptedWalletModeRef.current = null;
    setResumeAfterConnect(false);
    setStatus('planning');
    setStatusDetail('');
    setLoading(false);
    setRefreshing(false);
    setNetworkSwitching(false);
    busyRef.current = false;
    setError(message);
  }, [clearSession, expireQuote, transition]);

  useEffect(() => {
    if (previousWalletMode.current === wallet.isEmbedded) return;
    previousWalletMode.current = wallet.isEmbedded;
    setFeeSelection(null);
    if (stage === 'executing') {
      executionSessionInvalidatedRef.current = true;
      setError('Wallet connection changed during this action. No later transaction will be requested.');
    } else if (stage === 'review' || stage === 'planning') {
      invalidatePreparedRoute('Wallet connection changed. Review the action again before signing.');
    }
  }, [invalidatePreparedRoute, stage, wallet.isEmbedded]);

  useEffect(() => {
    if (stage === 'planning' && (disabled || !planBuilder)) {
      invalidatePreparedRoute('This action is no longer available. Check the inputs and try again.');
    }
  }, [disabled, invalidatePreparedRoute, planBuilder, stage]);

  // Bind the reviewed route to logical form intent. Callers with a primitive
  // draft snapshot may recreate planners during claim/balance polling without
  // changing what the user accepted.
  useEffect(() => {
    if (previousIntentKey.current !== intentKey) {
      previousIntentKey.current = intentKey;
      if ((stage === 'review' || (stage === 'planning' && status !== 'failed'))
        && failedPreparationGenerationRef.current !== generationRef.current) {
        const generation = generationRef.current;
        const invalidate = () => {
          if (generationRef.current === generation && failedPreparationGenerationRef.current !== generation) {
            invalidatePreparedRoute('The inputs changed. Check the action again before signing.');
          }
        };
        if (loading) {
          // Let a planner's synchronous input correction and rejection settle
          // together. A successful plan separately checks live intent before
          // acceptance, so this turn cannot accept an obsolete route.
          const timer = window.setTimeout(invalidate, 0);
          return () => window.clearTimeout(timer);
        }
        invalidate();
      }
    }
  }, [invalidatePreparedRoute, intentKey, loading, stage, status]);

  useEffect(() => {
    // Results are non-signable historical evidence. Retain their original
    // wallet and chain when the active wallet or form changes.
    if (!reviewSession || (stage !== 'planning' && stage !== 'review' && stage !== 'executing')) return;
    const currentWallet = wallet.address?.toLowerCase();
    const mismatch = sessionMismatch({
      walletAddress: currentWallet ?? '', authenticated: wallet.authenticated,
      chainId: wallet.chainId, connectionVersion: wallet.connectionVersion,
    });
    if (mismatch) {
      const message = mismatch === 'wallet'
        ? 'The selected wallet changed during this action. No later transaction will be requested.'
        : mismatch === 'network'
          ? 'The wallet network changed. Check the action again before signing.'
          : 'The wallet connection changed during this action. No later transaction will be requested.';
      if (stage === 'executing') {
        // Keep the original route mounted while an already-open wallet prompt
        // settles. A returned hash still needs to reach the journal and UI.
        executionSessionInvalidatedRef.current = true;
        setError(message);
      } else {
        invalidatePreparedRoute(mismatch === 'wallet'
          ? 'The selected wallet changed. Check the action again before signing.'
          : mismatch === 'network'
            ? 'The wallet network changed. Check the action again before signing.'
            : 'The wallet connection changed. Check the action again before signing.');
      }
    }
  }, [invalidatePreparedRoute, reviewSession, sessionMismatch, stage, wallet.address, wallet.authenticated, wallet.chainId, wallet.connectionVersion]);

  const review = useCallback(async () => {
    if (!planBuilder || disabled || loading || busyRef.current || stage !== 'input') return;
    if (!wallet.authenticated || !wallet.address) {
      setError('Connect a wallet before preparing a transaction.');
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const preparation = createReviewPreparationScope();
    preparationScopeRef.current = preparation;
    const reviewWalletAddress = wallet.address.toLowerCase();
    const reviewChainId = wallet.chainId;
    const requestedGasTier = wallet.isEmbedded ? readGasTier() : undefined;
    const reviewIsEmbedded = wallet.isEmbedded;
    const reviewConnectionVersion = wallet.connectionVersion;
    const reviewSessionSnapshot = { walletAddress: reviewWalletAddress, chainId: reviewChainId, connectionVersion: reviewConnectionVersion };
    const assertReviewSession = () => {
      if (!isCurrentGeneration(generation)) return false;
      if (liveActionRef.current.disabled || !liveActionRef.current.available) {
        invalidatePreparedRoute('This action is no longer available. Check the inputs and try again.');
        return false;
      }
      if (liveIntentKeyRef.current !== intentKey) {
        invalidatePreparedRoute('The inputs changed. Check the action again before signing.');
        return false;
      }
      const liveWallet = liveWalletRef.current;
      const mismatch = checkSession(reviewSessionSnapshot, {
        walletAddress: liveWallet.address?.toLowerCase() ?? '', authenticated: liveWallet.authenticated,
        chainId: liveWallet.chainId, connectionVersion: liveWallet.connectionVersion,
      });
      if (liveWallet.isEmbedded !== reviewIsEmbedded) throw new Error('The wallet connection changed while preparing the review.');
      if (mismatch) throw new Error(mismatch === 'wallet'
        ? 'The selected wallet changed while preparing the review.'
        : mismatch === 'network'
          ? 'The wallet network changed while preparing the review.'
          : 'The selected wallet connection changed while preparing the review.');
      return true;
    };
    busyRef.current = true;
    setLoading(true);
    transition('prepare');
    // A new attempt must not display or accept any previous review metadata.
    clearAcceptedRoute();
    bindSession(reviewSessionSnapshot);
    acceptedWalletModeRef.current = null;
    setRoutes([]);
    setSelectedRoute(0);
    setFeeSelection(null);
    setQuoteChanges([]);
    setPreparedAt(null);
    preparedAtRef.current = null;
    setError(null);
    setStatus('planning');
    setStatusDetail('Preparing a fresh route.');
    try {
      const prefetched = await preparation.wait(prefetchedPlan?.());
      if (!assertReviewSession()) return;
      const planned = asRoutes(prefetched ?? await preparation.wait(planBuilder()));
      if (!assertReviewSession()) return;
      setStatus('reviewing');
      setStatusDetail('Verifying the route.');
      const walletAddress = reviewWalletAddress;
      // Alternatives are independent; checking them concurrently removes one
      // RPC round trip per extra route from the review's critical path.
      const [{ viable, failures }, initialFeeSnapshot] = await preparation.wait(Promise.all([
        prepareRoutesForReview(planned, walletAddress),
        wallet.isEmbedded ? fetchGasTierQuotes(planned[0].chainId) : Promise.resolve(undefined),
      ]));
      if (!assertReviewSession()) return;
      if (!viable.length) {
        throw new Error(`The transaction could not be simulated: ${failures.join('; ')}`);
      }
      if (!assertReviewSession()) return;
      const feeSnapshot = wallet.isEmbedded && initialFeeSnapshot?.chainId !== viable[0].chainId
        ? await preparation.wait(fetchGasTierQuotes(viable[0].chainId)) : initialFeeSnapshot;
      if (!assertReviewSession()) return;
      if (wallet.isEmbedded) {
        if (!feeSnapshot || requestedGasTier === undefined) throw new Error('Selected network fee is unavailable. Review the action again.');
        selectedGasTierQuote(feeSnapshot, requestedGasTier);
        if (readGasTier() !== requestedGasTier) throw new Error('Network fee preference changed while preparing the review. Try reviewing again.');
      }
      setStatusDetail('Checking network fees and available ETH.');
      if (wallet.isEmbedded && viable.some(candidate => feeSnapshot?.chainId !== candidate.chainId)) throw new Error('Alternative route network fees are unavailable. Review the action again.');
      const feeQuote = feeSnapshot && requestedGasTier ? selectedGasTierQuote(feeSnapshot, requestedGasTier) : undefined;
      const gasEstimates = await preparation.wait(Promise.all(viable.map(candidate => routeGasCostCache.refresh(candidate, { feeTierQuote: feeQuote }))));
      if (!assertReviewSession()) return;
      if (gasEstimates.some(estimate => estimate.validUntil <= Date.now())) throw new Error('Network fee estimates expired while preparing the review. Try again.');
      if (wallet.isEmbedded && feeSnapshot && requestedGasTier) {
        selectedGasTierQuote(feeSnapshot, requestedGasTier);
        if (readGasTier() !== requestedGasTier) throw new Error('Network fee preference changed while preparing the review. Try reviewing again.');
      }
      if (viable.some(candidate => Date.now() - routeEstimateReadAt(candidate) >= REVIEW_FRESHNESS_MS)) throw new Error('The quote expired while preparing the review. Try again.');
      setRoutes(viable);
      setSelectedRoute(0);
      setStepResults([]);
      executionStepsRef.current = [];
      setExecutionRoute(null);
      setFeeSelection(wallet.isEmbedded && feeSnapshot && requestedGasTier
        ? { snapshot: feeSnapshot, tier: requestedGasTier }
        : null);
      // Snapshot the action with its calldata so later form changes cannot
      // rename the route the user reviewed.
      setReviewTitle(operationLabel ?? viable[0].operation);
      acceptedWalletModeRef.current = reviewIsEmbedded;
      bindSession({ walletAddress, chainId: wallet.chainId, connectionVersion: wallet.connectionVersion });
      setStatus('reviewing');
      setStatusDetail('Route ready.');
      // Align the ordinary review freshness window with the earlier of route
      // quote and gas quote expiry; neither can silently outlive the other.
      const preparedAt = Math.min(
        Date.now(),
        feeSnapshot ? feeSnapshot.validUntil - REVIEW_FRESHNESS_MS : Infinity,
        ...viable.map(routeEstimateReadAt),
      );
      acceptRoute(viable[0], intentKey);
      setQuoteChanges([]);
      preparedAtRef.current = preparedAt;
      setPreparedAt(preparedAt);
      transition('prepared');
      haptic('selection');
    } catch (cause) {
      if (!isCurrentGeneration(generation)) return;
      // Preparation never opens a review surface. All failures return to the
      // editor, including Trade's former stable preparation presentation.
      transition('prepare-failed');
      // The planner may update its own clamped input before rejecting. An
      // already-scheduled input effect must not replace that failure message.
      failedPreparationGenerationRef.current = generation;
      setStatus('failed');
      setError(userSafeError(cause, 'The transaction could not be prepared. Check the inputs and network, then try again.'));
      haptic('error');
    } finally {
      if (preparationScopeRef.current === preparation) preparationScopeRef.current = null;
      preparation.cancel();
      if (isCurrentGeneration(generation)) {
        busyRef.current = false;
        setLoading(false);
      }
    }
  }, [acceptRoute, bindSession, checkSession, clearAcceptedRoute, disabled, invalidatePreparedRoute, isCurrentGeneration, loading, operationLabel, planBuilder, prefetchedPlan, intentKey, setQuoteChanges, stage, transition, wallet.address, wallet.authenticated, wallet.chainId, wallet.connectionVersion, wallet.isEmbedded]);

  const refreshReviewedQuote = useCallback(async () => {
    if (stage !== 'review' || !quoteExpired || !planBuilder || disabled || busyRef.current) return;
    const reviewed = routes[selectedRoute];
    if (!reviewed) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const preparation = createReviewPreparationScope();
    preparationScopeRef.current = preparation;
    const walletAddress = reviewed.walletAddress.toLowerCase();
    const sessionChainId = wallet.chainId;
    const connectionVersion = wallet.connectionVersion;
    const requestedGasTier = wallet.isEmbedded ? readGasTier() : undefined;
    const reviewIsEmbedded = wallet.isEmbedded;
    const sessionMatches = (allowChangedIntent = false) => {
      if (!isCurrentGeneration(generation)) return false;
      if (!allowChangedIntent && liveIntentKeyRef.current !== intentKey) {
        invalidatePreparedRoute('The inputs changed. Check the action again before signing.');
        return false;
      }
      const live = liveWalletRef.current;
      return live.authenticated
        && live.address?.toLowerCase() === walletAddress
        && live.chainId === sessionChainId
        && live.connectionVersion === connectionVersion
        && live.isEmbedded === reviewIsEmbedded;
    };
    busyRef.current = true;
    setLoading(true);
    setError(null);
    setStatus('planning');
    setStatusDetail('Preparing an updated quote.');
    try {
      const planned = asRoutes(await preparation.wait(planBuilder()));
      if (!sessionMatches()) return;
      setStatus('reviewing');
      const [preparedRoutes, preparedFeeSnapshot] = await preparation.wait(Promise.all([
        prepareRoutesForReview(planned, walletAddress),
        wallet.isEmbedded ? fetchGasTierQuotes(reviewed.chainId) : Promise.resolve(undefined),
      ]));
      if (!sessionMatches()) return;
      const { viable, failures } = preparedRoutes;
      if (!viable.length) throw new Error(`The updated transaction could not be simulated: ${failures.join('; ')}`);
      const next = viable[0];
      let feeSnapshot: Awaited<ReturnType<typeof fetchGasTierQuotes>> | undefined;
      if (wallet.isEmbedded) {
        feeSnapshot = preparedFeeSnapshot?.chainId === next.chainId
          ? preparedFeeSnapshot
          : await preparation.wait(fetchGasTierQuotes(next.chainId));
      }
      if (wallet.isEmbedded && (!feeSnapshot || requestedGasTier === undefined)) {
        throw new Error('Selected network fee is unavailable. Review the action again.');
      }
      const nextFeeQuote = feeSnapshot && requestedGasTier ? selectedGasTierQuote(feeSnapshot, requestedGasTier) : undefined;
      if (!sessionMatches()) return;
      if (wallet.isEmbedded && requestedGasTier && readGasTier() !== requestedGasTier) throw new Error('Network fee preference changed while preparing the updated review. Try again.');
      setStatusDetail('Checking updated network fees and available ETH.');
      if (wallet.isEmbedded && viable.some(candidate => feeSnapshot?.chainId !== candidate.chainId)) throw new Error('Alternative route network fees are unavailable. Review the action again.');
      const gasEstimates = await preparation.wait(Promise.all(viable.map(candidate => routeGasCostCache.refresh(candidate, { feeTierQuote: nextFeeQuote }))));
      if (!sessionMatches()) return;
      if (gasEstimates.some(estimate => estimate.validUntil <= Date.now())) throw new Error('Network fee estimates expired while updating the review. Try again.');
      if (feeSnapshot && requestedGasTier) selectedGasTierQuote(feeSnapshot, requestedGasTier);
      if (wallet.isEmbedded && requestedGasTier && readGasTier() !== requestedGasTier) throw new Error('Network fee preference changed while preparing the updated review. Try again.');
      if (viable.some(candidate => Date.now() - routeEstimateReadAt(candidate) >= REVIEW_FRESHNESS_MS)) throw new Error('The updated quote expired while preparing the review. Try again.');
      const termsChanged = updatedRouteTermsRequired(acceptedTerms, next);
      const previousFacts = primaryReviewFacts(reviewed, { historicalComparison: true });
      const nextFacts = primaryReviewFacts(next);
      const factChanges = changedConsequenceFacts(previousFacts, nextFacts);
      const previousRouteType = reviewed.details?.routeType;
      const nextRouteType = next.details?.routeType;
      if (previousRouteType !== nextRouteType && (previousRouteType || nextRouteType)) {
        factChanges.push({ label: 'Route', before: previousRouteType, after: nextRouteType });
      }
      const previousFeeQuote = wallet.isEmbedded && feeSelection?.snapshot.chainId === reviewed.chainId
        ? feeSelection.snapshot.tiers[feeSelection.tier]
        : undefined;
      const previousFeeValue = previousFeeQuote ? formatGasTierQuote(previousFeeQuote) : undefined;
      const nextFeeValue = nextFeeQuote ? formatGasTierQuote(nextFeeQuote) : undefined;
      if (previousFeeValue !== nextFeeValue) {
        factChanges.push({ label: 'Gas tier', before: previousFeeValue, after: nextFeeValue });
      }
      setQuoteChanges(factChanges);
      setRoutes(viable);
      setFeeSelection(feeSnapshot && requestedGasTier ? { snapshot: feeSnapshot, tier: requestedGasTier } : null);
      setSelectedRoute(0);
      setStepResults([]);
      executionStepsRef.current = [];
      setReviewTitle(operationLabel ?? next.operation);
      acceptedWalletModeRef.current = reviewIsEmbedded;
      bindSession({ walletAddress, chainId: sessionChainId, connectionVersion });
      acceptRoute(next, intentKey);
      const updatedPreparedAt = Math.min(
        Date.now(),
        feeSnapshot ? feeSnapshot.validUntil - REVIEW_FRESHNESS_MS : Infinity,
        ...viable.map(routeEstimateReadAt),
      );
      setPreparedAt(updatedPreparedAt);
      preparedAtRef.current = updatedPreparedAt;
      if (termsChanged && factChanges.length === 0) {
        setQuoteChanges([{ label: 'Transaction route', before: 'Previously reviewed route', after: 'Updated route' }]);
      }
      setStatus('reviewing');
      setStatusDetail('Review the updated transaction terms.');
      haptic('selection');
    } catch (cause) {
      if (sessionMatches(true)) {
        // A refresh starts from an expired, non-signable route. Preserve a
        // planner's self-clamp failure; the next refresh uses the new inputs.
        failedPreparationGenerationRef.current = generation;
        setError(userSafeError(cause, 'The updated quote could not be prepared. The reviewed terms remain unchanged.'));
        setStatus('failed');
      }
    } finally {
      if (preparationScopeRef.current === preparation) preparationScopeRef.current = null;
      preparation.cancel();
      if (isCurrentGeneration(generation)) {
        busyRef.current = false;
        setLoading(false);
      }
    }
  }, [acceptRoute, acceptedTerms, bindSession, disabled, feeSelection, invalidatePreparedRoute, isCurrentGeneration, operationLabel, planBuilder, intentKey, quoteExpired, routes, selectedRoute, stage, wallet.chainId, wallet.connectionVersion, wallet.isEmbedded]);

  // History restores editable primitives only. Once the route owner has
  // applied those values and exposes its planner, immediately reopen the
  // exact review surface so the user can continue signing without having to
  // press Review a second time. This is deliberately one-shot per nonce:
  // reconnects and planner refreshes can never trigger an implicit wallet
  // request or loop back into review.
  useEffect(() => {
    if (resumeReview <= 0) {
      resumedReviewRef.current = null;
      return;
    }
    if (resumedReviewRef.current === resumeReview || stage !== 'input' || loading || disabled) return;
    if (!wallet.authenticated || !wallet.address || !planBuilder) return;
    resumedReviewRef.current = resumeReview;
    void review();
  }, [disabled, loading, planBuilder, resumeReview, review, stage, wallet.address, wallet.authenticated]);

  const execute = useCallback(async () => {
    const startingRoute = route;
    if (disabled || !planBuilder || !startingRoute || gasCost.checking || loading || busyRef.current || stage !== 'review' || status === 'failed' || stepResults.some(hasTransactionHash)) return;
    // A click can arrive after wallet context commits and before passive
    // invalidation runs. Bind execution only to the session already reviewed.
    const live = liveWalletRef.current;
    if (!reviewSession || sessionMismatch({
      walletAddress: live.address?.toLowerCase() ?? '', authenticated: live.authenticated,
      chainId: live.chainId, connectionVersion: live.connectionVersion,
    }) || live.isEmbedded !== acceptedWalletModeRef.current) {
      invalidatePreparedRoute('The wallet connection changed. Check the action again before signing.');
      return;
    }
    if (wallet.isEmbedded && (!feeSelection
      || feeSelection.snapshot.chainId !== startingRoute.chainId
      || feeSelection.tier !== readGasTier()
      || feeSelection.snapshot.validUntil <= Date.now())) {
      expireQuote();
      setError('The selected network fee changed or expired. Review the updated fee before signing.');
      setStatus('reviewing');
      return;
    }
    if (!matchesAcceptedRoute(startingRoute, intentKey) || quoteExpired
      || !preparedAtRef.current || Date.now() - preparedAtRef.current >= REVIEW_FRESHNESS_MS) {
      expireQuote();
      setError('Review an updated quote before signing.');
      setStatus('reviewing');
      return;
    }
    const executionWalletAddress = startingRoute.walletAddress.toLowerCase();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    executionSessionInvalidatedRef.current = false;
    const executionConnectionVersion = wallet.connectionVersion;
    const executionIsEmbedded = wallet.isEmbedded;
    const isMountedExecution = () => isCurrentGeneration(generation);
    const isCurrentCompletionSession = () => reviewCompletionSessionIsCurrent(
      executionSessionInvalidatedRef.current,
      { walletAddress: executionWalletAddress, connectionVersion: executionConnectionVersion, isEmbedded: executionIsEmbedded },
      liveWalletRef.current,
    );
    const isCurrentExecution = () => {
      return isMountedExecution() && isCurrentCompletionSession();
    };
    busyRef.current = true;
    setLoading(true);
    setError(null);
    // Bind the displayed route to this wallet session before simulation.
    // Deliberate network switching remains valid during execution, while
    // account/reconnect changes invalidate this context.
    bindSession({ walletAddress: executionWalletAddress, connectionVersion: executionConnectionVersion });
    transition('begin-signing');
    // Keep the displayed route visible while the runner performs its final
    // policy validation and simulation immediately before each wallet request.
    setExecutionRoute(startingRoute);
    setStatus('planning');
    setStatusDetail('Checking the displayed quote before signing.');
    setStepResults([]);
    executionStepsRef.current = [];
    setRefreshing(false);
    // Scope refreshes to the captured review, never the currently selected wallet.
    const refreshWallet = createRouteWalletRefresh(invalidateWalletData);
    const currentRoute = startingRoute;
    let postConfirmReadStarted = false;
    // The runner signs copies of the planned transactions, so the step being
    // signed is the index it announces before each one, not an identity lookup.
    let signingStepIndex = -1;
    try {
      setExecutionRoute(currentRoute);
      const execution = await runTransactionRoute({
        route: currentRoute,
        feeSelection: executionIsEmbedded ? feeSelection ?? undefined : undefined,
        callbacks: {
          beforeTransaction: async (index) => {
            signingStepIndex = index;
            if (index === 0) return;
            const liveWallet = liveWalletRef.current;
            if (!isCurrentExecution()
              || !liveWallet.authenticated
              || liveWallet.address?.toLowerCase() !== startingRoute.walletAddress.toLowerCase()
              || liveWallet.connectionVersion !== executionConnectionVersion
              || liveWallet.isEmbedded !== executionIsEmbedded) {
              throw new Error('The selected wallet changed before the next transaction review.');
            }
            await liveWallet.waitForPreviousConfirmationClose?.();
            if (!isCurrentExecution()) throw new Error('The selected wallet changed while waiting to continue.');
          },
          ensureChain: async (chainId) => {
            if (!isCurrentExecution()) throw new Error('The selected wallet changed before the network switch.');
            setNetworkSwitching(true);
            try {
              await wallet.switchChain(chainId);
              if (!isCurrentExecution()) throw new Error('The selected wallet changed during the network switch.');
            } finally {
              if (isMountedExecution()) setNetworkSwitching(false);
            }
          },
          requestSignature: async (request, transaction) => {
            const liveWallet = liveWalletRef.current;
            if (!isCurrentExecution()
              || !liveWallet.authenticated
              || liveWallet.address?.toLowerCase() !== request.from.toLowerCase()
              || liveWallet.connectionVersion !== executionConnectionVersion
              || liveWallet.isEmbedded !== executionIsEmbedded) {
              throw new Error('The selected wallet changed before signing.');
            }
            setStatus('awaiting-user');
            const approvalToken = Object.values(FX_TOKENS).find((token) => token.address.toLowerCase() === transaction.to.toLowerCase());
            const signingLabel = transaction.kind === 'approval'
              ? transaction.type === 'approvePosition' ? 'Approve position' : `Approve ${approvalToken ? tokenSymbol(approvalToken.key) : 'token'}`
              : 'Confirm';
            // Name the exact request the wallet is showing; the status model
            // appends the instruction to review it there.
            const stepIndex = signingStepIndex;
            const stepCount = currentRoute.transactions.length;
            const requestLabel = transaction.kind === 'approval' ? signingLabel : `Confirm ${reviewTitle ?? 'the action'}`;
            setStatusDetail(stepCount > 1 && stepIndex >= 0 ? `${requestLabel} (step ${stepIndex + 1} of ${stepCount})` : requestLabel);
            // Persist the unsigned resume hint only after the runner's final
            // validation/simulation has reached the wallet request boundary.
            if (!signatureDraftIdRef.current) {
              try {
                const draft = saveSignatureRequiredDraft({
                  walletAddress: startingRoute.walletAddress,
                  chainId: startingRoute.chainId,
                  operation: startingRoute.operation,
                  actionKey: draftActionKey ?? signatureDraftActionKey(startingRoute),
                  resumePath: draftResumePath ?? `${window.location.pathname}${window.location.search}${window.location.hash}`,
                  formState: draftState,
                });
                signatureDraftIdRef.current = draft.id;
              } catch {
                signatureDraftIdRef.current = null;
              }
            }
            const signed = await wallet.sendTransaction({
              chainId: request.chainId,
              from: request.from,
              to: request.to,
              data: request.data,
              value: request.value,
              nonce: request.nonce,
              gasLimit: request.gasLimit,
              gasPrice: request.gasPrice,
              maxFeePerGas: request.maxFeePerGas,
              maxPriorityFeePerGas: request.maxPriorityFeePerGas,
            }, {
              action: transaction.kind === 'approval' ? signingLabel : reviewTitle ?? currentRoute.operation,
              description: transaction.kind === 'approval' ? `${signingLabel} for this action.` : `${reviewTitle ?? 'Confirm action'} on ${chainName(request.chainId)}.`,
              buttonText: signingLabel,
              successHeader: transaction.kind === 'approval' ? 'Approval submitted' : 'Transaction submitted',
              successDescription: transaction.kind === 'approval' ? 'Approval submitted. Close this screen to continue.' : 'Waiting for confirmation on-chain.',
            });
            // Preserve the primitive-only resume hint through approvals. If
            // the later action prompt is declined, the user can reopen this
            // form and rebuild the route from current chain state.
            if (signatureDraftIdRef.current && transaction.kind === 'action') {
              removeSignatureRequiredDraft(signatureDraftIdRef.current);
              signatureDraftIdRef.current = null;
            }
            return signed.hash;
          },
          onStatus: (next, detail) => {
            if (!isMountedExecution()) return;
            setStatus(next);
            setStatusDetail(detail ? userSafeError(detail, 'The transaction could not continue. Check the network and try again.') : '');
          },
          onStep: (step) => {
            if (!isMountedExecution()) return;
            const next = [...executionStepsRef.current];
            next[step.index] = step;
            executionStepsRef.current = next;
            setStepResults(next);
          },
          // The runner invokes this only after a receipt and the required
          // confirmation depth have both been observed. Publish the receipt
          // result before the optional state refresh so the user sees the
          // confirmed action immediately while the read runs in the background.
          postConfirmRead: async (confirmedRoute, execution) => {
            if (!isMountedExecution()) return;
            postConfirmReadStarted = true;
            setResult(execution);
            transition('completed');
            if (!isCurrentExecution()) return;
            setRefreshing(true);
            try {
              // These reads have independent cache boundaries. Start both
              // immediately so a slow wallet refresh cannot delay the
              // receipt-bound position hint or other completion bookkeeping.
              // Each task is scoped before it starts; the owning callbacks
              // retain their own account/session guards for late results.
              const refreshPromise = Promise.resolve().then(() => {
                if (!isCurrentCompletionSession()) return;
                return refreshWallet(confirmedRoute, execution);
              });
              const completePromise = Promise.resolve().then(() => {
                if (!isCurrentCompletionSession()) return;
                return onComplete?.(execution, confirmedRoute);
              });
              const outcomes = await Promise.allSettled([refreshPromise, completePromise]);
              if (!isMountedExecution()) return;
              const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
              if (rejected) throw rejected.reason;
            } finally {
              if (isMountedExecution()) setRefreshing(false);
            }
          },
        },
      });
      // A confirmed result may close while its cache refresh is still pending.
      // Its completion must not clear a newer action's signature recovery draft.
      if (!isMountedExecution()) return;
      if (signatureDraftIdRef.current) {
        const actionSubmitted = execution.steps.some((step) => step.transaction.kind === 'action' && hasTransactionHash(step));
        if (shouldRemoveSignatureDraft({ actionSubmitted, routeCompleted: execution.status === 'confirmed' })) {
          removeSignatureRequiredDraft(signatureDraftIdRef.current);
          signatureDraftIdRef.current = null;
        }
      }
      // A finality/confirmation timeout can skip postConfirmRead despite
      // inclusion. Mark wallet data stale for gas/approvals/reverts without
      // duplicating the refresh already running behind the result view.
      if (!postConfirmReadStarted && isCurrentExecution()) await refreshWallet(currentRoute, execution);
      if (!isMountedExecution()) return;
      setResult(execution);
      transition('completed');
      const uncertain = execution.steps.some((step) => ['unknown', 'unverified'].includes(transactionStepProgress(step).state));
      haptic(execution.status === 'confirmed' ? 'success' : execution.status === 'partial' || uncertain ? 'warning' : 'error');
    } catch (cause) {
      if (!isMountedExecution()) return;
      const message = userSafeError(cause, 'The transaction could not continue. No later step was submitted.');
      const submittedSteps = executionStepsRef.current;
      if (submittedSteps.some(hasTransactionHash)) {
        // A UI/observer exception cannot erase a broadcast hash or reopen a
        // signing action. The existing journal remains the recovery authority.
        const interrupted: TransactionExecutionResult = {
          status: submittedSteps.some((step) => step.status === 'confirmed') ? 'partial' : 'failed',
          operation: currentRoute.operation,
          chainId: currentRoute.chainId,
          walletAddress: currentRoute.walletAddress,
          steps: submittedSteps.map((step) => step.status === 'submitted' ? { ...step, status: 'failed', error: message } : step),
          error: message,
        };
        const actionSubmitted = submittedSteps.some((step) => step.transaction.kind === 'action' && hasTransactionHash(step));
        if (signatureDraftIdRef.current && shouldRemoveSignatureDraft({ actionSubmitted, routeCompleted: false })) {
          removeSignatureRequiredDraft(signatureDraftIdRef.current);
          signatureDraftIdRef.current = null;
        }
        if (isCurrentExecution()) await refreshWallet(currentRoute, interrupted);
        if (!isMountedExecution()) return;
        setResult(interrupted);
        transition('interrupted');
      } else if (executionSessionInvalidatedRef.current) {
        // Keep the wallet-scoped editable draft available if the active
        // account changed before an action hash was submitted.
        setResult({
          status: 'failed',
          operation: currentRoute.operation,
          chainId: currentRoute.chainId,
          walletAddress: currentRoute.walletAddress,
          steps: submittedSteps,
          error: message,
        });
        transition('interrupted');
      } else {
        // A declined signature or stale quote is not an explicit draft
        // cancellation. History can restore the same primitive form state.
        // The route cannot be signed as it stands, so its action becomes the
        // explicit fresh review ("Review updated quote") rather than a
        // silently disabled Confirm.
        setError(message);
        expireQuote();
        transition('signing-failed');
      }
      setStatus('failed');
      // A failed or stale route must be explicitly reviewed again. This is
      // especially important when the runner rejects a changed minOut,
      // converter path, leverage, or transformed reduction amount.
      haptic(submittedSteps.some(hasTransactionHash) ? 'warning' : 'error');
    } finally {
      if (isCurrentGeneration(generation)) {
        busyRef.current = false;
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, [bindSession, disabled, gasCost.checking, draftActionKey, draftResumePath, draftState, expireQuote, feeSelection, invalidatePreparedRoute, invalidateWalletData, isCurrentGeneration, loading, matchesAcceptedRoute, onComplete, planBuilder, intentKey, quoteExpired, reviewSession, reviewTitle, route, sessionMismatch, stage, status, stepResults, transition, wallet]);

  // Connecting leaves the editor in place without preparing a transaction. The user
  // must click the action again after the wallet is connected.
  useEffect(() => {
    if (!resumeAfterConnect || stage !== 'input' || !wallet.authenticated || !wallet.address) return;
    if (disabled) {
      setResumeAfterConnect(false);
      return;
    }
    setResumeAfterConnect(false);
  }, [disabled, resumeAfterConnect, stage, wallet.address, wallet.authenticated]);

  const routeSummaries = useMemo(() => routes.map((candidate) => {
    const routeType = candidate.details?.routeType ?? 'Route';
    const approvals = candidate.transactions.filter((transaction) => transaction.kind === 'approval').length;
    return { routeType, approvals, count: candidate.transactions.length };
  }), [routes]);
  const selectReviewedRoute = useCallback((index: number) => {
    if (busyRef.current || stage !== 'review') return;
    const candidate = routes[index];
    if (!candidate) return;
    setSelectedRoute(index);
    acceptRoute(candidate, intentKey);
    setStepResults([]);
  }, [acceptRoute, intentKey, routes, stage]);
  const startConnectFlow = useCallback(() => { setError(null); setResumeAfterConnect(true); }, []);
  const endConnectFlow = useCallback(() => setResumeAfterConnect(false), []);
  const selectGasTier = useCallback(async (tier: GasTier) => {
    if (!wallet.isEmbedded || !route || stage !== 'review' || busyRef.current) return;
    const generation = generationRef.current;
    busyRef.current = true;
    setLoading(true);
    try {
      const snapshot = await fetchGasTierQuotes(route.chainId);
      if (!isCurrentGeneration(generation)) return;
      const quote = selectedGasTierQuote(snapshot, tier);
      await routeGasCostCache.refresh(route, { feeTierQuote: quote });
      if (!isCurrentGeneration(generation)) return;
      selectedGasTierQuote(snapshot, tier);
      const previous = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...previous, gasTier: tier }));
      changingFeeRef.current = true;
      setFeeSelection({ snapshot, tier });
      announceSettingsUpdated(readSlippagePercent() * 100, tier);
      setError(null);
    } catch (cause) {
      if (isCurrentGeneration(generation)) setError(userSafeError(cause, 'Could not update the network fee. Try again.'));
    } finally {
      changingFeeRef.current = false;
      if (isCurrentGeneration(generation)) { busyRef.current = false; setLoading(false); }
    }
  }, [isCurrentGeneration, route, stage, wallet.isEmbedded]);

  return {
    stage, wallet, route, routes, selectedRoute, routeSummaries,
    status, statusDetail, stepResults, loading, networkSwitching, refreshing,
    error, result, reviewTitle, quoteExpired, quoteChanges,
    gasCost, feeSelection, selectGasTier,
    triggerRef, headingRef, review, execute, refreshReviewedQuote, reset,
    selectReviewedRoute,
    canSelectReviewedRoute: stage === 'review' && !busyRef.current,
    startConnectFlow, endConnectFlow,
  };
}
