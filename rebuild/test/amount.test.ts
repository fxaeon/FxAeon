import test from 'node:test';
import assert from 'node:assert/strict';
import { exactAmount, formatAmount, intentFromInput, parseAmount } from '../src/domain/amount';

test('[SEC-AMOUNT-001] all supported decimal places survive input without binary floating-point loss', () => {
  assert.equal(parseAmount('0.100000000000000001'), 100_000_000_000_000_001n);
  assert.equal(parseAmount('.1'), 100_000_000_000_000_000n);
  assert.equal(parseAmount('9007199254740993.000000000000000001'), 9007199254740993000000000000000001n);
  for (const value of ['1e3', '1,000', '-1', '+1', 'NaN', 'Infinity', '1 000', ' 1', '1.0000000000000000001', '', '.', '١٢']) assert.throws(() => parseAmount(value), value);
});

test('[SEC-AMOUNT-002] exact display retains wei and compact display never rounds spendable balance up', () => {
  assert.equal(exactAmount(100000000000000001n), '0.100000000000000001');
  assert.equal(formatAmount(1999999999999999999n, 18, 4), '1.9999');
  assert.equal(exactAmount(1n), '0.000000000000000001');
  assert.equal(exactAmount(-1n), '−0.000000000000000001');
});

test('[SEC-POLICY-003] the first slice admits only positive native ETH and bounded exact leverage/slippage', () => {
  const base = { amount: '0.1', leverage: '3', slippageBps: 50 };
  assert.deepEqual(intentFromInput(base), { market: 'ETH', side: 'long', token: 'ETH', amountWei: 100000000000000000n, leverageBps: 30000, slippageBps: 50 });
  for (const patch of [{ amount: '0' }, { leverage: '' }, { leverage: '5.0001' }, { leverage: '1' }, { slippageBps: 0 }, { slippageBps: 100.1 }]) assert.throws(() => intentFromInput({ ...base, ...patch }));
});
