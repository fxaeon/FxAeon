import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const require = createRequire(import.meta.url);
const previousCss = require.extensions['.css'];
require.extensions['.css'] = (loaded, filename) => { loaded.exports = Object.fromEntries([...readFileSync(filename, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => [match[1], match[1]])); };
after(() => { if (previousCss) require.extensions['.css'] = previousCss; else delete require.extensions['.css']; });
const { BridgeResultCard } = require('../src/components/review/BridgeResultCard') as typeof import('../src/components/review/BridgeResultCard');
const { BridgeResultDetails } = require('../src/components/review/BridgeResultDetails') as typeof import('../src/components/review/BridgeResultDetails');
const HASH = `0x${'1'.repeat(64)}`;
const DEST = `0x${'2'.repeat(64)}`;
const RECIPIENT = `0x${'3'.repeat(40)}`;
const base = { sourceChain: 'Ethereum' as const, destinationChain: 'Base' as const, token: 'fxUSD', requestedAmount: '100.123456789', sourceTxHash: HASH, recipient: RECIPIENT, simulated: false };
const render = (props: Partial<React.ComponentProps<typeof BridgeResultCard>> = {}) => renderToStaticMarkup(React.createElement(BridgeResultCard, { ...base, state: 'source_confirmed', ...props }));

test('bridge outcome uses verified source and destination amounts, never the requested quote', () => {
  const html = render({ state: 'destination_verified', sourceAmount: '100.1234', receivedAmount: '99.9876', destinationTxHash: DEST });
  const primary = html.slice(0, html.indexOf('<details class="advanced">'));
  assert.match(primary, /fxUSD received on Base/);
  assert.match(primary, />Sent</);
  assert.match(primary, />Received</);
  assert.match(primary, /Show exact sent amount: 100.1234 fxUSD/);
  assert.match(primary, /Show exact received amount: 99.9876 fxUSD/);
  assert.doesNotMatch(primary, /100.123456789|You receive|estimated|Requested|Action 2/);
  assert.match(html, new RegExp(`https://basescan.org/tx/${DEST}`));
  assert.match(html, new RegExp(`https://etherscan.io/tx/${HASH}`));
  assert.equal((html.match(/<details\b/g) ?? []).length, 3);
  assert.ok(html.indexOf('99.9876 fxUSD</dd>') > html.indexOf('<details class="advanced">'), 'unrounded verified amount is in flat Advanced');
  assert.match(html, /Copy full recipient/);
});

test('pending, source-only, failed and legacy amount-less proofs stay honest', () => {
  for (const state of ['pending', 'source_confirmed', 'failed'] as const) {
    const html = render({ state, receivedAmount: '999', destinationTxHash: DEST });
    const primary = html.slice(0, html.indexOf('<details class="advanced">'));
    assert.doesNotMatch(primary, /fxUSD received on Base|>Received<|999/);
    assert.match(primary, state === 'failed' ? /Not verified/ : /Awaiting delivery/);
    assert.match(html, /Confirming/);
    assert.doesNotMatch(html, /Bridge to Base<\/span><small>Confirmed/);
  }
  const legacy = render({ state: 'destination_verified' });
  assert.match(legacy, /fxUSD received on Base/);
  assert.match(legacy, /Amount unavailable/);
  assert.doesNotMatch(legacy.slice(0, legacy.indexOf('<details class="advanced">')), /100.123456789/);
  assert.match(render({ state: 'failed', sourceReverted: true }), /Source reverted/);
});

test('simulation has distinct disclosure and no fake on-chain links', () => {
  const html = render({ state: 'destination_verified', sourceAmount: '10', receivedAmount: '9.99', destinationTxHash: DEST, simulated: true });
  assert.match(html, /aria-label="Simulated result: Bridge complete"[^>]*>Bridge complete<\/h3>/);
  assert.match(html, /Simulation · no real funds moved/);
  assert.match(html, />Received</);
  assert.match(html, /Simulated · confirmed/);
  assert.doesNotMatch(html, /<a\b|No on-chain link/);
});

test('fxSAVE and very small or large exact amounts retain precision without fake prices', () => {
  for (const amount of ['0.000000000000000001', '1234567890123456789.123456789012345678']) {
    const html = render({ state: 'destination_verified', token: 'fxSAVE', sourceAmount: amount, receivedAmount: amount });
    assert.match(html, /fxSAVE/);
    assert.ok(html.includes(`${amount} fxSAVE`));
    assert.match(html, /USD value unavailable/);
    assert.doesNotMatch(html, /\$1|NaN|Infinity/);
  }
});

test('source and destination proof amounts come from matched events and reset during revalidation', () => {
  const tracker = readFileSync(new URL('../src/components/BridgeTracker.tsx', import.meta.url), 'utf8');
  assert.match(tracker, /setSourceAmountProof\(\{ context: verificationContextKey, amount: sourceMessage.amountSentLD \}\)/);
  assert.match(tracker, /setDestinationAmountProof\(\{ context: verificationContextKey, amount: canonical.amountReceivedLD \}\)/);
  assert.match(tracker, /setVerifiedContextKey\(null\);\s+setDestinationAmountProof\(null\);\s+setDetectedDestinationTxHash\(null\)/);
  assert.match(tracker, /if \(!simulated\) updatePendingBridgeDeliveryProof/);
});

test('bridge Advanced keeps receipt fees in aligned rows with partial Base caveat', () => {
  const receipt = { transactionKind: 'action' as const, movements: [], technicalMovements: [], executionFee: '0.00024 ETH', exactFees: { execution: '0.00024' }, feeLabel: 'Action execution fee', totalFeeLabel: null, l1DataFee: null, operatorFee: null, totalExecutionFee: null, feeCaveat: 'Partial fee data', nativeValue: '0.0001 ETH', exactNativeValue: '0.0001', nativeValueLabel: 'Bridge fee' as const };
  const result = { chainId: 8453, steps: [] } as unknown as import('../src/lib/fx').TransactionExecutionResult;
  const html = renderToStaticMarkup(React.createElement(BridgeResultDetails, { result, receipts: [receipt], reviewedFacts: [{ label: 'Estimated received', value: '100 fxUSD' }] }));
  assert.match(html, /Bridge execution fee/);
  assert.match(html, /Bridge fee sent/);
  assert.match(html, /Partial fee data/);
  assert.match(html, /Quoted output/);
  assert.doesNotMatch(html, /<details|network total|Bridge fee paid|You receive|Received/);
});


test('completed bridge stays compact with one shared Execution details disclosure', () => {
  const html = render({ state: 'destination_verified', sourceAmount: '10', receivedAmount: '9.99', completionContent: React.createElement('p', null, 'Transaction Confirmed: receipt · Source gas fee'), advancedContent: React.createElement('p', null, 'Full route diagnostics') });
  assert.match(html, /Transaction Confirmed: receipt/);
  assert.match(html, /Execution details/);
  assert.match(html, /Full route diagnostics/);
  assert.ok(html.indexOf('Full route diagnostics') > html.indexOf('<details class="advanced">'));
  assert.doesNotMatch(html, /<span>Advanced<\/span>/);
  assert.match(html, /Show exact sent amount: 10 fxUSD/);
  assert.match(html, /Show exact received amount: 9.99 fxUSD/);
  assert.match(html, /Exact received/);
  assert.equal((html.match(/<details\b/g) ?? []).length, 3, 'native exact controls and one shared Execution details');
});

test('compact simulated completion avoids a duplicate badge and preserves touch targets', () => {
  const html = render({ state: 'destination_verified', sourceAmount: '10', receivedAmount: '10', token: 'fxSAVE', simulated: true,
    completionContent: React.createElement('section', { 'aria-label': 'Simulated transaction receipt' }, 'Simulation complete · Source gas fee') });
  assert.match(html, /aria-label="Simulated result: Bridge complete"[^>]*>Bridge complete<\/h3>/);
  assert.equal((html.match(/Simulation complete/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Simulation · no real funds moved/);
  assert.match(html, /class="completion"/);
  const css = readFileSync(new URL('../src/components/review/BridgeResultCard.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.card > \.transfer:first-child \{ padding-top: 0; \}/);
  assert.match(css, /\.card\[data-compact-complete\] \.transfer \{ padding-bottom: 12px; \}/);
  assert.match(css, /\.completion > section \{ margin-top: 0; \}/);
  assert.match(css, /\.exactAmount > summary \{[^}]*min-height: 44px/);
  assert.match(render({ simulated: true, state: 'source_confirmed' }), /Simulation · no real funds moved/);
});


test('all bridge lifecycle states remove amount carets while retaining exact phone values and uncertainty', () => {
 for(const state of ['pending','source_confirmed','destination_verified','failed'] as const){
  const html=render({state,sourceAmount:'720.89147659306640625',receivedAmount:'720.89147659306640625',completionContent:state==='destination_verified'?React.createElement('p',null,'Receipt'):undefined});
  assert.match(html,/≈ 720.89/); assert.match(html,/720.89147659306640625 fxUSD/);
  assert.equal((html.match(/lucide-chevron-down/g)||[]).length,1);
  assert.match(html,/Execution details/);
  if(state==='failed')assert.match(html,/Delivery unverified · do not repeat/);
 }
});
