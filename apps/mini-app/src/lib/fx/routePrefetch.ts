import type { PlannedRoute } from './types';

/**
 * A route preview is useful only for the exact form and wallet session which
 * produced it. Keeping every field explicit makes accidental cache widening
 * visible in review and prevents a prefetched quote from crossing sessions.
 */
export type RoutePrefetchDescriptor = {
  sessionId: string;
  walletAddress: string;
  walletChainId: number | null;
  routeChainId: number;
  market: 'ETH' | 'BTC';
  side: 'long' | 'short';
  inputTokenAddress: string;
  amountWei: bigint;
  leverage: number;
  slippagePercent: number;
  leverageMin: number;
  leverageMax: number;
  blockNumber: bigint;
};

export type PrefetchedRoutes = PlannedRoute | readonly PlannedRoute[];

export const ROUTE_PREFETCH_TTL_MS = 30_000;

/** Advisory plans cannot cancel SDK converter searches once started. Keep at
 * most one pending edit, so a slow plan is followed by the latest ticket only.
 * Explicit Review does not use this queue. */
export class LatestOnlyWarmupQueue {
  private running = false;
  private pending: (() => Promise<void>) | null = null;

  submit(task: () => Promise<void>): void {
    if (this.running) {
      this.pending = task;
      return;
    }
    this.run(task);
  }

  discardPending(): void {
    this.pending = null;
  }

  private run(task: () => Promise<void>): void {
    this.running = true;
    // A UI deadline cannot stop SDK work. Keep this lane until the actual
    // task settles; releasing it on a timer would accumulate live searches.
    // Explicit Review remains independent and bounds advisory reuse itself.
    void Promise.resolve().then(task).catch(() => {}).finally(() => {
      this.running = false;
      const next = this.pending;
      this.pending = null;
      if (next) this.run(next);
    });
  }
}

function finiteNumberKey(value: number, label: string): string {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value.toString();
}

function positiveIntegerKey(value: number, label: string): string {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
  return String(value);
}

/** Stable, exact key used only in memory. No route or key is persisted. */
export function routePrefetchKey(descriptor: RoutePrefetchDescriptor): string {
  const walletAddress = descriptor.walletAddress.toLowerCase();
  const inputTokenAddress = descriptor.inputTokenAddress.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(walletAddress)) throw new TypeError('Wallet address is invalid');
  if (!/^0x[0-9a-f]{40}$/.test(inputTokenAddress)) throw new TypeError('Input token address is invalid');
  if (!descriptor.sessionId) throw new TypeError('Route prefetch session is missing');
  if (descriptor.market !== 'ETH' && descriptor.market !== 'BTC') throw new TypeError('Route prefetch market is invalid');
  if (descriptor.side !== 'long' && descriptor.side !== 'short') throw new TypeError('Route prefetch side is invalid');
  if (descriptor.amountWei <= 0n) throw new RangeError('Route prefetch amount must be positive');
  if (descriptor.blockNumber < 0n) throw new RangeError('Route prefetch block must be non-negative');
  const walletChainId = descriptor.walletChainId === null
    ? 'none'
    : positiveIntegerKey(descriptor.walletChainId, 'Wallet chain');
  const routeChainId = positiveIntegerKey(descriptor.routeChainId, 'Route chain');
  const leverage = finiteNumberKey(descriptor.leverage, 'Leverage');
  const slippage = finiteNumberKey(descriptor.slippagePercent, 'Slippage');
  const leverageMin = finiteNumberKey(descriptor.leverageMin, 'Minimum leverage');
  const leverageMax = finiteNumberKey(descriptor.leverageMax, 'Maximum leverage');
  if (descriptor.leverageMin > descriptor.leverageMax) throw new RangeError('Leverage bounds are invalid');

  return JSON.stringify([
    descriptor.sessionId,
    walletAddress,
    walletChainId,
    routeChainId,
    descriptor.market,
    descriptor.side,
    inputTokenAddress,
    descriptor.amountWei.toString(),
    leverage,
    slippage,
    leverageMin,
    leverageMax,
    descriptor.blockNumber.toString(),
  ]);
}

type PrefetchEntry = {
  key: string;
  expiresAt: number;
  promise: Promise<PrefetchedRoutes>;
};

/**
 * Single-entry, session-local cache. A new input snapshot invalidates the old
 * promise immediately; a late resolution can never become the active entry.
 */
export class RoutePrefetchStore {
  private entry: PrefetchEntry | null = null;
  private generation = 0;

  invalidate(): void {
    this.generation += 1;
    this.entry = null;
  }

  prime(
    descriptor: RoutePrefetchDescriptor,
    builder: () => Promise<PrefetchedRoutes>,
    now = Date.now(),
  ): Promise<PrefetchedRoutes> {
    const key = routePrefetchKey(descriptor);
    const existing = this.entry;
    if (existing && existing.key === key && existing.expiresAt > now) return existing.promise;

    const generation = ++this.generation;
    let built: Promise<PrefetchedRoutes>;
    try {
      // Invoke immediately so the warm-up starts without an extra microtask,
      // while still converting a synchronous SDK validation error into the
      // same contained promise path as an async RPC failure.
      built = Promise.resolve(builder());
    } catch (cause) {
      built = Promise.reject(cause);
    }
    const promise = built.catch((cause) => {
      if (this.generation === generation) this.entry = null;
      throw cause;
    });
    this.entry = { key, expiresAt: now + ROUTE_PREFETCH_TTL_MS, promise };
    return promise;
  }

  read(descriptor: RoutePrefetchDescriptor, now = Date.now()): Promise<PrefetchedRoutes> | null {
    const entry = this.entry;
    if (!entry) return null;
    if (entry.expiresAt <= now || entry.key !== routePrefetchKey(descriptor)) {
      this.invalidate();
      return null;
    }
    return entry.promise;
  }

  /** Revalidate after both planning and the current chain snapshot resolve. */
  async readValidated(
    descriptor: RoutePrefetchDescriptor,
    currentDescriptor: () => Promise<RoutePrefetchDescriptor | null>,
    clock: () => number = Date.now,
  ): Promise<PrefetchedRoutes | null> {
    const pending = this.read(descriptor, clock());
    const entry = this.entry;
    if (!pending || !entry) return null;
    // Bound the entire advisory lookup, including its final block read. A
    // stalled warm-up must not hold an explicit Review beyond the quote TTL.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<null>((resolve) => {
      timeout = setTimeout(() => {
        if (this.entry === entry) this.invalidate();
        resolve(null);
      }, Math.max(0, entry.expiresAt - clock()));
    });
    const validated = async (): Promise<PrefetchedRoutes | null> => {
      try {
        const routes = await pending;
        // Do not spend another RPC on an already invalidated route.
        if (this.entry !== entry || entry.expiresAt <= clock()) return null;
        const current = await currentDescriptor();
        if (this.entry !== entry || entry.expiresAt <= clock()
          || !current || current.blockNumber < descriptor.blockNumber
          || entry.key !== routePrefetchKey({ ...current, blockNumber: descriptor.blockNumber })) return null;
        // A new block alone does not change the user's requested transaction.
        // The caller rechecks live limits and ActionReview validates/simulates
        // this exact calldata before review and again before signing. Keep the
        // short wall-clock expiry; never renew it when the quote is read.
        return routes;
      } catch {
        // Warm-up failures leave the normal fresh planner available.
        return null;
      }
    };
    try { return await Promise.race([validated(), expired]); }
    finally { clearTimeout(timeout); }
  }
}
