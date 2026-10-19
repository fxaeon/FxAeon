'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../model.js');
const make = (kind='trade', values={amount:'1200', leverage:3}) => M.operation(M.quote(M.initial(),kind,values),1);
function flow(account,kind,values,id=1) {
 let o=M.operation(M.quote(account,kind,values),id);account.operations.push(o);
 o=M.transition(o,'PROCEED');
 if(o.signature==='approval') { o=M.transition(o,'SIGN');o=M.transition(o,'APPROVED');account=M.applyApproved(account,o);o=account.operations[0];o=M.transition(o,'PROCEED'); }
 o=M.transition(o,'SIGN');o=M.transition(o,'SETTLED');return M.settle(account,o);
}
test('trade relates contribution, debt and exposure',()=>{const q=make().quote;assert.equal(q.after.exposure,3600);assert.equal(q.after.debt,2400);assert.equal(q.after.equity,1200);assert.equal(q.wallet.fxUSD,-1200);});
test('BTC quote retains asset identity',()=>assert.equal(make('trade',{amount:'600',leverage:3,asset:'BTC'}).quote.after.asset,'BTC'));
test('invalid and unavailable balances are rejected',()=>{for(const amount of ['0','-1','Infinity','abc','1e3','2.0000001','9000'])assert.throws(()=>make('trade',{amount}));});
test('fractional trade stays positive',()=>assert.equal(make('trade',{amount:'0.000001',leverage:3}).quote.after.exposure,0.000003));
test('an unrepresentable deposit output is rejected',()=>assert.throws(()=>make('deposit',{amount:'0.000001'})));
test('approval is not execution',()=>{let o=make();o=M.transition(o,'PROCEED');o=M.transition(o,'SIGN');o=M.transition(o,'APPROVED');assert.equal(o.stage,'review');assert.equal(o.approved,true);assert.throws(()=>M.settle(M.initial(),o));});
test('confirmed approval fee is applied exactly once',()=>{let a=M.initial(),o=make();a.operations=[o];for(const e of ['PROCEED','SIGN','APPROVED'])o=M.transition(o,e);a=M.applyApproved(a,o);assert.equal(a.wallet.ETH,2.49991);assert.deepEqual(M.applyApproved(a,a.operations[0]),a);});
test('declining action retains approval',()=>{let o=make();for(const e of ['PROCEED','SIGN','APPROVED','PROCEED','DECLINE','REVIEW','PROCEED'])o=M.transition(o,e);assert.equal(o.signature,'action');});
test('quote acceptance does not open wallet',()=>{let o=make();o=M.transition(o,'QUOTE_CHANGED');assert.equal(o.previousFee,.00042);assert.equal(o.quote.fee,.00048);o=M.transition(o,'ACCEPT_QUOTE');assert.equal(o.stage,'review');assert.equal(o.signature,null);});
test('submitted terms cannot be changed',()=>{let o=make('borrow',{amount:'300'});o=M.transition(o,'PROCEED');o=M.transition(o,'SIGN');assert.throws(()=>M.transition(o,'QUOTE_CHANGED'));});
test('unknown action cannot be blindly resubmitted',()=>{let o=make('borrow',{amount:'300'});for(const e of ['PROCEED','SIGN','UNKNOWN'])o=M.transition(o,e);assert.throws(()=>M.transition(o,'PROCEED'));o=M.transition(o,'CHECK');o=M.transition(o,'SETTLED');assert.equal(o.stage,'complete');});
test('unknown approval checks approval, not action completion',()=>{let o=make();for(const e of ['PROCEED','SIGN','UNKNOWN','CHECK'])o=M.transition(o,e);assert.throws(()=>M.transition(o,'SETTLED'));o=M.transition(o,'APPROVED');assert.equal(o.stage,'review');});
test('missing position observation cannot settle',()=>{let o=make('borrow',{amount:'300'});for(const e of ['PROCEED','SIGN','CONFIRMED_UNREAD'])o=M.transition(o,e);assert.throws(()=>M.settle(M.initial(),o));assert.throws(()=>M.transition(o,'PROCEED'));});
test('settlement charges fees once and preserves existing positions',()=>{let a=flow(M.initial(),'trade',{amount:'1200',leverage:3});assert.equal(a.wallet.fxUSD,6800);assert.equal(a.wallet.ETH,2.49974);assert.equal(a.positions.length,2);assert.deepEqual(M.settle(a,a.operations[0]),a);});
test('deposit shares and balance agree',()=>{const a=flow(M.initial(),'deposit',{amount:'1000'});assert.equal(a.wallet.fxUSD,7000);assert.equal(a.wallet.fxSAVE,4888.888888);});
test('withdrawal queues shares without paying stablecoins',()=>{const a=flow(M.initial(),'withdraw',{amount:'500'});assert.equal(a.wallet.fxSAVE,3500);assert.equal(a.wallet.fxUSD,8000);assert.equal(a.queue.claimable,false);assert.throws(()=>M.quote(a,'claim'));});
test('claim pays two legs and is not claimable twice',()=>{let a=flow(M.initial(),'withdraw',{amount:'500'});a.queue.claimable=true;a=flow(a,'claim',{},2);assert.equal(a.wallet.fxUSD,8450);assert.equal(a.wallet.USDC,112.5);assert.equal(a.queue,null);assert.throws(()=>M.quote(a,'claim'));});
test('borrowing and repaying change debt and wallet in opposite directions',()=>{let a=flow(M.initial(),'borrow',{amount:'600'});assert.equal(a.loan.debt,1800);assert.equal(a.wallet.fxUSD,8600);a=flow(a,'repay',{amount:'300'},2);assert.equal(a.loan.debt,1500);assert.equal(a.wallet.fxUSD,8300);});
test('collateral deposit is a wallet outflow',()=>{const a=flow(M.initial(),'collateral',{amount:'0.25'});assert.equal(a.loan.collateral,1.75);assert.equal(a.wallet.ETH,2.24974);});
test('loan collateral guard rejects excess withdrawal',()=>assert.throws(()=>M.quote(M.initial(),'remove',{amount:'1.49'})));
test('leverage reduction repays debt without wallet token flow',()=>{const q=make('leverage',{amount:'2',leverage:2}).quote;assert.deepEqual(q.wallet,{});assert.equal(q.after.equity,1200);assert.equal(q.after.debt,1200);assert.equal(q.after.exposure,2400);});
test('partial reduction and close preserve accounting',()=>{let a=flow(M.initial(),'reduce',{amount:'50'});assert.equal(a.positions[0].equity,600);assert.equal(a.wallet.fxUSD,8600);a=flow(a,'close',{},2);assert.equal(a.positions[0].exposure,0);assert.equal(a.wallet.fxUSD,9200);});
test('increasing position keeps leverage',()=>{const a=flow(M.initial(),'increase',{amount:'300'});assert.equal(a.positions[0].exposure,4500);assert.equal(M.leverage(a.positions[0]),3);});
test('reversion only charges the observed network fee',()=>{let a=M.initial(),o=make('borrow',{amount:'300'});a.operations=[o];for(const e of ['PROCEED','SIGN','REVERTED'])o=M.transition(o,e);a=M.applyReverted(a,o);assert.equal(a.wallet.fxUSD,8000);assert.equal(a.wallet.ETH,2.49974);assert.deepEqual(M.applyReverted(a,a.operations[0]),a);});
test('review can close but pending transaction cannot cancel',()=>{let o=make('borrow',{amount:'300'});assert.equal(M.transition(o,'CANCEL_REVIEW').stage,'cancelled');for(const e of ['PROCEED','SIGN'])o=M.transition(o,e);assert.throws(()=>M.transition(o,'CANCEL_REVIEW'));});
test('storage failure degrades without throwing',()=>{const bad={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};assert.deepEqual(M.load(bad),M.initial());assert.equal(M.save(M.initial(),bad),false);});
test('versioned storage round trip and invalid JSON fallback',()=>{let data='';const s={getItem:()=>data,setItem:(_,v)=>data=v};M.save(M.initial(),s);assert.deepEqual(M.load(s),M.initial());data='{';assert.deepEqual(M.load(s),M.initial());});
test('quote and state transitions do not mutate their input',()=>{const a=M.initial(),before=JSON.stringify(a);M.quote(a,'borrow',{amount:'300'});assert.equal(JSON.stringify(a),before);const o=make(),old=JSON.stringify(o);M.transition(o,'PROCEED');assert.equal(JSON.stringify(o),old);});
