import { AppError } from './errors';
import type { LongIntent } from './ports';
import type { TicketInput } from './view';

const UINT256_MAX = (1n << 256n) - 1n;

/** No Number conversion is used for token amounts. */
export function parseAmount(text: string, decimals = 18): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || text.length > 100) {
    throw new AppError('invalid-input', 'This amount is outside the supported range.');
  }
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    throw new AppError('invalid-input', 'Enter an amount using digits and one decimal point.');
  }
  const [whole = '0', fraction = ''] = text.split('.');
  if (fraction.length > decimals) {
    throw new AppError('invalid-input', `Use no more than ${decimals} decimal places.`);
  }
  const units = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (units > UINT256_MAX) throw new AppError('invalid-input', 'This amount is too large.');
  return units;
}

/** Display truncates without rounding a spendable balance up. Exact value is available separately. */
export function formatAmount(units: bigint, decimals = 18, places = 6): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, '0').slice(0, places).replace(/0+$/, '');
  return `${negative ? '−' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function exactAmount(units: bigint, decimals = 18): string {
  return formatAmount(units, decimals, decimals);
}

export function intentFromInput(input: TicketInput): LongIntent {
  const amountWei = parseAmount(input.amount);
  if (amountWei <= 0n) throw new AppError('invalid-input', 'Enter an ETH amount greater than zero.');
  const leverage = parseAmount(input.leverage, 4);
  if (leverage < 11_000n || leverage > 50_000n) {
    throw new AppError('invalid-input', 'Choose leverage between 1.1× and 5×. Live pool limits also apply.');
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > 100) {
    throw new AppError('invalid-input', 'Choose slippage between 0.01% and 1%.');
  }
  return Object.freeze({ market: 'ETH', side: 'long', token: 'ETH', amountWei, leverageBps: Number(leverage), slippageBps: input.slippageBps });
}

export function sameIntent(a: LongIntent, b: LongIntent): boolean {
  return a.market === b.market && a.side === b.side && a.token === b.token &&
    a.amountWei === b.amountWei && a.leverageBps === b.leverageBps && a.slippageBps === b.slippageBps;
}
