export type LandingMetric = {
  value: number | null;
  status: 'fresh' | 'unavailable';
  fetchedAt: number | null;
  sourceAt?: number;
  source: 'aladdin' | 'defillama' | 'coingecko';
  sourceUrl: string;
};

export type LandingMarketData = {
  status: 'ready' | 'partial' | 'unavailable';
  fxSaveTvlUsd: LandingMetric;
  fxSaveApy: LandingMetric;
  ethUsd: LandingMetric;
  btcUsd: LandingMetric;
};

export const FX_SAVE_APY_ENDPOINT: string;
export const FX_SAVE_TOKEN_ADDRESS: string;
export const PRICE_ENDPOINT: string;
export const PRICE_SOURCE_URL: string;
export const FX_SAVE_SOURCE_URL: string;
export const PRICE_SOURCE_MAX_AGE_MS: number;
export const VAULT_FETCH_MAX_AGE_MS: number;
export function normalizeLandingMarketData(input: {
  pricePayload?: unknown;
  priceFetchedAt?: number;
  fxSavePayload?: unknown;
  fxSaveFetchedAt?: number;
  now?: number;
}): LandingMarketData;
export function validateLandingMarketData(payload: unknown, now?: number): LandingMarketData;
