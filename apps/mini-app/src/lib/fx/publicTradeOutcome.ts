import { planIncreasePosition } from './service';
import { withReadDeadline } from './readFacade';
import { positionOutcomeFacts, type PositionOutcomeFacts } from './reviewFormatting';
import { ROUTE_PREFETCH_TTL_MS } from './routePrefetch';
import type { IncreasePositionRequest } from '@aladdindao/fx-sdk';

/** Read-only SDK account context, never a wallet, review route or transaction owner. */
export const PUBLIC_TRADE_PREVIEW_ACCOUNT = '0x0000000000000000000000000000000000000001';
export type PublicTradeOutcome = { facts: PositionOutcomeFacts; validUntil: number };
export type PublicTradeOutcomeRequest = Pick<IncreasePositionRequest, 'market' | 'type' | 'inputTokenAddress' | 'amount' | 'leverage' | 'slippage'>;

/** The approved planner validates economics and awaits its bundled risk read.
 * Discard all approvals, nonce, policy and unsigned calldata at this boundary. */
export async function readPublicTradeOutcome(request: PublicTradeOutcomeRequest, options: {
  signal?: AbortSignal; plan?: typeof planIncreasePosition; now?: () => number;
} = {}): Promise<PublicTradeOutcome> {
  const now = options.now ?? Date.now;
  const readAt = now();
  options.signal?.throwIfAborted();
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    options.signal?.addEventListener('abort', abort, {once: true});
  });
  try {
    const routes = await withReadDeadline(Promise.race([
      (options.plan ?? planIncreasePosition)({...request, positionId: 0, userAddress: PUBLIC_TRADE_PREVIEW_ACCOUNT}), cancelled,
    ]), 12_000);
    options.signal?.throwIfAborted();
    const route = routes[0];
    if (!route || route.walletAddress?.toLowerCase() !== PUBLIC_TRADE_PREVIEW_ACCOUNT || route.chainId !== 1 || route.operation !== 'increasePosition') throw new Error('Public trade outcome unavailable');
    const facts = positionOutcomeFacts(route);
    const riskReadAt = route.details?.liquidationQuote?.readAt;
    const validUntil = Math.min(readAt + ROUTE_PREFETCH_TTL_MS, riskReadAt ? riskReadAt + ROUTE_PREFETCH_TTL_MS : Infinity);
    if (!facts || now() >= validUntil) throw new Error('Public trade outcome expired');
    return {facts, validUntil};
  } finally {
    if (abort) options.signal?.removeEventListener('abort', abort);
  }
}
