import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfig, type Config } from 'wagmi';
import { injected } from 'wagmi/connectors/injected';
import { connect, disconnect, getConnection } from 'wagmi/actions';
import { mainnet, base } from 'wagmi/chains';
import { createClient, custom, type EIP1193Provider } from 'viem';
import { createBrowserWagmiSessionOwner } from '../src/lib/wallet/browserWagmiSessionOwner';
import { createExternalWalletConnection } from '../src/lib/wallet/externalWalletConnection';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const HASH = `0x${'a'.repeat(64)}`;
const deferred = <T,>() => { let resolve!: (v:T)=>void; let reject!: (e:unknown)=>void; const promise = new Promise<T>((y,n)=>{resolve=y;reject=n;}); return {promise,resolve,reject}; };
const tick = () => new Promise<void>((r) => setImmediate(r));
async function settle() { for(let i=0;i<15;i++) await tick(); }
const windowMock = new EventTarget();
let discoveryEvents = 0;
windowMock.addEventListener('eip6963:requestProvider', () => discoveryEvents++);
Object.defineProperty(globalThis,'window',{configurable:true,value:windowMock});


type Handler = (...args: unknown[]) => unknown;
class Fake {
  accounts: unknown = [A]; chain: unknown = '0x1'; calls: {method:string;params?:unknown[]}[] = [];
  handlers = new Map<string,Set<Handler>>(); overrides = new Map<string, (args:{method:string;params?:unknown[]})=>Promise<unknown>>();
  on = (event:string, fn:Handler) => { const set=this.handlers.get(event)??new Set();set.add(fn);this.handlers.set(event,set); };
  removeListener = (event:string, fn:Handler) => {this.handlers.get(event)?.delete(fn);};
  count() { return [...this.handlers.values()].reduce((a,b)=>a+b.size,0); }
  times(method:string) {return this.calls.filter((x)=>x.method===method).length;}
  emit(event:string,value?:unknown) { for(const fn of [...this.handlers.get(event)??[]]) void Promise.resolve(fn(value)).catch(()=>undefined); }
  request = async (args:{method:string;params?:unknown[]}) => {
    this.calls.push(args); const override=this.overrides.get(args.method);if(override)return override(args);
    switch(args.method){
      case 'eth_accounts':case 'eth_requestAccounts':return this.accounts;
      case 'eth_chainId':return this.chain;
      case 'wallet_switchEthereumChain':this.chain=(args.params?.[0] as {chainId:string}).chainId;this.emit('chainChanged',this.chain);return null;
      case 'wallet_revokePermissions':return null;
      case 'eth_sendTransaction':return HASH;
      default:throw Object.assign(new Error(`Unexpected RPC ${args.method}`),{code:-32601});
    }
  };
}
const owner = () => createBrowserWagmiSessionOwner({
  resolveRpcConfig: () => ({ configuredRpcUrl: 'https://base-mainnet.g.alchemy.com/v2/test' }),
  clientForChain: (chainId) => createClient({ chain: chainId === 1 ? mainnet : base, transport: custom({ request: async () => { throw new Error('Public RPC must not run in wallet lifecycle tests'); } }) }),
});
function prep(o: ReturnType<typeof owner>, p: Fake, extra: Record<string,unknown>={}) {
  const abort = new AbortController(); const selection = {provider:p,id:'fake',name:'Fake'};
  const candidate=o.prepare(selection,{signal:abort.signal,ownsAttempt:()=>!abort.signal.aborted,exactProvider:()=>p,...extra});
  return {candidate,abort};
}
async function accepted(o:ReturnType<typeof owner>,p:Fake,extra:Record<string,unknown>={}) {const x=prep(o,p,extra);await x.candidate.ready;o.promote(x.candidate);return x;}
function rawConfig(providers: Fake[]): Config {
 const noNetwork=custom({request:async()=>{throw new Error('NO NETWORK');}});
 return createConfig({chains:[mainnet,base],connectors:providers.map((p,i)=>injected({target:{id:`fake${i}`,name:'Fake',provider:p as EIP1193Provider},shimDisconnect:false})),storage:null,multiInjectedProviderDiscovery:false,syncConnectedChain:false,transports:{1:noNetwork,8453:noNetwork}});
}

test('import/Telegram idle path creates zero connectors, prompts, or discovery events',()=>{
 assert.equal(discoveryEvents,0);const p=new Fake();assert.equal(p.count(),0);assert.equal(p.calls.length,0);
});
test('FAIL-BEFORE: public core connect late completion reconnects disconnected config',async()=>{
 const p=new Fake();const delayed=deferred<unknown>();p.overrides.set('eth_requestAccounts',()=>delayed.promise);
 const cfg=rawConfig([p]);const result=connect(cfg,{connector:cfg.connectors[0]});await settle();
 await disconnect(cfg,{connector:cfg.connectors[0]});assert.equal(getConnection(cfg).status,'disconnected');
 delayed.resolve([A]);await result;assert.equal(getConnection(cfg).status,'connected');p.handlers.clear();
});
test('FAIL-BEFORE: core disconnect promotes older connection and leaves reauth listeners',async()=>{
 const p=new Fake(),q=new Fake();q.accounts=[B];const cfg=rawConfig([p,q]);
 await connect(cfg,{connector:cfg.connectors[0]});await connect(cfg,{connector:cfg.connectors[1]});
 await disconnect(cfg,{connector:cfg.connectors[1]});assert.equal(getConnection(cfg).address,A);
 assert.ok(q.count()>0);q.emit('accountsChanged',[B]);await settle();assert.equal(cfg.state.connections.size,2);p.handlers.clear();q.handlers.clear();
});
test('cancel then late approval never becomes active, leaks no listener, never revokes',async()=>{
 const o=owner(),p=new Fake(),d=deferred<unknown>();p.overrides.set('eth_requestAccounts',()=>d.promise);
 const x=prep(o,p);const result=assert.rejects(x.candidate.ready);await settle();x.abort.abort();await result;
 d.resolve([A]);await settle();assert.equal(o.getProjection(),undefined);assert.equal(p.count(),0);assert.equal(p.times('wallet_revokePermissions'),0);
 p.emit('accountsChanged',[A]);p.emit('connect',{chainId:'0x1'});await settle();assert.equal(o.getProjection(),undefined);o.dispose();
});
test('abort before async setup cannot attach listeners later',async()=>{
 const o=owner(),p=new Fake(),x=prep(o,p);const rejection=assert.rejects(x.candidate.ready);x.abort.abort();await rejection;await settle();assert.equal(p.count(),0);o.dispose();
});
test('A remains live during B pending and cancel; promotion detaches attempt cancellation',async()=>{
 const o=owner(),a=new Fake(),b=new Fake(),d=deferred<unknown>();const first=await accepted(o,a);first.abort.abort();assert.equal(o.getProjection()?.address,A);
 b.overrides.set('eth_requestAccounts',()=>d.promise);const second=prep(o,b);const rejected=assert.rejects(second.candidate.ready);await settle();
 assert.equal(o.getProjection()?.rawProvider,a);second.abort.abort();await rejected;a.chain='0x2105';a.emit('chainChanged','0x2105');await settle();
 assert.equal(o.getProjection()?.chainId,8453);d.resolve([B]);await settle();assert.equal(o.getProjection()?.rawProvider,a);assert.equal(b.count(),0);o.dispose();assert.equal(a.count(),0);
});
test('B promotion ignores old A events, and manual disconnect never falls back to A',async()=>{
 const o=owner(),a=new Fake(),b=new Fake();b.accounts=[B];await accepted(o,a);await accepted(o,b);assert.equal(a.count(),0);
 a.emit('accountsChanged',[A]);await settle();assert.equal(o.getProjection()?.address,B);o.manualDisconnect();o.manualDisconnect();
 assert.equal(o.getProjection(),undefined);b.emit('accountsChanged',[B]);b.emit('connect',{chainId:'0x1'});await settle();assert.equal(o.getProjection(),undefined);
 assert.equal(a.times('wallet_revokePermissions'),0);assert.equal(b.times('wallet_revokePermissions'),1);assert.equal(b.count(),0);
});
test('same-provider cancel/retry shares one raw prompt and disposes only old facade',async()=>{
 const o=owner(),p=new Fake(),d=deferred<unknown>();p.overrides.set('eth_requestAccounts',()=>d.promise);
 const x=prep(o,p);const reject=assert.rejects(x.candidate.ready);await settle();x.abort.abort();await reject;const y=prep(o,p);await settle();
 assert.equal(p.times('eth_requestAccounts'),1);d.resolve([A]);await y.candidate.ready;o.promote(y.candidate);assert.equal(x.candidate.ownedListeners(),0);assert.ok(y.candidate.ownedListeners()>0);assert.equal(o.getProjection()?.address,A);o.dispose();assert.equal(p.count(),0);
});
test('simultaneous CTA consumers share coordinator promise and one actual core candidate',async()=>{
 const o=owner(),p=new Fake();let candidates=0;
 const coord=createExternalWalletConnection<import('../src/lib/wallet/browserWagmiSessionOwner').Candidate>({onState:()=>{},onCommit:(c)=>{o.promote(c);},onDiscard:(c)=>o.discard(c)});
 const a=coord.open(),b=coord.open();assert.equal(a,b);
 const run=async(signal:AbortSignal)=>{candidates++;const c=o.prepare({provider:p,id:'fake',name:'Fake'},{signal,ownsAttempt:()=>!signal.aborted,exactProvider:()=>p});return c.ready;};
 coord.select({id:'fake',name:'Fake'},run);coord.select({id:'fake',name:'Fake'},run);await a;assert.equal(candidates,1);assert.equal(p.times('eth_requestAccounts'),1);o.dispose();
});
test('silent restore is exact and preserves remembered second account; no prompt',async()=>{
 const o=owner(),p=new Fake();p.accounts=[B,A];await accepted(o,p,{mode:'restore',preferredAddress:A});assert.equal(o.getProjection()?.address,A);
 assert.equal(getConnection(o.getActiveConfig()!).address,B);assert.equal(p.times('eth_requestAccounts'),0);assert.equal(p.times('wallet_requestPermissions'),0);o.dispose();
});
test('silent restore rejects absent remembered account and requires one',async()=>{
 const o=owner(),p=new Fake();assert.throws(()=>prep(o,p,{mode:'restore'}));const x=prep(o,p,{mode:'restore',preferredAddress:B});await assert.rejects(x.candidate.ready);assert.equal(o.getProjection(),undefined);assert.equal(p.times('eth_requestAccounts'),0);assert.equal(p.count(),0);o.dispose();
});
test('restore cancellation releases own queue; explicit selection never waits for restore',async()=>{
 const o=owner(),p=new Fake(),q=new Fake(),d=deferred<unknown>();p.overrides.set('eth_accounts',()=>d.promise);
 const x=prep(o,p,{mode:'restore',preferredAddress:A});const reject=assert.rejects(x.candidate.ready);await settle();x.abort.abort();await accepted(o,q);assert.equal(o.getProjection()?.rawProvider,q);d.resolve([A]);await reject;o.dispose();
});
test('A→B account event is freshly adopted; reorder retains funded selection',async()=>{
 const o=owner(),p=new Fake();await accepted(o,p);p.accounts=[B,A];p.emit('accountsChanged',[B,A]);assert.equal(o.getProjection(),undefined);await settle();assert.equal(o.getProjection()?.address,A);
 p.accounts=[B];p.emit('accountsChanged',[B]);await settle();assert.equal(o.getProjection()?.address,B);o.dispose();
});
test('unsupported/malformed chain and zero/malformed accounts can never sign',async()=>{
 for(const [event,value] of [['chainChanged','0x89'],['chainChanged','oops'],['accountsChanged',['0x'+'0'.repeat(40)]],['accountsChanged',['bad']],['accountsChanged',[]]] as const){
  const o=owner(),p=new Fake();await accepted(o,p);if(event==='chainChanged')p.chain=value;else p.accounts=value;p.emit(event,value);await settle();assert.equal(o.getProjection(),undefined);await assert.rejects(o.sendTransaction(1,{to:B}));assert.equal(p.times('eth_sendTransaction'),0);o.dispose();assert.equal(p.count(),0);
 }
});
test('provider identity change before promote rejects retained validation',async()=>{
 const o=owner(),p=new Fake(),q=new Fake();let exact:Fake=p;const x=prep(o,p,{exactProvider:()=>exact});await x.candidate.ready;exact=q;assert.throws(()=>o.promote(x.candidate));o.discard(x.candidate);assert.equal(p.count(),0);o.dispose();
});
test('account/chain event between double reads rejects, even if values return unchanged',async()=>{
 for(const event of ['accountsChanged','chainChanged']){
  const o=owner(),p=new Fake();let count=0;p.overrides.set('eth_chainId',async()=>{count++;if(count===3)p.emit(event,event==='chainChanged'?'0x1':[A]);return '0x1';});
  const x=prep(o,p);await assert.rejects(x.candidate.ready);assert.equal(o.getProjection(),undefined);assert.equal(p.count(),0);o.dispose();
 }
});
test('cleanup removes only owned listeners, handles off-only and request-only providers',async()=>{
 for(const shape of ['normal','off','request']){
  const o=owner(),p=new Fake();const external=()=>{};p.on('accountsChanged',external);const baseline=p.count();
  if(shape==='off'){Object.assign(p,{off:p.removeListener,removeListener:undefined});}
  if(shape==='request'){Object.assign(p,{on:undefined,removeListener:undefined});}
  await accepted(o,p);o.dispose();await settle();assert.equal(p.count(),baseline);assert.equal(p.times('wallet_revokePermissions'),0);
 }
});
test('manual disconnect is immediate despite hung selected revoke',async()=>{
 const o=owner(),p=new Fake();p.overrides.set('wallet_revokePermissions',()=>new Promise(()=>{}));await accepted(o,p);o.manualDisconnect();assert.equal(o.getProjection(),undefined);await settle();assert.equal(p.times('wallet_revokePermissions'),1);assert.equal(p.count(),0);
});
test('policy switch uses actual public action; unsupported/postcondition failures stay safe',async()=>{
 const o=owner(),p=new Fake();await accepted(o,p);await o.switchChain(8453);assert.equal(o.getProjection()?.chainId,8453);assert.equal(p.times('wallet_switchEthereumChain'),1);assert.equal(p.times('wallet_addEthereumChain'),0);o.dispose();
 const bad=owner(),q=new Fake();q.overrides.set('wallet_switchEthereumChain',async()=>null);await accepted(bad,q);await assert.rejects(bad.switchChain(8453));bad.dispose();
});
test('Wagmi-backed send makes exactly one pinned raw request without method fallback',async()=>{
 const o=owner(),p=new Fake();await accepted(o,p);assert.equal(await o.sendTransaction(1,{to:B,value:'0x1',from:A}),HASH);assert.equal(p.times('eth_sendTransaction'),1);assert.equal((p.calls.find(x=>x.method==='eth_sendTransaction')!.params![0] as {from:string}).from,A);assert.equal(p.times('wallet_sendTransaction'),0);
 p.overrides.set('eth_sendTransaction',async()=>{throw Object.assign(new Error('invalid params'),{code:-32602});});await assert.rejects(o.sendTransaction(1,{to:B}));assert.equal(p.times('eth_sendTransaction'),2);assert.equal(p.times('wallet_sendTransaction'),0);o.dispose();
});
test('change during async Wagmi client acquisition fences final raw signing send',async()=>{
 const o=owner(),p=new Fake();await accepted(o,p);const d=deferred<unknown>();p.overrides.set('eth_accounts',()=>d.promise);const send=o.sendTransaction(1,{to:B});const reject=assert.rejects(send);await settle();o.manualDisconnect();d.resolve([A]);await reject;assert.equal(p.times('eth_sendTransaction'),0);
});
test('policy 4902 add with immediate chain event still performs required second switch',async()=>{
 for(const emit of [false,true]){
  const o=owner(),p=new Fake();let switches=0;p.overrides.set('wallet_switchEthereumChain',async(_args)=>{switches++;if(switches===1)throw {code:4902};p.chain='0x2105';p.emit('chainChanged',p.chain);return null;});
  p.overrides.set('wallet_addEthereumChain',async()=>{if(emit){p.chain='0x2105';p.emit('chainChanged',p.chain);}return null;});
  await accepted(o,p);await o.switchChain(8453);assert.equal(switches,2);assert.equal(p.times('wallet_addEthereumChain'),1);assert.equal(o.getProjection()?.chainId,8453);
  const added=p.calls.find(x=>x.method==='wallet_addEthereumChain')!.params![0] as {rpcUrls:string[]};assert.deepEqual(added.rpcUrls,['https://base-mainnet.g.alchemy.com/v2/test']);o.dispose();
 }
});
test('account change during chain add cancels remaining switch authority',async()=>{
 const o=owner(),p=new Fake();p.overrides.set('wallet_switchEthereumChain',async()=>{throw {code:4902};});
 p.overrides.set('wallet_addEthereumChain',async()=>{p.accounts=[B];p.emit('accountsChanged',[B]);return null;});
 await accepted(o,p);await assert.rejects(o.switchChain(8453));assert.equal(p.times('wallet_switchEthereumChain'),1);o.dispose();
});
test('signing rejects wrong sender, wrong explicit chain, wrong expected chain, and invalid hash',async()=>{
 const o=owner(),p=new Fake();await accepted(o,p);
 await assert.rejects(o.sendTransaction(1,{to:B,from:B}));await assert.rejects(o.sendTransaction(1,{to:B,chainId:'0x2105'}));await assert.rejects(o.sendTransaction(8453,{to:B}));assert.equal(p.times('eth_sendTransaction'),0);
 p.overrides.set('eth_sendTransaction',async()=> '0xdead');await assert.rejects(o.sendTransaction(1,{to:B}),/invalid transaction hash/);assert.equal(p.times('eth_sendTransaction'),1);o.dispose();
});
test('chain/account/provider races during Wagmi acquisition block all final signing sends',async()=>{
 for(const kind of ['chain','account','provider']){
  const o=owner(),p=new Fake(),q=new Fake();let exact=p;await accepted(o,p,{exactProvider:()=>exact});
  const gate=deferred<unknown>();let first=true;p.overrides.set('eth_accounts',async()=>{if(first){first=false;return gate.promise;}return p.accounts;});
  const send=o.sendTransaction(1,{to:B});const rejected=assert.rejects(send);await settle();
  if(kind==='chain'){p.chain='0x2105';p.emit('chainChanged',p.chain);}else if(kind==='account'){p.accounts=[B];p.emit('accountsChanged',[B]);}else exact=q;
  gate.resolve([A]);await rejected;assert.equal(p.times('eth_sendTransaction'),0);o.dispose();
 }
});
test('eventless account mutation after Wagmi preflight is caught by retained fresh double-read',async()=>{
 const o=owner(),p=new Fake();await accepted(o,p);let reads=0;p.overrides.set('eth_chainId',async()=>{reads++;if(reads===2)p.accounts=[B];return '0x1';});
 await assert.rejects(o.sendTransaction(1,{to:B}));assert.equal(p.times('eth_sendTransaction'),0);o.dispose();
});
test('events after ready but before promote invalidate candidate without publication',async()=>{
 const o=owner(),p=new Fake(),x=prep(o,p);await x.candidate.ready;p.emit('accountsChanged',[A]);assert.throws(()=>o.promote(x.candidate));o.discard(x.candidate);assert.equal(p.count(),0);assert.equal(o.getProjection(),undefined);o.dispose();
});
test('two owners serialize actual silent restores and never consume broad connector discovery',async()=>{
 const a=owner(),b=owner(),p=new Fake(),q=new Fake();q.accounts=[B];const d=deferred<unknown>();let first=true;p.overrides.set('eth_accounts',async()=>{if(first){first=false;return d.promise;}return [A];});
 const x=prep(a,p,{mode:'restore',preferredAddress:A}),y=prep(b,q,{mode:'restore',preferredAddress:B});await settle();assert.equal(q.times('eth_accounts'),0);d.resolve([A]);await Promise.all([x.candidate.ready,y.candidate.ready]);a.promote(x.candidate);b.promote(y.candidate);assert.equal(a.getProjection()?.address,A);assert.equal(b.getProjection()?.address,B);assert.equal(p.times('eth_requestAccounts')+q.times('eth_requestAccounts'),0);a.dispose();b.dispose();
});
test('restore supports request-only raw provider without creating native event assumptions',async()=>{
 const o=owner(),p=new Fake();Object.assign(p,{on:undefined,removeListener:undefined});await accepted(o,p,{mode:'restore',preferredAddress:A});assert.equal(o.getProjection()?.address,A);assert.equal(p.times('eth_requestAccounts'),0);o.dispose();assert.equal(p.count(),0);
});
test('manual disconnect blocks later local silent restore until explicit selection succeeds',async()=>{
 const o=owner(),p=new Fake();await accepted(o,p);o.manualDisconnect();assert.throws(()=>prep(o,p,{mode:'restore',preferredAddress:A}),/new selection/);await accepted(o,p);assert.equal(o.getProjection()?.address,A);o.dispose();
});
test('FAIL-BEFORE: stock single-connector disconnect silently reauthorizes on account event',async()=>{
 const p=new Fake(),cfg=rawConfig([p]);await connect(cfg,{connector:cfg.connectors[0]});await disconnect(cfg,{connector:cfg.connectors[0]});assert.equal(getConnection(cfg).status,'disconnected');p.emit('accountsChanged',[A]);await settle();assert.equal(getConnection(cfg).status,'connected');p.handlers.clear();
});
test('foreground reconcile converges silent account/chain mutations through public reconnect',async()=>{
 const o=owner(),p=new Fake();await accepted(o,p);const prompts=p.times('eth_requestAccounts');p.accounts=[B];p.chain='0x2105';const reconciling=o.reconcile();assert.equal(o.getProjection(),undefined);await reconciling;assert.equal(o.getProjection()?.address,B);assert.equal(o.getProjection()?.chainId,8453);assert.equal(getConnection(o.getActiveConfig()!).address,B);assert.equal(getConnection(o.getActiveConfig()!).chainId,8453);assert.equal(p.times('eth_requestAccounts'),prompts);o.dispose();
});

test('discovery invalidation retires ownership and requires a fresh exact-provider restore',async()=>{
 const o=owner(),p=new Fake();await accepted(o,p);
 const prompts=p.times('eth_requestAccounts');
 const held=deferred<unknown>();p.overrides.set('eth_accounts',()=>held.promise);
 const reconciling=o.reconcile().catch(()=>undefined);await settle();
 o.invalidateForDiscovery();
 assert.equal(o.getProjection(),undefined);assert.equal(o.getActiveConfig(),undefined);assert.equal(p.count(),0);
 held.resolve([A]);await reconciling;p.overrides.delete('eth_accounts');
 p.accounts=[B];p.emit('accountsChanged',[B]);p.chain='0x2105';p.emit('chainChanged',p.chain);
 await settle();await o.reconcile();assert.equal(o.getProjection(),undefined);assert.equal(p.count(),0);
 await assert.rejects(o.sendTransaction(8453,{to:A}));assert.equal(p.times('eth_sendTransaction'),0);
 await accepted(o,p,{mode:'restore',preferredAddress:B});
 assert.equal(o.getProjection()?.address,B);assert.equal(o.getProjection()?.chainId,8453);
 assert.equal(p.times('eth_requestAccounts'),prompts);o.dispose();assert.equal(p.count(),0);
});
test('foreground reconcile preserves funded reordered address and blocks unsupported/empty sessions',async()=>{
 const o=owner(),p=new Fake();await accepted(o,p);p.accounts=[B,A];await o.reconcile();assert.equal(o.getProjection()?.address,A);p.chain='0x89';await o.reconcile();assert.equal(o.getProjection(),undefined);p.chain='0x1';p.accounts=[];await o.reconcile();assert.equal(o.getProjection(),undefined);p.accounts=[A];await o.reconcile();assert.equal(o.getProjection()?.address,A);o.dispose();
});
test('write interrupt during held signing preflight retains active wallet but prevents send',async()=>{
 const o=owner(),p=new Fake();await accepted(o,p);const d=deferred<unknown>();p.overrides.set('eth_accounts',()=>d.promise);const send=o.sendTransaction(1,{to:B});const rejected=assert.rejects(send);await settle();o.interruptWrites();assert.equal(o.getProjection()?.address,A);d.resolve([A]);await rejected;assert.equal(p.times('eth_sendTransaction'),0);p.overrides.delete('eth_accounts');p.chain='0x2105';p.emit('chainChanged',p.chain);await settle();assert.equal(o.getProjection()?.chainId,8453);o.dispose();
});
test('write interrupt prevents held old switch completion from publishing to replacement',async()=>{
 const o=owner(),p=new Fake(),q=new Fake();q.accounts=[B];await accepted(o,p);const d=deferred<unknown>();p.overrides.set('wallet_switchEthereumChain',()=>d.promise);const switched=o.switchChain(8453);const rejected=assert.rejects(switched);await settle();o.interruptWrites();await accepted(o,q);p.chain='0x2105';d.resolve(null);await rejected;assert.equal(o.getProjection()?.rawProvider,q);assert.equal(o.getProjection()?.chainId,1);o.dispose();
});
test('overlapping send rejects second and disposes its retained guard',async()=>{
 const o=owner(),p=new Fake();const acceptedSlot=await accepted(o,p);const baseline=acceptedSlot.candidate.ownedSubscribers();const d=deferred<unknown>();p.overrides.set('eth_sendTransaction',()=>d.promise);
 const first=o.sendTransaction(1,{to:B});const second=o.sendTransaction(1,{to:B});const rejected=assert.rejects(second,/already pending/);await rejected;assert.equal(p.times('eth_sendTransaction'),1);assert.equal(acceptedSlot.candidate.ownedSubscribers(),baseline+3);d.resolve(HASH);await first;assert.equal(acceptedSlot.candidate.ownedSubscribers(),baseline);o.dispose();
});
test('interrupted held switch cannot borrow newer same-slot authority for add/switch',async()=>{
 const o=owner(),p=new Fake();await accepted(o,p);const held=deferred<unknown>();p.overrides.set('wallet_switchEthereumChain',()=>held.promise);
 const old=o.switchChain(8453);const rejected=assert.rejects(old);await settle();o.interruptWrites();await assert.rejects(o.switchChain(1),/already pending/);
 held.reject({code:4902});await rejected;assert.equal(p.times('wallet_switchEthereumChain'),1);assert.equal(p.times('wallet_addEthereumChain'),0);
 p.overrides.delete('wallet_switchEthereumChain');await o.switchChain(1);assert.equal(p.times('wallet_switchEthereumChain'),2);o.dispose();
});
test('synchronous retirement inside raw request settles facade despite never-ending raw promise',async()=>{
 const o=owner(),p=new Fake();p.overrides.set('eth_chainId',()=>{o.dispose();return new Promise(()=>{});});const x=prep(o,p);await assert.rejects(x.candidate.ready);assert.equal(p.count(),0);assert.equal(o.getProjection(),undefined);
});
test('event burst with held account reads aborts obsolete validators and bounds observers',async()=>{
 const o=owner(),p=new Fake();const x=await accepted(o,p);const baseline=x.candidate.ownedSubscribers();const held=deferred<unknown>();p.overrides.set('eth_accounts',()=>held.promise);
 for(let i=0;i<12;i++){p.emit('accountsChanged',[A]);await settle();assert.ok(x.candidate.ownedSubscribers()<=baseline+3);}
 for(let i=0;i<12;i++)p.emit('accountsChanged',[A]);await settle();assert.ok(x.candidate.ownedSubscribers()<=baseline+3);
 o.dispose();assert.equal(p.count(),0);assert.equal(x.candidate.ownedSubscribers(),0);held.resolve([A]);await settle();assert.equal(o.getProjection(),undefined);
});
test('synchronous provider event then rejection after scoped abort has no unhandled rejection',async()=>{
 const errors:unknown[]=[];const observe=(e:unknown)=>errors.push(e);process.on('unhandledRejection',observe);
 const o=owner(),p=new Fake();await accepted(o,p);let first=true;p.overrides.set('eth_accounts',async()=>{if(first){first=false;p.emit('accountsChanged',[A]);throw new Error('raw rejection after synchronous event');}return [A];});
 p.emit('accountsChanged',[A]);await settle();assert.deepEqual(errors,[]);assert.equal(o.getProjection()?.address,A);o.dispose();assert.equal(p.count(),0);process.off('unhandledRejection',observe);
});


test('unrelated discovery during active revalidation does not abort the valid refresh', async () => {
 const o=owner(),p=new Fake();await accepted(o,p);const held=deferred<unknown>();p.overrides.set('eth_accounts',()=>held.promise);
 p.emit('accountsChanged',[A]);await settle();assert.equal(o.getProjection(),undefined);assert.equal(o.hasCurrentIdentity(),true);
 if(o.getActiveConfig()&&!o.hasCurrentIdentity())o.invalidateForDiscovery();
 p.overrides.delete('eth_accounts');held.resolve([A]);await settle();assert.equal(o.getProjection()?.address,A);o.dispose();
});
test('cancelling reconnect with no approved account retires dormant session without revoke', async () => {
 const o=owner(),p=new Fake();await accepted(o,p);p.accounts=[];p.emit('accountsChanged',[]);await settle();
 assert.equal(o.hasAuthorizedAccount(),false);const held=deferred<unknown>();p.overrides.set('eth_requestAccounts',()=>held.promise);const retry=prep(o,p);const rejected=assert.rejects(retry.candidate.ready);await settle();
 assert.equal(o.cancelDisconnectedSession(),true);retry.abort.abort();o.interruptWrites();held.resolve([A]);await rejected;
 p.accounts=[A];p.emit('accountsChanged',[A]);p.emit('connect',{chainId:'0x1'});await settle();assert.equal(o.getProjection(),undefined);assert.equal(p.times('wallet_revokePermissions'),0);assert.equal(p.count(),0);o.dispose();
});
test('cancel during a funded account revalidation preserves the accepted lifetime', async () => {
 const o=owner(),p=new Fake();await accepted(o,p);const held=deferred<unknown>();p.overrides.set('eth_accounts',()=>held.promise);p.emit('chainChanged','0x1');await settle();
 assert.equal(o.getProjection(),undefined);assert.equal(o.hasAuthorizedAccount(),true);assert.equal(o.cancelDisconnectedSession(),false);o.interruptWrites();
 p.overrides.delete('eth_accounts');held.resolve([A]);await settle();assert.equal(o.getProjection()?.address,A);o.dispose();
});
test('same-turn empty account event blocks cancellation revival before native disconnect settles', async () => {
 const o=owner(),p=new Fake();await accepted(o,p);p.accounts=[];p.emit('accountsChanged',[]);
 assert.equal(o.hasAuthorizedAccount(),false);assert.equal(o.cancelDisconnectedSession(),true);
 p.accounts=[A];p.emit('accountsChanged',[A]);await settle();assert.equal(o.getProjection(),undefined);assert.equal(p.count(),0);o.dispose();
});


test('same-account switch retains accepted display identity while signing waits for fresh accounts', async () => {
 const o=owner(),p=new Fake();await accepted(o,p);const held=deferred<unknown>();p.overrides.set('eth_accounts',()=>held.promise);
 const switching=o.switchChain(8453);await settle();assert.equal(o.getProjection(),undefined);assert.equal(o.getDisplayProjection()?.address,A);
 await assert.rejects(o.sendTransaction(1,{to:B,chainId:'0x1'}));assert.equal(p.times('eth_sendTransaction'),0);
 p.overrides.delete('eth_accounts');held.resolve([A]);await switching;assert.equal(o.getProjection()?.chainId,8453);assert.equal(o.getDisplayProjection()?.address,A);o.dispose();
});
test('foreground reconcile retains display identity but actual account loss or identity conflict clears it', async () => {
 const o=owner(),p=new Fake();let exact:Fake|undefined=p;await accepted(o,p,{exactProvider:()=>exact});const held=deferred<unknown>();p.overrides.set('eth_accounts',()=>held.promise);
 const refreshing=o.reconcile();await settle();assert.equal(o.getProjection(),undefined);assert.equal(o.getDisplayProjection()?.address,A);
 p.overrides.delete('eth_accounts');held.resolve([A]);await refreshing;assert.equal(o.getProjection()?.address,A);
 p.accounts=[B];p.emit('accountsChanged',[B]);assert.equal(o.getDisplayProjection(),undefined);await settle();assert.equal(o.getDisplayProjection()?.address,B);
 p.accounts=[];p.emit('accountsChanged',[]);assert.equal(o.getDisplayProjection(),undefined);await settle();
 p.accounts=[B];p.emit('accountsChanged',[B]);await settle();assert.equal(o.getDisplayProjection()?.address,B);
 exact=undefined;o.invalidateForDiscovery();assert.equal(o.getDisplayProjection(),undefined);assert.equal(o.getProjection(),undefined);o.dispose();
});


test('an authorized accepted wallet can recover from an unsupported network without signing there', async () => {
 const o=owner(),p=new Fake();await accepted(o,p);p.chain='0x89';p.emit('chainChanged','0x89');await settle();
 assert.equal(o.getProjection(),undefined);assert.equal(o.getDisplayProjection()?.address,A);assert.equal(o.getDisplayProjection()?.chainId,undefined);
 await assert.rejects(o.sendTransaction(1,{to:B}));assert.equal(p.times('eth_sendTransaction'),0);
 await o.switchChain(8453);assert.equal(o.getProjection()?.chainId,8453);assert.equal(o.getDisplayProjection()?.address,A);assert.equal(p.times('eth_requestAccounts'),1);o.dispose();
});

test('approval-time account events do not duplicate core connection handlers', async () => {
 const o=owner(),p=new Fake();p.overrides.set('eth_requestAccounts',async()=>{p.emit('accountsChanged',[A]);return[A];});
 await accepted(o,p);await settle();const connector=getConnection(o.getActiveConfig()!).connector!;
 assert.equal(connector.emitter.listenerCount('change'),1);assert.equal(connector.emitter.listenerCount('disconnect'),1);o.dispose();
});

test('repeated foreground reconciles keep one native core handler per event and release raw listeners', async () => {
 const o=owner(),p=new Fake();await accepted(o,p);const connector=getConnection(o.getActiveConfig()!).connector!;
 for(let i=0;i<8;i++){await o.reconcile();assert.equal(o.getProjection()?.address,A);assert.equal(connector.emitter.listenerCount('change'),1);assert.equal(connector.emitter.listenerCount('disconnect'),1);}
 assert.equal(p.times('eth_requestAccounts'),1);assert.equal(p.times('wallet_revokePermissions'),0);o.dispose();assert.equal(p.count(),0);assert.equal(o.getActiveConfig(),undefined);
});
test('account and connect events across local core reset do not auto-attach duplicate handlers', async () => {
 const o=owner(),p=new Fake();await accepted(o,p);let once=true;p.overrides.set('eth_accounts',async()=>{if(once){once=false;p.emit('accountsChanged',[A]);p.emit('connect',{chainId:'0x1'});}return[A];});
 await o.reconcile();await settle();const connector=getConnection(o.getActiveConfig()!).connector!;
 assert.equal(connector.emitter.listenerCount('change'),1);assert.equal(connector.emitter.listenerCount('disconnect'),1);assert.equal(o.getProjection()?.address,A);assert.equal(p.times('eth_requestAccounts'),1);o.dispose();
});
test('queued silent candidate events cannot preconnect before its scoped restore action', async () => {
 const first=owner(),second=owner(),p=new Fake(),q=new Fake();const held=deferred<unknown>();p.overrides.set('eth_accounts',()=>held.promise);
 const one=prep(first,p,{mode:'restore',preferredAddress:A});await settle();const two=prep(second,q,{mode:'restore',preferredAddress:A});
 q.emit('accountsChanged',[A]);q.emit('connect',{chainId:'0x1'});await settle();assert.notEqual(getConnection(two.candidate.config).status,'connected');
 p.overrides.delete('eth_accounts');held.resolve([A]);await one.candidate.ready;first.promote(one.candidate);await two.candidate.ready;second.promote(two.candidate);
 assert.equal(two.candidate.connector.emitter.listenerCount('change'),1);assert.equal(two.candidate.connector.emitter.listenerCount('disconnect'),1);assert.equal(q.times('eth_requestAccounts'),0);first.dispose();second.dispose();
});
test('real account loss and manual disconnect during local reset clear display and cannot restore', async () => {
 const o=owner(),p=new Fake();await accepted(o,p);const held=deferred<unknown>();p.overrides.set('eth_accounts',()=>held.promise);const refreshing=o.reconcile();await settle();
 assert.equal(o.getDisplayProjection()?.address,A);p.accounts=[];p.emit('accountsChanged',[]);assert.equal(o.getDisplayProjection(),undefined);o.manualDisconnect();
 p.overrides.delete('eth_accounts');held.resolve([A]);await refreshing.catch(()=>{});await settle();assert.equal(o.getProjection(),undefined);assert.equal(o.getDisplayProjection(),undefined);assert.equal(p.count(),0);assert.equal(p.times('eth_requestAccounts'),1);o.dispose();
});


test('a transaction already requested returns its hash after local session retirement without replay', async () => {
 const o=owner(),p=new Fake();await accepted(o,p);const pending=deferred<unknown>();p.overrides.set('eth_sendTransaction',()=>pending.promise);
 const sending=o.sendTransaction(1,{to:B,chainId:'0x1'});await settle();assert.equal(p.times('eth_sendTransaction'),1);o.manualDisconnect();pending.resolve(HASH);
 assert.equal(await sending,HASH);assert.equal(o.getProjection(),undefined);assert.equal(p.times('eth_sendTransaction'),1);o.dispose();
});

test('an issued send remains singleflight across replacement and its result cannot replace the new session', async () => {
 const o=owner(),p=new Fake(),q=new Fake();q.accounts=[B];await accepted(o,p);const pending=deferred<unknown>();p.overrides.set('eth_sendTransaction',()=>pending.promise);
 const sending=o.sendTransaction(1,{to:B});await settle();await accepted(o,q);
 await assert.rejects(o.sendTransaction(1,{to:A}),/already pending/);assert.equal(q.times('eth_sendTransaction'),0);
 pending.resolve(HASH);assert.equal(await sending,HASH);assert.equal(o.getProjection()?.rawProvider,q);assert.equal(o.getProjection()?.address,B);
 assert.equal(await o.sendTransaction(1,{to:A}),HASH);assert.equal(q.times('eth_sendTransaction'),1);assert.equal(p.times('eth_sendTransaction'),1);o.dispose();
});
test('retired issued sends preserve rejection and hash validation without replay', async () => {
 for(const invalid of [false,true]){const o=owner(),p=new Fake();await accepted(o,p);const pending=deferred<unknown>();p.overrides.set('eth_sendTransaction',()=>pending.promise);
  const sending=o.sendTransaction(1,{to:B});const rejection=assert.rejects(sending,invalid?/invalid transaction hash/:/declined/);await settle();o.dispose();
  if(invalid)pending.resolve('0x123');else pending.reject(Object.assign(new Error('declined'),{code:4001}));await rejection;assert.equal(p.times('eth_sendTransaction'),1);assert.equal(o.getProjection(),undefined);
 }
});

test('cancelling a replacement during foreground local reset preserves accepted account continuity', async () => {
 const o=owner(),p=new Fake();await accepted(o,p);const held=deferred<unknown>();p.overrides.set('eth_accounts',()=>held.promise);
 const restoring=o.reconcile();await settle();assert.equal(o.getDisplayProjection()?.address,A);
 assert.equal(o.cancelDisconnectedSession(),false);assert.equal(o.getDisplayProjection()?.address,A);
 p.overrides.delete('eth_accounts');held.resolve([A]);await restoring;assert.equal(o.getProjection()?.address,A);o.dispose();
});
