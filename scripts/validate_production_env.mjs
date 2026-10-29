const PLACEHOLDER = /YOUR_|your_|PLACEHOLDER|placeholder|CHANGE_ME|change_me|REPLACE_ME|replace_me|EXAMPLE|example/;

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

try {
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
} catch (error) {
  console.error(`FxAeon production environment invalid: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
