import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEBT_RATIO_PRECISION,
  FX_LIQUIDATION_DOCS_URL,
  FX_REBALANCING_DOCS_URL,
  brakeThresholdText,
  checkBasisDebtRatio,
  formatWholeUsd,
  isUsableBrakeReading,
  liveDebtRatio,
  marketMoveToThreshold,
  poolThresholdPrice,
  positionBrakeCopy,
  positionBrakeView,
  thresholdPrice,
  type BrakeReading,
} from '../src/lib/positionBrake';

/** Copy keeps "≈" with its figure through a no-break space. */
const nb = (text: string): string => text.replaceAll('≈ ', '≈\u00a0');

const ratio = (value: string): bigint => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * DEBT_RATIO_PRECISION + BigInt(fraction.padEnd(18, '0'));
};

// Live pool thresholds read on 9 October 2026 (block 26,149,707). The tests
// use them as fixtures only; the app reads them from each pool every time.
const LONG_THRESHOLDS = { rebalanceRatio: ratio('0.88'), liquidateRatio: ratio('0.95') };
const SHORT_THRESHOLDS = { rebalanceRatio: ratio('0.9'), liquidateRatio: ratio('0.95') };

const long = (debtRatio: string, priceAtRead: number | null = null): BrakeReading => ({ side: 'long', debtRatio: ratio(debtRatio), ...LONG_THRESHOLDS, priceAtRead });
const short = (debtRatio: string, priceAtRead: number | null = null): BrakeReading => ({ side: 'short', debtRatio: ratio(debtRatio), ...SHORT_THRESHOLDS, priceAtRead });

test('the anchor-priced ratio is rescaled to the minimum price the pool checks, rounded up', () => {
  assert.equal(checkBasisDebtRatio(ratio('0.5'), 2_000n, 2_000n), ratio('0.5'));
  // 3 × 10 / 7 = 4.29 rounds up to 5: the stricter ratio, never the looser one.
  assert.equal(checkBasisDebtRatio(3n, 10n, 7n), 5n);
  // A minimum above the anchor would lower the ratio; keep the anchor-priced one.
  assert.equal(checkBasisDebtRatio(ratio('0.5'), 1_000n, 1_100n), ratio('0.5'));
  assert.equal(checkBasisDebtRatio(0n, 1n, 1n), 0n);
  // BTC short #109 at block 26,149,707: anchor 12291813038747, min 12265132097866.
  const anchorRatio = 763_235_966_667_704_764n;
  const scaled = checkBasisDebtRatio(anchorRatio, 12_291_813_038_747n, 12_265_132_097_866n);
  assert.equal(scaled, (anchorRatio * 12_291_813_038_747n + 12_265_132_097_866n - 1n) / 12_265_132_097_866n);
  assert.ok(scaled > anchorRatio && scaled < anchorRatio + ratio('0.002'));
  assert.throws(() => checkBasisDebtRatio(-1n, 1n, 1n), RangeError);
  assert.throws(() => checkBasisDebtRatio(1n, 0n, 1n), RangeError);
  assert.throws(() => checkBasisDebtRatio(1n, 1n, 0n), RangeError);
});

test('a long reaches the brake after a fall of 1 − r/R and a short after a rise of R/r − 1', () => {
  assert.ok(Math.abs(marketMoveToThreshold('long', 0.66, 0.88) - 0.25) < 1e-12);
  assert.ok(Math.abs(marketMoveToThreshold('short', 0.75, 0.9) - 0.2) < 1e-12);
  assert.ok(Math.abs(thresholdPrice('long', 2_400, 0.66, 0.88) - 1_800) < 1e-9);
  assert.ok(Math.abs(thresholdPrice('short', 2_400, 0.75, 0.9) - 2_880) < 1e-9);
  // Liquidation uses the same formulas with L.
  assert.ok(Math.abs(marketMoveToThreshold('long', 0.66, 0.95) - (1 - 0.66 / 0.95)) < 1e-12);
  assert.ok(Math.abs(marketMoveToThreshold('short', 0.75, 0.95) - (0.95 / 0.75 - 1)) < 1e-12);
  // A long's ratio moves as 1 / price, a short's with price.
  assert.ok(Math.abs(liveDebtRatio('long', 0.66, 2_400, 2_200) - 0.72) < 1e-12);
  assert.ok(Math.abs(liveDebtRatio('short', 0.75, 2_400, 2_500) - 0.78125) < 1e-12);
});

test('a long position shows its distance, price, fill and both thresholds', () => {
  const view = positionBrakeView(long('0.66', 2_400), 2_400)!;
  assert.equal(view.state, 'clear');
  assert.equal(view.rebalanceMovePercent, 25);
  assert.equal(view.rebalancePrice, 1_800, 'an exact result is not pushed a dollar by binary noise');
  assert.equal(view.liquidateMovePercent, 30); // 1 − 0.66 / 0.95 = 30.5%
  assert.equal(view.liquidatePrice, 1_668); // 2400 × 0.66 / 0.95 = 1667.37, rounded toward today's price
  assert.ok(Math.abs(view.fill - 0.66) < 1e-12);
  assert.equal(view.rebalanceAt, 0.88);
  assert.equal(view.liquidateAt, 0.95);
  assert.deepEqual(positionBrakeCopy(view, 'ETH', 'long'), {
    tone: 'neutral',
    line: nb('Rebalances if ETH falls ≈ 25% (≈ $1,800)'),
    liquidation: nb('If rebalancing can’t keep up, liquidation becomes possible once ETH falls ≈ 30% (≈ $1,668).'),
    docsUrl: FX_REBALANCING_DOCS_URL,
    docsLabel: 'How rebalancing works',
  });
});

test('a short position shows the rise that reaches its brake', () => {
  const view = positionBrakeView(short('0.75', 2_400), 2_400)!;
  assert.equal(view.state, 'clear');
  assert.equal(view.rebalanceMovePercent, 20);
  assert.equal(view.rebalancePrice, 2_880);
  assert.equal(view.liquidateMovePercent, 26); // 0.95 / 0.75 − 1 = 26.7%
  assert.equal(view.liquidatePrice, 3_040);
  assert.equal(positionBrakeCopy(view, 'ETH', 'short').line, nb('Rebalances if ETH rises ≈ 20% (≈ $2,880)'));
  const btc = positionBrakeView({ ...short('0.7632'), priceAtRead: 81_354.96 }, 81_354.96)!;
  // 81354.96 × 0.9 / 0.7632 = 95,937.45: a short's price rounds down, toward today's.
  assert.equal(btc.rebalancePrice, 95_937);
  assert.equal(positionBrakeCopy(btc, 'BTC', 'short').line, nb('Rebalances if BTC rises ≈ 17% (≈ $95,937)'));
});

test('the pool’s own threshold price is D / (C × R) for a long and C × R / D for a short, per stETH or WBTC', () => {
  // Positions at block 26,149,707; unrounded values from 50-digit decimal arithmetic.
  const ethLong = { market: 'ETH', side: 'long', rawColls: ratio('9.176999662367526796'), rawDebts: ratio('12712.585067464289054913') } as const;
  assert.equal(poolThresholdPrice({ ...ethLong, ratio: ratio('0.88') }), 1_575); // 1,574.17, rounded up toward today's price
  assert.equal(poolThresholdPrice({ ...ethLong, ratio: ratio('0.95') }), 1_459); // 1,458.17
  const btcLong = { market: 'BTC', side: 'long', rawColls: ratio('0.264897488525629655'), rawDebts: ratio('14479.429472333263444561') } as const;
  assert.equal(poolThresholdPrice({ ...btcLong, ratio: ratio('0.88') }), 62_115); // 62,114.21
  assert.equal(poolThresholdPrice({ ...btcLong, ratio: ratio('0.95') }), 57_538); // 57,537.37
  const btcShort = { market: 'BTC', side: 'short', rawColls: ratio('66118.199903649059291307'), rawDebts: ratio('0.62029145') } as const;
  assert.equal(poolThresholdPrice({ ...btcShort, ratio: ratio('0.9') }), 95_932); // 95,932.94, rounded down
  assert.equal(poolThresholdPrice({ ...btcShort, ratio: ratio('0.95') }), 101_262); // 101,262.54
  // An ETH short owes wstETH: per stETH it needs the wrapping rate.
  const ethShort = { market: 'ETH', side: 'short', rawColls: ratio('1295.590438343481988696'), rawDebts: ratio('0.259847242455099248') } as const;
  assert.equal(poolThresholdPrice({ ...ethShort, ratio: ratio('0.9') }), null);
  assert.equal(poolThresholdPrice({ ...ethShort, ratio: ratio('0.9'), stEthPerWstEth: ratio('1.24586') }), 3_601); // 3,601.83
  assert.equal(poolThresholdPrice({ ...ethShort, ratio: ratio('0.95'), stEthPerWstEth: ratio('1.24586') }), 3_801); // 3,801.93
  for (const empty of [{ rawColls: 0n }, { rawDebts: 0n }, { ratio: 0n }]) assert.equal(poolThresholdPrice({ ...ethLong, ratio: ratio('0.88'), ...empty }), null);
});

test('without a quote at the read, a card names the pool’s price per stETH or WBTC instead of a dash', () => {
  const reading = { ...long('0.66'), poolPrices: { rebalance: 1_575, liquidate: 1_459 } };
  const view = positionBrakeView(reading, null)!;
  assert.equal(view.rebalancePrice, null);
  assert.equal(view.rebalancePoolPrice, 1_575);
  assert.equal(view.liquidatePoolPrice, 1_459);
  assert.equal(brakeThresholdText(view, 'rebalance', 'ETH'), nb('≈ $1,575 / stETH'));
  assert.equal(brakeThresholdText(view, 'liquidation', 'BTC'), nb('≈ $1,459 / WBTC'));
  // The line still keeps the read's distance and names no price.
  assert.equal(positionBrakeCopy(view, 'ETH', 'long').line, nb('Rebalances if ETH falls ≈ 25%'));
  // A quote taken at the read prices it on the market's basis, as before.
  const quoted = positionBrakeView({ ...reading, priceAtRead: 2_400 }, 2_400)!;
  assert.equal(brakeThresholdText(quoted, 'rebalance', 'ETH'), nb('≈ $1,800'));
  // Reached thresholds, unknown or unusable pool prices name nothing.
  const reached = positionBrakeView({ ...long('0.9'), poolPrices: { rebalance: 1_575, liquidate: 1_459 } }, null)!;
  assert.equal(reached.rebalancePoolPrice, null);
  assert.equal(brakeThresholdText(reached, 'rebalance', 'ETH'), null);
  assert.equal(brakeThresholdText(reached, 'liquidation', 'ETH'), nb('≈ $1,459 / stETH'));
  assert.equal(brakeThresholdText(positionBrakeView(long('0.66'), null)!, 'rebalance', 'ETH'), null);
  assert.equal(positionBrakeView({ ...long('0.66'), poolPrices: { rebalance: Number.NaN, liquidate: -1 } }, null)!.rebalancePoolPrice, null);
});

test('percentages round toward safety, showing the smaller distance', () => {
  // 1 − 0.6714 / 0.88 = 23.70%: shown as 23, never 24.
  assert.equal(positionBrakeView(long('0.6714'), null)!.rebalanceMovePercent, 23);
  // 0.9 / 0.7832 − 1 = 14.91%: shown as 14.
  assert.equal(positionBrakeView(short('0.7832'), null)!.rebalanceMovePercent, 14);
  // Exact whole results are not knocked down a point by binary fractions.
  assert.equal(positionBrakeView(long('0.616'), null)!.rebalanceMovePercent, 30);
  assert.equal(positionBrakeView(short('0.6'), null)!.rebalanceMovePercent, 50);
  // A long's price rounds up, a short's down: both toward today's price.
  assert.equal(positionBrakeView(long('0.6714', 2_444.58), null)!.rebalancePrice, 1_866); // 1865.22
  assert.equal(positionBrakeView(short('0.7832', 2_444.58), null)!.rebalancePrice, 2_809); // 2809.17
});

test('the distance follows the live quote between chain reads', () => {
  const reading = long('0.66', 2_400);
  const fallen = positionBrakeView(reading, 2_200)!;
  // ratio 0.72 at $2,200: 1 − 0.72 / 0.88 = 18.2%, and the brake price stays put.
  assert.equal(fallen.rebalanceMovePercent, 18);
  assert.equal(fallen.rebalancePrice, 1_800);
  assert.ok(Math.abs(fallen.fill - 0.72) < 1e-12);
  const risen = positionBrakeView(reading, 2_600)!;
  assert.equal(risen.rebalanceMovePercent, 30); // 1 − 1800 / 2600 = 30.8%
  assert.ok(risen.fill < 0.66);

  const shortReading = short('0.75', 2_400);
  const shortRisen = positionBrakeView(shortReading, 2_500)!;
  assert.equal(shortRisen.rebalanceMovePercent, 15); // 2880 / 2500 − 1 = 15.2%
  assert.equal(shortRisen.rebalancePrice, 2_880);
  assert.ok(Math.abs(shortRisen.fill - 0.78125) < 1e-12);

  // Without a quote at read time, or without one now, the read-time figure stays.
  assert.equal(positionBrakeView(long('0.66'), 2_200)!.rebalanceMovePercent, 25);
  assert.equal(positionBrakeView(long('0.66'), 2_200)!.rebalancePrice, null);
  assert.equal(positionBrakeView(reading, null)!.rebalanceMovePercent, 25);
  assert.equal(positionBrakeView(reading, null)!.rebalancePrice, 1_800);
  for (const invalid of [Number.NaN, 0, -2_400, Number.POSITIVE_INFINITY]) {
    const view = positionBrakeView({ ...reading, priceAtRead: invalid }, 2_200)!;
    assert.equal(view.rebalanceMovePercent, 25, `${invalid} is not a quote`);
    assert.equal(view.rebalancePrice, null);
    assert.equal(positionBrakeView(reading, invalid)!.rebalanceMovePercent, 25);
  }
});

test('a live move past the threshold reaches the brake before the next chain read', () => {
  const view = positionBrakeView(long('0.66', 2_400), 1_790)!;
  assert.equal(view.state, 'rebalance');
  assert.equal(view.rebalanceMovePercent, null);
  assert.equal(view.rebalancePrice, null);
  assert.ok(view.fill >= 0.88);
  assert.ok(view.liquidateMovePercent !== null && view.liquidateMovePercent > 0);
  assert.equal(positionBrakeView(short('0.75', 2_400), 2_890)!.state, 'rebalance');
  assert.equal(positionBrakeView(short('0.75', 2_400), 3_100)!.state, 'liquidation');
});

test('the rebalance point is reached at the threshold itself, as the pool checks ratio ≥ threshold', () => {
  const at = positionBrakeView(long('0.88'), null)!;
  assert.equal(at.state, 'rebalance');
  assert.ok(at.fill >= 0.88);
  const copy = positionBrakeCopy(at, 'ETH', 'long');
  assert.equal(copy.tone, 'warn');
  assert.equal(copy.line, 'At the rebalance point. The protocol may rebalance part of this position.');
  assert.equal(copy.docsUrl, FX_REBALANCING_DOCS_URL);
  assert.equal(copy.liquidation, nb('If rebalancing can’t keep up, liquidation becomes possible once ETH falls ≈ 7%.'));

  const justBelow = positionBrakeView({ ...long('0.88'), debtRatio: LONG_THRESHOLDS.rebalanceRatio - 1n }, null)!;
  assert.equal(justBelow.state, 'clear');
  assert.equal(justBelow.rebalanceMovePercent, 0);
  assert.equal(positionBrakeCopy(justBelow, 'ETH', 'long').line, 'Rebalances if ETH falls less than 1%');

  // A favourable move since the read does not clear a threshold the chain reported.
  const recovered = positionBrakeView(long('0.9', 2_000), 2_200)!;
  assert.equal(recovered.state, 'rebalance');
  assert.ok(recovered.fill >= 0.88);
});

test('at or past liquidation the card says so and offers no distance', () => {
  for (const reading of [long('0.95'), long('1.2'), short('0.97')]) {
    const view = positionBrakeView(reading, null)!;
    assert.equal(view.state, 'liquidation');
    assert.equal(view.rebalanceMovePercent, null);
    assert.equal(view.liquidateMovePercent, null);
    assert.ok(view.fill >= 0.95 && view.fill <= 1);
    const copy = positionBrakeCopy(view, 'BTC', reading.side);
    assert.deepEqual(copy, {
      tone: 'warn',
      line: 'At the liquidation point. The protocol may liquidate this position.',
      liquidation: null,
      docsUrl: FX_LIQUIDATION_DOCS_URL,
      docsLabel: 'How liquidation works',
    });
  }
});

test('unusable readings draw nothing rather than a zero or a made-up threshold', () => {
  assert.equal(positionBrakeView(long('0'), 2_400), null, 'zero debt has no brake');
  assert.equal(positionBrakeView({ ...long('0.5'), rebalanceRatio: 0n }, null), null);
  assert.equal(positionBrakeView({ ...long('0.5'), liquidateRatio: LONG_THRESHOLDS.rebalanceRatio }, null), null);
  assert.equal(isUsableBrakeReading({ ...long('0.5'), liquidateRatio: ratio('0.8') }), false);
  assert.equal(isUsableBrakeReading(long('0.5')), true);
});

test('the bar keeps its fill in range and drops markers that fall beyond it', () => {
  const tiny = positionBrakeView(long('0.0001'), null)!;
  assert.ok(tiny.fill > 0 && tiny.fill < 0.001);
  assert.equal(tiny.rebalanceMovePercent, 99);
  const wide = positionBrakeView({ side: 'long', debtRatio: ratio('0.5'), rebalanceRatio: ratio('0.9'), liquidateRatio: ratio('1.05'), priceAtRead: null }, null)!;
  assert.equal(wide.rebalanceAt, 0.9);
  assert.equal(wide.liquidateAt, null);
  const crashed = positionBrakeView(long('0.5', 2_000), 100)!;
  assert.equal(crashed.fill, 1);
  // A deep short far from its brake keeps a grouped, finite figure.
  assert.equal(positionBrakeCopy(positionBrakeView(short('0.009'), null)!, 'ETH', 'short').line, nb('Rebalances if ETH rises ≈ 9,900%'));
  // "≈" never ends a line apart from its figure.
  assert.doesNotMatch(positionBrakeCopy(positionBrakeView(long('0.66', 2_400), 2_400)!, 'ETH', 'long').line, /≈ /);
});

test('copy never presents a zero distance', () => {
  const lines = ['0.879999', '0.8', '0.5', '0.1'].flatMap((value) => [
    positionBrakeCopy(positionBrakeView(long(value, 2_444.58), 2_444.58)!, 'ETH', 'long').line,
    positionBrakeCopy(positionBrakeView(short(value, 81_354.96), 81_354.96)!, 'BTC', 'short').line,
  ]);
  for (const line of lines) assert.doesNotMatch(line, /(?:^|[^\d,])0%/);
  assert.equal(formatWholeUsd(93_561), '$93,561');
});
