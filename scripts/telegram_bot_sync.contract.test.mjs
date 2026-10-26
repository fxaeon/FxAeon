import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { syncTelegramBot, validatedWebAppUrl } from './sync_telegram_bot.mjs';

const script = readFileSync(new URL('./sync_telegram_bot.mjs', import.meta.url), 'utf8');
// Git may materialize checked-in YAML with CRLF on Windows. Keep workflow
// structure assertions independent of checkout line endings.
const workflow = readFileSync(new URL('../.github/workflows/deploy-mini-app.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const provider = readFileSync(new URL('../apps/mini-app/src/components/PrivyClientProvider.tsx', import.meta.url), 'utf8');

test('Telegram sync is constrained to the production static origin', () => {
  assert.match(script, /https:\/\/fxaeon\.com\//);
  assert.match(script, /https:\/\/fxaeon\.com\/docs/);
  assert.match(script, /fxaeon\.pages\.dev/);
  assert.match(script, /ALLOWED_WEB_APP_HOSTS/);
  assert.match(script, /setChatMenuButton/);
  assert.match(script, /setMyCommands/);
  assert.match(script, /setMy(?:Name|ShortDescription|Description)/);
  assert.match(script, /commands:\s*\[\]/);
  assert.doesNotMatch(script, /command:\s*['"](?:start|app|help)['"]/);
  assert.match(script, /getMy(?:Name|ShortDescription|Description|Commands)/);
  assert.match(script, /getChatMenuButton/);
  assert.match(script, /AbortController/);
});

test('Telegram sync clears unhandled commands and verifies every persisted setting', async () => {
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
    fetchImpl,
    timeoutMs: 100,
  });

  assert.deepEqual(calls.map(({ method }) => method), [
    'getMyName', 'setMyName', 'getMyName',
    'getMyShortDescription', 'setMyShortDescription', 'getMyShortDescription',
    'getMyDescription', 'setMyDescription', 'getMyDescription',
    'getMyCommands', 'setMyCommands', 'getMyCommands',
    'getChatMenuButton', 'setChatMenuButton', 'getChatMenuButton',
  ]);
  assert.deepEqual(calls.find(({ method }) => method === 'setMyCommands').payload, { commands: [] });
  assert.match(calls.find(({ method }) => method === 'setMyDescription').payload.description, /long or short.*fxSAVE.*fxUSD.*Ethereum.*Base/i);
  assert.match(calls.find(({ method }) => method === 'setMyDescription').payload.description, /https:\/\/fxaeon\.com\/(?:|docs)/);
});

test('Telegram sync makes no writes when every setting already matches', async () => {
  const calls = [];
  const description = 'Open long or short positions, earn with fxSAVE, and borrow fxUSD on Ethereum. Move assets between Ethereum and Base. Built with f(x) SDK. Review every transaction and sign with your own wallet. FxAeon never receives your private keys. Open: https://fxaeon.com/ Docs: https://fxaeon.com/docs';
  const fetchImpl = async (input, init) => {
    const method = new URL(input).pathname.split('/').pop();
    calls.push(method);
    const result = {
      getMyName: { name: 'FxAeon' },
      getMyShortDescription: { short_description: 'Positions, fxSAVE, and fxUSD on Ethereum.' },
      getMyDescription: { description },
      getMyCommands: [],
      getChatMenuButton: { type: 'web_app', text: 'Open FxAeon', web_app: { url: 'https://fxaeon.com/' } },
    }[method];
    assert.equal(init.method, 'POST');
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
  };

  await syncTelegramBot({ token: '123456789:abcdefghijklmnopqrstuvwxyz', fetchImpl, timeoutMs: 100 });

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
      getMyShortDescription: { short_description: 'Positions, fxSAVE, and fxUSD on Ethereum.' },
      setMyDescription: true,
      getMyDescription: { description },
      setMyCommands: true,
      getMyCommands: [],
      setChatMenuButton: true,
      getChatMenuButton: { type: 'default' },
    }[method];
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
  };

  await assert.rejects(
    syncTelegramBot({ token, fetchImpl, timeoutMs: 100 }),
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
    syncTelegramBot({ token, fetchImpl, timeoutMs: 10 }),
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
    syncTelegramBot({ token: '123456789:abcdefghijklmnopqrstuvwxyz', fetchImpl, timeoutMs: 100 }),
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
    syncTelegramBot({ token: '123456789:abcdefghijklmnopqrstuvwxyz', fetchImpl, timeoutMs: 100 }),
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
