/**
 * Exact, UI-side decimal validation.
 *
 * Financial inputs must never pass through Number/parseFloat: large values can
 * overflow and tiny values can underflow even though the exact string is still
 * sent to the API. Keep the value as text and enforce the token's on-chain
 * precision before enabling a review.
 */
export function positiveDecimal(value: string, maxDecimals: number): string | null {
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > 35) return null;
  if (!value || value.length > 100) return null;
  const pattern = maxDecimals === 0
    ? /^\d+$/
    : new RegExp(`^(?:\\d+(?:\\.\\d{1,${maxDecimals}})?|\\.\\d{1,${maxDecimals}})$`);
  if (!pattern.test(value)) return null;
  return /[1-9]/.test(value) ? value : null;
}

/** Convert an already-validated plain decimal to exact token units. */
export function decimalToUnits(value: string, decimals: number): bigint | null {
  const valid = positiveDecimal(value, decimals);
  if (!valid) return null;
  const [integerRaw, fractionRaw = ''] = valid.split('.');
  const integer = integerRaw || '0';
  const fraction = fractionRaw.padEnd(decimals, '0');
  try {
    return BigInt(integer) * 10n ** BigInt(decimals) + BigInt(fraction || '0');
  } catch {
    return null;
  }
}

export function decimalInputError(
  value: string,
  maxDecimals: number,
  options: { allowAll?: boolean; allowZero?: boolean } = {}
): string | null {
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > 35) {
    return 'This asset has an invalid precision configuration.';
  }
  if (!value || (options.allowAll && value.toLowerCase() === 'all')) return null;
  if (value.length > 100 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    return 'Use digits and one decimal point, like 1.25.';
  }
  const fraction = value.split('.')[1] ?? '';
  if (fraction.length > maxDecimals) {
    return maxDecimals === 0
      ? 'This asset has no decimal places. Enter a whole number.'
      : `This asset allows ${maxDecimals} decimal places. Remove the extra digits.`;
  }
  if (value.endsWith('.')) return 'Add a digit after the decimal point.';
  if (!options.allowZero && !/[1-9]/.test(value)) return 'Enter an amount greater than zero.';
  return null;
}

/** Normalize a pasted amount only under an explicit decimal separator policy.
 * Grouped values such as `1,000` are rejected because their meaning is ambiguous. */
export function normalizeAmountInput(
  input: string,
  policy: 'dot-decimal' | 'comma-decimal' = 'dot-decimal',
): string | null {
  const value = input.trim();
  if (value.length > 100) return null;
  if (policy === 'dot-decimal') return value.includes(',') ? null : value;
  if (value.includes('.') || (value.match(/,/g)?.length ?? 0) > 1) return null;
  if (/^\d{1,3}(?:,\d{3})+$/.test(value)) return null;
  return value.replace(',', '.');
}

/**
 * Format an API decimal without first coercing it to a JavaScript number.
 * This keeps balances above Number.MAX_SAFE_INTEGER and 18-decimal values
 * honest while still giving compact, grouped UI copy.
 */
export function formatExactDecimal(value: string, maxFractionDigits = 4): string {
  if (!Number.isInteger(maxFractionDigits) || maxFractionDigits < 0 || maxFractionDigits > 35) {
    return value;
  }

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign, integer, fraction = ''] = match;
  const coefficient = BigInt(`${integer}${fraction}`);
  const trim = Math.max(0, fraction.length - maxFractionDigits);
  const divisor = 10n ** BigInt(trim);
  const rounded = trim > 0
    ? coefficient / divisor + ((coefficient % divisor) * 2n >= divisor ? 1n : 0n)
    : coefficient;
  const scale = Math.min(fraction.length, maxFractionDigits);
  const padded = rounded.toString().padStart(scale + 1, '0');
  const roundedInteger = scale === 0 ? padded : padded.slice(0, -scale);
  const roundedFraction = scale === 0 ? '' : padded.slice(-scale).replace(/0+$/, '');
  const grouped = roundedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const isZero = rounded === 0n;
  return `${sign && !isZero ? '-' : ''}${grouped}${roundedFraction ? `.${roundedFraction}` : ''}`;
}

/** Smallest amount spelled out; anything above zero but below it reads as "<0.000001". */
export const DISPLAY_DUST = '0.000001';

/**
 * Display copy for an exact token amount: grouped, at most `significant`
 * significant digits (whole numbers always kept, two decimals once an amount
 * reaches 1,000), truncated toward zero so a shown balance never exceeds the
 * exact one. Callers add direction signs; the input's own sign is kept.
 */
export function formatSignificantDecimal(value: string, significant = 5): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || !Number.isInteger(significant) || significant < 1 || significant > 30) return value;
  const [, sign, rawInteger, rawFraction = ''] = match;
  const integer = rawInteger.replace(/^0+(?=\d)/, '');
  const fraction = rawFraction.replace(/0+$/, '');
  if (integer === '0' && fraction === '') return '0';
  if (integer === '0') {
    const leadingZeros = /^0*/.exec(fraction)![0].length;
    // DISPLAY_DUST itself has one zero fewer than anything below it.
    if (leadingZeros >= DISPLAY_DUST.length - 2) return `<${DISPLAY_DUST}`;
    const kept = fraction.slice(0, leadingZeros + significant).replace(/0+$/, '');
    return `${sign}0.${kept}`;
  }
  const fractionDigits = Math.max(integer.length >= 4 ? 2 : 0, significant - integer.length);
  const kept = fraction.slice(0, fractionDigits).replace(/0+$/, '');
  return `${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${kept ? `.${kept}` : ''}`;
}

const group = (integer: string) => integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * A balance a user can spend, as display copy: grouped, at most
 * `maxFractionDigits` decimals (eight, as Portfolio shows holdings), rounded
 * down so it never reads as more than the wallet holds. A positive balance
 * below the last place reads "<0.00000001", never zero.
 */
export function formatBalanceDecimal(value: string, maxFractionDigits = 8): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || !Number.isInteger(maxFractionDigits) || maxFractionDigits < 0 || maxFractionDigits > 35) return value;
  const [, rawInteger, rawFraction = ''] = match;
  const integer = rawInteger.replace(/^0+(?=\d)/, '');
  const fraction = rawFraction.slice(0, maxFractionDigits).replace(/0+$/, '');
  if (integer === '0' && !fraction && /[1-9]/.test(rawFraction)) {
    return maxFractionDigits === 0 ? '<1' : `<0.${'0'.repeat(maxFractionDigits - 1)}1`;
  }
  return `${group(integer)}${fraction ? `.${fraction}` : ''}`;
}

/**
 * A cost or a minimum, as display copy: at most `significant` significant
 * digits (two decimals once it reaches 1,000, as formatSignificantDecimal),
 * rounded up so the figure shown always covers the exact one.
 */
export function formatSignificantDecimalUp(value: string, significant = 3): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || !Number.isInteger(significant) || significant < 1 || significant > 30) return value;
  const integer = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  const kept = integer === '0'
    ? /^0*/.exec(fraction)![0].length + significant
    : Math.max(integer.length >= 4 ? 2 : 0, significant - integer.length);
  if (fraction.length <= kept) return `${group(integer)}${fraction ? `.${fraction}` : ''}`;
  const units = (BigInt(`${integer}${fraction.slice(0, kept)}`) + 1n).toString().padStart(kept + 1, '0');
  const roundedInteger = kept === 0 ? units : units.slice(0, -kept);
  const roundedFraction = kept === 0 ? '' : units.slice(-kept).replace(/0+$/, '');
  return `${group(roundedInteger)}${roundedFraction ? `.${roundedFraction}` : ''}`;
}

/**
 * Thousands separators for an exact unsigned decimal string, for display only.
 * The fraction is left untouched, and anything else is returned as is.
 */
export function groupDigits(value: string): string {
  const match = /^(\d+)(\.\d+)?$/.exec(value);
  if (!match) return value;
  return `${match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[2] ?? ''}`;
}

/** Compare two unsigned decimal strings at a fixed on-chain precision. */
export function compareExactDecimals(
  left: string,
  right: string,
  maxDecimals: number
): -1 | 0 | 1 | null {
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > 35) return null;
  const parse = (value: string): bigint | null => {
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || value.endsWith('.')) return null;
    const [integer = '0', fraction = ''] = value.split('.');
    if (fraction.length > maxDecimals) return null;
    return BigInt(`${integer || '0'}${fraction.padEnd(maxDecimals, '0')}`);
  };
  const a = parse(left);
  const b = parse(right);
  if (a === null || b === null) return null;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Calculate an exact fractional percentage of a decimal balance (e.g. 25%, 50%, 75%, 100%).
 * Uses BigInt units to ensure zero float-precision corruption.
 */
export function calculateFractionDecimal(
  balance: string | null | undefined,
  percent: number,
  maxDecimals = 18
): string {
  if (!balance || !Number.isFinite(percent) || percent <= 0) return '';
  const cleanBalance = balance.trim();
  const valid = positiveDecimal(cleanBalance, maxDecimals);
  if (!valid) return '';

  if (percent >= 100) return valid;

  const units = decimalToUnits(valid, maxDecimals);
  if (units === null) return '';

  const fractionUnits = (units * BigInt(Math.round(percent))) / 100n;
  if (fractionUnits === 0n) return '0';

  const padded = fractionUnits.toString().padStart(maxDecimals + 1, '0');
  const integer = padded.slice(0, -maxDecimals) || '0';
  const fraction = padded.slice(-maxDecimals).replace(/0+$/, '');

  return fraction ? `${integer}.${fraction}` : integer;
}

/**
 * The token amount worth a typed US-dollar amount at a display price, for
 * entering an amount in dollars. Rounded down to the place where one unit is
 * worth at most $0.0001 (8 decimals for ETH, 4 for a dollar stablecoin), so it
 * never exceeds what was typed. The token amount is what the form reviews.
 */
export function tokenAmountForUsd(usd: string, price: number, maxDecimals: number): string {
  const typed = usd.trim().replace(/\.$/, '');
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(typed) || !Number.isFinite(price) || price <= 0
    || !Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > 35) return '';
  const dollars = decimalToUnits(typed, 18);
  if (dollars === null) return '0';
  const places = Math.min(maxDecimals, Math.max(0, Math.ceil(Math.log10(price) + 4)));
  const priceUnits = BigInt(Math.round(price * 1e8));
  if (priceUnits <= 0n) return '';
  const units = dollars * 10n ** BigInt(places) * 100_000_000n / (priceUnits * 10n ** 18n);
  const digits = units.toString().padStart(places + 1, '0');
  const integer = places ? digits.slice(0, -places) : digits;
  const fraction = places ? digits.slice(-places).replace(/0+$/, '') : '';
  return fraction ? `${integer}.${fraction}` : integer;
}

/** A token amount's worth as a dollar entry: whole cents, rounded down, "12.5" kept as "12.50". */
export function usdEntryForToken(token: string, price: number): string {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token) || !Number.isFinite(price) || price <= 0) return '';
  const cents = Math.floor(Number(token) * price * 100 + 1e-6);
  if (!Number.isSafeInteger(cents) || cents < 0) return '';
  const fraction = cents % 100;
  return `${Math.floor(cents / 100)}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`;
}
