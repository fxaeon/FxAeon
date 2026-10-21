import { formatUnits } from 'viem';
import { formatBalanceDecimal, groupDigits } from '@/lib/amount';

/** Render-only states. Never use this presentation to seed targets or plan an action. */
export function positionLeveragePresentation(position: {
  side: 'long' | 'short';
  info: { rawColls: bigint; rawDebts: bigint; currentLeverage: number; lsdLeverage: number };
}): {
  state: 'available' | 'unavailable' | 'debt-free' | 'empty';
  text: string;
  explanation: string;
} {
  const { rawColls, rawDebts } = position.info;
  const unavailable = (explanation: string) => ({ state: 'unavailable' as const, text: 'Leverage unavailable', explanation });
  if (typeof rawColls !== 'bigint' || typeof rawDebts !== 'bigint' || rawColls < 0n || rawDebts < 0n || rawColls === 0n && rawDebts > 0n) {
    return unavailable('The current leverage metric cannot be provided because position accounting is invalid.');
  }
  if (rawColls === 0n && rawDebts === 0n) return { state: 'empty', text: 'No balance', explanation: 'This position has no collateral or debt.' };
  if (rawDebts === 0n) return { state: 'debt-free', text: 'No debt', explanation: 'This position has collateral and no debt.' };
  const value = position.side === 'short' ? position.info.lsdLeverage : position.info.currentLeverage;
  if (!Number.isFinite(value) || value <= 0) return unavailable('The current leverage metric cannot be provided for this position.');
  return { state: 'available', text: value < 0.005 ? '<0.01×' : `${value.toFixed(2).replace(/\.00$/, '')}×`, explanation: 'Leverage' };
}

/** Position accounting units only; wallet inputs and shared amount formatting are unchanged. */
export function positionTokenPresentation(raw: bigint, decimals: number, compact = false): {
  text: string;
  exact: string | null;
} {
  if (typeof raw !== 'bigint' || raw < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    return { text: 'Unavailable', exact: null };
  }
  const exact = formatUnits(raw, decimals);
  const full = groupDigits(exact);
  if (!compact) return { text: full, exact };
  const shortened = formatBalanceDecimal(exact, 8);
  return { text: shortened === full || shortened.startsWith('<') ? shortened : `≈ ${shortened}`, exact };
}
