import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('Move omits only the generic gas reminder and preserves native shortfall alerts', () => {
  const move = source('app/move/page.tsx');
  assert.doesNotMatch(move, /Keep ETH on .*for bridge fees and gas/);
  assert.match(move, /Boolean\(amountWei\) && nativeShortfall && <p[^>]+role="alert"/);
  assert.match(move, /Your balance does not cover the bridge fee and required network fees/);
  assert.match(move, /Your balance does not cover the bridge fee; transaction gas is also required/);
});

test('review retains approval and action signing labels without technical evidence', () => {
  const review = source('components/ActionReview.tsx');
  assert.doesNotMatch(review, /stepSequence|aria-label=\{bridgeReview \? "Wallet request sequence"/);
  assert.match(review, /confirmLabel = nextTransaction\?\.kind === 'approval' \? stepTitle\(nextTransaction\)/);
});

test('visual review titles remain available as focus targets and accessible dialog names', () => {
  const review = source('components/ActionReview.tsx');
  const sheet = source('components/MobileFlowSheet.tsx');
  assert.match(review, /data-review-focus tabIndex=\{-1\} className="outline-none"/);
  assert.match(review, /stage === 'executing' \? identity.name : actionHeading/);
  assert.match(sheet, /aria-labelledby=\{titleId\}/);
  assert.match(sheet, /id=\{titleId\} tabIndex=\{-1\} className=\{hideTitle \? 'sr-only'/);
  assert.match(source('app/send/page.tsx'), /<h2 className="sr-only">Review send<\/h2>/);
});

test('review exposes network speed without execution details', () => {
 const review = source('components/ActionReview.tsx');
 assert.doesNotMatch(review, /Execution details|<details|TechnicalEvidenceRow/);
 assert.match(review, /stage === 'review' && feeSpeedControl/);
 assert.match(review, /Network fee speed/);
});
