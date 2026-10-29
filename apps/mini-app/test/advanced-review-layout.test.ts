import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const component = (file: string) => readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');

test('review retains decision terms and fee speed without execution diagnostics', () => {
 const source = component('ActionReview.tsx');
 assert.doesNotMatch(source, /Execution details|<details|TechnicalEvidenceRow|CalldataDisclosure|AdvancedReviewDetails/);
 assert.match(source, /stage === 'review' && feeSpeedControl/);
 assert.match(source, /confirmLabel = nextTransaction/);
 assert.match(source, /ReviewRiskPrices route=/);
});

test('receipt disclosure is limited to additional token movements', () => {
 const source = component('review/TransactionResultView.tsx');
 assert.doesNotMatch(source, /Execution details|Reviewed amounts, not final outcomes|BridgeResultDetails/);
 assert.match(source, /conciseSuccess && additionalMovementDetails.length > 0 && <details/);
 assert.match(source, /<summary>Receipt details/);
 assert.match(source, /receipt.technicalMovements/);
 assert.match(source, /aria-label="Transaction receipts"/);
});

test('bridge cards preserve proof guards and receipt links without diagnostic disclosures', () => {
 const card = component('review/BridgeResultCard.tsx');
 const tracker = component('BridgeTracker.tsx');
 for(const source of [card,tracker]) assert.doesNotMatch(source, /Execution details|<details|advancedContent|verificationDetails/);
 assert.match(card, /recipient && <div/);
 assert.match(card, /BridgeReceiptRow/);
 assert.match(tracker, /verifiedContextKey === verificationContextKey/);
 assert.match(tracker, /DESTINATION_CONFIRMATIONS - 1n/);
});

test('signing keeps the reviewed terms once and preparation keeps one visible loading message', () => {
 const source = component('ActionReview.tsx');
 assert.doesNotMatch(source, /aria-label="Reviewed terms"|Checking network fees and available ETH/);
 // A bridge's recipient stays in its terms while the wallet request is open, so it is never repeated beneath them.
 assert.doesNotMatch(source, /data-pending-recipient/);
 assert.match(source, /<p className="sr-only" role="status" aria-live="polite">\{preparationStep\(status\)\}/);
 assert.match(source, /<button type="button" onClick=\{reset\}>Cancel/);
});
