import assert from 'node:assert/strict';
import { test } from 'node:test';
import { positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from '../src/lib/fx/policy';
import { positionOutcomeFacts, routeFinancialReviewFacts } from '../src/lib/fx/reviewFormatting';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import type { PlannedRoute, ReviewedActionIntent, RouteDetails } from '../src/lib/fx/types';
import { approximately, collateralUsdEstimate, currentTradeOutcome, settledTradeOutcome, tradeOutcomeKey, type TradeOutcomeTicket } from '../src/lib/tradeOutcome';

const WALLET = '0x1111111111111111111111111111111111111111';
const ROUTER = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';

function opening(market: 'ETH' | 'BTC', side: 'long' | 'short', positionId = 0): Extract<ReviewedActionIntent, { kind: 'position-increase' }> {
  return {
    kind: 'position-increase', poolAddress: positionPoolAddress(market, side), positionType: side, positionId,
    inputTokenAddress: FX_TOKENS.ETH.address, inputAmount: 10n ** 18n, nativeInput: true,
    collateralTokenAddress: positionCollateralTokenAddress(market, side), debtTokenAddress: positionDebtTokenAddress(market, side),
  };
}

function route(intent: ReviewedActionIntent, details: RouteDetails, operation: PlannedRoute['operation'] = 'increasePosition'): PlannedRoute {
  return {
    operation, walletAddress: WALLET, chainId: 1,
    transactions: [{ chainId: 1, from: WALLET, to: ROUTER, data: '0xef9e1aa700', value: 0n, kind: 'action', operation }],
    policy: { walletAddress: WALLET, chainId: 1, reviewedAction: intent },
    details,
  };
}

const ticket: TradeOutcomeTicket = {
  walletAddress: WALLET, walletChainId: 1, market: 'ETH', side: 'long', token: 'ETH',
  amountWei: 3n * 10n ** 14n, leverage: 2.8, slippagePercent: 0.5, leverageMin: 1.1, leverageMax: 6.1,
};

test('the preview key changes with every input the warmed route was planned from', () => {
  const key = tradeOutcomeKey(ticket);
  assert.equal(tradeOutcomeKey({ ...ticket, walletAddress: WALLET.toUpperCase().replace('0X', '0x') }), key);
  const changes: Partial<TradeOutcomeTicket>[] = [
    { walletAddress: '0x2222222222222222222222222222222222222222' }, { walletChainId: 8453 }, { walletChainId: null },
    { market: 'BTC' }, { side: 'short' }, { token: 'WETH' }, { amountWei: ticket.amountWei + 1n },
    { leverage: 2.9 }, { slippagePercent: 1 }, { leverageMin: 1.2 }, { leverageMax: 6 },
  ];
  for (const change of changes) assert.notEqual(tradeOutcomeKey({ ...ticket, ...change }), key, JSON.stringify(change, (_, value) => typeof value === 'bigint' ? value.toString() : value));
});

test('figures belong only to the ticket they were planned for; anything else is pending or nothing', () => {
  const key = tradeOutcomeKey(ticket);
  const planned = route(opening('ETH', 'long'), { colls: '1', debts: '1' });
  const ready = settledTradeOutcome(key, [planned]);
  assert.deepEqual(ready, { key, status: 'ready', route: planned });
  assert.equal(currentTradeOutcome(ready, key), ready);
  // Any changed input reads as pending on the same render: the old figures are gone.
  const changed = tradeOutcomeKey({ ...ticket, leverage: 3 });
  assert.deepEqual(currentTradeOutcome(ready, changed), { key: changed, status: 'pending' });
  assert.deepEqual(currentTradeOutcome(null, changed), { key: changed, status: 'pending' });
  // Disconnected, or nothing to plan: nothing new on the ticket.
  assert.equal(currentTradeOutcome(ready, null), null);
  // A warm-up that returns no route shows nothing, as a failed one does.
  for (const routes of [[], undefined, null]) assert.deepEqual(settledTradeOutcome(key, routes), { key, status: 'failed' });
  assert.deepEqual(currentTradeOutcome({ key, status: 'failed' }, key), { key, status: 'failed' });
  assert.equal((settledTradeOutcome(key, planned) as { route?: PlannedRoute }).route, planned);
});

test('the preview reads the review’s own collateral, debt and fee facts for the same route', () => {
  for (const [market, side, collateral, debt, symbol] of [
    ['ETH', 'long', '≈ 0.67041251 wstETH', '≈ 1,010.21841234 fxUSD', 'wstETH'],
    ['BTC', 'long', '≈ 0.67041251 WBTC', '≈ 1,010.21841234 fxUSD', 'WBTC'],
    ['ETH', 'short', '≈ 0.67041251 fxUSD', '≈ 1,010.21841234 wstETH', 'fxUSD'],
    ['BTC', 'short', '≈ 0.67041251 fxUSD', '≈ 1,010.21841234 WBTC', 'fxUSD'],
  ] as const) {
    const planned = route(opening(market, side), {
      colls: '670412512785242112', debts: '1010218412345678901234', executionPrice: '2500.5',
      protocolFeeQuote: { poolAddress: positionPoolAddress(market, side), routerAddress: ROUTER, ratios: ['3000000', '1000000', '0', '0'] },
    });
    const facts = positionOutcomeFacts(planned)!;
    const review = new Map(routeFinancialReviewFacts(planned).map((fact) => [fact.label, fact]));
    assert.deepEqual({ label: facts.collateral.label, value: facts.collateral.value, title: facts.collateral.title }, review.get('Estimated collateral'));
    assert.deepEqual(facts.debt, review.get('Estimated debt'));
    assert.deepEqual(facts.fee, review.get('f(x) fee'));
    assert.deepEqual(facts.executionPrice, review.get('Execution price'));
    assert.equal(facts.executionPrice?.value, `2,500.5 fxUSD / ${market === 'ETH' ? 'stETH' : 'WBTC'}`);
    assert.equal(facts.collateral.value, collateral);
    assert.equal(facts.debt.value, debt);
    assert.equal(facts.fee?.value, '0.3%');
    assert.equal(facts.collateral.exact, '0.670412512785242112');
    assert.equal(facts.collateral.symbol, symbol);
  }
});

test('an ETH long preview states its collateral in stETH, while its USD value still prices the wstETH quote', () => {
  // wstETH.stEthPerToken() on mainnet at block 26,150,567, read with the quote.
  const planned = route(opening('ETH', 'long'), { colls: '670412512785242112', debts: '1010218412345678901234', stEthPerWstEth: '1245861716930919999' });
  const facts = positionOutcomeFacts(planned)!;
  const review = routeFinancialReviewFacts(planned).find((fact) => fact.label === 'Estimated collateral');
  assert.deepEqual({ label: facts.collateral.label, value: facts.collateral.value, title: facts.collateral.title }, review);
  assert.equal(facts.collateral.value, '≈ 0.83524128 stETH');
  assert.equal(facts.collateral.title, '0.835241284230594092 stETH (0.670412512785242112 wstETH at 1.245861716930919999 stETH per wstETH)');
  // "USD values stay as they are": the same wstETH amount at the wstETH price.
  assert.equal(facts.collateral.exact, '0.670412512785242112');
  assert.equal(facts.collateral.symbol, 'wstETH');
  assert.equal(collateralUsdEstimate(facts.collateral, { wstETH: 2880 }), '≈ $1,930.79');
});

test('only a new position’s quoted route is previewed', () => {
  const details = { colls: '670412512785242112', debts: '1010218412345678901234' };
  assert.equal(positionOutcomeFacts(route(opening('ETH', 'long', 7), details)), null);
  assert.equal(positionOutcomeFacts(route({ ...opening('ETH', 'long', 4), kind: 'position-reduce', outputTokenAddress: FX_TOKENS.USDC.address, isClosePosition: false }, details, 'reducePosition')), null);
  assert.equal(positionOutcomeFacts(route(opening('ETH', 'long'), {})), null);
  assert.equal(positionOutcomeFacts(route(opening('ETH', 'long'), { colls: '12', debts: 'not a number' })), null);
  assert.equal(positionOutcomeFacts({ ...route(opening('ETH', 'long'), details), chainId: 8453 }), null);
  // No readable fee quote: the review says so, and the preview carries no invented rate.
  assert.equal(positionOutcomeFacts(route(opening('ETH', 'long'), details))?.fee, undefined);
});

test('every preview figure carries one "≈", and a "<" bound stays as it is', () => {
  assert.equal(approximately('1.5 wstETH'), '≈ 1.5 wstETH');
  assert.equal(approximately('≈ 0.67041251 wstETH'), '≈ 0.67041251 wstETH');
  assert.equal(approximately('<0.00000001 wstETH'), '<0.00000001 wstETH');
});

test('the collateral’s USD value needs a fresh price and is exact to the cent', () => {
  const collateral = { exact: '0.670412512785242112', symbol: 'wstETH' };
  assert.equal(collateralUsdEstimate(collateral, { wstETH: 2880 }), '≈ $1,930.79');
  assert.equal(collateralUsdEstimate({ exact: '1234.5', symbol: 'fxUSD' }, { fxUSD: 0.9998 }), '≈ $1,234.25');
  assert.equal(collateralUsdEstimate({ exact: '0.000000001', symbol: 'WBTC' }, { WBTC: 60000 }), '<$0.01');
  // No fresh price, no dollar figure: never a zero, never a stablecoin peg.
  assert.equal(collateralUsdEstimate(collateral, {}), null);
  assert.equal(collateralUsdEstimate({ exact: '1234.5', symbol: 'fxUSD' }, { wstETH: 2880 }), null);
  assert.equal(collateralUsdEstimate({ exact: '1', symbol: 'unknown' }, { wstETH: 2880 }), null);
});
