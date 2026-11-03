import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secretKinds, scanFrontend, SERVER_SECRET_NAMES } from './verify_frontend_secrets.mjs';

test('recognizes credential shapes without returning their values', () => {
  const fake = `privy_app_secret_${'A'.repeat(32)}`;
  assert.deepEqual(secretKinds(fake), ['Privy app secret']);
  assert.deepEqual(secretKinds(`123456789:${'B'.repeat(35)}`), ['Telegram bot token']);
  assert.deepEqual(secretKinds('-----BEGIN PRIVATE KEY-----'), ['private key block']);
  assert.deepEqual(secretKinds(`ETHERSCAN_API_KEY = "${'C'.repeat(32)}"`), ['server credential literal', 'server secret binding']);
});

test('public identifiers and wallet mode references are allowed; server binding references are not', () => {
  assert.deepEqual(secretKinds('NEXT_PUBLIC_PRIVY_APP_ID="cmu5tz4f000lp0cl5qtd87sro"; process.env.NEXT_PUBLIC_TELEGRAM_WALLET_MODE'), []);
  assert.deepEqual(secretKinds('0x' + '1'.repeat(64)), []);
  for (const name of SERVER_SECRET_NAMES) assert.deepEqual(secretKinds(`process.env["${name}"]`), ['server secret binding']);
});

test('configured opaque secrets are detected without returning their values', () => {
  const token = 'opaque-secret-without-a-known-prefix';
  const findings = secretKinds(`const leaked = '${token}'`, { MINIAPP_OPERATOR_TOKEN: token });
  assert.deepEqual(findings, ['configured server secret (MINIAPP_OPERATOR_TOKEN)']);
  assert.equal(JSON.stringify(findings).includes(token), false);
});

test('static frontend and source maps cannot contain server imports or server secrets', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fx-frontend-boundary-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'client.js'), "export { Store } from '@fxaeon/miniapp-access';");
  await writeFile(join(dir, 'client.js.map'), JSON.stringify({ sourcesContent: ['process.env.RESEND_API_KEY'] }));
  const result = await scanFrontend([dir], {});
  assert.equal(result.inspected, 2);
  assert.deepEqual(result.findings.map(finding => finding.kind).sort(), ['server module import', 'server secret binding']);
});
