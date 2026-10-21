import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildReceiptPresentation, type ReceiptPresentation } from '../src/lib/receiptPresentation';
import type { TransactionExecutionResult } from '../src/lib/fx';
import type { transactionCardIdentity } from '../src/components/review/transactionCardIdentity';
import type { NewPositionView } from '../src/components/review/TransactionResultView';

// These presentation leaves are JSX-transformed for the app bundle. Keep the
// component render isolated and expose real CSS module keys during SSR.
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const testRequire = createRequire(import.meta.url);
// Isolate only the outer button from the unavailable Next/connection shell.
// The result, receipt, financial value and evidence components remain real.
const nodeModule = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request, parent, isMain) {
  if (request === '@/components/ui') return { Button: React.forwardRef<HTMLButtonElement, any>(({ variant: _variant, loading: _loading, children, ...props }, ref) => React.createElement('button', { ...props, ref }, children)) };
  return originalLoad.call(this, request, parent, isMain);
};
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
  nodeModule._load = originalLoad;
  if (previousCssLoader) testRequire.extensions['.css'] = previousCssLoader;
  else delete testRequire.extensions['.css'];
  if (previousReact) globalReact.React = previousReact;
  else Reflect.deleteProperty(globalThis, 'React');
});

const WALLET = '0x1111111111111111111111111111111111111111';
const HASH = `0x${'a'.repeat(64)}`;
const receipts: ReceiptPresentation[] = [{
  movements: ['sent 1 ETH', 'received 2 fxUSD'],
  technicalMovements: [],
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
  reviewedFacts?: readonly { label: string; value: string; title?: string }[];
  simulated?: boolean;
  reviewIdentity?: ReturnType<typeof transactionCardIdentity>;
  newPosition?: NewPositionView;
  confirmedPosition?: import('../src/components/review/positionReview').ConfirmedPositionReadback | null;
}) {
  const [{ TransactionResultView }, { resultPresentation }] = await Promise.all([
    import('../src/components/review/TransactionResultView'),
    import('../src/components/review/executionResult'),
  ]);
  const view = input.result;
  const bridge = Boolean(input.bridgeTracker) || view.operation === 'buildBridgeTx';
  const element = React.createElement(TransactionResultView, {
    result: view,
    presentation: resultPresentation(view, bridge, 'Closed ETH Long'),
    refreshing: input.refreshing ?? false,
    positionAction: view.operation === 'increasePosition',
    receipts: input.receipts ?? receipts,
    bridgeTracker: input.bridgeTracker,
    reviewedFacts: input.reviewedFacts,
    reviewIdentity: input.reviewIdentity,
    newPosition: input.newPosition,
    confirmedPosition: input.confirmedPosition,
    nextLabel: 'Continue',
    onNext: () => undefined,
  });
  const { TransactionEvidenceContext } = await import('../src/components/review/TransactionEvidenceContext');
  return renderToStaticMarkup(input.simulated ? React.createElement(TransactionEvidenceContext.Provider, { value: 'simulation' }, element) : element);
}

test('confirmed receipt uses a compact heading, grouped actual amounts and unboxed receipt rows', async () => {
  const html = await renderResult({ result: result('confirmed', { receipt: true }) });
  assert.match(html, /data-review-fact="Received"/);
  assert.match(html, /Show exact amount: 2 fxUSD/);
  assert.match(html, /test-resultHeading/);
  assert.match(html, /test-amountFlow/);
  assert.match(html, /Closed ETH Long/);
  assert.match(html, /data-amount-provenance="receipt"/);
  assert.match(html, /Transaction confirmed/);
  assert.match(html, /Network fee/);
  assert.match(html, /0.001 ETH/);
  assert.match(html, new RegExp(`https://etherscan.io/tx/${HASH}`));
  assert.doesNotMatch(html, /Advanced|test-receiptLinks|test-resultStatus|All transaction steps are confirmed/);
});

test('concise confirmed unknown-token receipts keep exact details and the explorer reachable', async () => {
  const html = await renderResult({
    result: result('confirmed', { receipt: true, operation: 'depositFxSave' }),
    receipts: [{
      ...receipts[0],
      movements: ['Token movement available in technical details'],
      exactMovements: [],
      technicalMovements: ['Unknown token: 123 base units'],
    }],
  });
  assert.match(html, /Additional movements/);
  assert.match(html, /See details/);
  assert.match(html, /Execution details/);
  assert.match(html, /Unknown token: 123 base units/);
  assert.match(html, new RegExp(`https://etherscan.io/tx/${HASH}`));
});

test('partial outcomes, bridge tracking and unknown-receipt fallback remain visible', async () => {
  const partial = await renderResult({ result: result('partial') });
  assert.match(partial, /Partially completed/);
  assert.match(partial, /Earlier steps confirmed · do not repeat/);

  const bridge = await renderResult({
    result: result('confirmed', { operation: 'buildBridgeTx', receipt: true }),
    receipts: [{ ...receipts[0], technicalMovements: ['technical movement details'] }],
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
  assert.match(confirmedEmptyReceipt, /Transaction confirmed/);
  assert.match(confirmedEmptyReceipt, /Token amounts<\/dt><dd>Unavailable/);
  assert.match(confirmedEmptyReceipt, /Execution details/);
  assert.doesNotMatch(confirmedEmptyReceipt, /<dt>Received/);
});


test('all successful action types share the same compact lower receipt', async () => {
  for (const operation of ['increasePosition', 'reducePosition', 'adjustPositionLeverage', 'depositAndMint', 'repayAndWithdraw', 'depositFxSave', 'withdrawFxSave', 'getRedeemTx'] as const) {
    const html = await renderResult({ result: result('confirmed', { receipt: true, operation }) });
    assert.match(html, /Transaction confirmed/, operation);
    assert.match(html, /Network fee/, operation);
    assert.doesNotMatch(html, /test-resultStatus|test-receiptLinks|Position:/, operation);
  }
});


test('confirmed unknown-token fallback keeps technical evidence and reviewed amounts distinct', async () => {
  const html = await renderResult({
    result: result('confirmed', { receipt: true, operation: 'depositFxSave' }),
    receipts: [{ ...receipts[0], exactMovements: [], movements: ['Token movement available in technical details'], technicalMovements: ['Unknown token 0x2222: 100000000 base units'] }],
    reviewedFacts: [{ label: 'Deposit', value: '100 fxUSD' }, { label: 'Estimated fxSAVE received', value: '90 fxSAVE' }],
  });
  assert.match(html, /Transaction confirmed/);
  assert.match(html, /Token amounts<\/dt><dd>Unavailable/);
  assert.match(html, /Reviewed amounts, not final outcomes/);
  assert.match(html, /aria-label="Reviewed terms"/);
  assert.match(html, /Unknown token 0x2222: 100000000 base units/);
  assert.match(html, /<summary>Execution details/);
  assert.doesNotMatch(html, /data-amount-provenance="receipt"|<dt>You received|<dt>You deposited/);
});

test('mixed recognized and unknown transfers do not hide the technical remainder', async () => {
  const html = await renderResult({
    result: result('confirmed', { receipt: true }),
    receipts: [{ ...receipts[0], movements: [...receipts[0].movements, 'Token movement available in technical details'], technicalMovements: ['0x3333: 123 base units'] }],
  });
  assert.match(html, /data-amount-provenance="receipt"/);
  assert.match(html, /Show exact amount: 2 fxUSD/);
  assert.match(html, /Additional movements/);
  assert.match(html, /0x3333: 123 base units/);
  assert.equal((html.match(/<summary>Execution details/g) ?? []).length, 1);
});

test('Base unknown-token receipt never borrows mainnet decimals or reviewed units', async () => {
  const baseResult = result('confirmed', { receipt: true, operation: 'depositFxSave' });
  baseResult.chainId = 8453;
  baseResult.steps[0].transaction.chainId = 8453;
  const unknown = buildReceiptPresentation({
    chainId: 8453, walletAddress: WALLET, status: 'success', transactionKind: 'action', executionCostWei: 1n,
    transfers: [{ token: '0x2222222222222222222222222222222222222222', from: WALLET, to: '0x3333333333333333333333333333333333333333', amountRaw: 1_000_000n }],
  });
  const html = await renderResult({ result: baseResult, receipts: [unknown], reviewedFacts: [{ label: 'Deposit', value: '1 fxUSD' }] });
  assert.match(html, /1000000 base units/);
  assert.match(html, /Fee data incomplete/);
  assert.match(html, /Partial fee data/);
  assert.match(html, /https:\/\/basescan.org\/tx/);
  assert.doesNotMatch(html, /data-amount-provenance="receipt"|<dt>You deposited/);
});

test('queue result reports the confirmed request without inventing claim readiness or fxSP shares', async () => {
  const reviewedFacts = [{ label: 'Availability', value: 'After cooldown · claim required' }, { label: 'fxSAVE', value: '200 fxSAVE' }];
  const html = await renderResult({
    result: result('confirmed', { receipt: true, operation: 'withdrawFxSave' }), reviewedFacts,
    receipts: [{ ...receipts[0], movements: ['sent 200 fxSAVE'], exactMovements: [{ direction: 'sent', amount: '200', symbol: 'fxSAVE' }] }],
  });
  assert.match(html, /Withdrawal queued/);
  assert.match(html, /You redeemed/);
  assert.match(html, /Check live status/);
  assert.match(html, /Payout<\/dt><dd>After cooldown/);
  assert.doesNotMatch(html, /Ready to claim|200 fxSP|Amount queued/);
  const unknown = await renderResult({ result: result('failed', { operation: 'withdrawFxSave' }), reviewedFacts, receipts: [] });
  assert.match(unknown, /Confirmation unknown/);
  assert.doesNotMatch(unknown, /Withdrawal queued|Transaction confirmed/);
});

test('shortened actual amounts keep keyboard-accessible exact receipt values', async () => {
  const html = await renderResult({
    result: result('confirmed', { receipt: true }),
    receipts: [{ ...receipts[0], exactMovements: [{ direction: 'received', amount: '1.23456789', symbol: 'fxUSD' }] }],
  });
  assert.match(html.replace(/<[^>]*>/g, ''), /≈ 1.235 fxUSD/);
  assert.match(html, /aria-label="Show exact amount: 1.23456789 fxUSD"/);
  assert.match(html, /Exact receipt amount/);
  assert.match(html, /1.23456789 fxUSD/);
});

test('outer confirmed status cannot create a success card without confirmed action evidence', async () => {
  const html = await renderResult({ result: result('confirmed'), receipts: [] });
  assert.match(html, /Confirmation unknown/);
  assert.doesNotMatch(html, /test-resultHeading|Transaction confirmed|Closed ETH Long/);
});

test('simulation result is explicitly labeled and has no public explorer receipt', async () => {
  const html = await renderResult({ result: result('confirmed', { receipt: true }), simulated: true });
  assert.match(html, /Simulation complete/);
  assert.equal((html.match(/Simulation complete/g) ?? []).length, 1, 'only the receipt footer repeats simulation completion');
  assert.match(html, />Closed ETH Long<\/h3>/);
  assert.match(html, /aria-label="Simulated result: Closed ETH Long"/);
  assert.match(html, /data-amount-provenance="simulation"/);
  assert.match(html, /Simulation · Ethereum/);
  assert.match(html, /No on-chain link/);
  assert.doesNotMatch(html, /Transaction confirmed|https:\/\/etherscan/);
});

test('declined, reverted and unknown outcomes retain recovery guidance above compact reviewed identity', async () => {
  const amount = { label: 'Amount', value: '0.01 WBTC' };
  const reviewIdentity = { name: '3× BTC Short', subtitle: 'Ethereum', symbol: 'WBTC', amount, amountLabel: 'You pay', value: undefined, review: 'Review position', confirm: 'Open BTC Short' };
  const rejected = { ...result('failed', { hash: '' }), error: 'User rejected request' };
  const reverted = result('failed', { receipt: true });
  reverted.steps[0].receipt!.status = 'reverted';
  const cases = [
    { result: rejected, expected: /Wallet request declined/, noSubmission: true },
    { result: reverted, expected: /Reverted/, noSubmission: false },
    { result: result('failed'), expected: /Confirmation unknown/, noSubmission: false },
  ];
  for (const sample of cases) {
    const html = await renderResult({
      result: sample.result, receipts: [], reviewIdentity,
      reviewedFacts: [amount, { label: 'Target leverage', value: '3×' }, { label: 'Position', value: 'New position' }, { label: 'Slippage', value: '0.5%' }, { label: 'Estimated collateral', value: '1.95 WBTC' }],
    });
    assert.match(html, sample.expected);
    assert.match(html, /3× BTC Short/);
    assert.match(html, /test-transactionIdentity/);
    assert.match(html, /Reviewed amounts, not final outcomes/);
    assert.match(html, /Slippage/);
    assert.ok(html.indexOf('test-resultRecoveryStatus') < html.indexOf('test-transactionIdentity'));
    assert.ok(html.indexOf('test-transactionIdentity') < html.indexOf('<summary>Execution details'));
    const visible = html.slice(0, html.indexOf('<summary>Execution details'));
    assert.doesNotMatch(visible, /<dt>Target leverage|<dt>Position|<dt>Amount|test-amountFlow|data-amount-provenance="receipt"/);
    if (sample.noSubmission) assert.doesNotMatch(html, /View on explorer/);
    else assert.match(visible, /View on explorer/);
    if (sample.result === cases[2].result) assert.match(html, /Do not resubmit · check History/);
  }
});

test('newly opened live position shows verified identity without presenting requested leverage as achieved', async () => {
  const html = await renderResult({
    result: result('confirmed', { receipt: true }),
    newPosition: { key: 'ETH:long:42', market: 'ETH', side: 'long', positionId: 42, targetLeverage: 2 },
  });
  assert.match(html, />ETH Long opened<\/h3>/);
  assert.match(html, /Position #42 · Ethereum/);
  assert.doesNotMatch(html, /2× ETH Long opened/);
});

test('simulated opened position retains action identity with a compact explicitly targeted subtitle', async () => {
  const html = await renderResult({
    result: result('confirmed', { receipt: true }), simulated: true,
    newPosition: { key: 'ETH:long:42', market: 'ETH', side: 'long', positionId: 42, targetLeverage: 2 },
    reviewedFacts: [{ label: 'Target leverage', value: '2×' }],
  });
  assert.match(html, />ETH Long opened<\/h3>/);
  assert.match(html, /aria-label="Simulated result: ETH Long opened"/);
  assert.match(html, /Target 2× · Ethereum/);
  assert.equal((html.match(/Simulation complete/g) ?? []).length, 1);
  assert.doesNotMatch(html, /2× ETH Long opened|https:\/\/etherscan|Transaction confirmed/);
});

test('unverified included token data is not promoted to verified amounts in a recovery card', async () => {
  const unverified = result('failed', { receipt: true });
  const html = await renderResult({ result: unverified });
  assert.match(html, /Verification incomplete/);
  assert.doesNotMatch(html, /Amounts are from verified receipts|data-amount-provenance="receipt"|<dt>You paid|<dt>You received/);
});

test('partial recovery shows already confirmed wallet movements separately from reviewed future terms', async () => {
  const partial = result('partial');
  partial.steps.push({ ...partial.steps[0], index: 1, hash: `0x${'b'.repeat(64)}`, receipt: undefined, status: 'failed' });
  const html = await renderResult({
    result: partial,
    reviewedFacts: [{ label: 'Amount', value: '9 ETH' }, { label: 'Estimated received', value: '99 fxUSD' }],
  });
  assert.match(html, /Confirmation unknown/);
  assert.match(html, /Already confirmed · earlier steps only/);
  assert.match(html, /Already sent/);
  assert.match(html, />1 ETH<\/span>/);
  assert.match(html, /Already received/);
  assert.match(html, />2 fxUSD<\/span>/);
  assert.match(html, /Reviewed amounts, not final outcomes/);
  assert.ok(html.indexOf('Already confirmed') < html.indexOf('Reviewed amounts, not final outcomes'));
  assert.doesNotMatch(html, /Transaction confirmed|test-resultHeading/);
});


test('actual phone receipt and fresh readback decimals stay compact with exact evidence accessible', async () => {
 const execution=result('confirmed',{receipt:true});
 const readback={walletAddress:WALLET,chainId:1,transactionHash:HASH,key:'ETH:long:42',readAt:1002,facts:[{label:'Collateral',value:'0.358481260986328125 stETH'},{label:'Debt',value:'720.89147659306640625 fxUSD'},{label:'Leverage',value:'2×'}]};
 const html=await renderResult({result:execution,confirmedPosition:readback,receipts:[{...receipts[0],exactMovements:[{direction:'received',amount:'720.89147659306640625',symbol:'fxUSD'}]}]});
 const main=html.split('<summary>Execution details')[0];
 assert.match(main.replace(/<[^>]*>/g, ''),/≈ 720.89 fxUSD/);
 assert.match(main,/Position #42/);assert.match(main,/Updated/);
 assert.doesNotMatch(main,/Latest position|Read after confirmation|Not the earlier quote/);
 assert.match(html,/0.358481260986328125 stETH/);assert.match(html,/720.89147659306640625 fxUSD/);
 assert.match(html,/≈ 0.3585 stETH/);assert.match(html,/post-confirmation read/);
 assert.equal((html.match(/lucide-chevron-down/g)||[]).length,1);
 const stale=await renderResult({result:execution,confirmedPosition:{...readback,transactionHash:`0x${'b'.repeat(64)}`}});
 assert.doesNotMatch(stale,/post-confirmation read/);assert.match(stale,/Post-confirmation position values are unavailable/);assert.match(stale,/data-position-readback="unavailable"/);
});

test('pending preserves long identities and tiny or large units without decorative amount controls', async () => {
 const { PendingTransactionSummary } = await import('../src/components/review/PendingTransactionSummary');
 const name='Collateral adjustment for exceptionally long position identity';
 for(const value of ['0.000000000000000001 VeryLongTokenSymbol','9007199254740993123456789.123456789 VeryLongTokenSymbol']){
  const html=renderToStaticMarkup(React.createElement(PendingTransactionSummary,{identity:{name,subtitle:'Position #123456789 · Ethereum',symbol:'ETH',review:'Review position',confirm:'Confirm',amount:undefined,amountLabel:'Deposit',value:undefined},facts:[{label:'Deposit',value}],status:'submitted',steps:[],chainId:1,networkSwitching:false}));
  assert.match(html,/Submitted/);assert.match(html,/Do not resubmit/);assert.ok(html.includes(name));assert.match(html,/VeryLongTokenSymbol/);
  assert.ok(html.includes(value));assert.doesNotMatch(html,/NaN|Infinity|lucide-chevron-down/);
 }
 const css=readFileSync(new URL('../src/components/review/ActionReviewPresentation.module.css',import.meta.url),'utf8');
 assert.match(css,/\.pendingStatus strong \{[^}]*overflow-wrap: anywhere/);
});
