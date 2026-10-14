import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableReviewAmount, reviewHierarchy } from '../src/components/review/reviewHierarchy';

test('tiny and large amounts remain meaningful without floating point conversion', () => {
  assert.deepEqual(readableReviewAmount('0.000000196869981'), { value: '0.000000196869', shortened: true });
  assert.deepEqual(readableReviewAmount('0.000000000000000001'), { value: '0.000000000000000001', shortened: false });
  assert.deepEqual(readableReviewAmount('9,007,199,254,740,993.1234567'), { value: '9,007,199,254,740,993.123456', shortened: true });
  assert.deepEqual(readableReviewAmount('0.0003'), { value: '0.0003', shortened: false });
});

test('trade essentials and secondary terms have one home without mutating accepted facts', () => {
  const summary = [
    { label: 'Amount', value: '0.5 ETH' }, { label: 'Target leverage', value: '2.1×' },
    { label: 'Estimated collateral', value: '1 stETH', title: '1.000000001 stETH' },
    { label: 'Slippage', value: '0.5%' }, { label: 'Gas fee', value: '0.001 ETH max' },
    { label: 'Total cost', value: '0.501 ETH max' },
  ];
  const details = [summary[2], { label: 'Execution price', value: '2,500 fxUSD / stETH' }, { label: 'Quoted leverage', value: '2.1×' }];
  const before = JSON.stringify({ summary, details });
  const result = reviewHierarchy(summary, details, true);
  assert.deepEqual(result.primary.map(f => f.label), ['Amount', 'Gas fee', 'Execution price']);
  assert.deepEqual(result.more.map(f => f.label), ['Estimated collateral', 'Slippage', 'Total cost']);
  assert.equal(result.more[0].title, '1.000000001 stETH');
  assert.equal(result.leverage?.value, '2.1×');
  assert.equal(JSON.stringify({ summary, details }), before);
});

test('different quoted leverage and minimum receive protections remain available', () => {
  const result = reviewHierarchy([{ label: 'Target leverage', value: '2×' }, { label: 'Minimum received', value: '10 USDC' }], [{ label: 'Quoted leverage', value: '1.95×' }], true);
  assert.equal(result.primary[0].label, 'Minimum received');
  assert.equal(result.more[0].value, '1.95×');
});

test('distinct values with the same label are preserved while exact duplicates are deduplicated', () => {
  const result = reviewHierarchy(
    [{ label: 'Estimated collateral', value: '1 stETH' }],
    [
      { label: 'Estimated collateral', value: '1.01 stETH' },
      { label: 'Estimated collateral', value: '1 stETH' },
    ],
    false,
  );
  assert.deepEqual(result.primary, [{ label: 'Estimated collateral', value: '1 stETH' }]);
  assert.deepEqual(result.more, [{ label: 'Estimated collateral', value: '1.01 stETH' }]);
});

test('new Borrow reviews elevate quoted collateral and debt; existing Trade hierarchy is unchanged', () => {
  const summary = [{ label: 'Deposit', value: '100 USDC' }, { label: 'Borrow', value: '50 fxUSD' }];
  const details = [
    { label: 'Estimated collateral', value: '99.8 fxUSD' },
    { label: 'Estimated debt', value: '50.2 fxUSD' },
    { label: 'Loan-to-value', value: '50.3%' },
  ];
  const borrow = reviewHierarchy(summary, details, false, true);
  assert.deepEqual(borrow.primary.map(fact => fact.label), ['Deposit', 'Borrow', 'Estimated collateral', 'Estimated debt']);
  assert.deepEqual(borrow.more.map(fact => fact.label), ['Loan-to-value']);

  const trade = reviewHierarchy(summary, details, true);
  assert.deepEqual(trade.primary.map(fact => fact.label), ['Deposit', 'Borrow']);
  assert.deepEqual(trade.more.map(fact => fact.label), ['Estimated collateral', 'Estimated debt', 'Loan-to-value']);
});
