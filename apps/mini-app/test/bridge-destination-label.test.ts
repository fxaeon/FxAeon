import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';
import ts from 'typescript';
import { ValueOrSkeleton } from '../src/components/MissingValue';

// Exercise the actual render projection and TimelineRow without starting RPC
// effects. These fixtures prove copy/state mapping, not event verification.
const path = new URL('../src/components/BridgeTracker.tsx', import.meta.url);
const file = ts.createSourceFile('BridgeTracker.tsx', readFileSync(path, 'utf8'), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
const confirmationConstants = file.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => ['DESTINATION_CONFIRMATIONS', 'DESTINATION_CONFIRMATION_LABEL'].includes(declaration.name.getText(file))))
  .map(node => node.getText(file)).join('\n');
assert.ok(confirmationConstants.includes('DESTINATION_CONFIRMATIONS'));
const tracker = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'BridgeTracker');
const row = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'TimelineRow');
assert.ok(tracker && ts.isFunctionDeclaration(tracker) && tracker.body);
assert.ok(row);
const start = tracker.body.statements.findIndex(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(file) === 'verified'));
assert.ok(start >= 0);
const projection = tracker.body.statements.slice(start).map(node => node.getText(file)).join('\n');
const compiled = ts.transpileModule(`${confirmationConstants}\n${row.getText(file)}\nfunction project() { ${projection} }\nproject();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
const sourceHash = `0x${'1'.repeat(64)}`;
const destinationHash = `0x${'2'.repeat(64)}`;
const noop = () => undefined;
function render(overrides: Record<string, unknown> = {}) {
  const input = {
    sourceStatusConfirmed: true, hasVerificationContext: true,
    verifiedContextKey: null, verificationContextKey: 'reviewed-route',
    status: 'source_confirmed', sourceTxHash: sourceHash, sourceReverted: false,
    sourceChain: 'Ethereum', destinationChain: 'Base', detectedDestinationTxHash: null,
    amount: '0.0001', token: 'fxUSD', className: '', sourceEventFound: true,
    canRetry: false, autoStart: true, manualStarted: false, verificationError: null,
    compact: false, headingRef: undefined, simulated: false,
    ...overrides,
  };
  const element = runInNewContext(compiled, {
    React, ...icons, ValueOrSkeleton, ...input,
    explorerFor: (chain: string) => chain === 'Base' ? 'https://basescan.org' : 'https://etherscan.io',
    openExternalLink: () => { throw new Error('No external action is permitted in a render test'); },
    useTransactionEvidence: () => 'live',
    haptic: noop, setVerificationError: noop, setCanRetry: noop, setManualStarted: noop, setRetrySequence: noop,
  }) as React.ReactNode;
  const markup = renderToStaticMarkup(element);
  assert.match(markup, /Destination verification/);
  assert.doesNotMatch(markup, /Waiting for destination/);
  assert.doesNotMatch(markup, /Delivery requires the matching bridge message/);
  assert.doesNotMatch(markup, /1 destination confirmations|3 destination confirmations/);
  assert.match(markup, new RegExp(`${input.amount.replace('.', '\\.')}.*${input.token}`));
  assert.match(markup, new RegExp(`${input.sourceChain} → ${input.destinationChain}`));
  return markup;
}

test('the actual destination confirmation gate accepts the inclusion head without skipping the gate for a future block', () => {
  let gate: ts.IfStatement | undefined;
  function visit(node: ts.Node) {
    if (ts.isIfStatement(node) && node.expression.getText(file).includes('received.blockNumber + DESTINATION_CONFIRMATIONS')) gate = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(gate);
  const source = ts.transpileModule(`${confirmationConstants}\n${gate.getText(file)}\ntrue;`, {
    compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS},
  }).outputText;
  const context = {received: {blockNumber: 100n, transactionHash: destinationHash}, cancelled: false, setDetectedDestinationTxHash: noop};
  assert.equal(runInNewContext(source, {...context, latestBlock: 100n}), true);
  assert.throws(() => runInNewContext(source, {...context, latestBlock: 99n}), /waiting for 1 destination confirmation\./);
});

test('pending destination verification has neutral title and retains checking copy', () => {
  const markup = render();
  assert.match(markup, /Source confirmed/);
  assert.match(markup, /Checking Base for the matching delivery\. No ETA is available/);
  assert.match(markup, /animate-spin/);
  assert.match(markup, /Not verified on the destination yet/);
  assert.doesNotMatch(markup, /Delivery was verified/);
});

test('locally verified destination has neutral title, completed rows and exact route continuity', () => {
  for (const [sourceChain, destinationChain] of [['Ethereum', 'Base'], ['Base', 'Ethereum']]) {
    const markup = render({ sourceChain, destinationChain, verifiedContextKey: 'reviewed-route', detectedDestinationTxHash: destinationHash });
    assert.match(markup, new RegExp(`Delivery was verified on ${destinationChain}`));
    assert.match(markup, new RegExp(`matching fxUSD delivery was verified at the recipient on ${destinationChain}`));
    assert.match(markup, /Destination received/);
    assert.doesNotMatch(markup, /animate-spin|Not verified on the destination yet|Check destination again/);
  }
});

test('failed and source-reverted states keep destination explicitly unverified', () => {
  const interrupted = render({ status: 'failed', sourceStatusConfirmed: false });
  assert.match(interrupted, /Bridge interrupted/);
  assert.match(interrupted, /Destination delivery has not been verified/);
  assert.doesNotMatch(interrupted, /Delivery was verified|The source receipt shows a revert/);
  const reverted = render({ sourceReverted: true });
  assert.match(reverted, /Source reverted/);
  assert.match(reverted, /The source receipt shows a revert/);
  assert.match(reverted, /Destination delivery has not been verified/);
  assert.doesNotMatch(reverted, /Delivery was verified/);
});

test('manual, retry and externally asserted success remain truthful under the neutral title', () => {
  assert.match(render({ autoStart: false }), /Start a destination check to verify delivery/);
  assert.match(render({ canRetry: true }), /Automatic checking has paused/);
  const forged = render({ status: 'destination_verified', verifiedContextKey: 'another-route' });
  assert.match(forged, /Not verified on the destination yet/);
  assert.doesNotMatch(forged, /Delivery was verified/);
});
