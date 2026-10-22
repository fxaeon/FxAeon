import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData } from 'viem';
import { AppError } from '../domain/errors';
import type { LongEconomics, LongIntent, ReviewedCall, WalletSession } from '../domain/ports';
import { ADDRESSES, BPS, CONVERTER_ABI, DEBT_ENCODING, DEBT_ROUTE, FEE_SCALE, FLASH_DATA, INPUT_ENCODING, INPUT_ROUTE, OPEN_ABI, WAD } from './contracts';
import { leverageBounds } from './reads';
import type { PoolSnapshot } from './reads';
import { address, bytes, ceil, decimalWad, difference, invariant, object, safeNumber, unsigned, validateIntent, validateSession } from './values';

export interface DecodedLong {
  readonly input: bigint;
  readonly minimumInput: bigint;
  readonly borrowedWstEth: bigint;
  readonly debt: bigint;
  readonly minimumDebtRatio: bigint;
  readonly maximumDebtRatio: bigint;
}

function sameRoutes(actual: readonly bigint[], expected: readonly bigint[]): boolean {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

/** Decode every authority-bearing nested field; reject trailing ABI data too. */
export function decodeLongCall(call: ReviewedCall): DecodedLong {
  invariant(call.chainId === 1 && address(call.from) !== ADDRESSES.native && address(call.to) === ADDRESSES.router);
  invariant(typeof call.nonce === 'number' && Number.isSafeInteger(call.nonce) && call.nonce >= 0);
  invariant(typeof call.value === 'bigint' && call.value > 0n);
  const encoded = bytes(call.data);
  const decoded = decodeFunctionData({ abi: OPEN_ABI, data: encoded });
  invariant(decoded.functionName === 'openOrAddPositionFlashLoanV2');
  const [input, pool, positionId, borrowedWstEth, payload] = decoded.args;
  invariant(encodeFunctionData({ abi: OPEN_ABI, functionName: decoded.functionName, args: decoded.args }).toLowerCase() === encoded);
  invariant(address(pool) === ADDRESSES.pool && positionId === 0n && borrowedWstEth > 0n);
  invariant(address(input.tokenIn) === ADDRESSES.native && input.amount === call.value && input.minOut > 0n
    && address(input.target) === ADDRESSES.converter && input.signature === '0x');
  const conversion = decodeFunctionData({ abi: CONVERTER_ABI, data: input.data });
  invariant(conversion.functionName === 'convert');
  const [inputToken, inputAmount, inputEncoding, inputRoutes] = conversion.args;
  invariant(address(inputToken) === ADDRESSES.native && inputAmount === call.value && inputEncoding === INPUT_ENCODING
    && sameRoutes(inputRoutes, INPUT_ROUTE));
  invariant(encodeFunctionData({ abi: CONVERTER_ABI, functionName: 'convert', args: conversion.args }).toLowerCase() === input.data.toLowerCase());
  const [misc, debt, converter, debtData] = decodeAbiParameters(FLASH_DATA, payload);
  invariant(encodeAbiParameters(FLASH_DATA, [misc, debt, converter, debtData]).toLowerCase() === payload.toLowerCase());
  invariant(misc >> 120n === 0n && address(converter) === ADDRESSES.converter && debt > 0n);
  const minimumDebtRatio = misc & ((1n << 60n) - 1n);
  const maximumDebtRatio = misc >> 60n;
  invariant(minimumDebtRatio > 0n && minimumDebtRatio <= maximumDebtRatio);
  const debtConversion = decodeFunctionData({ abi: CONVERTER_ABI, data: debtData });
  invariant(debtConversion.functionName === 'convert');
  const [debtToken, debtAmount, debtEncoding, debtRoutes] = debtConversion.args;
  invariant(address(debtToken) === ADDRESSES.fxUsd && debtAmount === debt && debtEncoding === DEBT_ENCODING
    && sameRoutes(debtRoutes, DEBT_ROUTE));
  invariant(encodeFunctionData({ abi: CONVERTER_ABI, functionName: 'convert', args: debtConversion.args }).toLowerCase() === debtData.toLowerCase());
  return Object.freeze({ input: call.value, minimumInput: input.minOut, borrowedWstEth, debt, minimumDebtRatio, maximumDebtRatio });
}

function closeEnough(actual: bigint, expected: bigint, tolerance: bigint, message: string): void {
  if (difference(actual, expected) > tolerance) throw new AppError('economics', message);
}

function exposureRange(actual: bigint, expected: bigint, slippage: bigint, rounding: bigint): void {
  // The documented compatibility policy applies to changed exposure, not the
  // total size of an unrelated position. This slice can create only a new long.
  const denominator = 100n * BPS * BPS;
  const lower = expected * 98n * (BPS - slippage) ** 2n / denominator;
  const upper = ceil(expected * 102n * (BPS + slippage) ** 2n, denominator);
  if (rounding * 10n > expected || actual + rounding < lower || actual > upper + rounding) {
    throw new AppError('economics', 'The quote does not match the requested economic exposure. Refresh or increase the amount.');
  }
}

export interface ValidatedLong {
  readonly call: ReviewedCall;
  readonly economics: LongEconomics;
  readonly decoded: DecodedLong;
}

/** Only the official planner produces this input; independent arithmetic verifies it. */
export function validateSdkLong(result: unknown, intent: LongIntent, session: WalletSession, pool: PoolSnapshot): ValidatedLong {
  validateIntent(intent);
  const owner = validateSession(session);
  const limits = leverageBounds(pool);
  if (pool.paused) throw new AppError('unavailable', 'New positions are paused by the protocol.');
  if (intent.leverageBps < limits.minimum || intent.leverageBps > limits.maximum) throw new AppError('invalid-input', 'Choose leverage within the current pool limits.');
  const root = object(result);
  invariant(root.positionId === 0 && root.slippage === intent.slippageBps / 100);
  invariant(Array.isArray(root.routes) && root.routes.length === 1);
  const route = object(root.routes[0]);
  invariant(route.routeType === 'FxRoute' && route.leverage === intent.leverageBps / 10_000);
  invariant(Array.isArray(route.txs) && route.txs.length === 1, 'This native ETH route must contain exactly one action and no approval.');
  const tx = object(route.txs[0]);
  invariant(Object.keys(tx).every((key) => ['from', 'to', 'data', 'value', 'nonce', 'chainId', 'type'].includes(key)));
  invariant(tx.type === 'trade' && tx.chainId === 1 && address(tx.from) === owner && address(tx.to) === ADDRESSES.router);
  invariant(typeof tx.nonce === 'number' && Number.isSafeInteger(tx.nonce) && tx.nonce >= 0);
  const call: ReviewedCall = Object.freeze({ chainId: 1, from: owner, to: ADDRESSES.router,
    data: bytes(tx.data), value: unsigned(tx.value), nonce: tx.nonce });
  invariant(call.value === intent.amountWei);
  const decoded = decodeLongCall(call);
  const accounting = object(route.positionEconomics);
  invariant(accounting.version === 1 && accounting.operation === 'increase');
  invariant(unsigned(accounting.currentColls) === 0n && unsigned(accounting.currentDebts) === 0n);
  const inputWstEth = unsigned(accounting.inputCollateral);
  const rate = unsigned(accounting.rateRes);
  const samplePrice = unsigned(accounting.priceWad);
  const supplyFee = unsigned(accounting.supplyFeeRatio);
  invariant(inputWstEth > 0n && samplePrice > 0n && rate === pool.wrappingRate && supplyFee === pool.fees[0]
    && unsigned(accounting.withdrawFeeRatio) === pool.fees[1]);
  const feeQuote = object(root.protocolFeeQuote);
  invariant(address(feeQuote.poolAddress) === ADDRESSES.pool && address(feeQuote.routerAddress) === ADDRESSES.router);
  invariant(Array.isArray(feeQuote.ratios) && feeQuote.ratios.length === 4
    && feeQuote.ratios.every((value, index) => unsigned(value) === pool.fees[index]));
  const debt = unsigned(route.debts);
  const rawCollateral = unsigned(route.colls);
  invariant(debt === decoded.debt && rawCollateral > 0n);
  const slippage = BigInt(intent.slippageBps);
  // Amount-dependent numerical allowance for the SDK's finite decimal metadata.
  // It is not allowed to grow beyond 10% of the intended borrowing below.
  const unitAllowance = 4n + ceil(inputWstEth + decoded.borrowedWstEth, 10n ** 12n);
  invariant(pool.nativeInputQuote?.amountWei === intent.amountWei,
    'The native ETH conversion was not independently verified for this amount.');
  closeEnough(inputWstEth, pool.nativeInputQuote.wstEthWei, unitAllowance,
    'The quoted collateral no longer matches the verified native ETH conversion.');
  closeEnough(decoded.minimumInput, inputWstEth * (BPS - slippage) / BPS, unitAllowance, 'The input conversion minimum changed.');
  const collateralWstEth = (inputWstEth + decoded.borrowedWstEth) * (FEE_SCALE - supplyFee) / FEE_SCALE;
  closeEnough(rawCollateral, collateralWstEth, unitAllowance, 'The quoted collateral does not match the decoded action.');
  invariant(inputWstEth + decoded.borrowedWstEth <= pool.collateralRoom && debt <= pool.debtRoom,
    'The pool no longer has sufficient capacity for this trade.');
  const collateralStEthWei = collateralWstEth * rate / WAD;
  const inputValue = inputWstEth * rate * samplePrice / (WAD * WAD);
  const borrowValue = decoded.borrowedWstEth * rate * samplePrice / (WAD * WAD);
  const extraLeverage = BigInt(intent.leverageBps) - BPS;
  const intendedDebt = inputValue * (FEE_SCALE - supplyFee) * extraLeverage / (FEE_SCALE * BPS + supplyFee * extraLeverage);
  const valueAllowance = 4n + ceil(unitAllowance * rate * samplePrice, WAD * WAD);
  exposureRange(debt, intendedDebt, slippage, valueAllowance);
  exposureRange(borrowValue, intendedDebt, slippage, valueAllowance);
  // Quote-price metadata is checked against the live oracle as an additional
  // conservative gate; no public chart/feed becomes an economic input.
  exposureRange(samplePrice, pool.anchorPrice, slippage, 4n);
  const executionPriceUsdE18 = decimalWad(route.executionPrice);
  exposureRange(executionPriceUsdE18, samplePrice, slippage, 4n);
  const expectedBorrow = debt * WAD * WAD * (BPS - slippage) / (executionPriceUsdE18 * rate * BPS);
  closeEnough(decoded.borrowedWstEth, expectedBorrow, unitAllowance, 'The borrowed conversion minimum is inconsistent.');
  const expectedRatio = (oracle: bigint) => debt * WAD ** 3n * FEE_SCALE
    / ((inputWstEth + decoded.borrowedWstEth) * rate * (FEE_SCALE - supplyFee) * oracle);
  const minimum = expectedRatio(pool.anchorPrice * 101n / 100n);
  const maximum = expectedRatio(pool.anchorPrice * 99n / 100n);
  closeEnough(decoded.minimumDebtRatio, minimum, 4n + ceil(minimum, 10n ** 12n), 'The signed debt-ratio minimum is not bound to this quote.');
  closeEnough(decoded.maximumDebtRatio, maximum, 4n + ceil(maximum, 10n ** 12n), 'The signed debt-ratio maximum is not bound to this quote.');
  invariant(decoded.minimumDebtRatio >= pool.minimumDebtRatio && decoded.maximumDebtRatio <= pool.maximumDebtRatio,
    'The signed debt-ratio limits no longer fit the live pool.');
  const collateralValue = collateralStEthWei * samplePrice / WAD;
  if (collateralValue <= debt) throw new AppError('economics', 'The quote has no verified positive equity.');
  const estimatedLeverageBps = safeNumber(collateralValue * BPS / (collateralValue - debt));
  return Object.freeze({ call, decoded, economics: Object.freeze({ collateralStEthWei, debtFxUsdWei: debt,
    estimatedLeverageBps, executionPriceUsdE18, minimumWstEthWei: decoded.minimumInput,
    borrowFeeRatio: pool.fees[2], supplyFeeRatio: supplyFee }) });
}
