import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicClient, custom } from 'viem';
import { mainnet, base } from 'wagmi/chains';
import { getConnection } from 'wagmi/actions';
import { createBrowserWagmiSessionOwner } from '../src/lib/wallet/browserWagmiSessionOwner';
const A='0x1111111111111111111111111111111111111111';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<15;i++)await tick();}
Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
type Listener=(...args:unknown[])=>unknown;
class Provider{
  chain='0x1';accounts:string[]=[A];hold=false;calls:string[]=[];queue:(()=>void)[]=[];handlers=new Map<string,Set<Listener>>();
  on=(event:string,fn:Listener)=>{const set=this.handlers.get(event)??new Set();set.add(fn);this.handlers.set(event,set);};
  removeListener=(event:string,fn:Listener)=>{this.handlers.get(event)?.delete(fn);};
  emit(event:string,value?:unknown){for(const fn of [...this.handlers.get(event)??[]])void Promise.resolve(fn(value)).catch(()=>{});}
  request=async({method}:{method:string;params?:unknown[]})=>{this.calls.push(method);if(method==='eth_requestAccounts')return this.accounts;if(method==='eth_chainId')return this.chain;if(method==='eth_accounts'){if(this.hold)return new Promise(resolve=>this.queue.push(()=>resolve([...this.accounts])));return this.accounts;}throw new Error(method);};
  releaseAll(){this.hold=false;for(const resolve of this.queue.splice(0))resolve();}
}
async function accepted(p:Provider){
 const o=createBrowserWagmiSessionOwner({resolveRpcConfig:()=>({}),clientForChain:id=>createPublicClient({chain:id===1?mainnet:base,transport:custom({request:async()=>{throw new Error('NO NETWORK');}})})});
 const c=o.prepare({provider:p,id:'race',name:'Race'},{signal:new AbortController().signal,ownsAttempt:()=>true,exactProvider:()=>p});await c.ready;o.promote(c);return o;
}
for(const event of ['connect','accountsChanged'] as const)test(`disconnected ${event} plus chain race recovers using all queued RPC resolvers`,async()=>{
 const p=new Provider(),o=await accepted(p);p.accounts=[];p.emit('disconnect');await settle();assert.equal(getConnection(o.getActiveConfig()!).status,'disconnected');
 p.accounts=[A];p.hold=true;p.emit(event,event==='connect'?{chainId:'0x1'}:[A]);await settle();
 const held=p.queue.length;p.chain='0x2105';p.emit('chainChanged','0x2105');await settle();p.releaseAll();await settle();
 const state=getConnection(o.getActiveConfig()!);console.log(JSON.stringify({event,held,stillHeld:p.queue.length,core:{status:state.status,chainId:state.chainId},rawChain:p.chain,projection:o.getProjection()?{address:o.getProjection()?.address,chainId:o.getProjection()?.chainId}:null,calls:p.calls}));
 const projected=o.getProjection();o.dispose();assert.equal(projected?.address,A);assert.equal(projected?.chainId,8453);
});

test('perpetually inconsistent reconnect chain reads get one convergence attempt and remain fenced',async()=>{
 const p=new Provider(),o=await accepted(p);p.chain='0x2105';
 const original=p.request;let chainReads=0;p.request=async args=>{if(args.method==='eth_chainId'){p.calls.push(args.method);chainReads++;return chainReads%3===0?'0x1':'0x2105';}return original(args);};
 p.emit('chainChanged','0x1');await settle();const reads=chainReads;await settle();assert.equal(chainReads,reads);assert.equal(chainReads,5);assert.equal(o.getProjection(),undefined);assert.equal(p.calls.filter(x=>x==='eth_requestAccounts').length,1);o.dispose();
});
