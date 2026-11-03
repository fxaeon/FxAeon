import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { generateRuntimeConfig, runtimeVariables, main } from './generate_runtime_config.mjs';
import { configVariables } from './miniapp_operator.mjs';

process.env.WRANGLER_SEND_METRICS = 'false';
const { experimental_readRawConfig, unstable_readConfig } = await import('wrangler');
const ROOT = new URL('../wrangler.toml', import.meta.url);
const SOURCE = readFileSync(ROOT, 'utf8');
const RAW = experimental_readRawConfig({ config: fileURLToPath(ROOT) }).rawConfig;
const ENV = { MINIAPP_ORIGIN: 'https://fxaeon.com', MINIAPP_ACCESS_MODE: 'passkey', MINIAPP_LEGACY_USERS: '5',
  PRIVY_PUBLIC_SIGNUP_DISABLED: 'yes', NEXT_PUBLIC_TELEGRAM_WALLET_MODE: 'passkey',
  TELEGRAM_MINIAPP_URL: 'https://t.me/FxAeonBot', RESEND_FROM: 'FxAeon <notifications@fxaeon.com>' };
function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fxaeon-runtime-'));
  const path = join(directory, 'wrangler.toml'); writeFileSync(path, SOURCE);
  t.after(() => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')));
    rmSync(directory, { recursive: true, force: true });
  });
  return path;
}

test('generated production vars use the same validated configuration as server sync and omit secret bindings', t => {
  const env = { ...ENV, PRIVY_APP_ID: 'private-app-id', PRIVY_APP_SECRET: 'private-privy-secret',
    TELEGRAM_BOT_TOKEN: '123456789:private-token-abcdefghijklmnopqrstuvwxyz', TELEGRAM_BOT_ID: '123456789',
    MINIAPP_OPERATOR_TOKEN: 'private-operator-token', RESEND_API_KEY: 'private-resend-key', CLOUDFLARE_API_TOKEN: 'private-cf-token' };
  const generated = generateRuntimeConfig(RAW, env);
  const expected = Object.fromEntries(Object.entries(configVariables(env)).filter(([key]) => key !== 'TELEGRAM_BOT_ID')
    .map(([key, binding]) => [key, binding.value]));
  assert.deepEqual(runtimeVariables(env), expected);
  for (const key of ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_ID',
    'MINIAPP_OPERATOR_TOKEN', 'RESEND_API_KEY', 'CLOUDFLARE_API_TOKEN']) {
    assert.equal(generated.includes(key), false); assert.equal(generated.includes(env[key]), false);
  }
  const path = workspace(t); writeFileSync(path, generated);
  // Actual installed Wrangler parser/resolver, rather than checking only TOML text.
  const production = unstable_readConfig({ config: path, env: 'production' }, { hideWarnings: true });
  const preview = unstable_readConfig({ config: path, env: 'preview' }, { hideWarnings: true });
  assert.deepEqual({ ...production.vars }, expected);
  assert.equal(production.d1_databases.length, 1); assert.equal(production.d1_databases[0].binding, 'ADMISSION_DB');
  assert.equal(production.d1_databases[0].database_id, RAW.d1_databases[0].database_id);
  assert.deepEqual({ ...preview.vars }, {}); assert.deepEqual(preview.d1_databases, []);
});

test('waitlist staging and rollback permit a passkey frontend and remove stale activation vars', t => {
  const path = workspace(t); writeFileSync(path, generateRuntimeConfig(RAW, ENV));
  const raw = experimental_readRawConfig({ config: path }).rawConfig;
  const generated = generateRuntimeConfig(raw, { ...ENV, MINIAPP_ACCESS_MODE: 'waitlist' });
  writeFileSync(path, generated);
  const production = unstable_readConfig({ config: path, env: 'production' }, { hideWarnings: true });
  assert.equal(production.vars.MINIAPP_ACCESS_MODE, 'waitlist');
  assert.equal(production.vars.PRIVY_PUBLIC_SIGNUP_DISABLED, undefined);
  assert.equal(production.vars.MINIAPP_LEGACY_USERS, '5');
  assert.equal(generateRuntimeConfig(experimental_readRawConfig({ config: path }).rawConfig,
    { ...ENV, MINIAPP_ACCESS_MODE: 'waitlist' }), generated);
});

test('runtime inputs reject missing baseline, invalid mode, injection and unreviewed activation', () => {
  for (const patch of [{ MINIAPP_LEGACY_USERS: undefined }, { MINIAPP_LEGACY_USERS: '4' }, { MINIAPP_LEGACY_USERS: '481' },
    { MINIAPP_LEGACY_USERS: '5\n[vars]' }, { MINIAPP_ACCESS_MODE: undefined }, { MINIAPP_ACCESS_MODE: 'off' },
    { MINIAPP_ORIGIN: 'https://evil.test' }, { TELEGRAM_MINIAPP_URL: 'https://t.me/OtherBot' },
    { RESEND_FROM: 'private-secret\nOTHER=1' }, { PRIVY_PUBLIC_SIGNUP_DISABLED: undefined }]) {
    assert.throws(() => generateRuntimeConfig(RAW, { ...ENV, ...patch }));
  }
});

test('generator refuses schema drift, secret vars and any widened preview or changed database', () => {
  for (const patch of [{ vars: { TELEGRAM_BOT_TOKEN: 'private' } }, { name: 'other-project' },
    { pages_build_output_dir: 'other-dist' }, { kv_namespaces: [] },
    { env: { preview: { d1_databases: RAW.d1_databases } } },
    { env: { preview: { d1_databases: [], vars: { MINIAPP_ACCESS_MODE: 'passkey' } } } },
    { env: { preview: { d1_databases: [] }, production: { vars: {} } } },
    { d1_databases: [{ ...RAW.d1_databases[0], database_id: 'different' }] }, { d1_databases: [] }]) {
    assert.throws(() => generateRuntimeConfig({ ...RAW, ...patch }, ENV), /runtime_config_invalid/);
  }
});

test('CLI generates only an explicitly selected production manifest and prints no values', async t => {
  const path = workspace(t); let output = '';
  assert.equal(await main({ argv: ['--production'], env: ENV, configPath: path, write: text => { output += text; } }), 0);
  assert.deepEqual(JSON.parse(output), { runtimeConfigGenerated: true, productionOnly: true, secretsWritten: false });
  const generated = readFileSync(path, 'utf8');
  for (const argv of [[], ['--preview'], ['--production', '--secret=private']]) {
    output = '';
    assert.equal(await main({ argv, env: ENV, configPath: path, write: text => { output += text; } }), 1);
    assert.deepEqual(JSON.parse(output), { runtimeConfigGenerated: false });
    assert.equal(readFileSync(path, 'utf8'), generated);
  }
  output = '';
  assert.equal(await main({ argv: ['--production'], env: { ...ENV, MINIAPP_ORIGIN: 'private-secret' },
    configPath: path, write: text => { output += text; } }), 1);
  assert.equal(output.includes('private-secret'), false); assert.equal(readFileSync(path, 'utf8'), generated);
});

test('deployment generates the effective manifest after readiness and sync, with bot ID last written as a secret', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy-mini-app.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const step = name => {
    const start = workflow.indexOf(`      - name: ${name}\n`); assert.ok(start >= 0, name);
    const next = workflow.indexOf('\n      - ', start + 1); return workflow.slice(start, next < 0 ? undefined : next);
  };
  const names = ['Check provider inventory and signup closure', 'Sync production Pages wallet server configuration',
    'Sync production Pages Telegram bot ID', 'Generate production runtime binding manifest', 'Deploy verified production artifact',
    'Verify deployed revision', 'Verify deployed admission runtime bindings'];
  for (let i = 1; i < names.length; i++) assert.ok(workflow.indexOf(step(names[i - 1])) < workflow.indexOf(step(names[i])));
  const generation = step('Generate production runtime binding manifest');
  assert.match(generation, /node scripts\/generate_runtime_config.mjs --production/);
  assert.doesNotMatch(generation, /secrets\.|TELEGRAM_BOT_(?:ID|TOKEN)|continue-on-error/);
  const sync = step('Sync production Pages wallet server configuration');
  for (const key of Object.keys(ENV).filter(key => key !== 'NEXT_PUBLIC_TELEGRAM_WALLET_MODE')) {
    const line = new RegExp(`^          ${key}: .+$`, 'm');
    assert.equal(generation.match(line)?.[0], sync.match(line)?.[0], key);
  }
  const bot = step('Sync production Pages Telegram bot ID');
  assert.match(bot, /pages secret put TELEGRAM_BOT_ID --project-name=fxaeon --env=production/);
  assert.match(bot, /exit 1\s+fi/);
  const runtime = step('Verify deployed admission runtime bindings');
  assert.match(runtime, /miniapp_operator.mjs --action status --execute/);
  assert.match(runtime, /MINIAPP_OPERATOR_TOKEN: \$\{\{ secrets.MINIAPP_OPERATOR_TOKEN \}\}/);
  assert.doesNotMatch(runtime, /continue-on-error|approve|dispatch|sync-server-config/);
  assert.match(step('Verify runtime binding manifest generation'), /node --test scripts\/generate_runtime_config.test.mjs/);
});
