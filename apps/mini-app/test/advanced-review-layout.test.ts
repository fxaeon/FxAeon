import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const component = (file: string) => readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');

test('review has a single Execution details disclosure with flat transaction and contract rows', () => {
  const source = component('ActionReview.tsx');
  assert.equal((source.match(/<details\b/g) ?? []).length, 1);
  assert.match(source, /<span>Execution details<\/span>/);
  assert.doesNotMatch(source, /Steps ·|Technical information|<summary[^>]*>Transaction details/);
  for (const field of ['Contract', 'Transaction value (wei)', 'Nonce', 'Approval spender', 'Quote data', 'economicLimits', 'bridge: bridgeQuote', 'Action fingerprint']) assert.ok(source.includes(field), field);
  assert.match(source, /additionalFacts.map/);
  assert.ok(source.includes('!(bridgeReview ? bridgeDecisionLabels : decisionLabels).has(fact.label)'));
  assert.match(source, /stepResults\[index\] && <span/);
  assert.match(source, /CalldataDisclosure data=\{transaction.data\}/);
  assert.match(source, /AmountUsd amount=\{formatEther\(transaction.value\)\}/);
});

test('receipts keep technical facts and reviewed estimates flat inside Execution details', () => {
  const result = component('review/TransactionResultView.tsx');
  assert.equal((result.match(/<details\b/g) ?? []).length, 1, 'shared exact-value renderer and one flat Execution details');
  assert.match(result, /<summary>Execution details/);
  assert.match(result, /Reviewed amounts, not final outcomes/);
  // Exact before/after controls belong to the review, not the receipt details.
  const receiptSummary = component('review/ActionReviewSummary.tsx').split('export function ReceiptSummary')[1];
  assert.doesNotMatch(receiptSummary, /<details\b/);
});


test('bridge receipt consolidates reviewed terms and tracker proof into one Execution details', () => {
  const result = component('review/TransactionResultView.tsx');
  const tracker = component('BridgeTracker.tsx');
  assert.doesNotMatch(result, /BridgeReviewSummary/);
  assert.match(result, /BridgeResultDetails result=/);
  const card = component('review/BridgeResultCard.tsx');
  assert.match(card, /<OutcomeAmount[^]*?label=\{sourceKnown \? 'Sent'[^]*?inspectExact/);
  assert.match(card, /<OutcomeAmount[^]*?label=\{delivered \? 'Received'[^]*?inspectExact/);
  assert.match(card, /Show exact \$\{label.toLowerCase\(\)\} amount/);
  assert.match(card, /<details className=\{styles.advanced\}/);
  assert.doesNotMatch(component('review/BridgeResultDetails.tsx'), /<details\b/);
  assert.match(result, /bridgeTracker\?\.\(advancedContent,/);
  assert.match(result, /!bridgeTracker && <details/);
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
