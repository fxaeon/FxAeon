export class AccessError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  } });
}

/** A deadline and byte limit apply to chunked bodies too. No request content enters logs. */
export async function readJson(request: Request, limit = 48_000): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') || !request.body) {
    throw new AccessError('request_invalid');
  }
  const reader = request.body.getReader();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 3000);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0; let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (timedOut) throw new AccessError('request_invalid');
      if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); throw new AccessError('request_invalid'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccessError('request_invalid');
    return value as Record<string, unknown>;
  } catch { throw new AccessError('request_invalid'); }
  finally { clearTimeout(timer); reader.releaseLock(); }
}

export function textField(value: unknown, max = 4096): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new AccessError('request_invalid');
  return value;
}

export function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new AccessError('request_invalid');
}
