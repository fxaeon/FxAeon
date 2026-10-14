/** PoolManager and ShortPoolManager fee precision; rates are read from chain. */
const FEE_PRECISION = 1_000_000_000n;

/** Fee on the manager's gross token amount, rounded down exactly as Solidity.
 * Supply/withdraw/borrow deduct this amount; repayment adds it to debt paid.
 * Callers must resolve conversion/scaling before supplying the chargeable amount.
 */
export function calculateProtocolFee(grossAmount: bigint, feeRatio: bigint): bigint {
  if (grossAmount < 0n || feeRatio < 0n || feeRatio > FEE_PRECISION) {
    throw new RangeError('f(x) fee inputs are outside the supported range');
  }
  return grossAmount * feeRatio / FEE_PRECISION;
}
