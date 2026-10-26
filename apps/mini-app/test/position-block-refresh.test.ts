import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_POSITION_BLOCK_REFRESH_MS, positionBlockRefreshDue } from '../src/lib/positionRefreshQueue';

const address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('a verified empty wallet skips nearby blocks and refreshes at the age limit', () => {
  const verifiedAt = 10_000;
  const snapshot = { walletAddress: address, status: 'ready', positions: [], lastVerifiedAt: verifiedAt };
  const blocks = [10_001, 12_000, 24_999, 25_000, 25_001];
  assert.equal(EMPTY_POSITION_BLOCK_REFRESH_MS, 15_000);
  assert.deepEqual(blocks.filter(now => positionBlockRefreshDue(snapshot, address, now)), [25_000, 25_001]);
  // A completed refresh advances the evidence timestamp for subsequent blocks.
  snapshot.lastVerifiedAt = 25_000;
  assert.equal(positionBlockRefreshDue(snapshot, address, 25_001), false);
});

test('occupied, uncertain, and different-wallet snapshots never suppress a block read', () => {
  const snapshot = { walletAddress: address, status: 'ready', positions: [] as unknown[], lastVerifiedAt: 10_000 };
  assert.equal(positionBlockRefreshDue({ ...snapshot, positions: [{}] }, address, 10_001), true);
  assert.equal(positionBlockRefreshDue({ ...snapshot, status: 'partial' }, address, 10_001), true);
  assert.equal(positionBlockRefreshDue({ ...snapshot, status: 'unavailable' }, address, 10_001), true);
  assert.equal(positionBlockRefreshDue({ ...snapshot, lastVerifiedAt: null }, address, 10_001), true);
  assert.equal(positionBlockRefreshDue(snapshot, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 10_001), true);
  assert.equal(positionBlockRefreshDue(snapshot, address, 9_999), true);
});
