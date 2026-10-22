import { custom, keccak256, toBytes } from 'viem';
import { AppError, assertActive, safeError } from '../domain/errors';
import type { Address, Hash, LongIntent, PreparedLong, ProtocolPort, ReviewedCall, WalletSession } from '../domain/ports';
import { ADDRESSES, POOL_ABI } from './contracts';
import { decodeLongCall, validateSdkLong } from './policy';
import { executionProof } from './preflight';
import { canonicalPosition, contractRead, marketFacts, poolSnapshot, withInputQuote } from './reads';
import { mintedPosition, verifyReceipt } from './receipts';
import { createRpc, validatedUrls } from './rpc';
import type { RpcPort } from './rpc';
import { address, bounded, hash, hex, invariant, object, quantity, validateIntent, validateSession } from './values';

export interface SdkLongRequest {
  readonly market: 'ETH'; readonly type: 'long'; readonly positionId: 0;
  readonly userAddress: Address; readonly inputTokenAddress: Address;
  readonly amount: bigint; readonly leverage: number; readonly slippage: number;
  readonly targets: readonly ['FxRoute'];
}
export interface SdkPort {
  increasePosition(request: SdkLongRequest): Promise<unknown>;
  getPositions(request: { userAddress: Address; market: 'ETH'; type: 'long' }): Promise<unknown>;
}
export interface ProtocolDependencies {
  readonly rpc: RpcPort;
  readonly sdk: () => Promise<SdkPort>;
  readonly now?: () => number;
}

// The third-party SDK caches its first client globally. One immutable binding
// prevents a second configuration from silently using the first URL's authority.
let installedBinding: { key: string; sdk: Promise<SdkPort> } | undefined;

function installedSdk(rpc: RpcPort, urls: readonly string[], fork: boolean): Promise<SdkPort> {
  const key = JSON.stringify([urls, fork]);
  if (installedBinding) {
    if (installedBinding.key !== key) return Promise.reject(new AppError('policy', 'Reload before changing the protocol RPC configuration.'));
    return installedBinding.sdk;
  }
  const pending = import('@aladdindao/fx-sdk').then(({ FxSdk }) => {
    const transport = custom({ request: async ({ method, params }) => rpc.request(method,
      Array.isArray(params) ? params : [], new AbortController().signal) }, { retryCount: 0 });
    // SDK 1.0.5 pins an older viem type graph; the runtime custom transport
    // interface is unchanged. Keep this compatibility cast at that boundary.
    type VendorConfig = NonNullable<ConstructorParameters<typeof FxSdk>[0]>;
    const sdk = new FxSdk({ chainId: 1, rpcUrls: [...urls],
      rpcTransport: transport as unknown as VendorConfig['rpcTransport'] });
    return {
      increasePosition: (request: SdkLongRequest) => sdk.increasePosition({ ...request, targets: ['FxRoute'] as never }),
      getPositions: (request: { userAddress: Address; market: 'ETH'; type: 'long' }) => sdk.getPositions(request),
    };
  });
  installedBinding = { key, sdk: pending };
  return pending;
}

export function createProtocol(options: { rpcUrls: string[]; allowLocalFork?: boolean }): ProtocolPort {
  const urls = validatedUrls(options.rpcUrls, options.allowLocalFork);
  const rpc = createRpc({ rpcUrls: urls, allowLocalFork: options.allowLocalFork });
  return createProtocolWithDependencies({ rpc, sdk: () => installedSdk(rpc, urls, options.allowLocalFork === true) });
}

function callIdentity(call: ReviewedCall): string {
  return [call.chainId, call.from.toLowerCase(), call.to.toLowerCase(), call.data.toLowerCase(), call.value.toString(), call.nonce].join(':');
}

/** Deterministic seam; the public runtime uses the real RPC and official SDK above. */
export function createProtocolWithDependencies({ rpc, sdk, now = Date.now }: ProtocolDependencies): ProtocolPort {
  const prepared = new Map<Hash, { plan: PreparedLong; sdkEvidence: unknown }>();

  async function guarded<T>(signal: AbortSignal, milliseconds: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try { return await bounded(signal, milliseconds, task); } catch (error) { throw safeError(error); }
  }

  function accepted(plan: PreparedLong, session: WalletSession): { plan: PreparedLong; sdkEvidence: unknown } {
    const entry = prepared.get(plan.id);
    if (!entry || entry.plan !== plan) throw new AppError('policy', 'This review was not prepared by the current protocol session.');
    const owner = validateSession(session);
    if (session.id !== plan.sessionId || owner !== plan.call.from) throw new AppError('wallet-changed', 'The selected wallet changed. Prepare a new review.');
    if (now() < plan.preparedAt || now() >= plan.expiresAt) throw new AppError('expired', 'This review expired. Refresh and accept the new terms.');
    return entry;
  }

  return Object.freeze({
    readMarket: (owner: Address | undefined, signal: AbortSignal) => guarded(signal, 12_000, async (inner) => {
      await rpc.prove(inner);
      const pool = await poolSnapshot(rpc, inner, now);
      let balance: bigint | undefined;
      if (owner) {
        try { balance = quantity(await rpc.request('eth_getBalance', [address(owner), hex(pool.blockNumber)], inner)); }
        catch { assertActive(inner); /* An unavailable balance is not a zero balance. */ }
      }
      return marketFacts(pool, balance);
    }),

    prepare: (intent: LongIntent, session: WalletSession, signal: AbortSignal) => guarded(signal, 45_000, async (inner) => {
      validateIntent(intent);
      const owner = validateSession(session);
      await rpc.prove(inner);
      const planner = await sdk();
      assertActive(inner);
      const evidence = await planner.increasePosition({ market: 'ETH', type: 'long', positionId: 0,
        userAddress: owner, inputTokenAddress: ADDRESSES.native, amount: intent.amountWei,
        leverage: intent.leverageBps / 10_000, slippage: intent.slippageBps / 100, targets: ['FxRoute'] });
      assertActive(inner);
      const preparedAt = now();
      const pool = await withInputQuote(rpc, await poolSnapshot(rpc, inner, now), intent.amountWei, inner);
      const verified = validateSdkLong(evidence, intent, session, pool);
      const cost = await executionProof(rpc, verified.call, inner);
      if (now() >= preparedAt + 30_000) throw new AppError('expired', 'The prepared quote expired before its checks completed. Refresh the review.');
      const id = keccak256(toBytes([callIdentity(verified.call), session.id, preparedAt, intent.leverageBps, intent.slippageBps].join('|')));
      const plan: PreparedLong = Object.freeze({ id, sessionId: session.id, intent: Object.freeze({ ...intent }), call: verified.call,
        preparedAt, expiresAt: preparedAt + 30_000, blockNumber: pool.blockNumber, economics: verified.economics, ...cost, simulation: 'passed' });
      assertActive(inner);
      // Only in-memory current-generation evidence can authorize a preflight.
      // A serialized historical record can be observed, never automatically sent.
      for (const [key, entry] of prepared) if (entry.plan.expiresAt <= now()) prepared.delete(key);
      if (prepared.size >= 16) prepared.delete(prepared.keys().next().value!);
      prepared.set(id, { plan, sdkEvidence: structuredClone(evidence) });
      return plan;
    }),

    preflight: (plan: PreparedLong, session: WalletSession, signal: AbortSignal) => guarded(signal, 12_000, async (inner) => {
      const entry = accepted(plan, session);
      await rpc.prove(inner);
      const pool = await withInputQuote(rpc, await poolSnapshot(rpc, inner, now), plan.intent.amountWei, inner);
      const verified = validateSdkLong(entry.sdkEvidence, plan.intent, session, pool);
      invariant(callIdentity(verified.call) === callIdentity(plan.call), 'The reviewed transaction changed.');
      const refreshed = await executionProof(rpc, plan.call, inner);
      if (refreshed.gasLimit > plan.gasLimit || refreshed.feePerGasWei > plan.feePerGasWei
        || refreshed.requiredBalanceWei > plan.requiredBalanceWei) {
        throw new AppError('expired', 'Network fee requirements increased. Refresh and accept the updated review.');
      }
      accepted(plan, session);
      assertActive(inner);
    }),

    observe: async (submitted: Hash, call: ReviewedCall, signal: AbortSignal) => {
      try {
        return await guarded(signal, 12_000, async (inner) => {
          const wanted = hash(submitted);
          decodeLongCall(call);
          await rpc.prove(inner);
          const [receiptRaw, transaction] = await Promise.all([
            rpc.request('eth_getTransactionReceipt', [wanted], inner), rpc.request('eth_getTransactionByHash', [wanted], inner),
          ]);
          if (receiptRaw === null || transaction === null) return null;
          const receipt = object(receiptRaw);
          const blockNumber = quantity(receipt.blockNumber);
          const canonical = await rpc.request('eth_getBlockByNumber', [hex(blockNumber), false], inner);
          const proof = verifyReceipt(wanted, call, receiptRaw, transaction, canonical);
          let positionId = mintedPosition(proof, call);
          let position;
          if (positionId !== undefined) {
            try {
              const owner = address(await contractRead(rpc, ADDRESSES.pool, POOL_ABI, 'ownerOf', [positionId], 'latest', inner));
              if (owner !== call.from.toLowerCase()) positionId = undefined;
              else {
                // The official reader is a hint while its index catches up. The
                // receipt-proven ID and fresh owner/accounting remain authority.
                try {
                  await bounded(inner, 2_000, async () => (await sdk()).getPositions({ userAddress: owner, market: 'ETH', type: 'long' }));
                } catch { assertActive(inner); }
                try {
                  const state = await canonicalPosition(rpc, owner, positionId, inner);
                  if (state) position = Object.freeze({ id: positionId, collateralStEthWei: state.collateral, debtFxUsdWei: state.debt });
                } catch { assertActive(inner); /* Proven ownership can precede accounting availability. */ }
              }
            } catch { assertActive(inner); positionId = undefined; }
          }
          // Inclusion can change while post-action reads are outstanding.
          const [lastReceipt, lastBlock] = await Promise.all([
            rpc.request('eth_getTransactionReceipt', [wanted], inner),
            rpc.request('eth_getBlockByNumber', [hex(blockNumber), false], inner),
          ]);
          if (lastReceipt === null) return null;
          const final = verifyReceipt(wanted, call, lastReceipt, transaction, lastBlock);
          if (final.value.blockHash !== proof.value.blockHash || final.value.status !== proof.value.status
            || final.value.networkFeeWei !== proof.value.networkFeeWei) return null;
          if (positionId !== undefined && mintedPosition(final, call) !== positionId) { positionId = undefined; position = undefined; }
          if (positionId !== undefined) {
            try {
              const currentOwner = address(await contractRead(rpc, ADDRESSES.pool, POOL_ABI, 'ownerOf', [positionId], 'latest', inner));
              if (currentOwner !== call.from.toLowerCase()) { positionId = undefined; position = undefined; }
            } catch { assertActive(inner); positionId = undefined; position = undefined; }
          }
          assertActive(inner);
          return Object.freeze({ ...final.value, ...(positionId === undefined ? {} : { positionId }),
            ...(positionId === undefined || !position ? {} : { position }) });
        });
      } catch (error) {
        assertActive(signal);
        // An outage, mismatch or reorg is not a successful action or a failed spend.
        // The controller retains the submitted hash and may observe it again.
        if (error instanceof AppError && error.code === 'cancelled') throw error;
        return null;
      }
    },
  });
}
