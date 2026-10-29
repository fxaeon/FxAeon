import type { Address } from 'viem';
import { positionPoolAddress } from '@/lib/fx/policy';
import { withReadDeadline } from '@/lib/fx/readFacade';
import { parseStEthPerWstEth } from '@/lib/fx/wstEthRate';
import { checkBasisDebtRatio } from '@/lib/positionBrake';
import type { UiMarket, UiSide } from './fxUi';

/**
 * Read-only pool views behind a position card's brake. The signatures match
 * IPool at fx-protocol-contracts 5e198e93 and the pool ABI that fx-sdk 1.0.5
 * bundles without exporting; test/position-brake-reader.test.ts checks both.
 * Ratios use 1e18 precision; the bonus ratios (1e9) are not used.
 */
export const POSITION_BRAKE_POOL_ABI = [
  { type: 'function', name: 'getPositionDebtRatio', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'debtRatio', type: 'uint256' }] },
  { type: 'function', name: 'getRebalanceRatios', stateMutability: 'view', inputs: [], outputs: [{ name: 'debtRatio', type: 'uint256' }, { name: 'bonusRatio', type: 'uint256' }] },
  { type: 'function', name: 'getLiquidateRatios', stateMutability: 'view', inputs: [], outputs: [{ name: 'debtRatio', type: 'uint256' }, { name: 'bonusRatio', type: 'uint256' }] },
  { type: 'function', name: 'priceOracle', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
] as const;

/** The pool oracle's prices (1e18): rebalance and liquidation use `minPrice`. */
export const POSITION_BRAKE_ORACLE_ABI = [
  { type: 'function', name: 'getPrice', stateMutability: 'view', inputs: [], outputs: [{ name: 'anchorPrice', type: 'uint256' }, { name: 'minPrice', type: 'uint256' }, { name: 'maxPrice', type: 'uint256' }] },
] as const;

/**
 * wstETH, whose `stEthPerToken()` prices an ETH short's wstETH debt per stETH,
 * as the Trade ticket's threshold does (test/position-brake-reader.test.ts
 * checks the address against the SDK's).
 */
export const POSITION_BRAKE_WSTETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0' as Address;
export const POSITION_BRAKE_WSTETH_RATE_ABI = [
  { type: 'function', name: 'stEthPerToken', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const;

/** Thresholds and the oracle address are governance settings, cached briefly per pool. */
export const POOL_BRAKE_PARAMETER_TTL_MS = 60_000;
/** Calldata bytes per multicall request: room for about a hundred positions in one call. */
export const POSITION_BRAKE_MULTICALL_BYTES = 4_096;

export interface PositionBrakeTarget {
  key: string;
  market: UiMarket;
  side: UiSide;
  positionId: number;
}

export interface PoolBrakeParameters {
  rebalanceRatio: bigint;
  liquidateRatio: bigint;
  oracle: Address;
  readAt: number;
  /** The wstETH short's stETH per wstETH (1e18); absent elsewhere or when its read failed. */
  stEthPerWstEth?: bigint;
}

export interface PositionBrakeSample {
  /** `getPositionDebtRatio` rescaled to the oracle's minimum price. */
  debtRatio: bigint;
  /** `getPositionDebtRatio` as returned (anchor price). */
  anchorDebtRatio: bigint;
  rebalanceRatio: bigint;
  liquidateRatio: bigint;
  /** The pool's stETH per wstETH, for a wstETH short. */
  stEthPerWstEth?: bigint;
}

export type PositionBrakeOutcome =
  | { status: 'ready'; sample: PositionBrakeSample }
  | { status: 'failed'; reason: unknown };

type BrakeCall = { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] };
type BrakeCallOutcome = { status: 'success'; result: unknown } | { status: 'failure'; error: unknown };

/** The slice of viem's public client used here: one aggregate3 eth_call per chunk. */
export type PositionBrakeClient = {
  multicall: (args: { contracts: readonly BrakeCall[]; allowFailure: true; batchSize?: number }) => Promise<readonly BrakeCallOutcome[]>;
};

export function createPoolBrakeParameterCache(ttlMs = POOL_BRAKE_PARAMETER_TTL_MS) {
  const entries = new Map<string, PoolBrakeParameters>();
  return {
    get(pool: Address, now: number): PoolBrakeParameters | undefined {
      const entry = entries.get(pool.toLowerCase());
      return entry && now >= entry.readAt && now - entry.readAt < ttlMs ? entry : undefined;
    },
    set(pool: Address, entry: PoolBrakeParameters): void {
      entries.set(pool.toLowerCase(), entry);
    },
    clear(): void {
      entries.clear();
    },
  };
}

export type PoolBrakeParameterCache = ReturnType<typeof createPoolBrakeParameterCache>;

function resultOf(outcome: BrakeCallOutcome | undefined, label: string): unknown {
  if (outcome?.status === 'success') return outcome.result;
  throw outcome?.status === 'failure' ? outcome.error : new Error(`${label} was not returned`);
}

function uint(value: unknown, label: string): bigint {
  if (typeof value !== 'bigint' || value < 0n) throw new TypeError(`${label} was malformed`);
  return value;
}

function uints(value: unknown, length: number, label: string): bigint[] {
  if (!Array.isArray(value) || value.length !== length) throw new TypeError(`${label} was malformed`);
  return value.map((item) => uint(item, label));
}

function oracleAddress(value: unknown): Address {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value)) {
    throw new TypeError('pool price oracle was malformed');
  }
  return value as Address;
}

function poolOf(target: PositionBrakeTarget): Address {
  return positionPoolAddress(target.market, target.side);
}

/**
 * Read each position's debt ratio with its pool's thresholds and oracle
 * prices. Stale pool parameters are refreshed first in one multicall; the
 * per-refresh read is one multicall of every debt ratio plus each pool
 * oracle's `getPrice`, so the ratios and prices come from the same block.
 * A failed or malformed read fails only the positions it covers.
 */
export async function readPositionBrakes(params: {
  client: PositionBrakeClient;
  targets: readonly PositionBrakeTarget[];
  cache: PoolBrakeParameterCache;
  now?: () => number;
  deadlineMs?: number;
}): Promise<Map<string, PositionBrakeOutcome>> {
  const now = params.now ?? Date.now;
  const outcomes = new Map<string, PositionBrakeOutcome>();
  const fail = (target: PositionBrakeTarget, reason: unknown) => outcomes.set(target.key, { status: 'failed', reason });
  const read = (contracts: BrakeCall[]) => withReadDeadline(
    params.client.multicall({ contracts, allowFailure: true, batchSize: POSITION_BRAKE_MULTICALL_BYTES }),
    params.deadlineMs,
  ).then((results) => {
    if (!Array.isArray(results) || results.length !== contracts.length) throw new TypeError('position brake multicall was malformed');
    return results as readonly BrakeCallOutcome[];
  });

  const targets = params.targets.filter((target) => {
    if (Number.isSafeInteger(target.positionId) && target.positionId > 0) return true;
    fail(target, new TypeError('position ID must be a positive safe integer'));
    return false;
  });
  const pools = [...new Set(targets.map(poolOf))];
  const poolFailures = new Map<Address, unknown>();

  const stale = pools.filter((pool) => !params.cache.get(pool, now()));
  if (stale.length) {
    try {
      // The wstETH short's rate rides along; an unreadable rate only leaves its pool price unknown.
      const wstEthShort = positionPoolAddress('ETH', 'short').toLowerCase();
      const calls = stale.map((pool) => [
        { address: pool, abi: POSITION_BRAKE_POOL_ABI, functionName: 'getRebalanceRatios' },
        { address: pool, abi: POSITION_BRAKE_POOL_ABI, functionName: 'getLiquidateRatios' },
        { address: pool, abi: POSITION_BRAKE_POOL_ABI, functionName: 'priceOracle' },
        ...(pool.toLowerCase() === wstEthShort ? [{ address: POSITION_BRAKE_WSTETH, abi: POSITION_BRAKE_WSTETH_RATE_ABI, functionName: 'stEthPerToken' }] : []),
      ]);
      const results = await read(calls.flat());
      let offset = 0;
      stale.forEach((pool, index) => {
        const at = offset;
        offset += calls[index].length;
        try {
          const [rebalanceRatio] = uints(resultOf(results[at], 'rebalance ratios'), 2, 'rebalance ratios');
          const [liquidateRatio] = uints(resultOf(results[at + 1], 'liquidation ratios'), 2, 'liquidation ratios');
          const oracle = oracleAddress(resultOf(results[at + 2], 'price oracle'));
          if (rebalanceRatio === 0n || liquidateRatio <= rebalanceRatio) throw new RangeError('pool thresholds are not ordered');
          const rate = calls[index].length > 3 && results[at + 3]?.status === 'success'
            ? parseStEthPerWstEth((results[at + 3] as { result: unknown }).result) : undefined;
          params.cache.set(pool, { rebalanceRatio, liquidateRatio, oracle, readAt: now(), ...(rate === undefined ? {} : { stEthPerWstEth: rate }) });
        } catch (reason) {
          poolFailures.set(pool, reason);
        }
      });
    } catch (reason) {
      stale.forEach((pool) => poolFailures.set(pool, reason));
    }
  }

  const parameters = new Map<Address, PoolBrakeParameters>();
  for (const pool of pools) {
    const entry = poolFailures.has(pool) ? undefined : params.cache.get(pool, now());
    if (entry) parameters.set(pool, entry);
  }
  const ready = targets.filter((target) => {
    if (parameters.has(poolOf(target))) return true;
    fail(target, poolFailures.get(poolOf(target)) ?? new Error('pool thresholds unavailable'));
    return false;
  });
  if (!ready.length) return outcomes;

  const readyPools = [...new Set(ready.map(poolOf))];
  try {
    const results = await read([
      ...ready.map((target) => ({ address: poolOf(target), abi: POSITION_BRAKE_POOL_ABI, functionName: 'getPositionDebtRatio', args: [BigInt(target.positionId)] })),
      ...readyPools.map((pool) => ({ address: parameters.get(pool)!.oracle, abi: POSITION_BRAKE_ORACLE_ABI, functionName: 'getPrice' })),
    ]);
    const prices = new Map<Address, { anchor: bigint; min: bigint } | { reason: unknown }>();
    readyPools.forEach((pool, index) => {
      try {
        const [anchor, min] = uints(resultOf(results[ready.length + index], 'oracle price'), 3, 'oracle price');
        if (anchor === 0n || min === 0n) throw new RangeError('oracle price was zero');
        prices.set(pool, { anchor, min });
      } catch (reason) {
        prices.set(pool, { reason });
      }
    });
    ready.forEach((target, index) => {
      try {
        const price = prices.get(poolOf(target))!;
        if ('reason' in price) throw price.reason;
        const anchorDebtRatio = uint(resultOf(results[index], 'position debt ratio'), 'position debt ratio');
        const { rebalanceRatio, liquidateRatio, stEthPerWstEth } = parameters.get(poolOf(target))!;
        outcomes.set(target.key, {
          status: 'ready',
          sample: {
            debtRatio: checkBasisDebtRatio(anchorDebtRatio, price.anchor, price.min), anchorDebtRatio, rebalanceRatio, liquidateRatio,
            ...(stEthPerWstEth === undefined ? {} : { stEthPerWstEth }),
          },
        });
      } catch (reason) {
        fail(target, reason);
      }
    });
  } catch (reason) {
    ready.forEach((target) => fail(target, reason));
  }
  return outcomes;
}
