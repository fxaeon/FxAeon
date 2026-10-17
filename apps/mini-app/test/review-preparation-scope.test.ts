import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReviewPreparationScope } from '../src/components/review/reviewPreparationScope';
import { isReviewInputStage } from '../src/components/review/actionReviewTypes';

test('planning keeps the input presentation without changing execution stages', () => {
  assert.equal(isReviewInputStage('input'), true);
  assert.equal(isReviewInputStage('planning'), true);
  for (const stage of ['review', 'executing', 'result'] as const) assert.equal(isReviewInputStage(stage), false);
});

test('quote and fee work share one bounded preparation budget', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const scope = createReviewPreparationScope();
  await scope.wait(Promise.resolve('quote'));
  context.mock.timers.tick(30_000);
  const fees = scope.wait(new Promise<void>(() => {}));
  const rejected = assert.rejects(fees, /preparation timed out/);
  context.mock.timers.tick(15_001);
  await rejected;
});

test('cancellation rejects pending preflight and observes a late failed source', async () => {
  const scope = createReviewPreparationScope();
  let rejectSource!: (reason: Error) => void;
  const source = new Promise<void>((_resolve, reject) => { rejectSource = reject; });
  const pending = scope.wait(source);
  scope.cancel();
  await assert.rejects(pending, /preparation cancelled/);
  rejectSource(new Error('late quote failure'));
  await Promise.resolve();
  await assert.rejects(scope.wait(Promise.resolve('obsolete')), /preparation cancelled/);
});

test('a resumed page cannot accept a completion after the wall-clock deadline', async context => {
  let now = 1_000;
  context.mock.method(Date, 'now', () => now);
  const scope = createReviewPreparationScope(1_000);
  now = 2_001;
  await assert.rejects(scope.wait(Promise.resolve('late quote')), /preparation timed out/);
  scope.cancel();
});
