import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { main, OPERATOR_URL, parseOptions, runOperator, summarizeOperator } from './miniapp_operator.mjs';
import { AUTH_FLAGS } from './miniapp_readiness.mjs';

const token = 'operator-secret-that-must-never-appear';
const contact = 'private-person@example.test';
const env = { MINIAPP_OPERATOR_TOKEN: token };
const noNetwork = () => { throw new Error('Unexpected network request'); };
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const options = (action, userIds = [], dryRun = false) => ({ action, userIds, dryRun });
const workflow = readFileSync(new URL('../.github/workflows/miniapp-access.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const deployment = readFileSync(new URL('../.github/workflows/deploy-mini-app.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

test('dry-run is the default and approvals require neither credentials nor network to plan', async () => {
  assert.deepEqual(parseOptions(), { action: 'status', userIds: [], dryRun: true });
  const plan = await runOperator(parseOptions(['--action', 'approve', '--user-ids', '[123,456]']), { fetchImpl: noNetwork });
  assert.deepEqual(plan, { action: 'approve', dryRun: true, url: OPERATOR_URL, payload: { action: 'approve', userCount: 2 } });
  for (const action of ['status', 'list', 'approve', 'dispatch']) {
    await assert.rejects(runOperator(options(action, action === 'approve' ? [1] : []), { fetchImpl: noNetwork }), /MINIAPP_OPERATOR_TOKEN/);
  }
  for (const invalid of ['x'.repeat(31), 'x'.repeat(506), `${token}\n`]) {
    await assert.rejects(runOperator(options('dispatch'), { env: { MINIAPP_OPERATOR_TOKEN: invalid }, fetchImpl: noNetwork }), /MINIAPP_OPERATOR_TOKEN/);
  }
});

test('CLI rejects arbitrary URLs, malformed JSON, unsafe identities, duplicate IDs and oversized approval batches', () => {
  for (const args of [
    ['--url', 'https://attacker.test'], ['--action', 'delete'], ['--action'], ['--execute', '--dry-run'],
    ['--action', 'list', '--action', 'approve'], ['--user-ids', '[1]'],
    ...['not json', '{}', '[]', '["123"]', '[0]', '[-1]', '[1.5]', '[9007199254740992]', '[1,1]',
      JSON.stringify(Array.from({ length: 481 }, (_, i) => i + 1))].map(ids => ['--action', 'approve', '--user-ids', ids]),
  ]) assert.throws(() => parseOptions(args));
  const max = Array.from({ length: 480 }, (_, i) => i + 1);
  assert.deepEqual(parseOptions(['--action', 'approve', '--user-ids', JSON.stringify(max)]).userIds, max);
  assert.equal(parseOptions(['--action', 'approve', '--user-ids', '[9007199254740991]']).userIds[0], Number.MAX_SAFE_INTEGER);
  assert.throws(() => parseOptions([], { MINIAPP_OPERATOR_DRY_RUN: 'yes' }), /dry-run/);
});

test('each live action uses the fixed endpoint, POST, bearer auth and exactly the backend payload', async () => {
  for (const action of ['status', 'list', 'approve', 'dispatch']) {
    const calls = [];
    const result = await runOperator(options(action, action === 'approve' ? [123, 456] : []), {
      env: { ...env, MINIAPP_OPERATOR_URL: 'https://attacker.test', MINIAPP_ORIGIN: 'https://attacker.test' },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ users: [{ userId: 123, state: 'approved', email: contact, credential: token }], capacity: { used: 6, legacy: 5, max: 480 } });
      },
    });
    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, 'https://fxaeon.com/api/miniapp-operator');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    assert.equal(init.headers['content-type'], 'application/json');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(init.body), { action: action === 'status' ? 'list' : action, ...(action === 'approve' ? { userIds: [123, 456] } : {}) });
    assert.equal(JSON.stringify(result).includes(contact), false);
    assert.equal(JSON.stringify(result).includes(token), false);
    if (action === 'status') assert.equal(result.users, undefined);
  }
});

test('public logs retain only counts and validated capacity, never IDs, contacts or join timestamps', () => {
  const result = summarizeOperator('list', {
    capacity: { used: 6, legacy: 5, max: 480, email: contact },
    users: [
      { userId: 123, state: 'waiting', joinedAt: 100, email: contact, walletAddress: token, externalId: token },
      { userId: 456, state: contact, joinedAt: token },
      { userId: contact, state: 'approved' },
    ],
    sent: 2, failed: contact, error: token, dispatch: { sent: 2, deferred: 1, messages: [contact] },
  });
  assert.deepEqual(result, { action: 'list', capacity: { used: 6, legacy: 5, max: 480 }, count: 2,
    sent: 2, dispatch: { sent: 2, deferred: 1 } });
  assert.equal(JSON.stringify(result).includes(contact), false);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.doesNotMatch(JSON.stringify(result), /userId|joinedAt|123|456/);
  assert.throws(() => summarizeOperator('list', { ok: false, error: contact }), /unsuccessful/);
});

test('approval response uses the parent handler numeric approved IDs and notification counters', async () => {
  const result = await runOperator(options('approve', [123, 456]), { env, fetchImpl: async () => response({
    approved: [123, 456], capacity: { used: 7, legacy: 5, max: 480 },
    notifications: { sent: 1, failed: 0, deferred: 1, uncertain: 0, destination: contact },
  }) });
  assert.deepEqual(result, { action: 'approve', capacity: { used: 7, legacy: 5, max: 480 }, count: 2,
    notifications: { sent: 1, failed: 0, deferred: 1, uncertain: 0 }, dryRun: false });
});

test('HTTP failures, transport exceptions and invalid JSON cannot expose response contacts or secrets', async () => {
  for (const fetchImpl of [
    async () => new Response(`${token} ${contact}`, { status: 401 }),
    async () => { throw new Error(`${token} ${contact}`); },
    async () => new Response(`${token} ${contact}`, { status: 200 }),
    async () => response({ success: false, error: `${token} ${contact}` }),
  ]) {
    const logs = [];
    const exit = await main(['--execute'], env, { fetchImpl, log: value => logs.push(value), errorLog: value => logs.push(value) });
    assert.equal(exit, 1);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], /private-person|operator-secret/);
  }
});

test('writes have no automatic retry and requests have a bounded deadline', async () => {
  let calls = 0;
  await assert.rejects(runOperator(options('approve', [123]), { env, timeoutMs: 10, fetchImpl: async () => {
    calls++;
    return new Promise(() => {});
  } }), /timed out/);
  assert.equal(calls, 1);
  await assert.rejects(runOperator(options('list'), { env, fetchImpl: async () => new Response('x'.repeat(1_048_577)) }), /exceeds/);
});

const configEnv = () => ({
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'cloudflare-secret-token-value',
  PRIVY_APP_SECRET: 'privy-secret-token-value', RESEND_API_KEY: 'resend-secret-token-value',
  MINIAPP_OPERATOR_TOKEN: token, TELEGRAM_BOT_TOKEN: '123456789:telegram-secret-token-value',
  PRIVY_APP_ID: 'public-privy-app-id-value', MINIAPP_LEGACY_USERS: '5',
});
function cloudflareFixture({ previousLegacy = '5', badReadback = false, replaceBindings = false } = {}) {
  const calls = [];
  let bindings = { MINIAPP_LEGACY_USERS: { type: 'plain_text', value: previousLegacy },
    UNRELATED_SECRET: { type: 'secret_text', value: token } };
  return { calls, bindings: () => structuredClone(bindings), fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'PATCH') {
      bindings = { ...(replaceBindings ? {} : bindings), ...JSON.parse(init.body).deployment_configs.production.env_vars };
      return response({ success: true, result: { privateData: contact } });
    }
    const visible = structuredClone(bindings);
    for (const binding of Object.values(visible)) if (binding.type === 'secret_text') delete binding.value;
    if (badReadback && calls.length > 1) delete visible.PRIVY_APP_SECRET;
    return response({ success: true, result: { name: 'fxaeon', deployment_configs: {
      production: { env_vars: visible, wrangler_config_hash: 'existing-config-hash', d1_databases: { ADMISSION_DB: { id: 'preserve-me' } } },
      preview: { env_vars: { PREVIEW_ONLY: { type: 'plain_text', value: 'preserve-me' } } },
    } } });
  } };
}

test('config dry-run needs an explicit inventory but no secrets, and emits names only', async () => {
  const result = await runOperator(options('sync-server-config', [], true), { env: { MINIAPP_LEGACY_USERS: '5' }, fetchImpl: noNetwork });
  assert.equal(result.mode, 'waitlist');
  assert.equal(result.legacy, 5);
  assert.deepEqual(result.secretNames, ['PRIVY_APP_SECRET', 'RESEND_API_KEY', 'MINIAPP_OPERATOR_TOKEN', 'TELEGRAM_BOT_TOKEN', 'PRIVY_APP_ID']);
  for (const inventory of [undefined, '', '0', '4', '5.5', '481', '05']) {
    await assert.rejects(runOperator(options('sync-server-config', [], true), { env: { MINIAPP_LEGACY_USERS: inventory }, fetchImpl: noNetwork }), /inventory/);
  }
  await assert.rejects(runOperator(options('sync-server-config', [], true), { env: { MINIAPP_LEGACY_USERS: '5', MINIAPP_ACCESS_MODE: 'open' }, fetchImpl: noNetwork }), /waitlist/);
});

test('server config sync patches only production named bindings, preserves config hash and verifies readback', async () => {
  const fake = cloudflareFixture();
  const configured = configEnv();
  const result = await runOperator(options('sync-server-config'), { env: configured, fetchImpl: fake.fetchImpl });
  assert.deepEqual(fake.calls.map(call => call.init.method), ['GET', 'PATCH', 'GET']);
  for (const { url, init } of fake.calls) {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/pages/projects/fxaeon`);
    assert.equal(init.headers.authorization, `Bearer ${configured.CLOUDFLARE_API_TOKEN}`);
    assert.equal(init.redirect, 'error');
  }
  const patch = JSON.parse(fake.calls[1].init.body);
  assert.deepEqual(Object.keys(patch), ['deployment_configs']);
  assert.deepEqual(Object.keys(patch.deployment_configs), ['production']);
  const production = patch.deployment_configs.production;
  assert.equal(production.wrangler_config_hash, 'existing-config-hash');
  const vars = production.env_vars;
  assert.equal(Object.keys(vars).length, 11);
  for (const name of result.secretNames) assert.deepEqual(vars[name], { type: 'secret_text', value: configured[name] });
  assert.deepEqual(vars.MINIAPP_ORIGIN, { type: 'plain_text', value: 'https://fxaeon.com' });
  assert.deepEqual(vars.MINIAPP_ACCESS_MODE, { type: 'plain_text', value: 'waitlist' });
  assert.deepEqual(vars.MINIAPP_LEGACY_USERS, { type: 'plain_text', value: '5' });
  assert.deepEqual(vars.TELEGRAM_MINIAPP_URL, { type: 'plain_text', value: 'https://t.me/FxAeonBot' });
  assert.deepEqual(vars.RESEND_FROM, { type: 'plain_text', value: 'FxAeon <notifications@fxaeon.com>' });
  assert.deepEqual(vars.TELEGRAM_BOT_ID, { type: 'plain_text', value: '123456789' });
  assert.equal(vars.PRIVY_PUBLIC_SIGNUP_DISABLED, undefined);
  assert.equal(vars.UNRELATED_SECRET, undefined);
  assert.equal(fake.bindings().UNRELATED_SECRET.value, token, 'masked existing secret survives without ever being copied into the PATCH');
  assert.equal(JSON.stringify(patch).includes('UNRELATED_SECRET'), false);
  assert.equal(production.d1_databases, undefined);
  assert.equal(result.synced, true);
  for (const name of result.secretNames) assert.equal(JSON.stringify(result).includes(configured[name]), false);
});

test('config readback fails if named-binding PATCH unexpectedly removes an unrelated masked secret', async () => {
  const fake = cloudflareFixture({ replaceBindings: true });
  await assert.rejects(runOperator(options('sync-server-config'), { env: configEnv(), fetchImpl: fake.fetchImpl }), /Unrelated Pages bindings changed/);
  assert.equal(fake.calls.filter(call => call.init.method === 'PATCH').length, 1, 'never blindly retries a partial config mutation');
});

test('later passkey setup requires a deliberate review marker; default setup never sets it', async () => {
  const configured = { ...configEnv(), PRIVY_APP_ID: 'syntheticapp0000000000000', MINIAPP_ACCESS_MODE: 'passkey', MINIAPP_EXPECTED_WALLETS: '2' };
  await assert.rejects(runOperator(options('sync-server-config'), { env: configured, fetchImpl: noNetwork }), /verification/);
  const fake = activationFixture(configured);
  const result = await runOperator(options('sync-server-config'), {
    env: { ...configured, PRIVY_PUBLIC_SIGNUP_DISABLED: 'yes' }, fetchImpl: fake.fetchImpl,
  });
  assert.equal(result.mode, 'passkey');
  const vars = JSON.parse(fake.calls[1].init.body).deployment_configs.production.env_vars;
  assert.deepEqual(vars.MINIAPP_ACCESS_MODE, { type: 'plain_text', value: 'passkey' });
  assert.deepEqual(vars.PRIVY_PUBLIC_SIGNUP_DISABLED, { type: 'plain_text', value: 'yes' });
  assert.ok(fake.providerCalls.length >= 4);
  assert.ok(fake.providerCalls.every(call => call.init.method === 'GET'));
});

function activationFixture(configured, { open = false } = {}) {
  const cloudflare = cloudflareFixture();
  const providerCalls = [];
  return { ...cloudflare, providerCalls, fetchImpl: async (url, init) => {
    if (url.startsWith('https://api.cloudflare.com/')) return cloudflare.fetchImpl(url, init);
    providerCalls.push({ url, init });
    assert.equal(init.method, 'GET');
    const path = new URL(url).pathname;
    if (path.endsWith('/cross-app/connections')) return response({ data_classification: 'public', connections: [] });
    if (path.startsWith('/api/v1/apps/')) return response({ id: configured.PRIVY_APP_ID, data_classification: 'public', custom_api_url: null,
      ...Object.fromEntries(AUTH_FLAGS.map(flag => [flag, false])), telegram_auth: open, custom_oauth_providers: [] });
    if (path === '/v1/users') return response({ data: Array.from({ length: 5 }, (_, i) => ({ id: `did:privy:user-${i}` })), next_cursor: null });
    if (path === '/v1/wallets') return response({ data: [{ id: 'wallet-1', owner_id: null }, { id: 'wallet-2', owner_id: null }], next_cursor: null });
    assert.fail('Unexpected readiness request');
  } };
}

test('even a yes review flag cannot activate while provider signup is open or the wallet inventory is unreviewed', async () => {
  const configured = { ...configEnv(), PRIVY_APP_ID: 'syntheticapp0000000000000', MINIAPP_ACCESS_MODE: 'passkey',
    PRIVY_PUBLIC_SIGNUP_DISABLED: 'yes', MINIAPP_EXPECTED_WALLETS: '2' };
  for (const [overrides, open] of [[{}, true], [{ MINIAPP_EXPECTED_WALLETS: undefined }, false], [{ MINIAPP_EXPECTED_WALLETS: '3' }, false]]) {
    const fake = activationFixture(configured, { open });
    await assert.rejects(runOperator(options('sync-server-config'), { env: { ...configured, ...overrides }, fetchImpl: fake.fetchImpl }), /strict read-only provider check/);
    assert.deepEqual(fake.calls, [], 'failed readiness cannot reach even a Cloudflare config read or write');
  }
});

test('notification config rejects unreviewed launchers or senders before touching Pages', async () => {
  for (const override of [
    { TELEGRAM_MINIAPP_URL: 'https://attacker.test' },
    { TELEGRAM_MINIAPP_URL: 'https://t.me/OtherBot' },
    { RESEND_FROM: 'Someone <other@other.test>' },
  ]) await assert.rejects(runOperator(options('sync-server-config'), { env: { ...configEnv(), ...override }, fetchImpl: noNetwork }), /reviewed/);
});

test('config sync validates every secret before making requests and refuses a reduced baseline', async () => {
  for (const name of ['PRIVY_APP_SECRET', 'RESEND_API_KEY', 'MINIAPP_OPERATOR_TOKEN', 'TELEGRAM_BOT_TOKEN', 'PRIVY_APP_ID', 'CLOUDFLARE_API_TOKEN']) {
    const configured = configEnv();
    delete configured[name];
    await assert.rejects(runOperator(options('sync-server-config'), { env: configured, fetchImpl: noNetwork }), new RegExp(name));
  }
  const fake = cloudflareFixture({ previousLegacy: '6' });
  await assert.rejects(runOperator(options('sync-server-config'), { env: configEnv(), fetchImpl: fake.fetchImpl }), /lower/);
  assert.equal(fake.calls.length, 1);
  const mismatch = cloudflareFixture({ badReadback: true });
  await assert.rejects(runOperator(options('sync-server-config'), { env: configEnv(), fetchImpl: mismatch.fetchImpl }), /readback/);
});

test('workflow is main-only, production-scoped, read-only GitHub permissions and uses existing pinned action SHAs', () => {
  assert.match(workflow, /github\.repository == 'fxaeon\/FxAeon'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /permissions:\n {2}contents: read\n\n/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /pull_request|workflow_run|contents: write|id-token: write|actions: write/);
  for (const [, action, sha] of workflow.matchAll(/uses: ([\w/-]+)@([a-f0-9]{40})/g)) {
    assert.ok(deployment.includes(`uses: ${action}@${sha}`), `${action} matches the repository pin`);
  }
  assert.equal([...workflow.matchAll(/uses:/g)].length, [...workflow.matchAll(/uses: [\w/-]+@[a-f0-9]{40}/g)].length);
});

test('schedule only dispatches retries, manual runs default to dry-run, and inputs never interpolate into shell code', () => {
  assert.match(workflow, /cron: '\*\/15 \* \* \* \*'/);
  assert.match(workflow, /dry_run:[\s\S]*?default: true/);
  assert.match(workflow, /github\.event_name == 'schedule' && 'dispatch' \|\| inputs\.action/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.action == 'approve' && secrets\.MINIAPP_OPERATOR_USER_IDS \|\| '\[\]'/);
  assert.match(workflow, /inputs\.action != 'sync-server-config'/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && !inputs\.dry_run && inputs\.action == 'sync-server-config'/);
  for (const line of workflow.split('\n').filter(line => line.trim().startsWith('run:'))) {
    assert.doesNotMatch(line, /\$\{\{|curl|wget|set -x/);
  }
  const plan = workflow.slice(workflow.indexOf('      - name: Plan manual action'), workflow.indexOf('      - name: Run authenticated'));
  assert.match(plan, /inputs\.action == 'approve' && secrets\.MINIAPP_OPERATOR_USER_IDS \|\| '\[\]'/);
  assert.deepEqual([...plan.matchAll(/secrets\.([A-Z_]+)/g)].map(match => match[1]), ['MINIAPP_OPERATOR_USER_IDS']);
  assert.match(plan, /--dry-run/);
});

test('approval identities never enter public workflow inputs or CLI output, including dry-run and errors', async () => {
  assert.doesNotMatch(workflow, /inputs\.user_ids|^\s+user_ids:/m);
  assert.equal([...workflow.matchAll(/secrets\.MINIAPP_OPERATOR_USER_IDS/g)].length, 2);
  const ids = [734567891, 834567892];
  for (const action of ['status', 'list', 'approve', 'dispatch']) {
    for (const dryRun of [true, false]) {
      const logs = [];
      const requests = [];
      const code = await main(['--action', action, dryRun ? '--dry-run' : '--execute'], {
        ...env, MINIAPP_OPERATOR_USER_IDS: JSON.stringify(action === 'approve' ? ids : []),
      }, {
        log: value => logs.push(value), errorLog: value => logs.push(value),
        fetchImpl: async (_url, init) => {
          requests.push(JSON.parse(init.body));
          return response({ users: ids.map(userId => ({ userId, email: contact, joinedAt: 1793690000000 })),
            approved: ids, sent: 2, error: `${token} ${contact}` });
        },
      });
      assert.equal(code, 0);
      for (const value of [...ids.map(String), contact, token, 'joinedAt', 'userIds', 'users']) {
        assert.equal(logs.join('\n').includes(value), false, `${action} dryRun=${dryRun} leaked a private field`);
      }
      if (!dryRun && action === 'approve') assert.deepEqual(requests[0], { action: 'approve', userIds: ids });
      if (dryRun) assert.deepEqual(requests, []);
    }
  }
  const errors = [];
  const code = await main(['--action', 'approve', '--execute'], { ...env, MINIAPP_OPERATOR_USER_IDS: `[${ids[0]},"private"]` },
    { fetchImpl: noNetwork, errorLog: value => errors.push(value) });
  assert.equal(code, 1);
  assert.equal(errors.join('\n').includes(String(ids[0])), false);
});

test('setup has isolated server secrets, fixed safe variables, required inventory and no implicit activation marker', () => {
  const step = workflow.slice(workflow.indexOf('      - name: Sync server configuration'));
  for (const name of ['PRIVY_APP_SECRET', 'RESEND_API_KEY', 'MINIAPP_OPERATOR_TOKEN', 'TELEGRAM_BOT_TOKEN']) {
    assert.ok(step.includes(`${name}: \${{ secrets.${name} }}`));
  }
  assert.match(step, /PRIVY_APP_ID: \$\{\{ secrets\.NEXT_PUBLIC_PRIVY_APP_ID \}\}/);
  assert.match(step, /MINIAPP_LEGACY_USERS: \$\{\{ vars\.MINIAPP_LEGACY_USERS \}\}/);
  assert.match(step, /MINIAPP_ACCESS_MODE: \$\{\{ inputs\.server_mode \|\| 'waitlist' \}\}/);
  assert.match(step, /PRIVY_PUBLIC_SIGNUP_DISABLED: \$\{\{ vars\.PRIVY_PUBLIC_SIGNUP_DISABLED \}\}/);
  assert.match(step, /MINIAPP_EXPECTED_WALLETS: \$\{\{ vars\.MINIAPP_EXPECTED_WALLETS \}\}/);
  assert.match(step, /MINIAPP_ORIGIN: https:\/\/fxaeon\.com/);
  assert.doesNotMatch(workflow, /^\s*PRIVY_PUBLIC_SIGNUP_DISABLED:\s*['"]?yes/m);
  assert.doesNotMatch(workflow, /pnpm install|npm install|pages deploy|wrangler deploy/);
});

test('manual activation uses an explicit mode choice only for config sync and retains the waitlist default', () => {
  assert.match(workflow, /server_mode:[\s\S]*?type: choice[\s\S]*?default: waitlist[\s\S]*?options:\s+- waitlist\s+- passkey/);
  const start = workflow.indexOf('      - name: Run authenticated operator action');
  const end = workflow.indexOf('      - name:', start + 1);
  const operator = workflow.slice(start, end);
  assert.doesNotMatch(operator, /server_mode|MINIAPP_ACCESS_MODE|PRIVY_PUBLIC_SIGNUP_DISABLED/);
  const script = readFileSync(new URL('./miniapp_operator.mjs', import.meta.url), 'utf8');
  assert.match(script, /mode === 'passkey' && env\.PRIVY_PUBLIC_SIGNUP_DISABLED !== 'yes'/);
  assert.match(script, /probeReadiness\(\{ env, fetchImpl, requireClosed: true/);
  assert.ok(script.indexOf('probeReadiness({ env, fetchImpl, requireClosed: true') < script.indexOf("method: 'PATCH'"));
});

test('readiness is a separate manual read-only action with scoped credentials and no activation writes', () => {
  assert.match(workflow, /- check-readiness/);
  const start = workflow.indexOf('      - name: Check read-only provider readiness');
  const end = workflow.indexOf('      - name:', start + 1);
  const check = workflow.slice(start, end < 0 ? undefined : end);
  assert.match(check, /github\.event_name == 'workflow_dispatch' && !inputs\.dry_run && inputs\.action == 'check-readiness'/);
  assert.match(check, /node scripts\/miniapp_readiness\.mjs --require-closed/);
  assert.match(check, /PRIVY_APP_SECRET: \$\{\{ secrets\.PRIVY_APP_SECRET \}\}/);
  assert.match(check, /MINIAPP_LEGACY_USERS: \$\{\{ vars\.MINIAPP_LEGACY_USERS \}\}/);
  assert.match(check, /MINIAPP_EXPECTED_WALLETS: \$\{\{ vars\.MINIAPP_EXPECTED_WALLETS \}\}/);
  assert.match(check, /unset MINIAPP_EXPECTED_WALLETS/);
  assert.doesNotMatch(check, /sync-server-config|PRIVY_PUBLIC_SIGNUP_DISABLED|CLOUDFLARE_API_TOKEN|MINIAPP_OPERATOR_TOKEN/);
  assert.match(workflow, /inputs\.action != 'sync-server-config' && inputs\.action != 'check-readiness'/);
});
