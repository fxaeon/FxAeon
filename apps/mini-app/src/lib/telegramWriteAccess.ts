import type { TgWebApp } from './telegram';

type Failure = 'unsupported' | 'timeout' | 'in-progress' | 'unavailable';
const messages: Record<Failure, string> = {
  unsupported: 'Update Telegram to allow invites, or use email instead.',
  timeout: 'Telegram didn’t confirm invite permission. Reopen the Mini App and try again, or use email.',
  'in-progress': 'Finish the open Telegram permission request, or reopen the Mini App.',
  unavailable: 'Telegram couldn’t open invite permissions. Reopen the Mini App, or use email instead.',
};

export class TelegramWriteAccessError extends Error {
  constructor(readonly code: Failure) {
    super(messages[code]);
    this.name = 'TelegramWriteAccessError';
  }
}

const pending = new WeakSet<TgWebApp>();
const aborted = () => new DOMException('Telegram permission request cancelled.', 'AbortError');
function sdkFailure(error: unknown): TelegramWriteAccessError {
  const message = error instanceof Error ? error.message : '';
  return new TelegramWriteAccessError(message === 'WebAppMethodUnsupported' ? 'unsupported'
    : message === 'WebAppWriteAccessRequested' ? 'in-progress' : 'unavailable');
}

/** Call directly from the click handler: no await precedes the native request.
 * Only a callback/event response grants permission; launch hints are not proof.
 */
export function requestTelegramWriteAccess(webApp: TgWebApp | null, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<boolean> {
  if (options.signal?.aborted) return Promise.reject(aborted());
  if (!webApp?.requestWriteAccess) return Promise.reject(new TelegramWriteAccessError('unsupported'));
  try {
    const version = /^(\d+)\.(\d+)(?:\.|$)/.exec(webApp.version ?? '');
    const supported = webApp.isVersionAtLeast ? webApp.isVersionAtLeast('6.9')
      : version ? Number(version[1]) > 6 || (Number(version[1]) === 6 && Number(version[2]) >= 9) : true;
    if (!supported) return Promise.reject(new TelegramWriteAccessError('unsupported'));
  } catch (error) { return Promise.reject(sdkFailure(error)); }
  if (pending.has(webApp)) return Promise.reject(new TelegramWriteAccessError('in-progress'));

  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let listening = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: boolean | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      if (listening) { try { webApp.offEvent('writeAccessRequested', onResult); } catch { /* Result still belongs to this request. */ } }
      pending.delete(webApp);
      if (typeof value === 'boolean') resolve(value); else reject(value);
    };
    const cancel = () => finish(aborted());
    const onResult = (payload?: unknown) => {
      const status = payload && typeof payload === 'object' && 'status' in payload ? payload.status : undefined;
      if (status === 'allowed' || status === 'cancelled') finish(status === 'allowed');
    };
    pending.add(webApp);
    try {
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) { cancel(); return; }
      timer = setTimeout(() => finish(new TelegramWriteAccessError('timeout')), options.timeoutMs ?? 30_000);
      if (typeof webApp.onEvent === 'function' && typeof webApp.offEvent === 'function') {
        listening = true;
        webApp.onEvent('writeAccessRequested', onResult);
      }
      if (!settled) webApp.requestWriteAccess!(value => { if (typeof value === 'boolean') finish(value); });
    } catch (error) { finish(sdkFailure(error)); }
  });
}
