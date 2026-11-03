import { pathToFileURL } from 'node:url';
import { probeReadiness } from './miniapp_readiness.mjs';

export const OPERATOR_URL = 'https://fxaeon.com/api/miniapp-operator';
const ACTIONS = new Set(['status', 'list', 'approve', 'dispatch', 'sync-server-config']);
const SERVER_SECRETS = ['PRIVY_APP_SECRET', 'RESEND_API_KEY', 'MINIAPP_OPERATOR_TOKEN', 'TELEGRAM_BOT_TOKEN', 'PRIVY_APP_ID'];
const MAX_RESPONSE_BYTES = 1_048_576;

class OperatorError extends Error {}
const fail = message => { throw new OperatorError(message); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const identity = value => integer(value) && value > 0;

/** Default is a network-free plan. Neither environment variables nor CLI arguments can change the destination. */
export function parseOptions(argv = [], env = {}) {
  let action = env.MINIAPP_OPERATOR_ACTION || 'status';
  let userIdsJson = env.MINIAPP_OPERATOR_USER_IDS || '[]';
  let mode;
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (seen.has(argument)) fail('Duplicate operator option.');
    seen.add(argument);
    if (argument === '--action' || argument === '--user-ids') {
      if (argv[i + 1] === undefined) fail('Missing operator option value.');
      if (argument === '--action') action = argv[++i];
      else userIdsJson = argv[++i];
    } else if (argument === '--execute' || argument === '--dry-run') {
      if (mode !== undefined) fail('Choose either execute or dry-run.');
      mode = argument === '--dry-run';
    } else fail('Unknown operator option.');
  }
  if (!ACTIONS.has(action)) fail('Unknown operator action.');
  if (typeof userIdsJson !== 'string' || userIdsJson.length > 16_384) fail('Invalid Telegram ID array.');
  let userIds;
  try { userIds = JSON.parse(userIdsJson); } catch { fail('Invalid Telegram ID array.'); }
  if (!Array.isArray(userIds) || userIds.length > 480 || !userIds.every(identity)
    || new Set(userIds).size !== userIds.length) fail('Expected at most 480 distinct positive safe-integer Telegram IDs.');
  if (action === 'approve' ? userIds.length === 0 : userIds.length !== 0) fail('Telegram IDs are required only for approve.');
  const configuredMode = env.MINIAPP_OPERATOR_DRY_RUN ?? 'true';
  if (mode === undefined && configuredMode !== 'true' && configuredMode !== 'false') fail('Invalid dry-run setting.');
  return { action, userIds, dryRun: mode ?? configuredMode === 'true' };
}

function bearer(value, name) {
  const operator = name === 'MINIAPP_OPERATOR_TOKEN';
  // Match the backend's minimum secret length and 512-character Authorization header ceiling.
  if (typeof value !== 'string' || value.length < (operator ? 32 : 16)
    || value.length > (operator ? 505 : 4096) || !/^[!-~]+$/.test(value)) {
    fail(`Missing or invalid ${name}.`);
  }
  return value;
}

/** Bounded response reading; provider errors and transport exceptions never enter logs. No retries for writes. */
async function requestJson(url, init, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new OperatorError('Request timed out; inspect status before retrying a write.'));
    }, timeoutMs);
  });
  const operation = (async () => {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel();
      fail(`Request rejected (HTTP ${integer(response.status) ? response.status : 0}).`);
    }
    if (!response.body) fail('Empty response.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let body = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); fail('Response exceeds the operator limit.'); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    try { return JSON.parse(body); } catch { fail('Invalid JSON response.'); }
  })();
  try { return await Promise.race([operation, deadline]); }
  catch (error) {
    if (error instanceof OperatorError) throw error;
    fail('Request failed; inspect status before retrying a write.');
  } finally { clearTimeout(timeout); }
}

function safeCapacity(value) {
  if (!value || !integer(value.used) || !integer(value.legacy) || value.max !== 480
    || value.used < value.legacy || value.used > 480) return undefined;
  return { used: value.used, legacy: value.legacy, max: 480 };
}

/** Public Actions logs must contain counts only, never enrollment IDs, timestamps, contacts or credentials. */
export function summarizeOperator(action, response) {
  if (!response || typeof response !== 'object' || response.ok === false || response.success === false) fail('Operator response was unsuccessful.');
  const summary = { action };
  const capacity = safeCapacity(response.capacity);
  if (capacity) summary.capacity = capacity;
  const rows = Array.isArray(response) ? response : response.users ?? response.enrollments ?? response.approved;
  if (Array.isArray(rows)) {
    summary.count = rows.filter(row => identity(row) || (row && identity(row.userId))).length;
  }
  for (const name of ['count', 'sent', 'failed', 'deferred', 'uncertain', 'pending']) {
    if (integer(response[name])) summary[name] = response[name];
  }
  for (const field of ['dispatch', 'notifications']) {
    if (response[field] && typeof response[field] === 'object') {
      summary[field] = {};
      for (const name of ['sent', 'failed', 'deferred', 'uncertain']) {
        if (integer(response[field][name])) summary[field][name] = response[field][name];
      }
    }
  }
  return summary;
}

function configVariables(env) {
  // The known inventory is five existing users; require an explicit reviewed count, never silently default it.
  if (typeof env.MINIAPP_LEGACY_USERS !== 'string' || !/^(?:[5-9]|[1-9]\d{1,2})$/.test(env.MINIAPP_LEGACY_USERS)
    || Number(env.MINIAPP_LEGACY_USERS) > 480) fail('MINIAPP_LEGACY_USERS must explicitly contain the reviewed inventory count (5 through 480).');
  const mode = env.MINIAPP_ACCESS_MODE || 'waitlist';
  if (!['waitlist', 'passkey'].includes(mode)) fail('Server setup only supports waitlist or passkey mode.');
  if (mode === 'passkey' && env.PRIVY_PUBLIC_SIGNUP_DISABLED !== 'yes') fail('Passkey setup requires explicit native public-signup closure verification.');
  if (env.MINIAPP_ORIGIN && env.MINIAPP_ORIGIN !== 'https://fxaeon.com') fail('Server origin must be https://fxaeon.com.');
  const miniappUrl = env.TELEGRAM_MINIAPP_URL || env.NEXT_PUBLIC_TELEGRAM_APP_URL || 'https://t.me/FxAeonBot';
  if (miniappUrl !== 'https://t.me/FxAeonBot') fail('Notification launcher must be the reviewed FxAeon Telegram URL.');
  const sender = env.RESEND_FROM || 'FxAeon <notifications@fxaeon.com>';
  if (sender !== 'FxAeon <notifications@fxaeon.com>') fail('Notification sender must be the reviewed FxAeon sender.');
  if (env.TELEGRAM_BOT_TOKEN && !/^\d+:[A-Za-z0-9_-]{20,}$/.test(env.TELEGRAM_BOT_TOKEN)) fail('Invalid TELEGRAM_BOT_TOKEN.');
  return {
    MINIAPP_ORIGIN: { type: 'plain_text', value: 'https://fxaeon.com' },
    MINIAPP_ACCESS_MODE: { type: 'plain_text', value: mode },
    MINIAPP_LEGACY_USERS: { type: 'plain_text', value: env.MINIAPP_LEGACY_USERS },
    TELEGRAM_MINIAPP_URL: { type: 'plain_text', value: miniappUrl },
    RESEND_FROM: { type: 'plain_text', value: sender },
    TELEGRAM_BOT_ID: { type: 'plain_text', value: env.TELEGRAM_BOT_TOKEN?.split(':')[0] ?? '<derived at execution>' },
    ...(mode === 'passkey' ? { PRIVY_PUBLIC_SIGNUP_DISABLED: { type: 'plain_text', value: 'yes' } } : {}),
  };
}

async function syncServerConfig(env, dryRun, fetchImpl, timeoutMs) {
  const variables = configVariables(env);
  const plan = { action: 'sync-server-config', dryRun, project: 'fxaeon', environment: 'production',
    secretNames: [...SERVER_SECRETS], variableNames: Object.keys(variables),
    mode: variables.MINIAPP_ACCESS_MODE.value, legacy: Number(env.MINIAPP_LEGACY_USERS) };
  if (dryRun) return plan;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (typeof account !== 'string' || !/^[a-f0-9]{32}$/i.test(account)) fail('Missing or invalid CLOUDFLARE_ACCOUNT_ID.');
  const auth = bearer(env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN');
  const envVars = { ...variables };
  for (const name of SERVER_SECRETS) {
    const value = bearer(env[name], name);
    envVars[name] = { type: 'secret_text', value };
  }
  if (variables.MINIAPP_ACCESS_MODE.value === 'passkey') {
    const readiness = await probeReadiness({ env, fetchImpl, requireClosed: true, timeoutMs });
    if (!readiness.readOnlyChecksPassed || !readiness.publicSignupDisabled || !readiness.walletInventoryMatchesBaseline) {
      fail('Passkey activation blocked by the strict read-only provider check.');
    }
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/fxaeon`;
  const headers = { authorization: `Bearer ${auth}`, 'content-type': 'application/json' };
  const current = await requestJson(url, { method: 'GET', headers }, fetchImpl, timeoutMs);
  const production = current?.result?.deployment_configs?.production;
  if (current?.success !== true || current.result?.name !== 'fxaeon' || !production) fail('Unable to verify the production Pages project.');
  const previousLegacy = production.env_vars?.MINIAPP_LEGACY_USERS?.value;
  if (production.env_vars?.MINIAPP_LEGACY_USERS && (typeof previousLegacy !== 'string'
    || !/^\d+$/.test(previousLegacy) || Number(previousLegacy) > Number(env.MINIAPP_LEGACY_USERS))) {
    fail('Refusing to lower or replace an unreadable existing legacy baseline.');
  }
  // PATCH only named bindings, preserving every unrelated binding and all preview configuration.
  // Match Wrangler's use of the existing config hash for projects configured through wrangler.toml.
  // https://developers.cloudflare.com/api/typescript/resources/pages/subresources/projects/methods/edit/
  const updated = await requestJson(url, { method: 'PATCH', headers, body: JSON.stringify({
    deployment_configs: { production: {
      env_vars: envVars,
      ...(typeof production.wrangler_config_hash === 'string' ? { wrangler_config_hash: production.wrangler_config_hash } : {}),
    } },
  }) }, fetchImpl, timeoutMs);
  if (updated?.success !== true) fail('Cloudflare rejected server configuration.');
  const verified = await requestJson(url, { method: 'GET', headers }, fetchImpl, timeoutMs);
  const actual = verified?.result?.deployment_configs?.production?.env_vars;
  if (verified?.success !== true || verified.result?.name !== 'fxaeon' || !actual
    || SERVER_SECRETS.some(name => actual[name]?.type !== 'secret_text')
    || Object.keys(variables).some(name => actual[name]?.type !== 'plain_text' || actual[name]?.value !== variables[name].value)) {
    fail('Server configuration readback failed; inspect configuration before retrying.');
  }
  const preserved = (before, after, updatedNames = []) => Object.entries(before ?? {}).every(([name, binding]) =>
    updatedNames.includes(name) || binding == null || (after?.[name]?.type === binding.type
      && (binding.type === 'secret_text' || after[name].value === binding.value)));
  if (!preserved(production.env_vars, actual, Object.keys(envVars))
    || !preserved(current.result.deployment_configs.preview?.env_vars, verified.result.deployment_configs.preview?.env_vars)
    || JSON.stringify(production.d1_databases) !== JSON.stringify(verified.result.deployment_configs.production.d1_databases)) {
    fail('Unrelated Pages bindings changed; inspect configuration before retrying.');
  }
  return { ...plan, synced: true };
}

export async function runOperator(options, { env = {}, fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) fail('Invalid request timeout.');
  // Validate again for programmatic callers as well as the CLI.
  const validated = parseOptions(['--action', options.action, '--user-ids', JSON.stringify(options.userIds ?? []),
    options.dryRun === false ? '--execute' : '--dry-run']);
  const { action, userIds, dryRun } = validated;
  if (action === 'sync-server-config') return syncServerConfig(env, dryRun, fetchImpl, timeoutMs);
  const payload = { action: action === 'status' ? 'list' : action, ...(action === 'approve' ? { userIds } : {}) };
  if (dryRun) return { action, dryRun: true, url: OPERATOR_URL,
    payload: { action: payload.action, ...(action === 'approve' ? { userCount: userIds.length } : {}) } };
  const token = bearer(env.MINIAPP_OPERATOR_TOKEN, 'MINIAPP_OPERATOR_TOKEN');
  const response = await requestJson(OPERATOR_URL, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }, fetchImpl, timeoutMs);
  return { ...summarizeOperator(action, response), dryRun: false };
}

function auditAction(value) {
  switch (value) {
    case 'status': return 'status';
    case 'list': return 'list';
    case 'approve': return 'approve';
    case 'dispatch': return 'dispatch';
    case 'sync-server-config': return 'sync-server-config';
    default: return 'unknown';
  }
}

function auditCount(value, max = MAX_RESPONSE_BYTES) {
  // Reject strings and objects without invoking coercion or serialization hooks.
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
    ? Math.trunc(value) : null;
}

function auditDelivery(value) {
  return {
    sent: auditCount(value?.sent), failed: auditCount(value?.failed),
    deferred: auditCount(value?.deferred), uncertain: auditCount(value?.uncertain),
  };
}

/** The only success-log boundary: never serialize a result, environment, or provider object directly. */
export function publicLogRecord(result) {
  return {
    action: auditAction(result?.action),
    success: true,
    dryRun: result?.dryRun === true,
    synced: result?.synced === true,
    mode: result?.mode === 'passkey' ? 'passkey' : result?.mode === 'waitlist' ? 'waitlist' : 'not-applicable',
    count: auditCount(result?.count),
    approvalCount: auditCount(result?.payload?.userCount, 480),
    legacy: auditCount(result?.legacy, 480),
    capacity: {
      used: auditCount(result?.capacity?.used, 480),
      legacy: auditCount(result?.capacity?.legacy, 480), max: 480,
    },
    ...auditDelivery(result),
    pending: auditCount(result?.pending),
    dispatch: auditDelivery(result?.dispatch),
    notifications: auditDelivery(result?.notifications),
  };
}

/** CLI errors are intentionally static; never echo any exception message or response body. */
export async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.errorLog ?? console.error;
  try {
    const result = await runOperator(parseOptions(argv, env), { ...dependencies, env });
    log(JSON.stringify(publicLogRecord(result)));
    return 0;
  } catch {
    errorLog('Operator failed; inspect private configuration and status before retrying.');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
