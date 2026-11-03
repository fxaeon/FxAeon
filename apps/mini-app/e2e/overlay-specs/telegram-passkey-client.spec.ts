import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const app = resolve(__dirname, '../..');
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
    'next/dynamic': `import React from 'react';export default loader => {const C=React.lazy(loader);return props => <React.Suspense fallback={<p>Loading</p>}><C {...props}/></React.Suspense>};`,
    'next/navigation': `export const usePathname=()=>location.pathname;export const useRouter=()=>({replace:path=>history.replaceState({},'',path)});`,
    '@/components/PrivyClientProvider': `throw new Error('PRIVY_NATIVE_LOADED');export default ()=>null;`,
    '@/components/WalletRouteProviders': `export default ({children})=><>{children}</>;`,
    '@/lib/wallet': `export const BrowserWalletProvider=({children})=><div data-browser-wallet>{children}</div>;`,
    '@/lib/fx/clients': `export const getPublicClient=()=>({request:async args=>{window.client.reads.push(args);return '0x1'}});`,
    '@/lib/telegram': `export const getWebApp=()=>window.Telegram?.WebApp;export const waitForTelegramWebApp=async()=>getWebApp();export const hasTelegramMiniAppLaunchData=()=>!!getWebApp()?.initData;export const hasTelegramNativeHostHint=()=>!!getWebApp();export const hasTelegramWebHostHint=()=>false;export const openExternalLink=()=>false;export const haptic=()=>{};`,
    '@simplewebauthn/browser': `const run=kind=>async options=>{window.client.ceremonies.push({kind,options});if(window.client.deferAuth)return new Promise((resolve,reject)=>{window.client.resolveAuth=()=>resolve({id:'fixture-response'});window.client.rejectAuth=reject});return {id:'fixture-response'}};export const startRegistration=run('register');export const startAuthentication=run('sign');export const WebAuthnAbortService={cancelCeremony:()=>{window.client?.rejectAuth?.(new DOMException('Cancelled','AbortError'));}};`,
  };
  const result = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import ClientWalletProvider from './src/components/ClientWalletProvider';
      import {FxWalletContext} from './src/lib/wallet/context';
      import {recordPendingHash} from './src/lib/fx/journal';
      import ApprovalPage from './src/app/wallet-approval/page';import InvitePage from './src/app/invite/page';
      import './src/app/globals.css';
      window.client={ceremonies:[],reads:[],results:[],links:[],deferAuth:false};
      window.Telegram={WebApp:{initData:'user=%7B%22id%22%3A12345%7D&hash=fixture',platform:window.fixturePlatform||'tdesktop',close:()=>{},openLink:url=>window.client.links.push(url),requestWriteAccess:cb=>cb(true)}};
      function Content(){const wallet=React.useContext(FxWalletContext);window.client.wallet=wallet;return <div><h1>Portfolio</h1><button onClick={()=>wallet.sendTransaction(${JSON.stringify(transaction)}).then(r=>{window.client.results.push(r);if(window.fixtureDurableReceipt)recordPendingHash({operation:'sendAsset',walletAddress:${JSON.stringify(FROM)},chainId:1,hash:r.hash,to:${JSON.stringify(TO)},data:'0x1234',value:16n,nonce:2});}).catch(e=>window.client.results.push({error:e.message}))}>Review and send</button><button onClick={()=>wallet.disconnect()}>Disconnect</button><button onClick={()=>wallet.switchChain(8453)}>Change network</button></div>}
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

type Fixture = { state?: string; hasCredential?: boolean; cohortFull?: boolean; tamper?: boolean; mobile?: boolean; failComplete?: boolean; substituteHandoff?: boolean; durableReceipt?: boolean; deferSignOptions?: Promise<void>; completionProof?: 'rejected' | 'empty' | 'wrong-id'; expireComplete?: boolean; loseAck?: boolean };
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
        case 'status': response = { ...status, ...fixture }; break;
        case 'transaction/status': response = { operation: body.id || !operation?.acknowledged ? operation : null }; break;
        case 'transaction/ack':
          expect(body).toMatchObject({ id: operation?.id, hash: operation?.hash });
          if (fixture.loseAck && operation) { operation.acknowledged = true; return route.abort(); }
          operation = null; response = { acknowledged: true }; break;
        case 'join': response = { ...status, state: 'waiting', wallet: undefined }; break;
        case 'notify': response = { ...status, state: 'waiting', telegramNotify: body.allowed, wallet: undefined }; break;
        case 'register/options': response = { challengeId: 'register-1', options: { challenge: 'register-challenge' } }; break;
        case 'register/complete': case 'wallet/retry': response = { state: 'ready', wallet }; break;
        case 'sign/options':
          if (fixture.deferSignOptions) await fixture.deferSignOptions;
          response = { challengeId: 'sign-1', options: { challenge: returnedChallenge } }; break;
        case 'handoff/create': response = { url: 'https://fxaeon.test/wallet-approval#token=opaque-ticket' }; break;
        case 'handoff/status': response = { state: 'pending' }; break;
        case 'handoff/read': response = { kind: 'sign', options: { challenge: returnedChallenge }, transaction: fixture.substituteHandoff ? { ...transaction, to: FROM } : transaction }; break;
        case 'sign/complete': case 'handoff/complete':
          operation = fixture.completionProof === 'empty' ? null : fixture.completionProof ? {
            id: fixture.completionProof === 'wrong-id' ? 'other-intent' : body.challengeId, state: 'rejected', hash: null, chainId: 1, acknowledged: true,
          } : { id: body.challengeId ?? 'sign-1', state: 'submitted', hash: HASH, chainId: 1, acknowledged: false };
          if (fixture.expireComplete) return route.fulfill({ status: 403, json: { error: 'approval_expired' } });
          if (fixture.failComplete) return route.abort();
          response = { hash: HASH }; break;
        case 'email/confirm': response = { verified: true }; break;
        case 'email/request': response = { status: 'verification_requested' }; break;
        default: response = { ok: true };
      }
      return route.fulfill({ json: response });
    }
    if (route.request().resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
    return route.abort();
  });
  const commitment = createHash('sha256').update(Buffer.from(expectedChallenge, 'base64url')).digest('base64url');
  await page.goto(`https://fxaeon.test${path}${path.startsWith('/wallet-approval#') ? `&commitment=${commitment}` : ''}`);
  await page.evaluate(({ mobile, durable }) => { (window as any).fixturePlatform = mobile ? 'ios' : 'tdesktop'; (window as any).fixtureDurableReceipt = durable; }, { mobile: fixture.mobile ?? false, durable: fixture.durableReceipt ?? false });
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  const reload = async () => {
    await page.reload();
    await page.evaluate(mobile => { (window as any).fixturePlatform = mobile ? 'ios' : 'tdesktop'; }, fixture.mobile ?? false);
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  };
  return { requests, errors, reload };
}
const readClient = (page: Page, field: string) => page.evaluate(field => (window as any).client[field], field);

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
  await expect(page.getByRole('heading', { name: 'Wallet disconnected.' })).toBeVisible();
  const count = requests.length;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(requests).toHaveLength(count);
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
  await page.getByRole('button', { name: 'Finish wallet setup' }).click();
  await expect(page.getByRole('heading', { name: 'You’re in.' })).toBeVisible();
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
  await expect.poll(() => readClient(page, 'links')).toHaveLength(1);
  const handoffUrl = new URL((await readClient(page, 'links'))[0]);
  expect(handoffUrl.origin + handoffUrl.pathname).toBe('https://fxaeon.test/wallet-approval');
  expect(new URLSearchParams(handoffUrl.hash.slice(1)).get('commitment')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await page.getByRole('button', { name: 'Stop waiting' }).click();
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  expect(requests.some(r => r.action === 'sign/complete')).toBe(false);
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
