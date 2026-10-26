/** EIP-6963 display-only images. Never fetch extension-supplied URLs. */
export function safeWalletIcon(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 128 * 1024) return undefined;
  const match = /^data:image\/(png|webp|svg\+xml|jpeg)(?:;charset=utf-8)?(;base64)?,([\s\S]+)$/i.exec(value);
  if (!match) return undefined;
  const payload = match[3];
  if (match[2]) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) return undefined;
  } else if (/%(?![0-9a-f]{2})/i.test(payload)) return undefined;
  return value;
}
