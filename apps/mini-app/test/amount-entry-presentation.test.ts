import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactAmountEntry } from '../src/lib/amountEntryPresentation';

test('long entries get an explicitly approximate preview without number coercion', () => {
  assert.equal(compactAmountEntry('0.008793346701694145', 18), '≈ 0.0087933');
  assert.equal(compactAmountEntry('1.204548856269749526', 18), '≈ 1.2045');
  assert.equal(compactAmountEntry('9007199254740993.123456789012345678', 18), '≈ 9,007,199,254,740,993');
});

test('equivalent trailing zeroes need no approximation and dust never becomes zero', () => {
  assert.equal(compactAmountEntry('1.200000000000000000', 18), '1.2');
  assert.equal(compactAmountEntry('0.000000000000000001', 18), null);
  assert.equal(compactAmountEntry('0.000000000000012345', 18), null);
});

test('short drafts, incomplete entries, unsupported precision and sentinel values stay exact', () => {
  for (const value of ['', '0', '1.23456789', 'all', '1.234567890123456789.', '1.234567890123456789']) {
    assert.equal(compactAmountEntry(value, 6), null);
  }
});
