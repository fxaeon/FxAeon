import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPublicClient, custom, encodeFunctionData, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import type { Page, Route } from '@playwright/test';
import { EARN_GALLERY_HEAD, EARN_GALLERY_LABEL, EARN_GALLERY_NOW, earnGalleryMarketResponse, installEarnMarketFixture } from '../e2e/fixtures/earn-market';
import { galleryRpcResult } from '../e2e/fixtures/refinement-gallery';
import { FX_SAVE_APY_ENDPOINT, FX_SAVE_TOKEN_ADDRESS, parseFxSaveApyResponse } from '../src/lib/fxSaveApy';
import { fetchFxSaveShareHistory, type NavHistoryReader } from '../src/lib/fxSaveShareHistory';
import { HISTORY_DAY_MS, navHistoryRange, trailingNavReturns } from '../src/lib/fxSavePerformance';

const ABI = parseAbi(['function nav() view returns (uint256)', 'function getCurrentBlockTimestamp() view returns (uint256)']);

test('synthetic Earn market data uses the actual official token-bound APY/TVL parser', () => {
  assert.deepEqual(parseFxSaveApyResponse(earnGalleryMarketResponse(), EARN_GALLERY_NOW), {
    apy: 8.4, tvlUsd: 12_500_000, observedAt: EARN_GALLERY_NOW,
  });
  assert.equal(EARN_GALLERY_LABEL, 'Synthetic gallery data');
});

test('real viem block/multicall decoding feeds complete 30D and 90D production NAV histories including warmup', async () => {
  const methods = new Set<string>();
  const client = createPublicClient({ chain: mainnet, transport: custom({ request: async ({ method, params }) => {
    methods.add(method);
    return galleryRpcResult(method, (params ?? []) as unknown[], 1, 'funded', EARN_GALLERY_NOW);
  } }) });
  const reader: NavHistoryReader = {
    head: async () => (await client.getBlock({ blockTag: 'finalized' })).number!,
    blockTimestamp: async blockNumber => Number((await client.getBlock({ blockNumber })).timestamp) * 1000,
    sample: blockNumber => client.multicall({ blockNumber, allowFailure: false, contracts: [
      { address: '0xcA11bde05977b3631167028862bE2a173976CA11', abi: ABI, functionName: 'getCurrentBlockTimestamp' },
      { address: FX_SAVE_TOKEN_ADDRESS, abi: ABI, functionName: 'nav' },
    ] }),
  };
  assert.equal(await reader.head(), EARN_GALLERY_HEAD);
  for (const days of [30, 90] as const) {
    const points = await fetchFxSaveShareHistory(undefined, days, { reader, now: EARN_GALLERY_NOW });
    assert.equal(points.length, days + 31);
    const shares = navHistoryRange(points, days, points.at(-1)!.timestamp);
    const yields = navHistoryRange(trailingNavReturns(points), days, points.at(-1)!.timestamp);
    assert.equal(shares.length, days + 1);
    assert.equal(yields.length, days + 1, 'no missing 30-day return anchors');
    assert.equal(shares.at(-1)!.timestamp - shares[0].timestamp, days * HISTORY_DAY_MS);
    assert.ok(yields.every(point => point.value > 0 && point.value < 20));
    assert.ok(shares.every((point, index) => index === 0 || point.price > shares[index - 1].price));
  }
  assert.deepEqual([...methods].sort(), ['eth_call', 'eth_getBlockByNumber']);
});

test('archive reads are deterministic, wallet-independent, contract/block-bound and read-only', () => {
  const nav = { to: FX_SAVE_TOKEN_ADDRESS, data: encodeFunctionData({ abi: ABI, functionName: 'nav' }) };
  const params = [nav, 'latest'];
  assert.equal(galleryRpcResult('eth_call', params, 1, 'funded', EARN_GALLERY_NOW), galleryRpcResult('eth_call', params, 1, 'zero', EARN_GALLERY_NOW));
  assert.deepEqual(galleryRpcResult('eth_getBlockByNumber', ['finalized', false], 1, 'funded', EARN_GALLERY_NOW),
    galleryRpcResult('eth_getBlockByNumber', ['finalized', false], 1, 'funded', EARN_GALLERY_NOW));
  for (const block of ['pending', '0xffffffffff', '0x1']) assert.throws(() => galleryRpcResult('eth_call', [nav, block], 1, 'funded', EARN_GALLERY_NOW));
  assert.throws(() => galleryRpcResult('eth_call', [nav, 'latest'], 8453, 'funded', EARN_GALLERY_NOW));
  assert.throws(() => galleryRpcResult('eth_call', [{ ...nav, to: `0x${'11'.repeat(20)}` }, 'latest'], 1, 'funded', EARN_GALLERY_NOW));
  assert.throws(() => galleryRpcResult('eth_call', params, 1, 'unavailable', EARN_GALLERY_NOW));
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign']) assert.throws(() => galleryRpcResult(method, [], 1, 'funded', EARN_GALLERY_NOW));
});

test('official APY fixture route accepts only GET and keeps unavailable responses distinct', async () => {
  for (const available of [true, false]) {
    let handler: (route: Route) => unknown;
    const page = { route: async (url: string, callback: typeof handler) => { assert.equal(url, FX_SAVE_APY_ENDPOINT); handler = callback; } } as unknown as Page;
    await installEarnMarketFixture(page, available);
    let response: { status: number; body: string } | undefined;
    let aborted = false;
    const route = (method: string) => ({ request: () => ({ method: () => method }),
      fulfill: async (options: typeof response) => { response = options; }, abort: async () => { aborted = true; } }) as unknown as Route;
    await handler!(route('GET'));
    assert.equal(response!.status, available ? 200 : 503);
    if (available) assert.equal(parseFxSaveApyResponse(JSON.parse(response!.body)).apy, 8.4);
    else assert.throws(() => parseFxSaveApyResponse(JSON.parse(response!.body)));
    response = undefined;
    await handler!(route('POST'));
    assert.equal(aborted, true); assert.equal(response, undefined);
  }
});
