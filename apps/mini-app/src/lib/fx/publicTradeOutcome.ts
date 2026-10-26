import { planIncreasePosition } from './service';
import { withReadDeadline } from './readFacade';
import { positionOutcomeFacts, type PositionOutcomeFacts } from './reviewFormatting';
import { ROUTE_PREFETCH_TTL_MS } from './routePrefetch';
import type { IncreasePositionRequest } from '@aladdindao/fx-sdk';

/** Read-only SDK account context, never a wallet, review route or transaction owner. */
export const PUBLIC_TRADE_PREVIEW_ACCOUNT = '0x0000000000000000000000000000000000000001';
export type PublicTradeOutcome = { facts: PositionOutcomeFacts; validUntil: number };
// The SDK's bounded inverse converter searches can exceed twelve seconds on
// BTC longs. Leave two seconds inside the original thirty-second freshness
// window; accepting a late result never renews its accounting/risk timestamp.
export const PUBLIC_TRADE_OUTCOME_DEADLINE_MS = ROUTE_PREFETCH_TTL_MS - 2_000;
export type PublicTradeOutcomeRequest = Pick<IncreasePositionRequest, 'market' | 'type' | 'inputTokenAddress' | 'amount' | 'leverage' | 'slippage'>;
// SDK searches cannot be aborted once dispatched. Serialize public-only work
// so superseded tickets do not start overlapping inverse converter searches.
// This holds no reusable route and never participates in wallet planning.
const activePublicPlans = new WeakMap<typeof planIncreasePosition, ReturnType<typeof planIncreasePosition>>();

/** The approved planner validates economics and awaits its bundled risk read.
 * Discard all approvals, nonce, policy and unsigned calldata at this boundary. */
export async function readPublicTradeOutcome(request: PublicTradeOutcomeRequest, options: {
  signal?: AbortSignal; plan?: typeof planIncreasePosition; now?: () => number;
} = {}): Promise<PublicTradeOutcome> {
  const now = options.now ?? Date.now;
  let readAt = now();
  let observing = true;
  const plan = options.plan ?? planIncreasePosition;
  options.signal?.throwIfAborted();
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    options.signal?.addEventListener('abort', abort, {once: true});
  });
  try {
    const run = async () => {
      let prior = activePublicPlans.get(plan);
      while (prior) {
        await prior.then(() => undefined, () => undefined);
        options.signal?.throwIfAborted();
        if (!observing) throw new Error('Public trade outcome cancelled');
        prior = activePublicPlans.get(plan);
      }
      options.signal?.throwIfAborted();
      if (!observing) throw new Error('Public trade outcome cancelled');
      readAt = now();
      const pending = plan({...request, positionId: 0, userAddress: PUBLIC_TRADE_PREVIEW_ACCOUNT});
      activePublicPlans.set(plan, pending);
      const release = () => { if (activePublicPlans.get(plan) === pending) activePublicPlans.delete(plan); };
      void pending.then(release, release);
      return pending;
    };
    const routes = await withReadDeadline(Promise.race([
      run(), cancelled,
    ]), PUBLIC_TRADE_OUTCOME_DEADLINE_MS);
    options.signal?.throwIfAborted();
    const route = routes[0];
    if (!route || route.walletAddress?.toLowerCase() !== PUBLIC_TRADE_PREVIEW_ACCOUNT || route.chainId !== 1 || route.operation !== 'increasePosition') throw new Error('Public trade outcome unavailable');
    const facts = positionOutcomeFacts(route);
    const riskReadAt = route.details?.liquidationQuote?.readAt;
    const validUntil = Math.min(readAt + ROUTE_PREFETCH_TTL_MS, riskReadAt ? riskReadAt + ROUTE_PREFETCH_TTL_MS : Infinity);
    if (!facts || now() >= validUntil) throw new Error('Public trade outcome expired');
    return {facts, validUntil};
  } finally {
    observing = false;
    if (abort) options.signal?.removeEventListener('abort', abort);
  }
}
