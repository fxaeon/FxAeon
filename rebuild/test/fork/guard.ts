import { keccak256, parseTransaction, recoverTransactionAddress } from 'viem';
import type { TransactionSerialized } from 'viem';
import type { Address, Hash } from '../../src/domain/ports';

/** This capability exists only in the fork test tree. Production never imports it. */
export interface ForkIdentity {
  readonly blockNumber: bigint;
  readonly blockHash: Hash;
  readonly instanceId?: Hash;
}

export interface ProvenFork extends ForkIdentity {
  readonly instanceId: Hash;
  readonly clientVersion: string;
  readonly localUrl: string;
}

const READ_METHODS = new Set([
  'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBalance',
  'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_getTransactionCount',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_gasPrice',
  'eth_feeHistory', 'eth_maxPriorityFeePerGas',
]);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function record(value: unknown): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object.');
  return value as Record<string, unknown>;
}

export function quantity(value: unknown): bigint {
  if (typeof value === 'number') {
    invariant(Number.isSafeInteger(value) && value >= 0, 'Unsafe numeric RPC quantity.');
    return BigInt(value);
  }
  invariant(typeof value === 'string' && /^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(value), 'Invalid RPC quantity.');
  return BigInt(value);
}

export function hash(value: unknown): Hash {
  invariant(typeof value === 'string' && HASH.test(value), 'Missing or malformed block, instance, or transaction hash.');
  return value.toLowerCase() as Hash;
}

export function loopbackUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('The fork wallet requires a literal loopback URL.'); }
  // A numeric address avoids DNS and localhost aliases. No proxy, redirect,
  // embedded credential, query, or path is ever an alternate signing target.
  invariant(url.protocol === 'http:' && url.hostname === '127.0.0.1'
    && /^\d+$/.test(url.port) && Number(url.port) >= 1024 && Number(url.port) <= 65_535
    && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash,
  'The fork wallet requires http://127.0.0.1 with an explicit unprivileged port.');
  invariant(/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(raw), 'The signing URL must use canonical numeric loopback notation.');
  return url.href;
}

/** Bounded JSON-RPC exchange; errors never echo request bodies or upstream URLs. */
export function rpcExchange(url: string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis), timeoutMs = 8_000) {
  let serial = 0;
  return async (method: string, params: readonly unknown[] = []): Promise<unknown> => {
    const id = ++serial;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: abort.signal,
          redirect: 'error', credentials: 'omit' });
      } catch { throw new Error('RPC transport failed or exceeded its deadline.'); }
      invariant(response.ok, `RPC HTTP request failed (${response.status}).`);
      invariant(Number(response.headers.get('content-length') ?? 0) <= 2_000_000, 'RPC response exceeded the size limit.');
      const reader = response.body?.getReader();
      invariant(reader, 'RPC response has no readable body.');
      let text = ''; let length = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 2_000_000) { await reader.cancel(); throw new Error('RPC response exceeded the size limit.'); }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      let body: Record<string, unknown>;
      try { body = record(JSON.parse(text)); } catch { throw new Error('RPC returned malformed JSON.'); }
      invariant(body.jsonrpc === '2.0' && body.id === id && ('result' in body) !== ('error' in body), 'RPC response envelope did not match its request.');
      if ('error' in body) {
        const error = record(body.error);
        throw new Error(`RPC method ${method} failed (code ${Number.isSafeInteger(error.code) ? error.code : 'unknown'}).`);
      }
      return body.result;
    } finally { clearTimeout(timer); }
  };
}

export class GuardedFork {
  readonly url: string;
  readonly #exchange: ReturnType<typeof rpcExchange>;
  readonly #expected: ForkIdentity;
  #proof?: ProvenFork;
  #disposable?: Address;

  constructor(url: string, expected: ForkIdentity, fetcher?: typeof fetch) {
    this.url = loopbackUrl(url);
    invariant(expected.blockNumber > 0n, 'A positive pinned fork block is required.');
    this.#expected = Object.freeze({ ...expected, blockHash: hash(expected.blockHash),
      ...(expected.instanceId ? { instanceId: hash(expected.instanceId) } : {}) });
    this.#exchange = rpcExchange(this.url, fetcher);
  }

  async prove(): Promise<ProvenFork> {
    const chain = quantity(await this.#exchange('eth_chainId'));
    invariant(chain === 1n, 'The local node is not Ethereum chain 1.');
    const client = await this.#exchange('web3_clientVersion');
    invariant(typeof client === 'string' && /^anvil\b/i.test(client), 'The local client did not identify as Anvil.');
    const metadata = record(await this.#exchange('anvil_metadata'));
    const fork = record(metadata.forkedNetwork);
    invariant(quantity(metadata.chainId) === 1n && quantity(fork.chainId) === 1n, 'Anvil metadata did not prove an Ethereum fork.');
    invariant(typeof metadata.clientVersion === 'string' && /^anvil\b/i.test(metadata.clientVersion), 'Anvil client metadata is missing.');
    const instanceId = hash(metadata.instanceId);
    const expectedInstance = this.#expected.instanceId ?? this.#proof?.instanceId;
    invariant(!expectedInstance || instanceId === expectedInstance, 'The local Anvil instance changed.');
    invariant(quantity(fork.forkBlockNumber) === this.#expected.blockNumber, 'Anvil fork block differs from the pinned archive block.');
    invariant(hash(fork.forkBlockHash) === this.#expected.blockHash, 'Anvil fork hash differs from the archive block.');
    const base = record(await this.#exchange('eth_getBlockByNumber', [`0x${this.#expected.blockNumber.toString(16)}`, false]));
    invariant(quantity(base.number) === this.#expected.blockNumber && hash(base.hash) === this.#expected.blockHash,
      'The local canonical base header does not match the archive proof.');
    invariant(quantity(await this.#exchange('eth_blockNumber')) >= this.#expected.blockNumber, 'The local head precedes the fork base.');
    this.#proof = Object.freeze({ ...this.#expected, instanceId, clientVersion: metadata.clientVersion, localUrl: this.url });
    return this.#proof;
  }

  async read(method: string, params: readonly unknown[] = []): Promise<unknown> {
    invariant(this.#proof, 'Prove the local fork before reading it.');
    invariant(READ_METHODS.has(method), 'That method is outside the fork read capability.');
    return this.#exchange(method, params);
  }

  async fundDisposable(address: Address): Promise<void> {
    invariant(ADDRESS.test(address), 'Invalid disposable account.');
    invariant(!this.#disposable, 'This fork capability has already funded its disposable account.');
    await this.prove();
    this.#disposable = address.toLowerCase() as Address;
    // Only a fresh test account gets balance. Protocol code/storage and existing
    // real account ownership are never replaced or impersonated by this harness.
    await this.#exchange('anvil_setBalance', [this.#disposable, '0x1bc16d674ec80000']); // 2 ETH
  }

  async beforeSign(address: Address): Promise<void> {
    invariant(this.#disposable === address.toLowerCase(), 'Only the funded disposable account may sign.');
    await this.prove();
  }

  async sendRaw(address: Address, signed: Hash): Promise<Hash> {
    invariant(/^0x(?:[0-9a-fA-F]{2}){32,32768}$/.test(signed), 'Invalid serialized test transaction.');
    await this.beforeSign(address);
    const decoded = parseTransaction(signed);
    invariant(decoded.chainId === 1 && decoded.to, 'The disposable signer cannot send another chain or deploy a contract.');
    // parseTransaction has already validated serialization; require a signature
    // before narrowing to viem's signed transaction union at this test boundary.
    invariant(decoded.r && decoded.s && (decoded.v !== undefined || decoded.yParity !== undefined), 'The disposable transaction has no signature.');
    invariant((await recoverTransactionAddress({ serializedTransaction: signed as TransactionSerialized })).toLowerCase() === this.#disposable,
      'The signed transaction did not originate from the disposable account.');
    await this.beforeSign(address);
    const returned = hash(await this.#exchange('eth_sendRawTransaction', [signed]));
    invariant(returned === keccak256(signed), 'The local node returned a different transaction hash.');
    return returned;
  }

  async snapshot(): Promise<string> {
    await this.prove();
    const id = await this.#exchange('evm_snapshot');
    invariant(typeof id === 'string' && /^0x[0-9a-fA-F]+$/.test(id), 'Anvil returned an invalid snapshot.');
    return id;
  }

  async revert(id: string): Promise<void> {
    invariant(/^0x[0-9a-fA-F]+$/.test(id), 'Invalid snapshot ID.');
    await this.prove();
    invariant(await this.#exchange('evm_revert', [id]) === true, 'The owned fork snapshot could not be restored.');
  }
}
