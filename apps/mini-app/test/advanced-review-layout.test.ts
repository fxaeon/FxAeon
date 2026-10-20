import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const component = (file: string) => readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');

test('review has a single Advanced disclosure with flat transaction and contract rows', () => {
  const source = component('ActionReview.tsx');
  assert.equal((source.match(/<details\b/g) ?? []).length, 1);
  assert.match(source, /<span>Advanced<\/span>/);
  assert.doesNotMatch(source, /Steps ·|Technical information|<summary[^>]*>Transaction details/);
  for (const field of ['Contract', 'Transaction value (wei)', 'Nonce', 'Approval spender', 'Quote data', 'economicLimits', 'bridge: bridgeQuote', 'Action fingerprint']) assert.ok(source.includes(field), field);
  assert.ok(source.indexOf('hierarchy.more.filter') < source.indexOf('Fee basis:'));
  assert.match(source, /stepResults\[index\] && <span/);
  assert.match(source, /CalldataDisclosure data=\{transaction.data\}/);
  assert.match(source, /AmountUsd amount=\{formatEther\(transaction.value\)\}/);
});

test('receipts keep technical facts and reviewed estimates flat inside Advanced', () => {
  const result = component('review/TransactionResultView.tsx');
  assert.equal((result.match(/<details\b/g) ?? []).length, 1);
  assert.match(result, /<summary>Advanced/);
  assert.match(result, /Reviewed amounts, not final outcomes/);
  assert.doesNotMatch(component('review/ActionReviewSummary.tsx'), /<details\b/);
});


test('bridge receipt consolidates reviewed terms and tracker proof into one Advanced', () => {
  const result = component('review/TransactionResultView.tsx');
  const tracker = component('BridgeTracker.tsx');
  assert.doesNotMatch(result, /BridgeReviewSummary/);
  assert.match(result, /BridgeResultDetails result=/);
  const card = component('review/BridgeResultCard.tsx');
  assert.equal((card.match(/<details\b/g) ?? []).length, 2, 'one pending Advanced and one reusable exact-amount disclosure');
  assert.match(card, /!conciseComplete && <details className=\{styles.advanced\}/);
  assert.doesNotMatch(component('review/BridgeResultDetails.tsx'), /<details\b/);
  assert.match(result, /bridgeTracker\?\.\(advancedContent,/);
  assert.match(result, /!bridgeTracker && !conciseSuccess && <details/);
  assert.match(tracker, /\{advancedContent\}/);
  assert.equal((tracker.match(/<details\b/g) ?? []).length, 1);
  assert.doesNotMatch(tracker, />Delivery details|>Verification details/);
});


test('technical data is compact with exact view/copy access and no inline hex block', () => {
  const row = component('review/TechnicalEvidenceRow.tsx');
  assert.match(row, /copyText\(value\)/);
  assert.match(row, /<textarea readOnly[^>]*value=\{value\}/);
  assert.match(row, /copied \? 'copied' : 'failed'/);
  assert.match(row, /Copy not confirmed/);
  assert.match(row, /showModal/);
  assert.doesNotMatch(component('review/ReviewProgress.tsx'), /<pre/);
});
