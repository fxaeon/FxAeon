import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { configVariables } from './miniapp_operator.mjs';
import { validateWalletActivation } from './validate_production_env.mjs';

// Pages uploads bindings from its Wrangler config, not the dashboard's plain vars:
// https://developers.cloudflare.com/pages/functions/wrangler-configuration/
// https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/api/pages/create-worker-bundle-contents.ts
// Generate only in the production deployment checkout, after provider readiness
// and config sync (which enforces the monotonic legacy baseline). Never deploy here.
const INPUTS = ['MINIAPP_ORIGIN', 'MINIAPP_ACCESS_MODE', 'MINIAPP_LEGACY_USERS',
  'TELEGRAM_MINIAPP_URL', 'RESEND_FROM', 'PRIVY_PUBLIC_SIGNUP_DISABLED', 'NEXT_PUBLIC_TELEGRAM_WALLET_MODE'];
const VARS = ['MINIAPP_ORIGIN', 'MINIAPP_ACCESS_MODE', 'MINIAPP_LEGACY_USERS',
  'TELEGRAM_MINIAPP_URL', 'RESEND_FROM', 'PRIVY_PUBLIC_SIGNUP_DISABLED'];
const fail = () => { throw new Error('runtime_config_invalid'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));

export function runtimeVariables(env) {
  // Never pass credentials to the shared configuration helper or serialize env.
  const input = Object.fromEntries(INPUTS.map(key => [key, env[key]]));
  if (input.MINIAPP_ORIGIN !== 'https://fxaeon.com'
    || !['waitlist', 'passkey'].includes(input.MINIAPP_ACCESS_MODE)) fail();
  validateWalletActivation(input);
  const bindings = configVariables(input);
  // TELEGRAM_BOT_ID is synced separately as secret_text AFTER server config sync.
  return Object.fromEntries(VARS.filter(key => bindings[key]).map(key => {
    if (bindings[key].type !== 'plain_text' || typeof bindings[key].value !== 'string') fail();
    return [key, bindings[key].value];
  }));
}

export function generateRuntimeConfig(raw, env) {
  const vars = runtimeVariables(env);
  // Fail on new configuration rather than silently dropping or widening bindings.
  if (!keys(raw, ['name', 'compatibility_date', 'pages_build_output_dir', 'vars', 'd1_databases', 'env'])
    || raw.name !== 'fxaeon' || raw.pages_build_output_dir !== 'apps/mini-app/dist'
    || !/^\d{4}-\d{2}-\d{2}$/.test(raw.compatibility_date ?? '')
    || (raw.vars !== undefined && !keys(raw.vars, VARS))
    || !Array.isArray(raw.d1_databases) || raw.d1_databases.length !== 1
    || !keys(raw.env, ['preview']) || !keys(raw.env.preview, ['d1_databases', 'vars'])
    || !Array.isArray(raw.env.preview.d1_databases) || raw.env.preview.d1_databases.length !== 0
    || (raw.env.preview.vars !== undefined && !keys(raw.env.preview.vars, []))) fail();
  const db = raw.d1_databases[0];
  if (!keys(db, ['binding', 'database_name', 'database_id']) || db.binding !== 'ADMISSION_DB'
    || db.database_name !== 'fxaeon-admission' || db.database_id !== '056c44dd-4524-4b49-ab64-80ae1e53c4b7') fail();
  const assignments = values => Object.entries(values).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n');
  return '# Generated production runtime config; credentials remain encrypted Pages secrets.\n'
    + assignments({ name: raw.name, compatibility_date: raw.compatibility_date, pages_build_output_dir: raw.pages_build_output_dir })
    + '\n\n[vars]\n' + assignments(vars)
    + '\n\n[[d1_databases]]\n' + assignments(db)
    + '\n\n# Preview must never use production runtime variables or the admission database.\n'
    + '[env.preview]\nvars = {}\nd1_databases = []\n';
}

export async function main({ argv = process.argv.slice(2), env = process.env,
  configPath = fileURLToPath(new URL('../wrangler.toml', import.meta.url)),
  write = text => process.stdout.write(text) } = {}) {
  try {
    if (argv.length !== 1 || argv[0] !== '--production') fail();
    // Use the installed Wrangler TOML parser, with no remote calls or config redirects.
    const { experimental_readRawConfig } = await import('wrangler');
    const before = readFileSync(configPath, 'utf8');
    const { rawConfig, redirected } = experimental_readRawConfig({ config: configPath });
    if (redirected) fail();
    const generated = generateRuntimeConfig(rawConfig, env);
    if (readFileSync(configPath, 'utf8') !== before) fail();
    writeFileSync(`${configPath}.runtime.tmp`, generated, { flag: 'wx' });
    renameSync(`${configPath}.runtime.tmp`, configPath);
    write('{"runtimeConfigGenerated":true,"productionOnly":true,"secretsWritten":false}\n');
    return 0;
  } catch {
    write('{"runtimeConfigGenerated":false}\n');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
