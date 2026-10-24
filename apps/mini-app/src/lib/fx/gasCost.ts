import { formatEther, formatUnits, type Address } from 'viem';
import { assertPublicClientChain, getPublicClient } from './clients';
import { fetchEthereumGasFallback } from './etherscanGas';
import type { FxPublicClient, PlannedRoute, PlannedTransaction } from './types';
import { formatGasPriceGwei, validateGasTierQuote, type GasTierQuote } from './gasFeePolicy';
import { gasLimitMaxFeeCost } from './gasLimit';

/**
 * Gas is a property of the exact reviewed route. It is deliberately kept
 * separate from the route's native `value` and from LayerZero's quoted fees.
 * A route estimate is an informational snapshot and never authorizes signing.
 */
export type GasCostStatus = 'current' | 'partial' | 'unavailable';
export type GasStepStatus = 'estimated' | 'unavailable';

export interface GasFeeSnapshot {
  /** `maxFeePerGas` is a conservative EIP-1559 upper bound when available. */
  mode: 'eip1559-max' | 'legacy';
  feePerGasWei: bigint;
  maxPriorityFeePerGasWei?: bigint;
  /** Provenance for the optional Ethereum-only server-side fallback. */
  source?: 'rpc' | 'etherscan';
  /** The Pages oracle may serve a bounded stale cache during an outage. */
  stale?: boolean;
  tier?: GasTierQuote['tier'];
  displayFeePerGasWei?: bigint;
}

export interface GasStepEstimate {
  index: number;
  kind: PlannedTransaction['kind'];
  status: GasStepStatus;
  gas?: bigint;
  gasFeeWei?: bigint;
  /** Base/OP Stack L1 data fee, when the configured client exposes it. */
  l1DataFeeWei?: bigint;
  /** Base/OP Stack operator fee, when the configured client exposes it. */
  operatorFeeWei?: bigint;
  error?: string;
}

export interface RouteGasCostEstimate {
  /** Account, chain, and transaction fingerprint that this snapshot covers. */
  routeKey: string;
  walletAddress: Address;
  chainId: PlannedRoute['chainId'];
  operation: PlannedRoute['operation'];
  status: GasCostStatus;
  fetchedAt: number;
  validUntil: number;
  /** Optional head-block provenance when supplied independently. */
  blockNumber?: bigint;
  fee?: GasFeeSnapshot;
  steps: readonly GasStepEstimate[];
  /** Present only when every route step has a gas estimate. */
  estimatedGasUnits?: bigint;
  /** Present only when every route step and the fee quote are available. */
  executionGasFeeWei?: bigint;
  l1DataFeeWei?: bigint;
  operatorFeeWei?: bigint;
  /** Exact native value carried by the SDK transactions, including zero. */
  nativeValueWei: bigint;
  /** SDK quoted LayerZero native fee, kept separate from execution gas. */
  layerZeroNativeFeeWei?: bigint;
  /** SDK quoted LayerZero token fee; units are protocol token units. */
  layerZeroTokenFeeWei?: bigint;
  /** Native value plus execution gas; absent while either side is unavailable. */
  totalNativeCostWei?: bigint;
  /** Funds needed for wallet preflight using runner gas limits and fee caps. */
  requiredNativeCostWei?: bigint;
  /** Why a total is absent or what its component scope covers. */
  totalNativeCostScope?: 'execution-plus-value' | 'execution-plus-l1-plus-operator-plus-value';
  /** The wallet's native balance, when it could be read alongside the estimate. */
  nativeBalanceWei?: bigint;
  /**
   * True when the wallet cannot pay for the route: its balance is below the
   * required native cost, or, while some steps lack estimates, below the value
   * plus the 21,000-gas floor every transaction costs. Signing would only fail.
   */
  insufficientNativeBalance?: boolean;
  error?: string;
}

export interface EstimatePlannedRouteCostOptions {
  client?: FxPublicClient;
  signal?: AbortSignal;
  /** Per RPC call timeout. Defaults to eight seconds and is bounded. */
  timeoutMs?: number;
  /** Cache freshness timestamp supplied by tests or a caller-owned clock. */
  now?: () => number;
  /** Freshness lifetime. Defaults to fifteen seconds and is bounded. */
  ttlMs?: number;
  /** Exact user-selected fee snapshot shared with review and wallet requests. */
  feeTierQuote?: GasTierQuote;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 15_000;
const DEFAULT_TTL_MS = 15_000;
const MAX_TTL_MS = 120_000;
const MAX_ROUTE_STEPS = 32;
/** Keep malformed RPC values from producing unbounded arithmetic or UI data. */
export const MAX_FEE_PER_GAS_WEI = 1_000_000_000_000_000_000n;
export const MAX_GAS_UNITS_PER_STEP = 1_000_000_000n;
const MAX_COMPONENT_FEE_WEI = MAX_FEE_PER_GAS_WEI * MAX_GAS_UNITS_PER_STEP;
/** Every transaction costs at least this much gas. */
const MIN_TRANSACTION_GAS = 21_000n;
export const INSUFFICIENT_NATIVE_ERROR = 'Not enough ETH for network fees';

type GasClient = FxPublicClient & {
  estimateGas?: NonNullable<FxPublicClient['estimateGas']>;
  estimateFeesPerGas?: NonNullable<FxPublicClient['estimateFeesPerGas']>;
  getGasPrice?: NonNullable<FxPublicClient['getGasPrice']>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function nonNegativeBigint(value: unknown): bigint | undefined {
  return typeof value === 'bigint' && value >= 0n ? value : undefined;
}

function positiveBigint(value: unknown): bigint | undefined {
  return typeof value === 'bigint' && value > 0n ? value : undefined;
}

function boundedPositiveBigint(value: unknown, maximum: bigint): bigint | undefined {
  const resolved = positiveBigint(value);
  return resolved !== undefined && resolved <= maximum ? resolved : undefined;
}

function boundedNonNegativeBigint(value: unknown, maximum: bigint): bigint | undefined {
  const resolved = nonNegativeBigint(value);
  return resolved !== undefined && resolved <= maximum ? resolved : undefined;
}

function bridgeQuoteFee(route: PlannedRoute, name: 'nativeFee' | 'lzTokenFee'): bigint | undefined {
  if (route.operation !== 'buildBridgeTx' || !isRecord(route.quote)) return undefined;
  return nonNegativeBigint(route.quote[name]);
}

/**
 * A stable, in-memory-only key. Keeping calldata in the key avoids reusing a
 * gas result for a different route while never persisting or logging it.
 */
export function routeGasCostKey(route: PlannedRoute, feeTierQuote?: GasTierQuote): string {
  const routeKey = [
    route.chainId,
    route.walletAddress.toLowerCase(),
    route.operation,
    route.transactions.map((tx) => [
      tx.chainId,
      tx.from.toLowerCase(),
      tx.to.toLowerCase(),
      tx.data.toLowerCase(),
      tx.value.toString(),
      tx.nonce ?? '',
      tx.kind,
    ].join(':')).join('|'),
    bridgeQuoteFee(route, 'nativeFee')?.toString() ?? '',
    bridgeQuoteFee(route, 'lzTokenFee')?.toString() ?? '',
  ].join('::');
  return feeTierQuote
    ? `${routeKey}::${feeTierQuote.tier}:${feeTierQuote.gasPriceWei}:${feeTierQuote.maxFeePerGas}:${feeTierQuote.maxPriorityFeePerGas}:${feeTierQuote.validUntil ?? ''}:${feeTierQuote.source ?? ''}`
    : routeKey;
}

function assertTimeout(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 250 || resolved > maximum) {
    throw new RangeError(`${label} must be an integer between 250 and ${maximum} milliseconds`);
  }
  return resolved;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('gas estimate cancelled');
    error.name = 'AbortError';
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function boundedCall<T>(
  call: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => {
    abort = () => {
      const error = new Error('gas estimate cancelled');
      error.name = 'AbortError';
      reject(error);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('gas RPC request timed out')), timeoutMs);
  });
  try {
    return await Promise.race([call, cancellation, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

async function resolveFee(
  client: GasClient,
  timeoutMs: number,
  signal?: AbortSignal,
  chainId?: PlannedRoute['chainId'],
  selectedQuote?: GasTierQuote,
): Promise<GasFeeSnapshot> {
  if (selectedQuote) {
    const quote = validateGasTierQuote(selectedQuote);
    return {
      mode: 'eip1559-max',
      feePerGasWei: quote.maxFeePerGas,
      maxPriorityFeePerGasWei: quote.maxPriorityFeePerGas,
      source: quote.source,
      tier: quote.tier,
      displayFeePerGasWei: quote.gasPriceWei,
    };
  }
  let firstError: unknown;
  if (client.estimateFeesPerGas) {
    try {
      const fees = await boundedCall(client.estimateFeesPerGas(), timeoutMs, signal);
      const maxFee = boundedPositiveBigint(fees.maxFeePerGas, MAX_FEE_PER_GAS_WEI);
      if (maxFee !== undefined) {
        const priority = nonNegativeBigint(fees.maxPriorityFeePerGas);
        if (priority !== undefined && (priority > maxFee || priority > MAX_FEE_PER_GAS_WEI)) {
          firstError = new Error('fee RPC returned a priority fee above max fee');
        } else {
          return {
            mode: 'eip1559-max',
            feePerGasWei: maxFee,
            ...(priority === undefined ? {} : { maxPriorityFeePerGasWei: priority }),
          };
        }
      }
      const gasPrice = boundedPositiveBigint(fees.gasPrice, MAX_FEE_PER_GAS_WEI);
      if (gasPrice !== undefined) return { mode: 'legacy', feePerGasWei: gasPrice };
      firstError = new Error('fee RPC returned no usable fee per gas');
    } catch (error) {
      if (isAbortError(error)) throw error;
      firstError = error;
    }
  }
  if (client.getGasPrice) {
    try {
      const gasPrice = boundedPositiveBigint(await boundedCall(client.getGasPrice(), timeoutMs, signal), MAX_FEE_PER_GAS_WEI);
      if (gasPrice !== undefined) return { mode: 'legacy', feePerGasWei: gasPrice };
      firstError = firstError ?? new Error('gas price RPC returned an invalid value');
    } catch (error) {
      if (isAbortError(error)) throw error;
      firstError = firstError ?? error;
    }
  }
  // Etherscan is a narrowly scoped read-only price fallback. It cannot supply
  // gas units: every transaction's estimateGas result above remains required.
  // Base deliberately has no fallback because the oracle route is fixed to
  // Ethereum mainnet (chain 1).
  if (chainId === 1) {
    try {
      const snapshot = await boundedCall(fetchEthereumGasFallback({ timeoutMs }), timeoutMs, signal);
      const feePerGasWei = BigInt(snapshot.gasPriceWei);
      if (feePerGasWei > 0n) {
        return {
          mode: 'legacy',
          feePerGasWei,
          source: 'etherscan',
          stale: snapshot.stale,
        };
      }
      firstError = firstError ?? new Error('gas oracle returned an invalid fee per gas');
    } catch (error) {
      if (isAbortError(error)) throw error;
      firstError = firstError ?? error;
    }
  }
  throw new Error(`fee unavailable${firstError instanceof Error ? `: ${firstError.message}` : ''}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatGasUnits(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatNativeCost(value: bigint): { amount: string; unit: 'ETH' | 'Gwei' } {
  // Tiny estimates are common on test or low-fee networks. Showing eighteen
  // decimal places in ETH obscures the useful number, so retain precision in
  // Gwei below 0.000001 ETH so the compact six-decimal ETH display does not
  // collapse distinct low-cost transactions into the same less-than label.
  if (value < 1_000_000_000_000n) {
    return { amount: formatUnits(value, 9).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'), unit: 'Gwei' };
  }
  return { amount: formatEther(value).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'), unit: 'ETH' };
}

function unavailableEstimate(
  route: PlannedRoute,
  routeKey: string,
  fetchedAt: number,
  validUntil: number,
  nativeValueWei: bigint,
  error: string,
): RouteGasCostEstimate {
  return {
    routeKey,
    walletAddress: route.walletAddress,
    chainId: route.chainId,
    operation: route.operation,
    status: 'unavailable',
    fetchedAt,
    validUntil,
    steps: route.transactions.map((transaction, index) => ({
      index,
      kind: transaction.kind,
      status: 'unavailable',
      error,
    })),
    nativeValueWei,
    layerZeroNativeFeeWei: bridgeQuoteFee(route, 'nativeFee'),
    layerZeroTokenFeeWei: bridgeQuoteFee(route, 'lzTokenFee'),
    error,
  };
}

/**
 * Estimate the exact ordered route against the configured chain RPC.
 * Each transaction is estimated independently: a successful approval remains
 * useful when the following action still requires that approval and therefore
 * cannot be simulated against the current state.
 */
export async function estimatePlannedRouteCost(
  route: PlannedRoute,
  options: EstimatePlannedRouteCostOptions = {},
): Promise<RouteGasCostEstimate> {
  const now = options.now ?? Date.now;
  const fetchedAt = now();
  if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0) {
    throw new RangeError('gas estimate clock must return a non-negative safe integer timestamp');
  }
  const ttlMs = assertTimeout(options.ttlMs, DEFAULT_TTL_MS, MAX_TTL_MS, 'gas estimate TTL');
  const timeoutMs = assertTimeout(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, 'gas RPC timeout');
  if (fetchedAt > Number.MAX_SAFE_INTEGER - ttlMs) {
    throw new RangeError('gas estimate timestamp is too large');
  }
  const routeKey = routeGasCostKey(route, options.feeTierQuote);
  const nativeValueWei = route.transactions.reduce((sum, tx) => sum + tx.value, 0n);
  // The route cannot outlive its selected fee quote, even when its gas units
  // were fetched more recently. Native Max and review share this deadline.
  const validUntil = Math.min(fetchedAt + ttlMs, options.feeTierQuote?.validUntil ?? Number.POSITIVE_INFINITY);
  if (route.transactions.length === 0) {
    return unavailableEstimate(route, routeKey, fetchedAt, validUntil, nativeValueWei, 'route has no transactions');
  }
  if (route.transactions.length > MAX_ROUTE_STEPS) {
    return unavailableEstimate(route, routeKey, fetchedAt, validUntil, nativeValueWei, 'route has too many transactions to estimate safely');
  }
  if (route.transactions.some((transaction) =>
    transaction.chainId !== route.chainId
    || transaction.from.toLowerCase() !== route.walletAddress.toLowerCase()
  )) {
    return unavailableEstimate(route, routeKey, fetchedAt, validUntil, nativeValueWei, 'route account or chain scope does not match every transaction');
  }

  const client = (options.client ?? getPublicClient(route.chainId)) as GasClient;
  try {
    throwIfAborted(options.signal);
    await boundedCall(assertPublicClientChain(client, route.chainId), timeoutMs, options.signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return unavailableEstimate(route, routeKey, fetchedAt, validUntil, nativeValueWei, 'chain unavailable');
  }

  // The wallet's balance decides whether the route can be paid for at all. A
  // failed read leaves that unknown rather than blocking the review.
  const balancePromise: Promise<bigint | undefined> = typeof client.getBalance === 'function'
    ? boundedCall(client.getBalance({ address: route.walletAddress }), timeoutMs, options.signal)
      .then((balance) => (typeof balance === 'bigint' && balance >= 0n ? balance : undefined))
      .catch(() => undefined)
    : Promise.resolve(undefined);
  // Always settle this parallel request before the step loop completes. If a
  // fee request aborts while eth_estimateGas is still running, leaving a
  // rejected promise pending would surface as an unhandled rejection.
  const feePromise = resolveFee(client, timeoutMs, options.signal, route.chainId, options.feeTierQuote)
    .then((fee) => ({ fee } as const))
    .catch((error: unknown) => ({
      feeError: errorText(error),
      feeAbortError: isAbortError(error) ? error : undefined,
    }));
  const steps: GasStepEstimate[] = [];
  let orderedGas: bigint[] | undefined;
  if (route.transactions.some((transaction) => transaction.kind === 'approval')) {
    try {
      const result = await boundedCall(client.simulateCalls({
        account: route.walletAddress,
        calls: route.transactions.map((transaction) => ({
          to: transaction.to,
          data: transaction.data,
          value: transaction.value,
        })),
      }), timeoutMs, options.signal);
      if (Array.isArray(result.results) && result.results.length === route.transactions.length) {
        const gasValues = result.results.map((item) => {
          if (item.status !== 'success') return undefined;
          return boundedPositiveBigint(item.gasUsed, MAX_GAS_UNITS_PER_STEP);
        });
        if (gasValues.every((gas): gas is bigint => gas !== undefined)) orderedGas = gasValues;
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      // Fall back to per-transaction estimates when the RPC does not support
      // ordered simulation or cannot return a complete successful route.
    }
  }
  for (let index = 0; index < route.transactions.length; index += 1) {
    throwIfAborted(options.signal);
    const transaction = route.transactions[index];
    const simulatedGas = orderedGas?.[index];
    if (simulatedGas !== undefined) {
      steps.push({ index, kind: transaction.kind, status: 'estimated', gas: simulatedGas });
      continue;
    }
    if (!client.estimateGas) {
      steps.push({ index, kind: transaction.kind, status: 'unavailable', error: 'RPC client does not expose estimateGas' });
      continue;
    }
    try {
      const gas = await boundedCall(client.estimateGas({
        account: transaction.from,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
      }), timeoutMs, options.signal);
      if (boundedPositiveBigint(gas, MAX_GAS_UNITS_PER_STEP) === undefined) throw new Error('RPC returned an invalid gas estimate');
      steps.push({ index, kind: transaction.kind, status: 'estimated', gas });
    } catch (error) {
      if (isAbortError(error)) throw error;
      steps.push({ index, kind: transaction.kind, status: 'unavailable', error: safeGasCostError(error) });
    }
  }
  const feeResult = await feePromise;
  if ('feeAbortError' in feeResult && feeResult.feeAbortError) throw feeResult.feeAbortError;
  const allGas = steps.every((step) => step.status === 'estimated' && step.gas !== undefined);
  const estimatedGasUnits = allGas
    ? steps.reduce((sum, step) => sum + (step.gas ?? 0n), 0n)
    : undefined;
  const fee = 'fee' in feeResult ? feeResult.fee : undefined;
  // A stale oracle price remains visible as provenance, but it cannot certify
  // a current execution cost or be used by native-max calculations.
  const usableFee = fee && !fee.stale ? fee : undefined;
  const executionGasFeeWei = allGas && usableFee
    ? steps.reduce((sum, step) => sum + (step.gas ?? 0n) * usableFee.feePerGasWei, 0n)
    : undefined;
  const stepsWithFee = usableFee
    ? steps.map((step) => step.gas === undefined ? step : { ...step, gasFeeWei: step.gas * usableFee.feePerGasWei })
    : steps;
  let completeSteps = stepsWithFee;
  let l1DataFeeWei: bigint | undefined;
  let operatorFeeWei: bigint | undefined;
  let l1Unavailable = false;
  let operatorUnavailable = false;
  if (route.chainId === 8453 && allGas && usableFee) {
    if (!client.estimateL1Fee) l1Unavailable = true;
    if (!client.estimateOperatorFee) operatorUnavailable = true;
    completeSteps = [];
    for (const step of stepsWithFee) {
      const transaction = route.transactions[step.index];
      let l1: bigint | undefined;
      let operator: bigint | undefined;
      if (client.estimateL1Fee) {
        try {
          const result = await boundedCall(client.estimateL1Fee({
            account: route.walletAddress,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
            maxFeePerGas: usableFee.feePerGasWei,
            ...(usableFee.maxPriorityFeePerGasWei === undefined ? {} : { maxPriorityFeePerGas: usableFee.maxPriorityFeePerGasWei }),
          }), timeoutMs, options.signal);
          l1 = boundedNonNegativeBigint(result, MAX_COMPONENT_FEE_WEI);
          if (l1 === undefined) l1Unavailable = true;
        } catch (error) {
          if (isAbortError(error)) throw error;
          l1Unavailable = true;
        }
      }
      if (client.estimateOperatorFee) {
        try {
          const result = await boundedCall(client.estimateOperatorFee({
            account: route.walletAddress,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
            maxFeePerGas: usableFee.feePerGasWei,
            ...(usableFee.maxPriorityFeePerGasWei === undefined ? {} : { maxPriorityFeePerGas: usableFee.maxPriorityFeePerGasWei }),
          }), timeoutMs, options.signal);
          operator = boundedNonNegativeBigint(result, MAX_COMPONENT_FEE_WEI);
          if (operator === undefined) operatorUnavailable = true;
        } catch (error) {
          if (isAbortError(error)) throw error;
          operatorUnavailable = true;
        }
      }
      completeSteps.push({ ...step, ...(l1 === undefined ? {} : { l1DataFeeWei: l1 }), ...(operator === undefined ? {} : { operatorFeeWei: operator }) });
    }
    if (!l1Unavailable) l1DataFeeWei = completeSteps.reduce((sum, step) => sum + (step.l1DataFeeWei ?? 0n), 0n);
    if (!operatorUnavailable) operatorFeeWei = completeSteps.reduce((sum, step) => sum + (step.operatorFeeWei ?? 0n), 0n);
  }
  const baseComponentsComplete = route.chainId !== 8453 || (!l1Unavailable && !operatorUnavailable);
  const allCosts = allGas && usableFee && baseComponentsComplete;
  const status: GasCostStatus = allCosts ? 'current' : steps.some((step) => step.status === 'estimated') ? 'partial' : 'unavailable';
  const componentError = route.chainId === 8453
    ? [l1Unavailable ? 'Base L1 data fee unavailable' : '', operatorUnavailable ? 'Base operator fee unavailable' : '']
      .filter(Boolean).join('; ')
    : '';
  const error = 'feeError' in feeResult
    ? safeGasCostError(feeResult.feeError)
    : componentError || (fee?.stale ? 'gas oracle data is stale' : undefined) || steps.find((step) => step.error)?.error;
  const requiredNativeCostWei = allCosts && usableFee
    ? nativeValueWei
      + steps.reduce((sum, step) => sum + gasLimitMaxFeeCost(step.gas!, usableFee.feePerGasWei), 0n)
      + (l1DataFeeWei ?? 0n)
      + (operatorFeeWei ?? 0n)
    : undefined;
  const nativeBalanceWei = await balancePromise;
  const minimumNativeCostWei = usableFee
    ? nativeValueWei + BigInt(route.transactions.length) * MIN_TRANSACTION_GAS * usableFee.feePerGasWei
    : undefined;
  const fundsFloor = requiredNativeCostWei ?? minimumNativeCostWei;
  const insufficientNativeBalance = steps.some((step) => step.error === INSUFFICIENT_NATIVE_ERROR)
    || (nativeBalanceWei !== undefined && fundsFloor !== undefined && nativeBalanceWei < fundsFloor);
  return {
    routeKey,
    walletAddress: route.walletAddress,
    chainId: route.chainId,
    operation: route.operation,
    status,
    fetchedAt,
    validUntil,
    fee,
    steps: completeSteps,
    estimatedGasUnits,
    executionGasFeeWei,
    l1DataFeeWei,
    operatorFeeWei,
    nativeValueWei,
    layerZeroNativeFeeWei: bridgeQuoteFee(route, 'nativeFee'),
    layerZeroTokenFeeWei: bridgeQuoteFee(route, 'lzTokenFee'),
    totalNativeCostWei: allCosts && executionGasFeeWei !== undefined
      ? nativeValueWei + executionGasFeeWei + (l1DataFeeWei ?? 0n) + (operatorFeeWei ?? 0n)
      : undefined,
    requiredNativeCostWei,
    totalNativeCostScope: route.chainId === 8453
      ? (allCosts ? 'execution-plus-l1-plus-operator-plus-value' : undefined)
      : (executionGasFeeWei === undefined ? undefined : 'execution-plus-value'),
    nativeBalanceWei,
    insufficientNativeBalance,
    error,
  };
}

/**
 * How much more native balance the wallet needs to pass the same check that
 * sets `insufficientNativeBalance`: the native value plus every step's gas
 * limit at the maximum fee (and Base's L1 and operator fees), less the
 * balance. A partial estimate can prove a shortfall without knowing its size,
 * so it has none.
 */
export function nativeShortfallWei(
  estimate: Pick<RouteGasCostEstimate, 'insufficientNativeBalance' | 'requiredNativeCostWei' | 'nativeBalanceWei'>,
): bigint | undefined {
  if (!estimate.insufficientNativeBalance) return undefined;
  if (estimate.requiredNativeCostWei === undefined || estimate.nativeBalanceWei === undefined) return undefined;
  const shortfall = estimate.requiredNativeCostWei - estimate.nativeBalanceWei;
  return shortfall > 0n ? shortfall : undefined;
}

/**
 * Reviews name ETH to six decimal places: the smallest top-up worth naming and
 * the step a maximum network fee rounds up to, 0.000001 ETH.
 */
const ETH_DISPLAY_STEP_WEI = 1_000_000_000_000n;

/**
 * ETH to add, rounded up to the review's 0.000001 ETH step, never down, so
 * adding exactly the amount shown covers the shortfall. A maximum network fee
 * rounds up to the same step, so an empty wallet with nothing else to send is
 * asked for exactly the maximum fee the review shows.
 */
export function formatNativeShortfall(shortfallWei: bigint): string {
  if (shortfallWei <= 0n) return '0';
  const rounded = ((shortfallWei + ETH_DISPLAY_STEP_WEI - 1n) / ETH_DISPLAY_STEP_WEI) * ETH_DISPLAY_STEP_WEI;
  const [whole, fraction] = formatEther(rounded).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = fraction?.replace(/0+$/, '');
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** Network fees exclude native value sent, including bridge protocol fees. */
export function networkFeeWei(estimate: RouteGasCostEstimate): bigint | undefined {
  if (estimate.executionGasFeeWei === undefined) return undefined;
  if (estimate.chainId !== 8453) return estimate.executionGasFeeWei;
  if (estimate.l1DataFeeWei === undefined || estimate.operatorFeeWei === undefined) return undefined;
  return estimate.executionGasFeeWei + estimate.l1DataFeeWei + estimate.operatorFeeWei;
}

/**
 * The network fee a review shows, and the total with any native value. Once
 * the estimate knows what the wallet must fund, the fee is that maximum: every
 * step's gas limit (its estimate plus 20% headroom) at the fee per gas, plus
 * Base's L1 and operator fees. That is exactly the fee part of
 * requiredNativeCostWei, the figure that blocks signing, so a shortfall is
 * always the value plus this maximum, less the balance. An estimate without a
 * funding figure shows its expected cost instead, which is never called a max.
 */
export function routeNetworkFeeDisplay(estimate: RouteGasCostEstimate): { feeWei: bigint; totalWei?: bigint; max: boolean } | undefined {
  if (estimate.status === 'unavailable') return undefined;
  const required = estimate.requiredNativeCostWei;
  if (required !== undefined && required >= estimate.nativeValueWei) {
    return { feeWei: required - estimate.nativeValueWei, totalWei: required, max: true };
  }
  const expected = networkFeeWei(estimate);
  return expected === undefined ? undefined : { feeWei: expected, totalWei: estimate.totalNativeCostWei, max: false };
}

/** UI-facing strings are produced only for values proven by the snapshot. */
export function formatRouteGasCost(estimate: RouteGasCostEstimate): {
  estimatedGas?: string;
  gasTier?: string;
  gasFee?: string;
  totalCost?: string;
} {
  if (estimate.status === 'unavailable') return {};
  const fees = routeNetworkFeeDisplay(estimate);
  const gasAmount = fees === undefined ? undefined : formatNativeCost(fees.feeWei);
  const totalAmount = fees?.totalWei === undefined ? undefined : formatNativeCost(fees.totalWei);
  const displayRate = estimate.fee?.displayFeePerGasWei;
  const displayRateGwei = displayRate === undefined ? undefined : formatGasPriceGwei(displayRate);
  const baseComponents = estimate.chainId === 8453;
  const totalScope = fees?.max
    ? `native value + max network fee${baseComponents ? ' including Base L1/operator fees' : ''}`
    : `native value + execution fee${baseComponents ? ' + Base L1/operator fees' : ''}`;
  return {
    ...(estimate.estimatedGasUnits === undefined ? {} : { estimatedGas: `${formatGasUnits(estimate.estimatedGasUnits)} gas` }),
    ...(estimate.fee?.tier === undefined || displayRateGwei === undefined
      ? {}
      : { gasTier: `${estimate.fee.tier[0].toUpperCase()}${estimate.fee.tier.slice(1)} · ${displayRateGwei} Gwei` }),
    ...(gasAmount === undefined || fees === undefined ? {} : { gasFee: `${gasAmount.amount} ${gasAmount.unit}${fees.max ? ' (max)' : ''}` }),
    ...(totalAmount === undefined ? {} : { totalCost: `${totalAmount.amount} ${totalAmount.unit} (${totalScope})` }),
  };
}

export interface GasCostCacheView {
  status: 'current' | 'refreshing' | 'unavailable';
  /** Only a fresh snapshot belongs in `current`. */
  current?: RouteGasCostEstimate;
  /** A stale snapshot may be retained for visual continuity only. */
  previous?: RouteGasCostEstimate;
}

export interface RouteGasCostCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

interface GasCacheInFlight {
  promise?: Promise<RouteGasCostEstimate>;
  globalGeneration: number;
  routeGeneration: number;
}

/**
 * Small account/chain/route-scoped cache. A stale value is exposed as
 * `previous`, never as `current`; callers can show it while a bounded refresh
 * is in flight without treating it as a current authorization fact.
 */
export class RouteGasCostCache {
  private readonly entries = new Map<string, RouteGasCostEstimate>();
  private readonly inFlight = new Map<string, GasCacheInFlight>();
  private readonly routeGenerations = new Map<string, number>();
  private generation = 0;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: RouteGasCostCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 32;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1 || this.maxEntries > 128) {
      throw new RangeError('gas cache maxEntries must be an integer between 1 and 128');
    }
    this.ttlMs = assertTimeout(options.ttlMs, DEFAULT_TTL_MS, MAX_TTL_MS, 'gas cache TTL');
    // Resolve the clock when used, just like the review's freshness checks.
    // Capturing Date.now here would leave a long-lived cache on a different
    // clock when the browser's clock is replaced after initialization.
    this.now = options.now ?? (() => Date.now());
  }

  view(route: PlannedRoute, feeTierQuote?: GasTierQuote): GasCostCacheView {
    const key = routeGasCostKey(route, feeTierQuote);
    const previous = this.entries.get(key);
    const current = previous && previous.validUntil > this.now() ? previous : undefined;
    if (current) return { status: 'current', current };
    if (this.inFlight.has(key)) return { status: 'refreshing', previous };
    return { status: 'unavailable', previous };
  }

  /** Pending transport work is independent of a still-current cached value. */
  isRefreshing(route: PlannedRoute, feeTierQuote?: GasTierQuote): boolean {
    return this.inFlight.has(routeGasCostKey(route, feeTierQuote));
  }

  /** Reuse the exact fresh route prepared by another consumer. Signing and
   * explicit review refreshes continue to use refresh() for a new preflight. */
  getOrRefresh(route: PlannedRoute, options: Omit<EstimatePlannedRouteCostOptions, 'ttlMs' | 'now'> = {}): Promise<RouteGasCostEstimate> {
    const cached = this.view(route, options.feeTierQuote).current;
    if (cached?.status === 'current' && !cached.fee?.stale) return Promise.resolve(cached);
    return this.refresh(route, options);
  }

  async refresh(route: PlannedRoute, options: Omit<EstimatePlannedRouteCostOptions, 'ttlMs' | 'now'> = {}): Promise<RouteGasCostEstimate> {
    const key = routeGasCostKey(route, options.feeTierQuote);
    const existing = this.inFlight.get(key)?.promise;
    if (existing) return existing;
    const globalGeneration = this.generation;
    const routeGeneration = this.routeGenerations.get(key) ?? 0;
    const token: GasCacheInFlight = { globalGeneration, routeGeneration };
    // Requests are shared by all consumers of this account/chain/route key.
    // A component unmount must not abort another consumer's shared request;
    // callers ignore the result after cleanup.
    const promise = estimatePlannedRouteCost(route, {
      ...options,
      signal: undefined,
      ttlMs: this.ttlMs,
      now: this.now,
    }).then((estimate) => {
      if (globalGeneration === this.generation && routeGeneration === (this.routeGenerations.get(key) ?? 0)) {
        this.entries.delete(key);
        this.entries.set(key, estimate);
        while (this.entries.size > this.maxEntries) {
          const oldest = this.entries.keys().next().value;
          if (oldest === undefined) break;
          this.entries.delete(oldest);
        }
      }
      return estimate;
    }).finally(() => {
      // Generation changes detach an old request during clear(). Comparing it
      // prevents its cleanup from deleting a newer request for this key.
      if (this.inFlight.get(key) === token) this.inFlight.delete(key);
    });
    token.promise = promise;
    this.inFlight.set(key, token);
    return promise;
  }

  clear(route?: PlannedRoute): void {
    if (route) {
      const routeKey = routeGasCostKey(route);
      for (const key of [...this.entries.keys(), ...this.inFlight.keys()]) {
        if (!key.startsWith(`${routeKey}::`) && key !== routeKey) continue;
        this.entries.delete(key);
        this.routeGenerations.set(key, (this.routeGenerations.get(key) ?? 0) + 1);
        this.inFlight.delete(key);
      }
      // Detach the request so a subsequent refresh starts with the new route
      // state. The old request is allowed to finish, but generation prevents
      // it from repopulating this cache.
      return;
    }
    this.generation += 1;
    this.entries.clear();
    this.inFlight.clear();
  }
}

export const routeGasCostCache = new RouteGasCostCache();

/** Never leak a private key or RPC credential through an error string. */
export function safeGasCostError(error: unknown): string {
  const value = errorText(error);
  if (/insufficient funds|exceeds the balance|exceeds transaction sender account balance/i.test(value)) return INSUFFICIENT_NATIVE_ERROR;
  if (/abort|cancel/i.test(value)) return 'Gas estimate cancelled';
  if (/timed out|timeout/i.test(value)) return 'Gas estimate timed out';
  if (/Base L1 data fee unavailable/i.test(value)) return 'Base L1 data fee unavailable';
  if (/Base operator fee unavailable/i.test(value)) return 'Base operator fee unavailable';
  return 'Gas estimate unavailable';
}
