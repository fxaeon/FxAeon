import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPositionEconomics, normalizePositionEconomics, type PositionEconomics } from '../src/lib/fx/positionEconomics';
import type { PlannedRoute } from '../src/lib/fx/types';

const WAD = 10n ** 18n;
const FEE = 1_000_000_000n;
const usd = (whole: number) => BigInt(whole) * WAD;
const WALLET = '0x1111111111111111111111111111111111111111' as const;
type Options = {
  market?: 'ETH' | 'BTC';
  type?: 'long' | 'short';
  operation?: PositionEconomics['operation'];
  existing?: boolean;
  target?: number;
  inputUsd?: bigint;
  oldCollateralUsd?: bigint;
  oldDebtUsd?: bigint;
  supplyFee?: bigint;
  withdrawFee?: bigint;
  slippage?: number;
  half?: boolean;
};

function fixture(options: Options = {}) {
  const market = options.market ?? 'ETH';
  const type = options.type ?? 'long';
  const operation = options.operation ?? 'increase';
  const existing = options.existing ?? operation !== 'increase';
  const target = options.target ?? (operation === 'adjust-down' ? (type === 'long' ? 2 : 1) : (type === 'long' ? 4 : 3));
  const price = usd(market === 'ETH' ? 2000 : 100000);
  const rate = market === 'ETH' ? WAD * 5n / 4n : WAD;
  const nativeScale = market === 'ETH' ? 1n : 10n ** 10n;
  const inputUsd = operation === 'increase' ? options.inputUsd ?? usd(100) : 0n;
  const c0Usd = existing ? options.oldCollateralUsd ?? usd(300) : 0n;
  const d0Usd = existing ? options.oldDebtUsd ?? usd(200) : 0n;
  const supplyFee = options.supplyFee ?? 1_000_000n;
  const withdrawFee = options.withdrawFee ?? 1_000_000n;
  const slippage = options.slippage ?? 1;
  const s = BigInt(Math.round(slippage * 1e6)) * WAD / 100_000_000n;
  const gross = BigInt(Math.round((target + (type === 'short' ? 1 : 0)) * 1e6)) * WAD / 1_000_000n;
  const expected = operation === 'increase' ? inputUsd * (gross - WAD) / WAD
    : operation === 'adjust-up' ? (c0Usd - d0Usd) * gross / WAD - c0Usd
      : c0Usd - (c0Usd - d0Usd) * gross / WAD;
  const exposure = options.half ? expected / 2n : expected;
  let cUsd: bigint;
  let dUsd: bigint;
  if (operation !== 'adjust-down') {
    cUsd = c0Usd + (inputUsd + exposure * (WAD - s) / WAD * (type === 'long' ? WAD + s : WAD) / WAD) * (FEE - supplyFee) / FEE;
    dUsd = d0Usd + exposure * (type === 'long' ? WAD + s : WAD) / WAD;
  } else {
    const withdrawalPadding = type === 'long' ? 10n ** 10n * rate * price / WAD / WAD : 10n ** 10n;
    cUsd = c0Usd - exposure * (WAD + s) / WAD * FEE / (FEE - withdrawFee) - withdrawalPadding;
    dUsd = d0Usd - exposure * (WAD + s) / WAD * (WAD - s) / WAD;
  }
  const collateral = (value: bigint) => type === 'long' ? value * WAD / price : value;
  const debt = (value: bigint) => type === 'long' ? value : value * WAD * WAD / price / rate;
  const c0 = collateral(c0Usd);
  const d0 = debt(d0Usd);
  const finalC = collateral(cUsd);
  const quoteColls = type === 'long' && operation !== 'adjust-down'
    ? c0 + (finalC - c0) * WAD / rate
    : finalC;
  const snapshot: PositionEconomics = {
    version: 1, operation, priceWad: price.toString(), rateRes: rate.toString(),
    currentColls: c0.toString(), currentDebts: d0.toString(),
    inputCollateral: (type === 'long' ? inputUsd * WAD * WAD / price / rate / nativeScale : inputUsd).toString(),
    supplyFeeRatio: supplyFee.toString(), withdrawFeeRatio: withdrawFee.toString(),
  };
  const route: PlannedRoute = {
    operation: operation === 'increase' ? 'increasePosition' : 'adjustPositionLeverage',
    chainId: 1, walletAddress: WALLET, transactions: [],
    details: { leverage: target, colls: quoteColls.toString(), debts: debt(dUsd).toString(), positionEconomics: snapshot },
  };
  const request = { market, type, positionId: existing ? 7 : 0, leverage: target, slippage };
  return { route, request, snapshot, cUsd, dUsd };
}

for (const market of ['ETH', 'BTC'] as const) {
  for (const type of ['long', 'short'] as const) {
    for (const operation of ['new', 'add', 'adjust-up', 'adjust-down'] as const) {
      test(`${market} ${type} ${operation}: accounting, fees and slippage validate without RPC`, () => {
        const f = fixture({ market, type, operation: operation === 'new' || operation === 'add' ? 'increase' : operation, existing: operation !== 'new' });
        const result = assertPositionEconomics(f.route, f.request);
        const expected = Number(type === 'long' ? f.cUsd : f.dUsd) / Number(f.cUsd - f.dUsd);
        assert.ok(Math.abs(result.effectiveLeverage - expected) < 1e-9);
        assert.ok(BigInt(result.collateralUsd) > BigInt(result.debtUsd));
      });
      test(`${market} ${type} ${operation}: an echoed target cannot hide half the economic exposure`, () => {
        const f = fixture({ market, type, operation: operation === 'new' || operation === 'add' ? 'increase' : operation, existing: operation !== 'new', half: true });
        assert.throws(() => assertPositionEconomics(f.route, f.request), /exposure misses requested target/);
      });
    }
  }
}

test('$0.01 at 1.1x is not a safe minimum: echoed half-borrow fails', () => {
  const f = fixture({ target: 1.1, inputUsd: WAD / 100n, half: true });
  assert.equal(f.route.details!.leverage, 1.1);
  assert.throws(() => assertPositionEconomics(f.route, f.request), /exposure misses requested target/);
});

test('the same $0.01 ETH quote can validate when its actual economic exposure is correct', () => {
  const f = fixture({ target: 1.1, inputUsd: WAD / 100n });
  assert.ok(assertPositionEconomics(f.route, f.request).effectiveLeverage > 1.1);
});

test('one-satoshi BTC target is rejected instead of hiding errors inside rounding tolerance', () => {
  const f = fixture({ market: 'BTC', target: 1.1, inputUsd: WAD / 100n });
  assert.throws(() => assertPositionEconomics(f.route, f.request), /too small to validate/);
});

test('a high-leverage fee/slippage quote is validated in amounts, not with a flat leverage tolerance', () => {
  const f = fixture({ target: 10, slippage: 1, supplyFee: 1_000_000n });
  const result = assertPositionEconomics(f.route, f.request);
  assert.ok(result.effectiveLeverage > 11, 'known cost amplification is material');
});

test('zero-debt 1x long has no artificial divide-by-zero or 0x leverage', () => {
  const f = fixture({ target: 1, supplyFee: 0n });
  assert.equal(assertPositionEconomics(f.route, f.request).effectiveLeverage, 1);
  f.route.details!.debts = '1';
  assert.throws(() => assertPositionEconomics(f.route, f.request), /borrowed exposure/);
});

test('add uses the requested leverage of new capital rather than a blended target echo', () => {
  const f = fixture({ existing: true, target: 5 });
  f.route.details!.leverage = 4; // Proper blended target before costs, not the requested 5x increment.
  assert.ok(assertPositionEconomics(f.route, f.request).effectiveLeverage > 4);
  f.route.details!.leverage = 1000000;
  assert.ok(assertPositionEconomics(f.route, f.request).effectiveLeverage < 5);
});

test('missing, malformed, mixed-operation and non-positive-equity evidence fail closed', () => {
  const base = fixture();
  for (const invalid of [undefined, {}, { ...base.snapshot, priceWad: '0' }, { ...base.snapshot, rateRes: '-1' },
    { ...base.snapshot, supplyFeeRatio: FEE.toString() }, { ...base.snapshot, currentDebts: '1.0' },
    { ...base.snapshot, currentColls: (1n << 256n).toString() }]) {
    assert.equal(normalizePositionEconomics(invalid), undefined);
    const f = fixture();
    f.route.details!.positionEconomics = invalid as PositionEconomics;
    assert.throws(() => assertPositionEconomics(f.route, f.request), /accounting snapshot/);
  }
  const wrongOperation = fixture();
  wrongOperation.snapshot.operation = 'adjust-up';
  assert.throws(() => assertPositionEconomics(wrongOperation.route, wrongOperation.request), /operation mismatch/);
  const insolvent = fixture();
  insolvent.route.details!.debts = usd(10000).toString();
  assert.throws(() => assertPositionEconomics(insolvent.route, insolvent.request), /non-positive resulting equity/);
});

test('BTC leverage-down needs corrected pool-native quote units, never accepts negative collateral', () => {
  const f = fixture({ market: 'BTC', operation: 'adjust-down' });
  assert.doesNotThrow(() => assertPositionEconomics(f.route, f.request));
  f.route.details!.colls = '-100000000000000000000';
  assert.throws(() => assertPositionEconomics(f.route, f.request), /malformed final balances/);
});

test('large conversion price divergence is an explicit fail-closed policy', () => {
  const f = fixture();
  f.route.details!.debts = (BigInt(f.route.details!.debts!) * 120n / 100n).toString();
  assert.throws(() => assertPositionEconomics(f.route, f.request), /exposure misses requested target|non-positive resulting equity/);
});

test('near-1x validation scales the residual to borrowed exposure, not the whole position', () => {
  const f = fixture({ target: 1.1, supplyFee: 0n, slippage: 2 });
  // Only 0.5% of total collateral, but 5% of the intended 0.1x debt exposure.
  f.route.details!.debts = (usd(10) * 95n / 100n).toString();
  assert.doesNotThrow(() => assertPositionEconomics(f.route, f.request));
  f.route.details!.debts = (usd(10) * 93n / 100n).toString();
  assert.throws(() => assertPositionEconomics(f.route, f.request), /borrowed exposure/);
});

test('every SDK down branch includes its known collateral withdrawal padding', () => {
  for (const market of ['ETH', 'BTC'] as const) {
    for (const type of ['long', 'short'] as const) {
      const f = fixture({ market, type, operation: 'adjust-down', slippage: 0.1, withdrawFee: 20_000_000n });
      assert.doesNotThrow(() => assertPositionEconomics(f.route, f.request));
    }
  }
});

test('zero-debt 1x permits only fee/conversion rounding, never a nonzero borrow', () => {
  const f = fixture({ target: 1, supplyFee: 1_234_567n });
  assert.equal(assertPositionEconomics(f.route, f.request).effectiveLeverage, 1);
});

test('real short-add blended-number cancellation is bounded by held accounting operands', () => {
  const f = fixture({ type: 'short', existing: true, target: 2, oldCollateralUsd: usd(4000), oldDebtUsd: usd(3000) });
  // Installed SDK: $100 at 2x added to $4000 collateral / $3000 debt produces
  // a $200 debt increment minus 100000 USD wei after its Decimal->number blend.
  // With $2500/wstETH this is 40 raw debt wei, greater than token rounding alone.
  f.route.details!.debts = (BigInt(f.route.details!.debts!) - 40n).toString();
  assert.doesNotThrow(() => assertPositionEconomics(f.route, f.request));
  f.route.details!.debts = (BigInt(f.route.details!.debts!) - WAD / 2500n).toString();
  assert.throws(() => assertPositionEconomics(f.route, f.request), /borrowed exposure/);
});

test('tiny additions to huge held positions cannot hide inside numerical cancellation budget', () => {
  const f = fixture({ type: 'short', existing: true, target: 2, inputUsd: WAD / 100n,
    oldCollateralUsd: usd(4_000_000_000_000), oldDebtUsd: usd(3_000_000_000_000) });
  assert.throws(() => assertPositionEconomics(f.route, f.request), /too small to validate/);
});
