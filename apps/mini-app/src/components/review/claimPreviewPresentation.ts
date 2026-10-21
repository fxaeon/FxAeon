import { formatUnits } from 'viem';
import type { PlannedRoute } from '@/lib/fx/types';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { ROUTE_PREFETCH_TTL_MS } from '@/lib/fx/routePrefetch';
import { FX_TOKENS } from '@/lib/fx/tokens';

export type ClaimPreviewRead = {
  hasPendingRedeem: boolean;
  isCooldownComplete: boolean;
  pendingSharesWei: bigint;
  previewReceive?: { amountYieldOutWei: bigint; amountStableOutWei: bigint };
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uint = (value: unknown): value is bigint => typeof value === 'bigint' && value >= 0n && value < 1n << 256n;

/** Read-only display snapshot. It never supplies calldata, minimums or receipt data. */
export async function planClaimWithPreview(
  plan: () => Promise<PlannedRoute>,
  read: () => Promise<ClaimPreviewRead>,
  walletAddress: string,
): Promise<PlannedRoute> {
  const readAt = Date.now();
  const [route, preview] = await Promise.all([plan(), read().catch(() => null)]);
  const intent = route.policy?.reviewedAction;
  const actions = route.transactions.filter(tx => tx.kind === 'action');
  if (!preview || !preview.hasPendingRedeem || !preview.isCooldownComplete || !uint(preview.pendingSharesWei) || preview.pendingSharesWei === 0n || route.operation !== 'getRedeemTx' || route.chainId !== 1
    || intent?.kind !== 'fxsave-claim' || !same(route.walletAddress, walletAddress) || actions.length !== 1
    || !same(actions[0].to, FX_TOKENS.fxSAVE.address) || actions[0].data.slice(0, 10) !== '0x1e83409a'
    || !preview.previewReceive || !uint(preview.previewReceive.amountYieldOutWei) || !uint(preview.previewReceive?.amountStableOutWei)) return route;
  return { ...route, details: { ...route.details, displayClaimPreview: {
    walletAddress, receiver: intent.receiver, actionTo: actions[0].to, actionData: actions[0].data,
    readAt, queuedShares: preview.pendingSharesWei.toString(),
    fxUSD: preview.previewReceive.amountYieldOutWei.toString(), USDC: preview.previewReceive.amountStableOutWei.toString(),
  } } };
}

export function claimPreviewFacts(route: PlannedRoute, now = Date.now()): ReviewFact[] {
  const intent = route.policy?.reviewedAction;
  if (intent?.kind !== 'fxsave-claim' || route.operation !== 'getRedeemTx' || route.chainId !== 1) return [];
  const preview = route.details?.displayClaimPreview;
  const actions = route.transactions.filter(tx => tx.kind === 'action');
  const valid = preview && Number.isSafeInteger(preview.readAt) && preview.readAt > 0 && preview.readAt <= now && now - preview.readAt < ROUTE_PREFETCH_TTL_MS
    && same(preview.walletAddress, route.walletAddress) && same(preview.receiver, intent.receiver) && actions.length === 1
    && same(preview.actionTo, actions[0].to) && same(preview.actionData, actions[0].data)
    && same(actions[0].to, FX_TOKENS.fxSAVE.address) && actions[0].data.slice(0, 10) === '0x1e83409a'
    && [preview.queuedShares, preview.fxUSD, preview.USDC].every(raw => /^\d{1,78}$/.test(raw) && BigInt(raw) < 1n << 256n);
  if (!valid) return [
    { label: 'Estimated fxUSD payout', value: 'Unavailable' },
    { label: 'Estimated USDC payout', value: 'Unavailable' },
    { label: 'Claim payout', value: 'Estimate unavailable. No minimum payout.' },
  ];
  const amount = (label: string, raw: string, symbol: string, decimals: number): ReviewFact => {
    const value = `${formatUnits(BigInt(raw), decimals)} ${symbol}`;
    return { label, value: `≈ ${value}`, title: value };
  };
  return [
    amount('Estimated fxUSD payout', preview.fxUSD, 'fxUSD', 18),
    amount('Estimated USDC payout', preview.USDC, 'USDC', 6),
    { label: 'Queued fxSP', value: `${formatUnits(BigInt(preview.queuedShares), 18)} fxSP` },
    { label: 'Claim payout', value: 'Final amounts may change. No minimum payout.', title: `Claim read for ${preview.walletAddress} at ${new Date(preview.readAt).toISOString()}. Separate fxUSD and USDC estimates, not signed minimums.` },
  ];
}

/** Freeze only the display snapshot accepted with this route, including its caveat. */
export function retainedClaimPreviewFacts(current: readonly ReviewFact[], accepted: readonly ReviewFact[]): ReviewFact[] {
  const labels = new Set(['Estimated fxUSD payout', 'Estimated USDC payout', 'Queued fxSP', 'Claim payout']);
  return [...current.filter(fact => !labels.has(fact.label)), ...accepted.filter(fact => labels.has(fact.label))];
}
