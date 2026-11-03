import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { main, runWebhookOperator } from './telegram_webhook_operator.mjs';
import { TELEGRAM_WEBHOOK_URL, BOT_COMMANDS, telegramWebhookSecret } from './sync_telegram_bot.mjs';

const token = '123456789:abcdefghijklmnopqrstuvwxyz';
const sentinel = 'PRIVATE_SENTINEL_MUST_NEVER_APPEAR';
const oldUrl = `https://name:password@old.example.test/${sentinel}?secret=${sentinel}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const env = { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_DRY_RUN: 'false' };
const noNetwork = () => assert.fail('Unexpected network request');
function fakeBot(url = oldUrl, { readbackMismatch = false } = {}) {
  const calls = [];
  const state = { getWebhookInfo: { url, pending_update_count: 3, last_error_message: sentinel, ip_address: '192.0.2.1' },
    getMyCommands: [], getChatMenuButton: {} };
  return { calls, state, fetchImpl: async (input, init) => {
    const parsed = new URL(input);
    assert.equal(parsed.origin, 'https://api.telegram.org');
    assert.equal(init.redirect, 'error');
    const method = parsed.pathname.split('/').pop();
    const payload = JSON.parse(init.body);
    calls.push({ method, payload });
    let result;
    if (method === 'setWebhook') {
      state.getWebhookInfo = { url: readbackMismatch ? oldUrl : payload.url, allowed_updates: payload.allowed_updates };
      result = true;
    } else if (method.startsWith('set')) {
      state[method.replace(/^set/, 'get')] = method === 'setMyCommands' ? payload.commands : method === 'setChatMenuButton' ? payload.menu_button : payload;
      result = true;
    } else result = state[method];
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
  } };
}

test('inspection reads only webhook status and emits exact hash, sanitized origin and counts', async () => {
  const fake = fakeBot();
  const logs = [];
  assert.equal(await main(env, { ...fake, log: value => logs.push(value) }), 0);
  assert.deepEqual(fake.calls, [{ method: 'getWebhookInfo', payload: {} }]);
  assert.deepEqual(JSON.parse(logs[0]), { action: 'inspect-webhook', readOnly: true, configured: true,
    origin: 'https://old.example.test', urlSha256: hash(oldUrl), matchesExpected: false, pendingUpdateCount: 3, hasError: true });
  for (const value of [token, sentinel, 'name:', 'password', '192.0.2.1', '?secret', oldUrl]) assert.equal(logs[0].includes(value), false);
});

test('inspection handles empty, owned and IP origins without disclosing IP addresses', async () => {
  for (const [url, origin] of [['', 'none'], [TELEGRAM_WEBHOOK_URL, 'https://fxaeon.com'],
    ['https://192.0.2.1/private', 'redacted-ip-origin'], ['https://[2001:db8::1]/private', 'redacted-ip-origin']]) {
    const result = await runWebhookOperator(env, fakeBot(url));
    assert.equal(result.origin, origin);
    assert.equal(result.urlSha256, hash(url));
    assert.equal(result.configured, url !== '');
    assert.equal(result.matchesExpected, url === TELEGRAM_WEBHOOK_URL);
  }
});

test('default is a credential-free dry run and migration always requires an exact reviewed hash', async () => {
  assert.deepEqual(await runWebhookOperator({}, { fetchImpl: noNetwork }), { action: 'inspect-webhook', dryRun: true });
  for (const dryRun of ['true', 'false']) {
    for (const value of [undefined, '', oldUrl, 'x'.repeat(64), 'a'.repeat(63), 'a'.repeat(64) + '\n']) {
      await assert.rejects(runWebhookOperator({ ...env, TELEGRAM_WEBHOOK_ACTION: 'migrate-webhook',
        TELEGRAM_WEBHOOK_DRY_RUN: dryRun, TELEGRAM_REVIEWED_WEBHOOK_SHA256: value }, { fetchImpl: noNetwork }), /reviewed/);
    }
  }
  assert.deepEqual(await runWebhookOperator({ TELEGRAM_WEBHOOK_ACTION: 'migrate-webhook', TELEGRAM_REVIEWED_WEBHOOK_SHA256: hash(oldUrl) },
    { fetchImpl: noNetwork }), { action: 'migrate-webhook', dryRun: true });
  await assert.rejects(runWebhookOperator({ ...env, TELEGRAM_WEBHOOK_ACTION: 'deleteWebhook' }, { fetchImpl: noNetwork }), /Invalid/);
});

test('changed or unreviewed endpoint stops after the fresh read, with no mutations', async () => {
  for (const actual of [oldUrl + 'changed', '', TELEGRAM_WEBHOOK_URL, undefined, 'not a URL']) {
    const fake = fakeBot();
    fake.state.getWebhookInfo.url = actual;
    await assert.rejects(runWebhookOperator({ ...env, TELEGRAM_WEBHOOK_ACTION: 'migrate-webhook',
      TELEGRAM_REVIEWED_WEBHOOK_SHA256: hash(oldUrl) }, fake));
    assert.deepEqual(fake.calls.map(call => call.method), ['getWebhookInfo']);
  }
});

test('reviewed migration sets only the fixed endpoint, preserves pending updates, authenticates and verifies commands/menu', async () => {
  const fake = fakeBot();
  const logs = [];
  assert.equal(await main({ ...env, TELEGRAM_WEBHOOK_ACTION: 'migrate-webhook', TELEGRAM_REVIEWED_WEBHOOK_SHA256: hash(oldUrl),
    TELEGRAM_WEB_APP_URL: 'https://attacker.test/', TELEGRAM_WEBHOOK_URL: 'https://attacker.test/' },
  { ...fake, log: value => logs.push(value) }), 0);
  assert.deepEqual(fake.calls.slice(0, 3).map(call => call.method), ['getWebhookInfo', 'setWebhook', 'getWebhookInfo']);
  assert.deepEqual(fake.calls[1].payload, { url: TELEGRAM_WEBHOOK_URL, allowed_updates: ['message'],
    secret_token: telegramWebhookSecret(token), max_connections: 4, drop_pending_updates: false });
  assert.deepEqual(fake.state.getMyCommands, BOT_COMMANDS);
  assert.equal(fake.state.getChatMenuButton.web_app.url, 'https://fxaeon.com');
  assert.deepEqual(JSON.parse(logs[0]), { action: 'migrate-webhook', success: true, webhookVerified: true, menuVerified: true });
  for (const value of [token, sentinel, oldUrl, telegramWebhookSecret(token)]) assert.equal(logs[0].includes(value), false);
});

test('failed migration readback stops before commands; failure and dry-run logs never expose unexpected strings', async () => {
  const fake = fakeBot(oldUrl, { readbackMismatch: true });
  const logs = [];
  const migrate = { ...env, TELEGRAM_WEBHOOK_ACTION: 'migrate-webhook', TELEGRAM_REVIEWED_WEBHOOK_SHA256: hash(oldUrl) };
  assert.equal(await main(migrate, { ...fake, errorLog: value => logs.push(value) }), 1);
  assert.deepEqual(fake.calls.map(call => call.method), ['getWebhookInfo', 'setWebhook', 'getWebhookInfo']);
  for (const fetchImpl of [async () => { throw new Error(`${token} ${oldUrl}`); },
    async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { url: sentinel } }) })]) {
    assert.equal(await main(env, { fetchImpl, errorLog: value => logs.push(value) }), 1);
  }
  assert.ok(logs.every(value => value === 'Webhook operation failed; inspect configuration before retrying.'));
  const dryLogs = [];
  assert.equal(await main({ ...migrate, TELEGRAM_WEBHOOK_DRY_RUN: 'true' }, { fetchImpl: noNetwork, log: value => dryLogs.push(value) }), 0);
  assert.deepEqual(dryLogs, ['{"action":"migrate-webhook","dryRun":true}']);
});

test('workflow exposes inspection and reviewed migration only on manual main, with isolated secrets and production lock', () => {
  const workflow = readFileSync(new URL('../.github/workflows/miniapp-access.yml', import.meta.url), 'utf8');
  assert.match(workflow, /default: status/);
  assert.match(workflow, /dry_run:[\s\S]*?default: true/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /group: fxaeon-production/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /- inspect-webhook\s+- migrate-webhook/);
  assert.match(workflow, /reviewed_webhook_sha256:/);
  const step = workflow.split('      - name: Inspect or migrate reviewed Telegram webhook')[1].split('      - name:')[0];
  assert.match(step, /github\.event_name == 'workflow_dispatch' && !inputs\.dry_run/);
  assert.match(step, /TELEGRAM_REVIEWED_WEBHOOK_SHA256: \$\{\{ inputs\.reviewed_webhook_sha256 \}\}/);
  assert.deepEqual([...step.matchAll(/secrets\.([A-Z_]+)/g)].map(match => match[1]), ['TELEGRAM_BOT_TOKEN']);
  const plan = workflow.split('      - name: Plan webhook operation without credentials')[1].split('      - name:')[0];
  assert.doesNotMatch(plan, /secrets\./);
  for (const line of workflow.split('\n').filter(line => line.trim().startsWith('run:'))) assert.doesNotMatch(line, /\$\{\{/);
  for (const name of ['Plan manual action', 'Run authenticated operator action']) {
    const step = workflow.split(`      - name: ${name}`)[1].split('      - name:')[0];
    assert.match(step, /inputs\.action != 'inspect-webhook' && inputs\.action != 'migrate-webhook'/);
  }
});
