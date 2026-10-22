import { exactAmount, formatAmount } from '../domain/amount';

export { exactAmount };

export function amount(value: bigint, places = 6): string {
  const text = formatAmount(value, 18, places);
  if (value > 0n && text === '0') return `<0.${'0'.repeat(places - 1)}1`;
  if (value < 0n && (text === '−0' || text === '0')) return `−<0.${'0'.repeat(places - 1)}1`;
  return text;
}

export function dollars(value: bigint | undefined): string {
  if (value === undefined || value <= 0n) return 'Unavailable';
  const cents = value / 10n ** 16n;
  if (cents === 0n) return '<$0.01';
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${whole}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export function multiplier(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps < 0) return 'Unavailable';
  return `${exactAmount(BigInt(bps), 4)}×`;
}

export function percent(bps: number): string {
  return `${exactAmount(BigInt(bps), 2)}%`;
}

export function feeRate(ratio: bigint | undefined): string {
  return ratio === undefined ? 'Unavailable' : `${exactAmount(ratio, 7)}%`;
}

export function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function dateLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp));
}

export function elapsedLabel(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return 'Just checked';
  if (seconds < 60) return `Checked ${seconds}s ago`;
  return `Checked ${Math.floor(seconds / 60)}m ago`;
}
