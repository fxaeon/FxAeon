import { formatUnits, parseUnits } from 'viem';
import type { TransactionExecutionResult } from '@/lib/fx';
import type { ReceiptPresentation } from '@/lib/receiptPresentation';
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
  const priceTime = quote.updatedAts?.ETH ?? quote.updatedAt;
  const gasLabel = destinationReceipt ? 'Source gas fee' : 'Gas fee';
  return {
    simulated,
    explorerUrl: simulated ? null : transactionExplorerUrl(result.chainId, action.hash),
    destinationExplorerUrl: simulated ? null : destinationUrl,
    confirmationLabel: simulated ? 'Simulation complete' : 'Transaction Confirmed',
    gasLabel,
    feeState: fee.exactNative === null ? 'incomplete' as const : usd === null ? 'price-unavailable' as const : 'priced' as const,
    feeValue: fee.exactNative === null ? 'Unavailable'
      : usd === null ? `${fee.exactNative} ETH`
      : `${usd >= .01 ? '≈ ' : ''}${formatUsd(usd)}`,
    feeNote: fee.exactNative === null ? 'Fee data incomplete' : usd === null ? 'USD unavailable' : usd > 0 ? 'now' : null,
    feeDescription: fee.exactNative === null
      ? `${simulated ? 'Simulated fee data. ' : ''}The full gas fee is unavailable.${destinationReceipt ? ' Source-chain transactions only; excludes destination gas.' : ''}${fee.includesApprovals ? ' Includes token approvals.' : ''}${fee.knownNative === null ? '' : ` Known components total ${fee.knownNative} ETH; this is not the full fee.`}`
      : `${simulated ? 'Simulated gas fee' : 'Gas paid'}: ${fee.exactNative} ETH.${destinationReceipt ? ' Source-chain transactions only; excludes destination gas.' : ''}${fee.includesApprovals ? ' Includes token approvals.' : ''}${usd === null ? ' No fresh USD price is available.' : ` USD is a current display-price estimate, not a receipt-time value. Price checked ${new Date(priceTime!).toISOString()}.`}`,
  };
}
