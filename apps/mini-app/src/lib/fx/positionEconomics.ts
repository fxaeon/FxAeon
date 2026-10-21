import type { PlannedRoute } from './types';

const WAD = 10n ** 18n;
const FEE_SCALE = 1_000_000_000n;
const MAX_UINT256 = (1n << 256n) - 1n;

/** Values already read by the SDK for this particular quote. No additional RPC
 * is needed. All balances are pool-native 18dp accounting amounts; inputCollateral
 * is the actual converted input in native wstETH/WBTC units for a long and raw
 * fxUSD for a short. priceWad is the SDK's existing two-sided execution-price
 * sample, in USD per stETH (ETH) or WBTC (BTC), scaled by 1e18. */
export interface PositionEconomics {
  version: 1;
  operation: 'increase' | 'adjust-up' | 'adjust-down';
  priceWad: string;
  rateRes: string;
  currentColls: string;
  currentDebts: string;
  inputCollateral: string;
  supplyFeeRatio: string;
  withdrawFeeRatio: string;
}

const uint = (value: unknown): bigint | undefined => {
  if (typeof value !== 'string' || !/^\d{1,78}$/.test(value)) return undefined;
  const amount = BigInt(value);
  return amount <= MAX_UINT256 ? amount : undefined;
};

export function normalizePositionEconomics(value: unknown): PositionEconomics | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || !['increase', 'adjust-up', 'adjust-down'].includes(String(raw.operation))) return undefined;
  const keys = ['priceWad', 'rateRes', 'currentColls', 'currentDebts', 'inputCollateral', 'supplyFeeRatio', 'withdrawFeeRatio'] as const;
  if (keys.some(key => uint(raw[key]) === undefined)) return undefined;
  if (BigInt(raw.priceWad as string) === 0n || BigInt(raw.rateRes as string) === 0n
    || BigInt(raw.supplyFeeRatio as string) >= FEE_SCALE || BigInt(raw.withdrawFeeRatio as string) >= FEE_SCALE) return undefined;
  return {
    version: 1,
    operation: raw.operation as PositionEconomics['operation'],
    ...Object.fromEntries(keys.map(key => [key, raw[key]])),
  } as PositionEconomics;
}

type EconomicRequest = {
  market: 'ETH' | 'BTC';
  type: 'long' | 'short';
  positionId: number;
  leverage: number;
  slippage: number;
};

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const fail = (reason: string): never => { throw new Error(`SDK quote economics could not be verified: ${reason}`); };

/** Parse the finite decimal number supplied by the form without binary floating
 * point arithmetic on token quantities. Reject unsupported precision rather than
 * silently round the user's target. */
function decimalWad(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) return fail('invalid request');
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match || (match[2]?.length ?? 0) > 18) return fail('invalid request precision');
  return BigInt(match[1]!) * WAD + BigInt((match[2] ?? '').padEnd(18, '0'));
}

/**
 * Validate requested economic EXPOSURE, not the SDK's echoed target. A change in
 * swap costs is amplified by leverage, so a flat tolerance on the leverage ratio
 * is wrong. We instead bound the borrowed/repaid dollar amounts and propagate
 * the exact supply/withdrawal fee through collateral intervals.
 *
 * Solver allowance r=2% is a bounded compatibility policy for the legacy
 * hundred-part search: its first bracket is at most 1.5% of the hint. Two factors
 * of user slippage cover source uplift / destination haircut and a bounded
 * price difference from the existing spot sample. Larger price impact is safely
 * rejected. Factors [(1-r)(1-s)^2, (1+r)(1+s)^2] allow at most -5.88%/+6.12%
 * at the app's 2% slippage cap, relative to borrowed exposure, never to total
 * collateral. Native rounding and SDK decimal/number arithmetic get a separate
 * small budget; when their total exceeds 10% of intended exposure the amount is
 * unsupported dust, including tiny additions to very large existing positions.
 *
 * The metadata is accounting evidence, not transaction authority. Existing
 * reviewed-calldata, pool-limit, freshness and signing checks remain required.
 */
export function assertPositionEconomics(route: PlannedRoute, request: EconomicRequest): {
  effectiveLeverage: number;
  collateralUsd: string;
  debtUsd: string;
} {
  const snapshot = normalizePositionEconomics(route.details?.positionEconomics);
  if (!snapshot) return fail('missing or malformed accounting snapshot');
  if (!['ETH', 'BTC'].includes(request.market) || !['long', 'short'].includes(request.type)
    || !Number.isSafeInteger(request.positionId) || request.positionId < 0
    || !Number.isFinite(request.slippage) || request.slippage <= 0 || request.slippage > 2) return fail('invalid request');
  const increasing = route.operation === 'increasePosition';
  if ((!increasing && route.operation !== 'adjustPositionLeverage')
    || (increasing ? snapshot.operation !== 'increase' : snapshot.operation === 'increase')
    || (!increasing && request.positionId === 0)) return fail('operation mismatch');

  const sideLong = request.type === 'long';
  const price = BigInt(snapshot.priceWad);
  const rate = BigInt(snapshot.rateRes);
  if (request.market === 'BTC' ? rate !== WAD : rate < WAD || rate > 10n * WAD) return fail('invalid accounting rate');
  const c0 = BigInt(snapshot.currentColls);
  const d0 = BigInt(snapshot.currentDebts);
  const input = BigInt(snapshot.inputCollateral);
  if (request.positionId === 0 && (c0 !== 0n || d0 !== 0n)) return fail('new position has existing balances');
  if (increasing ? input === 0n : input !== 0n) return fail('converted input mismatch');

  const quotedColls = uint(route.details?.colls);
  const quotedDebts = uint(route.details?.debts);
  if (quotedColls === undefined || quotedDebts === undefined) return fail('malformed final balances');
  const up = snapshot.operation !== 'adjust-down';
  // SDK open/add/up mixes held stETH with new wstETH. Down quotes, including
  // the locally corrected BTC quote, already use pool accounting units.
  const finalColls = sideLong && up
    ? c0 + (quotedColls - c0) * rate / WAD
    : quotedColls;
  const assetUsd = (amount: bigint) => amount * price / WAD;
  const debtUsd = (amount: bigint) => sideLong ? amount : amount * rate * price / WAD / WAD;
  const oldC = sideLong ? assetUsd(c0) : c0;
  const oldD = debtUsd(d0);
  const newC = sideLong ? assetUsd(finalColls) : finalColls;
  const newD = debtUsd(quotedDebts);
  if (newC <= 0n || newD < 0n || newC <= newD) return fail('non-positive resulting equity');
  if (request.positionId > 0 && (oldC <= 0n || oldC <= oldD)) return fail('invalid existing equity');

  const nativeScale = request.market === 'BTC' ? 10n ** 10n : 1n;
  const inputUsd = sideLong ? input * nativeScale * rate * price / WAD / WAD : input;
  const requested = decimalWad(request.leverage);
  const gross = sideLong ? requested : requested + WAD;
  if (gross < WAD || (!sideLong && requested === 0n)) return fail('invalid leverage target');
  const expected = increasing
    ? inputUsd * (gross - WAD) / WAD
    : up
      ? (oldC - oldD) * gross / WAD - oldC
      : oldC - (oldC - oldD) * gross / WAD;
  if (expected < 0n) return fail('leverage direction mismatch');
  if (!increasing && expected === 0n) return fail('no leverage change');

  const s = decimalWad(request.slippage) / 100n;
  const r = WAD / 50n;
  const lo = (WAD - r) * (WAD - s) * (WAD - s) / WAD / WAD;
  const hi = (WAD + r) * (WAD + s) * (WAD + s) / WAD / WAD;
  const assetQuantum = ceilDiv(nativeScale * rate * price, WAD * WAD);
  // The SDK converts blended add leverage from Decimal to a JS number and back.
  // Cancellation against held balances can exceed one token wei. Bound that
  // numerical error by 1e-12 of gross-weighted accounting operands, rather than
  // allowing a percentage of the actual debt increment. This is deliberately
  // conservative versus binary-double precision, and cannot hide a tiny add:
  // the combined allowance must still stay below 10% of its intended exposure.
  const numerical = ceilDiv((oldC + oldD + inputUsd + expected) * (gross + WAD), WAD * 10n ** 12n);
  const rounding = 4n * assetQuantum + 4n + numerical;
  if (expected > 0n && rounding * 10n > expected) return fail('amount is too small to validate safely. Increase the position amount.');
  const lower = expected * lo / WAD;
  const upper = ceilDiv(expected * hi, WAD);
  const inRange = (actual: bigint, min: bigint, max: bigint, label: string, strictZero = false) => {
    // A zero intended borrow cannot acquire a nonzero debt using a rounding
    // allowance. For positive changes the allowance is capped above.
    const dust = expected === 0n && strictZero ? 0n : rounding;
    if (actual < 0n || actual + dust < min || actual > max + dust) fail(label);
  };
  const supply = FEE_SCALE - BigInt(snapshot.supplyFeeRatio);
  const withdraw = FEE_SCALE - BigInt(snapshot.withdrawFeeRatio);
  if (up) {
    const deltaC = newC - oldC;
    const deltaD = newD - oldD;
    inRange(deltaD, sideLong ? lower : expected, sideLong ? upper : expected, 'borrowed exposure misses requested target', true);
    inRange(deltaC, (inputUsd + lower) * supply / FEE_SCALE,
      ceilDiv((inputUsd + upper) * supply, FEE_SCALE), 'collateral exposure misses requested target');
  } else {
    // Both SDK down branches deliberately add 1e10 raw units to collateral
    // withdrawn: normalized wstETH/WBTC for longs, fxUSD for shorts. Account
    // for that known padding explicitly rather than call it rounding error.
    const withdrawalPadding = sideLong ? ceilDiv(10n ** 10n * rate * price, WAD * WAD) : 10n ** 10n;
    inRange(oldD - newD, lower, upper, 'repaid exposure misses requested target');
    inRange(oldC - newC, lower * FEE_SCALE / withdraw + withdrawalPadding,
      ceilDiv(upper * FEE_SCALE, withdraw) + withdrawalPadding, 'withdrawn exposure misses requested target');
  }

  const leverageWad = (sideLong ? newC : newD) * WAD / (newC - newD);
  const effectiveLeverage = Number(leverageWad) / Number(WAD);
  if (!Number.isFinite(effectiveLeverage)) return fail('invalid effective leverage');
  return { effectiveLeverage, collateralUsd: newC.toString(), debtUsd: newD.toString() };
}
