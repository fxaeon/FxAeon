import { decodeFunctionResult, encodeFunctionData } from 'viem';
import type { Abi } from 'viem';
import type { Address, MarketFacts } from '../domain/ports';
import { AppError } from '../domain/errors';
import { ADDRESSES, BPS, CONVERTER_ABI, FEE_ABI, FEE_SCALE, INPUT_ENCODING, INPUT_ROUTE, MANAGER_ABI, MAX_PRODUCT_LEVERAGE, MIN_PRODUCT_LEVERAGE, ORACLE_ABI, POOL_ABI, WAD, WRAPPING_ABI } from './contracts';
import type { RpcPort } from './rpc';
import { address, bytes, ceil, hex, invariant, quantity, safeNumber, unsigned } from './values';

export interface PoolSnapshot {
  readonly blockNumber: bigint;
  readonly readAt: number;
  readonly paused: boolean;
  readonly minimumDebtRatio: bigint;
  readonly maximumDebtRatio: bigint;
  readonly collateralRoom: bigint;
  readonly debtRoom: bigint;
  readonly anchorPrice: bigint;
  readonly minimumPrice: bigint;
  readonly maximumPrice: bigint;
  readonly wrappingRate: bigint;
  readonly fees: readonly [bigint, bigint, bigint, bigint];
  readonly nativeInputQuote?: { readonly amountWei: bigint; readonly wstEthWei: bigint };
}

/** Independently bind the exact native input to its allowlisted converter path.
 * Nonpayable converter quotes keep their own eth_call execution context.
 */
export async function withInputQuote(rpc: RpcPort, snapshot: PoolSnapshot, amountWei: bigint, signal: AbortSignal): Promise<PoolSnapshot> {
  const wstEthWei = unsigned(await contractRead(rpc, ADDRESSES.converter, CONVERTER_ABI,
    'queryConvert', [amountWei, INPUT_ENCODING, INPUT_ROUTE], snapshot.blockNumber, signal));
  invariant(wstEthWei > 0n, 'The native ETH conversion could not be independently verified.');
  return Object.freeze({ ...snapshot, nativeInputQuote: Object.freeze({ amountWei, wstEthWei }) });
}

export async function contractRead(rpc: RpcPort, target: Address, abi: Abi, name: string,
  args: readonly unknown[], block: bigint | 'latest', signal: AbortSignal): Promise<unknown> {
  const data = encodeFunctionData({ abi, functionName: name, args });
  const raw = bytes(await rpc.request('eth_call', [{ to: target, data }, block === 'latest' ? block : hex(block)], signal));
  return decodeFunctionResult({ abi, functionName: name, data: raw });
}

function tuple(value: unknown, count: number): bigint[] {
  invariant(Array.isArray(value) && value.length === count);
  return value.map(unsigned);
}

/** All required pool views use one explicit block, rather than a fabricated snapshot. */
export async function poolSnapshot(rpc: RpcPort, signal: AbortSignal, now: () => number): Promise<PoolSnapshot> {
  const blockNumber = quantity(await rpc.request('eth_blockNumber', [], signal));
  invariant(blockNumber > 0n);
  const [stateRaw, pauseRaw, rangeRaw, feesRaw, priceRaw, rateRaw] = await Promise.all([
    contractRead(rpc, ADDRESSES.manager, MANAGER_ABI, 'getPoolInfo', [ADDRESSES.pool], blockNumber, signal),
    contractRead(rpc, ADDRESSES.manager, MANAGER_ABI, 'paused', [], blockNumber, signal),
    contractRead(rpc, ADDRESSES.pool, POOL_ABI, 'getDebtRatioRange', [], blockNumber, signal),
    contractRead(rpc, ADDRESSES.configuration, FEE_ABI, 'getPoolFeeRatio', [ADDRESSES.pool, ADDRESSES.router], blockNumber, signal),
    contractRead(rpc, ADDRESSES.oracle, ORACLE_ABI, 'getPrice', [], blockNumber, signal),
    contractRead(rpc, ADDRESSES.wstEth, WRAPPING_ABI, 'stEthPerToken', [], blockNumber, signal),
  ]);
  const [collCap, collBalance, , debtCap, debtBalance] = tuple(stateRaw, 5) as [bigint, bigint, bigint, bigint, bigint];
  const [minimumDebtRatio, maximumDebtRatio] = tuple(rangeRaw, 2) as [bigint, bigint];
  const fees = tuple(feesRaw, 4) as [bigint, bigint, bigint, bigint];
  const [anchorPrice, minimumPrice, maximumPrice] = tuple(priceRaw, 3) as [bigint, bigint, bigint];
  const wrappingRate = unsigned(rateRaw);
  invariant(typeof pauseRaw === 'boolean' && collCap >= collBalance && debtCap >= debtBalance);
  invariant(minimumDebtRatio < maximumDebtRatio && maximumDebtRatio < (1n << 60n) && minimumDebtRatio < WAD);
  invariant(fees.every((fee) => fee < FEE_SCALE));
  invariant(minimumPrice > 0n && minimumPrice <= anchorPrice && anchorPrice <= maximumPrice);
  invariant(wrappingRate > WAD && wrappingRate <= 10n * WAD);
  return Object.freeze({ blockNumber, readAt: now(), paused: pauseRaw,
    minimumDebtRatio, maximumDebtRatio, collateralRoom: collCap - collBalance,
    debtRoom: debtCap - debtBalance, anchorPrice, minimumPrice, maximumPrice,
    wrappingRate, fees: Object.freeze(fees) });
}

export function leverageBounds(snapshot: PoolSnapshot): { minimum: number; maximum: number } {
  // The SDK signs ±1% oracle-anchor bounds. Leave that headroom within the
  // live pool interval before presenting this slice's conservative 1.1–5x set.
  const lowerRatio = ceil(snapshot.minimumDebtRatio * 101n, 100n);
  const upperRatio = snapshot.maximumDebtRatio * 99n / 100n;
  if (lowerRatio >= WAD || upperRatio <= lowerRatio) throw new AppError('unavailable', 'The pool has no verified leverage range for this trade.');
  const minimum = Math.max(MIN_PRODUCT_LEVERAGE, safeNumber(ceil(WAD * BPS, WAD - lowerRatio)));
  const maximum = upperRatio >= WAD ? MAX_PRODUCT_LEVERAGE
    : Math.min(MAX_PRODUCT_LEVERAGE, safeNumber(WAD * BPS / (WAD - upperRatio)));
  if (minimum > maximum) throw new AppError('unavailable', 'The pool has no verified leverage range for this trade.');
  return { minimum, maximum };
}

export function marketFacts(snapshot: PoolSnapshot, balanceWei?: bigint): MarketFacts {
  const limits = leverageBounds(snapshot);
  return Object.freeze({ chainId: 1, blockNumber: snapshot.blockNumber, readAt: snapshot.readAt,
    ...(balanceWei === undefined ? {} : { balanceWei }), priceUsdE18: snapshot.anchorPrice,
    minLeverageBps: limits.minimum, maxLeverageBps: limits.maximum, paused: snapshot.paused });
}

export async function canonicalPosition(rpc: RpcPort, owner: Address, id: bigint, signal: AbortSignal): Promise<{ collateral: bigint; debt: bigint } | undefined> {
  const [ownerRaw, state] = await Promise.all([
    contractRead(rpc, ADDRESSES.pool, POOL_ABI, 'ownerOf', [id], 'latest', signal),
    contractRead(rpc, ADDRESSES.pool, POOL_ABI, 'getPosition', [id], 'latest', signal),
  ]);
  if (address(ownerRaw) !== owner.toLowerCase()) return undefined;
  const [collateral, debt] = tuple(state, 2) as [bigint, bigint];
  if (collateral <= 0n || debt <= 0n) return undefined;
  // Ownership is checked again after accounting so a transfer during the read
  // does not publish the former owner's position.
  if (address(await contractRead(rpc, ADDRESSES.pool, POOL_ABI, 'ownerOf', [id], 'latest', signal)) !== owner.toLowerCase()) return undefined;
  return { collateral, debt };
}
