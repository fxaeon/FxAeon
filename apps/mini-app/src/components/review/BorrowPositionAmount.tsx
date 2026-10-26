import { positionTokenPresentation } from '@/lib/positionPresentation';
import { MissingValue } from '@/components/MissingValue';
import { formatReviewFactValue } from './reviewFactFormatting';

/** Noninteractive compact summary for the manager trigger/summary. */
export function BorrowPositionAmount({ raw, decimals, symbol }: { raw: bigint; decimals: number; symbol: string }) {
  const amount = positionTokenPresentation(raw, decimals);
  if (amount.exact === null) return <MissingValue width="md" status="unavailable" announce={false} label="Position amount unavailable" />;
  const full = `${amount.exact} ${symbol}`;
  return <span>{formatReviewFactValue({ label: 'Position amount', value: full }).display}</span>;
}
