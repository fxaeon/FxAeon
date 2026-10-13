import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReceiptPresentation } from '../src/lib/receiptPresentation';
import type { TransactionExecutionResult } from '../src/lib/fx';

// These presentation leaves are JSX-transformed for the app bundle. Keep the
// component render isolated and expose real CSS module keys during SSR.
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const testRequire = createRequire(import.meta.url);
const previousCssLoader = testRequire.extensions['.css'];
testRequire.extensions['.css'] = (loadedModule, filename) => {
  if (previousCssLoader) {
    // Module CSS needs stable names for assertions; unrelated CSS imports
    // retain the runner's prior behavior when one is installed.
    if (!filename.endsWith('.module.css')) return previousCssLoader(loadedModule, filename);
  }
  const classNames = [...readFileSync(filename, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
  loadedModule.exports = Object.fromEntries([...new Set(classNames)].map((name) => [name, `test-${name}`]));
};
after(() => {
  if (previousCssLoader) testRequire.extensions['.css'] = previousCssLoader;
  else delete testRequire.extensions['.css'];
  if (previousReact) globalReact.React = previousReact;
  else Reflect.deleteProperty(globalThis, 'React');
});

const WALLET = '0x1111111111111111111111111111111111111111';
const HASH = `0x${'a'.repeat(64)}`;
const receipts: ReceiptPresentation[] = [{
  movements: ['sent 1 ETH', 'received 2 fxUSD'],
  technicalMovements: ['technical movement details'],
  executionFee: '0.001 ETH', feeLabel: 'Action network fee', totalFeeLabel: null,
  transactionKind: 'action', l1DataFee: null, operatorFee: null,
  totalExecutionFee: null, feeCaveat: null, nativeValue: null, nativeValueLabel: 'Native value sent',
}];

function result(status: TransactionExecutionResult['status'], options: { hash?: string; receipt?: boolean; operation?: TransactionExecutionResult['operation'] } = {}) {
  const transaction = { chainId: 1, from: WALLET, to: '0x2222222222222222222222222222222222222222', data: '0x', value: 0n, kind: 'action', operation: options.operation ?? 'increasePosition' };
  return {
    status,
    operation: options.operation ?? 'increasePosition',
    chainId: 1,
    walletAddress: WALLET,
    steps: [{
      index: 0, transaction, hash: options.hash ?? HASH,
      status: status === 'confirmed' || status === 'partial' ? 'confirmed' : 'failed',
      ...(options.receipt || status === 'partial' ? { receipt: { status: 'success' } } : {}),
    }],
  } as unknown as TransactionExecutionResult;
}

async function renderResult(input: {
  result: TransactionExecutionResult;
  receipts?: readonly ReceiptPresentation[];
  bridgeTracker?: React.ReactNode;
  refreshing?: boolean;
}) {
  const [{ TransactionResultView }, { resultPresentation }] = await Promise.all([
    import('../src/components/review/TransactionResultView'),
    import('../src/components/review/executionResult'),
  ]);
  const view = input.result;
  const bridge = Boolean(input.bridgeTracker) || view.operation === 'buildBridgeTx';
  return renderToStaticMarkup(React.createElement(TransactionResultView, {
    result: view,
    presentation: resultPresentation(view, bridge, 'Closed ETH Long'),
    refreshing: input.refreshing ?? false,
    positionAction: view.operation === 'increasePosition',
    receipts: input.receipts ?? receipts,
    bridgeTracker: input.bridgeTracker,
    nextLabel: 'Continue',
    onNext: () => undefined,
  }));
}

test('confirmed receipt outcome leads, while fee, movement and explorer details stay collapsed', async () => {
  const html = await renderResult({ result: result('confirmed', { receipt: true }) });
  const detailsStart = html.indexOf('<details class="test-resultDetails">');
  assert.ok(detailsStart > 0, 'transaction details are collapsed by default');
  const receivedLabel = html.indexOf('<dt>Received</dt>');
  const receivedAmount = html.indexOf('>2 <span>fxUSD</span>');
  assert.ok(receivedLabel >= 0 && receivedLabel < detailsStart, 'received label appears in the outcome before closed details');
  assert.ok(receivedAmount >= 0 && receivedAmount < detailsStart, 'received amount and token appear in the outcome before closed details');
  assert.match(html, /<summary>Transaction details/);
  assert.ok(html.indexOf('0.001 ETH') > detailsStart, 'the fee remains in the details disclosure');
  const explorer = html.indexOf(`https://etherscan.io/tx/${HASH}`);
  assert.ok(explorer > detailsStart, 'the explorer link remains inside the collapsed details');
});

test('partial outcomes, bridge tracking and unknown-receipt fallback remain visible', async () => {
  const partial = await renderResult({ result: result('partial') });
  assert.match(partial, /Partially completed/);
  assert.match(partial, /Do not repeat the full action/);

  const bridge = await renderResult({
    result: result('confirmed', { operation: 'buildBridgeTx', receipt: true }),
    bridgeTracker: React.createElement('p', null, 'Destination delivery is still being verified.'),
  });
  assert.match(bridge, /Confirmed on source/);
  assert.match(bridge, /Destination delivery is still being verified\./);

  const unknownReceipt = await renderResult({
    result: result('failed'),
    receipts: [{ ...receipts[0], movements: [], technicalMovements: [] }],
  });
  assert.match(unknownReceipt, /Confirmation unknown/);
  assert.match(unknownReceipt, /Token movements could not be established from the verified receipt logs\./);

  const confirmedEmptyReceipt = await renderResult({
    result: result('confirmed', { receipt: true }),
    receipts: [{ ...receipts[0], movements: [], technicalMovements: [] }],
  });
  const detailsStart = confirmedEmptyReceipt.indexOf('<details class="test-resultDetails">');
  assert.ok(confirmedEmptyReceipt.indexOf('No wallet token transfers appear in this receipt.') > detailsStart,
    'receipt limitations belong in details, without suggesting the confirmed action failed');
  assert.doesNotMatch(confirmedEmptyReceipt.slice(0, detailsStart), /Token movements|receipt logs|<dt>Received/);
});
