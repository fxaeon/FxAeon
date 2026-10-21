import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableReviewAmount, reviewFactLabel, reviewHierarchy } from '../src/components/review/reviewHierarchy';

test('tiny and large amounts remain meaningful without floating point conversion', () => {
  assert.deepEqual(readableReviewAmount('0.000000196869981'), { value: '0.0000001969', shortened: true });
  assert.deepEqual(readableReviewAmount('0.000000000000000001'), { value: '0.000000000000000001', shortened: false });
  assert.deepEqual(readableReviewAmount('9,007,199,254,740,993.1234567'), { value: '9,007,199,254,740,993.12', shortened: true });
  assert.deepEqual(readableReviewAmount('0.0003'), { value: '0.0003', shortened: false });
});

test('display rounding removes noisy decimals and carries safely without changing exactness flags', () => {
  const cases: [string, string, boolean][] = [
    ['0.199999999999999999', '0.2', true],
    ['0.123449', '0.1234', true],
    ['0.12345', '0.1235', true],
    ['0.99999', '1', true],
    ['9.9999', '10', true],
    ['99.999', '100', true],
    ['999.999', '1000', true],
    ['9,999.999', '10,000', true],
    ['999999999999999999999999.995', '1000000000000000000000000', true],
    ['9,007,199,254,740,993.999', '9,007,199,254,740,994', true],
    ['0.000000000000000000000000196869981', '0.0000000000000000000000001969', true],
    ['0.00000000000000000000000099999', '0.000000000000000000000001', true],
    ['1.2340000', '1.234', false],
    ['1.2340001', '1.234', true],
    ['12.34000', '12.34', false],
    ['0.00030000', '0.0003', false],
    ['0.000000', '0', false],
    ['1,000.000', '1,000', false],
    ['9007199254740993', '9007199254740993', false],
    ['Unavailable', 'Unavailable', false],
  ];
  for (const [input, value, shortened] of cases) {
    assert.deepEqual(readableReviewAmount(input), { value, shortened }, input);
  }
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
  assert.deepEqual(result.primary.map(f => f.label), ['Amount', 'Gas fee', 'Total cost', 'Execution price']);
  assert.deepEqual(result.more.map(f => f.label), ['Estimated collateral', 'Slippage']);
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

test('new Borrow reviews disclose collateral accounting and retain debt; Trade hierarchy is unchanged', () => {
  const summary = [{ label: 'Deposit', value: '100 USDC' }, { label: 'Borrow', value: '50 fxUSD' }];
  const details = [
    { label: 'Estimated collateral', value: '99.8 fxUSD' },
    { label: 'Estimated debt', value: '50.2 fxUSD' },
    { label: 'Loan-to-value', value: '50.3%' },
  ];
  const borrow = reviewHierarchy(summary, details, false, true);
  assert.deepEqual(borrow.primary.map(fact => fact.label), ['Deposit', 'Borrow', 'Estimated debt']);
  assert.deepEqual(borrow.more.map(fact => fact.label), ['Estimated collateral', 'Loan-to-value']);

  const trade = reviewHierarchy(summary, details, true);
  assert.deepEqual(trade.primary.map(fact => fact.label), ['Deposit', 'Borrow']);
  assert.deepEqual(trade.more.map(fact => fact.label), ['Estimated collateral', 'Estimated debt', 'Loan-to-value']);
});


test('Borrow collapses only demonstrably identical debt while preserving the net receive and fee', () => {
  const summary = [{ label: 'Debt added', value: '50 fxUSD' }, { label: 'Estimated fxUSD received', value: '49.75 fxUSD' }, { label: 'f(x) fee', value: '0.25 fxUSD (0.5%)' }];
  const same = reviewHierarchy(summary, [{ label: 'Estimated debt', value: '≈ 50 fxUSD', title: '50.000 fxUSD' }], false, true);
  assert.deepEqual(same.primary.map(f => f.label), ['Debt added', 'Estimated fxUSD received', 'f(x) fee']);
  assert.equal(same.more.length, 0, 'identical new-loan debt is not duplicated in technical details');
  const existing = reviewHierarchy(summary, [{ label: 'Estimated debt', value: '50 fxUSD', title: '50.000 fxUSD' }], false, false);
  assert.equal(existing.more[0].label, 'Estimated debt', 'an existing loan retains resulting debt separately from the amount added');
  const different = reviewHierarchy(summary, [{ label: 'Estimated debt', value: '≈ 50 fxUSD', title: '50.00000001 fxUSD' }], false, true);
  assert.equal(different.primary.at(-1)?.label, 'Estimated debt');
  const unknown = reviewHierarchy(summary, [{ label: 'Estimated debt', value: 'Unavailable' }], false, true);
  assert.equal(unknown.primary.at(-1)?.value, 'Unavailable');
});


test('Move combines networks without hiding recipient, minimum, fees or delivery caveat', () => {
  const summary = [
    { label: 'Amount', value: '2,500 fxUSD' },
    { label: 'Source network', value: 'Ethereum' },
    { label: 'Destination network', value: 'Base' },
    { label: 'Asset', value: 'fxUSD' },
    { label: 'Estimated received', value: '2,497.5 fxUSD' },
    { label: 'Minimum received', value: '2,475 fxUSD' },
    { label: 'Recipient', value: '0x00000000000000000000000000000000000000aa' },
    { label: 'Bridge fee', value: '0.0001 ETH' },
    { label: 'Delivery estimate', value: 'Not provided by bridge' },
    { label: 'Network fee', value: '0.00024 ETH' },
  ];
  const before = JSON.stringify(summary);
  const result = reviewHierarchy(summary, [], false, false, true);
  assert.deepEqual(result.primary.map(f => f.label), ['Amount', 'Networks', 'Estimated received', 'Minimum received', 'Recipient', 'Bridge fee', 'Delivery estimate', 'Network fee']);
  assert.equal(result.primary[1].value, 'Ethereum → Base');
  assert.deepEqual(result.more.map(f => f.label), ['Source network', 'Destination network', 'Asset']);
  assert.equal(result.primary.find(f => f.label === 'Recipient')?.value, summary[6].value);
  assert.equal(JSON.stringify(summary), before);
  const missing = reviewHierarchy(summary.filter(f => f.label !== 'Destination network' && f.label !== 'Amount'), [], false, false, true);
  assert(missing.primary.some(f => f.label === 'Source network'));
  assert(missing.primary.some(f => f.label === 'Asset'));
});


test('native requirement label does not imply it totals ERC-20 inputs or all assets spent', () => {
  assert.equal(reviewFactLabel('Total cost'), 'ETH needed');
  assert.equal(reviewFactLabel('Gas fee'), 'Gas fee');
  assert.equal(reviewFactLabel('Input amount'), 'Input amount');
});
