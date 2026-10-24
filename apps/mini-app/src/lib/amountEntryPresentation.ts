import { decimalInputError } from './amount';

/** Display copy only: never replaces the exact input or transaction amount. */
export function compactAmountEntry(value: string, maxDecimals: number): string | null {
  if (value.length <= 12 || decimalInputError(value, maxDecimals, { allowZero: true })) return null;
  const [rawInteger, rawFraction = ''] = value.split('.');
  const integer = rawInteger.replace(/^0+(?=\d)/, '') || '0';
  const fraction = rawFraction.replace(/0+$/, '');
  const leadingZeros = integer === '0' ? /^0*/.exec(fraction)![0].length : 0;
  const places = integer === '0' ? leadingZeros + 5 : Math.max(0, 5 - integer.length);
  const kept = fraction.slice(0, places).replace(/0+$/, '');
  const shortened = /[1-9]/.test(fraction.slice(places));
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const preview = `${shortened ? '≈ ' : ''}${grouped}${kept ? `.${kept}` : ''}`;
  // Preserve dust and large whole amounts when a preview buys no space.
  return preview.length < value.length ? preview : null;
}
