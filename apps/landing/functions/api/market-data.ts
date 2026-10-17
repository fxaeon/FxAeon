import { onRequest as handleMarketDataRequest } from '../../market-data-server.mjs';

export async function onRequest(context: { request: Request }): Promise<Response> {
  return handleMarketDataRequest(context);
}
