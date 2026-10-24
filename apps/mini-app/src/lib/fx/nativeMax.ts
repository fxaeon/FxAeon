export type NativeMaxEstimate = {
  status: 'current' | 'partial' | 'unavailable';
  nativeValueWei: bigint;
  totalNativeCostWei?: bigint;
  /** Costed against the same 120%-buffered limits and fee cap the wallet preflights. */
  requiredNativeCostWei?: bigint;
  totalNativeCostScope?: string;
  validUntil: number;
  fee?: { stale?: boolean };
  insufficientNativeBalance?: boolean;
  error?: string;
};

export type NativeMaxCalculationOptions<Route> = {
  balanceWei: bigint;
  /** A valid entered amount gives RPC estimation a fundable starting point. */
  initialCandidateWei?: bigint;
  buildRoutes: (amountWei: bigint, signal?: AbortSignal) => Promise<readonly Route[]>;
  estimateRoutes: (routes: readonly Route[], signal?: AbortSignal) => Promise<readonly NativeMaxEstimate[]>;
  now?: () => number;
  maxIterations?: number;
  /** Total wall-clock budget across route builds and estimates. */
  timeoutMs?: number;
  isCurrent?: () => boolean;
};

class NativeMaxUnavailableError extends Error {
  constructor() {
    super('current gas estimate is unavailable for one or more routes');
    this.name = 'NativeMaxUnavailableError';
  }
}

class NativeMaxTimeoutError extends Error {
  constructor() {
    super('native max estimate timed out');
    this.name = 'NativeMaxTimeoutError';
  }
}

function isUnderfundedCandidateError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /insufficient funds|insufficient balance|not enough funds|not enough ETH|balance is too low|funds for gas \* price \+ value/i.test(text);
}

/** Convert internal estimator failures into concise, user-safe copy. */
export function nativeMaxErrorMessage(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/timed out/i.test(text)) return 'Gas estimate timed out. Try again.';
  if (/native max request is stale/i.test(text)) return 'Wallet balance changed. Refresh the amount and try again.';
  if (/current gas estimate is unavailable|fee estimate|network cost is unavailable|stale/i.test(text)) return 'Current gas fees are unavailable. Try again shortly.';
  if (/wallet balance does not cover|reserve consumes|insufficient funds|insufficient balance|not enough funds|not enough ETH|balance is too low/i.test(text)) {
    return 'Not enough ETH for network fees.';
  }
  if (/did not converge/i.test(text)) return 'Gas estimate changed while calculating Max. Try again.';
  if (/leverage.*(?:higher|maximum|allowed)/i.test(text)) return 'Reduce the target leverage, then try Max again.';
  return 'Could not calculate Max. Try again.';
}

async function withinDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadline: number,
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new NativeMaxTimeoutError();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new NativeMaxTimeoutError());
    }, remaining);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function usableEstimate(estimate: NativeMaxEstimate, now: () => number): boolean {
  return estimate.status === 'current'
    && !estimate.fee?.stale
    && (estimate.totalNativeCostScope === 'execution-plus-value'
      || estimate.totalNativeCostScope === 'execution-plus-l1-plus-operator-plus-value')
    && estimate.totalNativeCostWei !== undefined
    && estimate.totalNativeCostWei >= estimate.nativeValueWei
    && estimate.requiredNativeCostWei !== undefined
    && estimate.requiredNativeCostWei >= estimate.nativeValueWei
    && estimate.validUntil > now();
}

async function reserveFor<Route>(
  amountWei: bigint,
  options: NativeMaxCalculationOptions<Route>,
  now: () => number,
  deadline: number,
): Promise<{ reserveWei: bigint; validUntil: number; fundable: boolean }> {
  const routes = await withinDeadline((signal) => options.buildRoutes(amountWei, signal), deadline);
  if (routes.length === 0) throw new Error('native max route is empty');
  const estimates = await withinDeadline((signal) => options.estimateRoutes(routes, signal), deadline);
  if (estimates.length !== routes.length || estimates.some((estimate) => !usableEstimate(estimate, now) || estimate.nativeValueWei < amountWei)) {
    // RPC estimation reports underfunding as a partial/unavailable result,
    // rather than throwing. Only explicit funding failures permit a smaller
    // probe; transport errors and stale fees still fail closed.
    if (estimates.length === routes.length && estimates.some((estimate) =>
      estimate.insufficientNativeBalance && /not enough ETH for network fees|insufficient funds|insufficient balance/i.test(estimate.error ?? '')
    )) throw new Error('insufficient funds for native max candidate');
    throw new NativeMaxUnavailableError();
  }
  const reserveWei = estimates.reduce((max, estimate) => {
    // Native value may include protocol charges in addition to the user's
    // input (for example a bridge fee). Reserve those charges too.
    const reserve = estimate.requiredNativeCostWei! - amountWei;
    return reserve > max ? reserve : max;
  }, 0n);
  const validUntil = Math.min(...estimates.map((estimate) => estimate.validUntil));
  if (validUntil <= now()) throw new NativeMaxUnavailableError();
  return { reserveWei, validUntil, fundable: !estimates.some((estimate) => estimate.insufficientNativeBalance) };
}

/**
 * Find a fundable native amount using only complete, fresh route estimates.
 * The returned value is verified against a final route build at that exact
 * amount; an estimate for a nearby candidate is never presented as a maximum.
 */
export type VerifiedNativeMax = { amountWei: bigint; validUntil: number };

export async function calculateVerifiedNativeMax<Route>(options: NativeMaxCalculationOptions<Route>): Promise<VerifiedNativeMax> {
  if (!Number.isSafeInteger(options.maxIterations ?? 6) || (options.maxIterations ?? 6) < 2 || (options.maxIterations ?? 6) > 16) {
    throw new RangeError('native max iterations must be an integer between 2 and 16');
  }
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 60_000)) {
    throw new RangeError('native max timeout must be an integer between 100 and 60000 milliseconds');
  }
  if (options.balanceWei < 0n) throw new RangeError('native max balance must be non-negative');
  if (options.balanceWei <= 0n) throw new Error('wallet balance does not cover the verified gas reserve');
  const now = options.now ?? Date.now;
  const assertCurrent = () => {
    if (options.isCurrent && !options.isCurrent()) throw new Error('native max request is stale');
  };
  const maxIterations = options.maxIterations ?? 6;
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  const entered = options.initialCandidateWei !== undefined
    && options.initialCandidateWei > 0n
    && options.initialCandidateWei < options.balanceWei
    ? options.initialCandidateWei
    : options.balanceWei / 2n;
  let candidate = entered > 0n ? entered : 1n;
  let reserveConsumesBalanceRetries = 0;
  let proofValidUntil = Number.POSITIVE_INFINITY;
  let lastUnderfundedError: unknown;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    assertCurrent();
    let verified: { reserveWei: bigint; validUntil: number; fundable: boolean };
    try {
      verified = await reserveFor(candidate, options, now, deadline);
      lastUnderfundedError = undefined;
      proofValidUntil = Math.min(proofValidUntil, verified.validUntil);
      assertCurrent();
    } catch (error) {
      if (error instanceof NativeMaxUnavailableError || error instanceof NativeMaxTimeoutError) throw error;
      // Only explicit insufficient-funds errors justify trying a smaller
      // candidate. SDK leverage, route, contract and transport failures are
      // deterministic/ambiguous and must not trigger repeated builds.
      if (!isUnderfundedCandidateError(error)) throw error;
      lastUnderfundedError = error;
      if (candidate <= 1n) throw error;
      candidate = candidate / 2n;
      continue;
    }
    const reserve = verified.reserveWei;
    if (reserve >= options.balanceWei) {
      // A single smaller amount checks whether amount-dependent route work
      // changes the reserve. Repeatedly halving an amount cannot make a
      // wallet with this reserve fundable and only repeats remote reads.
      if (candidate <= 1n || reserveConsumesBalanceRetries >= 1) {
        throw new Error('wallet balance does not cover the verified gas reserve');
      }
      reserveConsumesBalanceRetries += 1;
      candidate = candidate / 2n;
      continue;
    }
    const next = options.balanceWei - reserve;
    if (next === candidate) {
      // This loop iteration just built and estimated this exact candidate.
      // Reuse that proof and check its freshness/context immediately before
      // returning instead of repeating the same remote route work.
      assertCurrent();
      if (Date.now() >= deadline) throw new NativeMaxTimeoutError();
      if (verified.validUntil <= now()) throw new NativeMaxUnavailableError();
      if (!verified.fundable) throw new Error('native max request is stale');
      assertCurrent();
      return { amountWei: candidate, validUntil: proofValidUntil };
    }
    candidate = next;
  }
  if (lastUnderfundedError) throw lastUnderfundedError;
  throw new Error('native max gas reserve did not converge');
}

export async function calculateNativeMax<Route>(options: NativeMaxCalculationOptions<Route>): Promise<bigint> {
  return (await calculateVerifiedNativeMax(options)).amountWei;
}

/** Exact context includes account, chain, balance, route inputs and fee tier.
 * Cached results only fill the editor; review must still preflight the route. */
export class NativeMaxCache {
  private readonly entries = new Map<string, VerifiedNativeMax>();
  private readonly pending = new Map<string, Promise<VerifiedNativeMax>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  peek(key: string): VerifiedNativeMax | undefined {
    const value = this.entries.get(key);
    return value && value.validUntil > this.now() ? value : undefined;
  }

  prepare(key: string, calculate: () => Promise<VerifiedNativeMax>, refresh = false): Promise<VerifiedNativeMax> {
    const cached = this.peek(key);
    if (cached && !refresh) return Promise.resolve(cached);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = Promise.resolve().then(calculate).then((value) => {
      if (value.amountWei <= 0n || !Number.isSafeInteger(value.validUntil) || value.validUntil <= this.now()) {
        throw new NativeMaxUnavailableError();
      }
      this.entries.delete(key);
      this.entries.set(key, value);
      while (this.entries.size > 32) this.entries.delete(this.entries.keys().next().value!);
      return value;
    }).finally(() => { if (this.pending.get(key) === request) this.pending.delete(key); });
    this.pending.set(key, request);
    return request;
  }
}

export const nativeMaxCache = new NativeMaxCache();
