import { pathToFileURL } from 'node:url';

/** Read-only preflight. No users, wallets, keys, sessions or messages are created.
 *
 * Usage: node scripts/miniapp_readiness.mjs [--require-closed]
 * Required: PRIVY_APP_ID, PRIVY_APP_SECRET, MINIAPP_LEGACY_USERS=5.
 * MINIAPP_EXPECTED_WALLETS is optional for initial inventory, required in strict mode.
 * Operational policy: this is an explicitly reviewed CURRENT wallet count. Cohort
 * growth intentionally blocks deployment until an operator reconciles the inventory
 * and updates that repository variable. Never derive it from the observed count or
 * raise MINIAPP_LEGACY_USERS (fixed at 5) to accommodate wallet growth. Automated
 * reconciliation against durable reservations is separate future work.
 * Default mode permits enabled native Telegram and reports it; strict mode requires
 * all signup methods closed. Wallet-only login additionally requires signup off and
 * an enabled, authenticated empty allowlist (existing users can still log in).
 * Neither successful reads nor strict mode prove activation
 * readiness, a full-access secret, or userless-wallet / owner-quorum CREATE entitlement.
 *
 * Verified official REST documentation:
 * https://docs.privy.io/api-reference/users/get-all
 * https://docs.privy.io/api-reference/wallets/get-all
 * https://docs.privy.io/api-reference/key-quorums/get
 * https://docs.privy.io/basics/get-started/dashboard/app-secrets
 * https://docs.privy.io/wallets/global-wallets/integrate-a-global-wallet/login-with-a-global-wallet
 * https://docs.privy.io/user-management/users/managing-users/allowlist
 * Official SDK GET /v1/apps/{appId}/allowlist returns the full array, not a page:
 * https://github.com/privy-io/node-sdk/blob/main/src/resources/apps/allowlist.ts
 * Entry schema: src/resources/apps/apps.ts AllowlistEntry; API origin: src/client.ts.
 * The signup flag's schema alone does NOT prove enforcement; the documented
 * wallet allowlist restriction is required. No exception for other login methods.
 * Public config wire fields are SDK-verified, NOT claimed as documented REST fields:
 * @privy-io/api-types 0.22.0 src/resources/{apps,cross-app}.ts;
 * @privy-io/routes 0.4.1 AppsGet / GetCrossAppConnections;
 * @privy-io/js-sdk-core 0.76.x default origin https://auth.privy.io.
 * Reject schema changes until reviewed; never infer missing auth flags as disabled.
 */
export const AUTH_FLAGS = Object.freeze([
  'wallet_auth', 'email_auth', 'sms_auth', 'google_oauth', 'twitter_oauth', 'discord_oauth',
  'github_oauth', 'spotify_oauth', 'instagram_oauth', 'tiktok_oauth', 'line_oauth', 'twitch_oauth',
  'linkedin_oauth', 'apple_oauth', 'farcaster_auth', 'passkey_auth', 'passkeys_for_signup_enabled',
  'external_wallets_for_signup_enabled', 'telegram_auth', 'telegram_oauth', 'guest_auth',
  'solana_wallet_auth', 'custom_jwt_auth', 'whatsapp_enabled', 'twitter_oauth_on_mobile_enabled',
]);
const CONFIG_FIELDS = new Set([...AUTH_FLAGS,
  'id', 'name', 'logo_url', 'icon_url', 'terms_and_conditions_url', 'privacy_policy_url',
  'require_users_accept_terms', 'theme', 'accent_color', 'show_wallet_login_first', 'allowed_domains',
  'allowed_native_app_ids', 'allowed_native_app_url_schemes', 'custom_oauth_providers', 'data_classification',
  'disable_plus_emails', 'allowlist_enabled', 'allowlist_config', 'wallet_connect_cloud_project_id',
  'custom_api_url', 'embedded_wallet_config', 'enforce_wallet_uis', 'legacy_wallet_ui_config',
  'fiat_on_ramp_enabled', 'captcha_enabled', 'enabled_captcha_provider', 'mfa_methods', 'captcha_site_key',
  'verification_key', 'telegram_auth_config', 'telegram_seamless_auth_enabled', 'funding_config',
  'max_linked_wallets_per_user', 'farcaster_link_wallets_enabled', 'legal_name', 'merge_accounts_by_email',
  'smart_wallet_config',
]);
const MAX_BYTES = 1_048_576;
const MAX_PAGES = 10;
const MAX_ROWS = 1000;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (object, name) => Object.prototype.hasOwnProperty.call(object, name);
const count = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,3})$/.test(value) && Number(value) <= MAX_ROWS;
const fail = () => { throw new Error('readiness_check_failed'); };

export function inspectPublicConfig(config, connections, appId) {
  const output = { publicConfigRecognized: false, publicSignupDisabled: false, enabledSignupMethodCount: 0,
    telegramSignupDisabled: false, customJwtSignupDisabled: false, globalWalletLoginDisabled: false,
    allowlistEnabled: false, walletAllowlistRequired: false };
  if (!object(config) || config.id !== appId || config.data_classification !== 'public'
    || Object.keys(config).some(key => !CONFIG_FIELDS.has(key))
    || AUTH_FLAGS.some(key => !own(config, key) || typeof config[key] !== 'boolean')
    || (own(config, 'allowlist_enabled') && typeof config.allowlist_enabled !== 'boolean')
    // This existing production custom domain has been explicitly reviewed. It is
    // configuration evidence only: requests still use the fixed Privy API origins.
    || !own(config, 'custom_api_url') || ![null, 'https://privy.fxaeon.com'].includes(config.custom_api_url)
    || !Array.isArray(config.custom_oauth_providers)
    || !object(connections) || connections.data_classification !== 'public' || !Array.isArray(connections.connections)
    || Object.keys(connections).some(key => !['connections', 'data_classification'].includes(key))) return output;
  // A mobile modifier cannot open Twitter login when its parent OAuth switch is off.
  // Still require its boolean above, but count Twitter only via twitter_oauth.
  let enabled = AUTH_FLAGS.filter(key => key !== 'twitter_oauth_on_mobile_enabled' && config[key]).length;
  for (const provider of config.custom_oauth_providers) {
    if (!object(provider) || typeof provider.enabled !== 'boolean' || typeof provider.provider !== 'string'
      || !provider.provider.startsWith('custom:')
      || Object.keys(provider).some(key => !['provider', 'provider_display_name', 'provider_icon_url', 'enabled'].includes(key))) return output;
    if (provider.enabled) enabled++;
  }
  if (own(config, 'telegram_seamless_auth_enabled')) {
    if (typeof config.telegram_seamless_auth_enabled !== 'boolean') return output;
    if (config.telegram_seamless_auth_enabled) enabled++;
  }
  if (own(config, 'telegram_auth_config')) {
    const telegram = config.telegram_auth_config;
    if (!object(telegram) || typeof telegram.seamless_auth_enabled !== 'boolean' || typeof telegram.link_enabled !== 'boolean'
      || Object.keys(telegram).some(key => !['bot_id', 'bot_name', 'link_enabled', 'seamless_auth_enabled'].includes(key))) return output;
    if (telegram.seamless_auth_enabled) enabled++;
  }
  // Global wallet login is configured separately, not an invented global_wallet_auth flag.
  for (const connection of connections.connections) {
    if (!object(connection) || typeof connection.provider_app_id !== 'string' || !/^[a-z0-9]{20,40}$/.test(connection.provider_app_id)
      || typeof connection.read_only !== 'boolean') return output;
  }
  enabled += connections.connections.length;
  return { publicConfigRecognized: true, publicSignupDisabled: enabled === 0, enabledSignupMethodCount: enabled,
    allowlistEnabled: config.allowlist_enabled === true,
    walletAllowlistRequired: enabled === 1 && config.wallet_auth && !config.solana_wallet_auth
      && !config.external_wallets_for_signup_enabled && config.allowlist_enabled === true,
    telegramSignupDisabled: !config.telegram_auth && !config.telegram_oauth
      && config.telegram_seamless_auth_enabled !== true && config.telegram_auth_config?.seamless_auth_enabled !== true,
    customJwtSignupDisabled: !config.custom_jwt_auth, globalWalletLoginDisabled: connections.connections.length === 0 };
}

/** Fixed origins, GET only, no redirects or response/error text returned to callers. */
async function readJson(url, headers, fetchImpl, timeoutMs) {
  const parsed = new URL(url);
  if (!['https://auth.privy.io', 'https://api.privy.io'].includes(parsed.origin) || parsed.username || parsed.password) fail();
  const controller = new AbortController(); let reader; let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); reject(new Error('readiness_check_failed')); }, timeoutMs);
  });
  const read = async () => {
    const response = await fetchImpl(parsed.href, { method: 'GET', headers, redirect: 'error', signal: controller.signal });
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); fail(); }
    if (!response.ok || response.redirected || !response.body
      || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
      || Number(response.headers.get('content-length')) > MAX_BYTES) {
      void response.body?.cancel().catch(() => {}); fail();
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true }); let text = ''; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) fail();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { void reader.cancel().catch(() => {}); fail(); }
      text += decoder.decode(value, { stream: true });
    }
    const value = JSON.parse(text + decoder.decode());
    if (!object(value) && !Array.isArray(value)) fail();
    return value;
  };
  try { return await Promise.race([read(), expired]); }
  catch { fail(); }
  finally { clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {}); }
}

async function inventory(kind, read) {
  const ids = new Set(); const owners = new Set(); const cursors = new Set(); let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`https://api.privy.io/v1/${kind}`);
    url.searchParams.set('limit', '100');
    if (kind === 'wallets') url.searchParams.set('include_archived', 'true');
    if (cursor) url.searchParams.set('cursor', cursor);
    const body = await read(url.href);
    if (!Array.isArray(body.data) || body.data.length > 100) fail();
    for (const row of body.data) {
      if (!object(row) || typeof row.id !== 'string' || !row.id || row.id.length > 200 || ids.has(row.id)) fail();
      ids.add(row.id);
      if (ids.size > MAX_ROWS) fail();
      if (kind === 'wallets') {
        if (!own(row, 'owner_id') || (row.owner_id !== null && typeof row.owner_id !== 'string')) fail();
        if (row.owner_id !== null && !row.owner_id.startsWith('did:privy:')) {
          if (!/^[A-Za-z0-9_-]{1,100}$/.test(row.owner_id)) fail();
          owners.add(row.owner_id);
        }
      }
    }
    // The documented optional cursor is omitted/null at the end; empty/URL cursors are never followed as destinations.
    const next = body.next_cursor;
    if (next === undefined || next === null) return { count: ids.size, owners };
    if (typeof next !== 'string' || next.length < 1 || next.length > 512 || cursors.has(next) || !body.data.length) fail();
    cursors.add(next); cursor = next;
  }
  fail();
}

/** SDK's complete, unpaginated Array<AllowlistEntry>. Never retain or emit identifiers. */
async function allowlistCount(appId, read) {
  const entries = await read(`https://api.privy.io/v1/apps/${appId}/allowlist`);
  if (!Array.isArray(entries) || entries.length > MAX_ROWS) fail();
  const ids = new Set();
  for (const entry of entries) {
    if (!object(entry) || Object.keys(entry).some(key => !['id', 'acceptedAt', 'appId', 'type', 'value'].includes(key))
      || typeof entry.id !== 'string' || !entry.id || entry.id.length > 200 || ids.has(entry.id)
      || entry.appId !== appId || !['email', 'emailDomain', 'phone', 'wallet'].includes(entry.type)
      || typeof entry.value !== 'string' || !entry.value || entry.value.length > 512
      || (entry.acceptedAt !== null && (!Number.isSafeInteger(entry.acceptedAt) || entry.acceptedAt < 0))) fail();
    ids.add(entry.id);
  }
  return entries.length;
}

/** Returns only fixed-name booleans and counts, including on every failure path.
 * Reads are point-in-time inventory checks, not a transactionally consistent provider snapshot.
 */
export async function probeReadiness({ env = process.env, fetchImpl = globalThis.fetch, requireClosed = false, timeoutMs = 8000 } = {}) {
  const report = { readOnlyChecksPassed: false, activationReady: false, requireClosed: requireClosed === true,
    environmentValid: false, publicConfigRecognized: false, publicSignupDisabled: false, enabledSignupMethodCount: 0,
    telegramSignupDisabled: false, customJwtSignupDisabled: false, globalWalletLoginDisabled: false,
    allowlistEnabled: false, walletAllowlistRequired: false, allowlistInventoryComplete: false,
    allowlistEntryCount: 0, emptyAllowlistVerified: false,
    credentialsValid: false, userApiReadable: false, walletApiReadable: false, userInventoryComplete: false, walletInventoryComplete: false,
    userCount: 0, walletCount: 0, legacyBaseline: 5, userInventoryMatchesBaseline: false,
    walletBaselineConfigured: false, walletInventoryMatchesBaseline: false, ownerQuorumCount: 0, ownerQuorumReadCount: 0,
    ownerQuorumSampled: false, ownerQuorumSampleVerified: false,
    ownerQuorumReadVerified: false, userlessWalletCreationVerified: false, ownerQuorumCreationVerified: false,
    fullAccessSecretVerified: false, manualCapabilityVerificationRequired: true, probeFailed: false };
  const appId = env.PRIVY_APP_ID; const secret = env.PRIVY_APP_SECRET;
  if (typeof requireClosed !== 'boolean' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000
    || typeof appId !== 'string' || !/^[a-z0-9]{20,40}$/.test(appId)
    || typeof secret !== 'string' || !secret || secret.length > 512 || /[\s:]/.test(secret)
    || env.MINIAPP_LEGACY_USERS !== '5'
    || (env.MINIAPP_ORIGIN !== undefined && env.MINIAPP_ORIGIN !== 'https://fxaeon.com')
    || (env.MINIAPP_EXPECTED_WALLETS !== undefined && !count(env.MINIAPP_EXPECTED_WALLETS))
    || (requireClosed && env.MINIAPP_EXPECTED_WALLETS === undefined)) return report;
  report.environmentValid = true;
  report.walletBaselineConfigured = env.MINIAPP_EXPECTED_WALLETS !== undefined;
  const publicHeaders = { accept: 'application/json', 'privy-app-id': appId, origin: 'https://fxaeon.com' };
  const authenticatedHeaders = { ...publicHeaders, authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString('base64')}` };
  const deadline = Date.now() + 45_000; let requests = 0;
  const read = (url, headers) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || ++requests > 64) fail();
    return readJson(url, headers, fetchImpl, Math.min(timeoutMs, remaining));
  };
  const readPublic = url => read(url, publicHeaders);
  const readAuthenticated = url => read(url, authenticatedHeaders);
  const readConfig = async () => {
    const checked = { ...inspectPublicConfig(
      await readPublic(`https://auth.privy.io/api/v1/apps/${appId}`),
      await readPublic(`https://auth.privy.io/api/v1/apps/${appId}/cross-app/connections`), appId),
    allowlistInventoryComplete: false, allowlistEntryCount: 0, emptyAllowlistVerified: false };
    if (checked.publicConfigRecognized && checked.walletAllowlistRequired) {
      try {
        checked.allowlistEntryCount = await allowlistCount(appId, readAuthenticated);
        checked.allowlistInventoryComplete = true;
        checked.emptyAllowlistVerified = checked.allowlistEntryCount === 0;
        if (checked.emptyAllowlistVerified) {
          checked.publicSignupDisabled = true;
          checked.enabledSignupMethodCount = 0;
        }
      } catch { report.probeFailed = true; }
    }
    return checked;
  };
  // Keep diagnostics independent: an unrecognized config must not hide readable inventory.
  try { Object.assign(report, await readConfig()); } catch { report.probeFailed = true; }
  try {
    const users = await inventory('users', readAuthenticated);
    report.userCount = users.count; report.userApiReadable = true; report.userInventoryComplete = true;
    report.userInventoryMatchesBaseline = users.count === 5;
  } catch { report.probeFailed = true; }
  try {
    const wallets = await inventory('wallets', readAuthenticated);
    report.walletCount = wallets.count; report.walletApiReadable = true; report.walletInventoryComplete = true;
    report.walletInventoryMatchesBaseline = report.walletBaselineConfigured && wallets.count === Number(env.MINIAPP_EXPECTED_WALLETS);
    report.ownerQuorumCount = wallets.owners.size;
    // Sample at most one existing owner for read-access diagnostics; inventory above
    // still includes every wallet and owner. This never proves CREATE entitlement.
    // ownerQuorumReadVerified means ALL inventoried owners were read (only size 1).
    report.ownerQuorumSampled = wallets.owners.size > 0;
    for (const owner of [...wallets.owners].slice(0, 1)) {
      const quorum = await readAuthenticated(`https://api.privy.io/v1/key_quorums/${owner}`);
      if (quorum.id !== owner || !Number.isSafeInteger(quorum.authorization_threshold) || quorum.authorization_threshold < 1
        || !Array.isArray(quorum.authorization_keys)
        || quorum.authorization_keys.some(key => !object(key) || typeof key.public_key !== 'string' || !key.public_key)
        || (quorum.user_ids != null && !Array.isArray(quorum.user_ids))) fail();
      report.ownerQuorumReadCount++;
    }
    report.ownerQuorumSampleVerified = report.ownerQuorumReadCount === 1;
    report.ownerQuorumReadVerified = wallets.owners.size > 0 && report.ownerQuorumReadCount === wallets.owners.size;
  } catch { report.probeFailed = true; }
  report.credentialsValid = report.userApiReadable && report.walletApiReadable;
  // Recheck flags after the inventory read, so a visible concurrent reopen cannot pass strict mode.
  if (report.publicConfigRecognized) {
    try {
      const after = await readConfig();
      for (const key of ['allowlistEnabled', 'allowlistInventoryComplete', 'emptyAllowlistVerified']) report[key] &&= after[key];
      report.walletAllowlistRequired ||= after.walletAllowlistRequired;
      report.allowlistEntryCount = Math.max(report.allowlistEntryCount, after.allowlistEntryCount);
      if (!after.publicConfigRecognized) { report.publicConfigRecognized = false; report.publicSignupDisabled = false; }
      else {
        for (const key of ['publicSignupDisabled', 'telegramSignupDisabled', 'customJwtSignupDisabled', 'globalWalletLoginDisabled']) report[key] &&= after[key];
        report.enabledSignupMethodCount = Math.max(report.enabledSignupMethodCount, after.enabledSignupMethodCount);
      }
    } catch { report.probeFailed = true; report.publicSignupDisabled = false; }
  }
  report.readOnlyChecksPassed = !report.probeFailed && report.publicConfigRecognized && report.credentialsValid
    && report.userInventoryMatchesBaseline && (!report.walletBaselineConfigured || report.walletInventoryMatchesBaseline)
    && (!requireClosed || report.publicSignupDisabled);
  return report;
}

/** Only one JSON line is emitted. No raw exceptions, URLs, app IDs, provider data or credentials are printed. */
export async function main({ argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch,
  write = text => process.stdout.write(text), timeoutMs = 8000 } = {}) {
  let report;
  if (argv.some(arg => arg !== '--require-closed') || argv.length > 1) report = { readOnlyChecksPassed: false, activationReady: false, argumentsValid: false };
  else {
    try { report = await probeReadiness({ env, fetchImpl, requireClosed: argv.includes('--require-closed'), timeoutMs }); }
    catch { report = { readOnlyChecksPassed: false, activationReady: false, probeFailed: true }; }
  }
  write(`${JSON.stringify(report)}\n`);
  return report.readOnlyChecksPassed ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
