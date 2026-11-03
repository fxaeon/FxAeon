import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasDirectSdkImport, hasServerImport } from './verify_architecture.mjs';

test('architecture import detector ignores documentation copy', () => {
  assert.equal(hasDirectSdkImport('<strong>@aladdindao/fx-sdk</strong>'), false);
  assert.equal(hasDirectSdkImport('const label = "@aladdindao/fx-sdk";'), false);
  assert.equal(hasDirectSdkImport('// import { tokens } from "@aladdindao/fx-sdk";'), false);
  assert.equal(hasDirectSdkImport("export const caption = '@aladdindao/fx-sdk';"), false);
});

test('architecture import detector catches direct module declarations', () => {
  assert.equal(hasDirectSdkImport("import { tokens } from '@aladdindao/fx-sdk';"), true);
  assert.equal(hasDirectSdkImport("import type { FxSdk } from '@aladdindao/fx-sdk';"), true);
  assert.equal(hasDirectSdkImport("export { tokens } from '@aladdindao/fx-sdk';"), true);
  assert.equal(hasDirectSdkImport("const sdk = require('@aladdindao/fx-sdk');"), true);
  assert.equal(hasDirectSdkImport("const sdk = await import('@aladdindao/fx-sdk');"), true);
  assert.equal(hasDirectSdkImport("type FxSdk = import('@aladdindao/fx-sdk').FxSdk;"), true);
});

test('frontend cannot load server packages, Functions, or traversed server paths through any module syntax', () => {
  for (const source of [
    "import { Store } from '@fxaeon/miniapp-access';",
    "import type { Credential } from '../../../../server/miniapp-access/store';",
    "export { handler } from '../../../../functions/api/telegram-wallet';",
    "import { createTelegramBotHandler } from '../../../../server/miniapp-access/bot';",
    "export { onRequest } from '../../../../functions/api/telegram-bot';",
    "const server = require('@privy-io/server-auth');",
    "const server = import(`@simplewebauthn/server`);",
    "type DB = import('@/../../../server/miniapp-access/store').DB;",
    "import handler = require('@privy-io/node');",
    "import 'server-only';",
  ]) assert.equal(hasServerImport(source), true, source);
  for (const source of [
    "import { startRegistration } from '@simplewebauthn/browser';",
    "import { PrivyProvider } from '@privy-io/react-auth';",
    "fetch('/api/telegram-wallet', { method: 'POST' });",
    "// import { Store } from '../../../../server/miniapp-access/store';",
    "const text = '@simplewebauthn/server';",
  ]) assert.equal(hasServerImport(source), false, source);
});
