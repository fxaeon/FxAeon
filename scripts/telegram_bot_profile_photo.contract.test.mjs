import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { syncTelegramBotProfilePhoto } from './sync_telegram_bot_profile_photo.mjs';

const workflow = (await readFile(new URL('../.github/workflows/telegram-bot-profile-photo.yml', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
const deployWorkflow = (await readFile(new URL('../.github/workflows/deploy-mini-app.yml', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
const sourceAvatar = await readFile(new URL('../docs/assets/brand/fxaeon-bot-avatar-1024.png', import.meta.url));
const jpegAvatar = await readFile(new URL('../docs/assets/brand/fxaeon-bot-avatar-1024.jpg', import.meta.url));
const syncScript = await readFile(new URL('./sync_telegram_bot_profile_photo.mjs', import.meta.url), 'utf8');

function jpegDimensions(bytes) {
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error('Invalid JPEG marker');
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if ([0x01, 0xd8, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7].includes(marker)) continue;
    const length = bytes.readUInt16BE(offset);
    if (startOfFrame.has(marker)) return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    offset += length;
  }
  throw new Error('JPEG has no frame dimensions');
}

test('profile sync uploads the PNG-derived JPEG through static InputProfilePhoto multipart data', async () => {
  assert.equal(sourceAvatar.subarray(1, 4).toString('ascii'), 'PNG');
  assert.deepEqual([...jpegAvatar.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...jpegAvatar.subarray(-2)], [0xff, 0xd9]);
  assert.deepEqual(jpegDimensions(jpegAvatar), { width: 1024, height: 1024 });

  const calls = [];
  await syncTelegramBotProfilePhoto({
    token: '123456789:abcdefghijklmnopqrstuvwxyz',
    timeoutMs: 1000,
    fetchImpl: async (input, init) => {
      calls.push({ url: new URL(input), init });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    },
  });

  assert.equal(calls.length, 1, 'only the explicit setMyProfilePhoto mutation is called');
  const [{ url, init }] = calls;
  assert.equal(url.protocol, 'https:');
  assert.match(url.pathname, /\/setMyProfilePhoto$/);
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers, undefined, 'Fetch must supply the multipart boundary header');
  assert.ok(init.body instanceof FormData);
  assert.deepEqual(JSON.parse(init.body.get('photo')), { type: 'static', photo: 'attach://fxaeon_bot_avatar' });
  const uploaded = init.body.get('fxaeon_bot_avatar');
  assert.equal(uploaded.name, 'fxaeon-bot-avatar-1024.jpg');
  assert.equal(uploaded.type, 'image/jpeg');
  assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), jpegAvatar);
});

test('API failures and thrown transport errors never expose the bot token or response details', async () => {
  const token = '987654321:abcdefghijklmnopqrstuvwxyz';
  await assert.rejects(syncTelegramBotProfilePhoto({
    token,
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ ok: false, description: `rejected ${token}` }) }),
  }), error => {
    assert.equal(error.message, 'Telegram Bot API setMyProfilePhoto failed with HTTP 403');
    assert.equal(error.message.includes(token), false);
    return true;
  });
  await assert.rejects(syncTelegramBotProfilePhoto({ token, fetchImpl: async () => { throw new Error(`network ${token}`); } }), error => {
    assert.equal(error.message, 'Telegram Bot API setMyProfilePhoto request failed');
    assert.equal(error.message.includes(token), false);
    return true;
  });
  assert.match(syncScript, /TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(syncScript, /console\.(?:log|error)\([^\n]*token/i);
});

test('profile upload is an explicit main-only operator workflow, separate from deployment sync', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /type: boolean[\s\S]*?default: false/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main' && inputs\.upload_profile_photo/);
  assert.match(workflow, /group: fxaeon-production[\s\S]*?cancel-in-progress: false/);
  assert.match(workflow, /run: node scripts\/sync_telegram_bot_profile_photo\.mjs[\s\S]*?TELEGRAM_BOT_TOKEN: \$\{\{ secrets\.TELEGRAM_BOT_TOKEN \}\}/);
  assert.doesNotMatch(deployWorkflow, /sync_telegram_bot_profile_photo/);
});
