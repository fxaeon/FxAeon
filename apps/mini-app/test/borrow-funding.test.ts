import assert from 'node:assert/strict';
import { test } from 'node:test';
import { borrowFundingIsFresh, BORROW_FUNDING_MAX_AGE_MS, formatBorrowFundingApr, readBorrowFundingRate } from '../src/lib/fx/borrowFunding';
import { positionPoolAddress } from '../src/lib/fx/policy';
import type { FxPublicClient } from '../src/lib/fx/types';

const configuration = '0x16b334f2644cc00b85DB1A1efF0C2C395e00C28d';
const client = (readContract: (input: { address: string; functionName: string; args?: readonly unknown[] }) => Promise<unknown>, chainId = 1) => ({
  chain: { id: chainId }, getChainId: async () => chainId, readContract,
}) as unknown as FxPublicClient;

test('funding reads prove Ethereum and resolve each canonical long pool configuration', async () => {
  for (const market of ['ETH', 'BTC'] as const) {
    const calls: Array<{ address: string; functionName: string; args?: readonly unknown[] }> = [];
    const startedAt = Date.now();
    const rate = await readBorrowFundingRate(market, client(async input => {
      calls.push(input);
      return input.functionName === 'configuration' ? configuration : 35000000000000000n;
    }));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].address, positionPoolAddress(market, 'long'));
    assert.equal(calls[0].functionName, 'configuration');
    assert.equal(calls[1].address, configuration);
    assert.equal(calls[1].functionName, 'getLongPoolFundingRatio');
    assert.deepEqual(calls[1].args, [positionPoolAddress(market, 'long')]);
    assert.equal(rate.market, market);
    assert.equal(rate.pool, positionPoolAddress(market, 'long'));
    assert.equal(rate.ratio, 35000000000000000n);
    assert.ok(rate.readAt >= startedAt && rate.readAt <= Date.now());
  }
  let read = false;
  await assert.rejects(readBorrowFundingRate('ETH', client(async () => { read = true; return 0n; }, 8453)), /expected 1/);
  assert.equal(read, false);
});

test('zero is a verified value; malformed or failed reads cannot become a zero quote', async () => {
  const zero = await readBorrowFundingRate('ETH', client(async input => input.functionName === 'configuration' ? configuration : 0n));
  assert.equal(zero.ratio, 0n);
  for (const invalid of [-1n, 2n ** 256n, '0', null, undefined]) {
    await assert.rejects(readBorrowFundingRate('ETH', client(async input => input.functionName === 'configuration' ? configuration : invalid)), /ratio unavailable/);
  }
  for (const invalid of ['0x0000000000000000000000000000000000000000', 'invalid', null]) {
    await assert.rejects(readBorrowFundingRate('ETH', client(async () => invalid)), /configuration unavailable/);
  }
  await assert.rejects(readBorrowFundingRate('ETH', client(async () => { throw new Error('RPC unavailable'); })), /RPC unavailable/);
});

test('missing browser RPC configuration rejects asynchronously instead of crashing callers', async context => {
  const keys = ['NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL', 'NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL', 'NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL', 'NEXT_PUBLIC_FX_SCREENSHOT_MODE', 'NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE'];
  const previous = keys.map(key => process.env[key]);
  context.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  keys.forEach(key => { delete process.env[key]; });
  let pending: ReturnType<typeof readBorrowFundingRate> | undefined;
  assert.doesNotThrow(() => { pending = readBorrowFundingRate('ETH'); });
  await assert.rejects(pending!, /required for browser blockchain operations/);
});

test('the complete chain and funding read is bounded to twelve seconds', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const stalled = { chain: { id: 1 }, getChainId: () => new Promise(() => undefined) } as unknown as FxPublicClient;
  const rejected = assert.rejects(readBorrowFundingRate('ETH', stalled), /read deadline exceeded after 12000ms/);
  context.mock.timers.tick(12_000);
  await rejected;
});

test('freshness is strict, market-bound and pool-bound, including a previously verified zero', () => {
  const rate = { market: 'ETH' as const, pool: positionPoolAddress('ETH', 'long'), ratio: 0n, readAt: 1_000_000 };
  assert.equal(borrowFundingIsFresh(rate, 'ETH', rate.readAt), true);
  assert.equal(borrowFundingIsFresh(rate, 'ETH', rate.readAt + BORROW_FUNDING_MAX_AGE_MS - 1), true);
  assert.equal(borrowFundingIsFresh(rate, 'ETH', rate.readAt + BORROW_FUNDING_MAX_AGE_MS), false);
  assert.equal(borrowFundingIsFresh(rate, 'ETH', rate.readAt - 1), false);
  assert.equal(borrowFundingIsFresh(rate, 'BTC', rate.readAt), false);
  assert.equal(borrowFundingIsFresh({ ...rate, pool: positionPoolAddress('BTC', 'long') }, 'ETH', rate.readAt), false);
  assert.equal(borrowFundingIsFresh({ ...rate, ratio: -1n }, 'ETH', rate.readAt), false);
  assert.equal(borrowFundingIsFresh(null, 'ETH', rate.readAt), false);
});

test('annual 1e18 ratios are percentages of collateral and never round active funding to zero', () => {
  assert.equal(formatBorrowFundingApr(0n), '0%');
  assert.equal(formatBorrowFundingApr(10n ** 18n), '100%');
  assert.equal(formatBorrowFundingApr(10n ** 16n), '1%');
  assert.equal(formatBorrowFundingApr(35000000000000000n), '3.5%');
  assert.equal(formatBorrowFundingApr(12345678900000000n), '≈ 1.2345%');
  assert.equal(formatBorrowFundingApr(10n ** 12n), '0.0001%');
  assert.equal(formatBorrowFundingApr(1n), '<0.0001%');
  assert.throws(() => formatBorrowFundingApr(-1n), /nonnegative/);
});
