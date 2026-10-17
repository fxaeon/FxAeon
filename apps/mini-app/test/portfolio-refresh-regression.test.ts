import assert from 'node:assert/strict';
import test from 'node:test';
import { knownFreshPortfolioSubtotal } from '../src/lib/portfolioValuation';
import { mergeUsdPriceUpdate, priceRefreshDelay, startPriceRefreshLoop } from '../src/lib/priceRefresh';
import { USD_PRICE_MAX_AGE_MS } from '../src/lib/prices';
import type { UsdPriceSnapshot, UsdPriceUpdate } from '../src/lib/prices';
import type { WalletAsset, WalletAssetSnapshot } from '../src/lib/walletAssets';
import type { WalletBalancesResult } from '../src/lib/fx/balances';

const now = 1_800_000_000_000;
const address = '0x1111111111111111111111111111111111111111' as const;
const missing: UsdPriceSnapshot = { prices: {}, updatedAt: null, status: 'unavailable' };
const price: UsdPriceSnapshot = { prices: { ETH: 2_500 }, updatedAt: now, updatedAts: { ETH: now }, status: 'partial' };
const zeroToken = { key: 'USDC' as const, address, amountWei: 0n, decimals: 6 };
const eth = { key: 'ETH' as const, address, amountWei: 600_000_000_000_000n, decimals: 18 };
const balances: WalletBalancesResult = { balances: [eth, zeroToken], failedTokens: [] };
function row(overrides: Partial<WalletAsset> = {}): WalletAsset {
  return { id: '1:native', chainId: 1, network: 'ethereum', tokenAddress: null, canonicalKey: 'ETH',
    symbol: 'ETH', name: 'Ethereum', decimals: 18, balanceWei: eth.amountWei, balance: '0.0006',
    balanceUpdatedAt: now, priceUsd: 2_500, priceUpdatedAt: now, priceStatus: 'fresh', usdValue: 1.5,
    source: 'canonical', logoUrl: null, ...overrides };
}
function snapshot(assets: WalletAsset[]): WalletAssetSnapshot {
  return { walletAddress: address, assets, networks: {
    1: { chainId: 1, status: 'ready', error: '' }, 8453: { chainId: 8453, status: 'ready', error: '' },
  }, source: 'mixed', updatedAt: now, totalUsdValue: assets.reduce((sum, asset) => sum + (asset.usdValue ?? 0), 0),
  unpricedAssetCount: assets.filter((asset) => asset.balanceWei > 0n && asset.usdValue === null).length };
}

test('nonzero ETH without a quote plus an unrelated zero balance is unavailable, not $0', () => {
  assert.deepEqual(knownFreshPortfolioSubtotal(null, balances, now, missing, now), {
    totalUsd: null, assetCount: 1, hasKnownValue: false,
  });
});

test('expiring the only held-token price cannot turn a correct total into $0', () => {
  assert.equal(knownFreshPortfolioSubtotal(null, balances, now, price, now).totalUsd?.toFixed(2), '1.50');
  const staleAt = now - USD_PRICE_MAX_AGE_MS - 1;
  const stale = { ...price, updatedAt: staleAt, updatedAts: { ETH: staleAt } };
  assert.equal(knownFreshPortfolioSubtotal(null, balances, now, stale, now).totalUsd, null);
});

test('a merged row with the same balance timestamp retains its independent fresh quote', () => {
  assert.deepEqual(knownFreshPortfolioSubtotal(snapshot([row()]), balances, now, missing, now), {
    totalUsd: 1.5, assetCount: 1, hasKnownValue: true,
  });
});

test('a newer authoritative zero still removes a previously positive holding', () => {
  const old = snapshot([row({ balanceUpdatedAt: now - 1_000 })]);
  const next = { balances: [{ ...eth, amountWei: 0n }, zeroToken], failedTokens: [] };
  assert.deepEqual(knownFreshPortfolioSubtotal(old, next, now, missing, now), {
    totalUsd: 0, assetCount: 0, hasKnownValue: true,
  });
});

test('a newer changed balance is priced instead of an older expanded row', () => {
  const old = snapshot([row({ balanceUpdatedAt: now - 1_000 })]);
  const next = { balances: [{ ...eth, amountWei: 2n * 10n ** 18n }], failedTokens: [] };
  assert.equal(knownFreshPortfolioSubtotal(old, next, now, price, now).totalUsd, 5_000);
});

test('a stale positive row on another chain prevents unrelated zero from masquerading as empty', () => {
  const oldBase = snapshot([row({ id: '8453:native', chainId: 8453, network: 'base', balanceUpdatedAt: now - 120_001 })]);
  assert.equal(knownFreshPortfolioSubtotal(oldBase, { balances: [zeroToken], failedTokens: [] }, now, missing, now).totalUsd, null);
});

test('partial priced holdings still produce a useful subtotal without double counting', () => {
  const assets = snapshot([row(), row({ id: '8453:native', chainId: 8453, network: 'base', priceUsd: null, priceUpdatedAt: null, priceStatus: 'unavailable', usdValue: null })]);
  const result = knownFreshPortfolioSubtotal(assets, balances, now, price, now);
  assert.equal(result.totalUsd?.toFixed(2), '1.50');
  assert.equal(result.assetCount, 2);
  assert.equal(result.hasKnownValue, true);
});

test('same canonical token is counted once per chain, with same-chain duplicates deduplicated', () => {
  const fxUsdOnEthereum = row({ id: '1:fxusd-a', canonicalKey: 'fxUSD', symbol: 'fxUSD', name: 'fxUSD',
    tokenAddress: address, decimals: 18, balanceWei: 2n * 10n ** 18n, balance: '2', usdValue: 2 });
  const duplicateEthereumRow = { ...fxUsdOnEthereum, id: '1:fxusd-b' };
  const fxUsdOnBase = { ...fxUsdOnEthereum, id: '8453:fxusd', chainId: 8453 as const,
    network: 'base' as const, usdValue: 3 };
  const result = knownFreshPortfolioSubtotal(snapshot([fxUsdOnEthereum, duplicateEthereumRow, fxUsdOnBase]), null, null, missing, now);
  assert.deepEqual(result, { totalUsd: 5, assetCount: 2, hasKnownValue: true });
});

test('no data is unknown, while an authoritative zero remains zero', () => {
  assert.equal(knownFreshPortfolioSubtotal(null, null, null, missing, now).totalUsd, null);
  assert.equal(knownFreshPortfolioSubtotal(null, { balances: [zeroToken], failedTokens: [] }, now, missing, now).totalUsd, 0);
});

test('partial price progress retains a seven-minute ETH quote and its original timestamp', () => {
  const incoming: UsdPriceUpdate = { prices: { USDC: 1 }, updatedAt: now, updatedAts: { USDC: now } };
  const current = { ...price, updatedAt: now - 7 * 60_000, updatedAts: { ETH: now - 7 * 60_000 } };
  const merged = mergeUsdPriceUpdate(current, incoming, now);
  assert.equal(merged.prices.ETH, 2_500);
  assert.equal(merged.prices.USDC, 1);
  assert.equal(merged.updatedAts?.ETH, now - 7 * 60_000);
  assert.equal(merged.updatedAt, now - 7 * 60_000);
  assert.equal(current.prices.USDC, undefined);
  assert.equal(knownFreshPortfolioSubtotal(null, balances, now, merged, now).totalUsd?.toFixed(2), '1.50');
});

test('refresh merge keeps seven-minute quotes but drops older tokens independently', () => {
  const aged = { prices: { ETH: 2_500, FXN: 1 }, updatedAt: now - 7 * 60_000,
    updatedAts: { ETH: now - 7 * 60_000, FXN: now - USD_PRICE_MAX_AGE_MS - 1 }, status: 'partial' as const };
  const merged = mergeUsdPriceUpdate(aged, { prices: { USDC: 1 }, updatedAt: now,
    updatedAts: { USDC: now } }, now);
  assert.equal(merged.prices.ETH, 2_500);
  assert.equal(merged.prices.FXN, undefined);
  assert.equal(merged.prices.USDC, 1);
  assert.equal(merged.updatedAts?.ETH, now - 7 * 60_000);
});

test('successive partial quote batches keep the held-asset valuation stable', () => {
  const partial = mergeUsdPriceUpdate(price, { prices: { USDC: 1 }, updatedAt: now + 1_000, updatedAts: { USDC: now + 1_000 } }, now + 1_000);
  const final = mergeUsdPriceUpdate(partial, { prices: { ETH: 2_550 }, updatedAt: now + 2_000, updatedAts: { ETH: now + 2_000 } }, now + 2_000);
  assert.equal(knownFreshPortfolioSubtotal(null, balances, now, partial, now + 1_000).totalUsd?.toFixed(2), '1.50');
  assert.equal(knownFreshPortfolioSubtotal(null, balances, now, final, now + 2_000).totalUsd?.toFixed(2), '1.53');
});

test('an older response cannot overwrite a newer token price', () => {
  const result = mergeUsdPriceUpdate(price, { prices: { ETH: 2_000 }, updatedAt: now - 1_000, updatedAts: { ETH: now - 1_000 } }, now);
  assert.equal(result.prices.ETH, 2_500);
  assert.equal(result.updatedAts?.ETH, now);
});

test('expired, invalid and future prices are not revived during a refresh', () => {
  const expiredAt = now - USD_PRICE_MAX_AGE_MS - 1;
  const expired = { ...price, updatedAt: expiredAt, updatedAts: { ETH: expiredAt } };
  const result = mergeUsdPriceUpdate(expired, { prices: { ETH: 0, USDC: Number.NaN, WBTC: 100_000 }, updatedAt: now, updatedAts: { ETH: now, USDC: now, WBTC: now + 30_001 } }, now);
  assert.deepEqual(result.prices, {});
  assert.equal(result.updatedAt, null);
  assert.equal(result.status, 'unavailable');
});

test('per-token timestamps never inherit a different token\'s newer timestamp', () => {
  const result = mergeUsdPriceUpdate({ ...price, updatedAts: {} }, { prices: {}, updatedAt: now, updatedAts: {} }, now);
  assert.equal(result.prices.ETH, undefined);
});

function clock() {
  let next = 0;
  const jobs = new Map<number, { run: () => void; delay: number }>();
  return { jobs,
    schedule: (run: () => void, delay: number) => { const id = ++next; jobs.set(id, { run, delay }); return id; },
    cancel: (id: number) => { jobs.delete(id); },
    fire: () => { const entry = jobs.entries().next().value; assert.ok(entry); jobs.delete(entry[0]); entry[1].run(); },
  };
}
const settle = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

test('price progress cannot abort its own request; next poll waits for settlement', async () => {
  const timer = clock();
  let status: UsdPriceSnapshot['status'] = 'ready';
  let signal: AbortSignal | undefined;
  let finish!: () => void;
  const stop = startPriceRefreshLoop({ ...timer, getStatus: () => status, isActive: () => true,
    refresh: async (nextSignal) => { signal = nextSignal; status = 'partial'; await new Promise<void>((resolve) => { finish = resolve; }); status = 'ready'; },
  });
  assert.equal([...timer.jobs.values()][0].delay, 30_000);
  timer.fire();
  assert.equal(signal?.aborted, false);
  assert.equal(timer.jobs.size, 0);
  finish(); await settle();
  assert.equal(signal?.aborted, false);
  assert.equal(timer.jobs.size, 1);
  stop();
});

test('repeated failures retry even when status and timestamps never change', async () => {
  const timer = clock(); let attempts = 0;
  const stop = startPriceRefreshLoop({ ...timer, getStatus: () => 'unavailable', isActive: () => true,
    refresh: async () => { attempts += 1; throw new Error('offline'); },
  });
  timer.fire(); await settle(); timer.fire(); await settle();
  assert.equal(attempts, 2);
  assert.equal(timer.jobs.size, 1);
  assert.equal([...timer.jobs.values()][0].delay, 6_000);
  stop(); assert.equal(timer.jobs.size, 0);
});

test('same-timestamp successful results do not stop future refreshes', async () => {
  const timer = clock(); let attempts = 0;
  const stop = startPriceRefreshLoop({ ...timer, getStatus: () => 'partial', isActive: () => true,
    refresh: async () => { attempts += 1; },
  });
  timer.fire(); await settle(); timer.fire(); await settle();
  assert.equal(attempts, 2); assert.equal(timer.jobs.size, 1);
  assert.equal([...timer.jobs.values()][0].delay, 12_000);
  stop();
});

test('disposing the loop aborts in-flight work and never rearms', async () => {
  const timer = clock(); let signal: AbortSignal | undefined; let finish!: () => void;
  const stop = startPriceRefreshLoop({ ...timer, getStatus: () => 'ready', isActive: () => true,
    refresh: async (nextSignal) => { signal = nextSignal; await new Promise<void>((resolve) => { finish = resolve; }); },
  });
  timer.fire(); stop(); assert.equal(signal?.aborted, true);
  finish(); await settle(); assert.equal(timer.jobs.size, 0);
});

test('inactive pages neither schedule nor execute a polling request', () => {
  const timer = clock(); let active = false;
  const stop = startPriceRefreshLoop({ ...timer, getStatus: () => 'ready', isActive: () => active,
    refresh: async () => { assert.fail('inactive refresh'); },
  });
  assert.equal(timer.jobs.size, 0); stop();
  active = true;
  const stop2 = startPriceRefreshLoop({ ...timer, getStatus: () => 'ready', isActive: () => active,
    refresh: async () => { assert.fail('hidden refresh'); },
  });
  active = false; timer.fire(); assert.equal(timer.jobs.size, 0); stop2();
});

test('refresh cadence retains bounded ready, partial and failure intervals', () => {
  assert.equal(priceRefreshDelay('ready'), 30_000);
  assert.equal(priceRefreshDelay('partial'), 12_000);
  assert.equal(priceRefreshDelay('stale'), 12_000);
  assert.equal(priceRefreshDelay('unavailable'), 6_000);
});
