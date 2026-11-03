import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

const TELEGRAM_API_ROOT = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PHOTO_BYTES = 10_000_000;
// Telegram's InputProfilePhotoStatic accepts JPEG; keep the brand PNG as
// the editable source and upload the committed 1024px JPEG derivative.
const PROFILE_PHOTO_PATH = new URL('../docs/assets/brand/fxaeon-bot-avatar-1024.jpg', import.meta.url);

function requiredToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required for the profile-photo sync');
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('TELEGRAM_BOT_TOKEN has an invalid format');
  return token;
}

async function callBotApi(token, method, body, {
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Telegram Bot API fetch is unavailable');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Telegram Bot API timeout must be positive');
  const controller = new AbortController();
  let timeout;
  let response;
  let result;
  try {
    await Promise.race([
      (async () => {
        response = await fetchImpl(`${TELEGRAM_API_ROOT}/bot${token}/${method}`, {
          method: 'POST', body, signal: controller.signal, redirect: 'error',
        });
        result = await response.json();
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('timeout'));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Telegram Bot API ${method} request timed out`);
    if (error instanceof SyntaxError) throw new Error(`Telegram Bot API ${method} returned an invalid response`);
    throw new Error(`Telegram Bot API ${method} request failed`);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }

  if (!response?.ok || result?.ok !== true) {
    throw new Error(`Telegram Bot API ${method} failed with HTTP ${response?.status ?? 'unknown'}`);
  }
  return result.result;
}

export async function syncTelegramBotProfilePhoto({
  token = requiredToken(),
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  photoPath = PROFILE_PHOTO_PATH,
} = {}) {
  if (typeof token !== 'string' || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new Error('TELEGRAM_BOT_TOKEN has an invalid format');
  }
  let photo;
  try {
    photo = await readFile(photoPath);
  } catch {
    throw new Error('Checked-in Telegram profile photo could not be read');
  }
  if (photo.length < 4 || photo.length > MAX_PHOTO_BYTES
    || photo[0] !== 0xff || photo[1] !== 0xd8
    || photo.at(-2) !== 0xff || photo.at(-1) !== 0xd9) {
    throw new Error('Checked-in Telegram profile photo is not a valid, bounded JPEG');
  }
  const options = { fetchImpl, timeoutMs };
  const identity = await callBotApi(token, 'getMe', undefined, options);
  if (identity?.is_bot !== true || typeof identity.username !== 'string' || identity.username.toLowerCase() !== 'fxaeonbot'
    || !Number.isSafeInteger(identity.id) || String(identity.id) !== token.split(':')[0]) {
    throw new Error('Telegram bot identity did not match FxAeon; profile photo was not changed');
  }
  const form = new FormData();
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://fxaeon_bot_avatar' }));
  form.append('fxaeon_bot_avatar', new Blob([photo], { type: 'image/jpeg' }), 'fxaeon-bot-avatar-1024.jpg');
  if (await callBotApi(token, 'setMyProfilePhoto', form, options) !== true) {
    throw new Error('Telegram profile-photo update was not confirmed');
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await syncTelegramBotProfilePhoto({ token: requiredToken() });
    console.log('Telegram bot profile photo synchronized from the checked-in FxAeon avatar.');
  } catch (error) {
    console.error(`Telegram bot profile-photo synchronization failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}
