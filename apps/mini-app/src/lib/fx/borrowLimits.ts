import type { DebtRatioRange } from "./leverage";

const WAD = 10n ** 18n;
const BPS = 10_000n;
/** Display prices carry eight decimals into the 18-decimal USD values below. */
const PRICE_SCALE = 10n ** 8n;

/**
 * The SDK plans inside a 100 bps window of the pool's debt-ratio range, and the
 * form values collateral at display prices rather than the pool oracle; reserve
 * another 100 bps for that. The limits guide the form; the SDK simulation
 * against the pool remains the authority before anything is signed.
 */
export const BORROW_LIMIT_GUARD_BPS = 200n;

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n;
}

/** A display price as an 18-decimal USD amount per whole token; null when unusable. */
export function usdPriceWad(price: number | undefined): bigint | null {
  if (price === undefined || !Number.isFinite(price) || price <= 0) return null;
  const scaled = Math.round(price * Number(PRICE_SCALE));
  return scaled > 0 ? BigInt(scaled) * (WAD / PRICE_SCALE) : null;
}

/**
 * The USD value (18 decimals) of a raw token amount at a display price. Values
 * stay exact far below a cent, so dust collateral still has a borrowing limit.
 */
export function collateralUsdWad(raw: bigint, decimals: number, price: number | undefined): bigint | null {
  const priceWad = usdPriceWad(price);
  if (priceWad === null || raw < 0n) return null;
  return raw * priceWad / 10n ** BigInt(decimals);
}

/** The raw token amount worth `usdWad` at a display price; null when the price is unusable. */
export function tokenAmountForUsdWad(usdWad: bigint, decimals: number, price: number | undefined): bigint | null {
  const priceWad = usdPriceWad(price);
  if (priceWad === null || usdWad < 0n) return null;
  return usdWad * 10n ** BigInt(decimals) / priceWad;
}

/**
 * fxUSD debt bounds (18 decimals) for a long position whose collateral is worth
 * `collateralUsd` (18-decimal USD). fxUSD is the pool's debt unit, valued at one dollar.
 */
export function borrowDebtBounds(collateralUsd: bigint, range: DebtRatioRange): { minDebt: bigint; maxDebt: bigint } {
  if (collateralUsd <= 0n || range.max <= range.min) return { minDebt: 0n, maxDebt: 0n };
  return {
    minDebt: ceilDiv(collateralUsd * range.min * (BPS + BORROW_LIMIT_GUARD_BPS), WAD * BPS),
    maxDebt: collateralUsd * range.max * (BPS - BORROW_LIMIT_GUARD_BPS) / (WAD * BPS),
  };
}

/** How much more fxUSD a position can borrow, and the least a new loan must be. */
export function borrowCapacity({ collateralUsd, existingDebt, range }: {
  collateralUsd: bigint;
  existingDebt: bigint;
  range: DebtRatioRange;
}): { maxAdditional: bigint; minAdditional: bigint } {
  const { minDebt, maxDebt } = borrowDebtBounds(collateralUsd, range);
  return {
    maxAdditional: maxDebt > existingDebt ? maxDebt - existingDebt : 0n,
    minAdditional: minDebt > existingDebt ? minDebt - existingDebt : 0n,
  };
}

/** A readable fxUSD preset, rounded down to six decimals without hiding dust
 * or falling below the pool minimum. The full capacity remains the boundary. */
export function borrowMaximumPreset(maximum: bigint, minimum: bigint): bigint {
  const step = 10n ** 12n;
  const rounded = maximum / step * step;
  return rounded > 0n && rounded >= minimum ? rounded : maximum;
}

/** Collateral value (18-decimal USD) that can leave while `remainingDebt` stays inside the range. */
export function withdrawableCollateralUsd(collateralUsd: bigint, remainingDebt: bigint, range: DebtRatioRange): bigint {
  if (collateralUsd <= 0n) return 0n;
  if (remainingDebt <= 0n) return collateralUsd;
  if (range.max <= 0n) return 0n;
  const needed = ceilDiv(remainingDebt * WAD * BPS, range.max * (BPS - BORROW_LIMIT_GUARD_BPS));
  return collateralUsd > needed ? collateralUsd - needed : 0n;
}

/** Debt as a share of collateral value, in basis points; null when there is no collateral. */
export function loanToValueBps(debt: bigint, collateralUsd: bigint): bigint | null {
  if (collateralUsd <= 0n) return null;
  return debt * BPS / collateralUsd;
}
