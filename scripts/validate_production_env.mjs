import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PLACEHOLDER = /YOUR_|your_|PLACEHOLDER|placeholder|CHANGE_ME|change_me|REPLACE_ME|replace_me|EXAMPLE|example/;

/** Production modes must agree; paired legacy mode remains available explicitly. */
export function validateWalletActivation(env = {}) {
  const publicMode = env.NEXT_PUBLIC_TELEGRAM_WALLET_MODE || 'off';
  const serverMode = env.MINIAPP_ACCESS_MODE || 'waitlist';
  if (!['off', 'passkey'].includes(publicMode)) throw new Error('NEXT_PUBLIC_TELEGRAM_WALLET_MODE must be "off", "passkey", or unset');
  if (!['waitlist', 'passkey'].includes(serverMode)) throw new Error('MINIAPP_ACCESS_MODE must be "waitlist", "passkey", or unset');
  if ((publicMode === 'passkey') !== (serverMode === 'passkey')) {
    throw new Error('Production wallet modes must match: use passkey/passkey or off/waitlist');
  }
  if (env.PRIVY_PUBLIC_SIGNUP_DISABLED && env.PRIVY_PUBLIC_SIGNUP_DISABLED !== 'yes') throw new Error('PRIVY_PUBLIC_SIGNUP_DISABLED must be "yes" after verification or unset');
  if ((publicMode === 'passkey' || serverMode === 'passkey') && env.PRIVY_PUBLIC_SIGNUP_DISABLED !== 'yes') {
    throw new Error('Passkey activation requires explicit verification that native public signup is closed (PRIVY_PUBLIC_SIGNUP_DISABLED=yes)');
  }
  return { publicMode, serverMode };
}

/** Separate from the browser build environment; never print any binding value. */
export function validateServerConfig(env = {}) {
  validateWalletActivation(env);
  if (env.MINIAPP_ORIGIN !== 'https://fxaeon.com') throw new Error('MINIAPP_ORIGIN must be the production origin');
  if (!/^(?:[5-9]|[1-9]\d{1,2})$/.test(env.MINIAPP_LEGACY_USERS ?? '') || Number(env.MINIAPP_LEGACY_USERS) > 480) {
    throw new Error('MINIAPP_LEGACY_USERS requires the reviewed existing-user inventory (5 through 480)');
  }
  for (const name of ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'RESEND_API_KEY', 'MINIAPP_OPERATOR_TOKEN', 'TELEGRAM_BOT_TOKEN']) {
    const value = env[name];
    if (typeof value !== 'string' || value.length < (name === 'MINIAPP_OPERATOR_TOKEN' ? 32 : 16)
      || value.length > (name === 'MINIAPP_OPERATOR_TOKEN' ? 505 : 4096) || !/^[!-~]+$/.test(value) || PLACEHOLDER.test(value)) {
      throw new Error(`${name} is required and must contain a valid server binding`);
    }
  }
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(env.TELEGRAM_BOT_TOKEN)) throw new Error('TELEGRAM_BOT_TOKEN has an invalid format');
}

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  if (PLACEHOLDER.test(value)) throw new Error(`${name} contains a placeholder value`);
  return value;
}

function assertAlchemyRpc(name, expectedHost) {
  const value = requireValue(name);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS`);
  if (url.hostname !== expectedHost) throw new Error(`${name} must use ${expectedHost}`);
  if (url.port || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} cannot include credentials, a custom port, query, or fragment`);
  }
  if (!/^\/v2\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error(`${name} must use an Alchemy /v2 application endpoint`);
  }
}

function assertOptionalAlchemyRpc(name, expectedHost) {
  const value = process.env[name]?.trim();
  if (value) assertAlchemyRpc(name, expectedHost);
}

function assertOptionalInfuraRpc(name, expectedHost) {
  if (!process.env[name]?.trim()) return;
  const value = requireValue(name);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an absolute HTTPS URL`); }
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS`);
  if (url.hostname !== expectedHost) throw new Error(`${name} must use ${expectedHost}`);
  if (url.port || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} cannot include credentials, a custom port, query, or fragment`);
  }
  if (!/^\/v3\/[^/]+\/?$/.test(url.pathname)) throw new Error(`${name} must use an Infura /v3 project endpoint`);
}

function assertTelegramMiniAppUrl() {
  const value = requireValue('NEXT_PUBLIC_TELEGRAM_APP_URL');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('NEXT_PUBLIC_TELEGRAM_APP_URL must be an absolute HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== 't.me') {
    throw new Error('NEXT_PUBLIC_TELEGRAM_APP_URL must use https://t.me/...');
  }
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_TELEGRAM_APP_URL must be a clean Mini App launcher URL without credentials, query, or fragment');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 1) {
    throw new Error('NEXT_PUBLIC_TELEGRAM_APP_URL must include the FxAeon bot path');
  }
}

function assertAlchemyDataKey() {
  const value = requireValue('NEXT_PUBLIC_ALCHEMY_DATA_API_KEY');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    throw new Error('NEXT_PUBLIC_ALCHEMY_DATA_API_KEY must be a valid browser Data API key');
  }
}

function assertTelegramBotToken() {
  const value = requireValue('TELEGRAM_BOT_TOKEN');
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(value)) {
    throw new Error('TELEGRAM_BOT_TOKEN has an invalid format');
  }
}

/** Only "on" enables the admission gate; reject near misses that would silently leave it off. */
function assertTelegramAdmissionFlag() {
  const value = process.env.NEXT_PUBLIC_TELEGRAM_ADMISSION?.trim() ?? '';
  if (value && value !== 'on' && value !== 'off') {
    throw new Error('NEXT_PUBLIC_TELEGRAM_ADMISSION must be "on", "off", or unset');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
try {
  validateWalletActivation(process.env);
  if (process.argv.includes('--server')) {
    validateServerConfig(process.env);
    console.log('FxAeon server environment verified: reviewed mode and required server bindings are structurally valid.');
  } else {
  // Local screenshot/fork settings are valid for disposable local builds,
  // but must never be accepted as production deployment configuration. Whole
  // families are rejected, so a new local-only variable needs no edit here.
  const localOnly = /^NEXT_PUBLIC_FX_(SCREENSHOT|LOCAL_FORK|ANVIL)_/;
  for (const name of Object.keys(process.env).filter((key) => localOnly.test(key)).sort()) {
    if (process.env[name]?.trim()) throw new Error(`${name} must be unset for production`);
  }
  const privyAppId = requireValue('NEXT_PUBLIC_PRIVY_APP_ID');
  if (/\s/.test(privyAppId)) throw new Error('NEXT_PUBLIC_PRIVY_APP_ID cannot contain whitespace');
  // This public ID is reserved for local development and must never be
  // embedded in the production financial bundle.
  if (privyAppId === 'cmu5tz4f000lp0cl5qtd87sro') {
    throw new Error('NEXT_PUBLIC_PRIVY_APP_ID is the local-development application; use the protected production Privy application ID');
  }

  assertAlchemyRpc('NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL', 'eth-mainnet.g.alchemy.com');
  assertAlchemyRpc('NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL', 'base-mainnet.g.alchemy.com');
  assertOptionalAlchemyRpc('NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL', 'eth-mainnet.g.alchemy.com');
  assertOptionalAlchemyRpc('NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL', 'base-mainnet.g.alchemy.com');
  assertOptionalInfuraRpc('NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL', 'mainnet.infura.io');
  assertOptionalInfuraRpc('NEXT_PUBLIC_INFURA_BASE_RPC_URL', 'base-mainnet.infura.io');
  assertAlchemyDataKey();
  assertTelegramMiniAppUrl();
  assertTelegramBotToken();
  assertTelegramAdmissionFlag();

  console.log('FxAeon production environment verified: Privy, RPC, and Telegram configuration are structurally valid.');
  }
} catch (error) {
  console.error(`FxAeon production environment invalid: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
}
