import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeFunctionData, erc20Abi, multicall3Abi, decodeFunctionResult, parseAbi, type Abi, type Address } from 'viem';
import { galleryGoldskyResult, galleryRpcResult } from '../e2e/fixtures/refinement-gallery';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { borrowFundingDisplay, readBorrowFundingRate } from '../src/lib/fx/borrowFunding';
import { BORROW_FUNDING_HISTORY_URL, readBorrowFundingHistory } from '../src/lib/fx/borrowFundingHistory';
import { readDebtRatioRange } from '../src/lib/fx/leverage';
import { positionPoolAddress } from '../src/lib/fx/policy';
import type { FxPublicClient } from '../src/lib/fx/types';

const owner = '0x930f0000000000000000000000000000000098b9' as const;
const balanceCall = { to: FX_TOKENS.USDC.address, data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [owner] }) };

test('gallery balances distinguish positive, verified zero, and failed reads', () => {
  assert.equal(BigInt(galleryRpcResult('eth_getBalance', [owner, 'latest'], 1) as string), 1_250_000_000_000_000_000n);
  assert.equal(BigInt(galleryRpcResult('eth_call', [balanceCall, 'latest'], 1) as string), 4_500_000_000n);
  assert.equal(galleryRpcResult('eth_getBalance', [owner, 'latest'], 1, 'zero'), '0x0');
  assert.equal(BigInt(galleryRpcResult('eth_call', [balanceCall, 'latest'], 1, 'zero') as string), 0n);
  assert.equal(galleryRpcResult('eth_chainId', [], 8453, 'unavailable'), '0x2105');
  assert.throws(() => galleryRpcResult('eth_getBalance', [owner, 'latest'], 1, 'unavailable'), /unavailable/);
  assert.throws(() => galleryRpcResult('eth_call', [balanceCall, 'latest'], 1, 'unavailable'), /unavailable/);
});

test('zero state propagates through multicall without fabricating unknown token balances', () => {
  const data = encodeFunctionData({ abi: multicall3Abi, functionName: 'aggregate3', args: [[
    { target: balanceCall.to, callData: balanceCall.data, allowFailure: true },
    { target: owner, callData: balanceCall.data, allowFailure: true },
  ]] });
  const result = galleryRpcResult('eth_call', [{ to: owner, data }, 'latest'], 1, 'zero') as `0x${string}`;
  const decoded = decodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', data: result });
  assert.equal(decoded[0].success, true);
  assert.equal(BigInt(decoded[0].returnData), 0n);
  assert.equal(decoded[1].success, false);
  assert.throws(() => galleryRpcResult('eth_call', [{ ...balanceCall, to: owner }, 'latest'], 1, 'zero'), /does not define balanceOf/);
});

test('gallery never supports wallet signing or transaction broadcasts', () => {
  for (const state of ['funded', 'zero', 'unavailable'] as const) {
    for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign', 'eth_signTypedData_v4']) {
      assert.throws(() => galleryRpcResult(method, [], 1, state));
    }
  }
});

test('funded and empty-wallet gallery states supply pool-bound funding and live borrowing limits', async () => {
  for (const state of ['funded', 'zero'] as const) {
    const reader = { chain: { id: 1 }, getChainId: async () => 1,
      readContract: async (input: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }) => {
        const data = encodeFunctionData({ abi: input.abi, functionName: input.functionName, args: input.args });
        const result = galleryRpcResult('eth_call', [{ to: input.address, data }, 'latest'], 1, state) as `0x${string}`;
        return decodeFunctionResult({ abi: input.abi, functionName: input.functionName, data: result });
      },
    } as unknown as FxPublicClient;
    for (const market of ['ETH', 'BTC'] as const) {
      const rate = await readBorrowFundingRate(market, reader);
      assert.equal(rate.ratio, 45_318_576_060_452_136n);
      assert.equal(rate.netRatio, rate.ratio);
      assert.deepEqual({ value: borrowFundingDisplay(rate).value, status: borrowFundingDisplay(rate).status }, { value: '≈ 0.0041% / 8h', status: 'On' });
      const limits = await readDebtRatioRange(market, 'long', reader);
      assert.equal(limits.source, 'live');
      assert.equal(limits.min, 25_600_000_000_000_000n);
      assert.equal(limits.max, 855_000_000_000_000_000n);
    }
  }
});

test('gallery funding history works through the real market-specific loader and preserves unavailable state', async () => {
  const now = 1_800_000_000_000;
  for (const market of ['ETH', 'BTC'] as const) {
    const history = await readBorrowFundingHistory(market, { now, fetch: async (url, options) => Response.json(galleryGoldskyResult(String(url), JSON.parse(options!.body as string), 'funded', now)) });
    assert.equal(history.market, market);
    assert.equal(history.snapshots.length, 32);
    assert.equal(history.snapshots[0].ratio, 0n);
    assert.equal(history.snapshots.at(-1)!.ratio, 45_318_576_060_452_136n);
    assert.ok(history.averageRatio! > 0n);
    assert.ok(history.averageRatio! < history.snapshots.at(-1)!.ratio);
  }
  const query = { query: '{ snapshots(first: 1000, where: { timestamp_gte: "1797408000", fundingId_: {type: "wstETH"}}) { fundingRate timestamp } }' };
  assert.throws(() => galleryGoldskyResult(BORROW_FUNDING_HISTORY_URL, query, 'unavailable', now), /unavailable/);
  assert.throws(() => galleryGoldskyResult(BORROW_FUNDING_HISTORY_URL, { query: 'mutation { something }' }), /defined read/);
  assert.throws(() => galleryGoldskyResult('https://api.goldsky.com/api/public/unknown', query), /does not define/);
});

test('funding fixtures reject unrelated contracts, pools, chains and selectors', () => {
  const configuration = '0x16b334f2644cc00b85DB1A1efF0C2C395e00C28d';
  const abi = parseAbi(['function getLongPoolFundingRatio(address pool) view returns (uint256)']);
  const data = encodeFunctionData({ abi, functionName: 'getLongPoolFundingRatio', args: [positionPoolAddress('ETH', 'long')] });
  assert.throws(() => galleryRpcResult('eth_call', [{ to: owner, data }], 1));
  assert.throws(() => galleryRpcResult('eth_call', [{ to: configuration, data }], 8453));
  const wrongPool = encodeFunctionData({ abi, functionName: 'getLongPoolFundingRatio', args: [positionPoolAddress('ETH', 'short')] });
  assert.throws(() => galleryRpcResult('eth_call', [{ to: configuration, data: wrongPool }], 1), /canonical pool/);
  assert.throws(() => galleryRpcResult('eth_call', [{ to: configuration, data: '0xdeadbeef' }], 1));
  assert.throws(() => galleryRpcResult('eth_call', [{ to: configuration, data }], 1, 'unavailable'), /unavailable/);
});
