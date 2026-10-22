import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  borrowCapacity,
  borrowMaximumPreset,
  borrowDebtBounds,
  collateralUsdWad,
  loanToValueBps,
  tokenAmountForUsdWad,
  usdPriceWad,
  withdrawableCollateralUsd,
} from '../src/lib/fx/borrowLimits';
import { fallbackDebtRatioRange } from '../src/lib/fx/leverage';

const ETH_LONG = fallbackDebtRatioRange('ETH', 'long'); // 2.56% .. 85.5%
/** An 18-decimal amount: fxUSD, or USD for collateral values. */
const wad = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
};

test('Borrow Max presets floor to six decimals without hiding dust or crossing the minimum', () => {
  assert.equal(borrowMaximumPreset(wad('1992.600237723795'), wad('1')), wad('1992.600237'));
  assert.equal(borrowMaximumPreset(wad('1005.48'), wad('31.3344')), wad('1005.48'));
  assert.equal(borrowMaximumPreset(1n, 0n), 1n);
  assert.equal(borrowMaximumPreset(999999999999n, 0n), 999999999999n);
  assert.equal(borrowMaximumPreset(wad('1.0000009'), wad('1.0000001')), wad('1.0000009'));
  assert.equal(borrowMaximumPreset(0n, 0n), 0n);
});

test('the reported case: 1 fxUSD against $0.88 of ETH is over the limit', () => {
  const { maxAdditional, minAdditional } = borrowCapacity({ collateralUsd: wad('0.88'), existingDebt: 0n, range: ETH_LONG });
  // 0.88 × 85.5% × 98% ≈ 0.7373 fxUSD
  assert.ok(maxAdditional < wad('1'));
  assert.ok(maxAdditional > wad('0.737') && maxAdditional < wad('0.738'));
  // 0.88 × 2.56% × 102% ≈ 0.02298 fxUSD
  assert.ok(minAdditional > wad('0.0229') && minAdditional < wad('0.0230'));
});

test('dust collateral worth a fraction of a cent still has a limit', () => {
  // The Telegram report: 0.000000393739962 ETH at $2,712.11 is about $0.00106786.
  const value = collateralUsdWad(393_739_962_000n, 18, 2712.11);
  assert.ok(value !== null && value > wad('0.001067') && value < wad('0.001068'));
  const { maxAdditional } = borrowCapacity({ collateralUsd: value!, existingDebt: 0n, range: ETH_LONG });
  // 0.00106786 × 85.5% × 98% ≈ 0.000895 fxUSD
  assert.ok(maxAdditional > wad('0.000894') && maxAdditional < wad('0.000896'));
});

test('limits scale with collateral and leave room for the SDK window', () => {
  const { maxDebt, minDebt } = borrowDebtBounds(wad('10000'), ETH_LONG);
  assert.equal(maxDebt, wad('8379')); // 10,000 × 0.855 × 0.98
  assert.equal(minDebt, wad('261.12')); // 10,000 × 0.0256 × 1.02
  assert.deepEqual(borrowDebtBounds(0n, ETH_LONG), { minDebt: 0n, maxDebt: 0n });
});

test('existing debt uses up capacity, never below zero', () => {
  const full = borrowCapacity({ collateralUsd: wad('10000'), existingDebt: wad('8379'), range: ETH_LONG });
  assert.equal(full.maxAdditional, 0n);
  assert.equal(full.minAdditional, 0n);
  const over = borrowCapacity({ collateralUsd: wad('10000'), existingDebt: wad('9000'), range: ETH_LONG });
  assert.equal(over.maxAdditional, 0n);
  const partial = borrowCapacity({ collateralUsd: wad('10000'), existingDebt: wad('5000'), range: ETH_LONG });
  assert.equal(partial.maxAdditional, wad('3379'));
});

test('withdrawals keep the remaining debt inside the range', () => {
  // $10,000 collateral, 5,000 fxUSD debt: needs 5,000 / (0.855 × 0.98) ≈ $5,967.3 of collateral.
  const withdrawable = withdrawableCollateralUsd(wad('10000'), wad('5000'), ETH_LONG);
  assert.ok(withdrawable > wad('4032') && withdrawable < wad('4033'));
  assert.equal(withdrawableCollateralUsd(wad('10000'), 0n, ETH_LONG), wad('10000'));
  assert.equal(withdrawableCollateralUsd(wad('10000'), wad('9000'), ETH_LONG), 0n);
});

test('loan-to-value is reported in basis points', () => {
  assert.equal(loanToValueBps(wad('5000'), wad('10000')), 5000n);
  assert.equal(loanToValueBps(wad('1'), wad('0.88')), 11363n);
  assert.equal(loanToValueBps(wad('1'), 0n), null);
});

test('prices convert between token amounts and USD without losing sub-cent value', () => {
  assert.equal(usdPriceWad(2712.11), wad('2712.11'));
  assert.equal(usdPriceWad(undefined), null);
  assert.equal(usdPriceWad(0), null);
  assert.equal(usdPriceWad(Number.NaN), null);
  assert.equal(collateralUsdWad(10n ** 18n, 18, 2712.11), wad('2712.11'));
  assert.equal(collateralUsdWad(10n ** 8n, 8, 104_000), wad('104000'));
  assert.equal(collateralUsdWad(10n ** 18n, 18, undefined), null);
  // Half a dollar of ETH at $2,000 is 0.00025 ETH.
  assert.equal(tokenAmountForUsdWad(wad('0.5'), 18, 2000), 250_000_000_000_000n);
  assert.equal(tokenAmountForUsdWad(wad('0.5'), 18, undefined), null);
});
