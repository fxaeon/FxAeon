import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Use the pinned Wrangler toolchain. Real workerd + ephemeral D1; every outbound
// request is intercepted, and all credentials/addresses below are synthetic.
const require = createRequire(import.meta.url);
const tooling = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = tooling('miniflare');
const { build } = tooling('esbuild');
const root = fileURLToPath(new URL('../', import.meta.url));
const HASH = `0x${'12'.repeat(32)}`;
const REFERENCE = '11111111-1111-4111-8111-111111111111';

test('workerd native fetch receiver and real notification/Privy transports', async t => {
  const bundled = await build({ stdin: { resolveDir: root, sourcefile: 'runtime-fixture.ts', contents: `
    import { NotificationStore } from './server/miniapp-access/notifications';
    import { PrivyWalletApi } from './server/miniapp-access/privy';
    import { createTelegramBotHandler, telegramWebhookSecret, TELEGRAM_WEBHOOK_URL } from './server/miniapp-access/bot';
    export default { async fetch(request, env) {
      const path = new URL(request.url).pathname;
      if (path === '/receiver') {
        const holder = { send: globalThis.fetch };
        let wrongReceiver;
        try { await holder.send('https://fixture.invalid/'); } catch (error) { wrongReceiver = error.message; }
        const send = holder.send;
        let unsupportedRedirect;
        try { await send('https://fixture.invalid/', { redirect: 'error' }); } catch (error) { unsupportedRedirect = error.message; }
        return Response.json({ wrongReceiver, unsupportedRedirect, unbound: (await send('https://fixture.invalid/')).status });
      }
      if (path === '/notification') {
        await env.DB.prepare('CREATE TABLE admission_users (user_id INTEGER PRIMARY KEY, external_id TEXT, telegram_notify INTEGER)').run();
        await env.DB.prepare('INSERT INTO admission_users VALUES (1, NULL, 0)').run();
        const store = new NotificationStore(env.DB, {
          RESEND_API_KEY: 're_synthetic_never_live', RESEND_FROM: 'Fixture <test@example.com>'
        });
        await store.init();
        await store.setContact(1, 'recipient@example.com');
        return Response.json({ dispatch: await store.dispatch(), delivery: await store.verificationStatus(1) });
      }
      if (path === '/privy') {
        const api = new PrivyWalletApi('testapp000000000000000000', 'synthetic-never-live');
        const wallet = { id: 'wallet-1', address: '0x' + 'ab'.repeat(20), verified: true };
        const prepared = api.prepare(wallet, { to: wallet.address, chainId: 1 }, '${REFERENCE}');
        const hash = await api.submit(prepared, wallet.id, 'webauthn:YQ:Yg:Yw');
        const recovered = await api.reconcile(api.validatePrepared(prepared, wallet.id));
        return Response.json({ hash, recovered });
      }
      if (path === '/bot' || path === '/bot-redirect') {
        const id = path === '/bot' ? 101 : 102;
        const token = '123456789:abcdefghijklmnopqrstuvwxyz';
        const update = { update_id: id, message: { date: Math.floor(Date.now() / 1000), text: '/start',
          entities: [{ type: 'bot_command', offset: 0, length: 6 }],
          chat: { id, type: 'private' }, from: { id, is_bot: false } } };
        const options = { method: 'POST', headers: { 'content-type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': await telegramWebhookSecret(token) }, body: JSON.stringify(update) };
        const handler = createTelegramBotHandler();
        const bindings = { ADMISSION_DB: env.DB, TELEGRAM_BOT_TOKEN: token };
        const first = await handler({ request: new Request(TELEGRAM_WEBHOOK_URL, options), env: bindings });
        const duplicate = await handler({ request: new Request(TELEGRAM_WEBHOOK_URL, options), env: bindings });
        return Response.json({ first: await first.json(), duplicate: await duplicate.json() });
      }
      throw new Error('Unexpected fixture route');
    } };
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const outbound = [];
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-06-09', script: bundled.outputFiles[0].text,
    d1Databases: ['DB'],
    outboundService: async request => {
      const url = new URL(request.url);
      outbound.push({ method: request.method, url: request.url });
      if (url.hostname === 'fixture.invalid') return new Response('stub');
      if (request.url === 'https://api.resend.com/emails' && request.method === 'POST') {
        return Response.json({ id: 'synthetic-email-id' });
      }
      if (request.url === 'https://api.privy.io/v1/wallets/wallet-1/rpc' && request.method === 'POST') {
        return Response.json({ method: 'eth_sendTransaction', data: { hash: HASH, caip2: 'eip155:1' } });
      }
      if (request.url === `https://api.privy.io/v1/transactions?reference_id=${REFERENCE}` && request.method === 'GET') {
        return Response.json({ transactions: [{ id: 'tx-1', reference_id: REFERENCE, wallet_id: 'wallet-1',
          caip2: 'eip155:1', status: 'broadcasted', transaction_hash: HASH }] });
      }
      if (request.url === 'https://api.telegram.org/bot123456789:abcdefghijklmnopqrstuvwxyz/sendMessage' && request.method === 'POST') {
        const body = await request.json();
        return body.chat_id === 102
          ? new Response(null, { status: 307, headers: { location: 'https://blocked-redirect.invalid' } })
          : Response.json({ ok: true, result: { message_id: 1 } });
      }
      throw new Error('Unexpected outbound request: blocked by fixture');
    },
  }));
  t.after(() => runtime.dispose());
  const get = async path => {
    const response = await runtime.dispatchFetch(`https://local.invalid${path}`);
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return JSON.parse(body);
  };
  await t.test('old method-call pattern throws before any outbound request', async () => {
    const result = await get('/receiver');
    assert.match(result.wrongReceiver, /Illegal invocation/);
    assert.match(result.unsupportedRedirect, /Invalid redirect value/);
    assert.equal(result.unbound, 200);
    assert.equal(outbound.length, 1);
  });
  await t.test('NotificationStore default transport reaches stub and records acceptance', async () => {
    assert.deepEqual(await get('/notification'), {
      dispatch: { sent: 1, failed: 0, deferred: 0, uncertain: 0 },
      delivery: { state: 'accepted', retryAfterMs: null },
    });
    assert.equal(outbound.filter(call => call.url === 'https://api.resend.com/emails').length, 1);
  });
  await t.test('Privy default transport works for signed POST and reference GET', async () => {
    assert.deepEqual(await get('/privy'), { hash: HASH, recovered: HASH });
    assert.deepEqual(outbound.slice(-2).map(call => call.method), ['POST', 'GET']);
  });
  for (const path of ['/bot', '/bot-redirect']) {
    await t.test(`bot native fetch sends once and never follows a redirect: ${path}`, async () => {
      const before = outbound.length;
      assert.deepEqual(await get(path), { first: { ok: true }, duplicate: { ok: true } });
      assert.equal(outbound.length - before, 1, 'duplicates and redirects must not create another request');
      assert.equal(new URL(outbound.at(-1).url).hostname, 'api.telegram.org');
    });
  }
});
