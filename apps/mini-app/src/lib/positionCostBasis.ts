/**
 * A position's entry price and estimated PnL, from the f(x) subgraph's record
 * of its orders, as the official f(x) app (fx.aladdin.club) computes them.
 *
 * Units, checked against the four indexes the official app reads:
 * - `deltaColls` (a long's order) and `deltaDebts` (a short's) are in the
 *   token's own decimals: wstETH 18, WBTC 8. `positionColls` and
 *   `positionDebts` are pool accounting (1e18): an ETH long's collateral in
 *   stETH, an ETH short's debt in wstETH.
 * - `execPrice` is the swap's fxUSD per wstETH or WBTC (1e18), and 0 for an
 *   order without a swap (a deposit, funding, or protocol rebalance).
 * - `price` is the pool oracle's (1e18): USD per stETH or WBTC for a long; the
 *   inverse oracle's debt per dollar for a short.
 * - `priceRate` is stETH per wstETH (1e18), and 1e18 in the BTC pools.
 *
 * Each order's price is execPrice / priceRate, or the oracle price when
 * execPrice is 0: fxUSD per stETH or WBTC. A long's entry is the cost of its
 * collateral per unit of collateral; a short's is weighted by its debt. Every
 * figure is an estimate: indexed orders, a DEX mid price, and no exit costs.
 */

import { formatUsdCents } from './positionValuation';

export type CostBasisMarket = 'ETH' | 'BTC';
export type CostBasisSide = 'long' | 'short';

const WAD = 10n ** 18n;
const WAD_CUBED = 10n ** 54n;

/** One indexed order, validated: absent amounts are 0n, absent old values null. */
export interface IndexedOrder {
  id: string;
  type: string;
  blockNumber: bigint;
  /** Its place in its block: the order's log index, or a tick movement's own. */
  logIndex: number;
  deltaColls: bigint;
  deltaDebts: bigint;
  positionColls: bigint;
  positionDebts: bigint;
  oldPositionColls: bigint | null;
  execPrice: bigint;
  price: bigint;
  priceRate: bigint;
  /**
   * The f(x) fee the order paid, in the token it was charged in. The position's
   * collateral or debt is already net of it, and, as in the official app, the
   * entry price leaves it out: it is the price paid, before fees.
   */
  protocolFees: bigint | null;
}

/** Orders that buy or deposit the position's collateral (a long) or borrow its debt (a short). */
const ADDS = new Set(['Open', 'Add', 'Deposit', 'DepositMint', 'IncreaseCollateral']);
/**
 * Orders after which the entry price stands: reductions, protocol rebalances
 * and liquidations, withdrawals, and fxUSD repaid or minted against a long.
 * The official app moves a long's cost by the fxUSD of a Repay or Mint, which
 * would read a debt payment as price gain; FxAeon keeps its entry instead.
 */
const KEEPS = new Set(['Reduce', 'TickMovement', 'Rebalance', 'Liquidate', 'Withdraw', 'WithdrawRepay', 'Repay', 'Mint']);
/** Debt index snapshots, which the official app files apart from a position's orders. */
const SKIPS = new Set(['DebtIndexChanged']);

/** The scale of an order's delta: the deposited or borrowed token's decimals. */
export function orderDeltaScale(market: CostBasisMarket): bigint {
  return market === 'ETH' ? WAD : 10n ** 8n;
}

/**
 * Chronological order for a position's records, as the official app sorts
 * them: by block, then by log index from the last. In one transaction the
 * index snapshots come before the operation but carry its result, so the
 * operation must be applied first.
 */
export function sortIndexedOrders(orders: readonly IndexedOrder[]): IndexedOrder[] {
  return [...orders].sort((left, right) => left.blockNumber !== right.blockNumber
    ? (left.blockNumber < right.blockNumber ? -1 : 1)
    : left.logIndex !== right.logIndex ? right.logIndex - left.logIndex
      : left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/** The pool oracle's USD per stETH or WBTC (1e18); a short's inverse oracle is inverted. */
function oraclePrice(order: IndexedOrder, side: CostBasisSide): bigint {
  if (side === 'long') return order.price;
  return order.price > 0n && order.priceRate > 0n ? WAD_CUBED / (order.price * order.priceRate) : 0n;
}

/** fxUSD per wstETH or WBTC (1e18): the swap's price, or the oracle's without a swap. */
function tokenPrice(order: IndexedOrder, side: CostBasisSide): bigint {
  return order.execPrice !== 0n ? order.execPrice : oraclePrice(order, side) * order.priceRate / WAD;
}

/** The order's price in fxUSD per stETH or WBTC (1e18): execPrice / priceRate, or the oracle price. */
export function indexedOrderPrice(order: IndexedOrder, side: CostBasisSide): bigint | null {
  if (order.priceRate <= 0n || order.execPrice < 0n || order.price < 0n) return null;
  const price = tokenPrice(order, side) * WAD / order.priceRate;
  return price > 0n ? price : null;
}

/**
 * The entry price after `orders` in fxUSD per stETH or WBTC (1e18), or null
 * when it cannot be told: nothing opened the position, an order is of a kind
 * this does not know, or one lacks the price or amount it needs.
 *
 * Long: each add costs deltaColls × the token price; entry = cost /
 * positionColls. A reduction keeps the entry. A collateral index change
 * (funding) keeps the cost of what remains at the old entry and adds the
 * collateral lost at that event's oracle price, so funding raises the entry.
 *
 * Short: each add costs deltaDebts × the token price; entry = cost /
 * (positionDebts × priceRate), the debt in stETH or WBTC.
 *
 * A close starts over.
 */
export function positionEntryPrice(params: { market: CostBasisMarket; side: CostBasisSide; orders: readonly IndexedOrder[] }): bigint | null {
  const { side } = params;
  const scale = orderDeltaScale(params.market);
  let entry = 0n;
  // The position's collateral (long) or its debt in stETH or WBTC (short) after the last order applied.
  let held = 0n;
  for (const order of sortIndexedOrders(params.orders)) {
    if (SKIPS.has(order.type)) continue;
    if (order.positionColls < 0n || order.positionDebts < 0n || order.priceRate <= 0n) return null;
    if (order.type === 'Close') {
      entry = 0n;
      continue;
    }
    const size = side === 'long' ? order.positionColls : order.positionDebts * order.priceRate / WAD;
    if (order.type === 'CollIndexChanged') {
      if (side === 'long' && entry > 0n && order.oldPositionColls !== null && order.oldPositionColls !== order.positionColls) {
        const price = indexedOrderPrice(order, side);
        if (price === null) return null;
        const cost = size * entry / WAD - (order.positionColls - order.oldPositionColls) * price / WAD;
        entry = size > 0n && cost > 0n ? cost * WAD / size : 0n;
      }
      held = size;
      continue;
    }
    if (KEEPS.has(order.type)) {
      held = size;
      continue;
    }
    if (!ADDS.has(order.type)) return null;
    const delta = side === 'long' ? order.deltaColls : order.deltaDebts;
    if (delta < 0n) return null;
    if (delta > 0n) {
      const price = tokenPrice(order, side);
      if (price <= 0n) return null;
      const cost = held * entry / WAD + delta * price / scale;
      entry = size > 0n ? cost * WAD / size : 0n;
    }
    held = size;
  }
  return entry > 0n ? entry : null;
}

/**
 * Whether the index has caught up with the chain: its record of the
 * position's collateral and debt is within 1e10 (pool units) of the values
 * just read on chain. History behind the chain would give a wrong entry.
 */
export const INDEX_MATCH_TOLERANCE = 10n ** 10n;

export function indexMatchesChain(index: { colls: bigint; debts: bigint }, chain: { rawColls: bigint; rawDebts: bigint }): boolean {
  const near = (left: bigint, right: bigint) => (left > right ? left - right : right - left) < INDEX_MATCH_TOLERANCE;
  return near(index.colls, chain.rawColls) && near(index.debts, chain.rawDebts);
}

/** A decimal leverage such as the index's "3.186444448365503225", as 1e18 fixed point. */
export function parseLeverageWad(value: string | null | undefined): bigint | null {
  if (typeof value !== 'string' || !/^\d{1,6}(?:\.\d{1,18})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const parsed = BigInt(whole) * WAD + BigInt(fraction.padEnd(18, '0'));
  return parsed > 0n ? parsed : null;
}

export interface PositionPnl {
  /** Signed estimated PnL in USD cents, rounded half away from zero. */
  usdCents: bigint;
  /** Signed PnL as a percent of the position's margin, in basis points; null without a target leverage. */
  percentBps: bigint | null;
}

/** a / b rounded half away from zero, for a positive b. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const half = denominator / 2n;
  return numerator >= 0n ? (numerator + half) / denominator : -((-numerator + half) / denominator);
}

/**
 * Estimated PnL at `priceWad` (the SDK's DEX mid price, fxUSD per stETH or
 * WBTC): (P − entry) × side × size, where size is a long's collateral or a
 * short's debt in stETH or WBTC (rawDebts × rate); as a percent,
 * (P − entry) × side × targetLeverage / entry. It excludes exit costs:
 * closing fees, slippage and gas.
 */
export function positionPnl(params: {
  side: CostBasisSide;
  entryWad: bigint;
  priceWad: bigint;
  rawColls: bigint;
  rawDebts: bigint;
  /** stETH per wstETH (1e18) for an ETH pool, 1e18 for a BTC pool. */
  rateWad: bigint;
  targetLeverageWad: bigint | null;
}): PositionPnl | null {
  const { side, entryWad, priceWad, rateWad } = params;
  if (entryWad <= 0n || priceWad <= 0n || rateWad <= 0n || params.rawColls < 0n || params.rawDebts < 0n) return null;
  const move = (priceWad - entryWad) * (side === 'long' ? 1n : -1n);
  const size = side === 'long' ? params.rawColls : params.rawDebts * rateWad / WAD;
  // move (1e18 USD per unit) × size (1e18 units) is USD at 1e36; a cent is 1e34.
  const usdCents = divideRounded(move * size, 10n ** 34n);
  const percentBps = params.targetLeverageWad === null || params.targetLeverageWad <= 0n
    ? null
    : divideRounded(move * params.targetLeverageWad * 10_000n, entryWad * WAD);
  return { usdCents, percentBps };
}

/** The SDK's averagePrice as an exact ratio, in 1e18 fixed point. */
export function averagePriceWad(numerator: bigint, denominator: bigint): bigint | null {
  if (numerator <= 0n || denominator <= 0n) return null;
  const price = numerator * WAD / denominator;
  return price > 0n ? price : null;
}

/** The unit an entry price is per: the pool's own, stETH or WBTC. */
export function costBasisUnit(market: CostBasisMarket): 'stETH' | 'WBTC' {
  return market === 'ETH' ? 'stETH' : 'WBTC';
}

/** "≈ $2,409.34 / stETH": a price (1e18) in cents per stETH or WBTC. */
export function formatCostBasisPrice(priceWad: bigint, market: CostBasisMarket): string {
  return `≈\u00a0${formatUsdCents(divideRounded(priceWad, 10n ** 16n))} / ${costBasisUnit(market)}`;
}

/** "+" or a true minus sign, for a signed figure. */
function sign(value: bigint): string {
  return value > 0n ? '+' : value < 0n ? '−' : '';
}

/** "+4.52%" from basis points. */
export function formatPnlPercent(bps: bigint): string {
  const absolute = bps < 0n ? -bps : bps;
  return `${sign(bps)}${(absolute / 100n).toLocaleString('en-US')}.${(absolute % 100n).toString().padStart(2, '0')}%`;
}

/** "≈ +$1,234.56 (+4.52%)", the percent left out when unknown. */
export function formatPositionPnl(pnl: PositionPnl): string {
  const absolute = pnl.usdCents < 0n ? -pnl.usdCents : pnl.usdCents;
  const percent = pnl.percentBps === null ? '' : ` (${formatPnlPercent(pnl.percentBps)})`;
  return `≈\u00a0${sign(pnl.usdCents)}${formatUsdCents(absolute)}${percent}`;
}
