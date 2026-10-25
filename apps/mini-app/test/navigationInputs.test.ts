import assert from 'node:assert/strict';
import test from 'node:test';
import { createNavigationInputMemory, validateNavigationInputs } from '../src/lib/navigationInputs';
const trade = { market: 'ETH', side: 'long', token: 'ETH', amount: '0.25', leverage: 2, slippage: '0.5' };
const earn = { mode: 'withdraw', token: 'usdc', amount: '', shares: '12.5', instant: true, slippage: '0.5' };

test('navigation input memory retains editable values per page, wallet and chain', () => {
  const memory = createNavigationInputMemory();
  memory.save('trade', '0xAbC:1', trade);
  memory.save('earn', '0xAbC:1', earn);
  assert.deepEqual(memory.read('trade', '0xabc:1'), trade);
  assert.deepEqual(memory.read('earn', '0xabc:1'), earn);
  assert.equal(memory.read('trade', '0xdef:1'), null);
  assert.equal(memory.read('trade', '0xabc:8453'), null);
  memory.clear('earn', '0xabc:1');
  assert.equal(memory.read('earn', '0xabc:1'), null);
  assert.deepEqual(memory.read('trade', '0xabc:1'), trade);
});

test('navigation snapshots cannot contain execution authority or invalid numeric/enum values', () => {
  for (const addition of [{ route: {} }, { quote: {} }, { calldata: '0x1234' }, { resumeReview: 1 }, { signed: true }]) {
    assert.equal(validateNavigationInputs('trade', { ...trade, ...addition }), false);
  }
  for (const change of [{ amount: '1e18' }, { leverage: Infinity }, { amount: 'x'.repeat(500) }, { market: 'SOL' }, { amount: {} }]) {
    assert.equal(validateNavigationInputs('trade', { ...trade, ...change }), false);
  }
  assert.equal(validateNavigationInputs('trade', { ...trade, amount: '.' }), true);
  assert.equal(validateNavigationInputs('earn', { ...earn, mode: 'claim' }), false);
});

test('cancelled or non-editable snapshots clear the old draft and copies cannot mutate cached state', () => {
  const memory = createNavigationInputMemory();
  memory.save('trade', 'wallet:1', trade);
  const restored = memory.read('trade', 'wallet:1')!;
  restored.amount = '999';
  assert.equal(memory.read('trade', 'wallet:1')!.amount, '0.25');
  memory.save('trade', 'wallet:1', { route: {} });
  assert.equal(memory.read('trade', 'wallet:1'), null);
});

test('Borrow management and custom Move drafts remain primitive and validated', () => {
  assert.equal(validateNavigationInputs('borrow', { mode: 'manage', market: 'ETH', selectedKey: 'ETH:long:42', token: 'wstETH', deposit: '', mint: '', repay: '12', withdraw: '', managementAction: 'repay' }), true);
  const move = { direction: 'ethereum_to_base', mode: 'advanced', token: 'fxSAVE', amount: '10', sourceOft: '0x123', destinationOft: '', approvalToken: '', recipientInput: '0xabc', customRecipient: true };
  assert.equal(validateNavigationInputs('move', move), true);
  assert.equal(validateNavigationInputs('move', { ...move, recipientInput: 'javascript:alert(1)' }), false);
});

test('legitimate sub-1x short leverage survives a navigation round trip', () => {
  const memory = createNavigationInputMemory();
  for (const leverage of [0.1, 0.5, 0.9]) {
    const short = { ...trade, side: 'short', leverage };
    memory.save('trade', 'wallet:1', short);
    assert.deepEqual(memory.read('trade', 'wallet:1'), short);
  }
  assert.equal(validateNavigationInputs('trade', { ...trade, leverage: 0 }), false);
});
