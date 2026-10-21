import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transactionCardIdentity } from '../src/components/review/transactionCardIdentity';
import { positionPoolAddress } from '../src/lib/fx/policy';
import type { PlannedRoute } from '../src/lib/fx';

const base = { chainId: 1, walletAddress: '0x00000000000000000000000000000000000000aa', transactions: [] };
const route = (operation: string, intent: object) => ({ ...base, operation, policy: { reviewedAction: intent } }) as unknown as PlannedRoute;

test('position identity preserves accepted amount, leverage, market and side without creating quotes', () => {
  const amount = { label: 'Amount', value: '0.2458 ETH', title: '0.2458 ETH' };
  const input = route('increasePosition', { kind: 'position-increase', positionId: 0, poolAddress: positionPoolAddress('ETH', 'long') });
  const card = transactionCardIdentity(input, [amount, { label: 'Target leverage', value: '2×' }], 'Open ETH Long');
  assert.equal(card.name, '2× ETH Long'); assert.equal(card.subtitle, 'Ethereum'); assert.equal(card.amount, amount);
  assert.equal(card.confirm, 'Open ETH Long'); assert.equal(card.review, 'Review position'); assert.equal(card.amountLabel, 'You pay');
  assert.equal(card.symbol, 'ETH'); assert.equal(card.value, undefined);
});

test('existing position and leverage changes do not invent cash legs', () => {
  const input = route('adjustPositionLeverage', { kind: 'position-adjust', positionId: 109, poolAddress: positionPoolAddress('ETH', 'long') });
  const card = transactionCardIdentity(input, [{ label: 'Target leverage', value: '3×' }], 'Change leverage');
  assert.equal(card.name, 'Adjust ETH Long'); assert.equal(card.subtitle, 'Position #109'); assert.equal(card.amount, undefined); assert.equal(card.value, '3×');
});

test('Borrow gross debt is never labelled as net wallet receipt', () => {
  const debt = { label: 'Debt added', value: '100 fxUSD' };
  const input = route('depositAndMint', { kind: 'deposit-and-mint', positionId: 42, depositAmount: 0n, mintAmount: 100n });
  const card = transactionCardIdentity(input, [debt], 'Borrow more');
  assert.equal(card.amountLabel, 'Debt added'); assert.equal(card.amount, debt); assert.equal(card.name, 'Borrow more fxUSD');
});

test('queue and claim identities keep different actions and do not fabricate payout amounts', () => {
  const queued = transactionCardIdentity(route('withdrawFxSave', { kind: 'fxsave-withdraw', directBasePool: false, instant: false }), [{ label: 'fxSAVE', value: '200 fxSAVE' }], 'Withdraw');
  const claim = transactionCardIdentity(route('claimFxSave', { kind: 'fxsave-claim' }), [], 'Claim');
  assert.equal(queued.amountLabel, 'You queue'); assert.equal(queued.confirm, 'Queue withdrawal');
  assert.equal(claim.value, 'fxUSD / USDC'); assert.equal(claim.amount, undefined); assert.equal(claim.confirm, 'Claim withdrawal');
});

test('bridge identity retains actual route networks and accepted sent token', () => {
  const input = { ...base, chainId: 8453, operation: 'buildBridgeTx' } as PlannedRoute;
  const amount = { label: 'Amount', value: '100 fxSAVE' };
  const card = transactionCardIdentity(input, [amount, { label: 'Asset', value: 'fxSAVE' }, { label: 'Destination network', value: 'Ethereum' }], 'Bridge');
  assert.equal(card.name, 'Bridge fxSAVE'); assert.equal(card.subtitle, 'Base → Ethereum'); assert.equal(card.amount, amount); assert.equal(card.amountLabel, 'You send');
});


test('direct base pool redemption is not labelled as instant stablecoin withdrawal', () => {
  const card = transactionCardIdentity(route('withdrawFxSave', { kind: 'fxsave-withdraw', directBasePool: true, instant: false }), [{ label: 'fxSAVE', value: '100 fxSAVE' }], 'Withdraw');
  assert.equal(card.subtitle, 'Ethereum · Direct'); assert.equal(card.confirm, 'Redeem to fxSP');
});

test('reduction minima keep their minimum qualifier instead of becoming an estimate', () => {
  const minimum = { label: 'Minimum received', value: '0.5 ETH' };
  const card = transactionCardIdentity(route('reducePosition', { kind: 'position-reduce', positionId: 109, poolAddress: positionPoolAddress('ETH', 'long'), isClosePosition: false }), [minimum], 'Reduce');
  assert.equal(card.amount, minimum); assert.equal(card.amountLabel, undefined);
});
