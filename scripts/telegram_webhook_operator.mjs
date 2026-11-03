import { pathToFileURL } from 'node:url';
import { inspectTelegramWebhook, syncTelegramBot } from './sync_telegram_bot.mjs';

/** Only two fixed actions; neither accepts a destination or prints provider errors. */
export async function runWebhookOperator(env = {}, { fetchImpl = globalThis.fetch } = {}) {
  const action = env.TELEGRAM_WEBHOOK_ACTION || 'inspect-webhook';
  if (action !== 'inspect-webhook' && action !== 'migrate-webhook') throw new Error('Invalid webhook action');
  const mode = env.TELEGRAM_WEBHOOK_DRY_RUN ?? 'true';
  if (mode !== 'true' && mode !== 'false') throw new Error('Invalid dry-run option');
  const reviewed = env.TELEGRAM_REVIEWED_WEBHOOK_SHA256;
  if (action === 'migrate-webhook' && (typeof reviewed !== 'string' || !/^[a-f0-9]{64}$/.test(reviewed))) {
    throw new Error('A reviewed webhook URL SHA-256 is required');
  }
  if (mode === 'true') return { action: action === 'inspect-webhook' ? 'inspect-webhook' : 'migrate-webhook', dryRun: true };
  const token = env.TELEGRAM_BOT_TOKEN;
  if (typeof token !== 'string' || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('Invalid bot credential');
  if (action === 'inspect-webhook') return inspectTelegramWebhook({ token, fetchImpl });
  await syncTelegramBot({ token, fetchImpl, webAppUrl: 'https://fxaeon.com/', reviewedWebhookSha256: reviewed });
  return { action: 'migrate-webhook', success: true, webhookVerified: true, menuVerified: true };
}

export async function main(env = process.env, dependencies = {}) {
  try {
    const result = await runWebhookOperator(env, dependencies);
    (dependencies.log ?? console.log)(JSON.stringify(result));
    return 0;
  } catch {
    (dependencies.errorLog ?? console.error)('Webhook operation failed; inspect configuration before retrying.');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
