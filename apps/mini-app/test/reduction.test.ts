import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateSdkReductionAmountWei,
  getSdkReductionAmountWei,
  positionInputTokenOptions,
  positionOutputTokenOptions,
  positionTokenDecimals,
} from '../src/app/trade/fxUi';

const WAD = 10n ** 18n;

test('position token choices match the SDK input and output allow-lists', () => {
  assert.ok(positionInputTokenOptions('ETH').includes('stETH'));
  assert.ok(!positionInputTokenOptions('ETH', 'short').includes('stETH'));
  assert.deepEqual(positionInputTokenOptions('BTC', 'long'), positionInputTokenOptions('BTC', 'short'));
  assert.ok(positionOutputTokenOptions('ETH', 'long').includes('stETH'));
  assert.ok(!positionOutputTokenOptions('ETH', 'short').includes('stETH'));
  assert.deepEqual(positionOutputTokenOptions('BTC', 'long'), positionOutputTokenOptions('BTC', 'short'));
});

test('position display precision preserves the pool accounting units returned by the SDK', () => {
  const btcLong = {
    market: 'BTC',
    side: 'long',
    info: {
      positionId: 7,
      rawColls: 123456789n,
      rawDebts: 2n * WAD,
      currentLeverage: 2,
      lsdLeverage: 2,
      rawCollsToken: 'WBTC',
      rawDebtsToken: 'fxUSD',
      // Position contracts use WAD-scaled accounting units, even though WBTC
      // wallet inputs use the token's native 8-decimal precision.
      rawCollsDecimals: 18,
      rawDebtsDecimals: 18,
    },
  } as const;
  assert.equal(positionTokenDecimals(btcLong, 'collateral'), 18);
  assert.equal(positionTokenDecimals(btcLong, 'debt'), 18);
});

test('long reduction uses raw collateral units', () => {
  assert.equal(calculateSdkReductionAmountWei({
    market: 'ETH',
    side: 'long',
    rawCollateralWei: 4n * WAD,
    rawDebtWei: 2n * WAD,
    fractionBps: 2500,
  }), WAD);
});

test('BTC short reduction uses raw debt units', () => {
  assert.equal(calculateSdkReductionAmountWei({
    market: 'BTC',
    side: 'short',
    rawCollateralWei: WAD,
    rawDebtWei: 4n * WAD,
    fractionBps: 2500,
  }), WAD);
});

test('ETH short reduction converts debt using the live wstETH rate', async () => {
  const rate = 11n * (WAD / 10n);
  const client = {
    chain: { id: 1 },
    getChainId: async () => 1,
    readContract: async () => rate,
  } as never;
  assert.equal(await getSdkReductionAmountWei({
    client,
    market: 'ETH',
    side: 'short',
    rawCollateralWei: WAD,
    rawDebtWei: 2n * WAD,
    fractionBps: 2500,
  }), 550000000000000000n);
});

test('full close uses the SDK positive sentinel for every position type', () => {
  assert.equal(calculateSdkReductionAmountWei({
    market: 'ETH',
    side: 'long',
    rawCollateralWei: WAD,
    rawDebtWei: WAD,
    fractionBps: 10000,
  }), 1n);
  assert.equal(calculateSdkReductionAmountWei({
    market: 'ETH',
    side: 'short',
    rawCollateralWei: WAD,
    rawDebtWei: WAD,
    fractionBps: 10000,
  }), 1n);
});

test('reduction conversion rejects invalid fractions and missing ETH short rate', () => {
  assert.throws(() => calculateSdkReductionAmountWei({
    market: 'ETH',
    side: 'long',
    rawCollateralWei: WAD,
    rawDebtWei: WAD,
    fractionBps: 0,
  }), /fraction/);
  assert.throws(() => calculateSdkReductionAmountWei({
    market: 'ETH',
    side: 'short',
    rawCollateralWei: WAD,
    rawDebtWei: WAD,
    fractionBps: 2500,
  }), /rate/);
  assert.throws(() => calculateSdkReductionAmountWei({
    market: 'ETH',
    side: 'short',
    rawCollateralWei: 0n,
    rawDebtWei: WAD,
    fractionBps: 2500,
    wstEthRateWei: WAD,
  }), /collateral/);
});
