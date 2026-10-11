import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privySessionIntentFor } from '../src/lib/wallet/privySessionIntent';
test('explicit logout remains blocked across adapter/provider remounts in one document', () => {
  const document = {}; const first = privySessionIntentFor(document);
  first.block();
  const remounted = privySessionIntentFor(document);
  assert.equal(remounted, first); assert.equal(remounted.isBlocked(), true);
  // SDK callbacks/user hydration have no API to resume this local intent.
  assert.equal(privySessionIntentFor({}).isBlocked(), false);
  remounted.resume(); assert.equal(first.isBlocked(), false);
});
test('logout and explicit resume notify mounted projections without retaining removed listeners', () => {
  const intent = privySessionIntentFor({}); let calls = 0;
  const remove = intent.subscribe(() => { calls++; });
  intent.block(); intent.block(); assert.equal(calls, 1);
  intent.resume(); assert.equal(calls, 2);
  remove(); intent.block(); assert.equal(calls, 2);
});
