import { positionTokenPresentation } from '@/lib/positionPresentation';
import { formatReviewFactValue } from './reviewFactFormatting';

/** Noninteractive summary for the manager trigger/summary. The manager's existing
 * Position details disclosure retains the full amounts, without nesting controls. */
export function BorrowPositionAmount({ raw, decimals, symbol }: { raw: bigint; decimals: number; symbol: string }) {
  const amount = positionTokenPresentation(raw, decimals);
  if (amount.exact === null) return <span>Unavailable</span>;
  const full = `${amount.exact} ${symbol}`;
  return <span title={full}>{formatReviewFactValue({ label: 'Position amount', value: full }).display}</span>;
}
