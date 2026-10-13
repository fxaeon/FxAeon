'use client';

import { type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePauseAutomaticPositionRefresh } from './PositionRefreshActivity';
import { usePresentedTransactions } from '@/lib/pendingActivity';
import {
  AlertTriangle,
  ArrowLeft,
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
import { ChainIcon } from '@/components/TokenIcon';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import { consequenceSummary, pairVerifiedPositionFacts, reviewActionLabel } from '@/components/review/actionReviewModel';
import { useActionReviewLifecycle } from '@/components/review/useActionReviewLifecycle';
import { selectExecutionTask } from '@/lib/taskState';
import { buildReceiptPresentation, receiptTransfersFromLogs } from '@/lib/receiptPresentation';
import { receiptMintedPositionIdentity } from '@/lib/confirmedPositions';
import { openedPositionTitle, positionSideLabel } from '@/lib/positionNaming';
import { rawQuoteReviewFacts, tokenAmountReviewFact, type ReviewFact } from '@/lib/fx/reviewFormatting';
import { buildStatusPresentation } from '@/components/review/actionReviewStatusModel';
import { PositionOutcomeSummary, TransactionProgressPresentation, UpdatedQuoteSummary } from '@/components/review/ActionReviewSummary';
import { TransactionResultView } from '@/components/review/TransactionResultView';
import { ReviewViewport } from '@/components/review/ReviewViewport';
import { positionPoolAddress } from '@/lib/fx/policy';
import { stableTradeReviewFacts } from './review/stableTradeReviewFacts';
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

/** Say up front when the wallet will ask more than once, and in what order. */
function walletRequestsNotice(transactions: readonly PlannedTransaction[]): string | undefined {
  if (transactions.length < 2) return undefined;
  const count = ['Two', 'Three', 'Four'][transactions.length - 2] ?? String(transactions.length);
  const steps = transactions.map((transaction, index) => {
    const title = stepTitle(transaction).replace(/^\w/, (letter) => letter.toLowerCase());
    return index === transactions.length - 1 ? `then ${title}` : title;
  });
  return `${count} wallet requests: ${steps.join(', ')}.`;
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
  const { label = 'Review action', disabled = false, blocker = null, operationLabel, destructive = false, editor, decisionBefore, executionCost, surface = 'card', planBuilder, onViewNewPosition } = props;
  const { canSelectReviewedRoute, endConnectFlow, error, execute, feeSelection, gasCost, headingRef, loading, networkSwitching, quoteChanges, quoteExpired, refreshReviewedQuote, refreshing, reset, result, review, reviewTitle, route, routeSummaries, routes, selectedRoute, selectReviewedRoute, selectGasTier, startConnectFlow, stage, status, statusDetail, stepResults, triggerRef, wallet } = lifecycle;
  usePauseAutomaticPositionRefresh(stage === 'planning' || stage === 'review' || stage === 'executing' || refreshing);
  // This review shows its own progress and result; the header notice stays for steps settling elsewhere.
  usePresentedTransactions([...stepResults, ...(result?.steps ?? [])].map((step) => step.hash));

  if (stage === 'input') {
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
          <Button ref={triggerRef} variant={destructive ? 'danger' : 'primary'} className={styles.primaryAction} data-blocked={blocker ? true : undefined} disabled={Boolean(blocker) || !planBuilder || disabled || !wallet.ready} loading={loading} onClick={() => void review()}>
            {blocker || reviewLabel}
          </Button>
        )}
        {loading && <StatusNotice {...progress} />}
      </div>
      </StickyAction>
    );
    if (editor) {
      return <>{editor}{trigger}</>;
    }
    return trigger;
  }

  if (stage === 'planning' && !props.preparationFacts?.length) {
    return (
      <ReviewSurface surface={surface} className={`${styles.reviewCard} ${styles.reviewInlineCard} p-4 sm:p-5`}>
          {/* Edit keeps the review header's place, so it does not jump when the review lands. */}
          <div className={presentationStyles.planningBar}>
            <button type="button" onClick={reset} className={presentationStyles.editButton}><ArrowLeft aria-hidden="true" className="h-4 w-4" /> Edit</button>
          </div>
          <div className="flex min-h-44 flex-col items-center justify-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
              <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
            </span>
            <h3 ref={headingRef} data-review-focus tabIndex={-1} className="text-display mt-4 text-[21px] font-semibold outline-none">Preparing review</h3>
            <p role="status" aria-live="polite" className={presentationStyles.planningStep}><span key={status}>{preparationStep(status)}</span></p>
          </div>
      </ReviewSurface>
    );
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
    const confirmedTitle = opened ? openedPositionTitle(opened.market, opened.side)
      : closedPosition ? 'Position closed'
      : result.operation === 'adjustPositionLeverage' ? 'Leverage updated'
      : positionAction ? 'Position updated'
      : result.operation === 'depositFxSave' ? 'Deposit complete'
      : undefined;
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
    const approvalSubmittedWithoutAction = result.status === 'partial'
      && result.steps.some((step) => step.transaction.kind === 'approval' && hasTransactionHash(step))
      && !result.steps.some((step) => step.transaction.kind === 'action' && hasTransactionHash(step));
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
      <ReviewSurface surface={surface} className={`${styles.reviewCard} ${styles.reviewInlineCard} p-4 sm:p-5`}>
        <TransactionResultView
          result={result}
          presentation={presentation}
          refreshing={refreshing}
          positionAction={positionAction}
          positionLabel={positionLabel}
          newPosition={newPosition}
          receipts={receiptFacts}
          headingRef={headingRef}
          bridgeTracker={bridgeQuote && bridgeStep?.hash ? (
            <BridgeTracker
              className="mt-4 w-full text-left"
              sourceChain={route.chainId === 1 ? 'Ethereum' : 'Base'}
              destinationChain={route.chainId === 1 ? 'Base' : 'Ethereum'}
              token={bridgeQuote.bridgeToken ?? 'Bridge asset'}
              amount={bridgeQuote.bridgeAmount === undefined ? '' : formatUnits(bridgeQuote.bridgeAmount, 18)}
              sourceTxHash={bridgeStep.hash}
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
          nextLabel={transactionTask ? 'View transaction progress' : approvalSubmittedWithoutAction ? 'Continue action' : bridge ? 'Back to Move' : closedPosition ? 'View positions' : positionAction ? 'View position' : result.status === 'confirmed' ? 'Done' : 'Try again'}
          onNext={() => {
            if (approvalSubmittedWithoutAction) { reset(); return; }
            if (transactionTask) { router.push(transactionTask.href); return; }
            if (positionAction) {
              // A position this review just opened can open in place, carrying its split.
              if (newPosition && positionHref && onViewNewPosition) { onViewNewPosition({ key: newPosition.key, href: positionHref }); return; }
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
  const preparing = stage === 'planning';
  if (!route && !stablePreparation) return null;
  const reviewChainId = route?.chainId ?? 1; // Trade's inputs are Ethereum-only.
  const stepCount = route?.transactions.length ?? 0;
  // A wallet that cannot pay the network fee would only reach a failed or
  // stalled signing screen, so the review names the shortfall instead. A
  // fresh partial estimate still proves it: every step costs at least 21,000 gas.
  const fundsShort = Boolean(gasCost.current?.insufficientNativeBalance);
  const checkingGas = gasCost.checking;
  const feeNetwork = reviewChainId === 8453 ? 'Base' : 'Ethereum';
  const fundsNotice = fundsShort && !quoteExpired ? nativeFundsNotice(gasCost.current, feeNetwork) : undefined;
  const requestsNotice = stage === 'review' && !quoteExpired && route ? walletRequestsNotice(route.transactions) : undefined;
  const visibleFeeSelection = preparing ? null : feeSelection;
  const feeTierQuote = wallet.isEmbedded && visibleFeeSelection?.snapshot.chainId === reviewChainId
    ? visibleFeeSelection.snapshot.tiers[visibleFeeSelection.tier]
    : undefined;
  const facts = route ? buildRouteFacts(route, gasCost, executionCost, feeTierQuote) : [];
  const missingGasFee = missingGasFeeFact(gasCost);
  if (missingGasFee && !facts.some((fact) => fact.label === 'Gas fee')) facts.push(missingGasFee);
  const missingTotalCost = route ? missingTotalCostFact(route, gasCost) : undefined;
  if (missingTotalCost && !facts.some((fact) => fact.label === 'Total cost')) facts.push(missingTotalCost);
  const reviewFacts = splitReviewFacts(facts);
  const consequenceFacts = route ? consequenceSummary(primaryReviewFacts(route)) : [];
  const positionChanges = pairVerifiedPositionFacts(decisionBefore ?? [], facts);
  // A paired value lives in Position outcome only, whichever label it paired with.
  const pairedOutcomeLabels = new Set(positionChanges.paired.flatMap((fact) => {
    const label = fact.label.toLowerCase();
    return [`estimated ${label}`, `expected ${label}`, label];
  }));
  const actionConsequences = consequenceFacts.filter((fact) => !pairedOutcomeLabels.has(fact.label.toLowerCase()));
  const remainingSummaryFacts = factsOutsideConsequenceSummary(reviewFacts.summary, actionConsequences);
  const verifiedSummaryFacts = [...actionConsequences, ...remainingSummaryFacts].filter((fact) => !['Gas tier', 'Action'].includes(fact.label));
  const summaryFacts = stablePreparation
    ? stableTradeReviewFacts(props.preparationFacts ?? [], verifiedSummaryFacts, { preparing, failed: status === 'failed', checkingGas, hasVerifiedRoute: Boolean(route), totalIsGasOnly: Boolean(route && gasCost.estimateIsCurrent && gasCost.estimate?.nativeValueWei === 0n && gasCost.estimate.totalNativeCostWei !== undefined) })
    : verifiedSummaryFacts;
  const primaryAmount = summaryFacts.find((fact) => ['Amount', 'Input amount', 'Deposit', 'Repay', 'fxSAVE'].includes(fact.label));
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
  const progress = statusPresentation({ stage, status, detail: statusDetail, stepResults, stepCount, operation: route?.operation, refreshing, networkSwitching });
  const showExecutionProgress = stage === 'executing' || stepResults.some(hasTransactionHash);
  const wrongNetwork = wallet.chainId !== undefined && wallet.chainId !== reviewChainId;
  const unsupportedNetwork = wallet.chainId === undefined;
  return (
    <ReviewSurface stable={stablePreparation} surface={surface} className={`${styles.reviewCard} ${styles.reviewInlineCard} p-4 sm:p-5`}>
      <ReviewViewport stable={stablePreparation} busy={preparing && status !== 'failed'}>
      <header className={presentationStyles.reviewHeader}>
        <div>
          <h3 ref={headingRef} data-review-focus tabIndex={-1} className="text-display outline-none">
            {reviewTitle ?? operationLabel ?? route?.operation ?? label}
          </h3>
          <p className={presentationStyles.reviewNetwork}><span aria-hidden="true"><ChainIcon chainId={reviewChainId} size={16} /></span>{chainName(reviewChainId)}</p>
        </div>
        <button type="button" disabled={loading && !preparing} onClick={reset} className={presentationStyles.editButton}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Edit
        </button>
      </header>
      <div className={presentationStyles.reviewScrollBody} role="region" aria-label="Review information" tabIndex={0}>

      {showExecutionProgress && (
        <div className={presentationStyles.actualProgress}>
          <TransactionProgressPresentation label="Submitted transactions" status={status} stepResults={stepResults} chainId={reviewChainId} presentation={progress} />
        </div>
      )}

      {routes.length > 1 && (
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

      <div className={`${styles.reviewFacts} ${stablePreparation ? `${presentationStyles.stableFacts} ${preparing && status !== 'failed' ? presentationStyles.preparingFacts : ''}` : ''}`}>
        {summaryFacts.map((fact) => fact === primaryAmount
          ? <ReviewAmount key={stablePreparation ? fact.label : `${fact.label}-${fact.value}`} fact={fact} stable={stablePreparation} />
          : <ReviewRow key={stablePreparation ? fact.label : `${fact.label}-${fact.value}`} label={fact.label} value={fact.value} title={fact.title} equivalent={fact.equivalent} quiet={stablePreparation} />)}
        {approvals.map((approval, index) => <ReviewRow key={`${approval.label}-${index}`} label={approval.label} value={approval.value} title={approval.title} />)}
     </div>

      {wallet.isEmbedded && (visibleFeeSelection || stablePreparation) && <fieldset className={styles.feeSelector} disabled={loading || stage !== 'review' || !visibleFeeSelection}>
        <legend className="sr-only">Network fee speed</legend>
        {GAS_TIERS.map((tier) => <label key={tier}>
          <input type="radio" name="review-gas-tier" value={tier} checked={(visibleFeeSelection?.tier ?? readGasTier()) === tier} onChange={() => void selectGasTier(tier)} />
          <span><strong>{tier === 'standard' ? 'Standard' : tier === 'fast' ? 'Fast' : 'Rapid'}</strong><small><ValueOrSkeleton value={visibleFeeSelection ? formatGasPriceGwei(visibleFeeSelection.snapshot.tiers[tier].gasPriceWei) : status === 'failed' ? 'Unavailable' : '—'} width="xs" announce={!stablePreparation} label={`Loading ${tier} gas price`} /></small></span>
        </label>)}
      </fieldset>}

      {/* Trade's card says this in its status line, and an error already says why the route must be reviewed again. */}
      {!preparing && quoteExpired && !stablePreparation && !error && <p role="status" className={presentationStyles.reviewNotice}>This reviewed quote expired. Refresh and review the updated terms before signing.</p>}
      {!preparing && <UpdatedQuoteSummary changes={quoteChanges} />}

      {route && wrongNetwork && <p role="status" className={presentationStyles.reviewNotice}>Wallet is on {chainName(wallet.chainId!)}. Confirmation will switch to {chainName(reviewChainId)} before signing.</p>}
      {route && unsupportedNetwork && <p role="status" className={presentationStyles.reviewNotice}>Wallet network is unavailable or unsupported. Confirmation will request {chainName(reviewChainId)} before signing.</p>}

      <PositionOutcomeSummary facts={positionChanges.paired} />
      <details className={presentationStyles.reviewDetails} aria-label="Review details">
        <summary><span>Details</span><span>{route ? `${stepCount} ${stepCount === 1 ? 'transaction' : 'transactions'}` : <ValueOrSkeleton value={status === 'failed' ? 'Unavailable' : '—'} width="sm" announce={!stablePreparation} label="Checking transaction steps" />}<ChevronDown size={16} aria-hidden="true" /></span></summary>
      <div className={presentationStyles.disclosures}>
      {route ? <>
      <DecisionContext beforeFacts={positionChanges.remainingBefore.length ? positionChanges.remainingBefore : undefined} />
      {/* Summary facts are already visible above. Keep Quote details for the
       * remaining exact route metadata so a fact has one deliberate home. */}
      <QuoteFactDetails facts={reviewFacts.details} />
      <AdvancedReviewDetails route={route} />

      <details className="mt-3 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.02)] px-3">
        <summary id="transaction-steps-heading" className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[12px] font-semibold text-mut">
          <span>{stage === 'executing' ? 'Transaction progress' : `Steps · ${stepCount}`}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <section className="flex flex-col gap-2 border-t border-[var(--line)] py-3" aria-label="Prepared transactions">
        {route.transactions.map((transaction, index) => {
          const approval = approvalFacts(transaction);
          const progress = stepProgress(stepResults[index]);
          return (
          <div key={`${transaction.to}-${index}`} role="group" aria-label={`Transaction ${index + 1}`} className={presentationStyles.transactionStep}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-semibold">{index + 1}. {stepTitle(transaction)}</span>
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${progress.className}`}>{progress.icon}{progress.label}</span>
            </div>
            {approval && <p className="mt-1 text-[12px] text-mut">{approvalSummary(transaction, approval)} to <span className="font-mono">{compactAddress(approval.spender)}</span></p>}
            {transaction.value > 0n && <p className="mt-1 text-[12px] text-mut">Value sent: {exactAmountText(trimDecimal(formatEther(transaction.value)))} ETH <span className="text-[var(--mut-2)]">(network fees are separate)</span></p>}
            <details className={`mt-2 border-t border-[var(--line)] pt-2 ${presentationStyles.stepDetails}`}>
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[12px] text-mut">Transaction details<ChevronDown size={16} aria-hidden="true" /></summary>
              <ReviewRow label="Contract" value={transaction.to} />
              <ReviewRow label="Transaction value (wei)" value={transaction.value.toString()} />
              <ReviewRow label="Nonce" value={transaction.nonce === undefined ? 'Checked before signing' : String(transaction.nonce)} />
              {approval && <ReviewRow label="Approval spender" value={approval.spender} />}
              {approval && <ReviewRow label={approval.valueLabel} value={approval.value.toString()} />}
              <p className="mt-1 font-mono text-[11px] text-mut">Selector: {transaction.data.slice(0, 10)}</p>
              <CalldataDisclosure data={transaction.data} />
            </details>
          </div>
          );
        })}
        </section>
      </details>

      </> : <p className="py-3 text-[12px] text-mut">Transaction details will appear after verification.</p>}
      </div>
      </details>

      {/* A failed check is told once, by its error below, not again as "Action stopped". */}
      {!stablePreparation && !showExecutionProgress && !(stage === 'review' && status === 'reviewing') && !(stage === 'review' && status === 'failed' && error) && <div className="mt-4"><StatusNotice {...progress} /></div>}
      {(!stablePreparation || stage === 'executing') && error && <div className="mt-3"><InlineError message={error} /></div>}
      </div>
      {(stage === 'review' || preparing) && (
        <div className={styles.reviewInlineActions}>
          {stablePreparation && <><span className="sr-only" role="status" aria-live="polite">{preparing ? status === 'failed' ? 'Review preparation failed.' : 'Preparing review.' : quoteExpired ? 'Review expired.' : 'Transaction route checked.'}</span><p role={error ? 'alert' : undefined} aria-live={error ? 'assertive' : 'off'} className={`${presentationStyles.stableReviewStatus} ${preparing && status !== 'failed' ? presentationStyles.preparingReviewStatus : ''} ${error || fundsNotice || (quoteExpired && !preparing) ? 'text-warn' : 'text-mut'}`}>
            {error ?? (fundsNotice
              ? <>{fundsNotice} <ReceiveLink /></>
              : preparing ? <span key={status} className={presentationStyles.stepText}>{preparationStep(status)}</span>
                : checkingGas ? 'Checking network fees and available ETH.'
                  : quoteExpired ? 'This reviewed quote expired. Review the updated terms before signing.' : requestsNotice ?? 'Review the details before confirming in your wallet.')}
          </p></>}
          {!stablePreparation && fundsNotice && <p className={styles.fundsNote} role="status">
            {fundsNotice} <ReceiveLink />
          </p>}
          {!stablePreparation && !fundsNotice && requestsNotice && <p className={styles.requestsNote}>{requestsNotice}</p>}
          <Button variant={destructive ? 'danger' : 'primary'} data-blocked={fundsNotice ? true : undefined}
            disabled={disabled || !planBuilder || loading || (preparing && status !== 'failed') || (!preparing && !quoteExpired && (status === 'failed' || fundsShort || checkingGas))} loading={loading && !preparing} className={styles.primaryAction}
            onClick={() => preparing ? void review() : quoteExpired ? void refreshReviewedQuote() : void execute()}>
            {preparing ? status === 'failed' ? 'Retry review' : 'Checking transaction…' : quoteExpired ? 'Review updated quote' : fundsShort ? 'Not enough ETH' : checkingGas ? 'Checking network fees…' : approvals[0]?.label ?? 'Confirm'}
          </Button>
        </div>
      )}
      </ReviewViewport>
    </ReviewSurface>
  );

}

function ReviewSurface({ surface, className, children, stable = false }: { surface: 'card' | 'content'; className: string; children: ReactNode; stable?: boolean }) {
  if (surface === 'content') return <div className={`${styles.reviewInlineContent} reviewInlineContent ${stable ? '' : presentationStyles.surfaceEnter}`}>{children}</div>;
  return <Card className={`${className} ${stable ? '' : presentationStyles.surfaceEnter}`}>{children}</Card>;
}

/** `equivalent` reads muted beneath the value: the same amount in another unit, never the signed figure. */
function ReviewRow({ label, value, title, equivalent, className, quiet = false }: { label: string; value: ReactNode; title?: string; equivalent?: string; className?: string; quiet?: boolean }) {
  const valueTitle = title ?? (typeof value === 'string' ? value : undefined);
  return <div data-review-fact={label} className={`flex min-w-0 items-start justify-between gap-4 text-[13px] ${className ?? ''}`}><span className="text-mut">{label}</span><span title={valueTitle} className="max-w-[62%] break-words text-right font-semibold tabular-nums"><ValueOrSkeleton value={value} width="md" announce={!quiet} label={`Loading ${label.toLowerCase()}`} />{equivalent && <span className={presentationStyles.factEquivalent}>{equivalent}</span>}</span></div>;
}

/**
 * The amount at stake leads the review, exact to the last digit. Its figure
 * steps down with its own width (as the amount field does) and wraps rather
 * than ever widening the card; the unit recedes beside it.
 */
function ReviewAmount({ fact, stable }: { fact: ReviewFact; stable: boolean }) {
  const parts = /^(\S*\d)\s+(\S+)$/.exec(fact.value);
  const figure = parts?.[1] ?? fact.value;
  const unit = parts?.[2];
  const length = figure.length + (unit ? (unit.length + 1) * 0.6 : 0);
  return <div data-review-fact={fact.label} className={presentationStyles.primaryAmount} style={{ '--review-amount-length': length.toFixed(1) } as CSSProperties}>
    <span>{fact.label}</span>
    <span title={fact.title ?? fact.value}>{unit
      ? <>{figure}<span className={presentationStyles.amountUnit}> {unit}</span></>
      : <ValueOrSkeleton value={fact.value} width="lg" announce={!stable} label={`Loading ${fact.label.toLowerCase()}`} />}</span>
  </div>;
}

/** The recovery for a wallet short of ETH: its Receive address. */
function ReceiveLink() {
  return <Link href="/qr" className={styles.fundsLink}>Receive ETH</Link>;
}

function AdvancedReviewDetails({ route }: { route: PlannedRoute }) {
  const bridgeQuote = isBridgeQuote(route.quote) ? route.quote : null;
  const rawQuoteFacts = rawQuoteReviewFacts(route);
  const hasDetails = Boolean(
    route.details?.requestedAmount
      || rawQuoteFacts.length
      || route.details?.sdkSlippagePercent !== undefined
      || route.details?.economicLimits?.length
      || route.details?.conversionPaths?.length
      || route.policy?.reviewedAction?.expectedActionDataFingerprint
      || bridgeQuote,
  );
  if (!hasDetails) return null;

  return (
    <details className="mt-4 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.02)] px-3">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[12px] font-semibold text-mut">
        <span>Advanced details</span>
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 disclosure-chevron" />
      </summary>
      <div className="flex flex-col gap-2.5 border-t border-[var(--line)] py-3">
        {route.details?.requestedAmount && <ReviewRow label="Requested amount (raw units)" value={route.details.requestedAmount} />}
        {rawQuoteFacts.map((fact) => <ReviewRow key={fact.label} label={fact.label} value={fact.value} />)}
        {route.details?.sdkSlippagePercent !== undefined && <ReviewRow label="Quoted slippage" value={`${route.details.sdkSlippagePercent}%`} />}
        {route.details?.economicLimits?.map((limit, index) => <ReviewRow key={`limit-${index}`} label={limit.label} value={`${limit.value} raw units`} />)}
        {route.details?.conversionPaths?.map((path, index) => <ReviewRow key={`path-${index}`} label={`${path.label} fingerprint`} value={path.fingerprint} />)}
        {route.policy?.reviewedAction?.expectedActionDataFingerprint && <ReviewRow label="Action fingerprint" value={route.policy.reviewedAction.expectedActionDataFingerprint} />}
        {bridgeQuote && (
          <>
            {bridgeQuote.sourceOftAddress && <ReviewRow label="Source OFT" value={bridgeQuote.sourceOftAddress} />}
            {bridgeQuote.destinationOftAddress && <ReviewRow label="Destination OFT" value={bridgeQuote.destinationOftAddress} />}
            {bridgeQuote.sourceTokenAddress && <ReviewRow label="Source token" value={bridgeQuote.sourceTokenAddress} />}
            {bridgeQuote.destinationTokenAddress && <ReviewRow label="Destination token" value={bridgeQuote.destinationTokenAddress} />}
            {bridgeQuote.sourceApprovalRequired !== undefined && <ReviewRow label="Source approval" value={bridgeQuote.sourceApprovalRequired ? 'Required if allowance is low' : 'Not required'} />}
            {bridgeQuote.destinationApprovalRequired !== undefined && <ReviewRow label="Destination approval" value={bridgeQuote.destinationApprovalRequired ? 'Required by adapter' : 'Not required'} />}
            {bridgeQuote.approvalTokenAddress && <ReviewRow label="Approval token" value={bridgeQuote.approvalTokenAddress} />}
            {bridgeQuote.destinationEid !== undefined && <ReviewRow label="Destination endpoint" value={String(bridgeQuote.destinationEid)} />}
            {bridgeQuote.recipientBytes32 && <ReviewRow label="Recipient (bytes32)" value={bridgeQuote.recipientBytes32} />}
            {bridgeQuote.amountLD !== undefined && <ReviewRow label="Bridge amount (raw units)" value={bridgeQuote.amountLD.toString()} />}
            {bridgeQuote.minAmountLD !== undefined && <ReviewRow label="Minimum delivered (raw units)" value={bridgeQuote.minAmountLD.toString()} />}
            {bridgeQuote.extraOptions !== undefined && <ReviewRow label="Extra options" value={bridgeQuote.extraOptions} />}
            {bridgeQuote.composeMsg !== undefined && <ReviewRow label="Compose message" value={bridgeQuote.composeMsg} />}
            {bridgeQuote.oftCmd !== undefined && <ReviewRow label="OFT command" value={bridgeQuote.oftCmd} />}
            {bridgeQuote.refundAddress && <ReviewRow label="Fee refund" value={bridgeQuote.refundAddress} />}
            {bridgeQuote.destinationBaselineBlock !== undefined && <ReviewRow label="Destination baseline block" value={bridgeQuote.destinationBaselineBlock.toString()} />}
          </>
        )}
      </div>
    </details>
  );
}

type BridgeReviewQuote = {
  nativeFee: bigint;
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
function QuoteFactDetails({ facts }: { facts: ReviewFact[] }) {
  if (!facts.length) return null;
  return <details className="mt-2 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.02)] px-3">
    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[11px] font-semibold text-mut">
      <span>Quote details</span><ChevronDown size={16} aria-hidden="true" className="shrink-0 disclosure-chevron" />
    </summary>
    <div className="flex flex-col gap-1 border-t border-[var(--line)] py-2">
      {facts.map((fact) => <ReviewRow key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.title ?? fact.value} title={fact.title ?? fact.value} />)}
    </div>
  </details>;
}

function DecisionContext({ beforeFacts }: { beforeFacts?: ReviewFact[] }) {
  if (!beforeFacts?.length) return null;
  return <details aria-label="Current position" className="group mt-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3">
    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[11px] font-semibold text-mut"><span>Current position</span><span className="text-[10px] font-normal text-[var(--mut-2)] disclosure-closed-only">Verified values</span></summary>
    <div className="grid gap-1 border-t border-[var(--line)] py-2">{beforeFacts.map((fact) => <ReviewRow key={`before-${fact.label}`} label={fact.label} value={fact.value} title={fact.title} />)}</div>
  </details>;
}
