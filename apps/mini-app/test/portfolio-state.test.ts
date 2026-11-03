import assert from 'node:assert/strict';
import test from 'node:test';
import { portfolioConnectionState, portfolioState } from '../src/lib/portfolioState';

const address = '0x1111111111111111111111111111111111111111';

test('unresolved authentication and wallet hydration cannot establish a guest or an account', () => {
  for (const authenticated of [true, false]) {
    assert.equal(portfolioConnectionState({ ready: false, authenticated, address }), 'unknown');
    assert.equal(portfolioConnectionState({ ready: true, restoring: true, authenticated, address }), 'unknown');
  }
});

test('only a resolved authenticated selected wallet establishes a connection', () => {
  assert.equal(portfolioConnectionState({ ready: true, authenticated: false, address }), 'disconnected');
  assert.equal(portfolioConnectionState({ ready: true, authenticated: true }), 'disconnected');
  assert.equal(portfolioConnectionState({ ready: true, authenticated: true, address }), 'connected');
});

test('identity resolution precedes any portfolio read state', () => {
  for (const connection of ['unknown', 'disconnected'] as const) {
    assert.equal(portfolioState({ connection, pending: true, failed: true, hasHoldings: true }), connection);
  }
});

test('connected pending, failed, populated and proven empty reads have distinct states', () => {
  assert.equal(portfolioState({ connection: 'connected', pending: true }), 'connected-loading');
  assert.equal(portfolioState({ connection: 'connected', failed: true, hasHoldings: true }), 'connected-error');
  assert.equal(portfolioState({ connection: 'connected', hasHoldings: true }), 'connected-ready');
  assert.equal(portfolioState({ connection: 'connected', hasHoldings: false }), 'connected-empty');
});

test('a known failure remains an error while other reads are still pending', () => {
  assert.equal(portfolioState({ connection: 'connected', pending: true, failed: true }), 'connected-error');
});
