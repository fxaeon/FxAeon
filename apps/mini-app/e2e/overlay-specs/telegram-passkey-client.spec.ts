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
    'next/dynamic': `import React from 'react';export default loader => {const C=React.lazy(loader);return props => <React.Suspense fallback={<p>Loading</p>}><C {...props}/></React.Suspense>};`,
    'next/navigation': `export const usePathname=()=>location.pathname;export const useRouter=()=>({replace:path=>history.replaceState({},'',path)});`,
    '@/components/PrivyClientProvider': `throw new Error('PRIVY_NATIVE_LOADED');export default ()=>null;`,
    '@/components/WalletRouteProviders': `export default ({children})=><>{children}</>;`,
    '@/lib/wallet': `export const BrowserWalletProvider=({children})=><div data-browser-wallet>{children}</div>;`,
    '@/lib/fx/clients': `export const getPublicClient=()=>({request:async args=>{window.client.reads.push(args);return '0x1'}});`,
    '@/lib/telegram': `export const getWebApp=()=>window.Telegram?.WebApp;export const waitForTelegramWebApp=()=>window.fixtureBridgeWait||Promise.resolve(getWebApp());export const hasTelegramMiniAppLaunchData=()=>!!getWebApp()?.initData||!!new URLSearchParams(location.hash.slice(1)).get('tgWebAppData');export const hasTelegramNativeHostHint=()=>!!getWebApp()||!!window.fixtureDelayedBridge;export const hasTelegramWebHostHint=()=>false;export const openExternalLink=()=>false;export const haptic=()=>{};`,
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
      if(window.fixtureDelayedBridge){const telegram=window.Telegram;delete window.Telegram;window.fixtureBridgeWait=new Promise(resolve=>{window.client.timeoutBridge=()=>resolve(null);window.client.releaseBridge=()=>{window.Telegram=telegram;resolve(telegram.WebApp)}})}
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

type Fixture = { state?: string; hasCredential?: boolean; cohortFull?: boolean; telegramWriteAllowed?: boolean; tamper?: boolean; mobile?: boolean; delayedBridge?: boolean; failComplete?: boolean; substituteHandoff?: boolean; registerHandoff?: boolean; durableReceipt?: boolean; deferSignOptions?: Promise<void>; deferJoin?: Promise<void>; deferHandoff?: Promise<void>; completionProof?: 'rejected' | 'empty' | 'wrong-id'; expireComplete?: boolean; loseAck?: boolean; emailDelivery?: { state: string; retryAfterMs: number | null } };
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
          response = { url: 'https://fxaeon.test/wallet-approval#token=opaque-ticket' }; break;
        case 'handoff/cancel':
          operation = { id: 'sign-1', state: 'rejected', hash: null, chainId: 1, acknowledged: true };
          response = { cancelled: true }; break;
        case 'handoff/status': response = operation?.state === 'rejected'
          ? { state: 'error', error: 'approval_cancelled' } : { state: 'pending' }; break;
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
  const prefix = Buffer.from(`FxAeon signing handoff v1\0${canonical({ ...transaction, from: transaction.from.toLowerCase() })}\0`);
  const commitment = createHash('sha256').update(prefix).update(Buffer.from(expectedChallenge, 'base64url')).digest('base64url');
  await page.goto(`https://fxaeon.test${path}${path.startsWith('/wallet-approval#') ? `&commitment=${commitment}` : ''}`);
  await page.evaluate(({ mobile, durable, delayedBridge }) => { (window as any).fixturePlatform = mobile ? 'ios' : 'tdesktop'; (window as any).fixtureDurableReceipt = durable; (window as any).fixtureDelayedBridge = delayedBridge; }, { mobile: fixture.mobile ?? false, durable: fixture.durableReceipt ?? false, delayedBridge: fixture.delayedBridge ?? false });
  await page.addStyleTag({ content: `${fixtureFontCss}\n${css}` }); await page.addScriptTag({ content: script });
  const reload = async () => {
    await page.reload();
    await page.evaluate(mobile => { (window as any).fixturePlatform = mobile ? 'ios' : 'tdesktop'; }, fixture.mobile ?? false);
    await page.addStyleTag({ content: `${fixtureFontCss}\n${css}` }); await page.addScriptTag({ content: script });
  };
  return { requests, errors, reload };
}
const readClient = (page: Page, field: string) => page.evaluate(field => (window as any).client[field], field);
async function openPreparedBrowser(page: Page) {
  await expect(page.getByText('Ready to open your browser.', { exact: true })).toBeVisible();
  expect(await readClient(page, 'links')).toEqual([]);
  await page.getByRole('button', { name: 'Continue in browser', exact: true }).click();
}

test('short phone keeps passkey setup reachable and cancellation returns to the invitation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { requests } = await mount(page, '/', { state: 'approved', hasCredential: false, mobile: true });
  await page.getByRole('button', { name: 'Set up my wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Secure your wallet.' })).toBeVisible();
  await expect(page.getByText('Keep your passkey synced or backed up so you can use it again.')).toBeVisible();
  const primary = page.getByRole('button', { name: 'Continue in browser' });
  const back = page.getByRole('button', { name: 'Back' });
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
  await expect(page.getByRole('heading', { name: 'Your place is ready.' })).toBeVisible();
  expect(requests.some(request => request.action === 'register/options')).toBe(false);
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
    await expect(page.getByRole('button', { name: 'Set up my wallet' })).toBeVisible();
    await save('live-invited');
    await page.getByRole('button', { name: 'Set up my wallet' }).click();
    await expect(page.getByRole('button', { name: 'Continue in browser' })).toBeVisible();
    await save('live-passkey');
    await page.getByRole('button', { name: 'Continue in browser' }).click();
    await expect(page.getByText('Ready to open your browser.')).toBeVisible();
    await save('live-browser-prepared');
    await page.getByRole('button', { name: 'Continue in browser' }).click();
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
  await page.getByRole('button', { name: 'Set up my wallet' }).click();
  await expect(page.getByRole('button', { name: 'Continue in browser' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create passkey' })).toHaveCount(0);
  expect(requests.filter(r => r.action === 'status')).toHaveLength(1);
});

for (const kind of ['register', 'sign'] as const) for (const cancel of [false, true]) {
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

for (const kind of ['register', 'sign'] as const) for (const lateMobile of [false, true]) {
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
  await page.getByRole('button', { name: kind === 'register' ? 'Set up my wallet' : 'Review and send' }).click();
  expect(requests.some(r => r.action === 'handoff/create')).toBe(false);
  await page.getByRole('button', { name: 'Continue in browser' }).click();
  await openPreparedBrowser(page);
  await expect.poll(() => readClient(page, 'links')).toHaveLength(1);
  expect(await readClient(page, 'openLinkOptions')).toEqual({ try_instant_view: false });
  const url = new URL((await readClient(page, 'links'))[0]);
  expect(url.origin + url.pathname).toBe('https://fxaeon.test/wallet-approval');
  expect(new URLSearchParams(url.hash.slice(1)).get('commitment')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await readClient(page, 'ceremonies')).toEqual([]);
  await page.getByRole('button', { name: 'Stop waiting' }).click();
  expect(requests.some(r => r.action === `${kind}/complete`)).toBe(false);
});

for (const kind of ['register', 'sign'] as const) for (const change of ['cancel', 'account', 'doubletap', 'expiry'] as const) {
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

for (const kind of ['register', 'sign'] as const) test(`slow ${kind} preparation cannot extend the original challenge deadline`, async ({ page }) => {
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
