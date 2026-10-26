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
const HASH = `0x${'1'.repeat(64)}`;
const DEST = `0x${'2'.repeat(64)}`;
const RECIPIENT = `0x${'3'.repeat(40)}`;
const base = { sourceChain: 'Ethereum' as const, destinationChain: 'Base' as const, token: 'fxUSD', requestedAmount: '100.123456789', sourceTxHash: HASH, recipient: RECIPIENT, simulated: false };
const render = (props: Partial<React.ComponentProps<typeof BridgeResultCard>> = {}) => renderToStaticMarkup(React.createElement(BridgeResultCard, { ...base, state: 'source_confirmed', ...props }));

test('bridge outcome uses verified source and destination amounts, never the requested quote', () => {
  const proof = { state: 'destination_verified' as const, sourceAmount: '100.1234', receivedAmount: '99.9876', destinationTxHash: DEST };
  const html = render(proof);
  const primary = html.slice(0, html.indexOf('<details class="advanced">'));
  assert.match(primary, /fxUSD received on Base/);
  assert.match(primary, />Sent</);
  assert.match(primary, />Received</);
  assert.match(primary, /≈ 100\.12<span> fxUSD/);
  assert.match(primary, /≈ 99\.99<span> fxUSD/);
  assert.doesNotMatch(primary, /100\.1234|99\.9876|Show exact|Exact sent|Exact received/);
  assert.doesNotMatch(primary, /100.123456789|You receive|estimated|Requested|Action 2/);
  assert.match(html, new RegExp(`https://basescan.org/tx/${DEST}`));
  assert.match(html, new RegExp(`https://etherscan.io/tx/${HASH}`));
  assert.equal((html.match(/<details\b/g) ?? []).length, 0, 'no execution disclosure remains');
  assert.doesNotMatch(html.slice(html.indexOf('<details class="advanced">')), /99.9876 fxUSD/, 'the technical panel does not repeat the same observed amount');
  assert.equal(proof.sourceAmount, '100.1234');
  assert.equal(proof.receivedAmount, '99.9876');
  assert.match(html, /Recipient/);
});

test('pending, source-only, failed and legacy amount-less proofs stay honest', () => {
  for (const state of ['pending', 'source_confirmed', 'failed'] as const) {
    const html = render({ state, receivedAmount: '999', destinationTxHash: DEST });
    const primary = html.slice(0, html.indexOf('<details class="advanced">'));
    assert.doesNotMatch(primary, /fxUSD received on Base|>Received<|999/);
    assert.doesNotMatch(primary, />(?:Not verified|Awaiting delivery|Amount unavailable|Not available)</);
    assert.match(primary, /aria-label="Destination amount unavailable"/);
    assert.match(primary, state === 'failed' ? /Delivery unverified · do not repeat/ : /<small>Confirming<\/small>/);
    assert.match(html, /Confirming/);
    assert.doesNotMatch(html, /Bridge to Base<\/span><small>Confirmed/);
  }
  const legacy = render({ state: 'destination_verified' });
  assert.match(legacy, /fxUSD received on Base/);
  assert.match(legacy, /aria-label="Received amount unavailable"/);
  assert.doesNotMatch(legacy, />Amount unavailable</);
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

test('fxSAVE outcomes show static readable small and large amounts without fake prices', () => {
  for (const amount of ['0.000000000000000001', '1234567890123456789.123456789012345678']) {
    const html = render({ state: 'destination_verified', token: 'fxSAVE', sourceAmount: amount, receivedAmount: amount });
    assert.match(html, /fxSAVE/);
    if (amount.startsWith('0.')) assert.match(html, /0\.000000000000000001<span> fxSAVE/);
    else {
      assert.match(html, /≈ 1,234,567,890,123,456,789\.12<span> fxSAVE/);
      assert.doesNotMatch(html, /1234567890123456789\.123456789012345678/);
    }
    assert.match(html, /USD value unavailable/);
    assert.equal((html.match(/<details\b/g) ?? []).length, 0);
    assert.doesNotMatch(html, /\$1|NaN|Infinity/);
  }
  const css = readFileSync(new URL('../src/components/review/BridgeResultCard.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.subline:has\(\[data-usd-state='unavailable'\]\) \[data-usd-separator\] \{ display: none; \}/,
    'an unpriced known amount does not leave a separator before the network');
});

test('source and destination proof amounts come from matched events and reset during revalidation', () => {
  const tracker = readFileSync(new URL('../src/components/BridgeTracker.tsx', import.meta.url), 'utf8');
  assert.match(tracker, /setSourceAmountProof\(\{ context: verificationContextKey, amount: sourceMessage.amountSentLD \}\)/);
  assert.match(tracker, /setDestinationAmountProof\(\{ context: verificationContextKey, amount: canonical.amountReceivedLD \}\)/);
  assert.match(tracker, /setVerifiedContextKey\(null\);\s+setDestinationAmountProof\(null\);\s+setDetectedDestinationTxHash\(null\)/);
  assert.match(tracker, /if \(!simulated\) updatePendingBridgeDeliveryProof/);
});

test('completed bridge stays compact without execution details', () => {
  const html = render({ state: 'destination_verified', sourceAmount: '10', receivedAmount: '9.99', completionContent: React.createElement('p', null, 'Transaction Confirmed: receipt · Source gas fee') });
  assert.match(html, /Transaction Confirmed: receipt/);
  assert.doesNotMatch(html, /Execution details|Full route diagnostics|<details/);


  assert.doesNotMatch(html, /<span>Advanced<\/span>/);
  assert.match(html, /<p class="[^"]*amount[^"]*"[^>]*>10<span> fxUSD<\/span><\/p>/);
  assert.match(html, /<p class="[^"]*amount[^"]*"[^>]*>9\.99<span> fxUSD<\/span><\/p>/);
  assert.doesNotMatch(html, /Show exact|Exact sent|Exact received|class="exactAmount"/);
  assert.equal((html.match(/<details\b/g) ?? []).length, 0, 'no technical disclosure');
});

test('compact simulated completion avoids a duplicate badge and keeps amounts static', () => {
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
  assert.doesNotMatch(css, /\.exactAmount|\.exactValue/);
  assert.match(render({ simulated: true, state: 'source_confirmed' }), /Simulation · no real funds moved/);
});


test('all bridge lifecycle states keep static readable amounts and preserve uncertainty', () => {
 for(const state of ['pending','source_confirmed','destination_verified','failed'] as const){
  const proof = { state, sourceAmount:'720.89147659306640625',receivedAmount:'720.89147659306640625',completionContent:state==='destination_verified'?React.createElement('p',null,'Receipt'):undefined };
  const html=render(proof);
  assert.match(html,/≈ 720\.89/); assert.doesNotMatch(html,/720\.89147659306640625 fxUSD|Show exact|Exact sent|Exact received/);
  assert.equal(proof.sourceAmount,'720.89147659306640625');
  assert.equal((html.match(/lucide-chevron-down/g)||[]).length,0);
  assert.equal((html.match(/<details\b/g)||[]).length,0);
  assert.doesNotMatch(html,/Execution details/);
  if(state==='failed')assert.match(html,/Delivery unverified · do not repeat/);
 }
});
