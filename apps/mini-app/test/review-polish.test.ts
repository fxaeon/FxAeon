import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('Move omits only the generic gas reminder and preserves native shortfall alerts', () => {
  const move = source('app/move/page.tsx');
  assert.doesNotMatch(move, /Keep ETH on .*for bridge fees and gas/);
  assert.match(move, /Boolean\(amountWei\) && nativeShortfall && <p[^>]+role="alert"/);
  assert.match(move, /Your balance does not cover the bridge fee and estimated transaction gas/);
  assert.match(move, /Your balance does not cover the bridge fee; transaction gas is also required/);
});

test('review removes the duplicate stepper but retains approval/action CTA and full approval evidence', () => {
  const review = source('components/ActionReview.tsx');
  assert.doesNotMatch(review, /stepSequence|aria-label=\{bridgeReview \? "Wallet request sequence"/);
  assert.match(review, /confirmLabel = nextTransaction\?\.kind === 'approval' \? stepTitle\(nextTransaction\)/);
  assert.match(review, /TechnicalEvidenceRow label="Approval spender" value=\{approval.spender\}/);
  assert.match(review, /TechnicalEvidenceRow label=\{approval.valueLabel\} value=\{approval.value.toString\(\)\}/);
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

test('Execution details keep one disclosure, grouped limits and exact copy/view controls', () => {
  const review = source('components/ActionReview.tsx');
  const evidence = source('components/review/TechnicalEvidenceRow.tsx');
  assert.equal((review.match(/<details\b/g) ?? []).length, 1);
  for (const label of ['Route & limits', 'Wallet requests', 'Verification data', 'Network speed']) assert.ok(review.includes(label), label);
  assert.match(evidence, /copyText\(value\)/);
  assert.match(evidence, /aria-label=\{`Copy full \$\{label.toLowerCase\(\)\}`\}/);
  assert.match(evidence, /<textarea readOnly[^>]*value=\{value\}/);
});
