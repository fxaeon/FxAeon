/**
 * Non-authoritative, device-local preferences shared by protocol forms.
 * Nothing in this file is used as protocol state or wallet authorization.
 */
export const SETTINGS_KEY = 'fxaeon.settings.v1';
export const SETTINGS_UPDATED_EVENT = 'fxaeon:settings-updated';
export const DEFAULT_SLIPPAGE_PERCENT = 0.5;
export const GAS_TIERS = ['standard', 'fast', 'rapid'] as const;
export type GasTier = (typeof GAS_TIERS)[number];
export const DEFAULT_GAS_TIER: GasTier = 'standard';
/** Quick choices; any whole basis point from 0.1% to the protocol's 2% cap can be saved. */
export const SLIPPAGE_PRESETS_BPS = [10, 50, 100, 200] as const;
export const MIN_SLIPPAGE_BPS = 10;
export const MAX_SLIPPAGE_BPS = 200;

export function isSlippageBps(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_SLIPPAGE_BPS && value <= MAX_SLIPPAGE_BPS;
}

export function readGasTier(): GasTier {
  if (typeof window === 'undefined') return DEFAULT_GAS_TIER;
  try {
    const value = (JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}') as { gasTier?: unknown }).gasTier;
    return GAS_TIERS.includes(value as GasTier) ? value as GasTier : DEFAULT_GAS_TIER;
  } catch {
    return DEFAULT_GAS_TIER;
  }
}

export function readSlippagePercent(): number {
  if (typeof window === 'undefined') return DEFAULT_SLIPPAGE_PERCENT;
  try {
    const value = (JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}') as { slippageBps?: unknown }).slippageBps;
    return isSlippageBps(value) ? value / 100 : DEFAULT_SLIPPAGE_PERCENT;
  } catch {
    return DEFAULT_SLIPPAGE_PERCENT;
  }
}

/**
 * Save one or both transaction preferences and tell every open form at once.
 * Invalid values are ignored rather than stored; returns whether anything saved.
 */
export function writeTransactionSettings(patch: { slippageBps?: number; gasTier?: GasTier }): boolean {
  if (typeof window === 'undefined') return false;
  const slippageBps = patch.slippageBps !== undefined && isSlippageBps(patch.slippageBps) ? patch.slippageBps : undefined;
  const gasTier = patch.gasTier !== undefined && GAS_TIERS.includes(patch.gasTier) ? patch.gasTier : undefined;
  if (slippageBps === undefined && gasTier === undefined) return false;
  try {
    let previous: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) previous = parsed as Record<string, unknown>;
    } catch { previous = {}; }
    const next = { ...previous, ...(slippageBps !== undefined ? { slippageBps } : {}), ...(gasTier ? { gasTier } : {}) };
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    announceSettingsUpdated(isSlippageBps(next.slippageBps) ? next.slippageBps : Math.round(DEFAULT_SLIPPAGE_PERCENT * 100), gasTier);
    return true;
  } catch {
    return false;
  }
}

/** Notify already-open protocol surfaces that device preferences changed. */
export function announceSettingsUpdated(slippageBps: number, gasTier?: GasTier): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT, { detail: { slippageBps, ...(gasTier ? { gasTier } : {}) } }));
}
