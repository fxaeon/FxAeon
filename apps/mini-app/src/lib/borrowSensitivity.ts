/** A price-only illustration. It cannot establish liquidation or transaction limits. */
export function collateralScenarioLtv(debt: bigint, collateralUsd: bigint, changePercent: number): number | null {
  if (debt <= 0n || collateralUsd <= 0n || !Number.isInteger(changePercent) || changePercent < -30 || changePercent > 30) return null;
  // Round up to a basis point rather than understating the illustrated ratio.
  const denominator = collateralUsd * BigInt(100 + changePercent);
  const numerator = debt * 1_000_000n;
  const basisPoints = (numerator + denominator - 1n) / denominator;
  return basisPoints <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(basisPoints) / 100 : null;
}
