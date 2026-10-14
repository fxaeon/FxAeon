// Offline-only deterministic fixture. Does not sign, submit, or contact RPC.
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../../../..');
const DEFAULT_ENTRY = fs.realpathSync(path.join(ROOT, 'apps/mini-app/node_modules/@aladdindao/fx-sdk/dist/index.cjs'));
const req = createRequire(DEFAULT_ENTRY);
const viem = req('viem');
const OWNER = '0x1111111111111111111111111111111111111111';
const ZERO = '0x0000000000000000000000000000000000000000';
const hash = '0x' + '11'.repeat(32);
function loadSdk({sourcePath, transform} = {}) {
  let text = fs.readFileSync(sourcePath || DEFAULT_ENTRY,'utf8');
  if (transform) text = transform(text);
  const exports = ['Pool','Position','FxSdk','tokens','contracts','pools','getZapRoutes','getClient','getFxUSDByBorrowAmount','getBorrowByFxUSDAmount','searchAmount','Velora','ERC20_default','AFPool_default','PoolManager_default','ShortPoolManager_default','PoolConfiguration_default','RateProvider_default','PriceOracle_default','MultiPathConverter_default'];
  text += '\nexports._inspect = {'+exports.join(',')+',setClient: (client) => { getClient = () => client; }};';
  const module = {exports:{}};
  new Function('require','module','exports','console',text)(req,module,module.exports,{...console,log:()=>{}});
  return {...module.exports._inspect, stageTrace: module.exports.stageTrace};
}
function createFixture(options = {}) {
  const sdk = options.sdk || loadSdk();
  const decimals = new Map(Object.entries(sdk.tokens).map(([symbol,address])=>[address.toLowerCase(),symbol==='WBTC'?8:symbol==='usdc'||symbol==='usdt'?6:18]));
  const prices = {fxUSD:1n,wstETH:2400n,WBTC:60000n,eth:2000n,weth:2000n,stETH:2000n,usdc:1n,usdt:1n};
  const routes = new Map();
  const routeKey = (encoding,route) => `${encoding}|${route.map(value=>BigInt(value).toString()).join(',')}`;
  for(const [src,srcAddress] of Object.entries(sdk.tokens)) for(const [dst,dstAddress] of Object.entries(sdk.tokens)) for(const isV3 of [false,true]) {
    if (!(src in prices) || !(dst in prices)) continue;
    try {
      const route=sdk.getZapRoutes({fromTokenAddress:srcAddress,toTokenAddress:dstAddress,isV3});
      const key=routeKey(route.encoding,route.routes);
      if(!route.routes.length) continue;
      if(!routes.has(key)) routes.set(key,{src,dst,isV3,srcDecimals:decimals.get(srcAddress.toLowerCase()),dstDecimals:decimals.get(dstAddress.toLowerCase())});
    } catch {}
  }
  // The planner reads wstETH.stEthPerToken() beside an ETH long quote; the SDK bundles no wstETH ABI.
  const wstEthRateAbi=[{type:'function',name:'stEthPerToken',stateMutability:'view',inputs:[],outputs:[{type:'uint256'}]}];
  const abis=[viem.multicall3Abi,wstEthRateAbi,...Object.entries(sdk).filter(([k])=>k.endsWith('_default')).map(([,v])=>v)];
  const bySelector=new Map();
  for(const abi of abis) for(const fn of abi) if(fn.type==='function') { const selector=viem.toFunctionSelector(fn); if(!bySelector.has(selector)) bySelector.set(selector,[]); bySelector.get(selector).push([fn]); }
  const events=[]; const logical=[]; const t0=performance.now();
  const now=()=>Math.round(performance.now()-t0);
  const ethPool=sdk.pools.wstETH.poolAddress.toLowerCase(),btcPool=sdk.pools.WBTC.poolAddress.toLowerCase();
  function reply(data,target,group) {
    for(const abi of bySelector.get(data.slice(0,10)) || []) {
      let decoded;
      try {decoded=viem.decodeFunctionData({abi,data});} catch {continue;}
      const name=decoded.functionName,args=decoded.args || [];
      if(name==='aggregate3') return viem.encodeFunctionResult({abi,functionName:name,result:args[0].map(call=>({success:true,returnData:reply(call.callData,call.target,group)}))});
      const item={at:now(),target:target?.toLowerCase(),name,args}; logical.push(item); group?.push(item);
      let result;
      if(name==='getPoolInfo') result=[10n**36n,0n,0n,10n**36n,0n];
      else if(name==='paused') result=false;
      else if(name==='getDebtRatioRange') result=[100000000000000000n,950000000000000000n];
      else if(name==='getLiquidateRatios') {
        if (options.liquidationReadUnavailable) throw new Error('fixture: liquidation threshold unavailable');
        result=[950000000000000000n,50000000n];
      }
      else if(name==='getRebalanceRatios') {
        if (options.rebalanceReadUnavailable) throw new Error('fixture: rebalance threshold unavailable');
        result=[880000000000000000n,25000000n];
      }
      else if(name==='getPoolFeeRatio') result=options.feeRatios ?? [1000000n,2000000n,3000000n,4000000n];
      else if(name==='getRate'||name==='stEthPerToken') result=1200000000000000000n;
      else if(name==='getPrice') {const p=(target.toLowerCase()===sdk.pools.WBTC.oracle.toLowerCase()?60000n:2000n)*10n**18n;result=[p,p*995n/1000n,p*1005n/1000n];}
      else if(name==='queryConvert') {
        const r=routes.get(routeKey(args[1],args[2]));
        assert.ok(r,`unknown converter route ${routeKey(args[1],args[2])}`);
        item.route=`${r.src}->${r.dst}${r.isV3?':v3':''}`;
        result=BigInt(args[0])*prices[r.src]*(10n**BigInt(r.dstDecimals))/prices[r.dst]/(10n**BigInt(r.srcDecimals));
      }
      else if(name==='allowance') result=options.allowance ?? 0n;
      else if(name==='getApproved') result=options.positionApproved ? sdk.contracts.Router_Diamond : ZERO;
      else if(name==='isApprovedForAll') result=!!options.positionApproved;
      else if(name==='ownerOf') result=options.owner || OWNER;
      else if(name==='getPosition') result=target.toLowerCase()===btcPool?[10n**17n,3000n*10n**18n]:[2400000000000000000n,2400n*10n**18n];
      else if(name==='decimals') result=decimals.get(target.toLowerCase()) ?? 18;
      else if(name==='balanceOf') result=options.tokenBalance ?? 10n**25n;
      else if(name==='totalSupply') result=10n**28n;
      else throw new Error(`Unconfigured fixture contract read: ${name} at ${target}`);
      return viem.encodeFunctionResult({abi,functionName:name,result});
    }
    throw new Error(`Unknown fixture calldata ${data.slice(0,10)} at ${target}`);
  }
  const block={number:'0x1312d00',hash,parentHash:hash,timestamp:'0x68e50c80',baseFeePerGas:'0x3b9aca00',gasLimit:'0x1c9c380',gasUsed:'0x0',miner:ZERO,nonce:'0x0000000000000000',difficulty:'0x0',totalDifficulty:'0x0',extraData:'0x',size:'0x0',transactions:[],uncles:[],logsBloom:'0x'+'00'.repeat(256),receiptsRoot:hash,sha3Uncles:hash,stateRoot:hash,transactionsRoot:hash,mixHash:hash};
  async function request({method,params=[]}) {
    const event={at:now(),method,reads:[]};events.push(event);
    if(options.delayMs) await new Promise(resolve=>setTimeout(resolve,options.delayMs));
    let result;
    if(method==='eth_call') result=reply(params[0].data,params[0].to,event.reads);
    else if(method==='eth_chainId') result='0x1';
    else if(method==='eth_getTransactionCount') result=viem.toHex(options.nonce ?? 7);
    else if(method==='eth_getBalance') result=viem.toHex(options.ethBalance ?? 10n**20n);
    else if(method==='eth_blockNumber') result=block.number;
    else if(method==='eth_getBlockByNumber'||method==='eth_getBlockByHash') result=block;
    else if(method==='eth_gasPrice') result='0x77359400';
    else if(method==='eth_maxPriorityFeePerGas') result='0x3b9aca00';
    else if(method==='eth_estimateGas') result='0x493e0';
    else if(method==='eth_feeHistory') result={oldestBlock:block.number,baseFeePerGas:['0x3b9aca00','0x3b9aca00'],gasUsedRatio:[0.5],reward:[['0x3b9aca00','0x3b9aca00','0x3b9aca00']]};
    else if(method==='eth_simulateV1') {
      assert.ok(Array.isArray(params[0]?.blockStateCalls),'expected ordered blockStateCalls');
      event.simulatedCalls=params[0].blockStateCalls.map(b=>b.calls);
      result=params[0].blockStateCalls.map(b=>({...block,calls:b.calls.map((c,i)=>({status:options.simulationFailureIndex===i?'0x0':'0x1',returnData:'0x',gasUsed:c.data&&c.data!=='0x'?'0x493e0':'0x5208',logs:[]}))}));
    } else throw new Error(`Unconfigured fixture RPC method ${method}; writes and network are forbidden`);
    event.end=now();return result;
  }
  const rpc=async body=>Array.isArray(body)?Promise.all(body.map(rpc)):{jsonrpc:'2.0',id:body.id,result:await request(body)};
  return {sdk,request,rpc,reply,events,logical,block,owner:options.owner||OWNER};
}
module.exports={loadSdk,createFixture,viem,OWNER,ZERO,DEFAULT_ENTRY};
