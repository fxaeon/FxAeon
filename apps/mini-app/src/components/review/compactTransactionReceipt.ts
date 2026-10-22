import { formatUnits, parseUnits } from 'viem';
import type { TransactionExecutionResult } from '@/lib/fx';
import type { ReceiptPresentation } from '@/lib/receiptPresentation';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { transactionExplorerUrl, transactionStepProgress } from '@/lib/transactionProgress';
import { formatUsd, type UsdPriceSnapshot } from '@/lib/prices';
import { amountUsdValue } from './transactionAmountPresentation';

/** Supplied only after BridgeTracker verifies canonical destination delivery. */
export type CompactDestinationReceipt = { chainId: 1 | 8453; hash: string };

/** A successful approval, a submitted hash, or an outer status alone is not an action receipt. */
export function hasCompactConfirmedTransaction(result: TransactionExecutionResult): boolean {
  return result.status === 'confirmed'
    && result.steps.some(step => step.transaction.kind === 'action')
    && result.steps.every(step => step.transaction.chainId === result.chainId && transactionStepProgress(step).state === 'confirmed');
}

export type CompactReceiptOutcomeRow = {
  label: string;
  amount: string;
  symbol: string;
  direction: 'sent' | 'received';
};

/**
 * Only verified receipt values belong in the result's primary amount group.
 * Reviewed amounts, debt changes and collateral estimates are not transfers.
 * Unknown token units (including unrecognized Base tokens) stay technical.
 */
export function compactTransactionOutcomeModel(
  result: TransactionExecutionResult,
  receipts: readonly ReceiptPresentation[],
  reviewedFacts: readonly ReviewFact[] = [],
) {
  if (!hasCompactConfirmedTransaction(result)) return null;
  const actionReceipts = receipts.filter(receipt => receipt.transactionKind === 'action');
  // These presentations are ordered, not hash-addressed. If any is missing or
  // mismatched, do not associate its amount with a different transaction.
  const alignedReceipts = receipts.length === result.steps.length
    && receipts.every((receipt, index) => receipt.transactionKind === result.steps[index]?.transaction.kind);
  const queuedWithdrawal = result.chainId === 1 && result.operation === 'withdrawFxSave'
    && reviewedFacts.some(fact => fact.label === 'Availability' && /cooldown/i.test(fact.value));
  const rows: CompactReceiptOutcomeRow[] = (alignedReceipts ? actionReceipts : []).flatMap(receipt => [
    ...(receipt.exactNativeValue && receipt.nativeValueLabel === 'Native value sent'
      ? [{ direction: 'sent' as const, amount: receipt.exactNativeValue, symbol: 'ETH' }] : []),
    ...(receipt.exactMovements ?? []),
  ]).filter(movement => /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(movement.amount)
    && /^[A-Za-z][A-Za-z0-9]*$/.test(movement.symbol))
    .map(movement => ({
      ...movement,
      label: movement.direction === 'received' ? 'You received'
        : result.operation === 'depositFxSave' ? 'You deposited'
        : result.operation === 'withdrawFxSave' ? 'You redeemed'
        : result.operation === 'depositAndMint' ? 'You deposited'
        : result.operation === 'repayAndWithdraw' ? 'You repaid' : 'You paid',
    })).sort((a, b) => Number(a.direction === 'received') - Number(b.direction === 'received'));
  const hasTechnicalMovements = actionReceipts.some(receipt => receipt.technicalMovements.length > 0);
  const hasUnresolvedMovements = actionReceipts.some(receipt => receipt.movements.length > (receipt.exactMovements?.length ?? 0));
  return { rows, queuedWithdrawal, hasTechnicalMovements, hasUnresolvedMovements };
}

function exactFeeWei(value: string | undefined): bigint | null {
  // Do not round excess precision or parse compact "<"/"≈" display strings.
  return value !== undefined && /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value) ? parseUnits(value, 18) : null;
}

/**
 * Receipt presentations are in the same order as the route's receipted steps.
 * Sum exact native components, not rounded text or reviewed estimates. Base
 * requires its execution, L1 data and operator components, including real zeros.
 */
export function compactTransactionGasFee(result: TransactionExecutionResult, receipts: readonly ReceiptPresentation[]) {
  let complete = receipts.length === result.steps.length && receipts.length > 0 && (result.chainId === 1 || result.chainId === 8453);
  let knownWei = 0n;
  let hasKnownFee = false;
  receipts.forEach((receipt, index) => {
    if (receipt.transactionKind !== result.steps[index]?.transaction.kind || receipt.feeCaveat) complete = false;
    const components = result.chainId === 8453
      ? [receipt.exactFees?.execution, receipt.exactFees?.l1Data, receipt.exactFees?.operator]
      : [receipt.exactFees?.execution];
    for (const component of components) {
      const fee = exactFeeWei(component);
      if (fee === null) complete = false;
      else { knownWei += fee; hasKnownFee = true; }
    }
  });
  return {
    exactNative: complete ? formatUnits(knownWei, 18) : null,
    knownNative: hasKnownFee ? formatUnits(knownWei, 18) : null,
    includesApprovals: result.steps.some(step => step.transaction.kind === 'approval'),
  };
}

export function compactTransactionFooterModel(
  result: TransactionExecutionResult,
  receipts: readonly ReceiptPresentation[],
  evidence: 'live' | 'simulation',
  quote: UsdPriceSnapshot,
  now = Date.now(),
  destinationReceipt?: CompactDestinationReceipt,
) {
  if (!hasCompactConfirmedTransaction(result)) return null;
  const action = result.steps.filter(step => step.transaction.kind === 'action').at(-1)!;
  const simulated = evidence === 'simulation';
  const destinationUrl = destinationReceipt ? transactionExplorerUrl(destinationReceipt.chainId, destinationReceipt.hash) : null;
  if (destinationReceipt && (!destinationUrl || destinationReceipt.chainId === result.chainId)) return null;
  const fee = compactTransactionGasFee(result, receipts);
  const usd = fee.exactNative === null ? null : amountUsdValue(fee.exactNative, 'ETH', quote, now);
  const gasLabel = destinationReceipt ? 'Source gas fee' : 'Gas fee';
  return {
    simulated,
    explorerUrl: simulated ? null : transactionExplorerUrl(result.chainId, action.hash),
    destinationExplorerUrl: simulated ? null : destinationUrl,
    confirmationLabel: simulated ? 'Simulation complete' : 'Transaction confirmed',
    gasLabel,
    feeState: fee.exactNative === null ? 'incomplete' as const : usd === null ? 'price-unavailable' as const : 'priced' as const,
    feeValue: fee.exactNative === null ? 'Unavailable'
      : usd === null ? `${fee.exactNative} ETH`
      : `${usd >= .01 ? '≈ ' : ''}${formatUsd(usd)}`,
    feeNote: fee.exactNative === null ? 'Fee data incomplete' : usd === null ? 'USD unavailable' : usd > 0 ? 'now' : null,
    feeDescription: fee.exactNative === null
      ? `${simulated ? 'Simulated fee data. ' : ''}The full gas fee is unavailable.${destinationReceipt ? ' Source-chain transactions only; excludes destination gas.' : ''}${fee.includesApprovals ? ' Includes token approvals.' : ''}${fee.knownNative === null ? '' : ` Known components total ${fee.knownNative} ETH; this is not the full fee.`}`
      : `${simulated ? 'Simulated gas fee' : 'Gas paid'}: ${fee.exactNative} ETH.${destinationReceipt ? ' Source-chain transactions only; excludes destination gas.' : ''}${fee.includesApprovals ? ' Includes token approvals.' : ''}${usd === null ? ' No fresh USD price is available.' : ' Dollar value uses current prices.'}`,
  };
}
