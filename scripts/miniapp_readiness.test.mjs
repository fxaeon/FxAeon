import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AUTH_FLAGS, inspectPublicConfig, probeReadiness, main } from './miniapp_readiness.mjs';

const APP = 'syntheticapp0000000000000';
const SECRET = 'synthetic-secret-never-live';
const ENV = { PRIVY_APP_ID: APP, PRIVY_APP_SECRET: SECRET, MINIAPP_LEGACY_USERS: '5' };
const CONFIG_URL = `https://auth.privy.io/api/v1/apps/${APP}`;
const CONNECTIONS_URL = `${CONFIG_URL}/cross-app/connections`;
const ALLOWLIST_URL = `https://api.privy.io/v1/apps/${APP}/allowlist`;
const PIIS = ['private@example.com', 'private-telegram-name', '0xprivate-address', 'private-credential', SECRET, APP];
const users = (start = 0, size = 5) => Array.from({ length: size }, (_, i) => ({ id: `did:privy:private-user-${start + i}`,
  linked_accounts: [{ type: 'email', address: PIIS[0], username: PIIS[1], credential_id: PIIS[3] }] }));
const wallets = (start = 0, size = 2) => Array.from({ length: size }, (_, i) => ({ id: `private-wallet-${start + i}`,
  owner_id: `did:privy:private-user-${i}`, address: PIIS[2], private_provider_metadata: SECRET }));
const config = () => ({ id: APP, data_classification: 'public', custom_api_url: null,
  ...Object.fromEntries(AUTH_FLAGS.map(flag => [flag, false])), custom_oauth_providers: [] });
const connections = () => ({ data_classification: 'public', connections: [] });
const forbidden = [];
before(() => mock.method(globalThis, 'fetch', async input => { forbidden.push(String(input)); throw new Error('NETWORK FORBIDDEN'); }));
after(() => { mock.restoreAll(); assert.deepEqual(forbidden, []); });

function fixture(options = {}) {
  const app = config(); const global = connections(); const calls = [];
  let reply = () => undefined;
  const fetchImpl = async (input, init) => {
    const url = new URL(input); const headers = new Headers(init.headers);
    const call = { url, init, headers }; calls.push(call);
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    assert.ok(['https://auth.privy.io', 'https://api.privy.io'].includes(url.origin));
    assert.equal(headers.get('privy-app-id'), APP);
    assert.equal(headers.get('origin'), 'https://fxaeon.com');
    if (url.origin === 'https://auth.privy.io') assert.equal(headers.has('authorization'), false);
    else assert.equal(headers.get('authorization'), `Basic ${Buffer.from(`${APP}:${SECRET}`).toString('base64')}`);
    const custom = await reply(call);
    if (custom !== undefined) return custom;
    if (url.href === CONFIG_URL) return Response.json(app);
    if (url.href === CONNECTIONS_URL) return Response.json(global);
    if (url.href === ALLOWLIST_URL) return Response.json([]);
    if (url.pathname === '/v1/users') return Response.json({ data: users(), next_cursor: null });
    if (url.pathname === '/v1/wallets') {
      assert.equal(url.searchParams.get('include_archived'), 'true');
      return Response.json({ data: wallets(), next_cursor: null });
    }
    assert.fail('Unexpected mocked URL');
  };
  return { app, global, calls, respond: fn => { reply = fn; },
    probe: overrides => probeReadiness({ env: { ...ENV }, fetchImpl, ...options, ...overrides }),
    cli: async overrides => {
      let output = '';
      const code = await main({ argv: [], env: { ...ENV }, fetchImpl, write: text => { output += text; }, ...options, ...overrides });
      assert.equal(output.split('\n').length, 2);
      for (const pii of PIIS) assert.equal(output.includes(pii), false);
      const report = JSON.parse(output);
      assert.ok(Object.values(report).every(value => typeof value === 'boolean' || Number.isSafeInteger(value)));
      return { code, report, output };
    } };
}

test('initial waitlist check permits native Telegram ON, counts inventory and never claims activation readiness', async () => {
  const f = fixture(); f.app.telegram_auth = true;
  const { code, report } = await f.cli();
  assert.equal(code, 0); assert.equal(report.readOnlyChecksPassed, true);
  assert.equal(report.publicSignupDisabled, false); assert.equal(report.telegramSignupDisabled, false);
  assert.equal(report.customJwtSignupDisabled, true); assert.equal(report.globalWalletLoginDisabled, true);
  assert.equal(report.enabledSignupMethodCount, 1); assert.equal(report.userCount, 5); assert.equal(report.walletCount, 2);
  assert.equal(report.credentialsValid, true); assert.equal(report.walletBaselineConfigured, false);
  for (const key of ['activationReady', 'userlessWalletCreationVerified', 'ownerQuorumCreationVerified', 'fullAccessSecretVerified']) assert.equal(report[key], false);
  assert.equal(report.manualCapabilityVerificationRequired, true);
  assert.deepEqual(f.calls.map(call => call.url.origin), ['https://auth.privy.io', 'https://auth.privy.io',
    'https://api.privy.io', 'https://api.privy.io', 'https://auth.privy.io', 'https://auth.privy.io']);
});

test('strict check succeeds only for closed recognized settings and explicit matching wallet inventory', async () => {
  const f = fixture();
  const { code, report } = await f.cli({ argv: ['--require-closed'], env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '2' } });
  assert.equal(code, 0); assert.equal(report.requireClosed, true); assert.equal(report.publicSignupDisabled, true);
  assert.equal(report.walletInventoryMatchesBaseline, true); assert.equal(report.activationReady, false);
});

function walletOnly() {
  const f = fixture({ requireClosed: true, env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '2' } });
  Object.assign(f.app, { wallet_auth: true, allowlist_enabled: true, twitter_oauth_on_mobile_enabled: true });
  return f;
}
const allowlistEntry = (patch = {}) => ({ id: 'private-entry', acceptedAt: null, appId: APP,
  type: 'wallet', value: PIIS[2], ...patch });

test('wallet-only signup closure requires authenticated empty allowlist evidence in both snapshots', async () => {
  const f = walletOnly();
  // Public settings and the signup checkbox alone must never claim closure.
  const publicOnly = inspectPublicConfig(f.app, f.global, APP);
  assert.equal(publicOnly.publicSignupDisabled, false); assert.equal(publicOnly.walletAllowlistRequired, true);
  const { code, report } = await f.cli({ argv: ['--require-closed'] });
  assert.equal(code, 0); assert.equal(report.publicSignupDisabled, true); assert.equal(report.enabledSignupMethodCount, 0);
  assert.equal(report.allowlistEnabled, true); assert.equal(report.allowlistInventoryComplete, true);
  assert.equal(report.emptyAllowlistVerified, true); assert.equal(report.allowlistEntryCount, 0);
  assert.equal(report.activationReady, false); assert.equal(report.userlessWalletCreationVerified, false);
  const reads = f.calls.filter(call => call.url.href === ALLOWLIST_URL);
  assert.equal(reads.length, 2);
  assert.ok(reads.every(call => call.init.method === 'GET' && call.headers.has('authorization') && call.url.search === ''));
});

test('missing, disabled or malformed allowlist flag cannot authorize wallet-only closure', async () => {
  for (const value of [undefined, false, null, 'true', 1]) {
    const f = walletOnly();
    if (value === undefined) delete f.app.allowlist_enabled; else f.app.allowlist_enabled = value;
    const report = await f.probe();
    assert.equal(report.publicSignupDisabled, false); assert.equal(report.readOnlyChecksPassed, false);
    assert.equal(report.emptyAllowlistVerified, false);
    assert.equal(f.calls.some(call => call.url.href === ALLOWLIST_URL), false);
  }
});

test('empty allowlist exception cannot mask any other enabled auth or signup flag', async () => {
  for (const flag of AUTH_FLAGS.filter(flag => !['wallet_auth', 'twitter_oauth_on_mobile_enabled'].includes(flag))) {
    const f = walletOnly(); f.app[flag] = true;
    const report = await f.probe();
    assert.equal(report.publicSignupDisabled, false, flag); assert.equal(report.readOnlyChecksPassed, false, flag);
  }
  for (const patch of [{ telegram_seamless_auth_enabled: true },
    { telegram_auth_config: { seamless_auth_enabled: true, link_enabled: false } },
    { custom_oauth_providers: [{ provider: 'custom:test', enabled: true }] }]) {
    const f = walletOnly(); Object.assign(f.app, patch);
    assert.equal((await f.probe()).readOnlyChecksPassed, false);
  }
  const f = walletOnly(); f.global.connections.push({ provider_app_id: 'provider00000000000000000', read_only: true });
  assert.equal((await f.probe()).readOnlyChecksPassed, false);
});

test('every nonempty allowlist including accepted entries and email domains blocks closure without leaking values', async () => {
  for (const type of ['wallet', 'email', 'phone', 'emailDomain']) for (const acceptedAt of [null, 123]) {
    const f = walletOnly();
    f.respond(({ url }) => url.href === ALLOWLIST_URL ? Response.json([allowlistEntry({ type, acceptedAt })]) : undefined);
    const { code, report } = await f.cli({ argv: ['--require-closed'] });
    assert.equal(code, 1); assert.equal(report.allowlistInventoryComplete, true); assert.equal(report.allowlistEntryCount, 1);
    assert.equal(report.emptyAllowlistVerified, false); assert.equal(report.publicSignupDisabled, false);
  }
});

test('allowlist schema drift, pagination wrappers, cross-app entries and malformed rows fail closed', async () => {
  for (const body of [null, {}, { data: [] }, { entries: [], next_cursor: 'private-next' }, [null],
    [allowlistEntry({ appId: 'other-app' })], [allowlistEntry({ type: 'unknown' })],
    [allowlistEntry({ acceptedAt: undefined })], [allowlistEntry({ acceptedAt: '0' })],
    [allowlistEntry({ value: '' })], [allowlistEntry({ extra: true })],
    [allowlistEntry(), allowlistEntry()], Array.from({ length: 1001 }, (_, i) => allowlistEntry({ id: String(i) }))]) {
    const f = walletOnly(); f.respond(({ url }) => url.href === ALLOWLIST_URL ? Response.json(body) : undefined);
    const { code, report } = await f.cli({ argv: ['--require-closed'] });
    assert.equal(code, 1); assert.equal(report.probeFailed, true); assert.equal(report.emptyAllowlistVerified, false);
    assert.equal(report.allowlistInventoryComplete, false);
  }
});

test('allowlist authentication errors, redirects, oversized bodies and timeouts cannot look empty', async () => {
  for (const reply of [() => Response.json({ error: SECRET }, { status: 401 }),
    () => Response.json({ error: SECRET }, { status: 403 }), () => new Response('', { status: 302, headers: { location: 'https://attacker.test' } }),
    () => new Response('[]', { headers: { 'content-type': 'text/html' } }),
    () => new Response(' '.repeat(1_048_577), { headers: { 'content-type': 'application/json' } }),
    () => { throw new Error(SECRET); }, () => new Promise(() => {})]) {
    const f = walletOnly(); f.respond(({ url }) => url.href === ALLOWLIST_URL ? reply() : undefined);
    const { code, report } = await f.cli({ argv: ['--require-closed'], timeoutMs: 30 });
    assert.equal(code, 1); assert.equal(report.emptyAllowlistVerified, false); assert.equal(report.publicSignupDisabled, false);
  }
});

test('allowlist additions or errors in either snapshot cannot pass strict closure', async () => {
  for (const failingRead of [1, 2]) for (const fails of [false, true]) {
    const f = walletOnly(); let reads = 0;
    f.respond(({ url }) => {
      if (url.href !== ALLOWLIST_URL) return;
      if (++reads !== failingRead) return Response.json([]);
      return fails ? Response.json({ error: SECRET }, { status: 503 }) : Response.json([allowlistEntry()]);
    });
    const report = await f.probe();
    assert.equal(report.readOnlyChecksPassed, false); assert.equal(report.publicSignupDisabled, false);
    assert.equal(report.emptyAllowlistVerified, false); assert.equal(reads, 2);
  }
});

test('allowlist disable or another login reopening during inventory invalidates wallet-only proof', async () => {
  for (const patch of [{ allowlist_enabled: false }, { telegram_oauth: true }, { external_wallets_for_signup_enabled: true }]) {
    const f = walletOnly();
    f.respond(({ url }) => { if (url.pathname === '/v1/wallets') Object.assign(f.app, patch); });
    const report = await f.probe();
    assert.equal(report.readOnlyChecksPassed, false); assert.equal(report.publicSignupDisabled, false);
    assert.equal(report.emptyAllowlistVerified, false);
  }
});

for (const flag of AUTH_FLAGS.filter(flag => flag !== 'twitter_oauth_on_mobile_enabled')) test(`strict check rejects enabled ${flag}`, async () => {
  const f = fixture(); f.app[flag] = true;
  const report = await f.probe({ requireClosed: true, env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '2' } });
  assert.equal(report.publicConfigRecognized, true); assert.equal(report.publicSignupDisabled, false); assert.equal(report.readOnlyChecksPassed, false);
});

test('each required flag rejects omission, null and string false rather than assuming disabled', () => {
  for (const flag of AUTH_FLAGS) for (const value of [undefined, null, 'false', 0]) {
    const app = config(); if (value === undefined) delete app[flag]; else app[flag] = value;
    assert.equal(inspectPublicConfig(app, connections(), APP).publicConfigRecognized, false, flag);
  }
});

test('unknown settings, wrong app, privileged payload and alternate auth URL fail closed', async () => {
  for (const patch of [{ new_auth: false }, { new_signup_enabled: true }, { global_wallet_auth: false },
    { id: 'otherapp00000000000000000' }, { data_classification: 'private' }, { custom_api_url: 'https://attacker.test' }]) {
    const f = fixture(); Object.assign(f.app, patch);
    const result = await f.cli();
    assert.equal(result.code, 1); assert.equal(result.report.publicConfigRecognized, false);
    assert.equal(result.report.userCount, 5, 'unknown config must not prevent safe inventory reporting');
  }
});

test('reviewed production config is recognized with custom domain, Telegram and seamless login enabled', async () => {
  const f = fixture(); Object.assign(f.app, { custom_api_url: 'https://privy.fxaeon.com', telegram_auth: true,
    telegram_oauth: true, twitter_oauth: false, twitter_oauth_on_mobile_enabled: true,
    telegram_auth_config: { bot_id: '123456789', bot_name: 'FxAeonBot', seamless_auth_enabled: true, link_enabled: true } });
  const initial = await f.cli();
  assert.equal(initial.code, 0); assert.equal(initial.report.publicConfigRecognized, true);
  assert.equal(initial.report.publicSignupDisabled, false); assert.equal(initial.report.telegramSignupDisabled, false);
  assert.equal(initial.report.enabledSignupMethodCount, 3); assert.equal(initial.report.activationReady, false);
  assert.ok(f.calls.every(call => call.url.origin !== 'https://privy.fxaeon.com'));
  assert.ok(f.calls.every(call => call.headers.get('origin') === 'https://fxaeon.com'));
  const strict = await f.cli({ argv: ['--require-closed'], env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '2' } });
  assert.equal(strict.code, 1);
  f.app.telegram_auth = false; f.app.telegram_oauth = false;
  assert.equal((await f.cli({ argv: ['--require-closed'], env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '2' } })).code, 1,
    'seamless Telegram auth still permits signup');
  f.app.telegram_auth_config.seamless_auth_enabled = false;
  const closed = await f.cli({ argv: ['--require-closed'], env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '2' } });
  assert.equal(closed.code, 0); assert.equal(closed.report.publicSignupDisabled, true);
  assert.equal(closed.report.enabledSignupMethodCount, 0);
});

test('Twitter mobile is a modifier: validates as a boolean but cannot enable login independently', () => {
  for (const mobile of [false, true]) {
    const app = { ...config(), twitter_oauth_on_mobile_enabled: mobile };
    const disabled = inspectPublicConfig(app, connections(), APP);
    assert.equal(disabled.publicConfigRecognized, true); assert.equal(disabled.publicSignupDisabled, true);
    assert.equal(disabled.enabledSignupMethodCount, 0);
    const enabled = inspectPublicConfig({ ...app, twitter_oauth: true }, connections(), APP);
    assert.equal(enabled.publicSignupDisabled, false); assert.equal(enabled.enabledSignupMethodCount, 1);
  }
  assert.equal(inspectPublicConfig({ ...config(), twitter_oauth_on_mobile_enabled: 'true' }, connections(), APP).publicConfigRecognized, false);
});

test('custom API domain exception is exact and never permits arbitrary hosts, credentials, ports or paths', () => {
  for (const custom_api_url of ['http://privy.fxaeon.com', 'https://privy.fxaeon.com.evil.test', 'https://evil.test',
    'https://privy.fxaeon.com@evil.test', 'https://user@privy.fxaeon.com', 'https://privy.fxaeon.com:8443',
    'https://privy.fxaeon.com/redirect', 'https://privy.fxaeon.com?next=https://evil.test', 'https://privy.fxaeon.com#secret']) {
    assert.equal(inspectPublicConfig({ ...config(), custom_api_url }, connections(), APP).publicConfigRecognized, false);
  }
});

test('custom OAuth and Telegram seamless authentication are inspected rather than silently ignored', () => {
  for (const patch of [{ custom_oauth_providers: [{ provider: 'custom:test', enabled: true }] },
    { telegram_seamless_auth_enabled: true }, { telegram_auth_config: { bot_id: '123', bot_name: 'test', link_enabled: false, seamless_auth_enabled: true } }]) {
    const result = inspectPublicConfig({ ...config(), ...patch }, connections(), APP);
    assert.equal(result.publicConfigRecognized, true); assert.equal(result.publicSignupDisabled, false);
  }
  for (const patch of [{ custom_oauth_providers: [{ provider: 'custom:test' }] }, { telegram_seamless_auth_enabled: 'false' },
    { telegram_auth_config: {} }, { custom_oauth_providers: [{ provider: 'custom:test', enabled: false, new_auth: true }] }]) {
    assert.equal(inspectPublicConfig({ ...config(), ...patch }, connections(), APP).publicConfigRecognized, false);
  }
});

test('global wallet login must be checked through the separate cross-app connections response', async () => {
  const f = fixture(); f.global.connections.push({ provider_app_id: 'provider00000000000000000', read_only: true });
  const report = await f.probe({ requireClosed: true, env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '2' } });
  assert.equal(report.publicConfigRecognized, true); assert.equal(report.globalWalletLoginDisabled, false);
  assert.equal(report.publicSignupDisabled, false); assert.equal(report.readOnlyChecksPassed, false);
  for (const value of [{}, { data_classification: 'public' }, { data_classification: 'public', connections: null },
    { ...connections(), unknown_config: false }]) assert.equal(inspectPublicConfig(config(), value, APP).publicConfigRecognized, false);
});

test('credentials are sent only to fixed authenticated API paths; public app requests carry no secret', async () => {
  const f = fixture(); await f.cli();
  assert.ok(f.calls.every(call => call.url.username === '' && call.url.password === '' && !call.url.href.includes(SECRET)));
  assert.ok(f.calls.filter(call => call.url.origin === 'https://auth.privy.io').every(call => !call.headers.has('authorization')));
  assert.ok(f.calls.every(call => !['POST', 'PUT', 'PATCH', 'DELETE'].includes(call.init.method)));
});

test('missing credentials, malformed values, wrong origin and any legacy baseline other than explicit 5 fail before network', async () => {
  for (const patch of [{ PRIVY_APP_ID: undefined }, { PRIVY_APP_ID: 'bad/../path' }, { PRIVY_APP_SECRET: undefined },
    { PRIVY_APP_SECRET: 'secret\nheader' }, { MINIAPP_LEGACY_USERS: undefined }, { MINIAPP_LEGACY_USERS: '05' },
    { MINIAPP_LEGACY_USERS: '4' }, { MINIAPP_LEGACY_USERS: '6' }, { MINIAPP_LEGACY_USERS: 5 },
    { MINIAPP_ORIGIN: 'https://attacker.test' }, { MINIAPP_EXPECTED_WALLETS: '-1' }, { MINIAPP_EXPECTED_WALLETS: '1001' }]) {
    const f = fixture(); const { code, report } = await f.cli({ env: { ...ENV, ...patch } });
    assert.equal(code, 1); assert.equal(report.environmentValid, false); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); assert.equal((await f.cli({ argv: ['--require-closed'] })).code, 1); assert.equal(f.calls.length, 0);
});

test('unexpected command-line arguments cannot change hosts, add credentials or enable mutation', async () => {
  for (const argv of [['--url=https://attacker.test'], ['--execute'], ['--secret=private'], ['--require-closed', '--require-closed']]) {
    const f = fixture(); const { code, report } = await f.cli({ argv });
    assert.equal(code, 1); assert.equal(report.argumentsValid, false); assert.equal(f.calls.length, 0);
  }
});

test('pagination counts every page, URL-encodes opaque cursors and includes archived wallets', async () => {
  const f = fixture();
  const cursor = 'https://attacker.test/?secret=opaque&limit=1';
  f.respond(({ url }) => {
    if (url.pathname === '/v1/users') return Response.json(url.searchParams.has('cursor') ? { data: users(3, 2) } : { data: users(0, 3), next_cursor: cursor });
    if (url.pathname === '/v1/wallets') return Response.json(url.searchParams.has('cursor') ? { data: wallets(1, 1), next_cursor: null } : { data: wallets(0, 1), next_cursor: 'wallet-page-2' });
  });
  const report = await f.probe(); assert.equal(report.readOnlyChecksPassed, true); assert.equal(report.userCount, 5); assert.equal(report.walletCount, 2);
  const second = f.calls.find(call => call.url.pathname === '/v1/users' && call.url.searchParams.has('cursor'));
  assert.equal(second.url.searchParams.get('cursor'), cursor); assert.equal(second.url.origin, 'https://api.privy.io');
  assert.equal(second.url.searchParams.get('limit'), '100');
});

test('inventory drift below or above five users and mismatched reviewed wallet counts fail', async () => {
  for (const size of [0, 4, 6]) {
    const f = fixture(); f.respond(({ url }) => url.pathname === '/v1/users' ? Response.json({ data: users(0, size) }) : undefined);
    const report = await f.probe(); assert.equal(report.userCount, size); assert.equal(report.userInventoryMatchesBaseline, false); assert.equal(report.readOnlyChecksPassed, false);
  }
  const f = fixture(); const report = await f.probe({ env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '3' } });
  assert.equal(report.walletInventoryMatchesBaseline, false); assert.equal(report.readOnlyChecksPassed, false);
});

test('wallet growth requires an explicit reviewed expected count and never changes the five-user legacy baseline', async () => {
  const f = fixture();
  f.respond(({ url }) => url.pathname === '/v1/wallets' ? Response.json({ data: wallets(0, 3) }) : undefined);
  const stale = await f.probe({ requireClosed: true, env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '2' } });
  assert.equal(stale.readOnlyChecksPassed, false); assert.equal(stale.walletCount, 3);
  const reviewed = await f.probe({ requireClosed: true, env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '3' } });
  assert.equal(reviewed.readOnlyChecksPassed, true); assert.equal(reviewed.walletInventoryMatchesBaseline, true);
  assert.equal(reviewed.legacyBaseline, 5); assert.equal(reviewed.userCount, 5);
  assert.equal(reviewed.activationReady, false);
  assert.equal((await f.probe({ requireClosed: true,
    env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '3', MINIAPP_LEGACY_USERS: '6' } })).environmentValid, false);
});

test('malformed inventory, duplicate IDs and nonadvancing or invalid cursors cannot pass as complete', async () => {
  for (const payload of [{}, { data: {} }, { data: [null] }, { data: [{ id: '' }] }, { data: [users()[0], users()[0]] },
    { data: users(), next_cursor: '' }, { data: users(), next_cursor: 7 }, { data: users(), next_cursor: 'x'.repeat(513) },
    { data: [], next_cursor: 'again' }, { data: users(), next_cursor: 'again' }]) {
    const f = fixture(); f.respond(({ url }) => url.pathname === '/v1/users' ? Response.json(payload) : undefined);
    const report = await f.probe(); assert.equal(report.userInventoryComplete, false); assert.equal(report.readOnlyChecksPassed, false);
  }
  const f = fixture(); f.respond(({ url }) => url.pathname === '/v1/wallets' ? Response.json({ data: [{ id: 'wallet' }] }) : undefined);
  assert.equal((await f.probe()).walletInventoryComplete, false);
});

test('pagination is bounded even for endlessly changing cursors', async () => {
  const f = fixture(); let page = 0;
  f.respond(({ url }) => url.pathname === '/v1/users' ? Response.json({ data: users(page++, 1), next_cursor: `page-${page}` }) : undefined);
  const report = await f.probe(); assert.equal(report.userInventoryComplete, false); assert.equal(page, 10);
});

test('existing owner quorum reads prove only read access, never create entitlement or full-access secret scope', async () => {
  const f = fixture();
  f.respond(({ url }) => {
    if (url.pathname === '/v1/wallets') return Response.json({ data: [{ id: 'wallet-1', owner_id: 'quorum-1' }, { id: 'wallet-2', owner_id: 'quorum-1' }] });
    if (url.pathname === '/v1/key_quorums/quorum-1') return Response.json({ id: 'quorum-1', authorization_threshold: 1,
      authorization_keys: [{ public_key: 'synthetic-public-owner-key' }], user_ids: null });
  });
  const report = await f.probe();
  assert.equal(report.readOnlyChecksPassed, true); assert.equal(report.ownerQuorumCount, 1); assert.equal(report.ownerQuorumReadCount, 1);
  assert.equal(report.ownerQuorumSampled, true); assert.equal(report.ownerQuorumSampleVerified, true);
  assert.equal(report.ownerQuorumReadVerified, true); assert.equal(report.ownerQuorumCreationVerified, false); assert.equal(report.userlessWalletCreationVerified, false);
  assert.equal(report.fullAccessSecretVerified, false); assert.equal(report.activationReady, false);
});

test('475 owner quorums keep complete inventory counts with only one explicitly sampled diagnostic read', async () => {
  const f = walletOnly();
  f.respond(({ url }) => {
    if (url.pathname === '/v1/users') return Response.json(url.searchParams.has('cursor')
      ? { data: users(2, 3) } : { data: users(0, 2), next_cursor: 'users-rest' });
    if (url.pathname === '/v1/wallets') {
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const data = Array.from({ length: Math.min(100, 475 - start) }, (_, i) => ({
        id: `wallet-${start + i}`, owner_id: `quorum-${start + i}`,
      }));
      return Response.json({ data, next_cursor: start + data.length < 475 ? String(start + data.length) : null });
    }
    if (url.pathname === '/v1/key_quorums/quorum-0') return Response.json({ id: 'quorum-0', authorization_threshold: 1,
      authorization_keys: [{ public_key: 'synthetic-public-key' }], user_ids: [] });
  });
  const { code, report } = await f.cli({ argv: ['--require-closed'], env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '475' } });
  assert.equal(code, 0); assert.equal(report.readOnlyChecksPassed, true);
  assert.equal(report.walletCount, 475); assert.equal(report.walletInventoryComplete, true);
  assert.equal(report.userCount, 5); assert.equal(report.userInventoryComplete, true);
  assert.equal(report.walletInventoryMatchesBaseline, true); assert.equal(report.ownerQuorumCount, 475);
  assert.equal(report.ownerQuorumReadCount, 1); assert.equal(report.ownerQuorumSampled, true);
  assert.equal(report.ownerQuorumSampleVerified, true); assert.equal(report.ownerQuorumReadVerified, false);
  assert.equal(report.ownerQuorumCreationVerified, false); assert.equal(report.userlessWalletCreationVerified, false);
  assert.equal(report.activationReady, false); assert.equal(report.emptyAllowlistVerified, true);
  assert.equal(f.calls.filter(call => call.url.pathname.startsWith('/v1/key_quorums/')).length, 1);
  assert.equal(f.calls.length, 14, 'two user pages, five wallet pages, one quorum, four public config and two allowlist reads');
});

test('quorum permission denial is reported without treating inventory reads as entitlement', async () => {
  const f = fixture(); f.respond(({ url }) => {
    if (url.pathname === '/v1/wallets') return Response.json({ data: [{ id: 'wallet-1', owner_id: 'quorum-1' }] });
    if (url.pathname.startsWith('/v1/key_quorums/')) return Response.json({ error: `${SECRET} entitlement unavailable ${PIIS[0]}` }, { status: 403 });
  });
  const { code, report } = await f.cli(); assert.equal(code, 1); assert.equal(report.credentialsValid, true);
  assert.equal(report.ownerQuorumReadVerified, false); assert.equal(report.ownerQuorumCreationVerified, false);
  assert.equal(report.ownerQuorumSampled, true); assert.equal(report.ownerQuorumSampleVerified, false);
});

test('wallet owner path traversal never changes the fixed request destination', async () => {
  const f = fixture(); f.respond(({ url }) => url.pathname === '/v1/wallets'
    ? Response.json({ data: [{ id: 'wallet-1', owner_id: '../../users?secret=private' }] }) : undefined);
  assert.equal((await f.probe()).readOnlyChecksPassed, false);
  assert.equal(f.calls.filter(call => call.url.pathname.includes('key_quorums')).length, 0);
});

test('reopening public signup during inventory cannot pass strict mode', async () => {
  const f = fixture(); let reads = 0;
  f.respond(({ url }) => { if (url.href === CONFIG_URL && ++reads === 2) return Response.json({ ...config(), telegram_auth: true }); });
  const report = await f.probe({ requireClosed: true, env: { ...ENV, MINIAPP_EXPECTED_WALLETS: '2' } });
  assert.equal(report.publicSignupDisabled, false); assert.equal(report.readOnlyChecksPassed, false);
});

test('401, 403, 429, 5xx and redirects fail safely without returning provider bodies', async () => {
  for (const status of [301, 401, 403, 429, 500, 503]) {
    const f = fixture(); f.respond(({ url }) => url.pathname === '/v1/users' ? Response.json({ error: SECRET, user: PIIS[0] }, { status }) : undefined);
    const { code, report } = await f.cli(); assert.equal(code, 1); assert.equal(report.credentialsValid, false);
  }
  const f = fixture(); f.respond(({ url }) => {
    if (url.pathname !== '/v1/users') return;
    const response = Response.json({ data: users() }); Object.defineProperty(response, 'redirected', { value: true }); return response;
  });
  assert.equal((await f.cli()).code, 1);
});

test('errors, non-JSON, invalid UTF-8 and oversized streamed bodies never print PII or secrets', async () => {
  for (const response of [() => { throw new Error(`${SECRET} ${PIIS.join(' ')}`); },
    () => new Response('private', { headers: { 'content-type': 'text/plain' } }), () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => new Response(Uint8Array.of(0xff), { headers: { 'content-type': 'application/json' } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(524_289)); controller.enqueue(new Uint8Array(524_289)); controller.close(); } }),
      { headers: { 'content-type': 'application/json', 'content-length': '1' } })]) {
    const f = fixture(); f.respond(({ url }) => url.pathname === '/v1/users' ? response() : undefined);
    assert.equal((await f.cli()).code, 1);
  }
});

test('deadlines cover hung fetch and hung body streams, even if mock fetch ignores AbortSignal', async () => {
  for (const response of [() => new Promise(() => {}), () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } })]) {
    const f = fixture({ timeoutMs: 10 }); f.respond(({ url }) => url.pathname === '/v1/users' ? response() : undefined);
    const { code } = await f.cli(); assert.equal(code, 1);
    assert.equal(f.calls.find(call => call.url.pathname === '/v1/users').init.signal.aborted, true);
  }
});

test('CLI with no live credentials emits only a failure JSON object and exits nonzero without network', () => {
  const execution = spawnSync(process.execPath, [fileURLToPath(new URL('./miniapp_readiness.mjs', import.meta.url))], {
    env: {}, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(execution.status, 1); assert.equal(execution.stderr, '');
  const report = JSON.parse(execution.stdout); assert.equal(report.environmentValid, false);
  assert.ok(Object.values(report).every(value => typeof value === 'boolean' || Number.isSafeInteger(value)));
});
