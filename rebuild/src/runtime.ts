import { AppError } from './domain/errors';
import type { ProtocolPort, Runtime } from './domain/ports';
import { createHost } from './host/browser';
import { createBrowserWallet } from './wallet/browser';

/** Static, public, origin-restricted provider configuration; never a server secret. */
export function createRuntime(): Runtime {
  const rpcUrls = String(import.meta.env.VITE_ETHEREUM_RPC_URLS ?? '').split(',').map(x => x.trim()).filter(Boolean);
  let adapter: Promise<ProtocolPort> | undefined;
  const getProtocol = (): Promise<ProtocolPort> => {
    if (!rpcUrls.length) return Promise.reject(new AppError('unavailable', 'Ethereum reads are not configured for this preview. You can explore the interface; live review is unavailable.'));
    adapter ??= import('./protocol/index').then(module => module.createProtocol({ rpcUrls }));
    return adapter;
  };
  const protocol: ProtocolPort = {
    readMarket: async (...args) => (await getProtocol()).readMarket(...args),
    prepare: async (...args) => (await getProtocol()).prepare(...args),
    preflight: async (...args) => (await getProtocol()).preflight(...args),
    observe: async (...args) => (await getProtocol()).observe(...args)
  };
  return { mode: 'live', protocol, wallet: createBrowserWallet(), host: createHost() };
}
