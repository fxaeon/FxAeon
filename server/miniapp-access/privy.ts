import canonicalize from 'canonicalize';
import { AccessError, exactKeys, readJson } from './http';
import { encode } from './passkeys';

const API = 'https://api.privy.io/v1';
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const APPROVAL_MS = 5 * 60_000;
type ObjectValue = Record<string, unknown>;
export interface Wallet { id: string; address: string; verified: true }
export interface WalletReservation { externalId: string; ownerPublicKey: string }
/** Durable lookup context, captured from the validated, signed request before dispatch. */
export interface TransactionContext {
  walletId: string;
  referenceId: string;
  caip2: 'eip155:1' | 'eip155:8453';
  expiresAt: number;
}
export function validateTransactionContext(value: TransactionContext): void {
  if (!value || typeof value.walletId !== 'string' || !ID.test(value.walletId)
    || typeof value.referenceId !== 'string' || !UUID.test(value.referenceId)
    || !['eip155:1', 'eip155:8453'].includes(value.caip2)
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) throw new AccessError('request_invalid');
}
export interface PreparedTransaction {
  url: string;
  body: ObjectValue;
  headers: Record<string, string>;
  challenge: string;
  expiresAt: number;
}

/** Transport credentials can provision wallets but are never a wallet owner or additional signer. */
export class PrivyWalletApi {
  constructor(private readonly appId: string, private readonly secret: string, private readonly send: typeof fetch = fetch) {
    if (!/^[a-z0-9]{20,40}$/.test(appId) || !secret || /[\r\n:]/.test(secret)) throw new AccessError('wallet_unavailable', 503);
  }

  private async request(path: string, body?: ObjectValue, headers: Record<string, string> = {}): Promise<ObjectValue | null> {
    const response = await this.send(`${API}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json', 'privy-app-id': this.appId,
        authorization: `Basic ${btoa(`${this.appId}:${this.secret}`)}`, ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!body && response.status === 404) return null;
    if (!response.ok) { await response.body?.cancel(); throw new AccessError('wallet_unavailable', 503); }
    if (!response.body) throw new AccessError('wallet_unavailable', 503);
    try {
      return await readJson(new Request('https://response.invalid', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: response.body,
        duplex: 'half',
      } as RequestInit), 65_536);
    } catch { throw new AccessError('wallet_unavailable', 503); }
  }

  private async verified(value: ObjectValue, reservation: WalletReservation): Promise<Wallet> {
    if (typeof value.id !== 'string' || !ID.test(value.id) || typeof value.address !== 'string'
      || !ADDRESS.test(value.address) || value.chain_type !== 'ethereum' || value.external_id !== reservation.externalId
      || typeof value.owner_id !== 'string' || !ID.test(value.owner_id)
      || !Array.isArray(value.additional_signers) || value.additional_signers.length !== 0) {
      throw new AccessError('wallet_owner_mismatch', 503);
    }
    const quorum = await this.request(`/key_quorums/${value.owner_id}`);
    const keys = quorum?.authorization_keys;
    const key = Array.isArray(keys) && keys.length === 1 ? keys[0] as ObjectValue : null;
    const empty = (v: unknown) => v == null || (Array.isArray(v) && v.length === 0);
    if (quorum?.id !== value.owner_id || quorum?.authorization_threshold !== 1 || !key || typeof key.public_key !== 'string'
      || key.public_key.replace(/\s/g, '') !== reservation.ownerPublicKey
      || !empty(quorum.user_ids) || !empty(quorum.key_quorum_ids)) {
      throw new AccessError('wallet_owner_mismatch', 503);
    }
    return { id: value.id, address: value.address, verified: true };
  }

  async provision(reservation: WalletReservation): Promise<Wallet> {
    if (!ID.test(reservation.externalId) || !/^[A-Za-z0-9+/=]{100,300}$/.test(reservation.ownerPublicKey)) {
      throw new AccessError('wallet_owner_invalid');
    }
    const path = `/wallets/ext_wal_${reservation.externalId}`;
    let wallet = await this.request(path);
    if (!wallet) {
      try {
        wallet = await this.request('/wallets', {
          chain_type: 'ethereum', external_id: reservation.externalId,
          owner: { public_key: reservation.ownerPublicKey }, additional_signers: [],
        }, { 'privy-idempotency-key': reservation.externalId });
      } catch {
        // A timeout/conflict may mean the first create succeeded. Never choose another external ID.
        wallet = await this.request(path);
      }
    }
    if (!wallet) throw new AccessError('wallet_unavailable', 503);
    return this.verified(wallet, reservation);
  }

  prepare(wallet: Wallet, transaction: unknown, requestId: string, now = Date.now()): PreparedTransaction {
    if (!ID.test(wallet.id) || !ADDRESS.test(wallet.address) || wallet.verified !== true
      || !UUID.test(requestId) || !Number.isSafeInteger(now) || now < 0
      || !Number.isSafeInteger(now + APPROVAL_MS)) throw new AccessError('request_invalid');
    const body = { ...transactionBody(transaction, wallet.address), reference_id: requestId };
    const expiresAt = now + APPROVAL_MS;
    const url = `${API}/wallets/${wallet.id}/rpc`;
    const headers = { 'privy-app-id': this.appId, 'privy-idempotency-key': requestId,
      'privy-request-expiry': String(expiresAt) };
    const canonical = canonicalize({ version: 1, method: 'POST', url, body, headers });
    if (!canonical || canonical.length > 24_000) throw new AccessError('transaction_invalid');
    return { url, body, headers, expiresAt, challenge: encode(new TextEncoder().encode(canonical)) };
  }

  /** Call before claiming the journal; submit checks again immediately before transport. */
  validatePrepared(prepared: PreparedTransaction, walletId: string, now = Date.now()): TransactionContext {
    try {
      if (!prepared || !prepared.headers || !ID.test(walletId) || prepared.url !== `${API}/wallets/${walletId}/rpc`
        || prepared.headers['privy-app-id'] !== this.appId
        || !Number.isSafeInteger(now) || !Number.isSafeInteger(prepared.expiresAt)
        || prepared.expiresAt <= now || prepared.expiresAt > now + APPROVAL_MS
        || prepared.headers['privy-request-expiry'] !== String(prepared.expiresAt)
        || !UUID.test(prepared.headers['privy-idempotency-key'] ?? '')
        || Object.keys(prepared.headers).some(key => !['privy-app-id', 'privy-idempotency-key', 'privy-request-expiry'].includes(key))) {
        throw new AccessError('approval_expired', 403);
      }
      // Validate the RPC schema too: a self-consistent canonical string is not sufficient.
      const body = prepared.body;
      exactKeys(body, ['method', 'caip2', 'params', 'reference_id']);
      const params = body.params as ObjectValue;
      exactKeys(params, ['transaction']);
      const tx = params.transaction as ObjectValue;
      const fields = { to: 'to', chain_id: 'chainId', value: 'value', data: 'data', gas_limit: 'gasLimit',
        gas_price: 'gasPrice', max_fee_per_gas: 'maxFeePerGas', max_priority_fee_per_gas: 'maxPriorityFeePerGas', nonce: 'nonce' };
      exactKeys(tx, Object.keys(fields));
      const client: ObjectValue = {};
      for (const [api, name] of Object.entries(fields)) if (tx[api] !== undefined) client[name] = tx[api];
      const expected = { ...transactionBody(client, ''), reference_id: prepared.headers['privy-idempotency-key'] };
      if (canonicalize(body) !== canonicalize(expected)) throw new AccessError('approval_expired', 403);
      const canonical = canonicalize({ version: 1, method: 'POST', url: prepared.url,
        body: prepared.body, headers: prepared.headers });
      if (!canonical || canonical.length > 24_000 || encode(new TextEncoder().encode(canonical)) !== prepared.challenge) {
        throw new AccessError('approval_expired', 403);
      }
      return { walletId, referenceId: body.reference_id as string,
        caip2: body.caip2 as TransactionContext['caip2'], expiresAt: prepared.expiresAt };
    } catch { throw new AccessError('approval_expired', 403); }
  }

  async submit(prepared: PreparedTransaction, walletId: string, authorization: string): Promise<string> {
    this.validatePrepared(prepared, walletId);
    if (!/^webauthn:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(authorization)) {
      throw new AccessError('approval_expired', 403);
    }
    // No unapproved server retry: the signed idempotency key is immutable for this intent.
    const result = await this.request(`/wallets/${walletId}/rpc`, prepared.body,
      { ...prepared.headers, 'privy-authorization-signature': authorization });
    const data = result?.data as ObjectValue | undefined;
    if (result?.method !== 'eth_sendTransaction' || data?.caip2 !== prepared.body.caip2
      || typeof data?.hash !== 'string' || !HASH.test(data.hash)) {
      throw new AccessError('transaction_unknown', 503);
    }
    return data.hash;
  }

  /** Positive broadcast evidence only. A hash (including a reverted tx) is NOT execution success. */
  async reconcile(context: TransactionContext): Promise<string | null> {
    validateTransactionContext(context);
    // Lookup by signed reference works even when the POST response and provider ID were lost.
    const result = await this.request(`/transactions?reference_id=${encodeURIComponent(context.referenceId)}`);
    const transactions = result?.transactions;
    if (!Array.isArray(transactions) || transactions.length !== 1) return null;
    const tx = transactions[0];
    if (!tx || typeof tx !== 'object' || Array.isArray(tx) || typeof tx.id !== 'string' || !ID.test(tx.id)
      || tx.reference_id !== context.referenceId || tx.wallet_id !== context.walletId || tx.caip2 !== context.caip2
      || !['broadcasted', 'confirmed', 'finalized', 'execution_reverted'].includes(tx.status)
      || typeof tx.transaction_hash !== 'string' || !HASH.test(tx.transaction_hash)) return null;
    return tx.transaction_hash;
  }
}

function quantity(value: unknown): string {
  if ((typeof value !== 'string' || !/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(value))
    && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) throw new AccessError('transaction_invalid');
  const n = BigInt(value as string | number);
  if (n < 0n || n >= 2n ** 256n) throw new AccessError('transaction_invalid');
  return `0x${n.toString(16)}`;
}

export function transactionBody(value: unknown, address: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccessError('transaction_invalid');
  const tx = value as ObjectValue;
  exactKeys(tx, ['to', 'from', 'chainId', 'data', 'value', 'gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'nonce']);
  if ((tx.chainId !== 1 && tx.chainId !== 8453) || typeof tx.to !== 'string' || !ADDRESS.test(tx.to)
    || (tx.from !== undefined && (typeof tx.from !== 'string' || tx.from.toLowerCase() !== address.toLowerCase()))) {
    throw new AccessError('transaction_invalid');
  }
  const transaction: ObjectValue = { to: tx.to, chain_id: tx.chainId, value: quantity(tx.value === undefined ? '0' : tx.value) };
  if (tx.data !== undefined) {
    if (typeof tx.data !== 'string' || !/^0x(?:[a-fA-F0-9]{2})*$/.test(tx.data) || tx.data.length > 16_384) {
      throw new AccessError('transaction_invalid');
    }
    transaction.data = tx.data;
  }
  if (tx.gasPrice !== undefined && (tx.maxFeePerGas !== undefined || tx.maxPriorityFeePerGas !== undefined)) throw new AccessError('transaction_invalid');
  for (const [client, api] of Object.entries({ gasLimit: 'gas_limit', gasPrice: 'gas_price',
    maxFeePerGas: 'max_fee_per_gas', maxPriorityFeePerGas: 'max_priority_fee_per_gas', nonce: 'nonce' })) {
    if (tx[client] !== undefined) transaction[api] = quantity(tx[client]);
  }
  return { method: 'eth_sendTransaction', caip2: `eip155:${tx.chainId}`, params: { transaction } };
}
