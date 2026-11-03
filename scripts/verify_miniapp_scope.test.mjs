import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WALLET_ROUTES, BOT_ROUTES, walletRouteViolation, botRouteViolation, serverModuleViolations } from './verify_miniapp_scope.mjs';

test('only the two reviewed wallet routes may expose exact server handler adapters', () => {
  assert.deepEqual([...WALLET_ROUTES.keys()], ['functions/api/telegram-wallet.ts', 'functions/api/miniapp-operator.ts']);
  for (const [name, handler] of WALLET_ROUTES) {
    const source = `import { ${handler} } from '../../server/miniapp-access';\nexport const onRequest = ${handler}();`;
    assert.equal(walletRouteViolation(name, source), null);
    assert.ok(walletRouteViolation('functions/api/admin.ts', source));
    assert.ok(walletRouteViolation(name, source + '\nexport const onRequestGet = () => fetch("https://unreviewed.test");'));
    assert.ok(walletRouteViolation(name, source.replace(`${handler}()`, `${handler}({ fetch: arbitraryProxy })`)));
    assert.ok(walletRouteViolation(name, source.replace('../../server/miniapp-access', '../../server/unreviewed')));
    assert.ok(walletRouteViolation(name, source.replace('export const onRequest', 'export let onRequest')));
  }
});

test('server scope rejects unaudited modules, dependencies and signing authority', () => {
  assert.deepEqual(serverModuleViolations('proxy.ts', 'export {};'), ['unreviewed server module']);
  assert.ok(serverModuleViolations('index.ts', "import '../other-server';").includes('unreviewed server dependency'));
  assert.ok(serverModuleViolations('store.ts', "import { sign } from '@privy-io/node';").includes('unreviewed server dependency'));
  assert.ok(serverModuleViolations('passkeys.ts', "crypto.subtle.sign('ECDSA', key, bytes)").includes('server signing authority'));
  assert.ok(serverModuleViolations('passkeys.ts', "crypto.subtle['sign']('ECDSA', key, bytes)").includes('server signing authority'));
  assert.ok(serverModuleViolations('store.ts', "fetch(request.url)").includes('outbound request outside reviewed provider adapters'));
  assert.ok(serverModuleViolations('index.ts', 'const key = env.PRIVY_AUTHORIZATION_KEY;').includes('server private-key or delegated signing authority'));
  assert.ok(serverModuleViolations('privy.ts', "const API = 'https://attacker.test'").includes('Privy adapter lost its fixed API origin'));
});

test('verified passkey and provider transport dependencies are supported without client signing keys', () => {
  assert.deepEqual(serverModuleViolations('passkeys.ts', "import { verifyAuthenticationResponse } from '@simplewebauthn/server';\ncrypto.subtle.verify('ECDSA', key, signature, data);"), []);
  assert.deepEqual(serverModuleViolations('privy.ts', "import canonicalize from 'canonicalize'; const API = 'https://api.privy.io/v1';"), []);
  assert.deepEqual(serverModuleViolations('index.ts', "import { verifyTelegramLaunchData } from '../../functions/api/telegram-admission'; import { Store } from './store';"), []);
});

test('the bot has its own exact adapter, with no route alias or injected transport', () => {
  const name = 'functions/api/telegram-bot.ts';
  assert.deepEqual([...BOT_ROUTES.keys()], [name]);
  const source = "import { createTelegramBotHandler } from '../../server/miniapp-access/bot'; export const onRequest = createTelegramBotHandler();";
  assert.equal(botRouteViolation(name, source), null);
  assert.ok(botRouteViolation('functions/api/bot-admin.ts', source));
  assert.ok(botRouteViolation(name, source.replace('/miniapp-access/bot', '/miniapp-access')));
  assert.ok(botRouteViolation(name, source.replace('createTelegramBotHandler()', 'createTelegramBotHandler({ fetch: proxy })')));
});

test('bot scope permits one fixed Telegram send but rejects arbitrary outbound calls and wallet authority', () => {
  const send = "await (options.fetch ?? fetch)(`https://api.telegram.org/bot${token}/sendMessage`, {});";
  const source = `import type { DB } from './store'; import { json } from './http'; ${send}`;
  assert.deepEqual(serverModuleViolations('bot.ts', source), []);
  for (const bad of [
    source.replace('https://api.telegram.org/bot', 'https://attacker.test/bot'),
    source.replace('/sendMessage', '/setWebhook'),
    source.replace('${token}', '${target}'),
    source.replace('import type', 'import'),
    source + ' fetch(request.url);',
    source + " import { Store } from './privy';",
    source + " db.prepare('UPDATE admission_users SET external_id = ?');",
    source + ' env.PRIVY_APP_SECRET;',
    source + "const action = 'eth_sendTransaction';",
  ]) assert.ok(serverModuleViolations('bot.ts', bad).length > 0, bad);
});
