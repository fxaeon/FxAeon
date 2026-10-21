import assert from 'node:assert/strict';
import { test } from 'node:test';
import { positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from '../src/lib/fx/policy';
import { rawQuoteReviewFacts, routeFinancialReviewFacts, tokenAmountReviewFact } from '../src/lib/fx/reviewFormatting';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { factsOutsideConsequenceSummary, primaryReviewFacts, routeFacts } from '../src/components/review/actionReviewPresentation';
import { consequenceSummary } from '../src/components/review/actionReviewModel';
import { resultBodyDuringRefresh, resultPresentation } from '../src/components/review/executionResult';
import { splitReviewFacts } from '../src/components/review/reviewSummary';
import type { OfficialFxMethod, PlannedRoute, PlannedTransaction, ReviewedActionIntent, RouteDetails, TransactionExecutionResult } from '../src/lib/fx/types';

const WALLET = '0x1111111111111111111111111111111111111111';
const UNKNOWN = '0x2222222222222222222222222222222222222222';

test('approvals read as the exact amount the wallet signs, never rounded or marked "≈"', () => {
  // An approval is signed exactly, so it reads exactly (and matches the
  // exact input it usually equals) instead of a rounded "≈" figure.
  const fact = tokenAmountReviewFact('Approval', 89237941012345678901n, FX_TOKENS.fxSAVE.address);
  assert.equal(fact.value, '89.237941012345678901 fxSAVE');
  assert.equal(fact.title, '89.237941012345678901 fxSAVE');
  assert.equal(tokenAmountReviewFact('Approval', 1n, FX_TOKENS.fxSAVE.address).value, '0.000000000000000001 fxSAVE');
  assert.equal(tokenAmountReviewFact('Approval', 1234567890000n, FX_TOKENS.USDC.address).value, '1,234,567.89 USDC');
  assert.equal(tokenAmountReviewFact('Approval', 1234567n, FX_TOKENS.USDC.address).value, '1.234567 USDC');
  assert.equal(tokenAmountReviewFact('Approval', 123n, UNKNOWN).value, '123 raw units');
});

test('signed minimums read exactly while quote estimates keep "≈"', () => {
  const intent: ReviewedActionIntent = {
    kind: 'deposit-and-mint', poolAddress: positionPoolAddress('ETH', 'long'), positionId: 0,
    depositTokenAddress: FX_TOKENS.ETH.address, depositAmount: 244431136966270n, nativeInput: true, mintAmount: 100000000000000000n,
  };
  const facts = routeFinancialReviewFacts(route(intent, {
    colls: '244431136966270000', debts: '100000000000000000',
    economicLimits: [{ label: 'deposit conversion minimum output', value: '195994373861452' }],
  }));
  assert.equal(facts.find((fact) => fact.label === 'Estimated collateral')?.value, '≈ 0.24443113 stETH');
  assert.equal(facts.find((fact) => fact.label === 'Minimum converted deposit')?.value, '0.000195994373861452 wstETH');
});
const operations: Record<ReviewedActionIntent['kind'], OfficialFxMethod> = {
  'position-increase': 'increasePosition',
  'position-reduce': 'reducePosition',
  'position-adjust': 'adjustPositionLeverage',
  'deposit-and-mint': 'depositAndMint',
  'repay-and-withdraw': 'repayAndWithdraw',
  'fxsave-deposit': 'depositFxSave',
  'fxsave-withdraw': 'withdrawFxSave',
  'fxsave-claim': 'getRedeemTx',
};

function opening(market: 'ETH' | 'BTC' = 'ETH', side: 'long' | 'short' = 'long', positionId = 0): Extract<ReviewedActionIntent, { kind: 'position-increase' }> {
  return {
    kind: 'position-increase',
    poolAddress: positionPoolAddress(market, side),
    positionType: side,
    positionId,
    inputTokenAddress: FX_TOKENS.USDC.address,
    inputAmount: 1_000_000n,
    nativeInput: false,
    collateralTokenAddress: positionCollateralTokenAddress(market, side),
    debtTokenAddress: positionDebtTokenAddress(market, side),
  };
}

function route(intent: ReviewedActionIntent, details: RouteDetails): PlannedRoute {
  const mintRouter = '0xB753366082466c4B5984312f0c4Bb97554be067E';
  const borrow = intent.kind === 'deposit-and-mint';
  return {
    operation: operations[intent.kind],
    walletAddress: WALLET,
    chainId: 1,
    transactions: borrow ? [{ kind: 'action', operation: 'depositAndMint', chainId: 1, from: WALLET, to: mintRouter, data: '0x216d5108', value: 0n }] : [],
    policy: { walletAddress: WALLET, chainId: 1, reviewedAction: intent },
    details: borrow ? { protocolFeeQuote: { poolAddress: intent.poolAddress, routerAddress: mintRouter, ratios: ['0', '0', '0', '0'] }, ...details } : details,
  };
}

test('new ETH review formats the actual quoted collateral, debt, and decimal execution price', () => {
  const planned = route(opening(), {
    colls: '670412512785242112',
    debts: '1010218412345678901234',
    executionPrice: '2500.12345678901234567890123456789',
  });
  assert.deepEqual(routeFinancialReviewFacts(planned), [
    { label: 'Execution price', value: '≈ 2,500.1234 fxUSD / stETH', title: '2500.12345678901234567890123456789 fxUSD / stETH' },
    { label: 'Estimated collateral', value: '≈ 0.67041251 wstETH', title: '0.670412512785242112 wstETH' },
    { label: 'Estimated debt', value: '≈ 1,010.21841234 fxUSD', title: '1010.218412345678901234 fxUSD' },
  ]);
  assert.deepEqual(rawQuoteReviewFacts(planned), [
    { label: 'Execution price (unrounded)', value: planned.details!.executionPrice },
    { label: 'Collateral quote (raw units)', value: planned.details!.colls },
    { label: 'Debt quote (raw units)', value: planned.details!.debts },
  ]);
});

test('review consequence facts have one visible owner without a generic risk filler', () => {
  const facts = [
    { label: 'Amount', value: '10 fxUSD' },
    { label: 'Slippage', value: '0.5%' },
    { label: 'Gas fee', value: '0.001 ETH' },
  ];
  assert.deepEqual(factsOutsideConsequenceSummary(facts, [facts[0]!]), facts.slice(1));
  assert.equal(primaryReviewFacts(route(opening(), {})).some((fact) => fact.label === 'Risk'), false);
});

test('refresh copy never describes partial or failed position actions as confirmed', () => {
  for (const status of ['partial', 'failed'] as const) {
    assert.equal(resultBodyDuringRefresh({ status, refreshing: true, positionAction: true, body: 'Partially completed.' }), 'Partially completed.');
  }
  assert.equal(resultBodyDuringRefresh({ status: 'confirmed', refreshing: true, positionAction: true, body: 'Confirmed.' }), 'Transaction confirmed. Position details are refreshing.');
});

test('an approval-only partial result does not claim the reviewed action completed', () => {
  const approvalOnly: TransactionExecutionResult = {
    status: 'partial', operation: 'increasePosition', chainId: 1, walletAddress: WALLET as `0x${string}`,
    steps: [
      { index: 0, transaction: { kind: 'approval' } as PlannedTransaction, hash: `0x${'1'.repeat(64)}` as `0x${string}`, status: 'confirmed', receipt: { status: 'success' } as never },
      { index: 1, transaction: { kind: 'action' } as PlannedTransaction, status: 'failed' },
    ],
  };
  const presentation = resultPresentation(approvalOnly, false);
  assert.equal(presentation.title, 'Approval confirmed');
  assert.match(presentation.body, /Action not submitted/);

  const actionConfirmed: TransactionExecutionResult = { ...approvalOnly, steps: [
    ...approvalOnly.steps,
    { index: 2, transaction: { kind: 'action' } as PlannedTransaction, status: 'confirmed', receipt: { status: 'success' } as never },
  ] };
  assert.equal(resultPresentation(actionConfirmed, false).title, 'Partially completed');

  const actionSubmitted: TransactionExecutionResult = { ...approvalOnly, steps: [
    approvalOnly.steps[0]!,
    { index: 1, transaction: { kind: 'action' } as PlannedTransaction, hash: `0x${'2'.repeat(64)}` as `0x${string}`, status: 'submitted' as const },
  ] };
  assert.equal(resultPresentation(actionSubmitted, false).title, 'Confirmation unknown');
});

test('pure ActionReview presentation builder keeps verified action facts and authoritative costs together', () => {
  const planned = route(opening(), { colls: '670412512785242112', debts: '1010000000000000000000' });
  const primary = primaryReviewFacts(planned);
  assert.deepEqual(primary.slice(0, 2), [
    { label: 'Amount', value: '1 USDC', title: '1 USDC' },
    { label: 'Position', value: 'New position' },
  ]);
  const facts = routeFacts(planned, { estimate: undefined, estimateIsCurrent: false }, { protocolFee: '0.2 fxUSD' });
  assert.equal(facts.find((fact) => fact.label === 'f(x) fee')?.value, '0.2 fxUSD');
  assert.equal(facts.some((fact) => fact.label === 'Estimated debt'), true);
});

test('estimated leverage is concise while the exact quote and requested target are preserved', () => {
  const planned = route(opening(), { leverage: 2.0276220198182835, requestedLeverage: 2 });
  const facts = routeFacts(planned, { estimate: undefined, estimateIsCurrent: false }, {});
  assert.deepEqual(facts.find((fact) => fact.label === 'Leverage'), {
    label: 'Leverage', value: '≈ 2.02×', title: '2.0276220198182835×',
  });
  assert.equal(facts.find((fact) => fact.label === 'Target leverage')?.value, '2×');
  assert.equal(planned.details?.leverage, 2.0276220198182835);
});

test('bridge review keeps validated source, destination, asset, recipient, receive bound, and fee together', () => {
  const planned = {
    operation: 'buildBridgeTx',
    walletAddress: WALLET,
    chainId: 1,
    transactions: [],
    quote: {
      nativeFee: 1_000_000_000_000_000n,
      destinationChainId: 8453,
      recipient: WALLET,
      bridgeToken: 'fxUSD',
      bridgeAmount: 3_000_000_000_000_000_000n,
      minAmountLD: 2_990_000_000_000_000_000n,
    },
  } as unknown as PlannedRoute;

  assert.deepEqual(consequenceSummary(primaryReviewFacts(planned)), [
    { label: 'Source network', value: 'Ethereum' },
    { label: 'Destination network', value: 'Base' },
    { label: 'Asset', value: 'fxUSD' },
    { label: 'Amount', value: '3 fxUSD', title: '3 fxUSD' },
    { label: 'Minimum received', value: '2.99 fxUSD', title: '2.99 fxUSD' },
    { label: 'Recipient', value: WALLET },
    { label: 'Bridge fee', value: '0.001 ETH', title: '0.001 ETH' },
  ]);
  assert.equal(primaryReviewFacts(planned).find(fact => fact.label === 'Delivery estimate'), undefined);
});

test('bridge receipt estimates retain exact precision and disappear when stale or outside the send bounds', () => {
  const quote = { nativeFee: 100n, destinationChainId: 8453, bridgeToken: 'fxSAVE',
    bridgeAmount: 1_234_567_890_123_456_789n, minAmountLD: 1_234_500_000_000_000_000n,
    estimatedReceived: 1_234_550_000_000_000_001n, receiptReadAt: Date.now() };
  const planned = { operation: 'buildBridgeTx', chainId: 1, walletAddress: WALLET,
    transactions: [], quote } as unknown as PlannedRoute;
  assert.deepEqual(primaryReviewFacts(planned).find(fact => fact.label === 'Estimated received'), {
    label: 'Estimated received', value: '1.234550000000000001 fxSAVE', title: '1.234550000000000001 fxSAVE',
  });
  for (const changed of [
    { ...quote, receiptReadAt: Date.now() - 30_001 },
    { ...quote, receiptReadAt: Date.now() + 30_000 },
    { ...quote, estimatedReceived: quote.bridgeAmount + 1n },
    { ...quote, estimatedReceived: quote.minAmountLD - 1n },
  ]) assert.equal(primaryReviewFacts({ ...planned, quote: changed }).some(fact => fact.label === 'Estimated received'), false);
});

test('BTC quote accounting uses 18 decimals, while converter output uses 8 decimals', () => {
  const planned = route(opening('BTC'), {
    colls: '123456780000000000',
    debts: '1000000000000000000000',
    executionPrice: '65000.25',
    economicLimits: [{ label: 'position input conversion minimum output', value: '12345678' }],
  });
  assert.deepEqual(routeFinancialReviewFacts(planned).map(({ label, value }) => ({ label, value })), [
    { label: 'Execution price', value: '65,000.25 fxUSD / WBTC' },
    { label: 'Estimated collateral', value: '0.12345678 WBTC' },
    { label: 'Estimated debt', value: '1,000 fxUSD' },
    { label: 'Minimum converted input', value: '0.12345678 WBTC' },
  ]);
});

test('short collateral is fxUSD and short debt retains the derivative denomination', () => {
  for (const [market, symbol] of [['ETH', 'wstETH'], ['BTC', 'WBTC']] as const) {
    const facts = routeFinancialReviewFacts(route(opening(market, 'short'), {
      colls: '1234500000000000000000', debts: '123456780000000000',
    }));
    assert.equal(facts[0].value, '1,234.5 fxUSD');
    assert.equal(facts[1].value, `0.12345678 ${symbol}`);
  }
});

test('ETH reductions use stETH accounting and the actual output-token minimum', () => {
  const intent: ReviewedActionIntent = { ...opening(), kind: 'position-reduce', positionId: 4, outputTokenAddress: FX_TOKENS.USDC.address, isClosePosition: false };
  const planned = route(intent, {
    colls: '1000000000000000000', debts: '0', minOut: '1234567',
    economicLimits: [{ label: 'position output conversion minimum output', value: '1234567' }],
  });
  const facts = routeFinancialReviewFacts(planned);
  assert.equal(facts.find((fact) => fact.label === 'Estimated collateral')?.value, '1 stETH');
  assert.equal(facts.find((fact) => fact.label === 'Estimated debt')?.value, '0 fxUSD');
  assert.deepEqual(facts.filter((fact) => fact.label.includes('Minimum received')), [
    { label: 'Minimum received', value: '1.234567 USDC', title: '1.234567 USDC' },
  ]);
  const differentQuote = routeFinancialReviewFacts({ ...planned, details: { ...planned.details, minOut: '2000000' } });
  assert.equal(differentQuote.find((fact) => fact.label === 'Minimum received')?.value, '1.234567 USDC');
  assert.equal(differentQuote.find((fact) => fact.label === 'Quoted minimum received')?.value, '2 USDC');
});

test('existing ETH increases and adjustments do not mislabel ambiguous collateral quotes', () => {
  const increase = opening('ETH', 'long', 4);
  const adjust: ReviewedActionIntent = { ...increase, kind: 'position-adjust', requestedLeverage: 2 };
  for (const intent of [increase, adjust]) {
    const planned = route(intent, { colls: '670412512785242112', debts: '1000000000000000000' });
    assert.equal(routeFinancialReviewFacts(planned).some((fact) => fact.label === 'Estimated collateral'), false);
    assert.equal(routeFinancialReviewFacts(planned).find((fact) => fact.label === 'Estimated debt')?.value, '1 fxUSD');
    assert.equal(rawQuoteReviewFacts(planned).find((fact) => fact.label === 'Collateral quote (raw units)')?.value, '670412512785242112');
  }
});

// wstETH.stEthPerToken() on mainnet at block 26,150,567 (9 October 2026).
const RATE = '1245861716930919999';
const LONG_OPEN = '0xef9e1aa7';
const LONG_CLOSE = '0xe8e9fc2a';
const collateralFact = (planned: PlannedRoute) => routeFinancialReviewFacts(planned).find((fact) => fact.label === 'Estimated collateral');
/** A route's one protocol action, so a leverage change's branch reads from its selector. */
function withAction(planned: PlannedRoute, selector: string): PlannedRoute {
  return { ...planned, transactions: [{ chainId: 1, from: WALLET, to: UNKNOWN, data: `${selector}00` as `0x${string}`, value: 0n, kind: 'action', operation: planned.operation }] };
}

test('a new ETH long states its wstETH quote in stETH at the rate read with it, with the quote in the title', () => {
  // 0.670412512785242112 wstETH × 1.245861716930919999 stETH per wstETH, rounded down to the wei.
  assert.deepEqual(collateralFact(route(opening(), { colls: '670412512785242112', debts: '1', stEthPerWstEth: RATE })), {
    label: 'Estimated collateral',
    value: '≈ 0.83524128 stETH',
    title: '0.835241284230594092 stETH (0.670412512785242112 wstETH at 1.245861716930919999 stETH per wstETH)',
  });
  // A converted figure is an estimate even when every digit fits.
  assert.equal(collateralFact(route(opening(), { colls: '1000000000000000000', debts: '1', stEthPerWstEth: '1250000000000000000' }))?.value, '≈ 1.25 stETH');
  // Rounded down, never up: one wei of wstETH is one wei of stETH at 1.2458.
  const tiny = collateralFact(route(opening(), { colls: '1', debts: '1', stEthPerWstEth: RATE }));
  assert.equal(tiny?.value, '<0.00000001 stETH');
  assert.match(tiny?.title ?? '', /^0\.000000000000000001 stETH \(/);
});

test('without a usable rate a new ETH long keeps its native wstETH figure, never a guessed or 1:1 rate', () => {
  for (const stEthPerWstEth of [undefined, '', '0', '1000000000000000000', '10000000000000000000', '1.25', '-1245861716930919999', 'NaN']) {
    assert.deepEqual(collateralFact(route(opening(), { colls: '670412512785242112', debts: '1', stEthPerWstEth })), {
      label: 'Estimated collateral', value: '≈ 0.67041251 wstETH', title: '0.670412512785242112 wstETH',
    }, String(stEthPerWstEth));
  }
});

test('an existing ETH long adds its new wstETH, converted, to the stETH it holds, or shows no estimate', () => {
  // The SDK's open/add quote is the held stETH plus the new collateral in wstETH.
  const details = { colls: '9847412175152768908', debts: '1', stEthPerWstEth: RATE, currentColls: '9176999662367526796' };
  const increase = opening('ETH', 'long', 4);
  const adjust: ReviewedActionIntent = { ...increase, kind: 'position-adjust', requestedLeverage: 3 };
  const expected = {
    label: 'Estimated collateral',
    value: '≈ 10.01224094 stETH',
    title: '10.012240946598120888 stETH (9.176999662367526796 stETH held plus 0.670412512785242112 wstETH at 1.245861716930919999 stETH per wstETH)',
  };
  assert.deepEqual(collateralFact(route(increase, details)), expected);
  assert.deepEqual(collateralFact(withAction(route(adjust, details), LONG_OPEN)), expected);
  // Without the rate or the held collateral, with a held figure above the
  // quote, or for a leverage change whose branch is unknown: no estimate.
  for (const planned of [
    route(increase, { ...details, stEthPerWstEth: undefined }),
    route(increase, { ...details, currentColls: undefined }),
    route(increase, { ...details, currentColls: '9847412175152768909' }),
    route(adjust, details),
    withAction(route(adjust, details), '0x12345678'),
  ]) assert.equal(collateralFact(planned), undefined);
});

test('ETH long leverage decreases, reductions, borrowing and repayment are quoted in stETH already', () => {
  // These SDK quotes add or subtract collateral × the pool's rate, so a rate changes nothing.
  const stEth = { label: 'Estimated collateral', value: '8.5 stETH', title: '8.5 stETH' };
  const details = { colls: '8500000000000000000', debts: '1', stEthPerWstEth: RATE };
  const position = opening('ETH', 'long', 4);
  assert.deepEqual(collateralFact(withAction(route({ ...position, kind: 'position-adjust', requestedLeverage: 2 }, details), LONG_CLOSE)), stEth);
  assert.deepEqual(collateralFact(route({ ...position, kind: 'position-reduce', outputTokenAddress: FX_TOKENS.ETH.address, isClosePosition: false }, details)), stEth);
  assert.deepEqual(collateralFact(route({
    kind: 'deposit-and-mint', poolAddress: positionPoolAddress('ETH', 'long'), positionId: 4,
    depositTokenAddress: FX_TOKENS.stETH.address, depositAmount: 1n, nativeInput: false, mintAmount: 1n,
  }, details)), { ...stEth, title: `${stEth.title}; accepted f(x) supply fee is 0%, so this quote needs no supply fee deduction.` });
  assert.deepEqual(collateralFact(route({
    kind: 'repay-and-withdraw', poolAddress: positionPoolAddress('ETH', 'long'), positionId: 4,
    minimumRepayAmount: 1n, repayTokenAddress: FX_TOKENS.fxUSD.address, withdrawTokenAddress: FX_TOKENS.wstETH.address,
    withdrawAmount: 1n, collateralTokenAddress: FX_TOKENS.wstETH.address,
  }, details)), stEth);
});

test('ETH short and BTC quotes keep their own units, with or without a wstETH rate', () => {
  for (const [market, side, positionId, collateral, debt] of [
    ['ETH', 'short', 0, '0.12345678 fxUSD', '1,234.5 wstETH'],
    ['ETH', 'short', 9, '0.12345678 fxUSD', '1,234.5 wstETH'],
    ['BTC', 'short', 0, '0.12345678 fxUSD', '1,234.5 WBTC'],
    ['BTC', 'long', 0, '0.12345678 WBTC', '1,234.5 fxUSD'],
    ['BTC', 'long', 9, '0.12345678 WBTC', '1,234.5 fxUSD'],
  ] as const) {
    for (const stEthPerWstEth of [undefined, RATE]) {
      const facts = routeFinancialReviewFacts(route(opening(market, side, positionId), {
        colls: '123456780000000000', debts: '1234500000000000000000', stEthPerWstEth,
        economicLimits: [{ label: 'position input conversion minimum output', value: market === 'BTC' && side === 'long' ? '12345678' : '1000000000000000000' }],
      }));
      const label = `${market} ${side} #${positionId} ${stEthPerWstEth ? 'with' : 'without'} a rate`;
      assert.equal(facts.find((fact) => fact.label === 'Estimated collateral')?.value, collateral, label);
      assert.equal(facts.find((fact) => fact.label === 'Estimated debt')?.value, debt, label);
      // Their converted-input floors are not wstETH and gain no stETH equivalent.
      assert.equal(facts.find((fact) => fact.label === 'Minimum converted input')?.equivalent, undefined, label);
    }
  }
});

test('a wstETH floor stays exact in the unit it is signed in, with its stETH equivalent beside it', () => {
  const minimum = (planned: PlannedRoute, label: string) => routeFinancialReviewFacts(planned).find((fact) => fact.label === label);
  const input = (stEthPerWstEth?: string, value = '699300699300699300') => route(opening(), {
    colls: '1', debts: '1', stEthPerWstEth,
    economicLimits: [{ label: 'position input conversion minimum output', value }],
  });
  // Trade: the converted input, rounded down in stETH like the pool.
  assert.deepEqual(minimum(input(RATE), 'Minimum converted input'), {
    label: 'Minimum converted input', value: '0.6993006993006993 wstETH', title: '0.6993006993006993 wstETH', equivalent: '≈ 0.87123196 stETH',
  });
  // Borrow: the converted deposit beside a quote already in stETH.
  const deposit = route({
    kind: 'deposit-and-mint', poolAddress: positionPoolAddress('ETH', 'long'), positionId: 0,
    depositTokenAddress: FX_TOKENS.ETH.address, depositAmount: 244431136966270n, nativeInput: true, mintAmount: 100000000000000000n,
  }, {
    colls: '244431136966270000', debts: '100000000000000000', stEthPerWstEth: RATE,
    economicLimits: [{ label: 'deposit conversion minimum output', value: '195994373861452' }],
  });
  assert.equal(minimum(deposit, 'Estimated collateral')?.value, '≈ 0.24443113 stETH');
  assert.deepEqual(minimum(deposit, 'Minimum converted deposit'), {
    label: 'Minimum converted deposit', value: '0.000195994373861452 wstETH', title: '0.000195994373861452 wstETH', equivalent: '≈ 0.00024418 stETH',
  });
  // No rate or a zero floor: the exact floor alone.
  assert.equal(minimum(input(), 'Minimum converted input')?.equivalent, undefined);
  assert.deepEqual(minimum(input(RATE, '0'), 'Minimum converted input'), { label: 'Minimum converted input', value: '0 wstETH', title: '0 wstETH' });
  // What a reduction pays out is a received amount, not collateral entering the position.
  const reduce = route({ ...opening('ETH', 'long', 4), kind: 'position-reduce', outputTokenAddress: FX_TOKENS.wstETH.address, isClosePosition: false }, {
    colls: '1', debts: '1', minOut: '500000000000000000', stEthPerWstEth: RATE,
    economicLimits: [{ label: 'position output conversion minimum output', value: '500000000000000000' }],
  });
  assert.deepEqual(minimum(reduce, 'Minimum received'), { label: 'Minimum received', value: '0.5 wstETH', title: '0.5 wstETH' });
});

test('the reads behind a converted figure stay inspectable in advanced details', () => {
  const planned = route(opening('ETH', 'long', 4), { colls: '9847412175152768908', debts: '1', stEthPerWstEth: RATE, currentColls: '9176999662367526796' });
  assert.deepEqual(rawQuoteReviewFacts(planned).slice(-2), [
    { label: 'Collateral held (raw units)', value: '9176999662367526796' },
    { label: 'stETH per wstETH (1e18 units)', value: RATE },
  ]);
});

test('borrow quotes use pool accounting, not the deposit input units', () => {
  const intent: ReviewedActionIntent = {
    kind: 'deposit-and-mint', poolAddress: positionPoolAddress('ETH', 'long'), positionId: 0,
    depositTokenAddress: FX_TOKENS.USDC.address, depositAmount: 1_000_000n, nativeInput: false, mintAmount: 1n,
  };
  const facts = routeFinancialReviewFacts(route(intent, {
    colls: '1000000000000000000', debts: '2000000000000000000', executionPrice: '2500',
    economicLimits: [{ label: 'deposit conversion minimum output', value: '200000000000000000' }],
  }));
  assert.equal(facts.find((fact) => fact.label === 'Estimated collateral')?.value, '1 stETH');
  assert.equal(facts.find((fact) => fact.label === 'Estimated debt')?.value, '2 fxUSD');
  assert.equal(facts.some((fact) => fact.label === 'Receive'), false, 'Do not invent net proceeds when the SDK only quotes debt');
  assert.equal(primaryReviewFacts(route(intent, { colls: '1000000000000000000', debts: '2000000000000000000' })).find((fact) => fact.label === 'Debt added')?.title, '0.000000000000000001 fxUSD');
  assert.equal(facts.find((fact) => fact.label === 'Minimum converted deposit')?.value, '0.2 wstETH');
  assert.equal(facts.some((fact) => fact.label === 'Execution price'), false, 'An oracle price is not a swap execution price');
});

test('repay fee padding cannot become negative displayed debt and output minimum uses chosen units', () => {
  const intent: ReviewedActionIntent = {
    kind: 'repay-and-withdraw', poolAddress: positionPoolAddress('BTC', 'long'), positionId: 7,
    minimumRepayAmount: 1n, repayTokenAddress: FX_TOKENS.fxUSD.address,
    withdrawTokenAddress: FX_TOKENS.USDC.address, withdrawAmount: 2_000_000n,
    collateralTokenAddress: FX_TOKENS.WBTC.address,
  };
  const planned = route(intent, {
    colls: '0', debts: '-1000000000',
    economicLimits: [
      { label: 'repay conversion minimum output', value: '1000000000000000000' },
      { label: 'withdraw output conversion minimum output', value: '2000000' },
    ],
  });
  const facts = routeFinancialReviewFacts(planned);
  assert.equal(facts.some((fact) => fact.label === 'Estimated debt'), false);
  assert.equal(facts.find((fact) => fact.label === 'Minimum debt repaid')?.value, '1 fxUSD');
  assert.equal(facts.find((fact) => fact.label === 'Minimum received')?.value, '2 USDC');
  assert.equal(rawQuoteReviewFacts(planned).find((fact) => fact.label === 'Debt quote (raw units)')?.value, '-1000000000');
});

test('fxSAVE deposits show independent input-conversion and share minimum units', () => {
  for (const [token, raw] of [[FX_TOKENS.USDC, '1234567'], [FX_TOKENS.fxUSD, '1234567000000000000']] as const) {
    const intent: ReviewedActionIntent = { kind: 'fxsave-deposit', tokenInAddress: token.address, amount: 1n, receiver: WALLET, directBasePool: false };
    const facts = routeFinancialReviewFacts(route(intent, {
      economicLimits: [
        { label: 'fxSAVE deposit conversion minimum output', value: raw },
        { label: 'fxSAVE deposit base-pool minimum shares', value: '2500000000000000000' },
      ],
    }));
    assert.equal(facts.find(fact => fact.label === 'Minimum converted deposit')?.value, `1.234567 ${token.key}`);
    assert.equal(facts.find(fact => fact.label === 'Minimum fxSP')?.value, '2.5 fxSP');
  }
});

test('stable fxSAVE deposit review discloses the final-share limitation without claiming selected slippage', () => {
  for (const token of [FX_TOKENS.USDC, FX_TOKENS.fxUSD]) {
    const intent: ReviewedActionIntent = {
      kind: 'fxsave-deposit', tokenInAddress: token.address, amount: 1n,
      receiver: WALLET, directBasePool: false, slippagePercent: 0.5,
    };
    const planned = route(intent, { economicLimits: [
      { label: 'fxSAVE deposit base-pool minimum shares', value: '79968000000000000000' },
    ] });
    const facts = routeFacts(planned, { estimate: undefined, estimateIsCurrent: false }, {});
    const { summary } = splitReviewFacts(facts);
    assert.deepEqual(summary.find(fact => fact.label === 'Final fxSAVE minimum'), {
      label: 'Final fxSAVE minimum', value: 'Not enforced by this route',
    });
    assert.equal(summary.find(fact => fact.label === 'Minimum fxSP')?.value, '79.968 fxSP');
    assert.equal(facts.some(fact => fact.label === 'Slippage' || fact.label === 'Minimum fxSAVE received'), false);
  }
  const withdrawal: ReviewedActionIntent = {
    kind: 'fxsave-withdraw', tokenOutAddress: FX_TOKENS.USDC.address, amount: 1n,
    receiver: WALLET, directBasePool: false, instant: true, slippagePercent: 0.75,
  };
  assert.equal(primaryReviewFacts(route(withdrawal, {})).find(fact => fact.label === 'Slippage')?.value, '0.75%');
});

test('identity fxSAVE deposits omit only the zero converter no-op and retain the positive share floor', () => {
  const intent: ReviewedActionIntent = {
    kind: 'fxsave-deposit', tokenInAddress: FX_TOKENS.USDC.address, amount: 1_000_000n,
    receiver: WALLET, directBasePool: false,
  };
  const planned = route(intent, {
    economicLimits: [
      { label: 'fxSAVE deposit conversion minimum output', value: '0' },
      { label: 'fxSAVE deposit base-pool minimum shares', value: '892022464500000000000' },
    ],
    conversionPaths: [{ label: 'fxSAVE deposit conversion', fingerprint: `0x${'1'.repeat(64)}` }],
  });
  const facts = routeFinancialReviewFacts(planned);
  assert.deepEqual(facts.map(({ label, value }) => ({ label, value })), [
    { label: 'Estimated fxSAVE received', value: 'Unavailable' },
    { label: 'Minimum fxSP', value: '892.0224645 fxSP' },
  ]);
});

test('routed fxSAVE deposit conversion floors, including zero-valued other limits, remain visible', () => {
  const intent: ReviewedActionIntent = {
    kind: 'fxsave-deposit', tokenInAddress: FX_TOKENS.USDC.address, amount: 1_000_000n,
    receiver: WALLET, directBasePool: false,
  };
  const planned = route(intent, {
    economicLimits: [
      { label: 'fxSAVE deposit conversion minimum output', value: '900000' },
      { label: 'unrecognized route limit', value: '0' },
      { label: 'fxSAVE deposit base-pool minimum shares', value: '800000000000000000' },
    ],
    conversionPaths: [{ label: 'fxSAVE deposit conversion', fingerprint: `0x${'2'.repeat(64)}` }],
  });
  const facts = routeFinancialReviewFacts(planned);
  assert.equal(facts.find((fact) => fact.label === 'Minimum converted deposit')?.value, '0.9 USDC');
  assert.equal(facts.find((fact) => fact.label === 'Additional limits')?.value, 'See advanced details');
  assert.equal(facts.find((fact) => fact.label === 'Minimum fxSP')?.value, '0.8 fxSP');
});

test('both instant fxSAVE output legs use the destination token decimals', () => {
  const intent: ReviewedActionIntent = { kind: 'fxsave-withdraw', tokenOutAddress: FX_TOKENS.USDC.address, amount: 1n, receiver: WALLET, directBasePool: false, instant: true };
  const facts = routeFinancialReviewFacts(route(intent, {
    economicLimits: [
      { label: 'fxUSD instant output minimum output', value: '1234567' },
      { label: 'USDC instant output minimum output', value: '7654321' },
    ],
  }));
  assert.deepEqual(facts.map(({ label, value }) => ({ label, value })), [
    { label: 'Estimated received', value: 'Unavailable' },
    { label: 'f(x) fee', value: 'Unavailable' },
    { label: 'Minimum received (fxUSD leg)', value: '1.234567 USDC' },
    { label: 'Minimum received (USDC leg)', value: '7.654321 USDC' },
  ]);
});

test('tiny positive amounts are not rounded to zero and huge amounts retain integer precision', () => {
  const facts = routeFinancialReviewFacts(route(opening(), { colls: '1', debts: '9007199254740993123456789000000000000000' }));
  assert.deepEqual(facts[0], { label: 'Estimated collateral', value: '<0.00000001 wstETH', title: '0.000000000000000001 wstETH' });
  assert.equal(facts[1].value, '9,007,199,254,740,993,123,456.789 fxUSD');
});

test('unrecognized units and malformed source values stay verbatim in advanced details', () => {
  const intent: ReviewedActionIntent = { ...opening(), kind: 'position-reduce', positionId: 4, outputTokenAddress: UNKNOWN, isClosePosition: false };
  const planned = route(intent, {
    colls: '-1', debts: '1e18', executionPrice: 'NaN', minOut: '1000000',
    economicLimits: [{ label: 'position output conversion minimum output', value: '1000000' }],
  });
  assert.deepEqual(routeFinancialReviewFacts(planned), [{ label: 'Additional limits', value: 'See advanced details' }]);
  assert.deepEqual(rawQuoteReviewFacts(planned).map((fact) => fact.value), ['NaN', '1000000', '-1', '1e18']);
  assert.deepEqual(planned.details?.economicLimits, [{ label: 'position output conversion minimum output', value: '1000000' }]);
  for (const invalid of ['Infinity', '-0.1', '1e3', '1.2.3', '', '0']) {
    assert.equal(routeFinancialReviewFacts(route(opening(), { executionPrice: invalid })).some((fact) => fact.label === 'Execution price'), false);
  }
});

test('interpretation requires the known network, operation, pool, and intended token pair', () => {
  const details = { colls: '1000000000000000000', debts: '1000000000000000000', executionPrice: '2500' };
  const planned = route(opening(), details);
  for (const unsupported of [
    { ...planned, policy: undefined },
    { ...planned, chainId: 8453 as const },
    { ...planned, operation: 'buildBridgeTx' as const },
    route({ ...opening(), poolAddress: UNKNOWN }, details),
    route({ ...opening(), collateralTokenAddress: FX_TOKENS.USDC.address }, details),
    route({ ...opening(), positionType: 'short' }, details),
  ]) {
    assert.deepEqual(routeFinancialReviewFacts(unsupported), []);
    assert.equal(rawQuoteReviewFacts(unsupported).length, 3);
  }
  const before = structuredClone(planned);
  routeFinancialReviewFacts(planned);
  rawQuoteReviewFacts(planned);
  assert.deepEqual(planned, before);
});
