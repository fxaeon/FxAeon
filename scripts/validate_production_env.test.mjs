import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateWalletActivation, validateServerConfig } from './validate_production_env.mjs';

const server = () => ({
  PRIVY_APP_ID: 'production-application-id', PRIVY_APP_SECRET: 'production-privy-secret-value',
  RESEND_API_KEY: 'resend-production-secret-value', MINIAPP_OPERATOR_TOKEN: 'secure-operator-token-with-32-characters',
  TELEGRAM_BOT_TOKEN: `123456789:${'a'.repeat(32)}`, MINIAPP_ORIGIN: 'https://fxaeon.com', MINIAPP_LEGACY_USERS: '5',
});
test('wallet activation defaults off even when server credentials are present', () => {
  assert.deepEqual(validateWalletActivation(), { publicMode: 'off', serverMode: 'waitlist' });
  assert.deepEqual(validateWalletActivation(server()), { publicMode: 'off', serverMode: 'waitlist' });
  assert.doesNotThrow(() => validateServerConfig(server()));
});
test('production rejects mismatched public/server modes, including missing flags', () => {
  for (const modes of [
    { NEXT_PUBLIC_TELEGRAM_WALLET_MODE: 'off', MINIAPP_ACCESS_MODE: 'passkey' },
    { NEXT_PUBLIC_TELEGRAM_WALLET_MODE: 'passkey', MINIAPP_ACCESS_MODE: 'waitlist' },
    { MINIAPP_ACCESS_MODE: 'passkey' }, { NEXT_PUBLIC_TELEGRAM_WALLET_MODE: 'passkey' },
  ]) {
    const env = { ...server(), ...modes, PRIVY_PUBLIC_SIGNUP_DISABLED: 'yes' };
    assert.throws(() => validateWalletActivation(env), /wallet modes must match/);
    assert.throws(() => validateServerConfig(env), /wallet modes must match/);
  }
});

test('paired passkey production passes only with native-signup closure verified', () => {
  const modes = { NEXT_PUBLIC_TELEGRAM_WALLET_MODE: 'passkey', MINIAPP_ACCESS_MODE: 'passkey' };
  for (const marker of [undefined, '', 'true', 'false', 'no', 'YES']) {
    assert.throws(() => validateWalletActivation({ ...modes, PRIVY_PUBLIC_SIGNUP_DISABLED: marker }), /verification|verified|after verification/);
  }
  const env = { ...server(), ...modes, PRIVY_PUBLIC_SIGNUP_DISABLED: 'yes' };
  assert.deepEqual(validateWalletActivation(env), { publicMode: 'passkey', serverMode: 'passkey' });
  assert.doesNotThrow(() => validateServerConfig(env));
  for (const value of ['on', 'ON', 'true', '1', 'PASSKEY', ' passkey']) {
    assert.throws(() => validateWalletActivation({ NEXT_PUBLIC_TELEGRAM_WALLET_MODE: value }), /NEXT_PUBLIC_TELEGRAM_WALLET_MODE/);
  }
});

test('explicit paired legacy development configuration remains supported', () => {
  const env = { NODE_ENV: 'development', NEXT_PUBLIC_PRIVY_APP_ID: 'configured-development-app',
    NEXT_PUBLIC_TELEGRAM_WALLET_MODE: 'off', MINIAPP_ACCESS_MODE: 'waitlist' };
  assert.deepEqual(validateWalletActivation(env), { publicMode: 'off', serverMode: 'waitlist' });
});
test('server configuration requires explicit legacy inventory and every server-only binding', () => {
  for (const name of Object.keys(server())) {
    const config = server(); delete config[name];
    assert.throws(() => validateServerConfig(config), new RegExp(name));
  }
  for (const count of ['0', '4', '481', '05', '5.1']) assert.throws(() => validateServerConfig({ ...server(), MINIAPP_LEGACY_USERS: count }), /inventory/);
  assert.throws(() => validateServerConfig({ ...server(), MINIAPP_ORIGIN: 'https://attacker.test' }), /origin/);
  const sensitive = 'a-secret-value-with-newline\n';
  assert.throws(() => validateServerConfig({ ...server(), PRIVY_APP_SECRET: sensitive }), error => {
    assert.equal(error.message.includes(sensitive), false);
    return true;
  });
});
