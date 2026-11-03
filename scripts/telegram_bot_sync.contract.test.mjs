import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { syncTelegramBot, validatedWebAppUrl, BOT_COMMANDS, BOT_PROFILE, TELEGRAM_WEBHOOK_URL, telegramWebhookSecret } from './sync_telegram_bot.mjs';

// Existing metadata tests use an owned webhook. Dedicated tests below exercise
// ownership refusal, installation, readback, and derivation with actual calls.
function withWebhook(fetchImpl) {
  return async (input, init) => {
    const method = new URL(input).pathname.split('/').pop();
    if (method === 'getWebhookInfo') return { ok: true, status: 200, json: async () => ({ ok: true, result: { url: TELEGRAM_WEBHOOK_URL, allowed_updates: ['message'] } }) };
    if (method === 'setWebhook') return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    return fetchImpl(input, init);
  };
}

const script = readFileSync(new URL('./sync_telegram_bot.mjs', import.meta.url), 'utf8');
// Git may materialize checked-in YAML with CRLF on Windows. Keep workflow
// structure assertions independent of checkout line endings.
const workflow = readFileSync(new URL('../.github/workflows/deploy-mini-app.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const provider = readFileSync(new URL('../apps/mini-app/src/components/PrivyClientProvider.tsx', import.meta.url), 'utf8');

test('profile copy fits Telegram limits and matches the reviewed handoff without markup', () => {
  assert.ok(BOT_PROFILE.name.length > 0 && BOT_PROFILE.name.length <= 64);
  assert.ok(BOT_PROFILE.shortDescription.length > 0 && BOT_PROFILE.shortDescription.length <= 120);
  assert.ok(BOT_PROFILE.description.length > 0 && BOT_PROFILE.description.length <= 512);
  assert.equal(BOT_PROFILE.shortDescription, 'Trade, earn, borrow and move assets. Your onchain workspace, in Telegram.');
  assert.match(BOT_PROFILE.description, /^Your onchain workspace, in Telegram\.\n\n/);
  assert.match(BOT_PROFILE.description, /join the waitlist\.\nGuides: https:\/\/fxaeon\.com\/docs\nSupport: support@fxaeon\.com$/);
  assert.doesNotMatch(BOT_PROFILE.description, /<[^>]+>|\*\*|private key|guarantee/i);
  const guide = readFileSync(new URL('../docs/brand-assets.md', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  assert.ok(guide.includes(`**About / short description:** ${BOT_PROFILE.shortDescription}`));
  const description = /\*\*Description:\*\*[\s\S]*?```text\n([\s\S]*?)\n {2}```/.exec(guide)?.[1].replace(/^ {2}/gm, '');
  assert.equal(description, BOT_PROFILE.description);
});

test('Telegram sync is constrained to the production static origin', () => {
  assert.match(script, /https:\/\/fxaeon\.com\//);
  assert.match(script, /https:\/\/fxaeon\.com\/docs/);
  assert.match(script, /fxaeon\.pages\.dev/);
  assert.match(script, /ALLOWED_WEB_APP_HOSTS/);
  assert.match(script, /setChatMenuButton/);
  assert.match(script, /setMyCommands/);
  assert.match(script, /setMy(?:Name|ShortDescription|Description)/);
  assert.deepEqual(BOT_COMMANDS.map(item => item.command), ['start', 'help', 'support']);
  assert.match(script, /getMy(?:Name|ShortDescription|Description|Commands)/);
  assert.match(script, /getChatMenuButton/);
  assert.match(script, /AbortController/);
});

test('Telegram sync installs only handled commands and verifies every persisted setting', async () => {
  const calls = [];
  const expectedMenu = {
    type: 'web_app',
    text: 'Open FxAeon',
    web_app: { url: 'https://fxaeon.com' },
  };
  const state = {
    name: 'old name',
    short_description: 'old short description',
    description: 'old description',
    commands: [{ command: 'stale', description: 'Stale command' }],
    menu_button: { type: 'default' },
  };
  const fetchImpl = async (input, init) => {
    const method = new URL(input).pathname.split('/').pop();
    const payload = JSON.parse(init.body);
    calls.push({ method, payload });
    let result;
    if (method === 'getMyName') result = { name: state.name };
    else if (method === 'setMyName') { state.name = payload.name; result = true; }
    else if (method === 'getMyShortDescription') result = { short_description: state.short_description };
    else if (method === 'setMyShortDescription') { state.short_description = payload.short_description; result = true; }
    else if (method === 'getMyDescription') result = { description: state.description };
    else if (method === 'setMyDescription') { state.description = payload.description; result = true; }
    else if (method === 'getMyCommands') result = state.commands;
    else if (method === 'setMyCommands') { state.commands = payload.commands; result = true; }
    else if (method === 'getChatMenuButton') result = state.menu_button;
    else if (method === 'setChatMenuButton') { state.menu_button = payload.menu_button; result = true; }
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
  };

  await syncTelegramBot({
    token: '123456789:abcdefghijklmnopqrstuvwxyz',
    webAppUrl: expectedMenu.web_app.url,
    fetchImpl: withWebhook(fetchImpl),
    timeoutMs: 100,
  });

  assert.deepEqual(calls.map(({ method }) => method), [
    'getMyName', 'setMyName', 'getMyName',
    'getMyShortDescription', 'setMyShortDescription', 'getMyShortDescription',
    'getMyDescription', 'setMyDescription', 'getMyDescription',
    'getMyCommands', 'setMyCommands', 'getMyCommands',
    'getChatMenuButton', 'setChatMenuButton', 'getChatMenuButton',
  ]);
  assert.deepEqual(calls.find(({ method }) => method === 'setMyCommands').payload, { commands: BOT_COMMANDS });
  assert.deepEqual(calls.find(({ method }) => method === 'setMyShortDescription').payload, { short_description: BOT_PROFILE.shortDescription });
  assert.deepEqual(calls.find(({ method }) => method === 'setMyDescription').payload, { description: BOT_PROFILE.description });
  assert.match(BOT_PROFILE.description, /ETH and BTC.*fxSAVE.*fxUSD.*Ethereum.*Base/i);
  assert.match(calls.find(({ method }) => method === 'setMyDescription').payload.description, /https:\/\/fxaeon\.com\/(?:|docs)/);
});

test('Telegram sync makes no metadata writes when settings match (owned webhook is reapplied)', async () => {
  const calls = [];
  const description = BOT_PROFILE.description;
  const fetchImpl = async (input, init) => {
    const method = new URL(input).pathname.split('/').pop();
    calls.push(method);
    const result = {
      getMyName: { name: 'FxAeon' },
      getMyShortDescription: { short_description: BOT_PROFILE.shortDescription },
      getMyDescription: { description },
      getMyCommands: BOT_COMMANDS,
      getChatMenuButton: { type: 'web_app', text: 'Open FxAeon', web_app: { url: 'https://fxaeon.com/' } },
    }[method];
    assert.equal(init.method, 'POST');
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
  };

  await syncTelegramBot({ token: '123456789:abcdefghijklmnopqrstuvwxyz', fetchImpl: withWebhook(fetchImpl), timeoutMs: 100 });

  assert.deepEqual(calls, [
    'getMyName', 'getMyShortDescription', 'getMyDescription', 'getMyCommands', 'getChatMenuButton',
  ]);
  assert.equal(calls.some((method) => method.startsWith('set')), false);
});

test('persistent menu readback mismatch is bounded and has secret-free diagnostics', async () => {
  const token = '987654321:abcdefghijklmnopqrstuvwxyz';
  const calls = [];
  let description = '';
  const fetchImpl = async (input, init) => {
    const method = new URL(input).pathname.split('/').pop();
    const payload = JSON.parse(init.body);
    calls.push(method);
    if (method === 'setMyDescription') description = payload.description;
    const result = {
      setMyName: true,
      getMyName: { name: 'FxAeon' },
      setMyShortDescription: true,
      getMyShortDescription: { short_description: BOT_PROFILE.shortDescription },
      setMyDescription: true,
      getMyDescription: { description },
      setMyCommands: true,
      getMyCommands: BOT_COMMANDS,
      setChatMenuButton: true,
      getChatMenuButton: { type: 'default' },
    }[method];
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
  };

  await assert.rejects(
    syncTelegramBot({ token, fetchImpl: withWebhook(fetchImpl), timeoutMs: 100 }),
    (error) => {
      assert.match(error.message, /getChatMenuButton readback mismatch \(type=default, text=mismatch, web-app-url=mismatch\)/);
      assert.doesNotMatch(error.message, new RegExp(token));
      assert.doesNotMatch(error.message, /https?:\/\//);
      return true;
    },
  );
  assert.equal(calls.filter((method) => method === 'setChatMenuButton').length, 1);
  assert.equal(calls.filter((method) => method === 'getChatMenuButton').length, 4);
});

test('Telegram sync bounds a stalled request and excludes the bot token from errors', async () => {
  const token = '987654321:abcdefghijklmnopqrstuvwxyz';
  const fetchImpl = async (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

  await assert.rejects(
    syncTelegramBot({ token, fetchImpl: withWebhook(fetchImpl), timeoutMs: 10 }),
    (error) => {
      assert.match(error.message, /getMyName request timed out/);
      assert.doesNotMatch(error.message, new RegExp(token));
      return true;
    },
  );
});

test('Telegram sync stops before later writes when a readback mismatches', async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const method = new URL(input).pathname.split('/').pop();
    calls.push(method);
    return { ok: true, status: 200, json: async () => ({
      ok: true,
      result: method === 'getMyName' ? { name: 'Unexpected name' } : true,
    }) };
  };

  await assert.rejects(
    syncTelegramBot({ token: '123456789:abcdefghijklmnopqrstuvwxyz', fetchImpl: withWebhook(fetchImpl), timeoutMs: 100 }),
    /getMyName readback mismatch/,
  );
  assert.deepEqual(calls, ['getMyName', 'setMyName', 'getMyName']);
});

test('Telegram sync fails when a changed setting write is rejected', async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const method = new URL(input).pathname.split('/').pop();
    calls.push(method);
    const result = method === 'getMyName' ? { name: 'Old name' } : false;
    return { ok: method !== 'setMyName', status: method === 'setMyName' ? 429 : 200, json: async () => ({ ok: result !== false, result }) };
  };

  await assert.rejects(
    syncTelegramBot({ token: '123456789:abcdefghijklmnopqrstuvwxyz', fetchImpl: withWebhook(fetchImpl), timeoutMs: 100 }),
    /Telegram Bot API setMyName failed with HTTP 429/,
  );
  assert.deepEqual(calls, ['getMyName', 'setMyName']);
});

test('explicit Telegram menu URLs are validated before any API request', async () => {
  assert.equal(validatedWebAppUrl('https://fxaeon.com/'), 'https://fxaeon.com');
  await assert.rejects(
    syncTelegramBot({
      token: '123456789:abcdefghijklmnopqrstuvwxyz',
      webAppUrl: 'https://example.invalid/portfolio',
      fetchImpl: async () => { throw new Error('must not request'); },
    }),
    /Telegram Mini App URL must use https:\/\/fxaeon\.com/,
  );
});

test('webhook ownership is checked before any mutation and unknown owners are never overwritten or exposed', async () => {
  for (const url of ['https://other.test/private-path?secret=do-not-log', TELEGRAM_WEBHOOK_URL + '/', 'http://fxaeon.com/api/telegram-bot', undefined]) {
    const calls = [];
    await assert.rejects(syncTelegramBot({ token: '123456789:abcdefghijklmnopqrstuvwxyz', fetchImpl: async input => {
      calls.push(new URL(input).pathname.split('/').pop());
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { url } }) };
    } }), error => {
      assert.equal(error.message, 'Telegram webhook ownership conflict; no settings changed');
      return true;
    });
    assert.deepEqual(calls, ['getWebhookInfo']);
  }
});

test('empty and owned endpoints install the fixed URL, derived secret and message-only subscription before commands', async () => {
  const token = '123456789:abcdefghijklmnopqrstuvwxyz';
  for (const initial of ['', TELEGRAM_WEBHOOK_URL]) {
    const calls = [];
    const state = { getWebhookInfo: { url: initial }, getMyCommands: [], getChatMenuButton: {} };
    await syncTelegramBot({ token, fetchImpl: async (input, init) => {
      const method = new URL(input).pathname.split('/').pop();
      const payload = JSON.parse(init.body); calls.push({ method, payload });
      let result;
      if (method === 'setWebhook') { state.getWebhookInfo = { url: payload.url, allowed_updates: payload.allowed_updates }; result = true; }
      else if (method.startsWith('set')) {
        state[method.replace(/^set/, 'get')] = method === 'setMyCommands' ? payload.commands : method === 'setChatMenuButton' ? payload.menu_button : payload;
        result = true;
      } else result = state[method];
      assert.equal(init.redirect, 'error');
      return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
    } });
    assert.deepEqual(calls.slice(0, 3).map(call => call.method), ['getWebhookInfo', 'setWebhook', 'getWebhookInfo']);
    assert.deepEqual(calls[1].payload, { url: TELEGRAM_WEBHOOK_URL, allowed_updates: ['message'],
      secret_token: telegramWebhookSecret(token), max_connections: 4, drop_pending_updates: false });
    assert.match(calls[1].payload.secret_token, /^[0-9a-f]{64}$/);
    assert.notEqual(telegramWebhookSecret(token), telegramWebhookSecret('987654321:abcdefghijklmnopqrstuvwxyz'));
    assert.deepEqual(state.getMyCommands, BOT_COMMANDS);
  }
});

test('webhook rejection or failed readback stops before advertising commands', async () => {
  for (const mode of ['rejected', 'wrong-url', 'wrong-updates']) {
    const calls = [];
    await assert.rejects(syncTelegramBot({ token: '123456789:abcdefghijklmnopqrstuvwxyz', fetchImpl: async input => {
      const method = new URL(input).pathname.split('/').pop(); calls.push(method);
      const result = calls.length === 1 ? { url: '' } : method === 'setWebhook' ? mode !== 'rejected'
        : { url: mode === 'wrong-url' ? 'https://untrusted.test' : TELEGRAM_WEBHOOK_URL, allowed_updates: [] };
      return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
    } }), /(?:setWebhook rejected setting|getWebhookInfo readback mismatch)/);
    assert.deepEqual(calls, mode === 'rejected' ? ['getWebhookInfo', 'setWebhook'] : ['getWebhookInfo', 'setWebhook', 'getWebhookInfo']);
  }
});

test('preflight timeout includes body reads and ignores hostile raw errors without leaking credentials', async () => {
  const token = '987654321:abcdefghijklmnopqrstuvwxyz';
  for (const mode of ['fetch-hang', 'body-hang', 'throw']) {
    let signal;
    await assert.rejects(syncTelegramBot({ token, timeoutMs: 10, fetchImpl: async (_input, init) => {
      signal = init.signal;
      if (mode === 'throw') throw Error(`https://api.telegram.org/bot${token}/getWebhookInfo private text`);
      if (mode === 'fetch-hang') return new Promise(() => {});
      return { ok: true, status: 200, json: () => new Promise(() => {}) };
    } }), error => {
      assert.equal(error.message, `Telegram Bot API getWebhookInfo request ${mode === 'throw' ? 'failed' : 'timed out'}`);
      assert.doesNotMatch(error.message, /https:|private text|987654321/);
      return true;
    });
    assert.equal(signal.aborted, true);
  }
});

test('deployment sync uses only the CI secret after Pages deploy', () => {
  const deployIndex = workflow.indexOf('Deploy verified production artifact');
  const revisionVerifyIndex = workflow.indexOf('Verify deployed revision');
  const liveConfigIndex = workflow.indexOf('Verify live wallet configuration');
  const syncIndex = workflow.indexOf('Sync Telegram bot metadata and menu');
  assert.ok(deployIndex >= 0 && revisionVerifyIndex > deployIndex && liveConfigIndex > revisionVerifyIndex && syncIndex > liveConfigIndex);
  assert.match(workflow.slice(syncIndex), /TELEGRAM_BOT_TOKEN:\s*\$\{\{\s*secrets\.TELEGRAM_BOT_TOKEN\s*\}\}/);
  assert.match(workflow.slice(syncIndex), /TELEGRAM_WEB_APP_URL:\s*https:\/\/fxaeon\.com\//);
  assert.doesNotMatch(workflow, /NEXT_PUBLIC_TELEGRAM_BOT_TOKEN/);
  assert.match(workflow, /workflow_run:[\s\S]*workflows: \[Client CI\][\s\S]*branches: \[main\]/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(script, /Never print the token|token out of logs/i);
});

test('configured Telegram auth waits for a delayed bridge before mounting Privy', () => {
  assert.match(provider, /waitForTelegramWebApp/);
  assert.match(provider, /restoreTelegramLaunchHash\(\)/);
  assert.match(provider, /telegramBridgeSettled/);
});
