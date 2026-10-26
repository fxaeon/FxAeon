const fs=require('fs'),path=require('path'),{createRequire}=require('module');
const repo=path.resolve(__dirname,'../../../..'),src=path.join(repo,'apps/mini-app/src');
const req=createRequire(path.join(repo,'apps/mini-app/package.json')),esbuild=createRequire(req.resolve('tsx/package.json'))('esbuild');
const mocks={
  // This fixture proves the real ticket/review SDK path; public context panels
  // are covered by built-route tests and must not add a query-client boundary.
  "@/components/ProductSections": "export const TradeSections = () => null;",
  "next/link": "import React from 'react'; export default ({children,...props}) => <a {...props}>{children}</a>;",
  "@/components/MarketChart": "import React from 'react'; export const TradeMarketChart = ({market,onMarketChange}) => <div role='radiogroup' aria-label='Market'>{['ETH','BTC'].map(item=><button type='button' role='radio' aria-checked={market===item} key={item} onClick={()=>onMarketChange(item)}>{item}</button>)}</div>;",
  "@/components/PriceProvider": "export const useUsdPrices = () => globalThis.__longReview.prices ?? ({status:'unavailable',prices:{}}); export const useLiveMarketQuote = () => ({ quote: null, status: 'unavailable', isFresh: false });",
  "@/components/ProtocolPositionCard": "export const ProtocolPositionCard = () => null; export const ProtocolPositionList = () => null; export const ProtocolPositionNotice = () => null;",
  "@/components/ProtocolPositionProvider": "export const useProtocolPositions = () => ({positions:[],pendingPositions:[],status:'ready',failedGroups:[],refresh:async()=>({positions:[],failedGroups:[],successfulGroups:[],status:'ready',newPositions:[]})});",
  "@/components/ConfirmedPositionCards": "export const ConfirmedPositionCards = () => null;",
  "next/navigation": "export const useRouter=()=>({push:()=>{},prefetch:()=>{}});export const usePathname=()=>'/trade';export const useSearchParams=()=>new URLSearchParams();",
  "@/components/WalletProfile": "export default function WalletProfile(){return null}",
  "@/components/NetworkSelector": "export default function NetworkSelector(){return null}",
  "@/components/WalletDataProvider": "const balances={balances:[{key:'ETH',decimals:18,amountWei:globalThis.__longReview.prices ? 1000000000000000000n : 400000000000000n},{key:'WBTC',decimals:8,amountWei:100000000n},{key:'wstETH',decimals:18,amountWei:1000000000000000000n}],failedTokens:[]};export const useWalletBalances=()=>({data:balances,status:'ready',refresh:async()=>{}});export const useInvalidateWalletData=()=>async()=>{};",
  "@/lib/wallet": "export const usePrivyWallet=()=>({...globalThis.__longReview.wallet,wallets:[],sendTransaction:async()=>{throw Error('Wallet sending forbidden')},connect:async()=>{throw Error('Wallet connect forbidden')}});export const useWalletReadyTimeout=()=>false;export const isWalletConnectCancellation=()=>false;",
  "@/lib/telegram": "export const haptic=()=>{};export const openExternalLink=()=>false;export const telegramExplorerUrl=()=>null;"
};
const instrument={
 'service.ts':['planIncreasePosition'], 'leverage.ts':['readLeverageBounds','prepareLeverageReview'],
 'reviewPreparation.ts':['prepareRoutesForReview'], 'gasFeePolicy.ts':['fetchGasTierQuotes'], 'gasCost.ts':['estimatePlannedRouteCost']
};
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import TradePage from '@/app/trade/page';
function Harness(){const[,update]=React.useState(0);globalThis.__longReview.rerender=()=>update(v=>v+1);return <TradePage/>;}
createRoot(document.getElementById('root')).render(<Harness/>);`;
async function buildHarness(){const build=await esbuild.build({stdin:{contents:entry,resolveDir:path.join(repo,'apps/mini-app'),loader:'tsx'},bundle:true,write:false,outdir:path.join(repo,'harness-output'),entryNames:'harness',format:'iife',platform:'browser',target:'es2020',jsx:'automatic',minify:false,loader:{'.tsx':'tsx','.ts':'ts','.module.css':'local-css'},absWorkingDir:repo,
 define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL':'"https://eth-mainnet.g.alchemy.com/v2/fake-controlled-fixture"','process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL':'"https://base-mainnet.g.alchemy.com/v2/fake-controlled-fixture"'},
 plugins:[{name:'controlled-long-fixture',setup(b){
 b.onResolve({filter:/.*/},args=>{if(mocks[args.path])return {path:args.path,namespace:'fixture'};

 if(args.path.startsWith('@/')){let p=path.join(src,args.path.slice(2));for(const candidate of [p,p+'.ts',p+'.tsx',path.join(p,'index.ts')])if(fs.existsSync(candidate)&&fs.statSync(candidate).isFile())return {path:candidate};}
 });
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:path.join(repo,'apps/mini-app')}));
 // Tag Max's route probes explicitly: a probe may legitimately use the same
 // amount as the ticket, so amount/timing alone cannot identify duplicate plans.
 b.onLoad({filter:/[\\/]app[\\/]trade[\\/]page\.tsx$/},args=>{
   let contents=fs.readFileSync(args.path,'utf8');
   const call='buildRoutes: (candidate) => planIncreasePosition(';
   if(!contents.includes(call)) throw new Error('Trade native Max fixture hook no longer matches');
   contents=contents.replace(call,'buildRoutes: (candidate) => __nativeMaxPlan(');
   contents+='\nfunction __nativeMaxPlan(request){return planIncreasePosition(request,"native-max");}\n';
   return {contents,loader:'tsx'};
 });
 b.onLoad({filter:/[\\/]fx[\\/](service|leverage|reviewPreparation|gasFeePolicy|gasCost)\.ts$/},args=>{let contents=fs.readFileSync(args.path,'utf8');let names=instrument[path.basename(args.path)]||[];for(const name of names){contents=contents.replace('export async function '+name+'(', 'async function __actual_'+name+'(').replace('export async function '+name+'<','async function __actual_'+name+'<');contents+=`\nexport async function ${name}(...args){return globalThis.__longReview.trace('${name}',()=>__actual_${name}(...args),args);}\n`;};return {contents,loader:'ts'};});
 }}]});const app=path.join(repo,'apps/mini-app');
 const globals=await req('postcss')([req('tailwindcss')({...require(path.join(app,'tailwind.config.js')),content:[path.join(src,'**/*.{ts,tsx}')]}),req('autoprefixer')()]).process(fs.readFileSync(path.join(src,'app/globals.css'),'utf8'),{from:path.join(src,'app/globals.css')});
 return {script:build.outputFiles.find(f=>f.path.endsWith('.js')).text,css:globals.css+'\n'+fs.readFileSync(path.join(src,'app/product-shell.css'),'utf8')+'\n'+build.outputFiles.find(f=>f.path.endsWith('.css')).text+'\n:root{--font-sans:system-ui,sans-serif}'};}
module.exports={buildHarness};
