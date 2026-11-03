import { validateLandingMarketData } from './market-data.mjs';

export const LANDING_MARKET_DATA_EVENT = 'fxaeon:market-data';
export const LANDING_MARKET_DATA_ENDPOINT = '/api/market-data';
export const LANDING_MARKET_DATA_REFRESH_MS = 60_000;
export const LANDING_MARKET_DATA_TIMEOUT_MS = 10_000;

function metric(source, sourceUrl) {
  return { value: null, status: 'loading', fetchedAt: null, source, sourceUrl };
}

export function initialLandingMarketData() {
  return {
    status: 'loading',
    fxSaveTvlUsd: metric('aladdin', 'https://fx.aladdin.club/earn'),
    fxSaveApy: metric('aladdin', 'https://fx.aladdin.club/earn'),
    ethUsd: metric('aladdin', 'https://fx.aladdin.club'),
    btcUsd: metric('aladdin', 'https://fx.aladdin.club'),
  };
}

function publish(target, snapshot) {
  target.__fxaeonMarketData = snapshot;
  target.dispatchEvent(new CustomEvent(LANDING_MARKET_DATA_EVENT, { detail: snapshot }));
}

function unavailableSnapshot(now) {
  return validateLandingMarketData(null, now);
}

/**
 * Publish a validated same-origin public feed to static landing-page clients.
 * Polling is foreground-only; no data is kept alive by a background tab.
 */
export function startLandingMarketData({
  target = globalThis.window,
  fetchImpl = globalThis.fetch,
  endpoint = LANDING_MARKET_DATA_ENDPOINT,
  refreshMs = LANDING_MARKET_DATA_REFRESH_MS,
  timeoutMs = LANDING_MARKET_DATA_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  if (!target || typeof target.addEventListener !== 'function' || typeof fetchImpl !== 'function') {
    throw new TypeError('A browser target and fetch implementation are required');
  }

  let timer;
  let controller;
  let stopped = false;
  let generation = 0;

  const clearTimer = () => {
    if (timer !== undefined) target.clearTimeout(timer);
    timer = undefined;
  };
  const abort = () => {
    controller?.abort();
    controller = undefined;
  };
  const schedule = () => {
    clearTimer();
    if (!stopped && target.document?.visibilityState !== 'hidden' && target.navigator?.onLine !== false) {
      timer = target.setTimeout(() => { void refresh(); }, refreshMs);
    }
  };

  async function refresh() {
    clearTimer();
    const requestGeneration = ++generation;
    abort();
    // A tab may resume after the provider timestamp aged out while hidden.
    // Revalidate synchronously before the network request so expired values
    // disappear immediately instead of lingering through the fetch deadline.
    const current = target.__fxaeonMarketData;
    if (!stopped && current && current.status !== 'loading') {
      publish(target, validateLandingMarketData(current, now()));
    }
    if (stopped || target.document?.visibilityState === 'hidden' || target.navigator?.onLine === false) {
      if (!stopped && requestGeneration === generation) publish(target, unavailableSnapshot(now()));
      return;
    }

    const requestController = new AbortController();
    controller = requestController;
    const timeout = target.setTimeout(() => requestController.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        signal: requestController.signal,
      });
      if (!response.ok) throw new Error('Landing market data is unavailable');
      const snapshot = validateLandingMarketData(await response.json(), now());
      if (!stopped && requestGeneration === generation) publish(target, snapshot);
    } catch {
      if (!stopped && requestGeneration === generation) publish(target, unavailableSnapshot(now()));
    } finally {
      target.clearTimeout(timeout);
      if (controller === requestController) controller = undefined;
      if (!stopped && requestGeneration === generation) schedule();
    }
  }

  const onVisibilityChange = () => {
    if (target.document?.visibilityState === 'hidden') {
      generation += 1;
      clearTimer();
      abort();
      return;
    }
    void refresh();
  };
  const onNetworkChange = () => {
    if (target.navigator?.onLine === false) {
      generation += 1;
      clearTimer();
      abort();
      if (!stopped) publish(target, unavailableSnapshot(now()));
    } else void refresh();
  };

  target.addEventListener('online', onNetworkChange);
  target.addEventListener('offline', onNetworkChange);
  target.document?.addEventListener('visibilitychange', onVisibilityChange);
  publish(target, initialLandingMarketData());
  void refresh();

  return {
    refresh,
    stop() {
      stopped = true;
      generation += 1;
      clearTimer();
      abort();
      target.removeEventListener('online', onNetworkChange);
      target.removeEventListener('offline', onNetworkChange);
      target.document?.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
