import assert from 'node:assert/strict';
import test from 'node:test';
import { readPublicTradeOutcome, PUBLIC_TRADE_PREVIEW_ACCOUNT, PUBLIC_TRADE_OUTCOME_DEADLINE_MS, type PublicTradeOutcomeRequest } from '../src/lib/fx/publicTradeOutcome';
import { positionPoolAddress, positionCollateralTokenAddress, positionDebtTokenAddress } from '../src/lib/fx/policy';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import type { PlannedRoute } from '../src/lib/fx/types';
const request: PublicTradeOutcomeRequest = {market:'ETH', type:'long', inputTokenAddress:FX_TOKENS.ETH.address, amount:10n ** 18n, leverage:2, slippage:.5};
function route(): PlannedRoute {
  return {operation:'increasePosition', walletAddress:PUBLIC_TRADE_PREVIEW_ACCOUNT, chainId:1, transactions:[],
    policy:{walletAddress:PUBLIC_TRADE_PREVIEW_ACCOUNT, chainId:1, reviewedAction:{kind:'position-increase', poolAddress:positionPoolAddress('ETH','long'), positionType:'long', positionId:0, inputTokenAddress:FX_TOKENS.ETH.address, inputAmount:10n ** 18n, nativeInput:true, collateralTokenAddress:positionCollateralTokenAddress('ETH','long'), debtTokenAddress:positionDebtTokenAddress('ETH','long')}},
    details:{colls:'2000000000000000000', debts:'1000000000000000000000', executionPrice:'2000', stEthPerWstEth:'1250000000000000000', liquidationQuote:{poolAddress:positionPoolAddress('ETH','long'), liquidateRatio:'800000000000000000', readAt:Date.now(), stEthPerWstEth:'1250000000000000000'}}};
}
test('public quote binds the fixed read-only account and exports facts without any route capability', async () => {
  const result = await readPublicTradeOutcome(request, {plan:async input => {
    assert.equal(input.userAddress, PUBLIC_TRADE_PREVIEW_ACCOUNT); assert.equal(input.positionId,0);
    assert.equal(input.amount,request.amount); assert.equal(input.leverage,request.leverage);
    return [route()];
  }});
  assert.deepEqual(Object.keys(result).sort(), ['facts','validUntil']);
  assert.ok(result.facts.executionPrice); assert.ok(result.facts.liquidationPrice);
  assert.equal('transactions' in result,false); assert.equal('route' in result,false); assert.equal('policy' in result,false);
});
test('cancelling a public quote rejects promptly and ignores a late SDK result', async () => {
  const controller = new AbortController();
  let finish!: (routes: PlannedRoute[]) => void;
  const pending = readPublicTradeOutcome(request, {signal:controller.signal, plan:() => new Promise(resolve => {finish=resolve;})});
  controller.abort(); await assert.rejects(pending, {name:'AbortError'});
  finish([route()]);
});
test('public quotes reject unrelated ownership and expired transport results', async () => {
  await assert.rejects(readPublicTradeOutcome(request,{plan:async()=>[{...route(),walletAddress:'0x1111111111111111111111111111111111111111'}]}));
  const start = Date.now(); let reads = 0;
  await assert.rejects(readPublicTradeOutcome(request,{now:()=>start+(reads++ ? 30_001 : 0),plan:async()=>[route()]}),/expired/);
});

test('a supported slow SDK quote survives twelve seconds without renewing its original freshness', async context => {
  context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: Date.now()});
  const startedAt = Date.now();
  const quoted = route();
  let finish!: (routes: PlannedRoute[]) => void;
  const pending = readPublicTradeOutcome(request, {plan: () => new Promise(resolve => {finish = resolve;})});
  context.mock.timers.tick(13_000);
  finish([quoted]);
  const result = await pending;
  assert.equal(result.validUntil, startedAt + 30_000);
  assert.ok(result.facts.executionPrice);
});

test('stalled SDK preview remains bounded inside the freshness window', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const pending = readPublicTradeOutcome(request, {plan: () => new Promise(() => {})});
  const rejected = assert.rejects(pending, /read deadline exceeded/);
  context.mock.timers.tick(PUBLIC_TRADE_OUTCOME_DEADLINE_MS);
  await rejected;
  assert.ok(PUBLIC_TRADE_OUTCOME_DEADLINE_MS < 30_000);
});

test('rapid ticket replacement starts only the latest waiting SDK request after superseded work settles', async () => {
  const calls: bigint[] = [];
  const finishes: Array<(routes: PlannedRoute[]) => void> = [];
  const plan = async (input: PublicTradeOutcomeRequest & {userAddress: string; positionId: number}) => {
    calls.push(input.amount);
    return new Promise<PlannedRoute[]>(resolve => { finishes.push(resolve); });
  };
  const first = new AbortController(), second = new AbortController();
  const one = readPublicTradeOutcome({...request, amount: 1n}, {plan, signal: first.signal});
  const oneRejected = assert.rejects(one, {name: 'AbortError'});
  first.abort();
  const two = readPublicTradeOutcome({...request, amount: 10n}, {plan, signal: second.signal});
  const twoRejected = assert.rejects(two, {name: 'AbortError'});
  second.abort();
  const three = readPublicTradeOutcome({...request, amount: 100n}, {plan});
  assert.deepEqual(calls, [1n], 'waiting replacements must not start concurrent converter searches');
  finishes[0]([route()]);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [1n, 100n], 'the cancelled intermediate ticket is never dispatched');
  finishes[1]([route()]);
  await Promise.all([oneRejected, twoRejected, three]);
});

test('a stalled prior search bounds queued callers and expired callers never dispatch later', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  let finish!: (routes: PlannedRoute[]) => void;
  let calls = 0;
  const plan = async () => {calls++; return new Promise<PlannedRoute[]>(resolve => {finish = resolve;});};
  const prior = readPublicTradeOutcome(request, {plan});
  const next = readPublicTradeOutcome({...request, amount: 2n}, {plan});
  const priorRejected = assert.rejects(prior, /read deadline exceeded/);
  const nextRejected = assert.rejects(next, /read deadline exceeded/);
  context.mock.timers.tick(PUBLIC_TRADE_OUTCOME_DEADLINE_MS);
  await Promise.all([priorRejected, nextRejected]);
  assert.equal(calls, 1);
  finish([route()]);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls, 1, 'a caller whose own deadline elapsed cannot start work when the slot releases');
});
