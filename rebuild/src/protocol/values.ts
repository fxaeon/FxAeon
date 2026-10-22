import { isAddress } from 'viem';
import { AppError } from '../domain/errors';
import type { Address, Hash, LongIntent, WalletSession } from '../domain/ports';
import { MAX_PRODUCT_LEVERAGE, MAX_UINT, MIN_PRODUCT_LEVERAGE, WAD } from './contracts';

export function invariant(value: unknown, message = 'The protocol response could not be verified.'): asserts value {
  if (!value) throw new AppError('policy', message);
}

export function object(value: unknown): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

export function unsigned(value: unknown): bigint {
  invariant(typeof value === 'bigint' || (typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value)));
  const result = BigInt(value);
  invariant(result >= 0n && result <= MAX_UINT);
  return result;
}

export function quantity(value: unknown): bigint {
  invariant(typeof value === 'string' && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value));
  return BigInt(value);
}

export function hex(value: bigint): Hash {
  invariant(value >= 0n && value <= MAX_UINT);
  return `0x${value.toString(16)}`;
}

export function address(value: unknown): Address {
  invariant(typeof value === 'string' && isAddress(value, { strict: false }));
  return value.toLowerCase() as Address;
}

export function bytes(value: unknown, maximumBytes = 16_384): Hash {
  invariant(typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value) && value.length <= 2 + maximumBytes * 2);
  return value.toLowerCase() as Hash;
}

export function hash(value: unknown): Hash {
  const result = bytes(value, 32);
  invariant(result.length === 66);
  return result;
}

export function safeNumber(value: bigint): number {
  invariant(value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= 0n);
  return Number(value);
}

export function ceil(numerator: bigint, denominator: bigint): bigint {
  invariant(numerator >= 0n && denominator > 0n);
  return (numerator + denominator - 1n) / denominator;
}

export function difference(a: bigint, b: bigint): bigint {
  return a >= b ? a - b : b - a;
}

/** SDK price metadata is a decimal value, never an executable form input. */
export function decimalWad(value: unknown): bigint {
  invariant(typeof value === 'string' && /^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,40})?$/.test(value));
  const [whole = '0', fraction = ''] = value.split('.');
  const result = BigInt(whole) * WAD + BigInt((fraction + '0'.repeat(18)).slice(0, 18));
  invariant(result > 0n);
  return result;
}

export function validateIntent(intent: LongIntent): void {
  if (intent.market !== 'ETH' || intent.side !== 'long' || intent.token !== 'ETH'
    || typeof intent.amountWei !== 'bigint' || intent.amountWei <= 0n || intent.amountWei > MAX_UINT
    || !Number.isSafeInteger(intent.leverageBps) || intent.leverageBps < MIN_PRODUCT_LEVERAGE || intent.leverageBps > MAX_PRODUCT_LEVERAGE
    || !Number.isSafeInteger(intent.slippageBps) || intent.slippageBps < 1 || intent.slippageBps > 200) {
    throw new AppError('invalid-input', 'Enter a valid ETH amount, supported leverage and slippage between 0.01% and 2%.');
  }
}

export function validateSession(session: WalletSession): Address {
  if (session.chainId !== 1) throw new AppError('wrong-chain', 'Switch your selected wallet to Ethereum.');
  invariant(typeof session.id === 'string' && session.id.length > 0 && session.id.length <= 512);
  const owner = address(session.address);
  invariant(owner !== '0x0000000000000000000000000000000000000000');
  return owner;
}

/** A deadline covers body decoding and callers whose dependency ignores abort. */
export async function bounded<T>(signal: AbortSignal, milliseconds: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (signal.aborted) throw new AppError('cancelled', 'This request was cancelled.');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectLimit: (error: AppError) => void = () => undefined;
  const limit = new Promise<never>((_, reject) => { rejectLimit = reject; });
  const cancel = () => {
    controller.abort();
    rejectLimit(new AppError('cancelled', 'This request was cancelled.'));
  };
  signal.addEventListener('abort', cancel, { once: true });
  timer = setTimeout(() => {
    controller.abort();
    rejectLimit(new AppError('unavailable', 'The verification timed out. Refresh and try again.'));
  }, milliseconds);
  try {
    const result = await Promise.race([Promise.resolve().then(() => work(controller.signal)), limit]);
    if (signal.aborted || controller.signal.aborted) throw new AppError('cancelled', 'This request was cancelled.');
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
