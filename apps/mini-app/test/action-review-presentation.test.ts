import assert from 'node:assert/strict';
import test from 'node:test';
import { exactAmountText, exactAmountValue, missingGasFeeFact, missingTotalCostFact, nativeFundsNotice, primaryReviewFacts, routeFacts } from '../src/components/review/actionReviewPresentation';
import { splitReviewFacts } from '../src/components/review/reviewSummary';
import { consequenceSummary } from '../src/components/review/actionReviewModel';
import { positionPoolAddress } from '../src/lib/fx/policy';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import type { RouteGasCostEstimate } from '../src/lib/fx/gasCost';
import type { PlannedRoute } from '../src/lib/fx';

const route = (value = 0n): PlannedRoute => ({
  operation: 'increasePosition',
  chainId: 1,
  walletAddress: '0x1111111111111111111111111111111111111111',
  transactions: [{ to: '0x2222222222222222222222222222222222222222', data: '0x1234', value, kind: 'action' }],
} as unknown as PlannedRoute);

function estimate({ nativeValueWei = 0n, executionGasFeeWei = 1_000_000_000_000_000n, totalNativeCostWei = executionGasFeeWei }: {
  nativeValueWei?: bigint;
  executionGasFeeWei?: bigint;
  totalNativeCostWei?: bigint;
} = {}): RouteGasCostEstimate {
  return {
    routeKey: 'route',
    chainId: 1,
    walletAddress: route().walletAddress,
    operation: 'increasePosition',
    status: 'current',
    fetchedAt: 1,
    validUntil: 2,
    steps: [],
    nativeValueWei,
    executionGasFeeWei,
    totalNativeCostWei,
  };
}

function withdrawalRoute(tokenOut: 'USDC' | 'fxUSD' | 'fxUSDBasePool', instant = false): PlannedRoute {
  return {
    ...route(),
    operation: 'withdrawFxSave',
    policy: { walletAddress: route().walletAddress, chainId: 1, reviewedAction: {
      kind: 'fxsave-withdraw', tokenOutAddress: FX_TOKENS[tokenOut].address,
      amount: 10n ** 18n, receiver: route().walletAddress, instant,
      directBasePool: tokenOut === 'fxUSDBasePool',
    } },
  } as unknown as PlannedRoute;
}

test('queued fxSAVE reviews keep both later claim assets visible for either selected stablecoin', () => {
  for (const token of ['USDC', 'fxUSD'] as const) {
    const facts = primaryReviewFacts(withdrawalRoute(token));
    // Either claim leg can be zero; review must not promise positive amounts of both.
    const receive = { label: 'Receive', value: 'fxUSD and/or USDC (later claim)' };
    assert.deepEqual(facts.find((fact) => fact.label === 'Receive'), receive);
    assert.equal(facts.find((fact) => fact.label === 'Mode')?.value, 'Queued');
    // This correction must survive both compact review and consequence summaries.
    assert.deepEqual(splitReviewFacts(facts).summary.find((fact) => fact.label === 'Receive'), receive);
    assert.deepEqual(consequenceSummary(facts).find((fact) => fact.label === 'Receive'), receive);
  }
});

test('instant fxSAVE reviews retain the selected converted receive asset', () => {
  for (const token of ['USDC', 'fxUSD'] as const) {
    const facts = primaryReviewFacts(withdrawalRoute(token, true));
    assert.deepEqual(facts.find((fact) => fact.label === 'Receive'), { label: 'Receive', value: token });
    assert.equal(facts.find((fact) => fact.label === 'Mode')?.value, 'Instant');
  }
});

test('direct fxSAVE reviews receive fxSP without a later claim', () => {
  const facts = primaryReviewFacts(withdrawalRoute('fxUSDBasePool'));
  assert.deepEqual(facts.find((fact) => fact.label === 'Receive'), { label: 'Receive', value: 'fxSP' });
  assert.equal(facts.find((fact) => fact.label === 'Mode')?.value, 'Direct');
});

test('gas fee row remains stable while the optional estimate loads and reports failure without blocking', () => {
  const loading = { status: 'refreshing' as const, estimateIsCurrent: false, estimate: undefined, error: undefined };
  assert.deepEqual(missingGasFeeFact(loading), { label: 'Gas fee', value: '—' });

  const unavailable = { status: 'unavailable' as const, estimateIsCurrent: false, estimate: undefined, error: 'RPC unavailable' };
  assert.deepEqual(missingGasFeeFact(unavailable), {
    label: 'Gas fee', value: 'Unavailable',
  });
  assert.deepEqual(missingGasFeeFact({ status: 'unavailable', estimateIsCurrent: false, estimate: undefined, error: undefined }), {
    label: 'Gas fee', value: 'Unavailable',
  });
});

test('reserves a total-cost row only for a route that sends native value', () => {
  assert.deepEqual(missingTotalCostFact(route(), { status: 'refreshing', estimateIsCurrent: false }), undefined);
  assert.deepEqual(missingTotalCostFact(route(1n), { status: 'refreshing', estimateIsCurrent: false }), {
    label: 'Total cost', value: '—',
  });
  assert.deepEqual(missingTotalCostFact(route(1n), { status: 'unavailable', estimateIsCurrent: false }), {
    label: 'Total cost', value: 'Unavailable',
  });
});

test('total cost is omitted only when zero native value makes it numerically equal to gas fee', () => {
  const gasOnly = estimate();
  const facts = routeFacts(route(), { estimate: gasOnly, estimateIsCurrent: true });
  assert.deepEqual(facts.map(({ label }) => label), ['Gas fee']);

  const withAdditionalNativeCost = estimate({ totalNativeCostWei: 1_100_000_000_000_000n });
  const differentTotalFacts = routeFacts(route(), { estimate: withAdditionalNativeCost, estimateIsCurrent: true });
  assert.deepEqual(differentTotalFacts.map(({ label }) => label), ['Gas fee', 'Total cost']);

  const nonzeroNativeRoute = estimate({ nativeValueWei: 1n });
  const nonzeroNativeFacts = routeFacts(route(1n), { estimate: nonzeroNativeRoute, estimateIsCurrent: true });
  assert.deepEqual(nonzeroNativeFacts.map(({ label }) => label), ['Gas fee', 'Total cost']);
});

test('Base gas combines network components without duplicating a fee-only total', () => {
  // The wallet must fund the 20%-buffered gas limit at the max fee (1.2 Gwei)
  // plus the L1 data (0.2 Gwei) and operator (0.1 Gwei) fees: a 1.5 Gwei max.
  const baseEstimate = {
    ...estimate({ executionGasFeeWei: 1_000_000_000n, totalNativeCostWei: 1_300_000_000n }),
    chainId: 8453 as const,
    l1DataFeeWei: 200_000_000n,
    operatorFeeWei: 100_000_000n,
    requiredNativeCostWei: 1_500_000_000n,
  };
  const baseRoute = { ...route(), chainId: 8453 as const };
  const facts = routeFacts(baseRoute, { estimate: baseEstimate, estimateIsCurrent: true });
  assert.deepEqual(facts.map(({ label, value }) => ({ label, value })), [{ label: 'Gas fee', value: '1.5 Gwei max' }]);
  const withValue = { ...baseEstimate, nativeValueWei: 500_000_000n, totalNativeCostWei: 1_800_000_000n, requiredNativeCostWei: 2_000_000_000n };
  const valueFacts = routeFacts({ ...baseRoute, transactions: route(500_000_000n).transactions }, { estimate: withValue, estimateIsCurrent: true });
  assert.deepEqual(valueFacts.map(({ label, value }) => ({ label, value })), [
    { label: 'Gas fee', value: '1.5 Gwei max' },
    { label: 'Total cost', value: '2 Gwei max' },
  ]);
  // Without a funding figure the expected cost is shown, and never called a max.
  const { requiredNativeCostWei: _omitted, ...expectedOnly } = baseEstimate;
  assert.deepEqual(routeFacts(baseRoute, { estimate: expectedOnly, estimateIsCurrent: true }).map(({ label, value }) => ({ label, value })), [
    { label: 'Gas fee', value: '1.3 Gwei' },
  ]);
});

test('the funds notice names the exact ETH to add on the network that pays it', () => {
  const short = { insufficientNativeBalance: true, nativeValueWei: 0n, requiredNativeCostWei: 1_008_000_000_000_000n, nativeBalanceWei: 400_000_000_000_000n };
  assert.equal(nativeFundsNotice(short, 'Ethereum'), 'Add at least 0.000608 ETH on Ethereum to cover network fees.');
  assert.equal(nativeFundsNotice({ ...short, requiredNativeCostWei: 400_000_000_000_001n }, 'Base'), 'Add at least 0.000001 ETH on Base to cover network fees.');
  // Rounded up: adding the amount shown is always enough.
  assert.equal(nativeFundsNotice({ ...short, requiredNativeCostWei: 1_018_123_456_789_012n }, 'Ethereum'), 'Add at least 0.000619 ETH on Ethereum to cover network fees.');
  // A balance below the amount itself needs the amount topped up as well.
  assert.equal(
    nativeFundsNotice({ insufficientNativeBalance: true, nativeValueWei: 500_000_000_000_000n, requiredNativeCostWei: 1_100_000_000_000_000n, nativeBalanceWei: 300_000_000_000_000n }, 'Ethereum'),
    'Add at least 0.0008 ETH on Ethereum to cover the amount and network fees.',
  );
  // A partial estimate proves the gap but not its size, so no figure is invented.
  assert.equal(nativeFundsNotice({ ...short, requiredNativeCostWei: undefined }, 'Base'), 'This wallet needs more ETH on Base for network fees.');
  assert.equal(nativeFundsNotice(undefined, 'Ethereum'), 'This wallet needs more ETH on Ethereum for network fees.');
});

test('inputs read exactly with grouping, so an entered amount matches its verified route', () => {
  assert.equal(exactAmountText('0.00024443113696627'), '0.00024443113696627');
  assert.equal(exactAmountText('1234567.50'), '1,234,567.5');
  assert.equal(exactAmountText('.5'), '0.5');
  assert.equal(exactAmountText('007'), '7');
  assert.equal(exactAmountValue('0.50 ETH'), '0.5 ETH');
  assert.equal(exactAmountValue('1234 USDC'), '1,234 USDC');
  // Trade groups the typed amount before review; trailing zeros still go.
  assert.equal(exactAmountValue('1,234.50 USDC'), '1,234.5 USDC');
  assert.equal(exactAmountValue('12,345,678 USDC'), '12,345,678 USDC');
  assert.equal(exactAmountValue('New position'), 'New position');
  const planned = {
    ...route(244_431_136_966_270n),
    policy: { walletAddress: route().walletAddress, chainId: 1, reviewedAction: {
      kind: 'position-increase', poolAddress: positionPoolAddress('ETH', 'long'), positionType: 'long', positionId: 0,
      inputTokenAddress: FX_TOKENS.ETH.address, inputAmount: 244_431_136_966_270n, nativeInput: true,
      collateralTokenAddress: FX_TOKENS.wstETH.address, debtTokenAddress: FX_TOKENS.fxUSD.address,
    } },
  } as unknown as PlannedRoute;
  const amount = primaryReviewFacts(planned).find((fact) => fact.label === 'Amount');
  assert.deepEqual(amount, { label: 'Amount', value: '0.00024443113696627 ETH', title: '0.00024443113696627 ETH' });
  assert.equal(exactAmountValue('0.00024443113696627 ETH'), amount?.value);
});

test('network cost estimates round up, so the review never shows less than the quote', () => {
  const facts = routeFacts(route(), { estimate: undefined, estimateIsCurrent: false }, { gasFee: '0.000825001 ETH (max)', totalCost: '1234.5678912 ETH (native value + max execution)' });
  assert.equal(facts.find((fact) => fact.label === 'Gas fee')?.value, '≈ 0.000826 ETH max');
  assert.equal(facts.find((fact) => fact.label === 'Total cost')?.value, '≈ 1,234.567892 ETH max');
  const exact = routeFacts(route(), { estimate: undefined, estimateIsCurrent: false }, { gasFee: '0.000825 ETH (max)' });
  assert.equal(exact.find((fact) => fact.label === 'Gas fee')?.value, '0.000825 ETH max');
});

test('borrow reviews state loan-to-value like the form, with leverage one tap away', () => {
  const intent = {
    kind: 'deposit-and-mint', poolAddress: positionPoolAddress('ETH', 'long'), positionId: 0,
    depositTokenAddress: FX_TOKENS.ETH.address, depositAmount: 244_431_136_966_270n, nativeInput: true, mintAmount: 100_000_000_000_000_000n,
  };
  const borrow = { ...route(), operation: 'depositAndMint', policy: { walletAddress: route().walletAddress, chainId: 1, reviewedAction: intent }, details: { leverage: 1.1902 } } as unknown as PlannedRoute;
  const facts = primaryReviewFacts(borrow);
  // 1 − 1 / 1.1902 = 15.98%, rounded up so the position never reads safer than quoted.
  assert.deepEqual(facts.find((fact) => fact.label === 'Loan-to-value'), { label: 'Loan-to-value', value: '≈ 16.0%', title: 'From the quoted leverage of 1.1902×' });
  assert.deepEqual(facts.find((fact) => fact.label === 'Deposit'), { label: 'Deposit', value: '0.00024443113696627 ETH', title: '0.00024443113696627 ETH' });
  assert.equal(facts.some((fact) => fact.label === 'Leverage'), false);
  const { summary, details } = splitReviewFacts(facts);
  assert.equal(summary.some((fact) => fact.label === 'Loan-to-value'), true);
  assert.equal(details.find((fact) => fact.label === 'Quoted leverage')?.value, '≈ 1.19×');
  assert.equal(consequenceSummary(facts).some((fact) => fact.label === 'Loan-to-value'), true);
  assert.equal(consequenceSummary(facts).some((fact) => fact.label === 'Quoted leverage'), false);
  // No debt reads as zero, and an unusable quote falls back to leverage alone.
  const unleveraged = primaryReviewFacts({ ...borrow, details: { leverage: 1 } } as PlannedRoute);
  assert.equal(unleveraged.find((fact) => fact.label === 'Loan-to-value')?.value, '0%');
  const unusable = primaryReviewFacts({ ...borrow, details: { leverage: 0 } } as PlannedRoute);
  assert.equal(unusable.some((fact) => fact.label === 'Loan-to-value'), false);
  assert.equal(unusable.find((fact) => fact.label === 'Leverage')?.value, '0×');
  // Trade keeps its leverage wording.
  const trade = { ...borrow, operation: 'increasePosition', policy: undefined, details: { leverage: 2.5 } } as unknown as PlannedRoute;
  assert.equal(primaryReviewFacts(trade).some((fact) => fact.label === 'Loan-to-value'), false);
});
