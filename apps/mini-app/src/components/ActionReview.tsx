'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePauseAutomaticPositionRefresh } from './PositionRefreshActivity';
import { usePresentedTransactions } from '@/lib/pendingActivity';
import {
  AlertTriangle,
  X,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  LoaderCircle,
} from 'lucide-react';
import { decodeFunctionData, formatEther, formatUnits } from 'viem';
import {
  FX_TOKENS,
  type PlanStatus,
  type PlannedRoute,
  type PlannedTransaction,
} from '@/lib/fx';
import type { ActionReviewProps } from '@/components/review/actionReviewTypes';
export type { ActionPlanBuilder, ActionReviewProps, ActionReviewStage } from '@/components/review/actionReviewTypes';
import { Button, Card } from '@/components/ui';
import { ValueOrSkeleton } from '@/components/MissingValue';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { compactAddress } from '@/lib/addressPresentation';
import { hasTransactionHash } from '@/lib/transactionProgress';
import { BridgeTracker } from '@/components/BridgeTracker';
import { CalldataDisclosure, InlineError, StatusNotice, stepProgress, chainName } from '@/components/review/ReviewProgress';
import { resultPresentation } from '@/components/review/executionResult';
import { splitReviewFacts } from '@/components/review/reviewSummary';
import { exactAmountText, factsOutsideConsequenceSummary, missingGasFeeFact, missingTotalCostFact, nativeFundsNotice, primaryReviewFacts, routeFacts as buildRouteFacts } from '@/components/review/actionReviewPresentation';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import { consequenceSummary, pairVerifiedPositionFacts, reviewActionLabel } from '@/components/review/actionReviewModel';
import { useActionReviewLifecycle } from '@/components/review/useActionReviewLifecycle';
import { selectExecutionTask } from '@/lib/taskState';
import { buildReceiptPresentation, receiptTransfersFromLogs } from '@/lib/receiptPresentation';
import { receiptMintedPositionIdentity } from '@/lib/confirmedPositions';
import { positionSideLabel } from '@/lib/positionNaming';
import { positionOutcomeFacts, rawQuoteReviewFacts, tokenAmountReviewFact, type ReviewFact } from '@/lib/fx/reviewFormatting';
import { buildStatusPresentation } from '@/components/review/actionReviewStatusModel';
import { PositionOutcomeSummary, TransactionProgressPresentation, UpdatedQuoteSummary } from '@/components/review/ActionReviewSummary';
import { TransactionResultView } from '@/components/review/TransactionResultView';
import { ReviewViewport } from '@/components/review/ReviewViewport';
import { MobileFlowSheet } from '@/components/MobileFlowSheet';
import { positionPoolAddress } from '@/lib/fx/policy';
import { stableTradeReviewFacts } from './review/stableTradeReviewFacts';
import { orderCompactReviewFacts, reviewFactLabel, reviewHierarchy } from './review/reviewHierarchy';
import { TransactionIdentity } from './review/TransactionIdentity';
import { TransactionAmountFlow, LeverageChangeSummary } from './review/TransactionAmountFlow';
import { transactionAmountFacts } from './review/transactionAmountPresentation';
import { positionReviewBefore } from './review/positionReview';
import { PendingTransactionSummary } from './review/PendingTransactionSummary';
import { ReviewFactValue } from './review/ReviewFactValue';
import { ReviewTermRow } from './review/ReviewTermRow';
import { MetricLabel } from './InfoHelp';
import { reviewHelpDefinition } from './review/reviewHelp';
import { transactionCardIdentity } from './review/transactionCardIdentity';
import { AmountUsd, FeeUsd, FeeAmount, CollateralAmount } from './review/AmountUsd';
import { TechnicalEvidenceRow } from './review/TechnicalEvidenceRow';
import { exactEvidenceJson } from './review/technicalEvidence';
import { retainedClaimPreviewFacts } from './review/claimPreviewPresentation';
import { plainTransactionCopy, plainWalletStatus } from './review/transactionAmountPresentation';
import { BridgeReviewSummary } from './review/BridgeReviewSummary';
import { ReviewRiskPrices } from './review/ReviewRiskPrices';
import { ROUTE_PREFETCH_TTL_MS } from '@/lib/fx/routePrefetch';
import { GAS_TIERS, readGasTier } from '@/lib/settings';
import { formatGasPriceGwei } from '@/lib/fx/gasFeePolicy';
import styles from './FlowWorkspace.module.css';
import { StickyAction } from './StickyAction';
import presentationStyles from './review/ActionReviewPresentation.module.css';

function trimDecimal(value: string): string {
  return value.includes('.') ? value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : value;
}

function tokenForAddress(address: string | undefined) {
  if (!address) return undefined;
  return Object.values(FX_TOKENS).find((token) => token.address.toLowerCase() === address.toLowerCase());
}

/** A known token's display symbol (fxSP for the base-pool share), never its SDK key. */
function tokenSymbolForAddress(address: string | undefined): string | undefined {
  const token = tokenForAddress(address);
  return token && tokenSymbol(token.key);
}

function formatTokenAmount(value: bigint, tokenAddress?: string, fallback = 'raw units'): string {
  const token = tokenForAddress(tokenAddress);
  if (!token) return `${value.toString()} ${fallback}`;
  return `${exactAmountText(trimDecimal(formatUnits(value, token.decimals)))} ${tokenSymbol(token.key)}`;
}

/** Preparation names the check that is actually running. */
function preparationStep(status: PlanStatus): string {
  return status === 'reviewing'
    ? 'Simulating each step and checking network fees.'
    : 'Finding the route and its quote.';
}

const APPROVE_ABI = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amountOrTokenId', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

function approvalFacts(transaction: PlannedTransaction): {
  spender: string;
  valueLabel: string;
  value: bigint;
} | null {
  if (transaction.kind !== 'approval') return null;
  try {
    const decoded = decodeFunctionData({ abi: APPROVE_ABI, data: transaction.data });
    const [spender, amountOrTokenId] = decoded.args;
    return {
      spender,
      valueLabel: transaction.type === 'approvePosition' ? 'Position NFT ID' : 'Exact amount (raw units)',
      value: amountOrTokenId,
    };
  } catch {
    return null;
  }
}

function approvalSummary(transaction: PlannedTransaction, approval: NonNullable<ReturnType<typeof approvalFacts>>): string {
  if (transaction.type === 'approvePosition') return `Position #${approval.value.toString()}`;
  return formatTokenAmount(approval.value, transaction.to);
}

function stepTitle(transaction: PlannedTransaction): string {
  if (transaction.kind !== 'approval') return 'Confirm';
  return transaction.type === 'approvePosition' ? 'Approve position' : `Approve ${tokenSymbolForAddress(transaction.to) ?? 'token'}`;
}


function statusPresentation(params: Parameters<typeof buildStatusPresentation>[0]) {
  const state = buildStatusPresentation(params);
  const icon = state.icon === 'clock' ? <Clock3 className="h-4 w-4" />
    : state.icon === 'loading' ? <LoaderCircle className="h-4 w-4 animate-spin" />
      : state.icon === 'success' ? <CheckCircle2 className="h-4 w-4" />
        : state.icon === 'warning' ? <AlertTriangle className="h-4 w-4" />
          : <CircleAlert className="h-4 w-4" />;
  return { ...state, icon };
}

export function ActionReview(props: ActionReviewProps) {
  const router = useRouter();
  const lifecycle = useActionReviewLifecycle(props);
  const { label = 'Review action', disabled = false, blocker = null, operationLabel, destructive = false, editor, decisionBefore, executionCost, surface = 'card', planBuilder, onViewNewPosition, onReturnToPosition, confirmedPosition } = props;
  const { canSelectReviewedRoute, endConnectFlow, error, execute, feeSelection, gasCost, headingRef, loading, networkSwitching, quoteChanges, quoteExpired, refreshReviewedQuote, refreshing, reset, result, review, reviewTitle, route, routeSummaries, routes, selectedRoute, selectReviewedRoute, selectGasTier, startConnectFlow, stage, status, statusDetail, stepResults, triggerRef, wallet } = lifecycle;
  const [, refreshQuoteDisplay] = useState(0);
  // Keep the accepted amount identity through wallet requests and receipts.
  // This display snapshot never replaces the live execution/freshness guards.
  const acceptedAmountFacts = useMemo(() => route ? primaryReviewFacts(route) : [], [route]);
  // Freeze the starting position with the accepted route. A post-confirmation
  // provider refresh must not rewrite the historical "before" side.
  const acceptedBefore = useRef<{ route: PlannedRoute | null; facts: ReviewFact[] }>({ route: null, facts: [] });
  if (route !== acceptedBefore.current.route) acceptedBefore.current = { route, facts: route ? positionReviewBefore(route, decisionBefore ?? []) : [] };
  const beforeFacts = acceptedBefore.current.facts;
  const actionCopy = plainTransactionCopy(route?.policy?.reviewedAction, reviewTitle ?? operationLabel ?? label, route?.operation === 'buildBridgeTx' && route.quote && typeof route.quote === 'object' && 'bridgeToken' in route.quote && typeof route.quote.bridgeToken === 'string' ? route.quote.bridgeToken : route?.operation === 'buildBridgeTx' ? 'asset' : undefined);
  const bridgeQuote = route?.operation === 'buildBridgeTx' && route.quote && typeof route.quote === 'object'
    ? route.quote as { receiptReadAt?: unknown } : undefined;
  const bridgeReadAt = typeof bridgeQuote?.receiptReadAt === 'number' ? bridgeQuote.receiptReadAt : undefined;
  const savingsQuoteReadAt = route?.details?.fxSaveQuote?.readAt ?? bridgeReadAt;
  useEffect(() => {
    if (savingsQuoteReadAt === undefined || !Number.isSafeInteger(savingsQuoteReadAt) || savingsQuoteReadAt > Date.now()) return;
    const timer = window.setTimeout(() => refreshQuoteDisplay(value => value + 1), Math.max(0, savingsQuoteReadAt + ROUTE_PREFETCH_TTL_MS - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [savingsQuoteReadAt]);
  usePauseAutomaticPositionRefresh(stage === 'planning' || stage === 'review' || stage === 'executing' || refreshing);
  // This review shows its own progress and result; the header notice stays for steps settling elsewhere.
  usePresentedTransactions([...stepResults, ...(result?.steps ?? [])].map((step) => step.hash));

  if (stage === 'input' || stage === 'planning') {
    const preparing = stage === 'planning';
    const progress = statusPresentation({ stage, status, detail: statusDetail, stepResults, stepCount: 0 });
    const disconnected = !wallet.authenticated || !wallet.address;
    const reviewLabel = quoteExpired ? 'Review updated quote' : reviewActionLabel(label, operationLabel);
    const trigger = (
      <StickyAction>
      <div className={`${styles.reviewTrigger} reviewTrigger flex flex-col gap-2.5`}>
        {error && <InlineError message={error} />}
        {disconnected ? (
          <ConnectWalletButton
            className={`button button-primary glass-press ${styles.primaryAction} flex w-full items-center justify-center`}
            // ConnectWalletButton queues while the provider hydrates; only
            // the action's own disabled state should block that intent.
            disabled={disabled}
            resumeIfConnected
            onConnectStart={startConnectFlow}
            onConnectError={endConnectFlow}
          >
            Connect wallet
          </ConnectWalletButton>
        ) : (
          <Button ref={triggerRef} data-review-trigger variant={destructive ? 'danger' : 'primary'} className={styles.primaryAction} data-blocked={blocker ? true : undefined} disabled={preparing || Boolean(blocker) || !planBuilder || disabled || !wallet.ready} loading={loading} onClick={() => void review()}>
            {preparing ? 'Preparing review…' : blocker || reviewLabel}
          </Button>
        )}
        {preparing ? <div className={presentationStyles.inputPreparation}>
          <p role="status" aria-live="polite">{preparationStep(status)}</p>
          <button type="button" onClick={reset}>Cancel</button>
        </div> : loading && <StatusNotice {...progress} />}
      </div>
      </StickyAction>
    );
    if (editor) {
      return <><fieldset disabled={preparing} aria-busy={preparing} className={presentationStyles.preparationEditor}>{editor}</fieldset>{trigger}</>;
    }
    return trigger;
  }

  if (stage === 'result' && result) {
    const transactionTask = selectExecutionTask(result);
    const bridgeQuote = route?.operation === 'buildBridgeTx' && isBridgeQuote(route.quote) ? route.quote : null;
    const bridge = Boolean(bridgeQuote);
    const bridgeStep = bridge
      ? [...result.steps].reverse().find((step) => step.transaction.kind === 'action' && step.hash)
      : undefined;
    const bridgeStatus = bridgeStep?.receipt?.status === 'reverted'
      ? 'failed'
      : bridgeStep?.status === 'confirmed' && bridgeStep.receipt?.status === 'success'
        ? 'source_confirmed'
        : 'pending';
    const positionAction = result.status === 'confirmed' && [
      'increasePosition', 'reducePosition', 'adjustPositionLeverage', 'depositAndMint', 'repayAndWithdraw',
    ].includes(result.operation);
    const positionIntent = route?.policy?.reviewedAction && 'positionId' in route.policy.reviewedAction
      && 'poolAddress' in route.policy.reviewedAction
      ? route.policy.reviewedAction
      : null;
    const poolLocation = positionIntent
      ? (['ETH', 'BTC'] as const).flatMap((market) => (['long', 'short'] as const).map((side) => ({ market, side })))
        .find(({ market, side }) => positionPoolAddress(market, side).toLowerCase() === positionIntent.poolAddress.toLowerCase())
      : undefined;
    const receiptPositionIdentity = result.status === 'confirmed' && route && positionIntent?.positionId === 0
      && (route.operation === 'increasePosition' || route.operation === 'depositAndMint')
      ? receiptMintedPositionIdentity({ route, result })
      : null;
    const positionSide = positionIntent && 'positionType' in positionIntent ? positionIntent.positionType : poolLocation?.side ?? receiptPositionIdentity?.side;
    const positionMarket = poolLocation?.market ?? receiptPositionIdentity?.market;
    const positionId = positionIntent && positionIntent.positionId > 0
      ? positionIntent.positionId
      : receiptPositionIdentity?.positionId;
    const positionLabel = positionAction && result.status === 'confirmed' && positionId !== undefined
      ? `${positionMarket ?? 'Protocol'}${positionSide ? ` ${positionSideLabel(positionSide)}` : ''} · #${positionId}`
      : undefined;
    const closedPosition = result.status === 'confirmed' && positionIntent?.kind === 'position-reduce' && positionIntent.isClosePosition;
    const positionHref = !closedPosition && positionId !== undefined && positionMarket && positionSide
      ? `/positions?position=${encodeURIComponent(`${positionMarket}:${positionSide}:${positionId}`)}`
      : undefined;
    // A position Trade just opened is named as History names this transaction,
    // and drawn as its row with the split chosen on the ticket.
    const opened = result.status === 'confirmed' && route?.operation === 'increasePosition'
      && positionIntent?.kind === 'position-increase' && positionIntent.positionId === 0 && poolLocation
      ? { ...poolLocation, targetLeverage: positionIntent.requestedLeverage }
      : undefined;
    const completedIntent = route?.policy?.reviewedAction;
    // A requested target is not the final on-chain leverage. The receipt title
    // names the confirmed action; the target remains explicitly labelled below.
    const confirmedTitle = opened ? `${opened.market} ${positionSideLabel(opened.side)} opened`
      : closedPosition ? 'Position closed'
      : completedIntent?.kind === 'position-increase' ? 'Collateral added'
      : completedIntent?.kind === 'position-reduce' ? 'Position reduced'
      : completedIntent?.kind === 'position-adjust' ? 'Leverage updated'
      : completedIntent?.kind === 'deposit-and-mint' ? completedIntent.mintAmount > 0n
        ? completedIntent.positionId > 0 && completedIntent.depositAmount > 0n ? 'Loan updated' : 'fxUSD borrowed'
        : 'Collateral added'
      : completedIntent?.kind === 'repay-and-withdraw' ? completedIntent.minimumRepayAmount > 0n
        ? completedIntent.withdrawAmount > 0n ? 'Loan updated' : 'fxUSD debt repaid'
        : 'Collateral withdrawn'
      : completedIntent?.kind === 'fxsave-withdraw' ? completedIntent.directBasePool ? 'fxSAVE redeemed'
        : completedIntent.instant ? 'Withdrawal complete' : 'Withdrawal queued'
      : completedIntent?.kind === 'fxsave-claim' ? 'Withdrawal claimed'
      : completedIntent?.kind === 'fxsave-deposit' ? 'Deposited into fxSAVE'
      : positionAction ? 'Position updated' : undefined;
    const presentation = resultPresentation(result, bridge, confirmedTitle);
    const newPosition = opened && receiptPositionIdentity
      && receiptPositionIdentity.market === opened.market && receiptPositionIdentity.side === opened.side
      && opened.targetLeverage !== undefined && Number.isFinite(opened.targetLeverage) && opened.targetLeverage > 0
      ? {
        key: `${opened.market}:${opened.side}:${receiptPositionIdentity.positionId}`,
        market: opened.market,
        side: opened.side,
        positionId: receiptPositionIdentity.positionId,
        targetLeverage: opened.targetLeverage,
      }
      : undefined;
    const approvalConfirmedWithoutAction = result.status === 'partial'
      && result.steps.some((step) => step.transaction.kind === 'approval' && step.status === 'confirmed')
      && result.steps.filter(hasTransactionHash).every((step) => step.status === 'confirmed')
      && !result.steps.some((step) => step.transaction.kind === 'action' && hasTransactionHash(step));
    const requiresTracking = result.status !== 'confirmed' && result.steps.some((step) =>
      hasTransactionHash(step) && step.receipt?.status !== 'reverted'
      && (step.status !== 'confirmed' || step.transaction.kind === 'action'));
    const receiptFacts = result.steps.flatMap((step) => {
      if (!hasTransactionHash(step) || !step.receipt) return [];
      const receiptStatus = step.receipt.status === 'success' ? 'success' : 'reverted';
      const receiptFeeFields = step.receipt as unknown as { effectiveGasPrice?: unknown; l1Fee?: unknown; operatorFee?: unknown };
      const effectiveGasPrice = receiptFeeFields.effectiveGasPrice;
      return [buildReceiptPresentation({
        chainId: result.chainId as 1 | 8453,
        walletAddress: result.walletAddress,
        status: receiptStatus,
        transfers: receiptTransfersFromLogs(step.receipt.logs ?? [], result.walletAddress),
        executionCostWei: typeof effectiveGasPrice === 'bigint' ? step.receipt.gasUsed * effectiveGasPrice : undefined,
        l1DataFeeWei: typeof receiptFeeFields.l1Fee === 'bigint' ? receiptFeeFields.l1Fee : undefined,
        operatorFeeWei: typeof receiptFeeFields.operatorFee === 'bigint' ? receiptFeeFields.operatorFee : undefined,
        nativeValueWei: step.transaction.value,
        transactionKind: step.transaction.kind,
        bridgeFee: step.transaction.operation === 'buildBridgeTx',
      })];
    });
    return (
      <ReviewSurface surface={surface} mobileSheet={{ title: route?.operation === 'buildBridgeTx' ? 'Bridge status' : result.status === 'confirmed' ? confirmedTitle ?? 'Transaction result' : 'Review transaction', onClose: reset, triggerRef, hideTitle: true }} className={`${styles.reviewCard} ${styles.reviewInlineCard} p-4 sm:p-5`}>
        <TransactionResultView
          result={result}
          presentation={presentation}
          refreshing={refreshing}
          positionAction={positionAction}
          positionClosed={closedPosition}
          positionLabel={positionLabel}
          newPosition={newPosition}
          receipts={receiptFacts}
          reviewedFacts={acceptedAmountFacts}
          reviewIdentity={route ? transactionCardIdentity(route, acceptedAmountFacts, reviewTitle ?? operationLabel ?? label) : undefined}
          reviewedPositionChanges={pairVerifiedPositionFacts(beforeFacts, acceptedAmountFacts).paired}
          confirmedPosition={confirmedPosition}
          headingRef={headingRef}
          bridgeTracker={bridgeQuote ? (advancedContent, completionContent) => (
            <BridgeTracker
              advancedContent={advancedContent}
              completionContent={completionContent}
              headingRef={headingRef}
              compact
              className="mt-4 w-full text-left"
              sourceChain={route.chainId === 1 ? 'Ethereum' : 'Base'}
              destinationChain={route.chainId === 1 ? 'Base' : 'Ethereum'}
              token={bridgeQuote.bridgeToken ?? 'Bridge asset'}
              amount={bridgeQuote.bridgeAmount === undefined ? '' : formatUnits(bridgeQuote.bridgeAmount, 18)}
              sourceTxHash={bridgeStep?.hash}
              status={bridgeStatus}
              sourceOftAddress={bridgeQuote.sourceOftAddress}
              destinationOftAddress={bridgeQuote.destinationOftAddress}
              recipient={bridgeQuote.recipient}
              sourceSender={route.walletAddress}
              amountLD={bridgeQuote.amountLD}
              minAmountLD={bridgeQuote.minAmountLD}
              destinationBaselineBlock={bridgeQuote.destinationBaselineBlock}
            />
          ) : undefined}
          nextLabel={approvalConfirmedWithoutAction ? 'Continue action' : transactionTask ? bridge ? 'View transfer' : 'View transaction progress' : requiresTracking ? 'View history' : bridge ? 'Back to Move' : closedPosition ? 'View positions' : positionAction ? onReturnToPosition ? 'Back to position' : 'View position' : completedIntent?.kind === 'fxsave-claim' && result.status === 'confirmed' ? 'View wallet' : completedIntent?.kind === 'fxsave-deposit' && result.status === 'confirmed' ? 'View earnings' : result.status === 'confirmed' ? 'Done' : 'Try again'}
          onNext={() => {
            if (approvalConfirmedWithoutAction) { reset(); return; }
            if (transactionTask) { router.push(transactionTask.href); return; }
            if (requiresTracking) { router.push('/history'); return; }
            if (completedIntent?.kind === 'fxsave-claim' && result.status === 'confirmed') { reset(); router.push('/portfolio'); return; }
            if (positionAction) {
              // A position this review just opened can open in place, carrying its split.
              if (newPosition && positionHref && onViewNewPosition) { onViewNewPosition({ key: newPosition.key, href: positionHref }); return; }
              if (positionHref && positionMarket && positionSide && onReturnToPosition) {
                reset();
                onReturnToPosition({ key: `${positionMarket}:${positionSide}:${positionId}`, href: positionHref });
                return;
              }
              reset();
              router.push(positionHref ?? '/positions');
              return;
            }
            reset();
          }}
        />
      </ReviewSurface>
    );
  }

  const stablePreparation = Boolean(props.preparationFacts?.length);
  if (!route) return null;
  const reviewChainId = route?.chainId ?? 1; // Trade's inputs are Ethereum-only.
  const stepCount = route?.transactions.length ?? 0;
  // A wallet that cannot pay the network fee would only reach a failed or
  // stalled signing screen, so the review names the shortfall instead. A
  // fresh partial estimate still proves it: every step costs at least 21,000 gas.
  const fundsShort = Boolean(gasCost.current?.insufficientNativeBalance);
  const checkingGas = gasCost.checking;
  const feeNetwork = reviewChainId === 8453 ? 'Base' : 'Ethereum';
  const fundsNotice = fundsShort && !quoteExpired ? nativeFundsNotice(gasCost.current, feeNetwork) : undefined;
  const visibleFeeSelection = feeSelection;
  const feeTierQuote = wallet.isEmbedded && visibleFeeSelection?.snapshot.chainId === reviewChainId
    ? visibleFeeSelection.snapshot.tiers[visibleFeeSelection.tier]
    : undefined;
  const liveFacts = buildRouteFacts(route, gasCost, executionCost, feeTierQuote);
  const facts = route.policy?.reviewedAction?.kind === 'fxsave-claim' ? retainedClaimPreviewFacts(liveFacts, acceptedAmountFacts) : liveFacts;
  const missingGasFee = missingGasFeeFact(gasCost);
  if (missingGasFee && !facts.some((fact) => fact.label === 'Gas fee')) facts.push(missingGasFee);
  const missingTotalCost = route ? missingTotalCostFact(route, gasCost) : undefined;
  if (missingTotalCost && !facts.some((fact) => fact.label === 'Total cost')) facts.push(missingTotalCost);
  const reviewFacts = splitReviewFacts(facts);
  const consequenceFacts = route ? consequenceSummary(primaryReviewFacts(route)) : [];
  const positionChanges = pairVerifiedPositionFacts(beforeFacts, facts);
  const positionChangeRows = [
    ...positionChanges.paired,
    ...positionChanges.remainingBefore.filter(fact => ['Collateral', 'Debt', 'Loan-to-value'].includes(fact.label))
      .map(fact => ({ label: fact.label, before: fact.value, beforeTitle: fact.title, after: 'Unavailable' })),
  ];
  // A paired value lives in Position outcome only, whichever label it paired with.
  const pairedOutcomeLabels = new Set(positionChanges.paired.flatMap((fact) => {
    const label = fact.label.toLowerCase();
    return [`estimated ${label}`, `expected ${label}`, label];
  }));
  const actionConsequences = consequenceFacts.filter((fact) => !pairedOutcomeLabels.has(fact.label.toLowerCase()));
  const remainingSummaryFacts = factsOutsideConsequenceSummary(reviewFacts.summary, actionConsequences);
  const verifiedSummaryFacts = [...actionConsequences, ...remainingSummaryFacts].filter((fact) => !['Gas tier', 'Action'].includes(fact.label));
  const summaryFacts = stablePreparation
    ? stableTradeReviewFacts(props.preparationFacts ?? [], verifiedSummaryFacts, { preparing: false, failed: status === 'failed', checkingGas, hasVerifiedRoute: true, totalIsGasOnly: Boolean(gasCost.estimateIsCurrent && gasCost.estimate?.nativeValueWei === 0n && gasCost.estimate.totalNativeCostWei !== undefined) })
    : verifiedSummaryFacts;
  const intent = route?.policy?.reviewedAction;
  const tradeReview = stablePreparation || (intent?.kind === 'position-increase' && intent.positionId === 0);
  const newBorrowReview = intent?.kind === 'deposit-and-mint' && intent.positionId === 0;
  const acceptedBridgeQuote = route?.operation === 'buildBridgeTx' && isBridgeQuote(route.quote) ? route.quote : undefined;
  const bridgeReview = Boolean(acceptedBridgeQuote);
  const stableBridgeFacts = [
    ...acceptedAmountFacts.filter(fact => ['Amount', 'Input amount', 'Estimated received'].includes(fact.label)),
    ...reviewHierarchy(summaryFacts, reviewFacts.details, false, false, true).primary.filter(fact => !['Amount', 'Input amount', 'Estimated received'].includes(fact.label)),
  ];
  const leverageReview = intent?.kind === 'position-adjust';
  const tradingAction = intent?.kind === 'position-increase' || intent?.kind === 'position-reduce' || leverageReview;
  const loanAction = intent?.kind === 'deposit-and-mint' || intent?.kind === 'repay-and-withdraw';
  const savingsAction = intent?.kind === 'fxsave-deposit' || intent?.kind === 'fxsave-withdraw' || intent?.kind === 'fxsave-claim';
  const amountLed = loanAction || savingsAction || (tradingAction && !leverageReview);
  // Position collateral is an accounting consequence, not a wallet receipt.
  // Its existing unit-aware row preserves the signed native floor separately.
  const amountFacts = amountLed ? transactionAmountFacts(acceptedAmountFacts).filter(fact => !(tradingAction && fact.label === 'Estimated collateral')) : [];
  const amountLabels = new Set(amountFacts.map(fact => fact.label));
  const compactReview = tradeReview || leverageReview || bridgeReview || intent?.kind === 'deposit-and-mint' || intent?.kind === 'repay-and-withdraw' || intent?.kind === 'fxsave-deposit' || intent?.kind === 'fxsave-withdraw' || intent?.kind === 'fxsave-claim';
  const hierarchy = reviewHierarchy(summaryFacts, reviewFacts.details, tradeReview, newBorrowReview, bridgeReview);
  const executionPrice = [...hierarchy.primary, ...hierarchy.more].find(fact => fact.label === 'Execution price');
  const actionName = reviewTitle ?? operationLabel ?? route?.operation ?? label;
  const identity = transactionCardIdentity(route, acceptedAmountFacts, actionName);
  const actionHeading = tradingAction ? identity.name : identity.review;
  const identityLabel = identity.amount?.label;
  const compactFacts = orderCompactReviewFacts(hierarchy.primary.filter(fact => fact.label !== identityLabel && !amountLabels.has(fact.label) && !(newBorrowReview && fact.label === 'Debt added' && positionChanges.paired.some(change => change.label === 'Debt')) && !pairedOutcomeLabels.has(fact.label.toLowerCase()) && !(tradingAction && fact.label === 'Price impact') && !(loanAction && fact.label === 'Borrow rate') && !(intent?.kind === 'fxsave-deposit' && fact.label === 'Current APY') && !['Position', 'Target leverage', 'Execution price', 'Gas fee', 'f(x) fee', 'Protocol fee', 'Bridge fee', 'Total cost', 'Claim payout', 'Slippage'].includes(fact.label)), intent?.kind === 'deposit-and-mint');
  const collateral = tradeReview ? acceptedAmountFacts.find(fact => fact.label === 'Estimated collateral') : undefined;
  const collateralValuation = tradeReview && route ? positionOutcomeFacts(route)?.collateral : undefined;
  const slippage = facts.find(fact => fact.label === 'Slippage');
  const priceImpact = facts.find(fact => fact.label === 'Price impact');
  const borrowRate = facts.find(fact => fact.label === 'Borrow rate');
  const currentApy = facts.find(fact => fact.label === 'Current APY');
  // Each visible term owns its exact value and explanation. Only additional
  // route limits and verification evidence belong in the technical disclosure.
  const decisionLabels = new Set([
    ...amountLabels, ...compactFacts.map(fact => fact.label), identityLabel,
    ...(/(?:Position|Loan) #/.test(identity.subtitle ?? '') ? ['Position'] : []),
    ...(collateral ? ['Estimated collateral'] : []),
    ...(tradingAction ? ['Execution price', 'Price impact'] : []),
    ...(tradeReview || leverageReview ? ['Target leverage'] : []),
    ...(slippage && !loanAction ? ['Slippage'] : []),
    ...(intent?.kind === 'fxsave-deposit' ? ['Current APY'] : []),
    ...(loanAction && intent?.kind === 'deposit-and-mint' && intent.mintAmount > 0n ? ['Borrow rate'] : []),
    'Gas fee', 'Bridge fee', 'Protocol fee', 'f(x) fee', 'Claim payout',
  ]);
  const bridgeDecisionLabels = new Set(stableBridgeFacts.map(fact => fact.label).filter(label => !['Total cost', 'Delivery estimate'].includes(label)));
  if (bridgeReview) for (const label of ['Source network', 'Destination network', 'Asset', 'Slippage', 'Price impact']) bridgeDecisionLabels.add(label);
  const additionalFacts = [...hierarchy.primary, ...hierarchy.more].filter(fact =>
    !(bridgeReview ? bridgeDecisionLabels : decisionLabels).has(fact.label)
    && !pairedOutcomeLabels.has(fact.label.toLowerCase()));
  const approvals = (route?.transactions ?? [])
    .map((transaction) => {
      const approval = approvalFacts(transaction);
      if (!approval) return null;
      const amount = approval.valueLabel === 'Position NFT ID'
        ? { value: `#${approval.value}`, title: `#${approval.value}` }
        : tokenAmountReviewFact('Approval', approval.value, transaction.to);
      return { label: stepTitle(transaction), value: amount.value, title: `${amount.title} → ${approval.spender}` };
    })
    .filter((value): value is { label: string; value: string; title: string } => value !== null);
  const showExecutionProgress = stage === 'executing' || stepResults.some(hasTransactionHash);
  const wrongNetwork = wallet.chainId !== undefined && wallet.chainId !== reviewChainId;
  const unsupportedNetwork = wallet.chainId === undefined;
  const activeStep = route?.transactions.findIndex((_, index) => stepResults[index]?.status !== 'confirmed') ?? 0;
  const nextTransaction = route?.transactions[activeStep];
  const progress = plainWalletStatus(statusPresentation({ stage, status, detail: statusDetail, stepResults, stepCount, operation: route?.operation, refreshing, networkSwitching }), status === 'awaiting-user', networkSwitching, nextTransaction?.kind, actionCopy.title);
  const confirmLabel = nextTransaction?.kind === 'approval' ? stepTitle(nextTransaction) : identity.confirm ?? actionCopy.confirm;
  const actionNotice = error ?? (fundsNotice ? <>{fundsNotice} <ReceiveLink /></>
    : checkingGas ? 'Checking network fees and available ETH.'
      : quoteExpired ? 'Quote expired. Review fresh terms to continue.' : undefined);
  const feeSpeedControl = wallet.isEmbedded && (visibleFeeSelection || stablePreparation) && <section className={presentationStyles.advancedGroup} aria-label="Network speed">
        <p className={presentationStyles.advancedGroupLabel}>Network speed</p>
        <fieldset className={styles.feeSelector} disabled={loading || stage !== 'review' || !visibleFeeSelection}>
        <legend className="sr-only">Network fee speed</legend>
        {GAS_TIERS.map((tier) => <label key={tier}>
          <input type="radio" name="review-gas-tier" value={tier} checked={(visibleFeeSelection?.tier ?? readGasTier()) === tier} onChange={() => void selectGasTier(tier)} />
          <span><strong>{tier === 'standard' ? 'Standard' : tier === 'fast' ? 'Fast' : 'Rapid'}</strong><small><ValueOrSkeleton value={visibleFeeSelection ? `${formatGasPriceGwei(visibleFeeSelection.snapshot.tiers[tier].gasPriceWei)} Gwei` : status === 'failed' ? 'Unavailable' : '—'} width="xs" announce={!stablePreparation} label={`Loading ${tier} gas price`} /></small></span>
        </label>)}
      </fieldset></section>;
  const decisionContent = (bridgeReview ? <BridgeReviewSummary facts={stableBridgeFacts} allFacts={[...summaryFacts, ...reviewFacts.details]} sourceChainId={reviewChainId} destinationChainId={acceptedBridgeQuote?.destinationChainId} /> : <div className={amountLed || leverageReview ? presentationStyles.amountLedReview : undefined}>
        {amountLed ? <>
          {identity.subtitle && identity.subtitle.toLowerCase() !== chainName(reviewChainId).toLowerCase() && <p className={presentationStyles.amountContext}>{identity.subtitle}</p>}
          <TransactionAmountFlow facts={amountFacts} chainId={reviewChainId} />
        </> : leverageReview ? <><p className={presentationStyles.amountContext}>{identity.subtitle}</p><LeverageChangeSummary facts={acceptedAmountFacts} changes={positionChangeRows} /></> : <TransactionIdentity {...identity} />}
        <div className={`${styles.reviewFacts} ${presentationStyles.facts} ${stablePreparation ? presentationStyles.stableFacts : ''}`}>
          <div className={presentationStyles.consequenceGroup}>
            {collateral && <ReviewTermRow fact={collateral} displayLabel="Position size · collateral" displayValue={collateralValuation ? <CollateralAmount collateral={collateralValuation} /> : undefined} />}
            {compactFacts.map(fact => <ReviewRow compact key={`${fact.label}:${fact.value}`} label={fact.label} displayLabel={fact.label === 'Loan-to-value' ? 'Resulting LTV' : fact.label} value={fact.value} title={fact.title} equivalent={fact.equivalent} quiet={stablePreparation} />)}
            {intent?.kind === 'fxsave-deposit' && <ReviewRow compact label="Current APY" value={currentApy?.value ?? 'Unavailable'} title={currentApy ? currentApy.title : 'The accepted route does not supply a verified current APY. No yield is inferred from an exchange rate or sample value.'} />}
            {tradingAction && <ReviewRow compact label="Execution price" value={executionPrice?.value ?? 'Unavailable'} title={executionPrice ? executionPrice.title : 'The accepted route does not provide a verified execution price.'} />}
            {tradingAction && <ReviewRow compact label="Price impact" value={priceImpact?.value ?? 'Unavailable'} title={priceImpact ? priceImpact.title : 'The accepted route does not provide a verified price-impact estimate.'} />}
            {slippage && !loanAction && <ReviewRow compact label="Slippage" displayLabel="Max. slippage" value={slippage.value} title={slippage.title} />}
          </div>
          {!leverageReview && positionChangeRows.length > 0 && <PositionOutcomeSummary facts={positionChangeRows} />}
          {hierarchy.primary.filter(fact => fact.label === 'Claim payout').map(fact => <p key={fact.label} data-review-fact={fact.label} className={presentationStyles.claimCaveat} title={fact.title}>{fact.value}</p>)}
          {loanAction && <div className={presentationStyles.costGroup}>
            {intent?.kind === 'deposit-and-mint' && intent.mintAmount > 0n && <ReviewRow compact label="Borrow rate" value={borrowRate?.value ?? 'Not quoted'} title={borrowRate ? borrowRate.title : 'The accepted route does not quote the current borrowing or funding rate. A zero base rate does not establish the current funding cost.'} />}
            {hierarchy.primary.filter(fact => ['f(x) fee', 'Protocol fee'].includes(fact.label)).map(fact => <ReviewRow compact key={fact.label} label={fact.label} value={fact.value} title={fact.title} />)}
          </div>}
          <div className={presentationStyles.costGroup}>
            {hierarchy.primary.filter(fact => (loanAction ? ['Gas fee', 'Bridge fee'] : ['Gas fee', 'f(x) fee', 'Protocol fee', 'Bridge fee']).includes(fact.label)).map(fact =>
              <ReviewRow compact key={`${fact.label}:${fact.value}`} label={fact.label} displayLabel={fact.label === 'Gas fee' ? (/max/i.test(fact.value) ? 'Network fee (max)' : 'Network fee') : reviewFactLabel(fact.label)} value={fact.value} title={fact.title} equivalent={fact.equivalent} quiet={stablePreparation} />)}
          </div>
          {(tradingAction || loanAction) && <div className={`${presentationStyles.riskGroup} ${loanAction ? presentationStyles.loanRiskGroup : ''}`}><ReviewRiskPrices route={route} execution={executionPrice} showExecution={false} pending={false} compact />
          </div>}
        </div>
      </div>);
  return (
    <ReviewSurface stable={stablePreparation} surface={surface} mobileSheet={{ title: stage === 'executing' ? identity.name : actionHeading, onClose: reset, triggerRef, dismissible: !loading && stage !== 'executing' }} className={`${styles.reviewCard} ${styles.reviewInlineCard} p-4 sm:p-5`}>
      <ReviewViewport stable={stablePreparation} compact={compactReview} phase={stage === 'executing' ? 'executing' : 'review'}>
      <header data-review-header className={presentationStyles.reviewHeader}>
        <div>
          <h3 ref={headingRef} data-review-focus tabIndex={-1} className="outline-none">
            {stage === 'executing' ? identity.name : actionHeading}
          </h3>
        </div>
        <button data-review-edit type="button" disabled={loading} onClick={reset} className={presentationStyles.editButton}>
          <X aria-hidden="true" className="h-5 w-5" /><span className="sr-only">Close transaction review</span>
        </button>
      </header>
      <div data-review-scroll className={presentationStyles.reviewScrollBody} role="region" aria-label="Review information" tabIndex={0}>

      {stage === 'review' && routes.length > 1 && (
        <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Route options">
          <p className="text-[12px] font-medium text-mut">Choose route</p>
          {routes.map((candidate, index) => (
            <button
              type="button"
              role="radio"
              aria-checked={selectedRoute === index}
              disabled={loading || !canSelectReviewedRoute}
              key={`${candidate.operation}-${index}`}
              tabIndex={selectedRoute === index ? 0 : -1}
              onClick={() => selectReviewedRoute(index)}
              onKeyDown={(event) => {
                const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
                if (!keys.includes(event.key)) return;
                event.preventDefault();
                const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
                const next = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? routes.length - 1
                    : (index + (backwards ? -1 : 1) + routes.length) % routes.length;
                selectReviewedRoute(next);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
              }}
              className={`flex min-h-12 items-center justify-between rounded-xl border px-3 text-left disabled:cursor-default ${selectedRoute === index ? 'border-[var(--mint)] bg-[var(--mint-dim)]' : 'border-[var(--line-strong)] bg-[var(--surface-2)]'}`}
            >
              <span className="text-[12px] font-semibold">{routeSummaries[index].routeType}</span>
              <span className="text-[11px] text-mut">{routeSummaries[index].count} tx · {routeSummaries[index].approvals} approval{routeSummaries[index].approvals === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>
      )}

      {showExecutionProgress && stage !== 'executing' && <div className={presentationStyles.actualProgress}><StatusNotice {...progress} /></div>}
      {stage === 'executing' ? <PendingTransactionSummary showIdentity={false} identity={identity} facts={amountLed ? amountFacts : bridgeReview ? transactionAmountFacts(acceptedAmountFacts) : identity.amount ? [identity.amount] : []} status={status} steps={stepResults} chainId={reviewChainId} networkSwitching={networkSwitching} nextKind={nextTransaction?.kind} requestLabel={nextTransaction ? nextTransaction.kind === 'approval' ? stepTitle(nextTransaction) : identity.confirm ?? actionCopy.confirm : undefined} requestNumber={activeStep + 1} requestCount={stepCount} /> : decisionContent}



      {/* Trade's card says this in its status line, and an error already says why the route must be reviewed again. */}
      {quoteExpired && !stablePreparation && !error && <p role="status" className={presentationStyles.reviewNotice}>Quote expired · review again</p>}
      {stage === 'review' && <UpdatedQuoteSummary changes={quoteChanges} />}

      {route && wrongNetwork && <p role="status" className={presentationStyles.reviewNotice}>Network switch: {chainName(wallet.chainId!)} → {chainName(reviewChainId)}</p>}
      {route && unsupportedNetwork && <p role="status" className={presentationStyles.reviewNotice}>Network unavailable · {chainName(reviewChainId)} required</p>}

      <details data-review-secondary className={presentationStyles.reviewDetails} aria-label="Advanced transaction details">
        <summary><span>Execution details</span><span><ChevronDown size={16} aria-hidden="true" /></span></summary>
      <div className={presentationStyles.disclosures}>
      {stage === 'executing' && <section aria-label="Reviewed terms">{decisionContent}</section>}
      {showExecutionProgress && stage !== 'executing' && <TransactionProgressPresentation label="Submitted transactions" status={status} stepResults={stepResults} chainId={reviewChainId} presentation={progress} />}
      {route ? <>
      {feeSpeedControl}
      <DecisionContext beforeFacts={positionChanges.remainingBefore.filter(fact => !['Collateral', 'Debt', 'Loan-to-value'].includes(fact.label))} />
      {(additionalFacts.length > 0 || approvals.length > 0) && <section className={`${presentationStyles.advancedGroup} ${presentationStyles.moreFacts}`} aria-label="Route and limits">
        <p className={presentationStyles.advancedGroupLabel}>Route & limits</p>
        {additionalFacts.map(fact => <ReviewRow secondary quiet={stablePreparation} key={`${fact.label}:${fact.value}`} label={fact.label} displayLabel={fact.label === 'Slippage' ? 'Max. slippage' : reviewFactLabel(fact.label)} value={fact.value} title={fact.title} equivalent={fact.equivalent} />)}
        {approvals.map((approval, index) => <ReviewRow key={`${approval.label}-${index}`} label={approval.label} value={approval.value} title={approval.title} />)}
      </section>}

      <section className={presentationStyles.advancedGroup} aria-label="Prepared transactions">
        <p className={presentationStyles.advancedGroupLabel}>Wallet requests</p>
        {route.transactions.map((transaction, index) => {
          const approval = approvalFacts(transaction);
          const progress = stepProgress(stepResults[index]);
          return (
          <div key={`${transaction.to}-${index}`} role="group" aria-label={`Transaction ${index + 1}`} className={presentationStyles.transactionStep}>
            <div className={presentationStyles.transactionStepHeader}>
              <span className={presentationStyles.transactionStepTitle}><span className={presentationStyles.transactionStepNumber} aria-hidden="true">{index + 1}</span>{stepTitle(transaction)}</span>
              {stepResults[index] && <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${progress.className}`}>{progress.icon}{progress.label}</span>}
            </div>
            {approval && <p className={presentationStyles.transactionStepNote}>{approvalSummary(transaction, approval)} to <span className="font-mono">{compactAddress(approval.spender)}</span></p>}
            {transaction.value > 0n && <p className={presentationStyles.transactionStepNote}>Value sent: {exactAmountText(trimDecimal(formatEther(transaction.value)))} ETH <span className="text-[var(--mut-2)]">(network fees are separate)</span><AmountUsd amount={formatEther(transaction.value)} symbol="ETH" /></p>}
            <div className={presentationStyles.advancedRows}>
              <TechnicalEvidenceRow label="Contract" value={transaction.to} />
              <TechnicalEvidenceRow label="Transaction value (wei)" value={transaction.value.toString()} />
              <ReviewRow label="Nonce" value={transaction.nonce === undefined ? 'Checked before signing' : String(transaction.nonce)} />
              {approval && <TechnicalEvidenceRow label="Approval spender" value={approval.spender} />}
              {approval && <TechnicalEvidenceRow label={approval.valueLabel} value={approval.value.toString()} />}
              <CalldataDisclosure data={transaction.data} />
            </div>
          </div>
          );
        })}
      </section>

      </> : null}
      {route && <AdvancedReviewDetails route={route} />}
      <div className={presentationStyles.advancedNotes}>
        <p>USD uses current prices, not transaction limits or receipt-time prices.</p>
      </div>
      </div>
      </details>

      {/* A failed check is told once, by its error below, not again as "Action stopped". */}
      {!stablePreparation && !showExecutionProgress && !(stage === 'review' && status === 'reviewing') && !(stage === 'review' && status === 'failed' && error) && <div className="mt-4"><StatusNotice {...progress} /></div>}
      {(!stablePreparation || stage === 'executing') && error && <div className="mt-3"><InlineError message={error} /></div>}
      </div>
      {stage === 'review' && (
        <div data-review-actions className={`${styles.reviewInlineActions} ${presentationStyles.actions}`}>
          {stablePreparation && <><span className="sr-only" role="status" aria-live="polite">{quoteExpired ? 'Review expired.' : 'Transaction route checked.'}</span>{actionNotice && <p role={error ? 'alert' : undefined} aria-live={error ? 'assertive' : 'off'} className={`${presentationStyles.stableReviewStatus} ${error || fundsNotice || quoteExpired ? 'text-warn' : 'text-mut'}`}>{actionNotice}</p>}</>}
          {!stablePreparation && fundsNotice && <p className={styles.fundsNote} role="status">
            {fundsNotice} <ReceiveLink />
          </p>}
          <Button variant={destructive ? 'danger' : 'primary'} data-blocked={fundsNotice ? true : undefined}
            disabled={disabled || !planBuilder || loading || (!quoteExpired && (status === 'failed' || fundsShort || checkingGas))} loading={loading} className={styles.primaryAction}
            onClick={() => quoteExpired ? void refreshReviewedQuote() : void execute()}>
            {quoteExpired ? 'Review updated quote' : fundsShort ? 'Not enough ETH' : checkingGas ? 'Checking network fees…' : confirmLabel}
          </Button>
        </div>
      )}
      </ReviewViewport>
    </ReviewSurface>
  );

}

function ReviewSurface({ surface, className, children, stable = false, mobileSheet }: { surface: 'card' | 'content'; className: string; children: ReactNode; stable?: boolean; mobileSheet: { title: string; subtitle?: ReactNode; onClose: () => void; triggerRef: RefObject<HTMLElement | null>; dismissible?: boolean; hideTitle?: boolean } }) {
  const content = surface === 'content'
    ? <div data-review-surface className={`${styles.reviewInlineContent} reviewInlineContent ${stable ? '' : presentationStyles.surfaceEnter}`}>{children}</div>
    : <Card data-review-surface className={`${className} ${stable ? '' : presentationStyles.surfaceEnter}`}>{children}</Card>;
  return <MobileFlowSheet {...mobileSheet}>{content}</MobileFlowSheet>;
}

/** `equivalent` reads muted beneath the value: the same amount in another unit, never the signed figure. */
function ReviewRow({ label, displayLabel, value, title, equivalent, className, quiet = false, compact = false, secondary = false }: { label: string; displayLabel?: string; value: ReactNode; title?: string; equivalent?: string; className?: string; quiet?: boolean; compact?: boolean; secondary?: boolean }) {
  const valueTitle = title ?? (typeof value === 'string' ? value : undefined);
  if (compact && typeof value === 'string') return <ReviewTermRow fact={{ label, value, title, equivalent }} displayLabel={displayLabel} quiet={quiet} />;
  return <div data-review-fact={secondary ? undefined : label} data-review-evidence={secondary ? label : undefined} className={`flex min-w-0 items-center justify-between gap-4 text-[13px] ${className ?? ''}`}><MetricLabel className="text-mut" label={displayLabel ?? label} definition={reviewHelpDefinition(label)} /><span title={valueTitle} className="max-w-[62%] break-words text-right font-semibold tabular-nums">{['Gas fee', 'Bridge fee'].includes(label) && typeof value === 'string' ? <FeeAmount fact={{ value, title }} /> : <>{typeof value === 'string' && value !== '—' ? <ReviewFactValue fact={{ label, value, title }} /> : <ValueOrSkeleton value={value} width="md" announce={!quiet} label={`Loading ${label.toLowerCase()}`} />}</>}{equivalent && <span className={presentationStyles.factEquivalent}>{equivalent}</span>}{label === 'Total cost' && typeof value === 'string' && <FeeUsd fact={{ value, title }} />}</span></div>;
}

/** The recovery for a wallet short of ETH: its Receive address. */
function ReceiveLink() {
  return <Link href="/qr" className={styles.fundsLink}>Receive ETH</Link>;
}

function AdvancedReviewDetails({ route }: { route: PlannedRoute }) {
  const bridgeQuote = isBridgeQuote(route.quote) ? route.quote : null;
  const rawQuoteFacts = rawQuoteReviewFacts(route);
  const evidence = {
    requestedAmountRaw: route.details?.requestedAmount,
    quote: rawQuoteFacts,
    economicLimits: route.details?.economicLimits,
    conversionPaths: route.details?.conversionPaths,
    actionFingerprint: route.policy?.reviewedAction?.expectedActionDataFingerprint,
    ...(bridgeQuote ? { bridge: bridgeQuote } : {}),
  };
  const hasDetails = Object.values(evidence).some(value => Array.isArray(value) ? value.length > 0 : value !== undefined);
  if (!hasDetails) return null;
  const exactJson = exactEvidenceJson(evidence);
  return <section className={presentationStyles.advancedGroup} aria-label="Contract and quote data">
    <p className={presentationStyles.advancedGroupLabel}>Verification data</p>
    <TechnicalEvidenceRow label="Quote data" value={exactJson} preview="View exact data" />
    {route.policy?.reviewedAction?.expectedActionDataFingerprint && <TechnicalEvidenceRow label="Action fingerprint" value={route.policy.reviewedAction.expectedActionDataFingerprint} />}
  </section>;

}

type BridgeReviewQuote = {
  nativeFee: bigint;
  destinationChainId?: number;
  lzTokenFee?: bigint;
  sourceOftAddress?: string;
  destinationOftAddress?: string;
  sourceTokenAddress?: string;
  destinationEid?: number;
  recipientBytes32?: string;
  amountLD?: bigint;
  minAmountLD?: bigint;
  extraOptions?: string;
  composeMsg?: string;
  oftCmd?: string;
  refundAddress?: string;
  bridgeToken?: string;
  bridgeAmount?: bigint;
  deliveryLowerBound?: bigint;
  destinationTokenAddress?: string;
  destinationBaselineBlock?: bigint;
  recipient?: string;
  sourceApprovalRequired?: boolean;
  destinationApprovalRequired?: boolean;
  approvalTokenAddress?: string;
};

function isBridgeQuote(value: unknown): value is BridgeReviewQuote {
  return Boolean(value && typeof value === 'object' && 'nativeFee' in value && typeof (value as { nativeFee?: unknown }).nativeFee === 'bigint');
}
function DecisionContext({ beforeFacts }: { beforeFacts?: ReviewFact[] }) {
  if (!beforeFacts?.length) return null;
  return <section aria-label="Current position" className={presentationStyles.advancedGroup}>
    <p className={presentationStyles.advancedGroupLabel}>Current position</p>
    <div className={presentationStyles.advancedRows}>{beforeFacts.map((fact) => <ReviewRow key={`before-${fact.label}`} label={fact.label} value={fact.value} title={fact.title} />)}</div>
  </section>;
}
