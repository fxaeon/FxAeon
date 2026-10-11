import type { FxChainId } from "./types";

export const ETHEREUM_CHAIN_ID = 1 as const;
export const BASE_CHAIN_ID = 8453 as const;

export const FX_SDK_MAIN_COMMIT =
  "53c0b9805a169e75ad375c92c241e1292b66405f" as const;

const ALCHEMY_HOST_BY_CHAIN: Record<FxChainId, string> = {
  1: "eth-mainnet.g.alchemy.com",
  8453: "base-mainnet.g.alchemy.com",
};

export function isLocalForkMode(): boolean {
  return typeof process !== "undefined" && (
    process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE === "1"
    || process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE === "1"
  );
}

function localForkRpcEnv(): string | undefined {
  if (!isLocalForkMode() || typeof process === "undefined") return undefined;
  const value = process.env.NEXT_PUBLIC_FX_LOCAL_FORK_RPC_URL
    || process.env.NEXT_PUBLIC_FX_ANVIL_RPC_URL;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function requireRpcUrl(chainId: FxChainId): string {
  return configuredRpcUrls(chainId)[0];
}

/** HTTP preference: primary Alchemy, Infura, then Alchemy2. Every URL is checked
 * against a fixed provider host before it can be used by the wallet app. */
export function configuredRpcUrls(chainId: FxChainId): string[] {
  assertSupportedChainId(chainId);
  const localFork = chainId === ETHEREUM_CHAIN_ID ? localForkRpcEnv() : undefined;
  if (localFork) return [assertLocalForkRpcUrl(localFork, "Local fork RPC URL")];
  const candidates = chainId === ETHEREUM_CHAIN_ID
    ? [processEnv("NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL"), processEnv("NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL"), processEnv("NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL")]
    : [processEnv("NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL"), processEnv("NEXT_PUBLIC_INFURA_BASE_RPC_URL"), processEnv("NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL")];
  const labels = chainId === ETHEREUM_CHAIN_ID
    ? ["NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL", "NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL", "NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL"]
    : ["NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL", "NEXT_PUBLIC_INFURA_BASE_RPC_URL", "NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL"];
  const urls = candidates.flatMap((candidate, index) => {
    if (typeof candidate !== "string" || !candidate.trim()) return [];
    const label = labels[index];
    return [index === 1
      ? assertInfuraRpcUrl(candidate.trim(), chainId, label)
      : assertAlchemyRpcUrl(candidate.trim(), chainId, label)];
  });
  if (urls.length === 0) throw new Error(`${labels[0]} is required for browser blockchain operations`);
  return [...new Set(urls)];
}

/** Retry SDK operations against another reviewed endpoint only for transport,
 * capacity, or upstream service failures. Contract and request errors remain
 * terminal so an RPC failover cannot disguise a deterministic revert. */
export async function withConfiguredRpcFallback<T>(
  chainId: FxChainId,
  operation: (rpcUrl: string) => Promise<T>,
): Promise<T> {
  const urls = configuredRpcUrls(chainId);
  for (let index = 0; index < urls.length; index += 1) {
    try {
      return await operation(urls[index]);
    } catch (error) {
      if (index + 1 >= urls.length || !isTransientRpcFailure(error)) throw error;
    }
  }
  throw new Error(`No RPC endpoint is configured for chain ${chainId}`);
}

function isTransientRpcFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 5 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== "object") break;
    const item = current as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown; status?: unknown; statusCode?: unknown };
    const name = typeof item.name === "string" ? item.name : "";
    const message = typeof item.message === "string" ? item.message : "";
    const code = typeof item.code === "string" ? item.code : "";
    const status = typeof item.status === "number" ? item.status : item.statusCode;
    if (/revert|execution reverted|user rejected|transaction rejected/i.test(message)) return false;
    if (typeof status === "number" && (status === 429 || status >= 500)) return true;
    if (/^(?:ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT)$/.test(code)) return true;
    if (/^(?:HttpRequestError|TimeoutError|SocketError|NetworkError|AbortError|ProviderDisconnectedError)$/.test(name)) return true;
    if (/fetch failed|network error|timed? out|connection reset|temporarily unavailable|service unavailable|gateway timeout/i.test(message)) return true;
    current = item.cause;
  }
  return false;
}

function processEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  // Literal property accesses are required for Next's static env inlining.
  switch (name) {
    case "NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL": return process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL;
    case "NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL": return process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL;
    case "NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL": return process.env.NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL;
    case "NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL": return process.env.NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL;
    case "NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL": return process.env.NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL;
    case "NEXT_PUBLIC_INFURA_BASE_RPC_URL": return process.env.NEXT_PUBLIC_INFURA_BASE_RPC_URL;
    default: return undefined;
  }
}

/**
 * A local fork is available only to an explicit disposable screenshot or test
 * build. Keeping this opt-in and localhost-only prevents production bundles
 * from accepting arbitrary HTTP endpoints while making real fork-backed
 * captures and integration tests reproducible.
 */
export function assertLocalForkRpcUrl(value: string, label = "Local fork RPC URL"): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new Error(`${label} must point to localhost without credentials, query, or fragment`);
  }
  return parsed.toString().replace(/\/$/, '');
}

/**
 * Keep the runtime and CSP provider boundaries identical. Browser RPC keys
 * are public credentials, but they must never be sent to an unexpected host
 * because of a copied proxy URL, typo, or compromised build variable.
 */
export function assertAlchemyRpcUrl(
  value: string,
  chainId: FxChainId,
  label = "RPC URL",
): string {
  assertSupportedChainId(chainId);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS`);
  }
  if (parsed.hostname !== ALCHEMY_HOST_BY_CHAIN[chainId]) {
    throw new Error(`${label} must use the reviewed Alchemy host for chain ${chainId}`);
  }
  if (parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} cannot include credentials, a custom port, query, or fragment`);
  }
  if (!/^\/v2\/[^/]+\/?$/.test(parsed.pathname)) {
    throw new Error(`${label} must use an Alchemy /v2 application endpoint`);
  }
  return parsed.toString();
}

export function assertInfuraRpcUrl(value: string, chainId: FxChainId, label = "RPC URL"): string {
  assertSupportedChainId(chainId);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be an absolute HTTPS URL`); }
  const host = chainId === ETHEREUM_CHAIN_ID ? "mainnet.infura.io" : "base-mainnet.infura.io";
  if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  if (parsed.hostname !== host) throw new Error(`${label} must use the reviewed Infura host for chain ${chainId}`);
  if (parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} cannot include credentials, a custom port, query, or fragment`);
  }
  if (!/^\/v3\/[^/]+\/?$/.test(parsed.pathname)) throw new Error(`${label} must use an Infura /v3 project endpoint`);
  return parsed.toString();
}

export function assertSupportedChainId(chainId: number): asserts chainId is FxChainId {
  if (chainId !== ETHEREUM_CHAIN_ID && chainId !== BASE_CHAIN_ID) {
    throw new Error(`Unsupported FxAeon chain ${chainId}; use Ethereum or Base`);
  }
}
