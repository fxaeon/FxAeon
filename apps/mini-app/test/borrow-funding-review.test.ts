import assert from 'node:assert/strict';
import { test } from 'node:test';
import { borrowFundingReviewFact } from '../src/lib/fx/reviewFormatting';
import { positionPoolAddress } from '../src/lib/fx/policy';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import type { PlannedRoute } from '../src/lib/fx/types';

const now = 1_792_700_000_000;
const wallet = '0x1111111111111111111111111111111111111111';
function route(ratio = '0', market: 'ETH' | 'BTC' = 'ETH'): PlannedRoute {
  const poolAddress = positionPoolAddress(market, 'long');
  return {
    operation: 'depositAndMint', chainId: 1, walletAddress: wallet, transactions: [],
    policy: { walletAddress: wallet, chainId: 1, reviewedAction: {
      kind: 'deposit-and-mint', poolAddress, positionId: 0,
      depositTokenAddress: market === 'ETH' ? FX_TOKENS.ETH.address : FX_TOKENS.WBTC.address,
      depositAmount: 1n, mintAmount: 1n, nativeInput: market === 'ETH',
    } },
    details: { borrowFundingQuote: { poolAddress, ratio, readAt: now } },
  };
}

test('funding review distinguishes verified zero, active funding charges, and tiny active rates', () => {
  const zero = borrowFundingReviewFact(route(), now);
  assert.equal(zero?.value, '0%');
  assert.equal(zero?.equivalent, 'Not active · can change');
  for (const market of ['ETH', 'BTC'] as const) {
    const active = borrowFundingReviewFact(route('10000000000000000', market), now);
    assert.equal(active?.value, '1%');
    assert.equal(active?.equivalent, 'Active · can change');
    assert.match(active!.title!, /whole collateral/);
    assert.match(active!.title!, /borrowing charge, not yield/);
    assert.match(active!.title!, /opening and repayment fees are separate/);
  }
  assert.equal(borrowFundingReviewFact(route('1'), now)?.value, '<0.0001%');
});

test('stale, future, invalid, mismatched and missing funding snapshots never become zero', () => {
  const edits: Array<(value: PlannedRoute) => void> = [
    value => { value.details!.borrowFundingQuote = undefined; },
    value => { value.details!.borrowFundingQuote!.poolAddress = positionPoolAddress('BTC', 'long'); },
    value => { value.details!.borrowFundingQuote!.readAt = now - 60_000; },
    value => { value.details!.borrowFundingQuote!.readAt = now + 1; },
    value => { value.details!.borrowFundingQuote!.readAt = Number.NaN; },
    value => { value.details!.borrowFundingQuote!.ratio = '-1'; },
    value => { value.details!.borrowFundingQuote!.ratio = 'NaN'; },
    value => { value.details!.borrowFundingQuote!.ratio = (2n ** 256n).toString(); },
    value => { value.chainId = 8453; },
    value => { value.operation = 'repayAndWithdraw'; },
    value => { value.policy!.reviewedAction = undefined; },
    value => { const intent = value.policy!.reviewedAction!; if (intent.kind === 'deposit-and-mint') intent.mintAmount = 0n; },
  ];
  for (const edit of edits) {
    const value = route(); edit(value);
    assert.equal(borrowFundingReviewFact(value, now), undefined);
  }
  assert.equal(borrowFundingReviewFact(route(), now + 59_999)?.value, '0%');
});
