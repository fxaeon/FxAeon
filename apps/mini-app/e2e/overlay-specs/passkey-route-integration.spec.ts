import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { decodeFunctionData, encodeFunctionResult, parseAbi, type Hex } from 'viem';
import { fixture, forbidGlobalFetch, initializeIdentity, launch, ready } from '../test-support/passkey-boundary-fixture';

// Custom single-action review view joins production planner/controller/runner,
// passkey provider and server. RPC reads, receipts and Privy dispatch are synthetic.
// This is not actual Earn/ActionReview UI, on-chain execution, mobile handoff,
// fee selection or a process-restart/D1 durability test.
const app = resolve(__dirname, '../..');
const req = createRequire(resolve(app, 'package.json'));
const esbuild = createRequire(req.resolve('tsx/package.json'))('esbuild') as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
const ADDRESS = `0x${'ab'.repeat(20)}`;
const HASH = `0x${'12'.repeat(32)}`;
// Pass the real host validator; every request is intercepted below and never
// reaches this synthetic project path or any public RPC service.
const RPC = 'https://eth-mainnet.g.alchemy.com/v2/synthetic-passkey-proof';
const presentationAssets = new Map([
  ['/brand/navigation.svg', resolve(app, 'public/brand/navigation.svg')],
  ['/icon.svg', resolve(app, 'public/icon.svg')],
]);
const abi = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
  'function queryConvert(uint256 amount,uint256 encoding,uint256[] routes) view returns (uint256)',
  'function previewDeposit(address token,uint256 amount) view returns (uint256)',
  'function previewDeposit(uint256 amount) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
  'function depositToFxSave((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) params,address tokenOut,uint256 minShares,address receiver)',
]);
function rpcRead(data: Hex): Hex {
  const call = decodeFunctionData({ abi, data });
  switch (call.functionName) {
    case 'aggregate3': return encodeFunctionResult({ abi, functionName: 'aggregate3', result: call.args[0].map(item => ({ success: true, returnData: rpcRead(item.callData) })) });
    case 'allowance': return encodeFunctionResult({ abi, functionName: 'allowance', result: 100n * 10n ** 18n });
    case 'queryConvert': return encodeFunctionResult({ abi, functionName: 'queryConvert', result: 0n });
    case 'previewDeposit': return encodeFunctionResult({ abi, functionName: 'previewDeposit', result: 10n * 10n ** 18n });
    case 'convertToAssets': return encodeFunctionResult({ abi, functionName: 'convertToAssets', result: 10n ** 18n });
    default: throw new Error(`Unexpected SDK read ${call.functionName}`);
  }
}

let bundle = '';
test.beforeAll(async () => {
  test.setTimeout(180_000);
  // Production planner/SDK, review preparation/controller, runner, provider,
  // transport/client serialization and server crypto are kept. Only unrelated
  // route-data mounts, Telegram host and the physical authenticator are leaves.
  const mocks: Record<string, string> = {
    'next/navigation': `export const usePathname=()=>'/earn';export const useRouter=()=>({replace:()=>{}});`,
    '@/components/WalletRouteProviders': `export default ({children})=><>{children}</>;`,
    '@/lib/telegram': `export const getWebApp=()=>window.Telegram.WebApp;export const waitForTelegramWebApp=async()=>getWebApp();export const hasTelegramMiniAppLaunchData=()=>true;export const hasTelegramNativeHostHint=()=>true;export const hasTelegramWebHostHint=()=>false;export const openExternalLink=()=>false;export const haptic=()=>{};`,
    '@simplewebauthn/browser': `export const startAuthentication=async ({optionsJSON})=>window.syntheticAuthenticator(optionsJSON.challenge);export const startRegistration=()=>{throw Error('unexpected registration')};export const WebAuthnAbortService={cancelCeremony:()=>{}};`,
  };
  const built = await esbuild.build({
    stdin: { resolveDir: app, loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import TelegramPasskeyProvider from './src/components/admission/TelegramPasskeyProvider';
import {FxWalletContext} from './src/lib/wallet/context';
import {planDepositFxSave} from './src/lib/fx/service';
import {prepareRoutesForReview} from './src/lib/fx/reviewPreparation';
import {useActionReviewController} from './src/components/review/useActionReviewController';
import {runTransactionRoute} from './src/lib/fx/runner';
window.Telegram={WebApp:{initData:window.fixtureLaunch,platform:'tdesktop',close:()=>{},openLink:()=>{}}};
const address=${JSON.stringify(ADDRESS)},hash=${JSON.stringify(HASH)};
const client={chain:{id:1},getChainId:async()=>1,getTransactionCount:async()=>4,simulateCalls:async()=>{window.fixtureSimulations++;return {results:[{status:'success'}]}},getBalance:async()=>10n**20n,estimateGas:async()=>100000n,getTransactionReceipt:async()=>{window.fixtureReceiptReads++;return {transactionHash:hash,blockNumber:100n,blockHash:'0x'+'22'.repeat(32),status:'success',from:address,to:window.fixtureReviewed.to,logs:[]}},getTransaction:async()=>({hash,from:address,to:window.fixtureReviewed.to,input:window.fixtureReviewed.data,value:window.fixtureReviewed.value,nonce:4}),getBlockNumber:async()=>100n};
window.fixtureSimulations=0;window.fixtureReceiptReads=0;window.fixturePostConfirmReads=0;
function Page(){
 const wallet=React.useContext(FxWalletContext),review=useActionReviewController();
 const [route,setRoute]=React.useState(null),[stage,setStage]=React.useState('input');
 window.fixtureWallet=wallet;
 async function prepare(){
  try{
   const planned=await planDepositFxSave({userAddress:wallet.address,tokenIn:'fxUSD',amount:10n*10n**18n,slippage:2});
   const prepared=await prepareRoutesForReview([planned],wallet.address,()=>client);
   if(prepared.viable.length!==1)throw Error(prepared.failures.join(';'));
   const next=prepared.viable[0];if(next.transactions.length!==1)throw Error('Expected one SDK protocol action');
   if(!review.acceptRoute(next,'deposit-intent'))throw Error('Review not acceptable');
   review.bindSession({walletAddress:wallet.address,chainId:wallet.chainId,connectionVersion:wallet.connectionVersion});
   const tx=next.transactions[0];window.fixtureReviewed={to:tx.to,data:tx.data,value:tx.value,nonce:tx.nonce};
   window.fixtureRoute=next;setRoute(next);setStage('review');
  }catch(e){window.fixtureResult={error:String(e)};setStage('failed');}
 }
 async function confirm(){
  try{
   if(!review.matchesAcceptedRoute(route,'deposit-intent')||review.sessionMismatch({...wallet,walletAddress:wallet.address}))throw Error('Accepted review changed');
   setStage('running');const result=await runTransactionRoute({route,publicClient:client,callbacks:{
    beforeTransaction:async()=>{if(window.fixtureMode==='late-mutation')route.transactions[0].to=address;},
    postConfirmRead:async()=>{window.fixturePostConfirmReads++;},
    requestSignature:async request=>{window.fixtureRequest=request;const result=await wallet.sendTransaction(request);return result.hash;}
   }});window.fixtureResult=result;setStage(result.status);
  }catch(e){window.fixtureResult={error:String(e)};setStage('failed');}
 }
 return <main><h1>Earn deposit</h1>{stage==='input'?<button onClick={prepare}>Review deposit</button>:route&&<section aria-label="Reviewed deposit"><p>10 fxUSD</p><p data-testid="reviewed-minimum">{route.policy.reviewedAction.expectedEconomicLimits.join(',')}</p><p data-testid="reviewed-calldata">{route.transactions[0].data}</p><button disabled={stage!=='review'} onClick={confirm}>Confirm deposit</button></section>}<output data-testid="stage">{stage}</output></main>;
}
createRoot(document.getElementById('root')).render(<TelegramPasskeyProvider><Page/></TelegramPasskeyProvider>);
` },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
    outdir: resolve(app, 'test-results/passkey-route'), loader: { '.module.css': 'local-css' },
    define: {
      'process.env.NEXT_PUBLIC_PRIVY_APP_ID': '"testapp000000000000000000"',
      'process.env.NEXT_PUBLIC_TELEGRAM_WALLET_MODE': '"passkey"',
      'process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL': JSON.stringify(RPC),
    },
    banner: { js: 'var process={env:{}};' },
    plugins: [{ name: 'passkey-boundary-leaves', setup(build: {
      onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => unknown): void;
      onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => unknown): void;
    }) {
      build.onResolve({ filter: /^(next\/|@\/|@simplewebauthn\/)/ }, ({ path }) => mocks[path] ? { path, namespace: 'fixture' } : undefined);
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: mocks[path], loader: 'tsx', resolveDir: app }));
    } }],
  });
  const script = built.outputFiles.find(file => file.path.endsWith('.js'));
  if (!script) throw new Error('Integration entry not emitted');
  bundle = script.text;
});

type ApiBody = { action: string; challengeId?: string; response?: { response: { signature: string } }; transaction?: Record<string, string | number>; launchData?: string };
async function closeFixtures(cleanup: Array<() => Promise<void>>) {
  const failures: unknown[] = [];
  for (const close of cleanup.reverse()) {
    try { await close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw failures[0];
}

test('Node fetch escape guard blocks transport and restores fetch after assertion failure', async () => {
  const original = globalThis.fetch;
  const cleanup: Array<() => Promise<void>> = [];
  const escapes = forbidGlobalFetch({ after: callback => { cleanup.push(callback); } });
  try {
    await expect(globalThis.fetch('https://network-forbidden.invalid/')).rejects.toThrow('NETWORK FORBIDDEN');
    expect(escapes()).toBe(1);
    await expect(closeFixtures(cleanup)).rejects.toThrow('all server providers must use the injected transport');
    expect(globalThis.fetch).toBe(original);
  } finally { globalThis.fetch = original; }
});

const modes = ['valid', 'late-mutation', 'review-tamper', 'challenge-tamper', 'assertion-tamper', 'unknown'] as const;
for (const mode of modes) test(`reviewed SDK route joins runner, provider and SQLite server: ${mode}`, async ({ page }) => {
  test.setTimeout(90_000);
  const cleanup: Array<() => Promise<void>> = [];
  const lifecycle = { after: (callback: () => Promise<void>) => { cleanup.push(callback); } };
  const fetchEscapes = forbidGlobalFetch(lifecycle);
  try {
    await initializeIdentity();
    const f = await fixture(lifecycle);
    const { device } = await ready(f);
    if (mode === 'unknown') f.failRPC();
    const signedLaunch = await launch();
    const requests: ApiBody[] = [], replies: Array<{ action: string; status: number; error?: string }> = [];
    const rpcMethods: string[] = [], unexpected: string[] = [], pageErrors: string[] = [];
    const transport: Array<{ method: string; url: string; origin: string; contentType: string }> = [];
    const challenges = new Map<string, string>();
    let authentications = 0;
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.routeWebSocket('**/*', socket => { unexpected.push('websocket'); socket.close(); });
    await page.exposeFunction('syntheticAuthenticator', (challenge: string) => { authentications++; return device.assertion(challenge); });
    await page.route('**/*', async intercepted => {
      const request = intercepted.request(), url = new URL(request.url());
      if (url.href === RPC) {
        expect(request.method()).toBe('POST');
        const respond = (call: { id: number; method: string; params?: [{ data: Hex }] }) => {
          rpcMethods.push(call.method);
          let result: unknown;
          if (call.method === 'eth_chainId') result = '0x1';
          else if (call.method === 'eth_getTransactionCount') result = '0x4';
          else if (call.method === 'eth_call') result = rpcRead(call.params![0].data);
          else throw new Error(`Unexpected SDK transport method ${call.method}`);
          return { jsonrpc: '2.0', id: call.id, result };
        };
        const body = request.postDataJSON();
        return intercepted.fulfill({ json: Array.isArray(body) ? body.map(respond) : respond(body) });
      }
      if (url.origin === 'https://fxaeon.com' && url.pathname === '/api/telegram-wallet') {
        expect(url.href).toBe('https://fxaeon.com/api/telegram-wallet');
        expect(request.method()).toBe('POST');
        const headers = await request.allHeaders();
        expect(headers.origin).toBe('https://fxaeon.com');
        expect(headers['content-type']).toMatch(/^application\/json(?:\s*;|$)/i);
        transport.push({ method: request.method(), url: request.url(), origin: headers.origin, contentType: headers['content-type'] });
        const body = request.postDataJSON() as ApiBody;
        requests.push(structuredClone(body));
        if (mode === 'assertion-tamper' && body.action === 'sign/complete') {
          const signature = Buffer.from(body.response!.response.signature, 'base64url');
          signature[signature.length - 1] ^= 1;
          body.response!.response.signature = signature.toString('base64url');
        }
        // Keep the browser's URL, method and headers. Only the explicit
        // assertion-tamper case changes the wire body before handler entry.
        const incoming = new Request(request.url(), { method: request.method(), headers,
          body: mode === 'assertion-tamper' && body.action === 'sign/complete' ? JSON.stringify(body) : request.postData() });
        const response = await f.handleRequest(incoming);
        replies.push({ action: body.action, status: response.status, error: response.body.error });
        if (body.action === 'sign/options' && response.status === 200) challenges.set(response.body.challengeId, response.body.options.challenge);
        if (mode === 'challenge-tamper' && body.action === 'sign/options' && response.status === 200) {
          const envelope = JSON.parse(Buffer.from(response.body.options.challenge, 'base64url').toString());
          envelope.body.params.transaction.to = ADDRESS;
          response.body.options.challenge = Buffer.from(JSON.stringify(envelope)).toString('base64url');
        }
        return intercepted.fulfill({ status: response.status, json: response.body });
      }
      if (request.resourceType() === 'document' && url.href === 'https://fxaeon.com/earn' && request.method() === 'GET') return intercepted.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      const asset = url.origin === 'https://fxaeon.com' && !url.search ? presentationAssets.get(url.pathname) : undefined;
      if (asset && request.method() === 'GET') return intercepted.fulfill({ contentType: 'image/svg+xml', body: readFileSync(asset) });
      unexpected.push(`${request.resourceType()} ${url.origin}${url.pathname}`);
      return intercepted.abort();
    });
    const open = async () => {
      await page.goto('https://fxaeon.com/earn');
      await page.evaluate(({ signedLaunch, mode }) => Object.assign(window, { fixtureLaunch: signedLaunch, fixtureMode: mode }), { signedLaunch, mode });
      await page.addScriptTag({ content: bundle });
      await expect(page.getByRole('heading', { name: 'Earn deposit' })).toBeVisible();
    };
    await open();
    await page.getByRole('button', { name: 'Review deposit' }).click();
    await expect.poll(() => page.getByTestId('stage').textContent()).not.toBe('input');
    expect(await page.evaluate(`window.fixtureResult?.error`)).toBeUndefined();
    await expect(page.getByTestId('stage')).toHaveText('review');
    // The identity fxUSD conversion has a zero conversion floor; the router's
    // independently bound base-pool share floor is the second limit.
    await expect(page.getByTestId('reviewed-minimum')).toHaveText(`0,${98n * 10n ** 17n}`);
    const data = await page.getByTestId('reviewed-calldata').textContent();
    const decoded = decodeFunctionData({ abi, data: data as Hex });
    expect(decoded.functionName).toBe('depositToFxSave');
    if (decoded.functionName !== 'depositToFxSave') throw new Error('Wrong reviewed action');
    expect(decoded.args[2]).toBe(98n * 10n ** 17n);
    expect(decoded.args[3].toLowerCase()).toBe(ADDRESS);
    expect(rpcMethods).toContain('eth_chainId');
    expect(rpcMethods).toContain('eth_call');
    if (mode === 'review-tamper') await page.evaluate(`window.fixtureRoute.transactions[0].to=${JSON.stringify(ADDRESS)}`);
    await page.getByRole('button', { name: 'Confirm deposit' }).click();
    if (mode !== 'review-tamper') {
      await expect(page.getByRole('heading', { name: 'Approve transaction.', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Approve with passkey' }).click();
    }
    const confirmed = mode === 'valid' || mode === 'late-mutation';
    await expect(page.getByTestId('stage')).toHaveText(confirmed ? 'confirmed' : 'failed');
    // open() creates a new document and resets this probe. Check the original
    // preparation/runner simulations now; recovery must do none after reopen.
    const initialSimulations = await page.evaluate<number>(`window.fixtureSimulations`);
    expect(initialSimulations).toBeGreaterThan(0);
    const rpcCalls = () => f.calls.filter(call => call.url.endsWith('/rpc'));
    if (mode === 'review-tamper' || mode === 'challenge-tamper') {
      expect(rpcCalls()).toHaveLength(0);
      expect(authentications).toBe(0);
      expect(requests.filter(body => body.action === 'sign/complete')).toHaveLength(0);
      if (mode === 'review-tamper') expect(requests.filter(body => body.action === 'sign/options')).toHaveLength(0);
    } else if (mode === 'assertion-tamper') {
      expect(authentications).toBe(1); expect(rpcCalls()).toHaveLength(0);
      expect(replies.find(reply => reply.action === 'sign/complete')).toMatchObject({ status: 403, error: 'passkey_rejected' });
      const replay = await f.send(requests.find(body => body.action === 'sign/complete'));
      expect(replay.status).toBe(403);
      expect(rpcCalls()).toHaveLength(0);
    } else {
      expect(authentications).toBe(1); expect(rpcCalls()).toHaveLength(1);
      const transaction = requests.find(body => body.action === 'sign/options')!.transaction!;
      const reviewed = await page.evaluate<{ to: string }>(`window.fixtureReviewed`);
      expect(transaction).toMatchObject({ from: ADDRESS, to: reviewed.to, data, value: '0x0', chainId: 1, nonce: '0x4', gasLimit: '0x1d4c0' });
      expect(rpcCalls()[0].url).toBe('https://api.privy.io/v1/wallets/wallet-1/rpc');
      expect(rpcCalls()[0].body.params.transaction).toEqual({ to: transaction.to, chain_id: 1, value: transaction.value, data, nonce: '0x4', gas_limit: '0x1d4c0' });
      expect(rpcCalls()[0].headers.get('privy-authorization-signature')).toMatch(/^webauthn:/);
      const completion = requests.find(body => body.action === 'sign/complete')!;
      const replay = await f.send(completion);
      if (confirmed) {
        expect(replay.body).toEqual({ hash: HASH });
        await expect.poll(() => replies.some(reply => reply.action === 'transaction/ack' && reply.status === 200)).toBe(true);
        if (mode === 'valid') {
          const next = await f.asUser('sign/options', 1, { transaction });
          expect(next.status).toBe(200);
          const oldChallenge = challenges.get(completion.challengeId!);
          expect(oldChallenge).toBeTruthy();
          // A fresh counter prevents a counter-only rejection from masking
          // failure to bind the assertion to this new challenge ID.
          const oldChallengeFreshCounter = await device.assertion(oldChallenge!, 2);
          const staleAssertion = await f.asUser('sign/complete', 1, { challengeId: next.body.challengeId, response: oldChallengeFreshCounter });
          expect(staleAssertion.status).toBe(403); expect(staleAssertion.body.error).toBe('passkey_rejected');
          expect((await f.store.status(1))!.credential!.counter).toBe(1);
          expect(rpcCalls()).toHaveLength(1);
          const control = await f.asUser('sign/options', 1, { transaction: { ...transaction, nonce: '0x5' } });
          expect(control.status).toBe(200);
          const accepted = await f.asUser('sign/complete', 1, { challengeId: control.body.challengeId,
            response: await device.assertion(control.body.options.challenge, 2) });
          expect(accepted).toMatchObject({ status: 200, body: { hash: HASH } });
          expect((await f.store.status(1))!.credential!.counter).toBe(2);
          expect(rpcCalls()).toHaveLength(2);
          expect(rpcCalls()[1].body.params.transaction.nonce).toBe('0x5');
          expect(rpcCalls()[1].body.reference_id).not.toBe(rpcCalls()[0].body.reference_id);
        }
      } else {
        expect(replay).toMatchObject({ status: 409, body: { error: 'transaction_unknown' } });
        const status = await f.refreshedUser('transaction/status');
        expect(status.body.operation).toMatchObject({ state: 'unknown', hash: null, acknowledged: false });
        const again = await f.asUser('sign/options', 1, { transaction });
        expect(again.status).toBe(409); expect(again.body.error).toBe('transaction_unresolved');
        expect(requests.some(body => body.action === 'transaction/ack')).toBe(false);
        expect(await page.evaluate(`window.fixtureReceiptReads`)).toBe(0);
        expect(await page.evaluate(`window.fixturePostConfirmReads`)).toBe(0);
        await open();
        await expect(page.getByRole('heading', { name: 'Check your transaction.', exact: true })).toBeVisible();
        const count = requests.filter(body => body.action === 'sign/options').length;
        expect(await page.evaluate(async transaction => {
          try { await (window as unknown as { fixtureWallet: { sendTransaction(t: unknown): Promise<unknown> } }).fixtureWallet.sendTransaction(transaction); return 'allowed'; }
          catch { return 'blocked'; }
        }, transaction)).toBe('blocked');
        expect(requests.filter(body => body.action === 'sign/options')).toHaveLength(count);
        expect(await page.evaluate(`window.fixtureSimulations`)).toBe(0);
        expect(await page.evaluate(`window.fixtureReceiptReads`)).toBe(0);
      }
      expect(rpcCalls()).toHaveLength(mode === 'valid' ? 2 : 1);
    }
    expect(unexpected).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(fetchEscapes()).toBe(0);
    await test.info().attach('joined-boundary-proof', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
      mode, initialSimulations, finalSimulations: await page.evaluate<number>(`window.fixtureSimulations`),
      browserAuthenticatorCalls: authentications, browserApiActions: requests.map(body => body.action),
      browserTransport: transport, sdkRpcMethods: [...new Set(rpcMethods)],
      syntheticPrivyDispatchAttempts: rpcCalls().length, unexpectedRequests: unexpected, pageErrors, globalFetchEscapes: fetchEscapes(),
      positiveControl: mode === 'valid' ? 'Old challenge with fresh counter2 rejected; current challenge with same counter2 accepted as separate nonce5 authorization.' : null,
    }, null, 2)) });
  } finally {
    try { await page.close(); }
    finally {
      // Drain injected background work before restoring global fetch; always
      // execute every cleanup even when an escape assertion fails.
      await closeFixtures(cleanup);
    }
  }
});
