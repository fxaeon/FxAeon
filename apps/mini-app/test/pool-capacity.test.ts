import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePoolCapacity, readPoolCapacity, poolCapacityUnits } from '../src/lib/fx/poolCapacity';
import { formatUnits } from 'viem';
import type { FxPublicClient } from '../src/lib/fx/types';

test('long and short capacity tuples preserve exact native token units', () => {
  const long = parsePoolCapacity([100n, 25n, 999n, 200n, 50n], 'long');
  assert.equal(long.collateralRemaining, 75n);
  assert.equal(long.debtRemaining, 150n);
  assert.equal(parsePoolCapacity([100n, 25n, 200n, 50n], 'short').debtRemaining, 150n);
  assert.equal(parsePoolCapacity([10n, 20n, 0n, 30n, 40n], 'long').debtRemaining, 0n);
  assert.equal(parsePoolCapacity([10n, 20n, 0n, 30n, 40n], 'long').collateralRemaining, 0n);
});

test('capacity display distinguishes physical long collateral from normalized short debt', () => {
  assert.equal(poolCapacityUnits('BTC', 'long').collateralDecimals, 8);
  assert.equal(poolCapacityUnits('BTC', 'short').debtDecimals, 18);
  assert.equal(poolCapacityUnits('ETH', 'long').collateralSymbol, 'wstETH');
  assert.equal(poolCapacityUnits('ETH', 'short').debtSymbol, 'stETH equivalent');
  const rawShortRoom = parsePoolCapacity([100n, 20n, 10n ** 18n, 0n], 'short').debtRemaining;
  assert.equal(formatUnits(rawShortRoom, poolCapacityUnits('BTC', 'short').debtDecimals), '1');
  assert.equal(poolCapacityUnits('ETH', 'short').collateralSymbol, 'fxUSD');
});

test('capacity rejects malformed tuples instead of inventing zero availability', () => {
  for (const value of [null, [], [1n, 2n, 3n, 4n], [1n, 2n, 3n, 4n, -1n], [1n, 2n, 3n, 4n, 1], [1n, 2n, 3n, 4n, 1n << 256n]]) {
    assert.throws(() => parsePoolCapacity(value, 'long'));
  }
  assert.throws(() => parsePoolCapacity([1n, 2n, 3n, 4n, 5n], 'short'));
});

test('capacity reader refuses an unexpected pool manager', async () => {
  let calls = 0;
  const client = { getChainId: async () => 1, readContract: async () => { calls++; return '0x0000000000000000000000000000000000000001'; } } as unknown as FxPublicClient;
  await assert.rejects(readPoolCapacity('ETH', 'long', client), /Pool manager unavailable/);
  assert.equal(calls, 1);
});

test('capacity reader uses the selected short manager and correct tuple layout', async () => {
  const calls: Array<{ address: string; functionName: string }> = [];
  const client = { getChainId: async () => 1, readContract: async (request: { address: string; functionName: string }) => {
    calls.push(request);
    return request.functionName === 'poolManager' ? '0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D' : [100n, 20n, 70n, 30n];
  } } as unknown as FxPublicClient;
  const result = await readPoolCapacity('BTC', 'short', client);
  assert.equal(result.market, 'BTC');
  assert.equal(result.side, 'short');
  assert.equal(result.collateralRemaining, 80n);
  assert.equal(result.debtRemaining, 40n);
  assert.equal(calls[1].address, '0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D');
  assert.equal(calls[1].functionName, 'getPoolInfo');
  assert.ok(result.readAt <= Date.now());
});
