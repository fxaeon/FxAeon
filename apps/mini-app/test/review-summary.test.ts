import assert from 'node:assert/strict';
import test from 'node:test';
import { splitReviewFacts } from '../src/components/review/reviewSummary';

test('keeps action essentials visible while suppressing duplicate route and leverage labels', () => {
  const result = splitReviewFacts([
    { label: 'Amount', value: '1.2345 ETH', title: '1.234567890123 ETH' },
    { label: 'Target leverage', value: '3×' },
    { label: 'Leverage', value: '3×' },
    { label: 'Route', value: 'FxRoute' },
    { label: 'Slippage', value: '0.5%' },
    { label: 'Minimum received', value: '1.2 ETH' },
    { label: 'Gas tier', value: 'Fast · 2 Gwei' },
    { label: 'Gas fee', value: '0.0004 ETH' },
    { label: 'Execution price', value: '2,300 fxUSD / stETH' },
  ]);

  assert.deepEqual(result.summary.map(({ label }) => label), [
    'Amount', 'Target leverage', 'Slippage', 'Minimum received', 'Gas tier', 'Gas fee',
  ]);
  assert.deepEqual(result.details.map(({ label }) => label), ['Quoted leverage', 'Route', 'Execution price']);
  assert.equal(result.summary[0].title, '1.234567890123 ETH');
});

test('keeps distinct transaction costs and multiple limits visible', () => {
  const result = splitReviewFacts([
    { label: 'f(x) fee', value: '0.1 fxUSD' },
    { label: 'Total cost', value: '0.0005 ETH' },
    { label: 'Minimum received', value: '10 fxUSD' },
    { label: 'Minimum received', value: '0.02 WBTC' },
  ]);

  assert.equal(result.summary.length, 4);
  assert.equal(result.details.length, 0);
});

test('bridge review keeps destination and recipient visible beside receipt and costs', () => {
  const facts = [
    { label: 'Source network', value: 'Base' },
    { label: 'Destination network', value: 'Ethereum' },
    { label: 'Recipient', value: '0x1234' },
    { label: 'Estimated received', value: '1 fxSAVE' },
    { label: 'Bridge fee', value: '0.0001 ETH' },
    { label: 'Delivery estimate', value: 'Not provided by bridge' },
  ];
  assert.deepEqual(splitReviewFacts(facts), { summary: facts, details: [] });
});
