export const REQUEST_TIMEOUT_MS: number;
export const MAX_RESPONSE_BYTES: number;
export const CACHE_TTL_MS: number;
export type MarketDataRequestContext = { request: Request };
export type LandingMarketDataHandlerOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  cacheTtlMs?: number;
};
export function createLandingMarketDataHandler(options?: LandingMarketDataHandlerOptions):
  (context: MarketDataRequestContext) => Promise<Response>;
export const onRequest: (context: MarketDataRequestContext) => Promise<Response>;
export const handleMarketDataRequest: (context: MarketDataRequestContext) => Promise<Response>;
