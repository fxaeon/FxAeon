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
  exactMovements: [{ direction: 'sent', amount: '1', symbol: 'ETH' }, { direction: 'received', amount: '2', symbol: 'fxUSD' }],
  executionFee: '0.001 ETH', exactFees: { execution: '0.001' }, feeLabel: 'Action network fee', totalFeeLabel: null,
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
  bridgeTracker?: (advancedContent: React.ReactNode) => React.ReactNode;
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

test('confirmed receipt amounts keep the upper outcome and use only the compact receipt footer', async () => {
  const html = await renderResult({ result: result('confirmed', { receipt: true }) });
  assert.match(html, /data-review-fact="Received"/);
  assert.match(html, />2 <span class="test-flowUnit">fxUSD<\/span>/);
  assert.match(html, /Transaction Confirmed/);
  assert.match(html, /Gas fee/);
  assert.match(html, /0.001 ETH/);
  assert.match(html, new RegExp(`https://etherscan.io/tx/${HASH}`));
  assert.doesNotMatch(html, /Advanced|test-resultDetails|test-receiptLinks|test-resultStatus|Closed ETH Long|All transaction steps are confirmed/);
});

test('concise confirmed unknown-token receipts point to the available explorer rather than hidden details', async () => {
  const html = await renderResult({
    result: result('confirmed', { receipt: true, operation: 'depositFxSave' }),
    receipts: [{
      ...receipts[0],
      movements: ['Token movement available in technical details'],
      exactMovements: [],
      technicalMovements: ['Unknown token: 123 base units'],
    }],
  });
  assert.match(html, /View token movement in the transaction explorer/);
  assert.match(html, new RegExp(`https://etherscan.io/tx/${HASH}`));
  assert.doesNotMatch(html, /Token movement available in technical details|test-resultDetails/);
});

test('partial outcomes, bridge tracking and unknown-receipt fallback remain visible', async () => {
  const partial = await renderResult({ result: result('partial') });
  assert.match(partial, /Partially completed/);
  assert.match(partial, /Do not repeat the full action/);

  const bridge = await renderResult({
    result: result('confirmed', { operation: 'buildBridgeTx', receipt: true }),
    bridgeTracker: advancedContent => React.createElement(React.Fragment, null,
      React.createElement('p', null, 'Confirmed on source. Destination delivery is still being verified.'),
      React.createElement('details', null, React.createElement('summary', null, 'Advanced'), advancedContent)),
  });
  assert.equal((bridge.match(/<summary>Advanced/g) ?? []).length, 1);
  assert.equal((bridge.match(/<details\b/g) ?? []).length, 1, 'bridge has one flat Advanced container');
  assert.ok(bridge.indexOf('0.001 ETH') > bridge.indexOf('<summary>Advanced'), 'receipt fees share tracker Advanced');
  assert.ok(bridge.indexOf('technical movement details') > bridge.indexOf('<summary>Advanced'), 'technical movement rows stay accessible without nested disclosure');
  assert.doesNotMatch(bridge, /You send|You receive|Estimated received/);
  assert.doesNotMatch(bridge, /test-receiptLinks/);
  assert.match(bridge, /Confirmed on source/);
  assert.match(bridge, /Destination delivery is still being verified\./);

  const unknownReceipt = await renderResult({
    result: result('failed'),
    receipts: [{ ...receipts[0], movements: [], exactMovements: [], technicalMovements: [] }],
  });
  assert.match(unknownReceipt, /Confirmation unknown/);
  assert.match(unknownReceipt, /No wallet token transfers appear in this receipt\./);
  assert.doesNotMatch(unknownReceipt, /Amounts are from verified receipts/);

  const confirmedEmptyReceipt = await renderResult({
    result: result('confirmed', { receipt: true }),
    receipts: [{ ...receipts[0], movements: [], exactMovements: [], technicalMovements: [] }],
  });
  assert.match(confirmedEmptyReceipt, /Transaction Confirmed/);
  assert.doesNotMatch(confirmedEmptyReceipt, /<details|receipt logs|<dt>Received/);
});


test('all successful action types share the same compact lower receipt', async () => {
  for (const operation of ['increasePosition', 'reducePosition', 'adjustPositionLeverage', 'depositAndMint', 'repayAndWithdraw', 'depositFxSave', 'withdrawFxSave', 'getRedeemTx'] as const) {
    const html = await renderResult({ result: result('confirmed', { receipt: true, operation }) });
    assert.match(html, /Transaction Confirmed/, operation);
    assert.match(html, /Gas fee/, operation);
    assert.doesNotMatch(html, /test-resultDetails|test-resultStatus|test-receiptLinks|Position:/, operation);
  }
});
