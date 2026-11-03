/**
 * The f(x) liquidation brake on a position card: how far the market can move
 * before the pool's rebalance and liquidation thresholds are reached.
 *
 * Protocol facts, from fx-protocol-contracts at 5e198e93 (see
 * docs/sdk-scope.md for line references):
 * - `getPositionDebtRatio(id)` is rawDebts / (anchorPrice × rawColls) with 1e18
 *   precision. `getPosition` already applies the tick tree's rebalance and
 *   redeem ratios and the debt/collateral indexes, so funding is included up
 *   to the pool's last index update.
 * - Rebalance and liquidation compare a tick's debt ratio with the pool's
 *   thresholds at the oracle's minimum price and act once the ratio is at or
 *   above a threshold. The anchor-priced ratio is rescaled to that basis.
 * - A long's debt is fxUSD, so its ratio moves as 1 / price. A short's debt is
 *   the volatile asset and its collateral is fxUSD, so its ratio moves with price.
 *
 * Everything here is an estimate (≈). The oracle prices the pool's collateral
 * unit (stETH for ETH pools, whose wstETH is converted by its rate provider;
 * WBTC for BTC pools) from Chainlink and DEX sources, while the card moves the
 * figures with the live ETH-USD or BTC-USD market quote. A pool also acts on a
 * tick's combined ratio, which can sit slightly above the position's own.
 */

/** Precision of f(x) pool debt ratios and their thresholds. */
export const DEBT_RATIO_PRECISION = 10n ** 18n;

export const FX_REBALANCING_DOCS_URL = 'https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/rebalancing-the-position-liquidation-brake';
export const FX_LIQUIDATION_DOCS_URL = 'https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/rebalancing-the-position-liquidation-brake/liquidation-process';

export type BrakeSide = 'long' | 'short';
export type BrakeMarket = 'ETH' | 'BTC';
/** Clear of both thresholds, at or past the rebalance point, or at or past liquidation. */
export type BrakeState = 'clear' | 'rebalance' | 'liquidation';

export interface BrakeReading {
  side: BrakeSide;
  /** The position's debt ratio on the price basis the pool's checks use (1e18). */
  debtRatio: bigint;
  /** `getRebalanceRatios()` debt ratio (1e18). */
  rebalanceRatio: bigint;
  /** `getLiquidateRatios()` debt ratio (1e18). */
  liquidateRatio: bigint;
  /** A fresh live market quote (USD) taken when the ratio was read, or null. */
  priceAtRead: number | null;
  /**
   * The pool's own threshold prices from the position's on-chain amounts, in
   * whole USD per stETH or WBTC (see `poolThresholdPrice`); null when unknown.
   */
  poolPrices?: { rebalance: number | null; liquidate: number | null } | null;
}

export interface BrakeView {
  state: BrakeState;
  /** Estimated debt share of collateral now (0–1): the split bar's debt fill. */
  fill: number;
  /** Where each threshold sits on the split bar (0–1); null when it lies beyond it. */
  rebalanceAt: number | null;
  liquidateAt: number | null;
  /** Whole-percent market move to each threshold, rounded down so the smaller
   * distance is shown; 0 means less than 1%. Null once the threshold is reached. */
  rebalanceMovePercent: number | null;
  liquidateMovePercent: number | null;
  /** ≈ market price at each threshold in whole dollars, rounded toward today's
   * price. Null without a read-time quote or once the threshold is reached. */
  rebalancePrice: number | null;
  liquidatePrice: number | null;
  /** The pool's own price at each threshold, per stETH or WBTC, for when no
   * read-time quote prices it. Null when unknown or once it is reached. */
  rebalancePoolPrice: number | null;
  liquidatePoolPrice: number | null;
}

export interface BrakeCopy {
  tone: 'neutral' | 'warn';
  /** The one plain line under the split bar. */
  line: string;
  /** Liquidation in words, for the markers' text alternative; null once reached. */
  liquidation: string | null;
  /** The official f(x) explanation of the state shown. */
  docsUrl: string;
  docsLabel: string;
}

function isPositivePrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function ratioNumber(value: bigint): number {
  return Number(value) / Number(DEBT_RATIO_PRECISION);
}

/**
 * Rescale `getPositionDebtRatio` (anchor price) to the oracle's minimum price,
 * which `rebalance` and `liquidate` use: ratio × anchor / min, rounded up and
 * never below the anchor-priced ratio.
 */
export function checkBasisDebtRatio(anchorDebtRatio: bigint, anchorPrice: bigint, minPrice: bigint): bigint {
  if (anchorDebtRatio < 0n) throw new RangeError('debt ratio must not be negative');
  if (anchorPrice <= 0n || minPrice <= 0n) throw new RangeError('oracle prices must be positive');
  const scaled = (anchorDebtRatio * anchorPrice + minPrice - 1n) / minPrice;
  return scaled > anchorDebtRatio ? scaled : anchorDebtRatio;
}

/** Move a ratio read at `priceAtRead` to `priceNow`: a long's as 1 / price, a short's with price. */
export function liveDebtRatio(side: BrakeSide, debtRatio: number, priceAtRead: number, priceNow: number): number {
  return side === 'long' ? debtRatio * priceAtRead / priceNow : debtRatio * priceNow / priceAtRead;
}

/**
 * The market move that takes `debtRatio` to `threshold`, as a fraction: a fall
 * of 1 − r/T for a long, a rise of T/r − 1 for a short. Zero or less once reached.
 */
export function marketMoveToThreshold(side: BrakeSide, debtRatio: number, threshold: number): number {
  return side === 'long' ? 1 - debtRatio / threshold : threshold / debtRatio - 1;
}

/** The market price at which `debtRatio`, read at `priceAtRead`, reaches `threshold`. */
export function thresholdPrice(side: BrakeSide, priceAtRead: number, debtRatio: number, threshold: number): number {
  return side === 'long' ? priceAtRead * debtRatio / threshold : priceAtRead * threshold / debtRatio;
}

// Binary fractions put exact results a hair off whole numbers (0.25 × 100 can
// land just under 25). These tolerances absorb that noise only; every rounding
// still goes in the safe direction.
const PERCENT_TOLERANCE = 1e-9;
const DOLLAR_TOLERANCE = 1e-6;

/** Round a move down to whole percent, so the smaller distance is shown. */
function floorPercent(fraction: number): number {
  return Math.max(0, Math.floor(fraction * 100 + PERCENT_TOLERANCE));
}

/** Round a threshold price toward today's: up for a long's fall, down for a short's rise. */
function safePrice(side: BrakeSide, price: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const rounded = side === 'long' ? Math.ceil(price - DOLLAR_TOLERANCE) : Math.floor(price + DOLLAR_TOLERANCE);
  return rounded > 0 ? rounded : null;
}

function barPosition(ratio: number): number | null {
  return ratio > 0 && ratio <= 1 ? ratio : null;
}

export function isUsableBrakeReading(reading: BrakeReading): boolean {
  return reading.debtRatio > 0n
    && reading.rebalanceRatio > 0n
    && reading.liquidateRatio > reading.rebalanceRatio;
}

/**
 * The brake as the card draws it now. With fresh quotes at read time and now,
 * the ratio follows the market between chain reads; otherwise it stays at the
 * read. A threshold reached on chain or by the live estimate counts as reached.
 */
export function positionBrakeView(reading: BrakeReading, priceNow: number | null): BrakeView | null {
  if (!isUsableBrakeReading(reading)) return null;
  const { side, debtRatio, rebalanceRatio, liquidateRatio } = reading;
  const ratio = ratioNumber(debtRatio);
  const rebalance = ratioNumber(rebalanceRatio);
  const liquidate = ratioNumber(liquidateRatio);
  const priceAtRead = isPositivePrice(reading.priceAtRead) ? reading.priceAtRead : null;
  const moving = priceAtRead !== null && isPositivePrice(priceNow);
  const ratioNow = moving ? liveDebtRatio(side, ratio, priceAtRead, priceNow) : ratio;
  if (!Number.isFinite(ratioNow) || ratioNow <= 0) return null;

  // The read itself is compared exactly; the live estimate only when it moved.
  const reachedLiquidation = debtRatio >= liquidateRatio || (moving && ratioNow >= liquidate);
  const reachedRebalance = reachedLiquidation || debtRatio >= rebalanceRatio || (moving && ratioNow >= rebalance);
  const state: BrakeState = reachedLiquidation ? 'liquidation' : reachedRebalance ? 'rebalance' : 'clear';
  const floor = state === 'liquidation' ? liquidate : state === 'rebalance' ? rebalance : 0;
  const fill = Math.min(1, Math.max(0, ratioNow, floor));

  const towards = (threshold: number, reached: boolean, poolPrice: number | null | undefined) => reached ? { move: null, price: null, poolPrice: null } : {
    move: floorPercent(marketMoveToThreshold(side, ratioNow, threshold)),
    price: priceAtRead === null ? null : safePrice(side, thresholdPrice(side, priceAtRead, ratio, threshold)),
    poolPrice: isPositivePrice(poolPrice) ? poolPrice : null,
  };
  const toRebalance = towards(rebalance, reachedRebalance, reading.poolPrices?.rebalance);
  const toLiquidation = towards(liquidate, reachedLiquidation, reading.poolPrices?.liquidate);
  return {
    state,
    fill,
    rebalanceAt: barPosition(rebalance),
    liquidateAt: barPosition(liquidate),
    rebalanceMovePercent: toRebalance.move,
    liquidateMovePercent: toLiquidation.move,
    rebalancePrice: toRebalance.price,
    liquidatePrice: toLiquidation.price,
    rebalancePoolPrice: toRebalance.poolPrice,
    liquidatePoolPrice: toLiquidation.poolPrice,
  };
}

/**
 * The pool's own price at a threshold `ratio` (1e18) from a position's
 * on-chain amounts: D / (C × R) for a long, C × R / D for a short, in whole
 * USD per stETH or WBTC. An ETH long's collateral is already stETH; an ETH
 * short owes wstETH, priced per stETH through `stEthPerWstEth`. The pool checks
 * this against its oracle's minimum price, so it needs no market quote. Rounded
 * toward today's price, like the quoted estimate: up for a long, down for a short.
 */
export function poolThresholdPrice(params: {
  market: BrakeMarket;
  side: BrakeSide;
  rawColls: bigint;
  rawDebts: bigint;
  ratio: bigint;
  /** stETH per wstETH (1e18); an ETH short has no price without it. */
  stEthPerWstEth?: bigint | null;
}): number | null {
  const { market, side, rawColls, rawDebts, ratio } = params;
  if (rawColls <= 0n || rawDebts <= 0n || ratio <= 0n) return null;
  const rate = market === 'ETH' && side === 'short' ? params.stEthPerWstEth ?? null : DEBT_RATIO_PRECISION;
  if (rate === null || rate <= 0n) return null;
  // Amounts and ratios are 1e18 fixed point, so these quotients are whole dollars.
  const numerator = side === 'long' ? rawDebts * DEBT_RATIO_PRECISION : rawColls * ratio;
  const denominator = side === 'long' ? rawColls * ratio : rawDebts * rate;
  const dollars = side === 'long' ? (numerator + denominator - 1n) / denominator : numerator / denominator;
  return dollars > 0n && dollars <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(dollars) : null;
}

const wholeUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Whole dollars, for a price already rounded in the safe direction. */
export function formatWholeUsd(value: number): string {
  return wholeUsd.format(value);
}

/**
 * A threshold price as a card shows it: on the live market quote's basis
 * ("≈ $1,575"), or, without one, the pool's own price per stETH or WBTC
 * ("≈ $1,575 / stETH"). Null when neither is known.
 */
export function brakeThresholdText(view: BrakeView, kind: 'rebalance' | 'liquidation', market: BrakeMarket): string | null {
  const price = kind === 'rebalance' ? view.rebalancePrice : view.liquidatePrice;
  if (price !== null) return `≈\u00a0${formatWholeUsd(price)}`;
  const poolPrice = kind === 'rebalance' ? view.rebalancePoolPrice : view.liquidatePoolPrice;
  return poolPrice === null ? null : `≈\u00a0${formatWholeUsd(poolPrice)} / ${market === 'ETH' ? 'stETH' : 'WBTC'}`;
}

// "≈" stays with its figure (a no-break space), so a narrow line never strands it.
function moveWords(percent: number): string {
  return percent < 1 ? 'less than 1%' : `≈\u00a0${percent.toLocaleString('en-US')}%`;
}

function priceWords(price: number | null): string {
  return price === null ? '' : ` (≈\u00a0${formatWholeUsd(price)})`;
}

/** Plain words for the card: the market, the direction that matters, and the distance. */
export function positionBrakeCopy(view: BrakeView, market: BrakeMarket, side: BrakeSide): BrakeCopy {
  const verb = side === 'long' ? 'falls' : 'rises';
  const liquidation = view.liquidateMovePercent === null
    ? null
    : `If rebalancing can’t keep up, liquidation becomes possible once ${market} ${verb} ${moveWords(view.liquidateMovePercent)}${priceWords(view.liquidatePrice)}.`;
  const rebalancingDocs = { docsUrl: FX_REBALANCING_DOCS_URL, docsLabel: 'How rebalancing works' };
  if (view.state === 'liquidation') {
    return {
      tone: 'warn',
      line: 'At the liquidation point. The protocol may liquidate this position.',
      liquidation: null,
      docsUrl: FX_LIQUIDATION_DOCS_URL,
      docsLabel: 'How liquidation works',
    };
  }
  if (view.state === 'rebalance') {
    return { tone: 'warn', line: 'At the rebalance point. The protocol may rebalance part of this position.', liquidation, ...rebalancingDocs };
  }
  return {
    tone: 'neutral',
    line: `Rebalances if ${market} ${verb} ${moveWords(view.rebalanceMovePercent ?? 0)}${priceWords(view.rebalancePrice)}`,
    liquidation,
    ...rebalancingDocs,
  };
}
