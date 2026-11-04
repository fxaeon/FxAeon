import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const app = resolve(__dirname, '../..');
const fixtureFont = readFileSync(resolve(app, 'src/app/fonts/inter-latin.woff2')).toString('base64');
const fixtureFontCss = `@font-face{font-family:FixtureInter;src:url(data:font/woff2;base64,${fixtureFont}) format('woff2');font-style:normal;font-weight:100 900;font-display:block}html{--font-sans:FixtureInter}`;
const esbuild = createRequire(createRequire(resolve(app, 'package.json')).resolve('tsx/package.json'))('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
const APP = 'clabcdefghijklmnopqrstuv';
const FROM = `0x${'1'.repeat(40)}`;
const TO = `0x${'2'.repeat(40)}`;
const HASH = `0x${'3'.repeat(64)}`;
const transaction = { from: FROM, to: TO, chainId: 1, data: '0x1234', value: '0x10', nonce: '0x2', gasLimit: '0x5208' };
const wallet = { id: 'wallet-1', address: FROM };
const status = { state: 'ready', wallet, hasCredential: true, telegramNotify: false, emailVerified: false, cohortFull: false };
const canonical = (value: any): string => value && typeof value === 'object'
  ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
function challenge(tamper = false) {
  return Buffer.from(canonical({ version: 1, method: 'POST', url: 'https://api.privy.io/v1/wallets/wallet-1/rpc',
    headers: { 'privy-app-id': APP, 'privy-idempotency-key': 'request-1', 'privy-request-expiry': String(Date.now() + 299_000) },
    body: { method: 'eth_sendTransaction', caip2: 'eip155:1', reference_id: 'request-1', params: { transaction: { to: tamper ? FROM : TO, chain_id: 1, value: '0x10', data: '0x1234', nonce: '0x2', gas_limit: '0x5208' } } },
  })).toString('base64url');
}
let script = '';
let css = '';
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const mocks: Record<string, string> = {
    'next/dynamic': `import React from 'react';export default (loader,options={}) => {const C=React.lazy(loader);const Loading=options.loading;return props => <React.Suspense fallback={Loading?<Loading/>:null}><C {...props}/></React.Suspense>};`,
    'next/navigation': `export const usePathname=()=>location.pathname;export const useRouter=()=>({replace:path=>history.replaceState({},'',path)});`,
    '@/components/WalletRouteProviders': `export default ({children})=><>{children}</>;`,
    '@/lib/wallet': `export const BrowserWalletProvider=({children})=><div data-browser-wallet>{children}</div>;export {usePrivyWallet} from './src/lib/wallet/context';export {isWalletConnectCancellation} from './src/lib/wallet/connectWatch';`,
    '@/lib/fx/clients': `export const getPublicClient=()=>({request:async args=>{window.client.reads.push(args);return '0x1'}});`,
    '@/lib/telegram': `export const getWebApp=()=>window.Telegram?.WebApp;export const waitForTelegramWebApp=()=>window.fixtureBridgeWait||Promise.resolve(getWebApp());export const hasTelegramMiniAppLaunchData=()=>!!getWebApp()?.initData||!!new URLSearchParams(location.hash.slice(1)).get('tgWebAppData');export const hasTelegramNativeHostHint=()=>!!getWebApp()||!!window.fixtureDelayedBridge;export const hasTelegramWebHostHint=()=>false;export const openExternalLink=()=>false;export const haptic=()=>{};`,
    '@simplewebauthn/browser': `const run=kind=>async options=>{window.client.ceremonies.push({kind,options});if(window.client.deferAuth)return new Promise((resolve,reject)=>{window.client.resolveAuth=()=>resolve({id:'fixture-response'});window.client.rejectAuth=reject});return {id:'fixture-response'}};export const startRegistration=run('register');export const startAuthentication=run('sign');export const WebAuthnAbortService={cancelCeremony:()=>{window.client?.rejectAuth?.(new DOMException('Cancelled','AbortError'));}};`,
  };
  const result = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import ClientWalletProvider from './src/components/ClientWalletProvider';
      import {FxWalletContext} from './src/lib/wallet/context';
      import ConnectWalletButton from './src/components/ConnectWalletButton';
      import {recordPendingHash} from './src/lib/fx/journal';
      import ApprovalPage from './src/app/wallet-approval/page';import InvitePage from './src/app/invite/page';
      import './src/app/globals.css';
      window.client={ceremonies:[],reads:[],results:[],links:[],deferAuth:false};
      window.Telegram={WebApp:{initData:window.fixtureLaunchData||'user=%7B%22id%22%3A12345%7D&hash=fixture',platform:window.fixturePlatform||'tdesktop',close:()=>{},openLink:url=>window.client.links.push(url),requestWriteAccess:cb=>cb(true)}};
      if(window.fixtureDelayedBridge){const telegram=window.Telegram;delete window.Telegram;window.fixtureBridgeWait=new Promise(resolve=>{window.client.timeoutBridge=()=>resolve(null);window.client.releaseBridge=()=>{window.Telegram=telegram;resolve(telegram.WebApp)}})}
      function Content(){const wallet=React.useContext(FxWalletContext);window.client.wallet=wallet;return <div data-wallet-ready={String(wallet.ready)} data-wallet-authenticated={String(wallet.authenticated)} data-wallet-address={wallet.address??''}><h1>Portfolio</h1><nav aria-label="App navigation"><a href="/trade">Trade</a></nav>{!wallet.authenticated&&<ConnectWalletButton>Connect Telegram wallet</ConnectWalletButton>}<button onClick={()=>wallet.sendTransaction(${JSON.stringify(transaction)}).then(r=>{window.client.results.push(r);if(window.fixtureDurableReceipt)recordPendingHash({operation:'sendAsset',walletAddress:${JSON.stringify(FROM)},chainId:1,hash:r.hash,to:${JSON.stringify(TO)},data:'0x1234',value:16n,nonce:2});}).catch(e=>window.client.results.push({error:e.message}))}>Review and send</button><button onClick={()=>wallet.disconnect()}>Disconnect</button><button onClick={()=>wallet.switchChain(8453)}>Change network</button></div>}
      const child=location.pathname==='/wallet-approval'?<ApprovalPage/>:location.pathname==='/invite'?<InvitePage/>:<Content/>;
      createRoot(document.getElementById('root')).render(<React.StrictMode><ClientWalletProvider>{child}</ClientWalletProvider></React.StrictMode>);`, loader: 'tsx', resolveDir: app },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
    outdir: resolve(app, 'test-results/passkey-client'), absWorkingDir: app, loader: { '.module.css': 'local-css' }, external: ['/fonts/*'],
    define: { 'process.env.NEXT_PUBLIC_TELEGRAM_WALLET_MODE': '"passkey"', 'process.env.NEXT_PUBLIC_PRIVY_APP_ID': JSON.stringify(APP) },
    banner: { js: 'var process = {env:{}};' },
    plugins: [{ name: 'isolated-client', setup(build: any) {
      build.onResolve({ filter: /^(next\/|@\/|@simplewebauthn\/)/ }, ({ path }: { path: string }) => mocks[path] ? { path, namespace: 'fixture' } : undefined);
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }: { path: string }) => ({ contents: mocks[path], loader: 'tsx', resolveDir: app }));
    } }],
  });
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text;
});

type Fixture = { statusError?: string; launchData?: string; state?: string; wallet?: { id: string; address: string }; hasCredential?: boolean; statusAfterFirst?: { state: string; hasCredential: boolean }; completeHandoff?: boolean; failHandoff?: boolean; cohortFull?: boolean; telegramWriteAllowed?: boolean; tamper?: boolean; mobile?: boolean; delayedBridge?: boolean; failComplete?: boolean; substituteHandoff?: boolean; registerHandoff?: boolean; durableReceipt?: boolean; deferStatus?: Promise<void>; deferRecovery?: Promise<void>; failStatus?: boolean; deferSignOptions?: Promise<void>; deferJoin?: Promise<void>; deferHandoff?: Promise<void>; completionProof?: 'rejected' | 'empty' | 'wrong-id'; expireComplete?: boolean; loseAck?: boolean; emailDelivery?: { state: string; retryAfterMs: number | null } };
async function mount(page: Page, path = '/', fixture: Fixture = {}) {
  const requests: any[] = [];
  const errors: string[] = [];
  const expectedChallenge = challenge();
  const returnedChallenge = fixture.tamper || fixture.substituteHandoff ? challenge(true) : expectedChallenge;
  let operation: { id: string; state: string; hash: string | null; chainId: number; acknowledged: boolean } | null = null;
  page.on('pageerror', error => { errors.push(error.message); console.error(`Client fixture: ${error.message}`); });
  await page.route('**/*', async route => {
    if (route.request().url().endsWith('/api/telegram-wallet')) {
      const body = route.request().postDataJSON(); requests.push(body);
      let response: unknown;
      switch (body.action) {
        case 'status':
          if (fixture.deferStatus) await fixture.deferStatus;
          if (fixture.failStatus) return route.abort();
          if (fixture.statusError) return route.fulfill({ status: 403, json: { error: fixture.statusError } });
          response = { ...status, ...fixture, ...(requests.filter(r => r.action === 'status').length > 1 ? fixture.statusAfterFirst : {}) }; break;
        case 'transaction/status':
          if (fixture.deferRecovery) await fixture.deferRecovery;
          response = { operation: body.id || !operation?.acknowledged ? operation : null }; break;
        case 'transaction/ack':
          expect(body).toMatchObject({ id: operation?.id, hash: operation?.hash });
          if (fixture.loseAck && operation) { operation.acknowledged = true; return route.abort(); }
          operation = null; response = { acknowledged: true }; break;
        case 'join':
          if (fixture.deferJoin) await fixture.deferJoin;
          response = { ...status, state: 'waiting', wallet: undefined }; break;
        case 'notify': response = { ...status, state: 'waiting', telegramNotify: body.allowed, wallet: undefined }; break;
        case 'register/options': response = { challengeId: 'register-1', options: { challenge: 'register-challenge' } }; break;
        case 'register/complete': case 'wallet/retry': response = { state: 'ready', wallet }; break;
        case 'sign/options':
          if (fixture.deferSignOptions) await fixture.deferSignOptions;
          response = { challengeId: 'sign-1', options: { challenge: returnedChallenge } }; break;
        case 'handoff/create':
          if (fixture.deferHandoff) await fixture.deferHandoff;
          if (fixture.failHandoff) return route.abort();
          response = { url: 'https://fxaeon.test/wallet-approval#token=opaque-ticket' }; break;
        case 'handoff/cancel':
          operation = { id: 'sign-1', state: 'rejected', hash: null, chainId: 1, acknowledged: true };
          response = { cancelled: true }; break;
        case 'handoff/status': response = operation?.state === 'rejected'
          ? { state: 'error', error: 'approval_cancelled' } : fixture.completeHandoff ? { state: 'done', result: { wallet } } : { state: 'pending' }; break;
        case 'handoff/read': response = fixture.registerHandoff ? { kind: 'register', options: { challenge: returnedChallenge } } : { kind: 'sign', options: { challenge: returnedChallenge }, transaction: fixture.substituteHandoff ? { ...transaction, to: FROM } : transaction }; break;
        case 'sign/complete': case 'handoff/complete':
          operation = fixture.completionProof === 'empty' ? null : fixture.completionProof ? {
            id: fixture.completionProof === 'wrong-id' ? 'other-intent' : body.challengeId, state: 'rejected', hash: null, chainId: 1, acknowledged: true,
          } : { id: body.challengeId ?? 'sign-1', state: 'submitted', hash: HASH, chainId: 1, acknowledged: false };
          if (fixture.expireComplete) return route.fulfill({ status: 403, json: { error: 'approval_expired' } });
          if (fixture.failComplete) return route.abort();
          response = fixture.registerHandoff ? { state: 'ready', wallet } : { hash: HASH }; break;
        case 'email/confirm': response = { verified: true }; break;
        case 'email/request': response = { status: 'verification_requested', delivery: fixture.emailDelivery }; break;
        case 'email/retry': response = { status: 'verification_requested', delivery: { state: 'pending', retryAfterMs: 1000 } }; break;
        default: response = { ok: true };
      }
      return route.fulfill({ json: response });
    }
    if (route.request().resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
    return route.abort();
  });
  const prefix = fixture.registerHandoff ? Buffer.alloc(0) : Buffer.from(`FxAeon signing handoff v1\0${canonical({ ...transaction, from: transaction.from.toLowerCase() })}\0`);
  const commitment = createHash('sha256').update(prefix).update(Buffer.from(expectedChallenge, 'base64url')).digest('base64url');
  await page.goto(`https://fxaeon.test${path}${path.startsWith('/wallet-approval#') ? `&commitment=${commitment}` : ''}`);
  await page.evaluate(({ mobile, durable, delayedBridge, launchData }) => { (window as any).fixturePlatform = mobile ? 'ios' : 'tdesktop'; (window as any).fixtureDurableReceipt = durable; (window as any).fixtureDelayedBridge = delayedBridge; (window as any).fixtureLaunchData = launchData; }, { mobile: fixture.mobile ?? false, durable: fixture.durableReceipt ?? false, delayedBridge: fixture.delayedBridge ?? false, launchData: fixture.launchData ?? '' });
  await page.addStyleTag({ content: `${fixtureFontCss}\n${css}` }); await page.addScriptTag({ content: script });
  const reload = async () => {
    await page.reload();
    await page.evaluate(({ mobile, launchData }) => { (window as any).fixturePlatform = mobile ? 'ios' : 'tdesktop'; (window as any).fixtureLaunchData = launchData; }, { mobile: fixture.mobile ?? false, launchData: fixture.launchData ?? '' });
    await page.addStyleTag({ content: `${fixtureFontCss}\n${css}` }); await page.addScriptTag({ content: script });
  };
  return { requests, errors, reload };
}
const readClient = (page: Page, field: string) => page.evaluate(field => (window as any).client[field], field);
function heldResponse() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function observeStartup(page: Page) {
  await page.addInitScript(() => {
    (window as any).startupFlashes = [];
    new MutationObserver(() => {
      const flash = document.querySelector('[data-wallet-authenticated="false"], [data-admission-state="checking"], [data-browser-wallet], [data-portfolio-explore], [data-portfolio-value], [aria-label="Portfolio views"]');
      if (flash) (window as any).startupFlashes.push('unresolved guest or access screen');
    }).observe(document, { childList: true, subtree: true, attributes: true });
  });
}

async function expectNeutralStartup(page: Page) {
  await expect(page.getByRole('status', { name: 'Loading FxAeon', exact: true })).toBeVisible();
  await expect(page.locator('[data-wallet-authenticated], [data-admission-state="checking"], [data-portfolio-explore]')).toHaveCount(0);
  await expect(page.locator('[data-portfolio-value], [aria-label="Portfolio views"], .app-content .skeleton')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /connect wallet/i })).toHaveCount(0);
  await expect(page.getByText('Checking your access.', { exact: true })).toHaveCount(0);
}

test('passkey startup with immediate server responses publishes only the verified account', async ({ page }) => {
  await observeStartup(page);
  const { requests, errors } = await mount(page, '/', { mobile: true });
  await expect(page.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', FROM);
  await expect(page.locator('[data-wallet-ready]')).toHaveAttribute('data-wallet-ready', 'true');
  expect(requests.map(request => request.action)).toEqual(['status', 'transaction/status']);
  expect(await page.evaluate(() => (window as any).startupFlashes)).toEqual([]);
  expect(errors).toEqual([]);
});

test('passkey startup remains neutral through delayed server status and recovery before publishing the verified account', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await observeStartup(page);
  const access = heldResponse();
  const recovery = heldResponse();
  try {
    const { requests, errors } = await mount(page, '/', { mobile: true, deferStatus: access.promise, deferRecovery: recovery.promise });
    await expect.poll(() => requests.map(request => request.action)).toEqual(['status']);
    await expectNeutralStartup(page);
    expect(requests[0].launchData).toContain('hash=fixture');
    access.release();
    await expect.poll(() => requests.map(request => request.action)).toEqual(['status', 'transaction/status']);
    await expectNeutralStartup(page);
    recovery.release();
    await expect(page.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', FROM);
    await expect(page.locator('[data-wallet-ready]')).toHaveAttribute('data-wallet-ready', 'true');
    expect(await page.evaluate(() => (window as any).startupFlashes)).toEqual([]);
    expect(await readClient(page, 'ceremonies')).toEqual([]);
    expect(errors).toEqual([]);
  } finally { access.release(); recovery.release(); }
});

test('passkey startup rechecks the same account after reload without publishing a guest', async ({ page }) => {
  await observeStartup(page);
  const fixture: Fixture = {};
  const { requests, reload } = await mount(page, '/', fixture);
  await expect(page.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', FROM);
  const access = heldResponse();
  fixture.deferStatus = access.promise;
  try {
    await reload();
    await expect.poll(() => requests.filter(request => request.action === 'status').length).toBe(2);
    await expectNeutralStartup(page);
    access.release();
    await expect(page.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', FROM);
    expect(await page.evaluate(() => (window as any).startupFlashes)).toEqual([]);
    expect(requests.filter(request => request.action === 'transaction/status')).toHaveLength(2);
  } finally { access.release(); }
});

test('passkey startup retires a changed Telegram identity before its new server check resolves', async ({ page }) => {
  await observeStartup(page);
  const fixture: Fixture = {};
  const { requests, errors } = await mount(page, '/', fixture);
  await expect(page.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', FROM);
  const access = heldResponse();
  fixture.deferStatus = access.promise;
  fixture.wallet = { id: 'wallet-2', address: TO };
  try {
    await page.evaluate(() => {
      (window as any).oldWallet = (window as any).client.wallet;
      (window as any).Telegram.WebApp.initData = 'user=%7B%22id%22%3A67890%7D&hash=second-fixture';
      window.dispatchEvent(new Event('focus'));
    });
    await expect.poll(() => requests.filter(request => request.action === 'status').length).toBe(2);
    await expectNeutralStartup(page);
    expect(await page.evaluate(async () => {
      try { await (window as any).oldWallet.selectedWallet.getEthereumProvider(); return false; }
      catch { return true; }
    })).toBe(true);
    access.release();
    await expect(page.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', TO);
    expect(requests.filter(request => request.action === 'status')[1].launchData).toContain('hash=second-fixture');
    expect(await page.evaluate(() => (window as any).startupFlashes)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { access.release(); }
});

test('passkey startup ignores old-account recovery after a Telegram identity change', async ({ page }) => {
  await observeStartup(page);
  const oldRecovery = heldResponse();
  const newRecovery = heldResponse();
  const fixture: Fixture = { deferRecovery: oldRecovery.promise };
  try {
    const { requests, errors } = await mount(page, '/', fixture);
    await expect.poll(() => requests.filter(request => request.action === 'transaction/status').length).toBe(1);
    await expectNeutralStartup(page);
    fixture.deferRecovery = newRecovery.promise;
    fixture.wallet = { id: 'wallet-2', address: TO };
    await page.evaluate(() => {
      (window as any).Telegram.WebApp.initData = 'user=%7B%22id%22%3A67890%7D&hash=second-fixture';
      window.dispatchEvent(new Event('hashchange'));
    });
    await expect.poll(() => requests.filter(request => request.action === 'transaction/status').length).toBe(2);
    oldRecovery.release();
    await expectNeutralStartup(page);
    newRecovery.release();
    await expect(page.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', TO);
    expect(await page.evaluate(() => (window as any).startupFlashes)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { oldRecovery.release(); newRecovery.release(); }
});

test('passkey startup honors the server waitlist despite a remembered admission hint', async ({ page }) => {
  await observeStartup(page);
  await page.addInitScript(() => localStorage.setItem('fxaeon:telegram-admission:v1', JSON.stringify({ userId: 12345 })));
  const access = heldResponse();
  try {
    const { requests } = await mount(page, '/', { state: 'waiting', hasCredential: false, deferStatus: access.promise });
    await expect.poll(() => requests.map(request => request.action)).toEqual(['status']);
    await expectNeutralStartup(page);
    access.release();
    await expect(page.locator('[data-admission-state="alerts-off"]')).toBeVisible();
    await expect(page.locator('[data-wallet-authenticated]')).toHaveCount(0);
    expect(requests.map(request => request.action)).toEqual(['status']);
    expect(await page.evaluate(() => (window as any).startupFlashes)).toEqual([]);
  } finally { access.release(); }
});

for (const failure of ['unavailable', 'timeout']) {
  test(`passkey startup ${failure} stays fail-closed and can retry the server check`, async ({ page }) => {
    await observeStartup(page);
    if (failure === 'timeout') await page.clock.install();
    const access = heldResponse();
    const fixture: Fixture = failure === 'timeout' ? { deferStatus: access.promise } : { failStatus: true };
    try {
      const { requests } = await mount(page, '/', fixture);
      await expect.poll(() => requests.filter(request => request.action === 'status').length).toBe(1);
      if (failure === 'timeout') { await expectNeutralStartup(page); await page.clock.runFor(20_100); }
      await expect(page.locator('[data-admission-state="join-error"]')).toBeVisible();
      await expect(page.locator('[data-wallet-authenticated]')).toHaveCount(0);
      fixture.failStatus = false;
      fixture.deferStatus = undefined;
      access.release();
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', FROM);
      expect(requests.map(request => request.action)).toEqual(['status', 'status', 'transaction/status']);
      expect(await page.evaluate(() => (window as any).startupFlashes)).toEqual([]);
    } finally { access.release(); }
  });
}

test('mobile invitation prepares without a ceremony and opens the browser on one click', async ({ page }) => {
  const { requests } = await mount(page, '/', { state: 'approved', hasCredential: false, mobile: true, completeHandoff: true });
  await expect.poll(() => requests.filter(r => r.action === 'handoff/create').length).toBe(1);
  const setup = page.getByRole('button', { name: 'Set up my wallet' });
  await expect(setup).toBeEnabled();
  expect(await readClient(page, 'links')).toEqual([]);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  expect(requests.some(r => ['register/complete', 'wallet/retry', 'handoff/status'].includes(r.action))).toBe(false);
  await setup.click();
  await expect.poll(() => readClient(page, 'links')).toHaveLength(1);
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
  expect(await readClient(page, 'ceremonies')).toEqual([]);
});

for (const change of ['account', 'expiry', 'doubletap'] as const) test(`prepared invitation enforces ${change} on the fresh click`, async ({ page }) => {
  const { requests } = await mount(page, '/', { state: 'approved', hasCredential: false, mobile: true });
  await expect.poll(() => requests.filter(r => r.action === 'handoff/create').length).toBe(1);
  const button = page.getByRole('button', { name: 'Set up my wallet' });
  await expect(button).toBeEnabled();
  if (change === 'account') await page.evaluate(() => { (window as any).Telegram.WebApp.initData += '&changed=1'; });
  if (change === 'expiry') await page.evaluate(() => { const expired = Date.now() + 300_001; Date.now = () => expired; });
  await button.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
  if (change === 'doubletap') {
    await expect.poll(() => readClient(page, 'links')).toHaveLength(1);
    await page.getByRole('button', { name: 'Stop waiting' }).click();
  } else {
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await readClient(page, 'links')).toEqual([]);
    expect(requests.some(r => r.action === 'handoff/status')).toBe(false);
  }
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  expect(requests.filter(r => r.action === 'handoff/create')).toHaveLength(1);
});

test('deferring cancels preparation and never opens the late ticket', async ({ page }) => {
  let release!: () => void;
  const deferHandoff = new Promise<void>(resolve => { release = resolve; });
  const { requests } = await mount(page, '/', { state: 'approved', hasCredential: false, mobile: true, deferHandoff });
  await expect.poll(() => requests.some(r => r.action === 'handoff/create')).toBe(true);
  await expect(page.getByRole('status')).toContainText('Preparing secure setup');
  await expect(page.getByRole('button', { name: 'Set up my wallet' })).toBeDisabled();
  await page.getByRole('button', { name: 'Set up later' }).click();
  release();
  await expect(page.getByRole('button', { name: 'Set up my wallet' })).toBeEnabled();
  expect(await readClient(page, 'links')).toEqual([]);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  expect(requests.some(r => r.action === 'handoff/status')).toBe(false);
});

test('account change while preparing rejects the late ticket', async ({ page }) => {
  let release!: () => void;
  const deferHandoff = new Promise<void>(resolve => { release = resolve; });
  const { requests } = await mount(page, '/', { state: 'approved', hasCredential: false, mobile: true, deferHandoff });
  await expect.poll(() => requests.some(r => r.action === 'handoff/create')).toBe(true);
  await page.evaluate(() => { (window as any).Telegram.WebApp.initData += '&changed=1'; });
  release();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await readClient(page, 'links')).toEqual([]);
  expect(requests.some(r => r.action === 'handoff/status')).toBe(false);
});

test('failed background preparation retries only after another explicit click', async ({ page }) => {
  const { requests } = await mount(page, '/', { state: 'approved', hasCredential: false, mobile: true, failHandoff: true });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(requests.filter(r => r.action === 'handoff/create')).toHaveLength(1);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => requests.filter(r => r.action === 'handoff/create').length).toBe(2);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(requests.filter(r => r.action === 'handoff/create')).toHaveLength(2);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
});

test('a credential found during preparation never provisions until the user clicks', async ({ page }) => {
  const { requests } = await mount(page, '/', { state: 'approved', hasCredential: false, mobile: true,
    statusAfterFirst: { state: 'approved', hasCredential: true } });
  await expect.poll(() => requests.filter(r => r.action === 'status').length).toBe(2);
  await expect(page.getByRole('button', { name: 'Set up my wallet' })).toBeEnabled();
  expect(requests.some(r => ['register/options', 'wallet/retry'].includes(r.action))).toBe(false);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  await page.getByRole('button', { name: 'Set up my wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
  expect(requests.filter(r => r.action === 'wallet/retry')).toHaveLength(1);
});

test('desktop registration starts only on an explicit invitation click', async ({ page }) => {
  const { requests } = await mount(page, '/', { state: 'approved', hasCredential: false });
  const setup = page.getByRole('button', { name: 'Set up my wallet' });
  await expect(setup).toBeEnabled();
  expect(requests.some(r => r.action === 'register/options')).toBe(false);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  await setup.click();
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
  expect(await readClient(page, 'ceremonies')).toHaveLength(1);
});

test('invitation waits for the bridge and remains cancellable before preparation', async ({ page }) => {
  const launch = 'user=%7B%22id%22%3A12345%7D&hash=fixture';
  const { requests } = await mount(page, `/#tgWebAppData=${encodeURIComponent(launch)}`, { state: 'approved', hasCredential: false, mobile: true, delayedBridge: true });
  await expect(page.getByRole('button', { name: 'Set up my wallet' })).toBeDisabled();
  expect(requests.some(r => r.action === 'register/options')).toBe(false);
  await page.getByRole('button', { name: 'Set up later' }).click();
  await page.evaluate(() => (window as any).client.releaseBridge());
  await expect(page.getByRole('button', { name: 'Set up my wallet' })).toBeEnabled();
  expect(requests.some(r => r.action === 'register/options')).toBe(false);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
});

test('late mobile bridge after timeout prepares only on retry and still needs a fresh click', async ({ page }) => {
  const launch = 'user=%7B%22id%22%3A12345%7D&hash=fixture';
  const { requests } = await mount(page, `/#tgWebAppData=${encodeURIComponent(launch)}`, { state: 'approved', hasCredential: false, mobile: true, delayedBridge: true });
  await page.evaluate(() => (window as any).client.timeoutBridge());
  await page.getByRole('button', { name: 'Set up my wallet' }).click();
  await expect(page.getByRole('alert')).toContainText('Telegram isn’t ready');
  await page.evaluate(() => (window as any).client.releaseBridge());
  await page.getByRole('button', { name: 'Set up my wallet' }).click();
  await expect.poll(() => requests.some(r => r.action === 'handoff/create')).toBe(true);
  const setup = page.getByRole('button', { name: 'Set up my wallet' });
  await expect(setup).toBeEnabled();
  expect(await readClient(page, 'links')).toEqual([]);
  await setup.click();
  await expect.poll(() => readClient(page, 'links')).toHaveLength(1);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
});

test('slow invitation preparation retains the original expiry', async ({ page }) => {
  let release!: () => void;
  const deferHandoff = new Promise<void>(resolve => { release = resolve; });
  const { requests } = await mount(page, '/', { state: 'approved', hasCredential: false, mobile: true, deferHandoff });
  await expect.poll(() => requests.some(r => r.action === 'handoff/create')).toBe(true);
  await page.evaluate(() => { const later = Date.now() + 240_000; Date.now = () => later; });
  release();
  const setup = page.getByRole('button', { name: 'Set up my wallet' });
  await expect(setup).toBeEnabled();
  await page.evaluate(() => { const expired = Date.now() + 60_001; Date.now = () => expired; });
  await setup.click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await readClient(page, 'links')).toEqual([]);
  expect(requests.some(r => r.action === 'handoff/status')).toBe(false);
});

async function openPreparedBrowser(page: Page) {
  await expect(page.getByText('Ready to open your browser.', { exact: true })).toBeVisible();
  expect(await readClient(page, 'links')).toEqual([]);
  await page.getByRole('button', { name: 'Continue in browser', exact: true }).click();
}

test('short phone keeps passkey setup reachable and cancellation returns to the invitation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { requests } = await mount(page, '/', { state: 'approved', hasCredential: false, mobile: true });
  await expect.poll(() => requests.some(r => r.action === 'handoff/create')).toBe(true);
  await expect(page.getByRole('heading', { name: 'Welcome to FxAeon.' })).toBeVisible();
  await expect(page.getByText('Opens your browser for passkey setup.')).toBeVisible();
  const primary = page.getByRole('button', { name: 'Set up my wallet' });
  const back = page.getByRole('button', { name: 'Set up later' });
  await expect(primary).toBeEnabled();
  await page.keyboard.press('Tab');
  await expect(primary).toBeFocused();
  expect(await primary.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  for (const control of [primary, back]) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await control.focus();
    await expect(control).toBeFocused();
  }
  await back.click();
  await expect(page.getByRole('heading', { name: 'Welcome to FxAeon.' })).toBeVisible();
  expect(requests.some(request => request.action === 'register/complete')).toBe(false);
});

test('onboarding browser and live setup fixture captures', async ({ page }) => {
  test.setTimeout(180_000);
  const directory = process.env.ONBOARDING_CAPTURE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  for (const [name, width, height] of [['320', 320, 568], ['390', 390, 844], ['desktop', 1440, 900]] as const) {
    if (process.env.ONBOARDING_CAPTURE_SIZE && name !== process.env.ONBOARDING_CAPTURE_SIZE) continue;
    await page.setViewportSize({ width, height });
    const save = async (state: string) => {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.locator('h1').evaluate(element => getComputedStyle(element).fontFamily)).toContain('FixtureInter');
      expect(await page.evaluate(() => document.fonts.check('600 38px FixtureInter'))).toBe(true);
      await page.screenshot({ path: resolve(directory, `${state}-${name}.png`), fullPage: true, animations: 'disabled' });
    };
    await mount(page, '/', { state: 'approved', hasCredential: false, mobile: true });
    await expect(page.getByRole('button', { name: 'Set up my wallet' })).toBeEnabled();
    await save('live-invited');
    await save('live-browser-prepared');
    await page.getByRole('button', { name: 'Set up my wallet' }).click();
    await expect(page.getByText('Complete setup in your browser. Waiting up to five minutes.')).toBeVisible();
    await save('live-browser-waiting');
    await mount(page, '/invite');
    await expect(page.getByRole('alert')).toBeVisible();
    await save('invite-expired');
    await mount(page, '/invite#token=email-secret');
    await expect(page.getByRole('button', { name: 'Confirm email' })).toBeVisible();
    await save('invite-confirm');
    await page.getByRole('button', { name: 'Confirm email' }).click();
    await expect(page.getByRole('heading', { name: 'Email confirmed.' })).toBeVisible();
    await save('invite-confirmed');
    await mount(page, '/wallet-approval');
    await expect(page.getByRole('alert')).toBeVisible();
    await save('browser-approval-expired');
    await mount(page, '/wallet-approval#token=opaque-ticket', { registerHandoff: true });
    await expect(page.getByRole('button', { name: 'Create passkey' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Return to Telegram' })).toHaveCSS('text-decoration-line', 'underline');
    await expect(page.getByRole('button', { name: 'Cancel' })).not.toHaveCSS('text-decoration-line', 'underline');
    await save('browser-approval-register');
    await page.getByRole('button', { name: 'Create passkey' }).click();
    await expect(page.getByRole('heading', { name: 'Wallet ready.' })).toBeVisible();
    await save('browser-approval-ready');
  }
});

test('email remains reachable as the Telegram viewport shrinks', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mount(page, '/', { state: 'waiting', hasCredential: false });
  await page.getByRole('button', { name: 'Use email instead' }).click();
  const email = page.getByRole('textbox', { name: 'Email address' });
  await email.fill('person@example.com');
  await page.setViewportSize({ width: 320, height: 300 });
  const submit = page.getByRole('button', { name: 'Send confirmation link' });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await email.focus();
  await expect(email).toBeFocused();
  await expect(email).toHaveValue('person@example.com');
});

test('signed launch status starts before the bridge resolves and late mobile bridge preserves browser setup', async ({ page }) => {
  const launchData = 'user=%7B%22id%22%3A12345%7D&hash=fixture';
  const { requests } = await mount(page, `/#tgWebAppData=${encodeURIComponent(launchData)}`, {
    state: 'approved', hasCredential: false, mobile: true, delayedBridge: true,
  });
  await expect.poll(() => requests.filter(r => r.action === 'status').length).toBe(1);
  expect(requests[0]).toEqual({ action: 'status', launchData });
  expect(await page.evaluate(() => Boolean((window as any).Telegram))).toBe(false);
  await page.evaluate(() => (window as any).client.releaseBridge());
  await expect.poll(() => requests.filter(r => r.action === 'handoff/create').length).toBe(1);
  await page.getByRole('button', { name: 'Set up my wallet' }).click();
  await expect.poll(async () => (await readClient(page, 'links')).length).toBe(1);
  await expect(page.getByRole('button', { name: 'Create passkey' })).toHaveCount(0);
  expect(requests.filter(r => r.action === 'status')).toHaveLength(2);
});

for (const kind of ['sign'] as Array<'register' | 'sign'>) for (const cancel of [false, true]) {
  test(`${kind} waits for an unresolved bridge${cancel ? ' across cancellation' : ' before accepting a click'}`, async ({ page }) => {
    const launchData = 'user=%7B%22id%22%3A12345%7D&hash=fixture';
    const { requests, errors } = await mount(page, `/#tgWebAppData=${encodeURIComponent(launchData)}`, {
      ...(kind === 'register' ? { state: 'approved', hasCredential: false } : {}),
      mobile: true, delayedBridge: true,
    });
    const enter = () => page.getByRole('button', { name: kind === 'register' ? 'Set up my wallet' : 'Review and send' }).click();
    await enter();
    const native = page.getByRole('button', { name: kind === 'register' ? 'Create passkey' : 'Approve with passkey' });
    await expect(native).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Continue in browser' })).toBeDisabled();
    await native.evaluate(button => (button as HTMLButtonElement).click());
    expect(requests.some(r => ['register/options', 'sign/options', 'handoff/create'].includes(r.action))).toBe(false);
    expect(await readClient(page, 'ceremonies')).toEqual([]);
    if (cancel) await page.getByRole('button', { name: kind === 'register' ? 'Back' : 'Cancel', exact: true }).click();
    await page.evaluate(() => (window as any).client.releaseBridge());
    if (cancel) await enter();
    await expect(native).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue in browser' })).toBeEnabled();
    await page.getByRole('button', { name: 'Continue in browser' }).click();
    await openPreparedBrowser(page);
    await expect.poll(async () => (await readClient(page, 'links')).length).toBe(1);
    expect(requests.filter(r => r.action === `${kind}/options`)).toHaveLength(1);
    expect(await readClient(page, 'ceremonies')).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const kind of ['sign'] as Array<'register' | 'sign'>) for (const lateMobile of [false, true]) {
  test(`${kind} after bridge timeout ${lateMobile ? 'uses late iOS rather than stale desktop' : 'rejects missing and unknown platforms then retries'}`, async ({ page }) => {
    const launchData = 'user=%7B%22id%22%3A12345%7D&hash=fixture';
    const { requests, errors } = await mount(page, `/#tgWebAppData=${encodeURIComponent(launchData)}`, {
      ...(kind === 'register' ? { state: 'approved', hasCredential: false } : {}),
      mobile: true, delayedBridge: true,
    });
    await page.getByRole('button', { name: kind === 'register' ? 'Set up my wallet' : 'Review and send' }).click();
    await page.evaluate(() => (window as any).client.timeoutBridge());
    const native = page.getByRole('button', { name: kind === 'register' ? 'Create passkey' : 'Approve with passkey' });
    await expect(native).toBeEnabled();
    if (!lateMobile) {
      await native.click();
      await expect(page.getByRole('alert')).toContainText('Telegram isn’t ready. Try again');
      await page.evaluate(() => { (window as any).Telegram = { WebApp: { platform: 'unknown' } }; });
      await page.getByRole('button', { name: 'Continue in browser' }).click();
      await expect(page.getByRole('alert')).toContainText('Telegram isn’t ready. Try again');
      expect(requests.some(r => ['register/options', 'sign/options', 'handoff/create'].includes(r.action))).toBe(false);
      expect(await readClient(page, 'ceremonies')).toEqual([]);
    }
    await page.evaluate(() => (window as any).client.releaseBridge());
    // The already-settled wait cannot update mobile state: the click must re-read it.
    await expect(native).toBeVisible();
    await native.click();
    await openPreparedBrowser(page);
    await expect.poll(async () => (await readClient(page, 'links')).length).toBe(1);
    expect(requests.filter(r => r.action === `${kind}/options`)).toHaveLength(1);
    expect(await readClient(page, 'ceremonies')).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('known Telegram Web uses browser handoff instead of native WebAuthn', async ({ page }) => {
  const { requests, errors } = await mount(page);
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.evaluate(() => { (window as any).Telegram.WebApp.platform = 'webk'; });
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await openPreparedBrowser(page);
  await expect.poll(async () => (await readClient(page, 'links')).length).toBe(1);
  expect(requests.filter(r => r.action === 'handoff/create')).toHaveLength(1);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  expect(errors).toEqual([]);
});

test('without launch data status waits for the bridge and does not send an empty launch', async ({ page }) => {
  const { requests } = await mount(page, '/', { state: 'waiting', hasCredential: false, delayedBridge: true });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(requests).toEqual([]);
  await page.evaluate(() => (window as any).client.releaseBridge());
  await expect(page.getByRole('heading', { name: 'You’re on the waitlist.' })).toBeVisible();
  expect(requests.filter(r => r.action === 'status')).toHaveLength(1);
  expect(requests[0].launchData).toBe('user=%7B%22id%22%3A12345%7D&hash=fixture');
});

test('Join posts immediately without a permission prompt and waits for the server before claiming enrollment', async ({ page }) => {
  let joined!: () => void;
  const deferJoin = new Promise<void>(resolve => { joined = resolve; });
  const { requests } = await mount(page, '/', { state: 'new', hasCredential: false, deferJoin });
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.action === 'join').length).toBe(1);
  await expect(page.getByRole('heading', { name: 'Join early access.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeDisabled();
  expect(requests.some(r => r.action === 'notify')).toBe(false);
  joined();
  await expect(page.getByRole('heading', { name: 'You’re on the waitlist.' })).toBeVisible();
  expect(requests.filter(r => r.action === 'join')).toHaveLength(1);
});

test('Telegram permission preserves receiver and user gesture, then persists only the callback grant', async ({ page }) => {
  const { requests } = await mount(page, '/', { state: 'waiting', hasCredential: false });
  await page.evaluate(() => {
    const app = (window as any).Telegram.WebApp;
    app.isVersionAtLeast = () => true;
    app.requestWriteAccess = function (this: unknown, callback: (allowed: boolean) => void) {
      if (this !== app) throw new Error('Lost receiver');
      (window as any).client.permissionGesture = navigator.userActivation.isActive;
      callback(true);
    };
  });
  await page.getByRole('button', { name: 'Allow Telegram invites' }).click();
  await expect(page.getByText('Your invite will arrive in this Telegram chat.')).toBeVisible();
  expect(await readClient(page, 'permissionGesture')).toBe(true);
  expect(requests.filter(r => r.action === 'notify')).toEqual([{ action: 'notify', allowed: true, launchData: 'user=%7B%22id%22%3A12345%7D&hash=fixture' }]);
  expect(requests.some(r => r.action === 'register/options')).toBe(false);
});

test('Telegram event-only permission works and duplicate callback cannot overwrite it', async ({ page }) => {
  const { requests } = await mount(page, '/', { state: 'waiting', hasCredential: false });
  await page.evaluate(() => {
    const app = (window as any).Telegram.WebApp;
    let handler: ((payload: unknown) => void) | undefined;
    app.onEvent = (_: string, value: typeof handler) => { handler = value; };
    app.offEvent = () => { handler = undefined; (window as any).client.permissionCleaned = true; };
    app.requestWriteAccess = (callback: (allowed: boolean) => void) => { handler?.({ status: 'allowed' }); callback(false); };
  });
  await page.getByRole('button', { name: 'Allow Telegram invites' }).click();
  await expect(page.getByText('Your invite will arrive in this Telegram chat.')).toBeVisible();
  expect(requests.filter(r => r.action === 'notify').map(r => r.allowed)).toEqual([true]);
  expect(await readClient(page, 'permissionCleaned')).toBe(true);
});

test('unsupported Telegram permission shows an actionable message and never claims or posts permission', async ({ page }) => {
  const { requests } = await mount(page, '/', { state: 'waiting', hasCredential: false });
  await page.evaluate(() => {
    (window as any).Telegram.WebApp.isVersionAtLeast = () => false;
    (window as any).Telegram.WebApp.initDataUnsafe = { user: { allows_write_to_pm: true } };
  });
  await page.getByRole('button', { name: 'Allow Telegram invites' }).click();
  await expect(page.getByRole('alert')).toHaveText('Update Telegram to allow invites, or use email instead.');
  await expect(page.getByText('Your invite will arrive in this Telegram chat.')).toHaveCount(0);
  expect(requests.some(r => r.action === 'notify')).toBe(false);
});

test('server-verified existing write permission skips the native prompt only after an explicit opt-in', async ({ page }) => {
  const { requests } = await mount(page, '/', { state: 'waiting', hasCredential: false, telegramWriteAllowed: true });
  await page.evaluate(() => {
    (window as any).Telegram.WebApp.requestWriteAccess = () => { throw new Error('Existing grant must not prompt again'); };
  });
  expect(requests.some(r => r.action === 'notify')).toBe(false);
  await page.getByRole('button', { name: 'Allow Telegram invites' }).click();
  await expect(page.getByText('Your invite will arrive in this Telegram chat.')).toBeVisible();
  expect(requests.filter(r => r.action === 'notify').map(r => r.allowed)).toEqual([true]);
  await expect(page.getByRole('heading', { name: 'You’re on the waitlist.' })).toBeVisible();
  expect(requests.some(r => r.action === 'register/options')).toBe(false);
});

test('a verified write grant from another Telegram launch cannot skip the native permission check', async ({ page }) => {
  const { requests } = await mount(page, '/', { state: 'waiting', hasCredential: false, telegramWriteAllowed: true });
  await expect(page.getByRole('button', { name: 'Allow Telegram invites' })).toBeVisible();
  await page.evaluate(() => {
    (window as any).Telegram.WebApp.initData = 'user=%7B%22id%22%3A67890%7D&hash=another-fixture';
    (window as any).Telegram.WebApp.requestWriteAccess = (callback: (allowed: boolean) => void) => {
      (window as any).client.changedLaunchPrompt = true; callback(false);
    };
  });
  await page.getByRole('button', { name: 'Allow Telegram invites' }).click();
  await expect.poll(() => readClient(page, 'changedLaunchPrompt')).toBe(true);
  await expect.poll(() => requests.filter(r => r.action === 'notify').length).toBe(1);
  expect(requests.find(r => r.action === 'notify')).toMatchObject({ allowed: false, launchData: 'user=%7B%22id%22%3A67890%7D&hash=another-fixture' });
  await expect(page.getByText('Your invite will arrive in this Telegram chat.')).toHaveCount(0);
});

for (const [delivery, heading] of [
  ['pending', 'Email queued.'], ['accepted', 'Check your inbox.'], ['failed', 'Email couldn’t be sent.'],
  ['uncertain', 'Email status unconfirmed.'], ['unknown', 'Confirmation requested.'],
] as const) test(`email ${delivery} is presented truthfully and retry is explicit`, async ({ page }) => {
  const { requests } = await mount(page, '/', { state: 'waiting', hasCredential: false,
    ...(delivery === 'unknown' ? {} : { emailDelivery: { state: delivery, retryAfterMs: delivery === 'pending' ? 1000 : null } }) });
  await page.getByRole('button', { name: 'Use email instead' }).click();
  await page.getByLabel('Email address', { exact: true }).fill('person@example.com');
  await page.getByRole('button', { name: 'Send confirmation link' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  expect(requests.filter(r => r.action === 'email/request')).toHaveLength(1);
  expect(requests.filter(r => r.action === 'email/retry')).toHaveLength(0);
  if (delivery !== 'accepted') await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toHaveCount(0);
  if (delivery === 'failed' || delivery === 'uncertain') {
    await page.getByRole('button', { name: delivery === 'failed' ? 'Try again' : 'Request another email', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Email queued.' })).toBeVisible();
    expect(requests.filter(r => r.action === 'email/retry')).toHaveLength(1);
  }
});

test('flag selects the passkey context, and disconnect never auto-reconnects', async ({ page }) => {
  const { requests, errors } = await mount(page);
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  const descriptor = await page.evaluate(async () => {
    const wallet = (window as any).client.wallet;
    const provider = await wallet.selectedWallet.getEthereumProvider();
    const accounts = await provider.request({ method: 'eth_accounts' });
    let rejected = false; try { await provider.request({ method: 'eth_sendTransaction', params: [] }); } catch { rejected = true; }
    return { type: wallet.selectedWallet.walletClientType, accounts, rejected };
  });
  expect(descriptor).toEqual({ type: 'telegram-passkey', accounts: [FROM], rejected: true });
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.locator('[data-wallet-authenticated="false"]')).toHaveAttribute('data-wallet-address', '');
  await expect(page.getByRole('navigation', { name: 'App navigation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Telegram wallet', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wallet disconnected.' })).toHaveCount(0);
  const count = requests.length;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(requests).toHaveLength(count);
  expect(errors).toEqual([]);
});

test('explicit Telegram disconnect survives reload and fresh launch until verified explicit reconnect', async ({ page }) => {
  const fixture: Fixture = {};
  const { requests, reload, errors } = await mount(page, '/', fixture);
  await expect(page.locator('[data-wallet-authenticated="true"]')).toBeVisible();
  await page.evaluate(() => { (window as any).oldWallet = (window as any).client.wallet; });
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  expect(await page.evaluate(async () => {
    try { await (window as any).oldWallet.selectedWallet.getEthereumProvider(); return false; } catch { return true; }
  })).toBe(true);
  fixture.launchData = 'user=%7B%22id%22%3A12345%7D&auth_date=2&hash=fresh-fixture';
  await reload();
  await expect(page.locator('[data-wallet-authenticated="false"]')).toHaveAttribute('data-wallet-address', '');
  await expect(page.getByRole('navigation', { name: 'App navigation' })).toBeVisible();
  expect(requests.map(r => r.action)).toEqual(['status', 'transaction/status', 'status']);
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:telegram-wallet-disconnected:v1:12345'))).toBe('1');
  const access = heldResponse(), recovery = heldResponse();
  fixture.deferStatus = access.promise; fixture.deferRecovery = recovery.promise;
  fixture.wallet = { id: 'wallet-new', address: TO };
  try {
    await page.getByRole('button', { name: 'Connect Telegram wallet', exact: true }).click();
    await expect.poll(() => requests.filter(r => r.action === 'status').length).toBe(3);
    await expect(page.locator('[data-wallet-authenticated="false"]')).toHaveAttribute('data-wallet-address', '');
    access.release();
    await expect.poll(() => requests.filter(r => r.action === 'transaction/status').length).toBe(2);
    await expect(page.locator('[data-wallet-authenticated="false"]')).toHaveAttribute('data-wallet-address', '');
    expect(await page.evaluate(() => localStorage.getItem('fxaeon:telegram-wallet-disconnected:v1:12345'))).toBe('1');
    recovery.release();
    await expect(page.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', TO);
    expect(await page.evaluate(() => localStorage.getItem('fxaeon:telegram-wallet-disconnected:v1:12345'))).toBeNull();
    await reload();
    await expect(page.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', TO);
    expect(await readClient(page, 'ceremonies')).toEqual([]);
    expect(errors).toEqual([]);
  } finally { access.release(); recovery.release(); }
});

test('explicit Telegram disconnect survives closing and reopening the miniapp on a public route', async ({ page, context }) => {
  await mount(page);
  await expect(page.locator('[data-wallet-authenticated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.locator('[data-wallet-authenticated="false"]')).toBeVisible();
  await page.close();
  const reopened = await context.newPage();
  try {
    const { requests, errors } = await mount(reopened, '/trade', { launchData: 'user=%7B%22id%22%3A12345%7D&auth_date=3&hash=reopened-fixture' });
    await expect(reopened.locator('[data-wallet-authenticated="false"]')).toHaveAttribute('data-wallet-address', '');
    await expect(reopened.getByRole('navigation', { name: 'App navigation' })).toBeVisible();
    await expect(reopened.getByRole('heading', { name: 'Wallet disconnected.' })).toHaveCount(0);
    expect(requests.map(r => r.action)).toEqual(['status']);
    await reopened.getByRole('button', { name: 'Connect Telegram wallet', exact: true }).click();
    await expect(reopened.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', FROM);
    expect(requests.map(r => r.action)).toEqual(['status', 'status', 'transaction/status']);
    expect(errors).toEqual([]);
  } finally { await reopened.close(); }
});

for (const failure of ['setItem', 'removeItem', 'getItem'] as const) test(`explicit Telegram disconnect honors document choice when storage ${failure} fails`, async ({ page }) => {
  const { requests, errors } = await mount(page);
  await expect(page.locator('[data-wallet-authenticated="true"]')).toBeVisible();
  await page.evaluate(method => {
    if (method === 'getItem') {
      const native = Storage.prototype.getItem;
      Storage.prototype.getItem = function(key: string) {
        if (key.startsWith('fxaeon:telegram-wallet-disconnected:')) throw new DOMException('Read denied', 'SecurityError');
        return native.call(this, key);
      };
      return;
    }
    const native = Storage.prototype[method];
    Storage.prototype[method] = function(key: string, ...args: string[]) {
      if (key.startsWith('fxaeon:telegram-wallet-disconnected:')) throw new DOMException('Write denied', 'QuotaExceededError');
      return (native as (...args: string[]) => void).call(this, key, ...args);
    };
  }, failure);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.locator('[data-wallet-authenticated="false"]')).toBeVisible();
  if (failure === 'removeItem') {
    await page.getByRole('button', { name: 'Connect Telegram wallet', exact: true }).click();
    await expect(page.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', FROM);
  }
  await page.evaluate(() => {
    (window as any).Telegram.WebApp.initData += '&auth_date=5';
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator(`[data-wallet-authenticated="${failure === 'removeItem'}"]`)).toHaveAttribute('data-wallet-address', failure === 'removeItem' ? FROM : '');
  expect(requests.filter(r => r.action === 'status')).toHaveLength(failure === 'removeItem' ? 3 : 2);
  expect(errors).toEqual([]);
});

test('explicit Telegram disconnect is scoped to identity and survives switching back', async ({ page }) => {
  const fixture: Fixture = {};
  const { requests, errors } = await mount(page, '/', fixture);
  await expect(page.locator('[data-wallet-authenticated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.locator('[data-wallet-authenticated="false"]')).toBeVisible();
  fixture.wallet = { id: 'wallet-2', address: TO };
  await page.evaluate(() => {
    (window as any).Telegram.WebApp.initData = 'user=%7B%22id%22%3A67890%7D&hash=second-fixture';
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('[data-wallet-authenticated="true"]')).toHaveAttribute('data-wallet-address', TO);
  fixture.wallet = wallet;
  await page.evaluate(() => {
    (window as any).Telegram.WebApp.initData = 'user=%7B%22id%22%3A12345%7D&auth_date=4&hash=return-fixture';
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('[data-wallet-authenticated="false"]')).toHaveAttribute('data-wallet-address', '');
  expect(requests.filter(r => r.action === 'status')).toHaveLength(3);
  expect(requests.filter(r => r.action === 'transaction/status')).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('failed explicit reconnect preserves the opt-out and browsable disconnected context', async ({ page }) => {
  const fixture: Fixture = {};
  const { reload } = await mount(page, '/', fixture);
  await expect(page.locator('[data-wallet-authenticated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  fixture.failStatus = true;
  await page.getByRole('button', { name: 'Connect Telegram wallet', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-wallet-authenticated="false"]')).toHaveAttribute('data-wallet-address', '');
  await expect(page.getByRole('navigation', { name: 'App navigation' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:telegram-wallet-disconnected:v1:12345'))).toBe('1');
  fixture.failStatus = false;
  await reload();
  await expect(page.locator('[data-wallet-authenticated="false"]')).toHaveAttribute('data-wallet-address', '');
});

for (const outcome of ['waiting', 'launch_rejected', 'launch_expired']) test(`a disconnect preference cannot bypass server ${outcome}`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fxaeon:telegram-wallet-disconnected:v1:12345', '1'));
  const { requests, errors } = await mount(page, '/', outcome === 'waiting'
    ? { state: 'waiting', wallet: undefined, hasCredential: false }
    : { statusError: outcome });
  await expect(page.locator('[data-admission-state]')).toBeVisible();
  await expect(page.locator('[data-wallet-authenticated]')).toHaveCount(0);
  expect(requests.map(r => r.action)).toEqual(['status']);
  expect(errors).toEqual([]);
});

test('intro and full follow cohortFull; bound credentials only call wallet/retry', async ({ page }) => {
  const intro = await mount(page, '/', { state: 'new', hasCredential: false, cohortFull: false });
  await expect(page.getByRole('heading', { name: 'Join early access.' })).toBeVisible();
  expect(intro.requests.map(r => r.action)).toEqual(['status']);
  await page.unrouteAll();
  await mount(page, '/', { state: 'new', hasCredential: false, cohortFull: true });
  await expect(page.getByRole('heading', { name: 'Early access is full.' })).toBeVisible();
  await page.unrouteAll();
  const bound = await mount(page, '/', { state: 'approved', hasCredential: true });
  await page.getByRole('button', { name: 'Set up my wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
  expect(bound.requests.map(r => r.action)).toEqual(['status', 'status', 'wallet/retry', 'transaction/status']);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
});

test('signing waits for review and a second explicit passkey click, preserving exact quantities', async ({ page }) => {
  const { requests, errors } = await mount(page);
  await page.getByRole('button', { name: 'Review and send' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(TO);
  expect(requests.map(r => r.action)).toEqual(['status', 'transaction/status']);
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect.poll(() => readClient(page, 'results')).toEqual([{ hash: HASH }]);
  expect(requests.find(r => r.action === 'sign/options').transaction).toEqual(transaction);
  expect(requests.filter(r => r.action === 'sign/complete')).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const mobile of [false, true]) test(`changed recipient is rejected before ${mobile ? 'handoff' : 'WebAuthn'}`, async ({ page }) => {
  const { requests } = await mount(page, '/', { tamper: true, mobile });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: mobile ? 'Continue in browser' : 'Approve with passkey', exact: true }).click();
  await expect.poll(() => readClient(page, 'results')).toHaveLength(1);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  expect(await readClient(page, 'links')).toEqual([]);
  expect(requests.map(r => r.action)).toEqual(['status', 'transaction/status', 'sign/options']);
});

test('a network change while options are pending prevents late approval', async ({ page }) => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const { requests } = await mount(page, '/', { deferSignOptions: wait });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect.poll(() => requests.some(r => r.action === 'sign/options')).toBe(true);
  await page.evaluate(() => (window as any).client.wallet.switchChain(8453));
  release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  expect(requests.some(r => r.action === 'sign/complete')).toBe(false);
});

test('unknown submission blocks later resubmission', async ({ page }) => {
  const { requests } = await mount(page, '/', { failComplete: true });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect.poll(() => readClient(page, 'results')).toHaveLength(1);
  await page.evaluate(async transaction => {
    try { await (window as any).client.wallet.sendTransaction(transaction); }
    catch (error) { (window as any).client.results.push({ error: String(error) }); }
  }, transaction);
  await expect.poll(() => readClient(page, 'results')).toHaveLength(2);
  expect(requests.filter(r => r.action === 'sign/complete')).toHaveLength(1);
  expect(requests.filter(r => r.action === 'sign/options')).toHaveLength(1);
});

test('explicit Telegram disconnect preserves unresolved transaction recovery until reconnect', async ({ page }) => {
  const { requests, reload } = await mount(page, '/', { failComplete: true });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect.poll(() => readClient(page, 'results')).toHaveLength(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.locator('[data-wallet-authenticated="false"]')).toHaveAttribute('data-wallet-address', '');
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:passkey-operation:v1:12345:wallet-1'))).toContain('sign-1');
  const recovered = requests.filter(r => r.action === 'transaction/status').length;
  await reload();
  await expect(page.locator('[data-wallet-authenticated="false"]')).toHaveAttribute('data-wallet-address', '');
  expect(requests.filter(r => r.action === 'transaction/status')).toHaveLength(recovered);
  await page.getByRole('button', { name: 'Connect Telegram wallet', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transaction submitted.' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(HASH);
  expect(requests.filter(r => r.action === 'transaction/status').at(-1)).toMatchObject({ id: 'sign-1' });
  expect(requests.filter(r => r.action === 'sign/options')).toHaveLength(1);
  expect(requests.filter(r => r.action === 'transaction/ack')).toHaveLength(0);
});

test('a lost success response recovers the original hash after reload and requires acknowledgment', async ({ page }) => {
  const { requests, reload } = await mount(page, '/', { failComplete: true });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect.poll(() => readClient(page, 'results')).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:passkey-operation:v1:12345:wallet-1'))).toContain('sign-1');
  await reload();
  await expect(page.getByRole('heading', { name: 'Transaction submitted.' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(HASH);
  expect(requests.filter(r => r.action === 'transaction/ack')).toHaveLength(0);
  expect(requests.filter(r => r.action === 'sign/options')).toHaveLength(1);
  await page.getByRole('button', { name: 'I’ve reviewed this transaction' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests.filter(r => r.action === 'transaction/ack')).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:passkey-operation:v1:12345:wallet-1'))).toBeNull();
});

test('normal results acknowledge only after the app durably journals the exact transaction', async ({ page }) => {
  const { requests } = await mount(page, '/', { durableReceipt: true });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect.poll(() => requests.filter(r => r.action === 'transaction/ack').length).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await readClient(page, 'results')).toEqual([{ hash: HASH }]);
  expect(requests.findIndex(r => r.action === 'transaction/ack')).toBeGreaterThan(requests.findIndex(r => r.action === 'sign/complete'));
});

test('mobile opens only the ticket, and stopping polling never starts native signing', async ({ page }) => {
  const { requests } = await mount(page, '/', { mobile: true });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Continue in browser' }).click();
  await openPreparedBrowser(page);
  await expect.poll(() => readClient(page, 'links')).toHaveLength(1);
  const handoffUrl = new URL((await readClient(page, 'links'))[0]);
  expect(handoffUrl.origin + handoffUrl.pathname).toBe('https://fxaeon.test/wallet-approval');
  expect(new URLSearchParams(handoffUrl.hash.slice(1)).get('commitment')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await page.getByRole('button', { name: 'Stop waiting' }).click();
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  expect(requests.some(r => r.action === 'sign/complete')).toBe(false);
});

for (const kind of ['register', 'sign'] as const) test(`mobile ${kind} handoff preserves the Telegram openLink receiver`, async ({ page }) => {
  const { requests } = await mount(page, '/', { mobile: true,
    ...(kind === 'register' ? { state: 'approved', hasCredential: false } : {}) });
  await page.evaluate(() => {
    const webApp = (window as any).Telegram.WebApp;
    webApp.openLink = function (this: unknown, url: string, options: unknown) {
      if (this !== webApp) throw new Error('Detached Telegram openLink');
      (window as any).client.openLinkOptions = options;
      (window as any).client.links.push(url);
    };
  });
  if (kind === 'register') {
    await expect.poll(() => requests.some(r => r.action === 'handoff/create')).toBe(true);
    await page.getByRole('button', { name: 'Set up my wallet' }).click();
  } else {
    await page.getByRole('button', { name: 'Review and send' }).click();
    expect(requests.some(r => r.action === 'handoff/create')).toBe(false);
    await page.getByRole('button', { name: 'Continue in browser' }).click();
    await openPreparedBrowser(page);
  }
  await expect.poll(() => readClient(page, 'links')).toHaveLength(1);
  expect(await readClient(page, 'openLinkOptions')).toEqual({ try_instant_view: false });
  const url = new URL((await readClient(page, 'links'))[0]);
  expect(url.origin + url.pathname).toBe('https://fxaeon.test/wallet-approval');
  expect(new URLSearchParams(url.hash.slice(1)).get('commitment')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  await page.getByRole('button', { name: 'Stop waiting' }).click();
  expect(requests.some(r => r.action === `${kind}/complete`)).toBe(false);
});

for (const kind of ['sign'] as Array<'register' | 'sign'>) for (const change of ['cancel', 'account', 'doubletap', 'expiry'] as const) {
  test(`prepared ${kind} browser ticket handles ${change} before opening`, async ({ page }) => {
    const { requests } = await mount(page, '/', { mobile: true,
      ...(kind === 'register' ? { state: 'approved', hasCredential: false } : {}) });
    await page.getByRole('button', { name: kind === 'register' ? 'Set up my wallet' : 'Review and send' }).click();
    await page.getByRole('button', { name: 'Continue in browser' }).click();
    await expect(page.getByText('Ready to open your browser.')).toBeVisible();
    expect(await readClient(page, 'links')).toEqual([]);
    const button = await page.getByRole('button', { name: 'Continue in browser' }).elementHandle();
    if (change === 'cancel') await page.getByRole('button', { name: kind === 'register' ? 'Back' : 'Cancel', exact: true }).click();
    if (change === 'account') await page.evaluate(() => { (window as any).Telegram.WebApp.initData += '&changed=1'; });
    // Jump wall time without firing timers: the final click must enforce expiry.
    if (change === 'expiry') await page.evaluate(() => { const expired = Date.now() + 300_001; Date.now = () => expired; });
    await button!.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    if (change === 'doubletap') {
      await expect.poll(() => readClient(page, 'links')).toHaveLength(1);
      await expect.poll(() => requests.some(request => request.action === 'handoff/status')).toBe(true);
      await page.getByRole('button', { name: 'Stop waiting' }).click();
    } else {
      await expect(page.getByText('Ready to open your browser.')).toHaveCount(0);
      expect(await readClient(page, 'links')).toEqual([]);
      expect(requests.some(request => request.action === 'handoff/status')).toBe(false);
    }
    expect(requests.filter(request => request.action === 'handoff/create')).toHaveLength(1);
    expect(await readClient(page, 'ceremonies')).toEqual([]);
    expect(requests.some(request => request.action === `${kind}/complete`)).toBe(false);
  });
}

for (const kind of ['sign'] as Array<'register' | 'sign'>) test(`slow ${kind} preparation cannot extend the original challenge deadline`, async ({ page }) => {
  let release!: () => void;
  const deferHandoff = new Promise<void>(resolve => { release = resolve; });
  const { requests } = await mount(page, '/', { mobile: true, deferHandoff,
    ...(kind === 'register' ? { state: 'approved', hasCredential: false } : {}) });
  await page.getByRole('button', { name: kind === 'register' ? 'Set up my wallet' : 'Review and send' }).click();
  await page.getByRole('button', { name: 'Continue in browser' }).click();
  await expect.poll(() => requests.some(request => request.action === 'handoff/create')).toBe(true);
  await page.evaluate(() => { const later = Date.now() + 240_000; Date.now = () => later; });
  release();
  await expect(page.getByText('Ready to open your browser.')).toBeVisible();
  await page.evaluate(() => { const expired = Date.now() + 60_001; Date.now = () => expired; });
  await page.getByRole('button', { name: 'Continue in browser' }).click();
  await expect(page.getByText('Ready to open your browser.')).toHaveCount(0);
  expect(await readClient(page, 'links')).toEqual([]);
  expect(requests.some(request => request.action === 'handoff/status')).toBe(false);
});

test('prepared signing ticket is invalidated by a network change', async ({ page }) => {
  const { requests } = await mount(page, '/', { mobile: true });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Continue in browser' }).click();
  await expect(page.getByText('Ready to open your browser.')).toBeVisible();
  const button = await page.getByRole('button', { name: 'Continue in browser' }).elementHandle();
  await page.evaluate(() => (window as any).client.wallet.switchChain(8453));
  await button!.evaluate(element => (element as HTMLButtonElement).click());
  expect(await readClient(page, 'links')).toEqual([]);
  expect(requests.some(request => request.action === 'handoff/status')).toBe(false);
});

test('reload during prepared WebAuthn clears only after exact empty lookup and checks current pending', async ({ page }) => {
  const { requests, reload } = await mount(page);
  await page.evaluate(() => { (window as any).client.deferAuth = true; });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect.poll(() => readClient(page, 'ceremonies')).toHaveLength(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fxaeon:passkey-operation:v1:12345:wallet-1')!)))
    .toEqual({ challengeId: 'sign-1', phase: 'prepared' });
  expect(requests.some(r => r.action === 'sign/complete' || r.action === 'handoff/create')).toBe(false);
  const beforeReload = requests.length;
  await reload();
  await expect(page.getByRole('button', { name: 'Review and send' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const lookups = requests.slice(beforeReload).filter(r => r.action === 'transaction/status');
  expect(lookups.map(r => r.id)).toEqual(['sign-1', undefined]);
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:passkey-operation:v1:12345:wallet-1'))).toBeNull();
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  await page.getByRole('button', { name: 'Review and send' }).click();
  await expect(page.getByRole('heading', { name: 'Approve transaction.' })).toBeVisible();
});

test('exact rejected proof releases a no-dispatch intent after reload', async ({ page }) => {
  const { requests, reload } = await mount(page, '/', { completionProof: 'rejected', expireComplete: true });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Check your transaction.' })).toBeVisible();
  // The error itself is not proof and must retain the intent until status reconciliation.
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:passkey-operation:v1:12345:wallet-1'))).not.toBeNull();
  await reload();
  await expect(page.getByRole('button', { name: 'Review and send' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests.some(r => r.action === 'transaction/status' && r.id === 'sign-1')).toBe(true);
  expect(requests.filter(r => r.action === 'transaction/ack')).toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:passkey-operation:v1:12345:wallet-1'))).toBeNull();
});

for (const proof of ['empty', 'wrong-id'] as const) test(`expiry plus ${proof} operation lookup never releases an intent`, async ({ page }) => {
  const { requests, reload } = await mount(page, '/', { completionProof: proof, expireComplete: true });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Check your transaction.' })).toBeVisible();
  await reload();
  await expect.poll(() => requests.filter(r => r.action === 'transaction/status' && r.id === 'sign-1').length).toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:passkey-operation:v1:12345:wallet-1'))).not.toBeNull();
  expect(requests.filter(r => r.action === 'sign/options')).toHaveLength(1);
  expect(requests.filter(r => r.action === 'transaction/ack')).toHaveLength(0);
});

test('lost acknowledgment response reconciles only the exact acknowledged submission', async ({ page }) => {
  const { requests, reload } = await mount(page, '/', { durableReceipt: true, loseAck: true });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect.poll(() => requests.filter(r => r.action === 'transaction/ack').length).toBe(1);
  await reload();
  await expect(page.getByRole('button', { name: 'Review and send' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests.some(r => r.action === 'transaction/status' && r.id === 'sign-1')).toBe(true);
  expect(requests.filter(r => r.action === 'transaction/ack')).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:passkey-operation:v1:12345:wallet-1'))).toBeNull();
});

test('browser ticket clears the fragment, displays exact fields and requires a click', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const { requests, errors } = await mount(page, '/wallet-approval#token=opaque-ticket');
  await expect(page.getByRole('button', { name: 'Approve with passkey' })).toBeVisible();
  expect(page.url()).toBe('https://fxaeon.test/wallet-approval');
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  await expect(page.getByRole('region', { name: 'Transaction summary' })).toContainText('Ethereum');
  await expect(page.getByRole('region', { name: 'Transaction summary' })).toContainText('0.000000000000000016 ETH');
  await expect(page.locator('details')).not.toHaveAttribute('open', '');
  expect(await page.getByRole('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('approval-320.png'), fullPage: true });
  await page.getByText('Transaction details', { exact: true }).click();
  await expect(page.locator('details')).toContainText(TO);
  await expect(page.locator('details')).toContainText('0x10');
  await expect(page.locator('details')).toContainText('0x1234');
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Transaction submitted.' })).toBeVisible();
  expect(requests.every(r => r.launchData === undefined)).toBe(true);
  expect(requests.filter(r => r.action === 'handoff/complete')).toHaveLength(1);
  await expect(page.getByRole('link', { name: 'Return to Telegram' })).not.toHaveAttribute('href', /opaque-ticket/);
  expect(errors).toEqual([]);
});

test('browser Cancel records non-submission without requesting a passkey', async ({ page }) => {
  const { requests } = await mount(page, '/wallet-approval#token=opaque-ticket');
  await expect(page.getByRole('button', { name: 'Approve with passkey' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Approval cancelled.');
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  expect(requests.filter(r => r.action === 'handoff/cancel')).toEqual([{ action: 'handoff/cancel', token: 'opaque-ticket' }]);
  expect(requests.some(r => r.action === 'handoff/complete')).toBe(false);
});

test('cancelled browser handoff releases the exact durable hint after reload', async ({ page }) => {
  const { reload, requests } = await mount(page, '/', { mobile: true });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Continue in browser', exact: true }).click();
  await openPreparedBrowser(page);
  await page.evaluate(async () => {
    await fetch('/api/telegram-wallet', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'handoff/cancel', token: 'opaque-ticket' }) });
  });
  await reload();
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests.some(r => r.action === 'transaction/status' && r.id === 'sign-1')).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('fxaeon:passkey-operation:v1:12345:wallet-1'))).toBeNull();
  await page.getByRole('button', { name: 'Review and send' }).click();
  await expect(page.getByRole('heading', { name: 'Approve transaction.' })).toBeVisible();
});

test('cancelled WebAuthn never falls back and the read descriptor remains usable', async ({ page }) => {
  const { requests } = await mount(page);
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.evaluate(() => { (window as any).client.deferAuth = true; });
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect.poll(() => readClient(page, 'ceremonies')).toHaveLength(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const provider = await (window as any).client.wallet.selectedWallet.getEthereumProvider();
    return provider.request({ method: 'eth_accounts' });
  })).toEqual([FROM]);
  expect(requests.some(r => ['sign/complete', 'handoff/create'].includes(r.action))).toBe(false);
});

test('a changed Telegram account after WebAuthn cannot submit the old transaction', async ({ page }) => {
  const { requests } = await mount(page);
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.evaluate(() => { (window as any).client.deferAuth = true; });
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect.poll(() => readClient(page, 'ceremonies')).toHaveLength(1);
  await page.evaluate(() => { (window as any).Telegram.WebApp.initData = 'another-launch'; (window as any).client.resolveAuth(); });
  await expect.poll(() => readClient(page, 'results')).toHaveLength(1);
  expect(requests.some(r => r.action === 'sign/complete')).toBe(false);
  await page.getByRole('button', { name: 'Review and send' }).click();
  await expect.poll(() => readClient(page, 'results')).toHaveLength(2);
  expect(requests.filter(r => r.action === 'sign/options')).toHaveLength(1);
});

test('browser refuses a display transaction that differs from the signed envelope', async ({ page }) => {
  const { requests } = await mount(page, '/wallet-approval#token=opaque-ticket', { tamper: true });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve with passkey' })).toHaveCount(0);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  expect(requests.every(r => r.action === 'handoff/read')).toBe(true);
});

test('browser commitment rejects substitution of both displayed and signed transactions', async ({ page }) => {
  await mount(page, '/wallet-approval#token=opaque-ticket', { substituteHandoff: true });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve with passkey' })).toHaveCount(0);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
});

test('a pending browser handoff stops after five minutes without resubmitting', async ({ page }) => {
  await page.clock.install();
  const { requests } = await mount(page, '/', { mobile: true });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await page.getByRole('button', { name: 'Continue in browser' }).click();
  await openPreparedBrowser(page);
  await expect.poll(() => requests.some(r => r.action === 'handoff/status')).toBe(true);
  await page.clock.fastForward(300_001);
  await expect.poll(() => readClient(page, 'results')).toHaveLength(1);
  expect(requests.filter(r => r.action === 'handoff/create')).toHaveLength(1);
  expect(requests.some(r => r.action === 'sign/complete')).toBe(false);
});

test('email link clears its secret and does not confirm until explicitly clicked', async ({ page }) => {
  const { requests, errors } = await mount(page, '/invite#token=email-secret');
  await expect(page.getByRole('button', { name: 'Confirm email' })).toBeVisible();
  expect(page.url()).toBe('https://fxaeon.test/invite'); expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Confirm email' }).click();
  await expect(page.getByRole('heading', { name: 'Email confirmed.' })).toBeVisible();
  expect(requests).toEqual([{ action: 'email/confirm', token: 'email-secret' }]); expect(errors).toEqual([]);
});
