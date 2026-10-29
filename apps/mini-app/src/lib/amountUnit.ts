import { useCallback, useSyncExternalStore } from 'react';

/**
 * Which unit leads every amount: the token itself, or its USD estimate.
 * One device-local display preference, like Jumper's fiat toggle: switching it
 * anywhere switches every open form, preview, review and receipt at once.
 * Display only; transactions are always built and signed in token units.
 */
export type AmountUnit = 'token' | 'usd';

export const AMOUNT_UNIT_KEY = 'fxaeon.amount-unit.v1';
const listeners = new Set<() => void>();
let memory: AmountUnit = 'token';

export function readAmountUnit(): AmountUnit {
  if (typeof window === 'undefined') return 'token';
  try {
    const stored = window.localStorage.getItem(AMOUNT_UNIT_KEY);
    if (stored === 'usd' || stored === 'token') memory = stored;
  } catch { /* storage blocked: keep this page's choice */ }
  return memory;
}

export function writeAmountUnit(unit: AmountUnit): void {
  if (unit !== 'token' && unit !== 'usd') return;
  memory = unit;
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(AMOUNT_UNIT_KEY, unit); } catch { /* storage blocked */ }
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab's choice applies here too.
  const onStorage = (event: StorageEvent) => { if (event.key === AMOUNT_UNIT_KEY) listener(); };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** The reader's unit; static rendering always starts in tokens. */
export function useAmountUnit(): [AmountUnit, () => void] {
  const unit = useSyncExternalStore(subscribe, readAmountUnit, () => 'token' as const);
  const toggle = useCallback(() => writeAmountUnit(readAmountUnit() === 'usd' ? 'token' : 'usd'), []);
  return [unit, toggle];
}
