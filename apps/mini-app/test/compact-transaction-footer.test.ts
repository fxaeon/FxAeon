import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TransactionExecutionResult, TransactionStepResult } from '../src/lib/fx';
import { buildReceiptPresentation } from '../src/lib/receiptPresentation';
import { USD_PRICE_MAX_AGE_MS, type UsdPriceSnapshot } from '../src/lib/prices';
import { compactTransactionFooterModel, compactTransactionGasFee, hasCompactConfirmedTransaction } from '../src/components/review/compactTransactionReceipt';

const WALLET = '0x1111111111111111111111111111111111111111';
const ACTION = `0x${'a'.repeat(64)}`;
const APPROVAL = `0x${'b'.repeat(64)}`;
const now = 1_800_000_000_000;
const quote: UsdPriceSnapshot = { prices: { ETH: 2400 }, updatedAt: now, updatedAts: { ETH: now }, status: 'ready' };
function step(kind: 'action' | 'approval' = 'action', hash = kind === 'action' ? ACTION : APPROVAL, chainId: 1 | 8453 = 1): TransactionStepResult {
  return {
    index: kind === 'approval' ? 0 : 1, hash, status: 'confirmed',
    transaction: { chainId, from: WALLET, to: WALLET, data: '0x', value: 0n, kind, operation: 'depositAndMint' },
    receipt: { status: 'success' },
  } as unknown as TransactionStepResult;
}
function result(steps = [step()], chainId: 1 | 8453 = 1): TransactionExecutionResult {
  return { status: 'confirmed', operation: 'depositAndMint', chainId, walletAddress: WALLET, steps };
}
const receipt = (fee: bigint | undefined, kind: 'action' | 'approval' = 'action') => buildReceiptPresentation({
  chainId: 1, status: 'success', transactionKind: kind, executionCostWei: fee,
});

test('compact success requires an actual confirmed action, not an approval or an outer status', () => {
  assert.equal(hasCompactConfirmedTransaction(result()), true);
  const invalid = [
    result([]),
    result([step('approval')]),
    { ...result(), status: 'partial' },
    { ...result(), status: 'failed' },
    result([{ ...step(), status: 'submitted' }]),
    result([{ ...step(), status: 'included' }]),
    result([{ ...step(), status: 'confirming' }]),
    result([{ ...step(), status: 'failed' }]),
    result([{ ...step(), receipt: undefined }]),
    result([{ ...step(), hash: '0x' }]),
    result([{ ...step(), receipt: { ...step().receipt!, status: 'reverted' } }]),
    result([step('action', ACTION, 8453)]),
  ] as TransactionExecutionResult[];
  for (const value of invalid) {
    assert.equal(hasCompactConfirmedTransaction(value), false);
    assert.equal(compactTransactionFooterModel(value, [receipt(1n)], 'live', quote, now), null);
  }
});

test('links the last confirmed action, never the approval, using the submitted chain', () => {
  const extraAction = `0x${'c'.repeat(64)}`;
  const value = result([step('approval'), step('action', extraAction), step()]);
  const model = compactTransactionFooterModel(value, [receipt(1n, 'approval'), receipt(2n), receipt(3n)], 'live', quote, now)!;
  assert.equal(model.explorerUrl, `https://etherscan.io/tx/${ACTION}`);
  assert.equal(model.confirmationLabel, 'Transaction Confirmed');
  assert.equal(model.gasLabel, 'Gas fee');
  assert.match(model.feeDescription, /Includes token approvals/);
  assert.equal(model.feeValue, '<$0.01');
  const base = result([step('action', ACTION, 8453)], 8453);
  assert.equal(compactTransactionFooterModel(base, [], 'live', quote, now)!.explorerUrl, `https://basescan.org/tx/${ACTION}`);
});

test('aggregates exact paid fees including approvals without reading rounded labels or native value', () => {
  const value = result([step('approval'), step()]);
  const fees = [receipt(100_000_000_000_000n, 'approval'), { ...receipt(900_000_000_000_001n), executionFee: 'wrong display text', nativeValue: '50 ETH', exactNativeValue: '50' }];
  assert.deepEqual(compactTransactionGasFee(value, fees), { exactNative: '0.001000000000000001', knownNative: '0.001000000000000001', includesApprovals: true });
  const model = compactTransactionFooterModel(value, fees, 'live', quote, now)!;
  assert.equal(model.feeValue, '≈ $2.40');
  assert.equal(model.feeNote, 'now');
  assert.match(model.feeDescription, /0\.001000000000000001 ETH/);
  assert.match(model.feeDescription, /Includes token approvals/);
});

test('Base requires all execution, L1 data and operator components; partial never becomes a total', () => {
  const value = result([step('action', ACTION, 8453)], 8453);
  const baseReceipt = buildReceiptPresentation({ chainId: 8453, status: 'success', transactionKind: 'action', executionCostWei: 1n, l1DataFeeWei: 2n, operatorFeeWei: 0n });
  assert.equal(compactTransactionGasFee(value, [baseReceipt]).exactNative, '0.000000000000000003');
  for (const component of ['execution', 'l1Data', 'operator'] as const) {
    const partial = { ...baseReceipt, exactFees: { ...baseReceipt.exactFees, [component]: undefined } };
    const model = compactTransactionFooterModel(value, [partial], 'live', quote, now)!;
    assert.equal(model.feeValue, 'Unavailable');
    assert.equal(model.feeNote, 'Fee data incomplete');
    assert.match(model.feeDescription, /not the full fee/);
  }
  const noComponents = compactTransactionFooterModel(value, [buildReceiptPresentation({ chainId: 8453, status: 'success', transactionKind: 'action' })], 'live', quote, now)!;
  assert.equal(noComponents.feeState, 'incomplete');
  assert.doesNotMatch(noComponents.feeDescription, /0 ETH/);
});

test('missing, mismatched and malformed exact fee data stays unavailable, never zero or a partial total', () => {
  const value = result([step('approval'), step()]);
  for (const fees of [
    [receipt(1n)],
    [receipt(1n), receipt(2n, 'approval')],
    [receipt(undefined, 'approval'), receipt(2n)],
    [receipt(1n, 'approval'), { ...receipt(2n), exactFees: { execution: '<0.000001' } }],
    [receipt(1n, 'approval'), { ...receipt(2n), exactFees: { execution: '0.0000000000000000001' } }],
    [receipt(1n, 'approval'), { ...receipt(2n), exactFees: { execution: '-1' } }],
  ]) {
    assert.equal(compactTransactionFooterModel(value, fees, 'live', quote, now)!.feeValue, 'Unavailable');
  }
});

test('missing or stale prices expose exact native gas, while real zero and dust stay distinct', () => {
  const fees = [receipt(1n)];
  for (const unavailable of [
    { ...quote, prices: {} },
    { ...quote, prices: { ETH: 0 } },
    { ...quote, updatedAts: { ETH: now - USD_PRICE_MAX_AGE_MS - 1 } },
    { ...quote, updatedAts: { ETH: now + 30_001 } },
  ]) {
    const model = compactTransactionFooterModel(result(), fees, 'live', unavailable, now)!;
    assert.equal(model.feeState, 'price-unavailable');
    assert.equal(model.feeValue, '0.000000000000000001 ETH');
    assert.equal(model.feeNote, 'USD unavailable');
  }
  assert.equal(compactTransactionFooterModel(result(), [receipt(0n)], 'live', quote, now)!.feeValue, '$0.00');
  assert.equal(compactTransactionFooterModel(result(), fees, 'live', quote, now)!.feeValue, '<$0.01');
});

test('simulation has no public explorer link and never claims real transaction confirmation or payment', () => {
  const model = compactTransactionFooterModel(result(), [receipt(1n)], 'simulation', quote, now)!;
  assert.equal(model.explorerUrl, null);
  assert.equal(model.confirmationLabel, 'Simulation complete');
  assert.equal(model.gasLabel, 'Gas fee');
  assert.match(model.feeDescription, /^Simulated gas fee:/);
  assert.doesNotMatch(model.feeDescription, /Gas paid/);
});

test('verified bridge destination adds a named explorer but does not invent destination gas', () => {
  const destination = { chainId: 8453 as const, hash: `0x${'c'.repeat(64)}` };
  const model = compactTransactionFooterModel(result(), [receipt(1n)], 'live', quote, now, destination)!;
  assert.equal(model.explorerUrl, `https://etherscan.io/tx/${ACTION}`);
  assert.equal(model.destinationExplorerUrl, `https://basescan.org/tx/${destination.hash}`);
  assert.equal(model.gasLabel, 'Source gas fee');
  assert.match(model.feeDescription, /Source-chain transactions only; excludes destination gas/);
  const simulated = compactTransactionFooterModel(result(), [receipt(1n)], 'simulation', quote, now, destination)!;
  assert.equal(simulated.explorerUrl, null);
  assert.equal(simulated.destinationExplorerUrl, null);
  assert.equal(compactTransactionFooterModel(result(), [receipt(1n)], 'live', quote, now, { ...destination, hash: 'not-a-hash' }), null);
  assert.equal(compactTransactionFooterModel(result(), [receipt(1n)], 'live', quote, now, { ...destination, chainId: 1 }), null);
});

const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const testRequire = createRequire(import.meta.url);
const previousCssLoader = testRequire.extensions['.css'];
testRequire.extensions['.css'] = (loadedModule, filename) => {
  const classNames = [...readFileSync(filename, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => match[1]);
  loadedModule.exports = Object.fromEntries([...new Set(classNames)].map(name => [name, `test-${name}`]));
};
after(() => {
  if (previousCssLoader) testRequire.extensions['.css'] = previousCssLoader;
  else delete testRequire.extensions['.css'];
  if (previousReact) globalReact.React = previousReact;
  else Reflect.deleteProperty(globalThis, 'React');
});

test('renders just two compact rows with accessible native fee fallback and one real action explorer link', async () => {
  const { CompactTransactionFooter } = await import('../src/components/review/CompactTransactionFooter');
  const html = renderToStaticMarkup(React.createElement(CompactTransactionFooter, { result: result(), receipts: [receipt(1n)] }));
  assert.equal((html.match(/class="test-row"/g) ?? []).length, 2);
  assert.match(html, /Transaction Confirmed/);
  assert.match(html, /Gas fee/);
  assert.match(html, /USD unavailable/);
  assert.match(html, /aria-label="Gas paid: 0\.000000000000000001 ETH/);
  assert.match(html, new RegExp(`href="https://etherscan.io/tx/${ACTION}"`));
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /Advanced|<details|Action 1/);
  assert.match(html, /<h3 data-review-focus="true" tabindex="-1">Transaction Confirmed<\/h3>/);
});

test('rendered simulation and incomplete results never leak a fake confirmation link', async () => {
  const [{ CompactTransactionFooter }, { TransactionEvidenceContext }] = await Promise.all([
    import('../src/components/review/CompactTransactionFooter'),
    import('../src/components/review/TransactionEvidenceContext'),
  ]);
  const simulated = renderToStaticMarkup(React.createElement(TransactionEvidenceContext.Provider, { value: 'simulation' },
    React.createElement(CompactTransactionFooter, { result: result(), receipts: [receipt(1n)] })));
  assert.match(simulated, /Simulation complete/);
  assert.match(simulated, /No on-chain link/);
  assert.doesNotMatch(simulated, /<a |Transaction Confirmed|etherscan/);
  const unknown = renderToStaticMarkup(React.createElement(CompactTransactionFooter, {
    result: result([{ ...step(), receipt: undefined }]), receipts: [receipt(1n)],
  }));
  assert.equal(unknown, '');
});

test('Wallet Send submission keeps the compact pattern without inventing confirmation or paid fees', async () => {
  const { CompactSubmissionFooter } = await import('../src/components/review/CompactSubmissionFooter');
  for (const chainId of [1, 8453]) {
    const html = renderToStaticMarkup(React.createElement(CompactSubmissionFooter, { chainId, hash: ACTION }));
    assert.equal((html.match(/class="test-row"/g) ?? []).length, 2);
    assert.match(html, /Transaction submitted/);
    assert.match(html, /Gas fee/);
    assert.match(html, /Pending confirmation/);
    assert.match(html, new RegExp(`href="https://${chainId === 1 ? 'etherscan.io' : 'basescan.org'}/tx/${ACTION}"`));
    assert.doesNotMatch(html, /Transaction Confirmed|\$0\.00|Gas paid|Advanced|<details/);
  }
  const unknown = renderToStaticMarkup(React.createElement(CompactSubmissionFooter, { chainId: 1, hash: 'unknown' }));
  assert.match(unknown, /Explorer unavailable/);
  assert.doesNotMatch(unknown, /<a /);
});

test('Wallet Send simulation footer never publishes a simulated hash as an explorer link', async () => {
  const [{ CompactSubmissionFooter }, { TransactionEvidenceContext }] = await Promise.all([
    import('../src/components/review/CompactSubmissionFooter'),
    import('../src/components/review/TransactionEvidenceContext'),
  ]);
  const html = renderToStaticMarkup(React.createElement(TransactionEvidenceContext.Provider, { value: 'simulation' },
    React.createElement(CompactSubmissionFooter, { chainId: 1, hash: ACTION })));
  assert.match(html, /Simulation submitted/);
  assert.match(html, /Simulated gas fee/);
  assert.match(html, /No on-chain link/);
  assert.doesNotMatch(html, /<a |Transaction Confirmed/);
});
