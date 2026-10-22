import { AppError, assertActive } from '../domain/errors';
import { bounded, object, quantity, safeNumber } from './values';

export interface RpcPort {
  prove(signal: AbortSignal): Promise<void>;
  request(method: string, params: readonly unknown[], signal: AbortSignal): Promise<unknown>;
}

export interface RpcOptions {
  rpcUrls: readonly string[];
  chainId?: 1 | 8453;
  allowLocalFork?: boolean;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

const READ_METHODS = new Set([
  'eth_chainId', 'eth_call', 'eth_estimateGas', 'eth_getBalance',
  'eth_getTransactionCount', 'eth_blockNumber', 'eth_getBlockByNumber',
  'eth_getBlockByHash', 'eth_getTransactionByHash', 'eth_getTransactionReceipt',
  'eth_feeHistory', 'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_getLogs', 'eth_getCode', 'eth_simulateV1',
]);

class RpcFault extends Error {
  constructor(readonly terminal: boolean) { super('RPC request failed'); }
}

export function validatedUrls(input: readonly string[], fork = false, chainId: 1 | 8453 = 1): readonly string[] {
  if (input.length < 1 || input.length > 3 || (fork && input.length !== 1)) {
    throw new AppError('unavailable', 'Configure a reviewed Ethereum RPC endpoint to prepare a trade.');
  }
  const urls = input.map((raw) => {
    let url: URL;
    try { url = new URL(raw); } catch { throw new AppError('policy', 'The Ethereum RPC configuration is not supported.'); }
    const noCredentials = !url.username && !url.password && !url.search && !url.hash;
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    const production = url.protocol === 'https:' && !url.port && (
      (url.hostname === (chainId === 1 ? 'eth-mainnet.g.alchemy.com' : 'base-mainnet.g.alchemy.com') && /^\/v2\/[A-Za-z0-9_-]+$/.test(url.pathname))
      || (url.hostname === (chainId === 1 ? 'mainnet.infura.io' : 'base-mainnet.infura.io') && /^\/v3\/[A-Za-z0-9_-]+$/.test(url.pathname))
    );
    if (!noCredentials || (fork ? !local || url.protocol !== 'http:' || url.pathname !== '/' : !production)) {
      throw new AppError('policy', 'The Ethereum RPC configuration is not supported.');
    }
    return url.href;
  });
  return Object.freeze([...new Set(urls)]);
}

/** Read-only ordered transport. Every endpoint proves its own Ethereum identity. */
export function createRpc(options: RpcOptions): RpcPort {
  const expectedChain = options.chainId ?? 1;
  const urls = validatedUrls(options.rpcUrls, options.allowLocalFork, expectedChain);
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const timeout = options.requestTimeoutMs ?? 5_000;
  const proofs = new Map<string, number>();
  let nextId = 0;

  async function exchange(url: string, method: string, params: readonly unknown[], signal: AbortSignal, budget = timeout): Promise<unknown> {
    return bounded(signal, budget, async (inner) => {
      assertActive(inner);
      const id = ++nextId;
      let response: Response;
      try {
        response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: inner, credentials: 'omit', redirect: 'error' });
      } catch (error) {
        assertActive(inner);
        throw error instanceof AppError ? error : new RpcFault(false);
      }
      if (!response.ok) throw new RpcFault(false);
      const size = Number(response.headers.get('content-length'));
      if (size > 2_000_000) throw new RpcFault(false);
      const reader = response.body?.getReader();
      if (!reader) throw new RpcFault(false);
      const decoder = new TextDecoder();
      let body = ''; let length = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          assertActive(inner);
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 2_000_000) { await reader.cancel(); throw new RpcFault(false); }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
      } finally { reader.releaseLock(); }
      let parsed: Record<string, unknown>;
      try { parsed = object(JSON.parse(body)); } catch { throw new RpcFault(false); }
      if (parsed.jsonrpc !== '2.0' || parsed.id !== id || ('error' in parsed) === ('result' in parsed)) throw new RpcFault(false);
      if ('error' in parsed) {
        const error = object(parsed.error);
        const message = typeof error.message === 'string' ? error.message : '';
        throw new RpcFault(error.code === 3 || error.code === -32601 || error.code === -32602
          || /revert|insufficient funds|nonce|user rejected/i.test(message));
      }
      return parsed.result;
    });
  }

  async function proveAt(url: string, signal: AbortSignal): Promise<void> {
    proofs.delete(url);
    const chain = await exchange(url, 'eth_chainId', [], signal, options.allowLocalFork ? timeout : Math.min(timeout, 1_500));
    if (quantity(chain) !== BigInt(expectedChain)) throw new AppError('wrong-chain', 'The RPC endpoint did not prove the requested network.');
    if (options.allowLocalFork) {
      const metadata = object(await exchange(url, 'anvil_metadata', [], signal));
      const fork = object(metadata.forkedNetwork);
      const chainId = typeof metadata.chainId === 'number' ? metadata.chainId : safeNumber(quantity(metadata.chainId));
      const forkChain = typeof fork.chainId === 'number' ? fork.chainId : safeNumber(quantity(fork.chainId));
      if (chainId !== expectedChain || forkChain !== expectedChain || typeof metadata.clientVersion !== 'string' || !/^anvil\b/i.test(metadata.clientVersion)
        || typeof fork.forkBlockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(fork.forkBlockHash)) {
        throw new AppError('wrong-chain', 'The local endpoint did not prove an Ethereum Anvil fork.');
      }
    }
    assertActive(signal);
    proofs.set(url, now());
  }

  async function request(method: string, params: readonly unknown[], signal: AbortSignal): Promise<unknown> {
    if (!READ_METHODS.has(method)) throw new AppError('policy', 'The protocol transport cannot sign or send transactions.');
    let wrongChain = false;
    for (const url of urls) {
      assertActive(signal);
      try {
        const provenAt = proofs.get(url);
        if (method === 'eth_chainId' || provenAt === undefined || now() - provenAt >= 60_000 || now() < provenAt) await proveAt(url, signal);
        if (method === 'eth_chainId') return `0x${expectedChain.toString(16)}`;
        return await exchange(url, method, params, signal);
      } catch (error) {
        proofs.delete(url);
        assertActive(signal);
        if (error instanceof RpcFault && error.terminal) throw new AppError('simulation', 'The chain rejected this request. Refresh the trade before trying again.');
        if (error instanceof AppError && error.code === 'wrong-chain') wrongChain = true;
      }
    }
    throw new AppError(wrongChain ? 'wrong-chain' : 'unavailable', wrongChain
      ? 'No configured RPC endpoint proved Ethereum.' : 'Ethereum could not be reached or verified. Please try again.');
  }

  return Object.freeze({ request, prove: async (signal: AbortSignal) => { await request('eth_chainId', [], signal); } });
}
