import test from 'node:test';
import assert from 'node:assert/strict';
import { oracleUsdPrice, oracleMarketDifference, readOracleObservation, type OracleObservation } from '../src/lib/fx/oracleComparison';
import type { FxPublicClient } from '../src/lib/fx/types';
import type { UsdPriceSnapshot } from '../src/lib/prices';

const wad = 10n ** 18n;
test('oracle conversions preserve token USD basis and invert short anchors', () => {
  assert.equal(oracleUsdPrice([2000n * wad, 1990n * wad, 2010n * wad], 'long'), 2000);
  assert.equal(oracleUsdPrice([wad / 2500n, wad / 2600n, wad / 2400n], 'short'), 2500);
  assert.equal(oracleUsdPrice([wad / 100000n, wad / 110000n, wad / 90000n], 'short'), 99999.99999999999);
  for (const tuple of [[0n, 0n, 0n], [1n, 2n, 3n], [1n, 1n], [1n, 1n, 1], [1n << 256n, 1n, 1n << 256n]]) assert.throws(() => oracleUsdPrice(tuple, 'long'));
});

test('oracle comparison uses exact token quotes and bounded observation skew', () => {
  const now = 1_800_000_000_000;
  const oracle: OracleObservation = { market: 'ETH', side: 'long', token: 'stETH', usd: 2020, readAt: now - 1000, blockAt: now - 12000, blockNumber: 100n };
  const prices: UsdPriceSnapshot = { status: 'ready', prices: { ETH: 5000, wstETH: 2500, stETH: 2000 }, updatedAt: now - 10000 };
  assert.ok(Math.abs(oracleMarketDifference(oracle, prices, now)!.percent - 1) < 1e-10);
  assert.equal(oracleMarketDifference(oracle, { ...prices, prices: { ETH: 2020 } }, now), null);
  assert.equal(oracleMarketDifference(oracle, { ...prices, status: 'stale' }, now), null);
  assert.equal(oracleMarketDifference(oracle, { ...prices, updatedAt: now - 300001 }, now), null);
  assert.equal(oracleMarketDifference({ ...oracle, readAt: now - 60000 }, prices, now), null);
  assert.equal(oracleMarketDifference(oracle, { ...prices, updatedAt: now + 1 }, now), null);
});

test('reader binds oracle discovery and price to one block, validates deployment and inverts shorts', async () => {
  const calls: Array<{ functionName: string; blockNumber?: bigint }> = [];
  const client = { getChainId: async () => 1, getBlockNumber: async () => 123n, getBlock: async () => ({ timestamp: BigInt(Math.floor(Date.now() / 1000)) }), readContract: async (request: { functionName: string; blockNumber?: bigint }) => {
    calls.push(request);
    if (request.functionName === 'priceOracle') return '0x222786833b5fd5eE21532d8b576391bAbeFdAAd1';
    if (request.functionName === 'oracle') return '0x0C5C61025f047cB7e3e85852dC8eAFd7b9a4Abfb';
    if (request.functionName === 'rateProvider') return '0x81A777c4aB65229d1Bf64DaE4c831bDf628Ccc7f';
    return [wad / 2500n, wad / 2600n, wad / 2400n];
  } } as unknown as FxPublicClient;
  const observation = await readOracleObservation('ETH', 'short', client);
  assert.equal(observation.token, 'wstETH');
  assert.equal(observation.usd, 2500);
  assert.equal(observation.blockNumber, 123n);
  assert.ok(calls.every(call => call.blockNumber === 123n));
  await assert.rejects(readOracleObservation('BTC', 'short', client), /basis not verified/);
});

test('oracle metadata and discovery start together with same-block validation', async () => {
  let resolveBlock!: (block: { timestamp: bigint }) => void;
  let discoveryStarted = false;
  let priceReadStarted = false;
  const block = new Promise<{ timestamp: bigint }>(resolve => { resolveBlock = resolve; });
  const client = {
    getChainId: async () => 1, getBlockNumber: async () => 123n,
    getBlock: ({ blockNumber }: { blockNumber: bigint }) => { assert.equal(blockNumber, 123n); return block; },
    readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber: bigint }) => {
      assert.equal(blockNumber, 123n);
      if (functionName === 'priceOracle') { discoveryStarted = true; return '0x0C5C61025f047cB7e3e85852dC8eAFd7b9a4Abfb'; }
      priceReadStarted = true; return [2000n * wad, 1990n * wad, 2010n * wad];
    },
  } as unknown as FxPublicClient;
  const pending = readOracleObservation('ETH', 'long', client);
  await new Promise<void>(resolve => setImmediate(resolve));
  const startedBeforeBlock = discoveryStarted;
  assert.equal(priceReadStarted, false);
  resolveBlock({ timestamp: BigInt(Math.floor(Date.now() / 1000)) });
  const observation = await pending;
  assert.equal(startedBeforeBlock, true);
  assert.equal(observation.usd, 2000);
  assert.equal(observation.blockNumber, 123n);
});
