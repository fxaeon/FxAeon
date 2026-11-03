import { expect, test } from '@playwright/test';
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from 'viem';
import { OFT_RECEIVED_EVENT, OFT_SENT_EVENT } from '../../src/lib/fx/bridgeDelivery';
import { openHarness } from '../harness/action-review-measurement-support';

const SOURCE = '0x1111111111111111111111111111111111111122' as Address;
const DESTINATION = '0x2222222222222222222222222222222222222233' as Address;
const WALLET = '0x00000000000000000000000000000000000000aa' as Address;
const GUID = `0x${'ab'.repeat(32)}` as Hex;
const SOURCE_HASH = `0x${'11'.repeat(32)}` as Hex;
const DESTINATION_HASH = `0x${'34'.repeat(32)}` as Hex;
const BLOCK_HASH = `0x${'56'.repeat(32)}` as Hex;
const amount = 10n ** 18n;
const received = 999900000000000000n;
const sent = { address: SOURCE,
  topics: encodeEventTopics({ abi: [OFT_SENT_EVENT], eventName: 'OFTSent', args: { guid: GUID, fromAddress: WALLET } }),
  data: encodeAbiParameters([{type:'uint32'}, {type:'uint256'}, {type:'uint256'}], [30184, amount, received]), transactionHash: SOURCE_HASH };
function destinationLog(guid: Hex) {
  return { address: DESTINATION,
    topics: encodeEventTopics({ abi: [OFT_RECEIVED_EVENT], eventName: 'OFTReceived', args: { guid, toAddress: WALLET } }),
    data: encodeAbiParameters([{type:'uint32'}, {type:'uint256'}], [30101, received]), transactionHash: DESTINATION_HASH, blockHash: BLOCK_HASH };
}

test('Move source confirmation remains pending for a mismatched event until matching destination delivery is verified', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('**/*', route => route.abort());
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  await openHarness(page, { bridgeDelivery: true });
  await page.evaluate(({ source, destination, wallet, hash, sent, mismatch, match }) => {
    const h = (globalThis as any).__actionReviewHarness;
    h.bridgeRpc = { hash, sent, mismatch, match, delivered: false, sourceReads: 0, queries: [] };
    h.reviewRoute = { operation:'buildBridgeTx', chainId:1, walletAddress:wallet,
      transactions:[{ chainId:1, from:wallet, to:source, data:'0x12345678', value:0n, kind:'action', type:'buildBridgeTx', operation:'buildBridgeTx' }],
      quote:{ nativeFee:0n, destinationChainId:8453, sourceOftAddress:source, destinationOftAddress:destination,
        bridgeToken:'fxUSD', bridgeAmount:1000000000000000000n, amountLD:1000000000000000000n,
        minAmountLD:990000000000000000n, estimatedReceived:995000000000000000n,
        destinationBaselineBlock:100n, recipient:wallet }, details:{routeType:'Fixture bridge'} };
    h.deferReceipt = true; h.rerender();
  }, { source: SOURCE, destination: DESTINATION, wallet: WALLET, hash: SOURCE_HASH, sent,
    mismatch: destinationLog(`0x${'cd'.repeat(32)}`), match: destinationLog(GUID) });
  await page.getByRole('button', { name:'Review position', exact:true }).click();
  await page.locator('[data-review-actions] button').click();
  await expect.poll(() => page.evaluate(() => (globalThis as any).__actionReviewHarness.receiptResolvers.length)).toBe(1);
  await page.evaluate(() => (globalThis as any).__actionReviewHarness.receiptResolvers.shift()());
  const bridge = page.locator('[data-bridge-state]');
  await expect(bridge).toHaveAttribute('data-bridge-state', 'source_confirmed');
  await expect(bridge).toContainText('Bridge in progress');
  await expect(bridge).toContainText('Estimated');
  await expect.poll(() => page.evaluate(() => (globalThis as any).__actionReviewHarness.bridgeRpc.queries.length)).toBeGreaterThan(0);
  await expect(bridge).not.toContainText('fxUSD received on Base');
  expect(await page.evaluate(() => (globalThis as any).__actionReviewHarness.sendCount)).toBe(1);
  await page.evaluate(() => { (globalThis as any).__actionReviewHarness.bridgeRpc.delivered = true; window.dispatchEvent(new Event('online')); });
  await expect(bridge).toHaveAttribute('data-bridge-state', 'destination_verified');
  await expect(bridge).toContainText('fxUSD received on Base');
  await expect(bridge).toContainText('0.9999');
  await expect(bridge).not.toContainText('Estimated');
  const evidence = await page.evaluate(() => (globalThis as any).__actionReviewHarness.bridgeRpc);
  expect(evidence.sourceReads).toBeGreaterThan(0);
  expect(evidence.queries.filter((q: {from:number;to:number}) => q.from === 101 && q.to === 101).length).toBeGreaterThanOrEqual(2);
  expect(evidence.queries.every((q: {guid:string;recipient:string;address:string}) => q.guid === GUID && q.recipient.toLowerCase() === WALLET && q.address.toLowerCase() === DESTINATION)).toBe(true);
  expect(await page.evaluate(() => (globalThis as any).__actionReviewHarness.sendCount)).toBe(1);
});
