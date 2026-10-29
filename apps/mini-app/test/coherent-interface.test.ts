import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { positionReviewBefore, confirmedPositionReadback, readbackMatchesResult } from '../src/components/review/positionReview';
import { positionPoolAddress } from '../src/lib/fx/policy';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { primaryReviewFacts } from '../src/components/review/actionReviewPresentation';
import { pairVerifiedPositionFacts } from '../src/components/review/actionReviewModel';
import { transactionAmountFacts } from '../src/components/review/transactionAmountPresentation';
import { reviewHelpDefinition } from '../src/components/review/reviewHelp';
import type { ReviewFact } from '../src/lib/fx/reviewFormatting';
import type { PlannedRoute, TransactionExecutionResult } from '../src/lib/fx/types';
import type { PositionReadResult } from '../src/app/trade/fxUi';

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const wallet = '0x1111111111111111111111111111111111111111';
const hash = `0x${'a'.repeat(64)}`;
const router = '0xB753366082466c4B5984312f0c4Bb97554be067E';
function borrowing(positionId = 0): PlannedRoute {
  return {
    walletAddress: wallet, chainId: 1, operation: 'depositAndMint',
    transactions: [{ kind: 'action', operation: 'depositAndMint', chainId: 1, from: wallet, to: router, value: 250000000000000000n, data: '0x216d5108' }],
    policy: { walletAddress: wallet, chainId: 1, reviewedAction: { kind: 'deposit-and-mint', poolAddress: positionPoolAddress('ETH', 'long'), positionId, depositTokenAddress: FX_TOKENS.ETH.address, depositAmount: 250000000000000000n, nativeInput: true, mintAmount: 300000000000000000000n } },
    details: { colls: '250000000000000000', debts: '300000000000000000000', leverage: 1.5, protocolFeeQuote: { poolAddress: positionPoolAddress('ETH', 'long'), routerAddress: router, ratios: ['0', '0', '1000000', '0'] } },
  };
}
function result(route: PlannedRoute): TransactionExecutionResult {
  return { status: 'confirmed', operation: route.operation, walletAddress: wallet, chainId: 1, steps: [{ index: 0, transaction: route.transactions[0], status: 'confirmed', hash, receipt: { status: 'success', transactionHash: hash, logs: [], blockNumber: 100n } }] } as unknown as TransactionExecutionResult;
}
function read(): PositionReadResult & { readStartedAt: number; readCompletedAt: number } {
  return { readStartedAt: 1001, readCompletedAt: 1002, status: 'ready', successfulGroups: [{ market: 'ETH', side: 'long' }], failedGroups: [], positions: [{ market: 'ETH', side: 'long', info: { positionId: 42, rawColls: 600000000000000000n, rawDebts: 350000000000000000000n, rawCollsDecimals: 18, rawDebtsDecimals: 18, rawCollsToken: 'ETH', rawDebtsToken: 'fxUSD', currentLeverage: 1.25, lsdLeverage: 0 } }] };
}

test('new Borrow presents deposit to net proceeds, retaining gross debt and zero starting collateral', () => {
  const route = borrowing();
  const facts = primaryReviewFacts(route);
  const amounts = transactionAmountFacts(facts);
  assert.deepEqual(amounts.map(fact => fact.label), ['Deposit', 'Estimated fxUSD received']);
  assert.equal(amounts[1].value, '299.7 fxUSD');
  assert.equal(facts.find(fact => fact.label === 'Debt added')?.value, '300 fxUSD');
  const before = positionReviewBefore(route, []);
  assert.equal(before.find(fact => fact.label === 'Collateral')?.value, '0 stETH');
  assert.equal(before.find(fact => fact.label === 'Loan-to-value')?.value, 'No position');
  const changes = pairVerifiedPositionFacts(before, facts).paired;
  assert.equal(changes.find(fact => fact.label === 'Collateral')?.after, '0.25 stETH');
  assert.equal(changes.find(fact => fact.label === 'Debt')?.after, '300 fxUSD');
});

test('existing, unknown-pool and wrong-network positions never receive fabricated zero baselines', () => {
  assert.deepEqual(positionReviewBefore(borrowing(42), []), []);
  const current = [{ label: 'Collateral', value: '5 stETH' }];
  assert.deepEqual(positionReviewBefore(borrowing(42), current), current);
  assert.deepEqual(positionReviewBefore({ ...borrowing(), chainId: 8453 }, []), []);
  const route = borrowing();
  (route.policy!.reviewedAction as any).poolAddress = wallet;
  assert.deepEqual(positionReviewBefore(route, []), []);
});

test('post-confirm readback is the refreshed same position, not the quoted target', () => {
  const route = borrowing(42);
  const execution = result(route);
  const snapshot = confirmedPositionReadback(execution, route, read(), 1000);
  assert.equal(snapshot?.key, 'ETH:long:42');
  assert.equal(snapshot?.readAt, 1002);
  assert.equal(confirmedPositionReadback(execution, route, { ...read(), readStartedAt: 999 }, 1000), null);
  assert.equal(confirmedPositionReadback(execution, route, { ...read(), readStartedAt: undefined }, 1000), null);
  assert.equal(confirmedPositionReadback(execution, route, { ...read(), readCompletedAt: 1000 }, 1000), null);
  assert.equal(snapshot?.facts.find(fact => fact.label === 'Collateral')?.value, '0.6 stETH');
  assert.equal(snapshot?.facts.find(fact => fact.label === 'Debt')?.value, '350 fxUSD');
  assert.equal(snapshot?.facts.find(fact => fact.label === 'Leverage')?.value, '1.25×');
  assert.equal(readbackMatchesResult(snapshot, execution), true);
  assert.equal(readbackMatchesResult(snapshot, { ...execution, walletAddress: router }), false);
  assert.equal(readbackMatchesResult(snapshot, { ...execution, status: 'partial' }), false);
  assert.equal(readbackMatchesResult(snapshot, { ...execution, steps: execution.steps.map(step => ({ ...step, hash: `0x${'b'.repeat(64)}` as `0x${string}` })) }), false);
});

test('failed/stale groups, absent positions and approval-only receipts cannot become a fresh position', () => {
  const route = borrowing(42), execution = result(route);
  const stale = read(); stale.failedGroups = [{ market: 'ETH', side: 'long', reason: 'RPC timeout' }];
  assert.equal(confirmedPositionReadback(execution, route, stale, 1000), null);
  assert.equal(confirmedPositionReadback(execution, route, { ...read(), successfulGroups: [] }, 1000), null);
  assert.equal(confirmedPositionReadback(execution, route, { ...read(), positions: [] }, 1000), null);
  assert.equal(confirmedPositionReadback({ ...execution, status: 'partial' }, route, read(), 1000), null);
  assert.equal(confirmedPositionReadback({ ...execution, walletAddress: router }, route, read(), 1000), null);
  assert.equal(confirmedPositionReadback({ ...execution, steps: execution.steps.map(step => ({ ...step, transaction: { ...step.transaction, kind: 'approval' } })) } as TransactionExecutionResult, route, read(), 1000), null);
});

test('shared definitions are explicit and never selected from arbitrary financial titles', () => {
  assert.equal(reviewHelpDefinition('Minimum received'), 'minimumReceived');
  assert.equal(reviewHelpDefinition('Loan-to-value'), 'loanToValue');
  assert.equal(reviewHelpDefinition('Approval spender'), undefined);
  assert.equal(reviewHelpDefinition('Exact amount (raw units)'), undefined);
  assert.doesNotMatch(source('components/review/reviewHelp.ts'), /fact\.title/);
  assert.doesNotMatch(source('components/ActionReview.tsx'), /TechnicalEvidenceRow|Execution details/);
});

test('review continuity freezes the starting snapshot and returns without pushing a new position route', () => {
  const review = source('components/ActionReview.tsx');
  assert.match(review, /route !== acceptedBefore.current.route/);
  assert.match(review, /pairVerifiedPositionFacts\(beforeFacts, facts\)/);
  assert.match(review, /onReturnToPosition\(\{ key:/);
  assert.match(source('app/positions/page.tsx'), /onReturnToPosition=\{\(\{ key \}\) =>/);
  assert.match(source('app/borrow/page.tsx'), /onReturnToPosition=\{\(\{ key \}\) =>/);
  assert.match(review, /displayLabel="Funding status"/);
  assert.match(review, /label: 'Borrow rate', value: 'Not quoted'/);
  assert.match(review, /Verify on f\(x\) Protocol/);
  assert.match(source('app/borrow/page.tsx'), /label=\{fundingStatusLabel\}/);
  assert.match(source('app/borrow/page.tsx'), /visualLabel=\{fundingDisplay \?/);
  assert.doesNotMatch(review, /className=\{presentationStyles.riskNotice\}/);
  assert.match(source('components/infoHelpContent.ts'), /Rebalancing can reduce collateral and debt/);
  assert.equal((review.match(/<details\b/g) ?? []).length, 0);
});

const require = createRequire(import.meta.url);
const previousCss = require.extensions['.css'];
require.extensions['.css'] = (loaded, file) => {
  const names = [...readFileSync(file, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => match[1]);
  loaded.exports = Object.fromEntries(names.map(name => [name, name]));
};
const oldReact = (globalThis as any).React;
(globalThis as any).React = React;
after(() => { if (previousCss) require.extensions['.css'] = previousCss; else delete require.extensions['.css']; (globalThis as any).React = oldReact; });

test('Move leads with what is sent and its estimate across networks, then terms with exact evidence kept', async () => {
  const { BridgeReviewSummary } = await import('../src/components/review/BridgeReviewSummary');
  const { TransactionHero } = await import('../src/components/review/TransactionHero');
  const facts = [{ label: 'Amount', value: '100 fxUSD' }, { label: 'Estimated received', value: '99.9 fxUSD' }, { label: 'Minimum received', value: '99 fxUSD', title: '99.000000000000000001 fxUSD' }, { label: 'Gas fee', value: 'Unavailable' }];
  const hero = renderToStaticMarkup(React.createElement(TransactionHero, { title: 'Review bridge', legs: facts.slice(0, 2), labels: { Amount: 'You send' }, caption: 'Ethereum → Base', ariaLabel: 'Transaction amounts' }));
  assert.match(hero, />You send</); assert.match(hero, />You receive · est\.</);
  assert.match(hero, /Ethereum → Base/);
  const html = renderToStaticMarkup(React.createElement(BridgeReviewSummary, { facts, allFacts: [...facts, { label: 'Source network', value: 'Ethereum' }, { label: 'Destination network', value: 'Base' }, { label: 'Slippage', value: '0.5%' }] }));
  assert.doesNotMatch(html, /Bridge fxUSD|data-review-fact="Amount"|data-review-fact="Estimated received"/);
  assert.match(html, /About Min. received/);
  assert.doesNotMatch(html, /99.000000000000000001 fxUSD/);
  assert.equal(facts.find(fact => fact.label === 'Minimum received')?.title, '99.000000000000000001 fxUSD');
  assert.match(html, /aria-label="Gas fee unavailable"/);
  assert.doesNotMatch(html, />Unavailable</);
  assert.doesNotMatch(html, /<summary[^>]*>[^<]*<button/);
});


test('paired before/after values stay compact while exact quote evidence remains in the model', async () => {
  const route = borrowing(42);
  route.details = { ...route.details, debts: '300123456789123456789', colls: '250123456789123456' };
  const facts = primaryReviewFacts(route);
  const before = [{ label: 'Debt', value: '≈ 200.12345678 fxUSD', title: '200.123456789123456789 fxUSD' }, { label: 'Collateral', value: '0.1 stETH', title: 'Collateral uses stETH accounting, not a wallet token amount.' }];
  const { paired } = pairVerifiedPositionFacts(before, facts);
  assert.equal(paired.find(fact => fact.label === 'Debt')?.afterTitle, '300.123456789123456789 fxUSD');
  assert.match(paired.find(fact => fact.label === 'Collateral')?.afterTitle ?? '', /^0.250123456789123456 stETH; accepted f\(x\) supply fee/);
  const { PositionOutcomeSummary } = await import('../src/components/review/ActionReviewSummary');
  const { LeverageChangeSummary } = await import('../src/components/review/LeverageChangeSummary');
  for (const html of [renderToStaticMarkup(React.createElement(PositionOutcomeSummary, { facts: paired })), renderToStaticMarkup(React.createElement(LeverageChangeSummary, { facts, changes: paired }))]) {
    assert.match(html, /300\.12 fxUSD/);
    assert.match(html, /200\.12 fxUSD/);
    assert.match(html, /≈ 0\.2501 stETH/);
    assert.doesNotMatch(html, /<details|<summary|300\.123456789123456789|200\.123456789123456789|0\.250123456789123456|Collateral uses stETH accounting/);
    assert.match(html, /Estimated|estimated/);
  }
  assert.equal(paired.find(fact => fact.label === 'Debt')?.afterTitle, '300.123456789123456789 fxUSD');
  assert.match(paired.find(fact => fact.label === 'Collateral')?.afterTitle ?? '', /accepted f\(x\) supply fee/);
});

test('leverage review keeps explicit position identity next to its target', () => {
  const review = source('components/ActionReview.tsx');
  assert.match(review, /actionHeading = tradingAction \? identity.name : identity.review/);
  // The hero leads with the target leverage and names the position beneath it; the change rows follow.
  assert.match(review, /value=\{heroLegs.length \? undefined : identity.value\} caption=\{identity.subtitle\}/);
  assert.match(review, /\{hero\}\s*\{leverageReview && <LeverageChangeSummary facts=\{\[\]\} changes=\{positionChangeRows\} \/>\}/);
  assert.match(review, /stage === 'executing' \? identity.name : actionHeading/);
});


test('amount-led review names its network once and groups its terms by space, not rules', () => {
  const review = source('components/ActionReview.tsx');
  assert.match(review, /caption=\{identity.subtitle\}/);
  assert.doesNotMatch(source('components/review/TransactionHero.tsx'), /data-network/);
  assert.doesNotMatch(review, /className=\{presentationStyles.positionBasis\}/);
  assert.match(source('components/infoHelpContent.ts'), /ETH long positions use wstETH backing/);
  assert.match(source('components/infoHelpContent.ts'), /Short positions use fxUSD collateral accounting/);
  assert.doesNotMatch(review, /className=\{presentationStyles.riskNotice\}/);
  assert.match(source('components/infoHelpContent.ts'), /Rebalancing can reduce collateral and debt/);
  const css = source('components/review/ActionReviewPresentation.module.css');
  assert.match(css, /\.amountLedReview \.costGroup \+ \.costGroup \{ padding-top: 6px; margin-top: 0; border-top: 0/);
  assert.doesNotMatch(css, /\.(?:costGroup|riskGroup|amountLedReview)[^{]*\{[^}]*border-top: 1px/);
  assert.doesNotMatch(css, /\.amountLedReview \{[^}]*background/);
  assert.doesNotMatch(css, /\.positionOutcome dl > div \{ grid-template-columns: 1fr;/);
});


test('Bridge groups hero digits without numeric conversion and does not expand a missing-value explanation', async () => {
  const { BridgeReviewSummary } = await import('../src/components/review/BridgeReviewSummary');
  const { TransactionHero } = await import('../src/components/review/TransactionHero');
  const amount = { label: 'Amount', value: '1865.6 fxUSD', title: '1865.600000000000000001 fxUSD' };
  const received = { label: 'Estimated received', value: '9007199254740993.12 fxUSD' };
  const hero = renderToStaticMarkup(React.createElement(TransactionHero, { title: 'Review bridge', legs: [amount, received], ariaLabel: 'Transaction amounts' }));
  assert.match(hero, /1,865.6/);
  assert.match(hero, /9,007,199,254,740,993.12/);
  assert.doesNotMatch(hero, /1865.600000000000000001 fxUSD/);
  assert.equal(amount.title, '1865.600000000000000001 fxUSD');
  const render = (extra: ReviewFact[] = []) => renderToStaticMarkup(React.createElement(BridgeReviewSummary, { facts: [amount, received, { label: 'Minimum received', value: '1,865.6 fxUSD' }], allFacts: [{ label: 'Source network', value: 'Ethereum' }, { label: 'Destination network', value: 'Base' }, ...extra] }));
  const html = render();
  assert.match(html, /1,865.6/);
  assert.doesNotMatch(html, /Show full price impact/);
  assert.doesNotMatch(html, /About Price impact/);
  const caveat = render([{ label: 'Price impact', value: 'Unavailable', title: 'Route validation failed; do not assume a zero price impact.' }]);
  assert.match(caveat, /About Price impact/);
  assert.match(caveat, /aria-label="Price impact unavailable"/);
  assert.doesNotMatch(caveat, />Unavailable</);
  assert.doesNotMatch(caveat, /Show full price impact/);
  // A long leading figure takes the hero's smaller step rather than splitting digits.
  const normal = renderToStaticMarkup(React.createElement(TransactionHero, { title: 'Review bridge', legs: [{ label: 'Amount', value: '2500 fxUSD' }], ariaLabel: 'Transaction amounts' }));
  assert.doesNotMatch(normal, /data-long/);
  const wide = renderToStaticMarkup(React.createElement(TransactionHero, { title: 'Review bridge', legs: [{ label: 'Estimated received', value: '1,000,000.12 fxUSD' }], ariaLabel: 'Transaction amounts' }));
  assert.match(wide, /data-long="true"/);
  assert.match(wide, /1,000,000\.12/);
  const { reviewTermHelp } = await import('../src/components/review/ReviewTermRow');
  assert.equal(reviewTermHelp({ label: 'Price impact', value: 'Unavailable', title: 'Route validation failed; do not assume a zero price impact.' }), 'Route validation failed; do not assume a zero price impact.');
  const feeHelp = reviewTermHelp({ label: 'f(x) fee', value: '0.3%', title: '≈ 0.00000123456789 wstETH; estimated from the same SDK collateral quote. 0.3% of supplied collateral when that leg has a nonzero amount.' });
  assert.match(feeHelp!, /Quoted rate: 0\.3% of supplied collateral\./);
  assert.doesNotMatch(feeHelp!, /0\.00000123456789|wstETH/);
  assert.match(reviewTermHelp({ label: 'f(x) fee', value: '0.1% of supplied collateral + 0.3% of borrowed debt', title: '0.1% of supplied collateral + 0.3% of borrowed debt when those legs have a nonzero amount.' })!, /Quoted rates: 0\.1% of supplied collateral \+ 0\.3% of borrowed debt\./);
  assert.match(reviewTermHelp({ label: 'f(x) fee', value: '1%' })!, /Quoted rate: 1%\./);
});


test('Bridge minimum with phone-like precision stays compact and static', async () => {
 const { BridgeReviewSummary } = await import('../src/components/review/BridgeReviewSummary');
 const html=renderToStaticMarkup(React.createElement(BridgeReviewSummary,{facts:[{label:'Minimum received',value:'720.89147659306640625 fxUSD'}],allFacts:[]}));
 assert.match(html,/≈ 720.89 fxUSD/);
 assert.doesNotMatch(html,/Show full minimum received value|720.89147659306640625 fxUSD/);
 assert.doesNotMatch(html,/lucide-chevron-down/);
});
