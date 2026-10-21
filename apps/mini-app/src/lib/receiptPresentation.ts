import { formatUnits, type Address } from 'viem';
import { FX_TOKENS } from './fx/tokens';
import type { FxChainId } from './fx/types';
import type { ConfirmedPositionHint } from './confirmedPositions';
import { tokenSymbol } from './fx/tokenPresentation';

export type ReceiptTransferFact = { token: Address; from: Address; to: Address; amountRaw: bigint };
export type ReceiptPresentation = {
  movements: string[];
  /** Exact receipt-only token values for amount disclosures; never parsed from compact copy. */
  exactMovements?: { direction: 'sent' | 'received'; amount: string; symbol: string }[];
  exactNativeValue?: string | null;
  technicalMovements: string[];
  /** Exact native fees for display-price conversion, never compact-string arithmetic. */
  exactFees?: { execution?: string; l1Data?: string; operator?: string; total?: string };
  executionFee: string | null;
  feeLabel: string;
  totalFeeLabel: string | null;
  transactionKind: 'approval' | 'action' | 'unknown';
  l1DataFee: string | null;
  operatorFee: string | null;
  totalExecutionFee: string | null;
  feeCaveat: string | null;
  nativeValue: string | null;
  nativeValueLabel: 'Bridge fee' | 'Native value sent';
};

export type ReceiptPositionIdentity = Pick<ConfirmedPositionHint, 'market' | 'side' | 'positionId' | 'transactionHash'>;
export function shouldShowReceiptMovementFallback(receipts: readonly ReceiptPresentation[]): boolean {
  return receipts.length > 0 && receipts.some((receipt) => receipt.transactionKind !== 'approval');
}

/**
 * The movements a receipt summary states. ETH paid into an action leaves no
 * token log, so when no token moved the verified transaction's own value is
 * the movement ("sent 0.5 ETH"), stated once instead of "not established".
 */
export function receiptMovementLines(receipts: readonly ReceiptPresentation[]): { movements: string[]; nativeValueIsMovement: boolean } {
  const tokenMovements = receipts.flatMap((receipt) => receipt.movements);
  if (tokenMovements.length > 0) return { movements: tokenMovements, nativeValueIsMovement: false };
  const nativeSends = receipts.flatMap((receipt) => receipt.nativeValue && receipt.nativeValueLabel === 'Native value sent'
    ? [`sent ${receipt.nativeValue}`] : []);
  return { movements: nativeSends, nativeValueIsMovement: nativeSends.length > 0 };
}
/** Hints are supplied by ProtocolPositionProvider only after receipt and current-owner verification. */
export function verifiedReceiptPositionIdentity(input: {
  status: 'pending' | 'confirmed' | 'failed';
  verification: 'receipt' | 'confirming' | 'not-found' | 'rpc-error' | 'mismatch';
  transactionHash: string;
  hint?: ReceiptPositionIdentity;
}): ReceiptPositionIdentity | null {
  if (input.status !== 'confirmed' || input.verification !== 'receipt' || !input.hint
    || input.hint.transactionHash.toLowerCase() !== input.transactionHash.toLowerCase()) return null;
  return input.hint;
}

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Decode only canonical three-topic ERC-20 Transfer logs involving this wallet. */
export function receiptTransfersFromLogs(
  logs: readonly { address: string; topics: readonly (string | null)[]; data: string }[],
  walletAddress: string,
): ReceiptTransferFact[] {
  return logs.flatMap((log) => {
    const fromTopic = log.topics[1];
    const toTopic = log.topics[2];
    if (log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC
      || !fromTopic || !toTopic || !/^0x[0-9a-fA-F]{64}$/.test(fromTopic)
      || !/^0x[0-9a-fA-F]{64}$/.test(toTopic) || !/^0x0{24}[0-9a-fA-F]{40}$/.test(fromTopic)
      || !/^0x0{24}[0-9a-fA-F]{40}$/.test(toTopic) || !/^0x[0-9a-fA-F]{64}$/.test(log.data)
      || !/^0x[0-9a-fA-F]{40}$/.test(log.address)) return [];
    const from = `0x${fromTopic.slice(-40)}`;
    const to = `0x${toTopic.slice(-40)}`;
    if (from.toLowerCase() !== walletAddress.toLowerCase() && to.toLowerCase() !== walletAddress.toLowerCase()) return [];
    if (from.toLowerCase() === to.toLowerCase()) return [];
    return [{ token: log.address as Address, from: from as Address, to: to as Address, amountRaw: BigInt(log.data) }];
  });
}

function compactAmount(raw: bigint, decimals: number): string {
  const exact = formatUnits(raw, decimals);
  const [whole, fraction = ''] = exact.split('.');
  const shown = fraction.slice(0, 6).replace(/0+$/, '');
  const truncated = /[1-9]/.test(fraction.slice(6));
  if (truncated && whole === '0' && shown.length === 0) return '<0.000001';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${truncated ? '≈ ' : ''}${grouped}${shown ? `.${shown}` : ''}`;
}

/** Convert receipt-only facts into concise copy, keeping unknown token data technical. */
export function buildReceiptPresentation(input: {
  chainId: FxChainId;
  walletAddress?: string;
  status: 'success' | 'reverted';
  transfers?: readonly ReceiptTransferFact[];
  executionCostWei?: bigint;
  l1DataFeeWei?: bigint | null;
  operatorFeeWei?: bigint | null;
  nativeValueWei?: bigint;
  transactionKind?: 'approval' | 'action' | 'unknown';
  bridgeFee?: boolean;
}): ReceiptPresentation {
  const walletTokens = Object.values(FX_TOKENS).filter((token) => !token.native);
  const movements: string[] = [];
  const exactMovements: NonNullable<ReceiptPresentation['exactMovements']> = [];
  const technicalMovements: string[] = [];
  if (input.status === 'success') for (const transfer of input.transfers ?? []) {
    const known = input.chainId === 1
      ? walletTokens.find((token) => token.address.toLowerCase() === transfer.token.toLowerCase())
      : undefined;
    const direction = known ? (transfer.from.toLowerCase() === input.walletAddress?.toLowerCase() ? 'sent' : 'received') : '';
    if (known) {
      movements.push(`${direction} ${compactAmount(transfer.amountRaw, known.decimals)} ${known.key}`);
      exactMovements.push({ direction: direction as 'sent' | 'received', amount: formatUnits(transfer.amountRaw, known.decimals), symbol: tokenSymbol(known.key) });
    } else {
      movements.push('Token movement available in technical details');
      technicalMovements.push(`${transfer.from} → ${transfer.to}: token ${transfer.token}, ${transfer.amountRaw.toString()} base units`);
    }
  }
  const base = input.chainId === 8453;
  const executionFee = input.executionCostWei;
  const l1DataFee = typeof input.l1DataFeeWei === 'bigint' && input.l1DataFeeWei >= 0n ? input.l1DataFeeWei : undefined;
  const operatorFee = typeof input.operatorFeeWei === 'bigint' && input.operatorFeeWei >= 0n ? input.operatorFeeWei : undefined;
  const totalExecutionFee = base && executionFee !== undefined && l1DataFee !== undefined && operatorFee !== undefined
    ? executionFee + l1DataFee + operatorFee
    : undefined;
  const feeSubject = input.transactionKind === 'approval' ? 'Token approval'
    : input.transactionKind === 'action' ? 'Action' : undefined;
  const feeLabel = feeSubject
    ? `${feeSubject} ${base ? 'execution' : 'network'} fee`
    : base ? 'Execution fee' : 'Network fee';
  const feeCaveat = base && totalExecutionFee === undefined
    ? 'Partial fee data: this receipt does not include every gas, L1 data, and operator fee component.'
    : null;
  return {
    movements,
    exactMovements,
    exactNativeValue: input.status === 'success' && input.nativeValueWei && input.nativeValueWei > 0n ? formatUnits(input.nativeValueWei, 18) : null,
    technicalMovements,
    exactFees: {
      ...(executionFee === undefined ? {} : { execution: formatUnits(executionFee, 18) }),
      ...(l1DataFee === undefined ? {} : { l1Data: formatUnits(l1DataFee, 18) }),
      ...(operatorFee === undefined ? {} : { operator: formatUnits(operatorFee, 18) }),
      ...(totalExecutionFee === undefined ? {} : { total: formatUnits(totalExecutionFee, 18) }),
    },
    executionFee: executionFee === undefined ? null : `${compactAmount(executionFee, 18)} ETH`,
    feeLabel,
    totalFeeLabel: totalExecutionFee === undefined ? null : `${feeSubject ? `${feeSubject} ` : ''}total execution fee`,
    transactionKind: input.transactionKind ?? 'unknown',
    l1DataFee: l1DataFee === undefined ? null : `${compactAmount(l1DataFee, 18)} ETH`,
    operatorFee: operatorFee === undefined ? null : `${compactAmount(operatorFee, 18)} ETH`,
    totalExecutionFee: totalExecutionFee === undefined ? null : `${compactAmount(totalExecutionFee, 18)} ETH`,
    feeCaveat,
    nativeValue: input.status === 'success' && input.nativeValueWei && input.nativeValueWei > 0n
      ? `${compactAmount(input.nativeValueWei, 18)} ETH` : null,
    nativeValueLabel: input.bridgeFee ? 'Bridge fee' : 'Native value sent',
  };
}
