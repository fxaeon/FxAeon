import type { PlannedRoute, TransactionExecutionResult } from '@/lib/fx/types';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { positionPoolAddress } from '@/lib/fx/policy';
import { receiptMintedPositionIdentity } from '@/lib/confirmedPositions';
import { positionCollateralSymbol } from '@/lib/positionUnits';
import { positionLeveragePresentation, positionTokenPresentation } from '@/lib/positionPresentation';
import { positionCollateralDecimals, positionDebtDecimals, type PositionReadResult } from '@/app/trade/fxUi';

/** Only a genuinely new borrowing position has a known zero starting balance. */
export function positionReviewBefore(route: PlannedRoute, current: readonly ReviewFact[]): ReviewFact[] {
  const intent = route.policy?.reviewedAction;
  if (current.length || intent?.kind !== 'deposit-and-mint' || intent.positionId !== 0 || route.chainId !== 1 || route.operation !== 'depositAndMint') return [...current];
  const market = (['ETH', 'BTC'] as const).find(value => positionPoolAddress(value, 'long').toLowerCase() === intent.poolAddress.toLowerCase());
  if (!market) return [];
  return [
    { label: 'Collateral', value: `0 ${market === 'ETH' ? 'stETH' : 'WBTC'}` },
    { label: 'Debt', value: '0 fxUSD' },
    // With no collateral the ratio is undefined, not a fabricated 0% LTV.
    { label: 'Loan-to-value', value: 'No position' },
  ];
}

export type ConfirmedPositionReadback = {
  walletAddress: string;
  chainId: number;
  transactionHash: string;
  key: string;
  readAt: number;
  facts: ReviewFact[];
};

/** Bind a post-confirmation read to its wallet, receipt and exact pool position.
 * A retained/stale group or unverified receipt must never become "updated". */
export function confirmedPositionReadback(
  result: TransactionExecutionResult,
  route: PlannedRoute,
  read: PositionReadResult & { readStartedAt?: number; readCompletedAt?: number },
  confirmedAt: number,
): ConfirmedPositionReadback | null {
  const intent = route.policy?.reviewedAction;
  const readAt = read.readCompletedAt;
  if (!Number.isFinite(confirmedAt) || confirmedAt <= 0 || !Number.isFinite(read.readStartedAt)
    || read.readStartedAt! < confirmedAt || !Number.isFinite(readAt) || readAt! < read.readStartedAt!) return null;
  if (result.status !== 'confirmed' || route.chainId !== 1 || result.chainId !== route.chainId
    || result.operation !== route.operation || result.walletAddress.toLowerCase() !== route.walletAddress.toLowerCase()
    || !intent || !('positionId' in intent) || !('poolAddress' in intent)) return null;
  const action = [...result.steps].reverse().find(step => step.transaction.kind === 'action' && step.status === 'confirmed' && step.receipt?.status === 'success' && /^0x[\da-f]{64}$/i.test(step.hash ?? ''));
  if (!action?.hash) return null;
  const pool = (['ETH', 'BTC'] as const).flatMap(market => (['long', 'short'] as const).map(side => ({ market, side })))
    .find(({ market, side }) => positionPoolAddress(market, side).toLowerCase() === intent.poolAddress.toLowerCase());
  if (!pool || !read.successfulGroups.some(group => group.market === pool.market && group.side === pool.side)
    || read.failedGroups.some(group => group.market === pool.market && group.side === pool.side)) return null;
  const positionId = intent.positionId > 0 ? intent.positionId : receiptMintedPositionIdentity({ result, route })?.positionId;
  const position = read.positions.find(item => item.market === pool.market && item.side === pool.side && item.info.positionId === positionId);
  if (!position || !Number.isFinite(readAt) || readAt! <= 0) return null;
  const collateral = positionTokenPresentation(position.info.rawColls, positionCollateralDecimals(position));
  const debt = positionTokenPresentation(position.info.rawDebts, positionDebtDecimals(position));
  if (collateral.exact === null || debt.exact === null) return null;
  return {
    walletAddress: result.walletAddress, chainId: result.chainId, transactionHash: action.hash,
    key: `${pool.market}:${pool.side}:${positionId}`, readAt: readAt!,
    facts: [
      { label: 'Collateral', value: `${collateral.text} ${positionCollateralSymbol(position)}` },
      { label: 'Debt', value: `${debt.text} ${position.info.rawDebtsToken}` },
      { label: 'Leverage', value: positionLeveragePresentation(position).text },
    ],
  };
}

export function readbackMatchesResult(readback: ConfirmedPositionReadback | null | undefined, result: TransactionExecutionResult): boolean {
  return Boolean(readback && result.status === 'confirmed' && result.walletAddress.toLowerCase() === readback.walletAddress.toLowerCase()
    && result.chainId === readback.chainId && result.steps.some(step => step.transaction.kind === 'action'
      && step.status === 'confirmed' && step.receipt?.status === 'success' && step.hash?.toLowerCase() === readback.transactionHash.toLowerCase()));
}
