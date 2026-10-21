/** Display-only percentages. Capacity and transaction guards keep their exact bigint math. */
export function formatBorrowBasisPoints(bps: bigint): string {
  const fraction = (bps % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${bps / 100n}${fraction ? `.${fraction}` : ''}%`;
}

/** A rounded risk figure is explicitly an upper bound, never a lower estimate. */
export function borrowLtvCeiling(debt: bigint, collateralUsd: bigint): string {
  if (debt < 0n || collateralUsd <= 0n) return 'Unavailable';
  const scaled = debt * 10_000n;
  const remainder = scaled % collateralUsd;
  const bps = scaled / collateralUsd + (remainder > 0n ? 1n : 0n);
  return `${remainder > 0n ? '≤ ' : ''}${formatBorrowBasisPoints(bps)}`;
}
