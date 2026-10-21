import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('reference review owns a side-by-side identity outside one grouped facts card', () => {
  const review = source('components/ActionReview.tsx');
  const identity = source('components/review/TransactionIdentity.tsx');
  assert.match(review, /stage === 'executing' \? <PendingTransactionSummary/);
  assert.match(review, /stage === 'executing' && <section[^]*?aria-label="Reviewed terms"/);
  assert.ok(review.indexOf('<TransactionIdentity {...identity}') < review.indexOf('presentationStyles.facts}'));
  assert.match(identity, /TokenIcon symbol=\{symbol\}/);
  assert.match(identity, /data-amount-provenance="review"/);
  assert.match(identity, /amount\.title \?\? amount\.value/);
  assert.match(identity, /AmountUsd amount=\{parts.amount\}/);
  assert.doesNotMatch(identity, /0\.2458|589\.87|1,179\.73|0x930F/);
});

test('all position and loan reviews retain risk rows without manufacturing prices', () => {
  const review = source('components/ActionReview.tsx');
  assert.match(review, /const tradingAction = intent\?\.kind === 'position-increase' \|\| intent\?\.kind === 'position-reduce' \|\| leverageReview/);
  assert.match(review, /\(tradingAction \|\| loanAction\) && <div className=\{`\$\{presentationStyles.riskGroup\}/);
  assert.match(review, /priceImpact\?\.value \?\? 'Unavailable'/);
  assert.match(review, /Execution details/);
  assert.match(review, /\[\.\.\.hierarchy.primary, \.\.\.hierarchy.more\]/);
  assert.match(review, /CollateralAmount collateral=\{collateralValuation\}/);
  assert.match(review, /ReviewTermRow fact=\{collateral\}[^]*?displayValue=\{collateralValuation/);
  assert.match(source('components/review/ReviewTermRow.tsx'), /ReviewFactValue fact=\{fact\} display=\{displayValue\}/);
  assert.match(source('components/review/ReviewFactValue.tsx'), /value.original/);
});

test('mobile review is content-height and keeps scrollable information separate from action', () => {
  const sheet = source('components/MobileFlowSheet.module.css');
  const css = source('components/review/ActionReviewPresentation.module.css');
  assert.match(sheet, /max-height: min\(86dvh, calc\(100dvh - 76px\)\)/);
  assert.match(sheet, /border-radius: 29px 29px 0 0/);
  assert.match(css, /\.transactionIdentity \{ display: flex/);
  assert.match(css, /\.identityAmount \{[^}]*text-align: right/);
  assert.match(css, /\.actions > button \{ min-height: 48px/);
  assert.match(css, /\.reviewScrollBody \{ overflow-y: auto/);
  assert.match(css, /\.reviewScrollBody \{[^}]*padding-block-end: 2px;/, 'fractional scroll ranges leave the last disclosure fully reachable');
  assert.match(css, /\.editButton \{ min-width: 44px; width: 44px; margin: -6px 0 -6px 0;/, 'the end-aligned edit target remains inside the review width');
});
