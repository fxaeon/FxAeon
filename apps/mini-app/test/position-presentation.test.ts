import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatUnits } from 'viem';
import type { UiPosition } from '../src/app/trade/fxUi';
import { positionDisplayLeverage, positionTargetLeverage, positionTokenDecimals, tokenDecimals } from '../src/app/trade/fxUi';
import { positionLeveragePresentation, positionTokenPresentation } from '../src/lib/positionPresentation';
import { calculatePositionUsdPresentation, calculatePositionUsdValuation, debtCollateralRatioPercent } from '../src/lib/positionValuation';

const WAD = 10n ** 18n;
const symbols = { ETH: { long: ['ETH', 'fxUSD'], short: ['fxUSD', 'wstETH'] }, BTC: { long: ['WBTC', 'fxUSD'], short: ['fxUSD', 'WBTC'] } } as const;
function position(market: 'ETH' | 'BTC', side: 'long' | 'short', rawColls: bigint, rawDebts: bigint, metric: number): UiPosition {
  const [rawCollsToken, rawDebtsToken] = symbols[market][side];
  return { market, side, info: { positionId: 42, rawColls, rawDebts, rawCollsToken, rawDebtsToken, rawCollsDecimals: 18, rawDebtsDecimals: 18, currentLeverage: side === 'long' ? metric : 9, lsdLeverage: side === 'short' ? metric : 8 } };
}

for (const market of ['ETH', 'BTC'] as const) for (const side of ['long', 'short'] as const) {
  test(`${market} ${side}: completed sentinel, boundaries, valid, empty, debt-free and malformed states stay render-only`, () => {
    const threshold = market === 'ETH' ? 5n * 10n ** 14n : 5n * 10n ** 12n;
    for (const raw of [1n, 10n ** 12n, threshold - 1n, threshold, threshold + 1n, WAD]) {
      for (const metric of [0, -1, NaN, Infinity]) {
        const input = position(market, side, raw, 1n, metric);
        const before = structuredClone(input);
        const targetBefore = positionTargetLeverage(input);
        const displayBefore = positionDisplayLeverage(input);
        const result = positionLeveragePresentation(input);
        assert.equal(result.state, 'unavailable');
        assert.equal(result.text, 'Leverage unavailable');
        assert.match(result.explanation, /cannot be provided for this position/);
        assert.deepEqual(input, before);
        assert.equal(positionTargetLeverage(input), targetBefore);
        assert.deepEqual(positionDisplayLeverage(input), displayBefore);
      }
      assert.equal(positionLeveragePresentation(position(market, side, raw, 1n, 2.25)).text, '2.25×');
      assert.equal(positionLeveragePresentation(position(market, side, raw, 0n, 0)).state, 'debt-free');
    }
    assert.equal(positionLeveragePresentation(position(market, side, 0n, 0n, 0)).state, 'empty');
    for (const [collateral, debt] of [[-1n, 1n], [1n, -1n], [0n, 1n]]) {
      const result = positionLeveragePresentation(position(market, side, collateral, debt, 2));
      assert.equal(result.state, 'unavailable');
      assert.match(result.explanation, /accounting is invalid/);
    }
    assert.equal(positionLeveragePresentation(position(market, side, 1n, 1n, 0.001)).text, '<0.01×');
  });
}

test('position quantities retain exact units and never make positive raw values look zero', () => {
  for (const decimals of [0, 6, 8, 18, 255]) for (const raw of [0n, 1n, 999999999n, 1000000000n, 1000000001n, 10n ** 12n, 10n ** 15n, 5n * 10n ** 14n - 1n, 5n * 10n ** 14n, 5n * 10n ** 14n + 1n, WAD, 10n ** 80n + 1n]) {
    for (const compact of [false, true]) {
      const rendered = positionTokenPresentation(raw, decimals, compact);
      assert.equal(rendered.exact, formatUnits(raw, decimals));
      if (raw > 0n) assert.notEqual(rendered.text, '0');
      else assert.equal(rendered.text, '0');
    }
  }
  assert.equal(positionTokenPresentation(10n ** 12n, 18, true).text, '0.000001');
  assert.equal(positionTokenPresentation(10n ** 15n, 18, true).text, '0.001');
  assert.deepEqual(positionTokenPresentation(1n, 18, true), { text: '<0.00000001', exact: '0.000000000000000001' });
  assert.deepEqual(positionTokenPresentation(123456789n, 9, true), { text: '≈ 0.12345678', exact: '0.123456789' });
  assert.equal(positionTokenPresentation(-1n, 18).exact, null);
  for (const decimals of [-1, 1.5, NaN, 256]) assert.equal(positionTokenPresentation(1n, decimals).text, 'Unavailable');
  assert.equal(positionTokenDecimals(position('BTC', 'long', 1n, 1n, 2), 'collateral'), 18);
  assert.equal(tokenDecimals('WBTC'), 8);
});

test('signed sub-cent USD labels require exact rational proof; cents remain byte-for-byte comparable', () => {
  for (const collateralPrice of [0.0001, 0.0049, 0.005, 0.0099, 0.01, 1, 1e-20, 1e25]) for (const debtPrice of [0.0001, 0.005, 0.01, 1]) {
    const input = { collateralRaw: WAD, collateralDecimals: 18, collateralPrice, debtRaw: WAD, debtDecimals: 18, debtPrice };
    const before = structuredClone(input);
    const base = calculatePositionUsdValuation(input);
    const shown = calculatePositionUsdPresentation(input);
    const { collateralUsdCents, debtUsdCents, netEquityUsdCents } = shown;
    assert.deepEqual({ collateralUsdCents, debtUsdCents, netEquityUsdCents }, base);
    assert.deepEqual(input, before);
  }
  const input = { collateralRaw: 1n, collateralDecimals: 18, collateralPrice: 1, debtRaw: 2n, debtDecimals: 18, debtPrice: 1 };
  assert.equal(calculatePositionUsdPresentation(input).netEquityUsdText, 'Negative <$0.01');
  assert.equal(calculatePositionUsdPresentation({ ...input, collateralRaw: 3n }).netEquityUsdText, '<$0.01');
  assert.equal(calculatePositionUsdPresentation({ ...input, collateralRaw: 2n }).netEquityUsdText, '$0.00');
  assert.equal(calculatePositionUsdPresentation({ ...input, collateralPrice: undefined }).netEquityUsdText, null);
  assert.equal(calculatePositionUsdPresentation({ ...input, collateralPrice: NaN }).collateralUsdText, null);
  assert.equal(calculatePositionUsdPresentation({ ...input, collateralRaw: -1n }).netEquityUsdText, null);
  assert.equal(calculatePositionUsdPresentation({ ...input, collateralRaw: 0n, collateralPrice: undefined }).collateralUsdText, '$0.00');
  const subcent = { collateralRaw: 10n ** 12n, collateralDecimals: 18, collateralPrice: 2400, debtRaw: 10n ** 15n, debtDecimals: 18, debtPrice: 1 };
  assert.deepEqual(calculatePositionUsdValuation(subcent), { collateralUsdCents: 0n, debtUsdCents: 0n, netEquityUsdCents: 0n });
  assert.equal(debtCollateralRatioPercent(subcent), '≈ 41.67%');
  assert.equal(calculatePositionUsdPresentation(subcent).netEquityUsdText, '<$0.01');
});
