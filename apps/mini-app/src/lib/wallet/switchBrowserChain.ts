import { assertAlchemyRpcUrl, assertInfuraRpcUrl, assertLocalForkRpcUrl, assertSupportedChainId } from '../fx/config';
import type { FxChainId } from '../fx/types';

type ChainRequestProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type BrowserChainRpcConfig = {
  configuredRpcUrl?: string;
  configuredRpcUrls?: readonly string[];
  localForkRpcUrl?: string;
};

const CHAIN_METADATA: Record<FxChainId, { chainId: string; chainName: string; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] }> = {
  1: {
    chainId: '0x1',
    chainName: 'Ethereum Mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://etherscan.io'],
  },
  8453: {
    chainId: '0x2105',
    chainName: 'Base',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://basescan.org'],
  },
};

function isUnknownChainError(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  if ('code' in cause) {
    if (cause.code === 4001) return false;
    if (cause.code === 4902) return true;
  }

  // MetaMask Mobile wraps this code at data.originalError. Keep the lookup
  // bounded to that shape; unrelated causes or error text cannot trigger add.
  if (!('data' in cause) || typeof cause.data !== 'object' || cause.data === null) return false;
  if (!('originalError' in cause.data)) return false;
  const originalError = cause.data.originalError;
  return typeof originalError === 'object' && originalError !== null
    && 'code' in originalError && originalError.code === 4902;
}

/**
 * Known networks need no app RPC metadata. Resolve and validate a URL only
 * after the wallet explicitly reports an unknown chain (EIP-1193 code 4902).
 * Neither rejection nor a generic provider error grants permission to add it.
 */
export async function switchBrowserChain(
  provider: ChainRequestProvider,
  chainId: FxChainId,
  resolveRpcConfig: () => BrowserChainRpcConfig,
): Promise<void> {
  assertSupportedChainId(chainId);
  const targetChainId = CHAIN_METADATA[chainId].chainId;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetChainId }] });
    return;
  } catch (cause) {
    if (!isUnknownChainError(cause)) throw cause;
  }

  let rpcUrls: string[];
  try {
    const { configuredRpcUrl, configuredRpcUrls, localForkRpcUrl } = resolveRpcConfig();
    rpcUrls = localForkRpcUrl
      ? [assertLocalForkRpcUrl(localForkRpcUrl, 'Screenshot fork RPC URL')]
      : [...new Set((configuredRpcUrls ?? [configuredRpcUrl || '']).map((url) => {
        const hostname = new URL(url).hostname;
        return hostname.endsWith('.infura.io')
          ? assertInfuraRpcUrl(url, chainId, 'Browser chain RPC URL')
          : assertAlchemyRpcUrl(url, chainId, 'Browser chain RPC URL');
      }))];
    if (!rpcUrls.length) throw new Error('No network RPC configured');
  } catch {
    // A configuration value can contain a provider credential; never reflect
    // the rejected URL in wallet UI or error messages.
    throw new Error('This wallet does not have the requested network yet. Add Ethereum or Base in the wallet, then try again.');
  }

  const metadata = { ...CHAIN_METADATA[chainId], rpcUrls };
  await provider.request({ method: 'wallet_addEthereumChain', params: [metadata] });
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetChainId }] });
}
