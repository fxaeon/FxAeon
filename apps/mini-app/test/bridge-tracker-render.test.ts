import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BridgeTracker } from '../src/components/BridgeTracker';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const hash = `0x${'1'.repeat(64)}`;
function render(status: 'pending' | 'source_confirmed' | 'destination_verified' | 'failed', sourceTxHash?: string) {
  return renderToStaticMarkup(React.createElement(BridgeTracker, {
    sourceChain: 'Ethereum', destinationChain: 'Base', token: 'fxUSD', amount: '100', status, sourceTxHash,
  }));
}

test('bridge awaits wallet signature until a transaction hash exists', () => {
  const markup = render('pending');
  assert.match(markup, /Awaiting signature/);
  assert.match(markup, /Confirm the bridge transaction in your wallet/);
  assert.doesNotMatch(markup, /was verified/);
});

test('source confirmation without recovery context does not imply delivery or active checking', () => {
  const markup = render('source_confirmed', hash);
  assert.match(markup, /Source confirmed/);
  assert.match(markup, /Recovery details are missing/);
  assert.doesNotMatch(markup, /Checking Base|animate-spin|Check destination again/);
});

test('externally supplied destination success never bypasses local verification', () => {
  const markup = render('destination_verified', hash);
  assert.match(markup, /Not verified on the destination yet/);
  assert.doesNotMatch(markup, /was verified|Delivery was verified/);
});

test('an interrupted bridge does not claim the source reverted without a receipt', () => {
  const markup = render('failed', hash);
  assert.match(markup, /Bridge interrupted/);
  assert.match(markup, /Check the source explorer for its final status/);
  assert.doesNotMatch(markup, /shows a revert|transaction reverted/);
});
