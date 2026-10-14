import assert from 'node:assert/strict';
import { test } from 'node:test';
import { debtShare, leverageAtShare, leverageDebtLabel, leverageForShare, SPLIT_TICK_MIN_GAP_PX, SPLIT_TICK_THUMB_CLEARANCE_PX, splitPercents, splitTicks, splitTicksOnTrack, stepLeverage, wholeLeverageTicks } from '../src/lib/leverageShare';
import { leverageTrackPosition, leverageAtTrackPosition, leverageTicksOnTrack } from '../src/lib/leverageShare';

const BOUNDS = { long: { min: 1.1, max: 6.1 }, short: { min: 0.1, max: 6 } } as const;
const tenthsBetween = (min: number, max: number) => Array.from({ length: Math.round((max - min) * 10) + 1 }, (_, index) => Number((min + index / 10).toFixed(1)));

test('slider leverage scale spans the live bounds independently of its debt share', () => {
  assert.equal(leverageTrackPosition(2, 1.1, 6.1), 0.18);
  assert.equal(leverageTrackPosition(1.1, 1.1, 6.1), 0);
  assert.equal(leverageTrackPosition(6.1, 1.1, 6.1), 1);
  for (const { min, max } of Object.values(BOUNDS)) {
    for (const leverage of tenthsBetween(min, max)) assert.equal(leverageAtTrackPosition(leverageTrackPosition(leverage, min, max), min, max), leverage);
    assert.equal(leverageAtTrackPosition(-1, min, max), min);
    assert.equal(leverageAtTrackPosition(2, min, max), max);
    const ticks = leverageTicksOnTrack(min, max, 2, 400, 13);
    for (const tick of ticks) assert.equal(tick.share, leverageTrackPosition(tick.leverage, min, max));
  }
});

test('a long is debt over collateral, (L − 1) / L', () => {
  assert.equal(debtShare('long', 1), 0);
  assert.equal(debtShare('long', 2), 1 / 2);
  assert.equal(debtShare('long', 3), 2 / 3);
  assert.equal(debtShare('long', 4), 3 / 4);
});

test('a short is borrowed exposure over collateral, L / (L + 1)', () => {
  assert.equal(debtShare('short', 1), 1 / 2);
  assert.equal(debtShare('short', 2), 2 / 3);
  assert.equal(debtShare('short', 3), 3 / 4);
});

test('leverage that cannot describe a position has no debt share', () => {
  for (const leverage of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(debtShare('long', leverage), 0);
    assert.equal(debtShare('short', leverage), 0);
  }
  // A long below 1× would be negative debt; it reads as none.
  assert.equal(debtShare('long', 0.5), 0);
});

test('the two shares are whole percentages that always total 100', () => {
  for (const side of ['long', 'short'] as const) {
    for (let tenths = 1; tenths <= 200; tenths++) {
      const { debt, yours } = splitPercents(side, tenths / 10);
      assert.ok(Number.isInteger(debt) && Number.isInteger(yours));
      assert.equal(debt + yours, 100, `${side} ${tenths / 10}×`);
      assert.ok(debt >= 0 && yours >= 0);
    }
  }
  assert.deepEqual(splitPercents('long', 3), { debt: 67, yours: 33 });
  assert.deepEqual(splitPercents('short', 3), { debt: 75, yours: 25 });
  assert.deepEqual(splitPercents('long', 1.1), { debt: 9, yours: 91 });
});

test('the debt is named by direction and market', () => {
  assert.equal(leverageDebtLabel('long', 'ETH'), 'minted fxUSD');
  assert.equal(leverageDebtLabel('long', 'BTC'), 'minted fxUSD');
  assert.equal(leverageDebtLabel('short', 'ETH'), 'borrowed wstETH');
  assert.equal(leverageDebtLabel('short', 'BTC'), 'borrowed WBTC');
});

test('a debt share reads back as the leverage that drew it', () => {
  for (const side of ['long', 'short'] as const) {
    for (const leverage of [0.1, 0.5, 1.1, 2, 2.8, 3, 4.5, 6.1, 12]) {
      if (side === 'long' && leverage < 1) continue;
      assert.ok(Math.abs(leverageForShare(side, debtShare(side, leverage)) - leverage) < 1e-9, `${side} ${leverage}×`);
    }
  }
  // No debt is 1× for a long and 0× for a short; all debt is unbounded leverage.
  assert.equal(leverageForShare('long', 0), 1);
  assert.equal(leverageForShare('short', 0), 0);
  assert.equal(leverageForShare('long', 1), Number.POSITIVE_INFINITY);
  assert.equal(leverageForShare('short', 1.2), Number.POSITIVE_INFINITY);
  assert.equal(leverageForShare('long', Number.NaN), 1);
});

test('the slider picks the 0.1× step drawn nearest the pointer, never outside the live range', () => {
  for (const side of ['long', 'short'] as const) {
    const { min, max } = BOUNDS[side];
    const steps = tenthsBetween(min, max);
    // Every selectable step is reachable exactly where the track draws it.
    for (const leverage of steps) assert.equal(leverageAtShare(side, debtShare(side, leverage), min, max), leverage, `${side} ${leverage}×`);
    // Between two steps the nearer drawn boundary wins, measured in share, not in ×.
    for (let index = 1; index < steps.length; index += 1) {
      const [low, high] = [steps[index - 1], steps[index]];
      const [lowShare, highShare] = [debtShare(side, low), debtShare(side, high)];
      assert.equal(leverageAtShare(side, lowShare + (highShare - lowShare) * 0.4, min, max), low);
      assert.equal(leverageAtShare(side, lowShare + (highShare - lowShare) * 0.6, min, max), high);
    }
    // The hatched ends of the track clamp to the bounds.
    for (const share of [-1, 0, 0.01, debtShare(side, min) / 2]) assert.equal(leverageAtShare(side, share, min, max), min);
    for (const share of [debtShare(side, max) + 0.01, 0.99, 1, 2, Number.POSITIVE_INFINITY]) assert.equal(leverageAtShare(side, share, min, max), max);
    // Values are clean tenths, so the field and the review read "2.8×", never "2.8000000000000003×".
    for (let share = 0; share <= 1; share += 0.0125) {
      const leverage = leverageAtShare(side, share, min, max);
      assert.equal(leverage, Number(leverage.toFixed(1)));
    }
  }
});

test('keys move the slider by 0.1× and pages by 1×, on the step grid and inside the bounds', () => {
  const { min, max } = BOUNDS.long;
  assert.equal(stepLeverage(2, 0.1, min, max), 2.1);
  assert.equal(stepLeverage(2, -0.1, min, max), 1.9);
  assert.equal(stepLeverage(2.8, 1, min, max), 3.8);
  assert.equal(stepLeverage(2.8, -1, min, max), 1.8);
  assert.equal(stepLeverage(5.5, 1, min, max), max);
  assert.equal(stepLeverage(1.5, -1, min, max), min);
  // A typed value off the grid or outside the range starts from where the slider shows it.
  assert.equal(stepLeverage(2.86, 0.1, min, max), 3);
  assert.equal(stepLeverage(9, -1, min, max), 5.1);
  assert.equal(stepLeverage(0, 1, min, max), 2.1);
  assert.equal(stepLeverage(Number.NaN, 0.1, min, max), 1.2);
  assert.equal(stepLeverage(0.1, 1, 0.1, 6), 1.1);
});

test('ticks mark the whole leverages inside the live range, where each extra × moves the boundary less', () => {
  assert.deepEqual(wholeLeverageTicks(1.1, 6.1), [2, 3, 4, 5, 6]);
  assert.deepEqual(wholeLeverageTicks(0.1, 6), [1, 2, 3, 4, 5]);
  assert.deepEqual(wholeLeverageTicks(2, 3), []);
  assert.deepEqual(wholeLeverageTicks(Number.NaN, 6), []);
  const gaps = wholeLeverageTicks(1.1, 6.1).map((leverage) => debtShare('long', leverage)).map((share, index, all) => index ? share - all[index - 1] : share);
  for (let index = 2; index < gaps.length; index += 1) assert.ok(gaps[index] < gaps[index - 1]);
});

test('ticks sit at each whole leverage’s debt share and stop before they crowd or touch the range end', () => {
  const leverages = (side: 'long' | 'short', min: number, max: number) => splitTicks(side, min, max).map((tick) => tick.leverage);
  // Today's pool ranges: every whole × is drawn, except 6× at a 6.1× end (under a pixel apart).
  assert.deepEqual(leverages('long', 1.1, 6.1), [2, 3, 4, 5]);
  assert.deepEqual(leverages('short', 0.1, 6), [1, 2, 3, 4, 5]);
  // A much wider range stops where the next tick would sit within 2.5% of the track.
  assert.deepEqual(leverages('long', 1.2, 14.5), [2, 3, 4, 5, 6]);
  for (const side of ['long', 'short'] as const) {
    for (const tick of splitTicks(side, 0.1, 30)) assert.equal(tick.share, debtShare(side, tick.leverage));
  }
  // The range's start is not a whole ×: a first tick that would crowd it is skipped, and the scale carries on.
  assert.deepEqual(leverages('long', 1.95, 6.1), [3, 4, 5]);
});

test('on a measured track, visible ticks keep 14px apart and stay clear of the range ends', () => {
  const ticks = (side: 'long' | 'short', min: number, max: number, width: number) => splitTicksOnTrack(side, min, max, min, width, 13).map((tick) => tick.leverage);
  // The ticket's track at a 320px phone is about 260px, at 390px about 330px.
  assert.deepEqual(ticks('long', 1.1, 6.1, 260), [2, 3, 4]);
  assert.deepEqual(ticks('long', 1.1, 6.1, 330), [2, 3, 4, 5]);
  assert.deepEqual(ticks('short', 0.1, 6, 260), [1, 2, 3]);
  assert.deepEqual(ticks('long', 1.9, 6.1, 260), [3, 4]);
  // An unmeasured track draws none.
  assert.deepEqual(splitTicksOnTrack('long', 1.1, 6.1, 2, 0, 13), []);
  assert.deepEqual(splitTicksOnTrack('long', 1.1, 6.1, 2, Number.NaN, 13), []);
  for (const side of ['long', 'short'] as const) {
    const [min, max] = side === 'long' ? [1.1, 9.5] : [0.1, 9];
    for (let width = 180; width <= 640; width += 7) {
      const drawn = splitTicksOnTrack(side, min, max, min, width, 13).map((tick) => tick.share * width);
      for (let index = 1; index < drawn.length; index += 1) {
        assert.ok(drawn[index] - drawn[index - 1] >= SPLIT_TICK_MIN_GAP_PX, `${side} at ${width}px: ${drawn.join(', ')}`);
      }
      for (const x of drawn) {
        assert.ok(x - debtShare(side, min) * width >= SPLIT_TICK_MIN_GAP_PX && debtShare(side, max) * width - x >= SPLIT_TICK_MIN_GAP_PX / 2, `${side} at ${width}px clears the range ends`);
      }
    }
  }
});

test('a tick within 10px of the thumb’s edge steps aside, and comes back as the thumb moves away', () => {
  const near = (leverage: number, width = 330) => splitTicksOnTrack('long', 1.1, 6.1, leverage, width, 13)
    .filter((tick) => tick.nearThumb).map((tick) => tick.leverage);
  // At 2.9× the thumb's centre is 4px from the 3× tick: it hides, while 2× and 4× (about 50px and 31px away) stay.
  assert.deepEqual(near(2.9), [3]);
  assert.deepEqual(near(2.8), [3]);
  assert.deepEqual(near(2), [2]);
  assert.deepEqual(near(1.5), []);
  // Moving away, the clearance (13px radius + 10px) is measured on the track, not in ×.
  for (const leverage of [2.4, 3.5, 4.5]) {
    for (const tick of splitTicksOnTrack('long', 1.1, 6.1, leverage, 330, 13)) {
      const distance = Math.abs(tick.share - debtShare('long', leverage)) * 330;
      assert.equal(tick.nearThumb, distance < 13 + SPLIT_TICK_THUMB_CLEARANCE_PX, `${tick.leverage}× with the thumb at ${leverage}×`);
    }
  }
  // A typed leverage outside the range puts the thumb at the bound it is drawn at: 6.1× sits 12px from 5×.
  assert.deepEqual(splitTicksOnTrack('long', 1.1, 6.1, 0, 330, 13).filter((tick) => tick.nearThumb), []);
  assert.deepEqual(near(40), [5]);
  assert.deepEqual(near(6.1), [5]);
});
