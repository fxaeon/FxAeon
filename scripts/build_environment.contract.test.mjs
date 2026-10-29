import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { E2E_BUILD_ENV } from './e2e_build_env.mjs';

// Every local-only variable the app reads, plus one it does not read yet: the
// validator must reject whole families, not a list that can drift from src.
const appSource = readdirSync(new URL('../apps/mini-app/src/', import.meta.url), { recursive: true })
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .map((file) => readFileSync(new URL(`../apps/mini-app/src/${file.replaceAll('\\', '/')}`, import.meta.url), 'utf8'))
  .join('\n');
const localOnlyVariables = [...new Set([
  ...appSource.match(/NEXT_PUBLIC_FX_(?:SCREENSHOT|LOCAL_FORK|ANVIL)_[A-Z0-9_]*[A-Z0-9]/g) ?? [],
  'NEXT_PUBLIC_FX_SCREENSHOT_FUTURE_SETTING',
])].sort();

test('the local-only variable list comes from the app source', () => {
  assert.ok(localOnlyVariables.length >= 6, localOnlyVariables.join(', '));
  assert.ok(localOnlyVariables.includes('NEXT_PUBLIC_FX_LOCAL_FORK_RPC_URL'));
});
const requiredConfig = {
  NEXT_PUBLIC_PRIVY_APP_ID: 'production-application-id',
  NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL: 'https://eth-mainnet.g.alchemy.com/v2/test-key',
  NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/test-key',
  NEXT_PUBLIC_ALCHEMY_DATA_API_KEY: 'test-data-key',
  NEXT_PUBLIC_TELEGRAM_APP_URL: 'https://t.me/FxAeonBot',
  TELEGRAM_BOT_TOKEN: `123456789:${'a'.repeat(32)}`,
};

function validate(overrides = {}) {
  return spawnSync(process.execPath, [fileURLToPath(new URL('./validate_production_env.mjs', import.meta.url))], {
    encoding: 'utf8',
    env: { ...process.env, ...E2E_BUILD_ENV, ...requiredConfig, ...overrides },
  });
}

test('deterministic browser verification clears every configured RPC provider', () => {
  const source = readFileSync(new URL('../apps/mini-app/src/lib/fx/config.ts', import.meta.url), 'utf8');
  const names = [...new Set(source.match(/NEXT_PUBLIC_[A-Z0-9_]+_RPC_URL/g))];
  assert.ok(names.length >= 6);
  for (const name of names) assert.equal(E2E_BUILD_ENV[name], '', `${name} must not inherit a real provider`);
});

test('production validation accepts normal config and empty local-only variables', () => {
  const result = validate(Object.fromEntries(localOnlyVariables.map((name) => [name, ''])));
  assert.equal(result.status, 0, result.stderr);
});

test('production validation rejects populated local-only build variables without printing values', () => {
  for (const name of localOnlyVariables) {
    const value = name.endsWith('_MODE') ? '1' : 'local-only-test-value';
    const result = validate({ [name]: value });
    assert.equal(result.status, 1, `${name} must not pass production validation`);
    assert.ok(result.stderr.includes(`${name} must be unset for production`), result.stderr);
    if (value !== '1') assert.ok(!result.stderr.includes(value));
  }
});

test('optional Infura endpoints reject placeholder project identifiers before a production build', () => {
  for (const [name, host] of [
    ['NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL', 'mainnet.infura.io'],
    ['NEXT_PUBLIC_INFURA_BASE_RPC_URL', 'base-mainnet.infura.io'],
  ]) {
    const result = validate({ [name]: `https://${host}/v3/YOUR_INFURA_PROJECT_ID` });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`${name} contains a placeholder value`), result.stderr);
    assert.ok(!result.stderr.includes('YOUR_INFURA_PROJECT_ID'));
  }
});

test('the Telegram admission flag accepts only on, off or unset', () => {
  for (const value of ['', 'on', 'off']) {
    assert.equal(validate({ NEXT_PUBLIC_TELEGRAM_ADMISSION: value }).status, 0, `"${value}" is a valid admission flag`);
  }
  for (const value of ['ON', 'true', '1', 'enforce']) {
    const result = validate({ NEXT_PUBLIC_TELEGRAM_ADMISSION: value });
    assert.equal(result.status, 1, `"${value}" must not silently leave admission off`);
    assert.ok(result.stderr.includes('NEXT_PUBLIC_TELEGRAM_ADMISSION must be "on", "off", or unset'), result.stderr);
  }
});
