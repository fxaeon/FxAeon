import { AppError } from '../domain/errors.ts';

const credentialKey = /^(?:tgwebapp.*|initdata|initdataunsafe|authorization|auth|authdate|accesstoken|idtoken|refreshtoken|token|jwt|code|state|session|signature|hash)$/i;
const credentialText = /(?:tgwebappdata|initdata|access[_-]?token|id[_-]?token|refresh[_-]?token|authorization)/i;
const control = /[\u0000-\u001f\u007f\\]/;

function invalid(): AppError { return new AppError('unavailable', 'Open FxAeon on its secure site before opening a wallet browser.'); }

/** No provider launch proof or OAuth credential is carried into another app. */
export function sanitizeWalletTarget(input: string, trustedOrigin: string): string {
  let trusted: URL;
  try { trusted = new URL(trustedOrigin); } catch { throw invalid(); }
  if (trusted.protocol !== 'https:' || trusted.username || trusted.password || trusted.origin !== trustedOrigin) throw invalid();

  function params(source: URLSearchParams, depth: number): URLSearchParams {
    const cleaned = new URLSearchParams();
    for (const [key, original] of source) {
      if (!/^[a-z0-9_.-]{1,64}$/i.test(key) || credentialKey.test(key.replace(/[_\-.]/g, '')) || original.length > 2048 || control.test(original)) continue;
      let value = original;
      // A URLSearchParams value has already been decoded once. Nested encoded
      // targets are normalized, then emitted once by the owning query layer.
      const isTarget = (candidate: string) => /^(?:[a-z][a-z0-9+.-]*:|\/|\.\/|#)/i.test(candidate);
      if (!isTarget(value) && /%[0-9a-f]{2}/i.test(value)) {
        try {
          for (let layer = 0; layer < 3 && !isTarget(value) && /%[0-9a-f]{2}/i.test(value); layer += 1) value = decodeURIComponent(value);
        } catch { continue; }
        if (!isTarget(value) && /%[0-9a-f]{2}/i.test(value)) continue;
      }
      if (control.test(value)) continue;
      if (isTarget(value)) {
        if (depth >= 3) continue;
        try { value = clean(value, depth + 1); } catch { continue; }
      } else if (credentialText.test(value) || /(?:javascript|data|vbscript|walletconnect|wc)\s*:/i.test(value)) continue;
      cleaned.append(key, value);
    }
    return cleaned;
  }

  function fragment(value: string, depth: number): string {
    if (!value) return '';
    const raw = value.slice(1);
    if (control.test(raw) || raw.length > 4096) return '';
    const question = raw.indexOf('?');
    if (question >= 0) {
      const route = raw.slice(0, question);
      if (!/^[a-z0-9/_.~-]*$/i.test(route)) return '';
      const query = params(new URLSearchParams(raw.slice(question + 1)), depth).toString();
      return route || query ? `#${route}${query ? `?${query}` : ''}` : '';
    }
    if (raw.includes('=')) {
      const query = params(new URLSearchParams(raw), depth).toString();
      return query ? `#${query}` : '';
    }
    return /^[a-z0-9/_.~-]{1,256}$/i.test(raw) ? `#${raw}` : '';
  }

  function clean(value: string, depth: number): string {
    if (value.length > 16_384 || control.test(value)) throw invalid();
    let url: URL;
    try { url = new URL(value, trustedOrigin); } catch { throw invalid(); }
    if (url.protocol !== 'https:' || url.origin !== trustedOrigin || url.username || url.password) throw invalid();
    // Reject encoded control/separator ambiguity in a path, rather than
    // guessing how a native deep-link implementation will decode it.
    if (/%(?:00|0[ad]|5c|2f|25)/i.test(url.pathname)) throw invalid();
    url.search = params(url.searchParams, depth).toString();
    url.hash = fragment(url.hash, depth);
    return url.href;
  }

  return clean(input, 0);
}

/** Navigation only: no pairing, signer acceptance, payment or action replay. */
export function metaMaskBrowserLink(input: string, trustedOrigin: string): string {
  const target = sanitizeWalletTarget(input, trustedOrigin);
  // Official MetaMask browser navigation destination, checked 2026-10-22:
  // https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks/
  return `https://link.metamask.io/dapp/${encodeURIComponent(target.slice('https://'.length))}`;
}
