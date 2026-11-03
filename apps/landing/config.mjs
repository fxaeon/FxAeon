export function telegramLauncher(value = 'https://t.me/FxAeonBot') {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 't.me'
    || url.username || url.password || url.port || url.hash
    || !/^\/[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)?\/?$/.test(url.pathname)
    || [...url.searchParams.keys()].some((key) => key !== 'startapp')
    || url.searchParams.getAll('startapp').length > 1
    || (url.searchParams.has('startapp') && !/^[A-Za-z0-9_-]{0,512}$/.test(url.searchParams.get('startapp')))) {
    throw new Error('Telegram launcher must be an HTTPS t.me bot or mini-app URL with an optional startapp payload');
  }
  if (!url.searchParams.has('startapp')) url.searchParams.set('startapp', '');
  return url.href;
}

/**
 * The launcher with a start parameter, so Telegram opens the Mini App on one
 * screen (`https://t.me/FxAeonBot?startapp=trade`). The app maps the value
 * through its own whitelist of routes.
 */
export function telegramStartLink(launcher, startParam) {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(startParam)) throw new Error(`Unsupported Telegram start parameter: ${startParam}`);
  const url = new URL(telegramLauncher(launcher));
  url.searchParams.set('startapp', startParam);
  return url.href;
}

export function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
