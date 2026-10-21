import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amountUsdValue, nativeCostAmount } from '../src/components/review/transactionAmountPresentation';
import { buildReceiptPresentation } from '../src/lib/receiptPresentation';
import { formatUsd, USD_PRICE_MAX_AGE_MS, type UsdPriceSnapshot } from '../src/lib/prices';
const now = 1_800_000_000_000;
const quote: UsdPriceSnapshot = { prices: { ETH: 2400, fxUSD: .99 }, updatedAt: now, updatedAts: { ETH: now }, status: 'ready' };
test('fees use fresh native ETH price, not transferred asset price; zero and tiny stay distinct', () => {
  assert.ok(Math.abs(amountUsdValue('0.00024', 'ETH', quote, now)! - .576) < 1e-12);
  assert.equal(formatUsd(amountUsdValue('0.00024', 'ETH', quote, now)), '$0.58');
  assert.equal(amountUsdValue('0', 'ETH', quote, now), 0);
  assert.equal(formatUsd(amountUsdValue('0.000000000000000001', 'ETH', quote, now)), '<$0.01');
});
test('missing, expired, future and invalid prices never manufacture zero', () => {
  for (const invalid of [{ ...quote, prices: { fxUSD: 1 } }, { ...quote, updatedAts: { ETH: now - USD_PRICE_MAX_AGE_MS - 1 } }, { ...quote, updatedAts: { ETH: now + 30_001 } }, { ...quote, prices: { ETH: 0 } }]) assert.equal(amountUsdValue('0.00024', 'ETH', invalid, now), null);
  assert.equal(amountUsdValue('', 'ETH', quote, now), null);
});
test('review max conversion uses exact native cap, never lower-than compact value', () => {
  assert.equal(nativeCostAmount({ value: '<0.000001 ETH', title: '0.000000000000000001 ETH (max)' }), '0.000000000000000001');
  assert.equal(nativeCostAmount({ value: '<0.000001 ETH' }), null);
});
test('Ethereum and Base retain exact receipt components, zero and dust', () => {
  const eth = buildReceiptPresentation({ chainId: 1, status: 'success', executionCostWei: 1n });
  assert.equal(eth.executionFee, '<0.000001 ETH');
  assert.equal(eth.exactFees?.execution, '0.000000000000000001');
  const base = buildReceiptPresentation({ chainId: 8453, status: 'success', executionCostWei: 1n, l1DataFeeWei: 2n, operatorFeeWei: 0n });
  assert.deepEqual(base.exactFees, { execution: '0.000000000000000001', l1Data: '0.000000000000000002', operator: '0', total: '0.000000000000000003' });
  const missing = buildReceiptPresentation({ chainId: 8453, status: 'success' });
  assert.deepEqual(missing.exactFees, {});
  assert.equal(missing.totalExecutionFee, null);
  assert.match(missing.feeCaveat!, /Partial fee data/);
});
