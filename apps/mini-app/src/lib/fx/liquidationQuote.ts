import { formatUnits } from 'viem';
import { getPublicClient } from './clients';
import { positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from './policy';
import { withReadDeadline } from './readFacade';
import { ROUTE_PREFETCH_TTL_MS } from './routePrefetch';
import { FX_TOKENS } from './tokens';
import type { FxPublicClient, PlannedRoute, RouteDetails } from './types';
import { parseStEthPerWstEth, stEthForWstEth } from './wstEthRate';

const WAD = 10n ** 18n;
const MAX_UINT256 = (1n << 256n) - 1n;
// PoolStorage encodes debt ratios in 60 bits and bonuses in 30 bits. Its
// commented-out <=1e18 checks are not an enforced protocol constraint.
const MAX_POOL_RATIO = (1n << 60n) - 1n;
const MAX_POOL_BONUS = (1n << 30n) - 1n;
export const LIQUIDATION_QUOTE_TTL_MS = ROUTE_PREFETCH_TTL_MS;
export const LIQUIDATION_QUOTE_DEADLINE_MS = 4_000;
export const LIQUIDATION_RATIO_ABI = [{
  type: 'function', name: 'getLiquidateRatios', stateMutability: 'view', inputs: [],
  outputs: [{ name: 'debtRatio', type: 'uint256' }, { name: 'bonusRatio', type: 'uint256' }],
}] as const;
export const REBALANCE_RATIO_ABI = [{
  type: 'function', name: 'getRebalanceRatios', stateMutability: 'view', inputs: [],
  outputs: [{ name: 'debtRatio', type: 'uint256' }, { name: 'bonusRatio', type: 'uint256' }],
}] as const;
const RATE_ABI = [{ type: 'function', name: 'stEthPerToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;
type LiquidationQuote = NonNullable<RouteDetails['liquidationQuote']>;

/** Read-only parameters started with the SDK request. They can add at most
 * the bounded deadline to planning; failed reads never fail the plan. */
export async function readLiquidationQuote(options: {
  market: 'ETH' | 'BTC';
  side: 'long' | 'short';
  client?: Pick<FxPublicClient, 'readContract'>;
  /** Reuse the ETH long planner's concurrent accounting read. */
  rate?: Promise<unknown>;
  deadlineMs?: number;
  now?: () => number;
}): Promise<LiquidationQuote | undefined> {
  try {
    if (!['ETH', 'BTC'].includes(options.market) || !['long', 'short'].includes(options.side)) return undefined;
    const poolAddress = positionPoolAddress(options.market, options.side);
    const client = options.client ?? getPublicClient(1);
    const deadline = options.deadlineMs ?? LIQUIDATION_QUOTE_DEADLINE_MS;
    const readAt = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(readAt) || readAt <= 0) return undefined;
    const settle = (promise: Promise<unknown>) => withReadDeadline(promise, deadline).catch(() => undefined);
    const ratioRead = settle(client.readContract({ address: poolAddress, abi: LIQUIDATION_RATIO_ABI, functionName: 'getLiquidateRatios' }));
    const rebalanceRead = settle(client.readContract({ address: poolAddress, abi: REBALANCE_RATIO_ABI, functionName: 'getRebalanceRatios' }));
    const rateRead = options.market === 'ETH'
      ? settle(options.rate ?? client.readContract({ address: FX_TOKENS.wstETH.address, abi: RATE_ABI, functionName: 'stEthPerToken' }))
      : Promise.resolve(undefined);
    const [ratios, rateValue, rebalanceRatios] = await Promise.all([ratioRead, rateRead, rebalanceRead]);
    if (!Array.isArray(ratios) || ratios.length !== 2 || typeof ratios[0] !== 'bigint'
      || ratios[0] <= 0n || ratios[0] > MAX_POOL_RATIO || typeof ratios[1] !== 'bigint'
      || ratios[1] < 0n || ratios[1] > MAX_POOL_BONUS) return undefined;
    const rate = parseStEthPerWstEth(rateValue);
    if (options.market === 'ETH' && rate === undefined) return undefined;
    const rebalanceRatio = Array.isArray(rebalanceRatios) && rebalanceRatios.length === 2
      && typeof rebalanceRatios[0] === 'bigint' && rebalanceRatios[0] > 0n && rebalanceRatios[0] < ratios[0]
      && typeof rebalanceRatios[1] === 'bigint' && rebalanceRatios[1] >= 0n && rebalanceRatios[1] <= MAX_POOL_BONUS
      ? rebalanceRatios[0].toString() : undefined;
    return { poolAddress, liquidateRatio: ratios[0].toString(), readAt,
      ...(rebalanceRatio === undefined ? {} : { rebalanceRatio }),
      ...(rate === undefined ? {} : { stEthPerWstEth: rate.toString() }) };
  } catch {
    return undefined;
  }
}

function positiveUint(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || !/^\d{1,78}$/.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed > 0n && parsed <= MAX_UINT256 ? parsed : undefined;
}
const sameAddress = (left: unknown, right: string) => typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
const divideUp = (numerator: bigint, denominator: bigint) => (numerator + denominator - 1n) / denominator;

/**
 * Pool-native threshold, not an ETH/BTC spot-price projection. PositionLogic
 * uses D*1e36/(oraclePrice*C); BasePool liquidates at getLiquidateRatios()[0].
 * Thus a long's USD/token threshold is D/(C*L), a short's L*C/D. The ETH
 * long quote is wstETH and converts to stETH; the inverse ETH short oracle
 * prices wstETH, so its USD/wstETH threshold divides by the live wrapping rate.
 * See pinned contracts 5e198e93 PositionLogic:41–46, BasePool:318–334 and
 * InverseWstETHPriceOracle:20–28. Future rebalances/funding can change this.
 */
function projectedThresholdPrice(route: PlannedRoute, kind: 'liquidation' | 'rebalance', now: number): { value: string; title: string } | undefined {
  const intent = route.policy?.reviewedAction;
  const quote = route.details?.liquidationQuote;
  const borrow = route.operation === 'depositAndMint' && intent?.kind === 'deposit-and-mint';
  const trade = route.operation === 'increasePosition' && intent?.kind === 'position-increase';
  if (route.chainId !== 1 || (!trade && !borrow) || !intent
    || intent.positionId !== 0 || !quote || !Number.isSafeInteger(quote.readAt) || quote.readAt <= 0
    || !Number.isSafeInteger(now) || now < quote.readAt || now - quote.readAt >= LIQUIDATION_QUOTE_TTL_MS) return undefined;
  if (intent.kind !== 'position-increase' && intent.kind !== 'deposit-and-mint') return undefined;
  // SDK Borrow collateral is already in pool accounting units. Its quote does
  // not subtract supply fees, so only a validated zero supply rate is usable.
  if (borrow) {
    if (intent.kind !== 'deposit-and-mint' || intent.mintAmount <= 0n) return undefined;
    const fee = route.details?.protocolFeeQuote;
    const actions = route.transactions.filter(tx => tx.kind !== 'approval');
    const mintRouter = '0xB753366082466c4B5984312f0c4Bb97554be067E';
    if (!fee || !sameAddress(fee.poolAddress, intent.poolAddress) || !sameAddress(fee.routerAddress, mintRouter)
      || fee.ratios.length !== 4 || fee.ratios.some(raw => !/^\d{1,10}$/.test(raw) || BigInt(raw) > 1_000_000_000n)
      || BigInt(fee.ratios[0]) !== 0n || actions.length !== 1 || !sameAddress(actions[0].to, mintRouter)
      || actions[0].data.slice(0, 10).toLowerCase() !== '0x216d5108') return undefined;
  }
  const side = intent.kind === 'deposit-and-mint' ? 'long' : intent.positionType;
  if (side !== 'long' && side !== 'short') return undefined;
  const market = (['ETH', 'BTC'] as const).find((candidate) => sameAddress(intent.poolAddress, positionPoolAddress(candidate, side)));
  if (!market || !sameAddress(quote.poolAddress, intent.poolAddress)
    || (intent.kind === 'position-increase' && (!sameAddress(intent.collateralTokenAddress, positionCollateralTokenAddress(market, side))
    || !sameAddress(intent.debtTokenAddress, positionDebtTokenAddress(market, side))))) return undefined;
  const colls = positiveUint(route.details?.colls);
  const debts = positiveUint(route.details?.debts);
  const liquidationRatio = positiveUint(quote.liquidateRatio);
  const ratio = positiveUint(kind === 'rebalance' ? quote.rebalanceRatio : quote.liquidateRatio);
  if (colls === undefined || debts === undefined || ratio === undefined || ratio > MAX_POOL_RATIO) return undefined;
  if (kind === 'rebalance' && (liquidationRatio === undefined || liquidationRatio > MAX_POOL_RATIO || ratio >= liquidationRatio)) return undefined;
  const rate = parseStEthPerWstEth(quote.stEthPerWstEth);
  if (market === 'ETH' && rate === undefined) return undefined;
  const collateral = market === 'ETH' && side === 'long' && trade ? stEthForWstEth(colls, rate!) : colls;
  if (collateral <= 0n) return undefined;
  const numerator = side === 'long' ? debts * WAD * WAD : colls * ratio * (market === 'ETH' ? WAD : 1n);
  const denominator = side === 'long' ? collateral * ratio : debts * (market === 'ETH' ? rate! : 1n);
  const priceWad = side === 'long' ? divideUp(numerator, denominator) : numerator / denominator;
  if (priceWad <= 0n || priceWad > MAX_UINT256) return undefined;
  // Round toward the adverse threshold: upward for a long, downward for a short.
  const cent = WAD / 100n;
  const cents = side === 'long' ? divideUp(priceWad, cent) : priceWad / cent;
  if (cents <= 0n) return undefined;
  const symbol = market === 'ETH' ? 'stETH' : 'WBTC';
  const dollars = (cents / 100n).toLocaleString('en-US');
  const value = `$${dollars}.${(cents % 100n).toString().padStart(2, '0')} / ${symbol}`;
  return {
    value,
    title: `Estimated ${kind} threshold: ${formatUnits(priceWad, 18)} USD / ${symbol}, using this route's quoted collateral and debt and the live pool ${kind} ratio. Earlier protocol rebalancing and later funding or rate changes can change this threshold; this is not an ETH/USD or BTC/USD spot-price quote.`,
  };
}

export function projectedLiquidationPrice(route: PlannedRoute, now = Date.now()) {
  return projectedThresholdPrice(route, 'liquidation', now);
}

export function projectedRebalancePrice(route: PlannedRoute, now = Date.now()) {
  return projectedThresholdPrice(route, 'rebalance', now);
}
