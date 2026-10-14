export type LeverageSide = 'long' | 'short';

/**
 * Debt as a share of collateral value, before fees. A displayed L× long has
 * collateral/equity = L, so debt/collateral = (L − 1) / L. A displayed L×
 * short has debt/equity = L, so debt/collateral = L / (L + 1). Educational
 * figures only: never a position valuation or an SDK input.
 */
export function debtShare(side: LeverageSide, leverage: number): number {
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  return side === 'short' ? leverage / (leverage + 1) : Math.max(0, (leverage - 1) / leverage);
}

/** Whole percentages that always total 100: the debt share rounded, the rest the trader's. */
export function splitPercents(side: LeverageSide, leverage: number): { debt: number; yours: number } {
  const debt = Math.round(debtShare(side, leverage) * 100);
  return { debt, yours: 100 - debt };
}

/** The leverage whose debt share is `share`: debtShare read backwards. */
export function leverageForShare(side: LeverageSide, share: number): number {
  if (Number.isNaN(share) || share <= 0) return side === 'short' ? 0 : 1;
  if (share >= 1) return Number.POSITIVE_INFINITY;
  return side === 'short' ? share / (1 - share) : 1 / (1 - share);
}

function stepDecimals(step: number): number {
  const [, fraction = ''] = String(step).split('.');
  return fraction.length;
}

/** Steps are counted from `min`, as a native range input counts them. */
function stepGrid(min: number, max: number, step: number) {
  const decimals = stepDecimals(step);
  const count = Math.max(0, Math.round((max - min) / step));
  const at = (index: number) => Number((min + Math.min(count, Math.max(0, index)) * step).toFixed(decimals));
  return { count, at };
}

/**
 * The leverage a pointer picks on the split slider: of the selectable steps
 * between `min` and `max`, the one whose debt share is drawn nearest to
 * `share`. Each extra × moves the boundary less, so the steps bunch up
 * toward the high end exactly as the track draws them.
 */
export function leverageAtShare(side: LeverageSide, share: number, min: number, max: number, step = 0.1): number {
  const { count, at } = stepGrid(min, max, step);
  const exact = leverageForShare(side, share);
  const position = Number.isFinite(exact) ? (exact - min) / step : count;
  const below = at(Math.floor(position));
  const above = at(Math.ceil(position));
  return Math.abs(debtShare(side, above) - share) < Math.abs(debtShare(side, below) - share) ? above : below;
}

/** A keyboard move from the current leverage: `delta` in ×, kept on the step grid and inside the bounds. */
export function stepLeverage(value: number, delta: number, min: number, max: number, step = 0.1): number {
  const { at } = stepGrid(min, max, step);
  const current = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  return at(Math.round((current - min) / step) + Math.round(delta / step));
}

/** Position on the selectable leverage scale, independent of the debt split. */
export function leverageTrackPosition(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** A pointer chooses the nearest leverage step on the live min/max scale. */
export function leverageAtTrackPosition(position: number, min: number, max: number, step = 0.1): number {
  if (Number.isNaN(position)) return min;
  const bounded = Math.min(1, Math.max(0, position));
  if (bounded === 1) return max;
  return Math.min(max, stepLeverage(min + bounded * (max - min), 0, min, max, step));
}

/** Whole-leverage ticks on the same linear scale as the pointer and thumb. */
export function leverageTicksOnTrack(min: number, max: number, value: number, trackPx: number, thumbRadiusPx: number) {
  if (!Number.isFinite(trackPx) || trackPx <= 0) return [];
  const thumb = leverageTrackPosition(value, min, max);
  let previous = 0;
  return wholeLeverageTicks(min, max).flatMap(leverage => {
    const share = leverageTrackPosition(leverage, min, max);
    if ((share - previous) * trackPx < SPLIT_TICK_MIN_GAP_PX || (1 - share) * trackPx < SPLIT_TICK_MIN_GAP_PX / 2) return [];
    previous = share;
    return [{ leverage, share, nearThumb: Math.abs(share - thumb) * trackPx < thumbRadiusPx + SPLIT_TICK_THUMB_CLEARANCE_PX }];
  });
}

/** Whole leverages strictly inside the live range. */
export function wholeLeverageTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ticks;
  for (let leverage = Math.floor(min) + 1; leverage < max; leverage += 1) ticks.push(leverage);
  return ticks;
}

/**
 * The split slider's faint ticks: whole leverages placed at their debt share.
 * Each extra × moves the boundary less, so the ticks close up toward the high
 * end; they stop once the next would sit nearer than `minGap` (a fraction of
 * the track) to the last, since the rest only get closer. A tick that would
 * crowd either end of the live range is left to the end itself.
 */
export function splitTicks(side: LeverageSide, min: number, max: number, minGap = 0.025): { leverage: number; share: number }[] {
  const ticks: { leverage: number; share: number }[] = [];
  const start = debtShare(side, min);
  const end = debtShare(side, max);
  let last = start;
  for (const leverage of wholeLeverageTicks(min, max)) {
    const share = debtShare(side, leverage);
    if (share - last < minGap) {
      // The range's start is not a whole ×, so only the first tick can sit too close to it.
      if (last === start) continue;
      break;
    }
    if (end - share >= minGap / 2) ticks.push({ leverage, share });
    last = share;
  }
  return ticks;
}

/** Visible ticks keep at least this much room between them on the drawn track. */
export const SPLIT_TICK_MIN_GAP_PX = 14;
/** A tick this close to the thumb's edge steps aside, so nothing clutters the thumb. */
export const SPLIT_TICK_THUMB_CLEARANCE_PX = 10;

/**
 * The ticks for a track measured at `trackPx` with the thumb at `leverage`:
 * spaced at least SPLIT_TICK_MIN_GAP_PX apart (never closer than the 2.5%
 * rule either), each marked when it falls within SPLIT_TICK_THUMB_CLEARANCE_PX
 * of the thumb's edge. An unmeasured track draws none.
 */
export function splitTicksOnTrack(
  side: LeverageSide, min: number, max: number, leverage: number, trackPx: number, thumbRadiusPx: number,
): { leverage: number; share: number; nearThumb: boolean }[] {
  if (!Number.isFinite(trackPx) || trackPx <= 0) return [];
  const thumb = debtShare(side, Math.min(max, Math.max(min, leverage)));
  return splitTicks(side, min, max, Math.max(0.025, SPLIT_TICK_MIN_GAP_PX / trackPx)).map((tick) => ({
    ...tick,
    nearThumb: Math.abs(tick.share - thumb) * trackPx < thumbRadiusPx + SPLIT_TICK_THUMB_CLEARANCE_PX,
  }));
}

/** What the debt is: a long mints fxUSD against its collateral; a short borrows the market's asset. */
export function leverageDebtLabel(side: LeverageSide, market: 'ETH' | 'BTC'): string {
  return side === 'long' ? 'minted fxUSD' : `borrowed ${market === 'ETH' ? 'wstETH' : 'WBTC'}`;
}
