import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { BRIDGE_PREVIEW_TTL, isFreshBridgePreview, readBridgeReceiptEstimate } from '../src/lib/fx/bridgePreview';
import { getPublicClient, resetPublicClientForTests } from '../src/lib/fx/clients';
import type { BridgeRouteQuote, PlannedRoute } from '../src/lib/fx/types';

const wallet = '0x1111111111111111111111111111111111111111' as Address;
const source = '0x2222222222222222222222222222222222222222' as Address;
const destination = '0x3333333333333333333333333333333333333333' as Address;
const abi = parseAbi(['function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),(uint256 nativeFee,uint256 lzTokenFee),address refundAddress)']);

function route(): PlannedRoute {
  const quote = {
    nativeFee: 123n, lzTokenFee: 0n, sourceOftAddress: source,
    destinationOftAddress: destination, destinationChainId: 8453, destinationEid: 30184,
    recipient: wallet, recipientBytes32: `0x${wallet.slice(2).padStart(64, '0')}` as Hex,
    amountLD: 1_234_567_890_123_456_789n, minAmountLD: 1_234_500_000_000_000_000n,
    extraOptions: '0x0003' as Hex, composeMsg: '0x' as Hex, oftCmd: '0x' as Hex,
    refundAddress: wallet, destinationBaselineBlock: 100n,
  } satisfies BridgeRouteQuote;
  const send = { dstEid: quote.destinationEid, to: quote.recipientBytes32,
    amountLD: quote.amountLD, minAmountLD: quote.minAmountLD,
    extraOptions: quote.extraOptions, composeMsg: quote.composeMsg, oftCmd: quote.oftCmd };
  return { operation: 'buildBridgeTx', chainId: 1, walletAddress: wallet, quote,
    transactions: [{ operation: 'buildBridgeTx', chainId: 1, from: wallet, to: source,
      kind: 'action', value: quote.nativeFee,
      data: encodeFunctionData({ abi, functionName: 'send', args: [send, { nativeFee: quote.nativeFee, lzTokenFee: 0n }, wallet] }) }] };
}

test('receipt preview binds every send field, preserves bigint precision, and fails closed on untrusted amounts', async () => {
  const previousUrl = process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL;
  process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL = 'https://eth-mainnet.g.alchemy.com/v2/test-key';
  resetPublicClientForTests();
  const client = getPublicClient(1);
  const originalRead = client.readContract;
  const planned = route();
  const quote = planned.quote as BridgeRouteQuote;
  let response: unknown;
  let calls = 0;
  client.readContract = (async (request: { address: Address; functionName: string; args: unknown[] }) => {
    calls += 1;
    assert.equal(request.address, source);
    assert.equal(request.functionName, 'quoteOFT');
    assert.deepEqual(request.args, [{ dstEid: 30184, to: quote.recipientBytes32,
      amountLD: quote.amountLD, minAmountLD: quote.minAmountLD,
      extraOptions: '0x0003', composeMsg: '0x', oftCmd: '0x' }]);
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof client.readContract;
  try {
    for (const received of [quote.amountLD, quote.minAmountLD, 1_234_550_000_000_000_001n]) {
      response = [{}, [], { amountSentLD: quote.amountLD, amountReceivedLD: received }];
      assert.equal(await readBridgeReceiptEstimate(planned), received);
    }
    for (const received of [quote.minAmountLD - 1n, quote.amountLD + 1n, -1n, Number(quote.amountLD), undefined]) {
      response = [{}, [], { amountReceivedLD: received }];
      assert.equal(await readBridgeReceiptEstimate(planned), undefined);
    }
    response = new Error('quoteOFT unsupported');
    assert.equal(await readBridgeReceiptEstimate(planned), undefined);
    const previousCalls = calls;
    await assert.rejects(() => readBridgeReceiptEstimate({ ...planned, quote: { ...quote, amountLD: quote.amountLD + 1n } }), /calldata amount/);
    assert.equal(calls, previousCalls, 'invalid route must fail before an RPC read');
  } finally {
    client.readContract = originalRead;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL;
    else process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL = previousUrl;
    resetPublicClientForTests();
  }
});

test('preview freshness rejects expired, future, and missing snapshots', () => {
  const preview = { readAt: 1_000, nativeFee: 1n, minimumReceived: 1n };
  assert.equal(isFreshBridgePreview(preview, 1_000), true);
  assert.equal(isFreshBridgePreview(preview, 1_000 + BRIDGE_PREVIEW_TTL - 1), true);
  assert.equal(isFreshBridgePreview(preview, 1_000 + BRIDGE_PREVIEW_TTL), false);
  assert.equal(isFreshBridgePreview(preview, 999), false);
  assert.equal(isFreshBridgePreview(undefined, 1_000), false);
});
