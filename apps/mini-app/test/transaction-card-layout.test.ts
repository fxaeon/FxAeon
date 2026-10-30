import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('the review leads with one hero, keeps only accepted amounts while signing, and turns its action into progress', () => {
  const review = source('components/ActionReview.tsx');
  const hero = source('components/review/TransactionHero.tsx');
  // While signing, live terms could change underneath; only the accepted amounts stay, and the action becomes progress.
  assert.match(review, /<div data-review-essential>\{stage === 'executing' \? <div className=\{presentationStyles.amountLedReview\}>\s*\{hero\}/);
  assert.doesNotMatch(review, /stage === 'executing' \? <PendingTransactionSummary/);
  assert.doesNotMatch(review, /stage === 'executing' && <section[^]*?aria-label="Reviewed terms"/);
  assert.match(review, /data-review-dock=\{stage\} data-review-actions=\{stage === 'review' \? '' : undefined\}/);
  assert.match(review, /: <PendingTransactionSummary heading=\{identity.name\}/);
  assert.ok(review.indexOf('{hero}') < review.indexOf('presentationStyles.facts}'));
  assert.match(hero, /TokenIcon symbol=\{mark.symbol\}/);
  assert.match(hero, /data-amount-provenance=\{provenance\}/);
  assert.doesNotMatch(hero, /<details|<summary|leading\.title|leg\.title/);
  assert.match(hero, /AmountCounterpart amount=\{shown.amount\}/);
  assert.doesNotMatch(hero, /0\.2458|589\.87|1,179\.73|0x930F/);
});

test('all position and loan reviews retain risk rows without manufacturing prices', () => {
  const review = source('components/ActionReview.tsx');
  assert.match(review, /const tradingAction = intent\?\.kind === 'position-increase' \|\| intent\?\.kind === 'position-reduce' \|\| leverageReview/);
  assert.match(review, /\(tradingAction \|\| loanAction\) && <div className=\{`\$\{presentationStyles.riskGroup\}/);
  assert.match(review, /tradingAction && priceImpact && <ReviewRow compact label="Price impact"/);
  assert.doesNotMatch(review, /Execution details/);
  assert.match(review, /\[\.\.\.hierarchy.primary, \.\.\.hierarchy.more\]/);
  assert.match(review, /CollateralAmount collateral=\{collateralValuation\}/);
  assert.match(review, /ReviewTermRow fact=\{collateral\}[^]*?displayValue=\{collateralValuation/);
  // Reviewed values render as reviewed; a priced token amount adds its USD estimate beneath.
  assert.match(source('components/review/ReviewTermRow.tsx'), /PricedFactValue fact=\{fact\} display=\{displayValue\}/);
  assert.match(source('components/review/ReviewTermRow.tsx'), /ReviewFactValue fact=\{fact\} display=\{display\}/);
  assert.match(source('components/review/ReviewTermRow.tsx'), /InlineAmount amount=\{parts\.amount\} symbol=\{parts\.symbol\}/);
  assert.match(source('components/review/ReviewFactValue.tsx'), /value.display/);
  assert.doesNotMatch(source('components/review/ReviewFactValue.tsx'), /<details/);
});

test('mobile review is content-height and keeps scrollable information separate from action', () => {
  const sheet = source('components/MobileFlowSheet.module.css');
  const css = source('components/review/ActionReviewPresentation.module.css');
  assert.match(sheet, /max-height: min\(86dvh, calc\(100dvh - 76px\)\)/);
  assert.match(sheet, /border-radius: 29px 29px 0 0/);
  assert.match(source('components/review/TransactionHero.module.css'), /\.head \{ display: grid; justify-items: center/);
  assert.doesNotMatch(css, /\.transactionIdentity|\.identityAmount/);
  assert.match(css, /\.actions > button \{ min-height: 48px/);
  assert.match(css, /\.reviewScrollBody \{ overflow-y: auto/);
  assert.match(css, /\.reviewScrollBody \{[^}]*padding-block-end: 2px;/, 'fractional scroll ranges leave the last disclosure fully reachable');
  assert.match(css, /\.editButton \{ min-width: 44px; width: 44px; margin: -6px 0 -6px 0;/, 'the end-aligned edit target remains inside the review width');
});
