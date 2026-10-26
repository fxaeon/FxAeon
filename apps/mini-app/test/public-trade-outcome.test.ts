import assert from 'node:assert/strict';
import test from 'node:test';
import { readPublicTradeOutcome, PUBLIC_TRADE_PREVIEW_ACCOUNT, type PublicTradeOutcomeRequest } from '../src/lib/fx/publicTradeOutcome';
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
