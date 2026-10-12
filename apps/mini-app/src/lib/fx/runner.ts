import {
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { assertPublicClientChain, getPublicClient } from "./clients";
import { gasLimitWithHeadroom } from "./gasLimit";
import { recordPendingHash, updatePendingHashRecord } from "./journal";
import { withWalletChainLock } from "./lock";
import { defaultTransactionPolicy } from "./policy";
import { normalizeFxProtocolError } from "./errorNormalization";
import { fetchGasTierQuotes, selectedGasTierQuote, type GasFeeSelection, type GasTierQuotes } from "./gasFeePolicy";
import { readGasTier } from "@/lib/settings";
import type {
  BridgeRouteQuote,
  FxPublicClient,
  PendingBridgeContext,
  PendingActionIntent,
  PlannedRoute,
  TransactionExecutionResult,
  TransactionPolicy,
  TransactionRunnerCallbacks,
  TransactionRunnerOptions,
  TransactionStepResult,
  WalletTransactionRequest,
} from "./types";
import { assertNonceMatches, validateRoute } from "./validation";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Every transaction costs at least this much gas. */
const MIN_TRANSACTION_GAS = 21_000n;

/**
 * A wallet must hold the value plus gas limit × maximum fee before the network
 * accepts a transaction. A failed balance read leaves the decision to the
 * wallet; only a confirmed shortfall stops the step.
 */
async function assertNativeFundsCover(client: FxPublicClient, request: WalletTransactionRequest): Promise<void> {
  if (typeof client.getBalance !== "function") return;
  const feePerGas = request.maxFeePerGas ?? request.gasPrice;
  const required = request.value + (feePerGas === undefined ? 0n : (request.gasLimit ?? MIN_TRANSACTION_GAS) * feePerGas);
  if (required <= 0n) return;
  let balance: unknown;
  try {
    balance = await client.getBalance({ address: request.from, blockTag: "pending" });
  } catch {
    return;
  }
  if (typeof balance === "bigint" && balance < required) {
    throw new Error("Not enough ETH for network fees. Add ETH to this wallet, then review again.");
  }
}

function normalizeHash(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("wallet returned an invalid transaction hash");
  return value as Hex;
}

function cloneReviewValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneReviewValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => [key, cloneReviewValue(nested)]),
  );
}

function clonePolicy(policy: TransactionPolicy): TransactionPolicy {
  return {
    ...policy,
    reviewedAction: policy.reviewedAction
      ? cloneReviewValue(policy.reviewedAction) as TransactionPolicy["reviewedAction"]
      : undefined,
    allowedDestinations: policy.allowedDestinations
      ? [...policy.allowedDestinations]
      : undefined,
    allowedApprovalSpenders: policy.allowedApprovalSpenders
      ? [...policy.allowedApprovalSpenders]
      : undefined,
    allowedSelectors: policy.allowedSelectors
      ? Object.fromEntries(
          Object.entries(policy.allowedSelectors)
            .map(([target, selectors]) => [target, [...selectors]]),
        )
      : undefined,
    allowedActionDestinations: policy.allowedActionDestinations
      ? [...policy.allowedActionDestinations]
      : undefined,
    allowedActionSelectors: policy.allowedActionSelectors
      ? Object.fromEntries(
          Object.entries(policy.allowedActionSelectors)
            .map(([target, selectors]) => [target, [...selectors]]),
        )
      : undefined,
    allowedApprovalDestinations: policy.allowedApprovalDestinations
      ? [...policy.allowedApprovalDestinations]
      : undefined,
    allowedTokenApprovalDestinations: policy.allowedTokenApprovalDestinations
      ? [...policy.allowedTokenApprovalDestinations]
      : undefined,
    allowedPositionApprovalDestinations: policy.allowedPositionApprovalDestinations
      ? [...policy.allowedPositionApprovalDestinations]
      : undefined,
  };
}

function pendingBridgeContext(route: PlannedRoute): PendingBridgeContext | undefined {
  if (route.operation !== "buildBridgeTx" || !route.quote || typeof route.quote !== "object") return undefined;
  const quote = route.quote as Partial<BridgeRouteQuote>;
  if (
    !quote.sourceOftAddress
    || !quote.destinationOftAddress
    || !quote.recipient
    || quote.amountLD === undefined
    || quote.minAmountLD === undefined
    || quote.destinationBaselineBlock === undefined
    || (quote.destinationChainId !== 1 && quote.destinationChainId !== 8453)
  ) return undefined;
  return {
    destinationChainId: quote.destinationChainId,
    sourceOftAddress: quote.sourceOftAddress,
    destinationOftAddress: quote.destinationOftAddress,
    recipient: quote.recipient,
    amountLD: quote.amountLD.toString(),
    minAmountLD: quote.minAmountLD.toString(),
    destinationBaselineBlock: quote.destinationBaselineBlock.toString(),
    bridgeToken: typeof quote.bridgeToken === "string" ? quote.bridgeToken.slice(0, 64) : undefined,
  };
}

export async function waitForReceipt(params: {
  client: Pick<PublicClient, "getTransactionReceipt">;
  hash: Hex;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<TransactionReceipt> {
  const timeoutMs = params.timeoutMs ?? 180_000;
  const pollMs = params.pollMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  // A tiny timeout can elapse between computing the deadline and entering the
  // loop when the event loop is busy. Always make the immediate receipt probe;
  // the timeout bounds retries, not whether the already-mined result is read.
  let firstAttempt = true;
  while (firstAttempt || Date.now() < deadline) {
    firstAttempt = false;
    try {
      return await params.client.getTransactionReceipt({ hash: params.hash });
    } catch {
      // viem throws TransactionReceiptNotFoundError until the tx is mined.
    }
    if (Date.now() >= deadline) break;
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`transaction receipt timeout: ${params.hash}`);
}

export async function waitForNextBlock(params: {
  client: Pick<PublicClient, "getBlockNumber">;
  afterBlock: bigint;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<bigint> {
  const timeoutMs = params.timeoutMs ?? 120_000;
  const pollMs = params.pollMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const block = await params.client.getBlockNumber();
    if (block > params.afterBlock) return block;
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`timed out waiting for a block after ${params.afterBlock}`);
}

export class TransactionReorgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionReorgError";
  }
}

/**
 * A receipt is only an inclusion proof. Re-read it at the canonical receipt
 * block and require one successful confirmation by default before a route can
 * continue. Callers may request a deeper confirmation depth when needed.
 * Re-reading the receipt also catches a provider changing the block identity
 * during a reorg instead of silently treating the old receipt as final.
 */
export async function waitForConfirmations(params: {
  client: Pick<PublicClient, "getBlockNumber" | "getTransactionReceipt">;
  hash: Hex;
  receipt: TransactionReceipt;
  confirmations?: number;
  timeoutMs?: number;
  pollMs?: number;
  onProgress?: (confirmations: number) => void;
}): Promise<TransactionReceipt> {
  const required = params.confirmations ?? 1;
  if (!Number.isSafeInteger(required) || required < 1 || required > 64) {
    throw new RangeError("confirmation depth must be an integer between 1 and 64");
  }
  const timeoutMs = params.timeoutMs ?? 180_000;
  const pollMs = params.pollMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  const originalBlock = params.receipt.blockNumber;
  const originalHash = params.receipt.blockHash?.toLowerCase();
  let firstAttempt = true;
  while (firstAttempt || Date.now() < deadline) {
    firstAttempt = false;
    let latest: TransactionReceipt;
    try {
      latest = await params.client.getTransactionReceipt({ hash: params.hash });
    } catch {
      throw new TransactionReorgError("transaction receipt disappeared while waiting for confirmations");
    }
    if (
      latest.transactionHash.toLowerCase() !== params.hash.toLowerCase()
      || latest.blockNumber !== originalBlock
      || !latest.blockHash
      || !originalHash
      || latest.blockHash.toLowerCase() !== originalHash
    ) {
      throw new TransactionReorgError("transaction receipt changed block identity while waiting for confirmations");
    }
    if (latest.status !== "success") {
      throw new TransactionReorgError("transaction receipt status changed while waiting for confirmations");
    }
    const head = await params.client.getBlockNumber({ cacheTime: 0 });
    if (typeof head !== "bigint") throw new Error("RPC returned an invalid block number during confirmation");
    const observed = head >= originalBlock ? Number(head - originalBlock + 1n) : 0;
    params.onProgress?.(observed);
    if (observed >= required) return latest;
    if (Date.now() >= deadline) break;
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`timed out waiting for ${required} confirmations: ${params.hash}`);
}

/**
 * A receipt proves inclusion and status, but does not bind the transaction's
 * calldata, value, or nonce. Read the mined transaction back before marking a
 * step confirmed so a wallet/provider adapter that mutates the request cannot
 * silently turn a reviewed route into a different call.
 */
async function verifySubmittedTransaction(params: {
  client: Pick<PublicClient, "getTransaction">;
  hash: Hex;
  expected: {
    from: string;
    to: string;
    data: string;
    value: bigint;
    nonce: number;
  };
}): Promise<void> {
  const submitted = await params.client.getTransaction({ hash: params.hash });
  if (typeof submitted.hash !== "string" || submitted.hash.toLowerCase() !== params.hash.toLowerCase()) {
    throw new Error("mined transaction hash does not match the submitted transaction");
  }
  const input = (submitted as { input?: string; data?: string }).input
    ?? (submitted as { input?: string; data?: string }).data;
  if (!input || input.toLowerCase() !== params.expected.data.toLowerCase()) {
    throw new Error("mined transaction calldata does not match the reviewed transaction");
  }
  if (
    submitted.from.toLowerCase() !== params.expected.from.toLowerCase()
    || !submitted.to
    || submitted.to.toLowerCase() !== params.expected.to.toLowerCase()
  ) {
    throw new Error("mined transaction sender or destination does not match the reviewed transaction");
  }
  if (submitted.value !== params.expected.value) {
    throw new Error("mined transaction native value does not match the reviewed transaction");
  }
  if (submitted.nonce !== params.expected.nonce) {
    throw new Error("mined transaction nonce does not match the reviewed transaction");
  }
}

function isApprovalTransaction(transaction: PlannedRoute["transactions"][number]): boolean {
  return transaction.kind === "approval" || transaction.type === "approveToken" || transaction.type === "approvePosition";
}

/** Fail-closed ordered eth_simulateV1 gate. */
export async function simulatePlannedRoute(
  route: PlannedRoute,
  client: FxPublicClient,
): Promise<{ success: true } | { success: false; error: string; failedTxIndex?: number }> {
  try {
    const result = await client.simulateCalls({
      account: route.walletAddress,
      calls: route.transactions.map((transaction) => ({
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
      })),
    });
    // A truncated/empty response is not proof that the ordered route is
    // executable. Some RPCs return a partial result when a later call cannot
    // be simulated; fail closed instead of signing an unreviewed step.
    if (!Array.isArray(result.results) || result.results.length !== route.transactions.length) {
      return {
        success: false,
        error: `simulation returned ${Array.isArray(result.results) ? result.results.length : 0} results for ${route.transactions.length} transactions`,
      };
    }
    for (let index = 0; index < result.results.length; index += 1) {
      const item = result.results[index];
      if (item.status !== "success") {
        const error = normalizeFxProtocolError(
          (item as { error?: unknown }).error,
          "The protocol rejected this route. Review the position inputs.",
          route.operation,
        );
        return { success: false, error, failedTxIndex: index };
      }
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: normalizeFxProtocolError(
        error,
        "Simulation is unavailable. Check your connection and try again.",
        route.operation,
      ),
    };
  }
}

function makeFailureResult(
  route: PlannedRoute,
  steps: TransactionStepResult[],
  error: string,
): TransactionExecutionResult {
  const hasConfirmedStep = steps.some((step) => step.status === "confirmed");
  return {
    status: hasConfirmedStep ? "partial" : "failed",
    operation: route.operation,
    chainId: route.chainId,
    walletAddress: route.walletAddress,
    steps,
    error,
  };
}

/**
 * Execute one SDK-provided route through an injected Privy wallet callback.
 * No private key, delegated signer, raw broadcast, or server authority is
 * used here. Each step is explicitly approved and receipt-confirmed before
 * the following SDK step can be submitted.
 */
export async function runTransactionRoute(params: {
  route: PlannedRoute;
  callbacks: TransactionRunnerCallbacks;
  policy?: TransactionPolicy;
  publicClient?: FxPublicClient;
  feeSelection?: GasFeeSelection;
  /** Injectable read dependency; production uses the shared gas oracle. */
  refreshFeeQuotes?: (chainId: PlannedRoute['chainId']) => Promise<GasTierQuotes>;
  options?: TransactionRunnerOptions;
}): Promise<TransactionExecutionResult> {
  // Snapshot the reviewed route before acquiring the cross-tab lock. A
  // mutable page object must not be able to change calldata or recipients
  // while another route is finishing its receipt wait.
  const route: PlannedRoute = {
    ...params.route,
    transactions: params.route.transactions.map((transaction) => ({ ...transaction })),
    details: params.route.details
      ? cloneReviewValue(params.route.details) as PlannedRoute["details"]
      : undefined,
    quote: cloneReviewValue(params.route.quote),
    policy: params.route.policy ? clonePolicy(params.route.policy) : undefined,
  };
  const feeSelection: GasFeeSelection | undefined = params.feeSelection
    ? {
        tier: params.feeSelection.tier,
        snapshot: {
          ...params.feeSelection.snapshot,
          tiers: {
            standard: { ...params.feeSelection.snapshot.tiers.standard },
            fast: { ...params.feeSelection.snapshot.tiers.fast },
            rapid: { ...params.feeSelection.snapshot.tiers.rapid },
          },
        },
      }
    : undefined;
  const policy = clonePolicy(params.policy ?? defaultTransactionPolicy(route));
  // A refreshed quote may carry an ongoing approval flow, but a new execution
  // must start from a fee selection that was still current when accepted.
  if (feeSelection) selectedGasTierQuote(feeSelection.snapshot, feeSelection.tier);
  const options = params.options ?? {};
  if (
    options.confirmations !== undefined
    && (!Number.isSafeInteger(options.confirmations) || options.confirmations < 1 || options.confirmations > 64)
  ) {
    throw new RangeError("confirmation depth must be an integer between 1 and 64");
  }
  validateRoute(route, policy);
  const client = params.publicClient ?? getPublicClient(route.chainId);
  if (client.chain?.id !== undefined && client.chain.id !== route.chainId) {
    throw new Error("public client chain does not match the transaction route");
  }
  // Observer callbacks update UI only. They must never prevent journaling,
  // receipt waiting, failure-stop behavior, or a later authoritative reread.
  const notifyStatus = (status: Parameters<NonNullable<TransactionRunnerCallbacks["onStatus"]>>[0], detail?: string): void => {
    try { params.callbacks.onStatus?.(status, detail); } catch { /* UI observers are non-authoritative */ }
  };
  const notifyStep = (step: TransactionStepResult): void => {
    try { params.callbacks.onStep?.({ ...step }); } catch { /* UI observers are non-authoritative */ }
  };

  return withWalletChainLock({
    walletAddress: route.walletAddress,
    chainId: route.chainId,
    // Browser signing fails closed without Web Locks. A localStorage lease
    // cannot stay authoritative when a Telegram WebView suspends JavaScript
    // during an external wallet prompt.
    requireWebLocks: typeof window !== "undefined",
    run: async (assertLockOwned) => {
      // Revalidate after waiting for another in-flight route. This is cheap
      // and protects callers that hand us mutable route/policy objects.
      validateRoute(route, policy);
      await assertPublicClientChain(client, route.chainId);
      notifyStatus("planning");
      if (options.simulate !== false) {
        notifyStatus("reviewing", "Checking the ordered route on-chain");
        const simulation = params.callbacks.simulate
          ? await params.callbacks.simulate(route, client)
          : await simulatePlannedRoute(route, client);
        if (simulation !== true && !simulation.success) {
          const detail = "error" in simulation ? simulation.error : "simulation failed";
          notifyStatus("failed", detail);
          return makeFailureResult(route, [], detail);
        }
      }

      const steps: TransactionStepResult[] = [];

      /**
       * Refresh protocol state after at least one submitted transaction has a
       * canonical receipt. A following block is an explicit opt-in for callers
       * that need extra indexer settling time. This applies to partially
       * completed routes too: an approval may have succeeded before the user
       * rejects, or the protocol action reverts.
       */
      const runPostConfirmRead = async (
        result: TransactionExecutionResult,
      ): Promise<void> => {
        const refreshStatus = result.status === "confirmed"
          ? "confirmed"
          : result.status === "partial"
            ? "partial"
            : "failed";
        const latestReceipt = [...steps]
          .reverse()
          .find((candidate) => candidate.receipt)?.receipt;
        if (!latestReceipt) return;

        let postConfirmReadSafe = options.waitForNextBlock !== true;
        if (options.waitForNextBlock === true) {
          try {
            await waitForNextBlock({
              client,
              afterBlock: latestReceipt.blockNumber,
              timeoutMs: options.receiptTimeoutMs,
              pollMs: options.pollMs,
            });
            postConfirmReadSafe = true;
          } catch (error) {
            // A mined transaction cannot be undone. Keep that truth visible,
            // but do not present an optional delayed state read as fresh when
            // its requested block boundary was unavailable.
            notifyStatus(
              refreshStatus,
              `receipt confirmed; post-confirm block wait unavailable: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        if (!postConfirmReadSafe) {
          notifyStatus(
            refreshStatus,
            "transaction receipt confirmed; retry the state read after a new block is observed",
          );
          return;
        }

        try {
          await params.callbacks.postConfirmRead?.(route, result);
        } catch (error) {
          notifyStatus(
            refreshStatus,
            `transaction receipt confirmed; post-confirm state read failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      };

      for (let index = 0; index < route.transactions.length; index += 1) {
        const transaction = route.transactions[index];
        const step: TransactionStepResult = {
          index,
          transaction,
          status: "submitted",
        };
        steps.push(step);
        const label = `transaction ${index + 1} of ${route.transactions.length}`;
        try {
          // The previous wallet may have returned a broadcast hash while
          // leaving its success screen open. Let the caller wait here, before
          // re-simulating and refreshing nonce/fees for the next step.
          await params.callbacks.beforeTransaction?.(index, transaction);
          // Once an approval receipt is canonical, recheck the remaining
          // protocol calls against the current allowance before the next
          // signature, catching state changes since the ordered preflight.
          if (options.simulate !== false && index > 0 && route.transactions.some(isApprovalTransaction)) {
            notifyStatus("reviewing", `Checking ${label} against the confirmed approval`);
            const remainingRoute: PlannedRoute = {
              ...route,
              transactions: route.transactions.slice(index),
            };
            const simulation = params.callbacks.simulate
              ? await params.callbacks.simulate(remainingRoute, client)
              : await simulatePlannedRoute(remainingRoute, client);
            if (simulation !== true && !simulation.success) {
              const detail = "error" in simulation ? simulation.error : "simulation failed";
              throw new Error(detail);
            }
          }
          // Storage leases can expire while a Telegram WebView is suspended
          // inside another tab's wallet prompt. Revalidate immediately before
          // each reviewed step and again after nonce reconciliation, directly
          // before the Privy signing boundary.
          assertLockOwned();
          await params.callbacks.ensureChain?.(route.chainId);
          // Re-probe the read endpoint immediately before nonce authority is
          // accepted. Static viem chain metadata is not an eth_chainId proof.
          notifyStatus("awaiting-user", label);
          // These reads are independent and both must pass before signing.
          // Starting them together removes a full RPC round trip without
          // relaxing either the live endpoint-chain proof or nonce authority.
          const [, pendingNonceValue] = await Promise.all([
            assertPublicClientChain(client, route.chainId),
            client.getTransactionCount({
              address: route.walletAddress,
              blockTag: "pending",
            }),
          ]);
          const pendingNonce = Number(pendingNonceValue);
          const nonce = assertNonceMatches(transaction, pendingNonce);
          assertLockOwned();
          let feeFields: Pick<WalletTransactionRequest, 'maxFeePerGas' | 'maxPriorityFeePerGas'> = {};
          if (feeSelection) {
            if (readGasTier() !== feeSelection.tier) {
              throw new Error("Network fee preference changed; review the action again before signing.");
            }
            if (feeSelection.snapshot.chainId !== route.chainId) {
              throw new Error("Network fee quote does not match the transaction network; review the action again.");
            }
            // An approval can take longer than the display quote's TTL. Refresh
            // the chosen tier without increasing either reviewed fee ceiling.
            const reviewed = selectedGasTierQuote(feeSelection.snapshot, feeSelection.tier, feeSelection.snapshot.fetchedAt);
            let fee = reviewed;
            if (feeSelection.snapshot.validUntil <= Date.now()) {
              // Re-price from the reviewed source: the oracle and the RPC compute tips
              // differently, and a source flip alone must not read as a fee increase.
              const fresh = await (params.refreshFeeQuotes ?? ((chainId) => fetchGasTierQuotes(chainId, { forceRefresh: true, preferSource: feeSelection.snapshot.source })))(route.chainId);
              if (fresh.chainId !== route.chainId) throw new Error("Refreshed network fee belongs to a different chain.");
              fee = selectedGasTierQuote(fresh, feeSelection.tier);
              if (fee.gasPriceWei > reviewed.maxFeePerGas || fee.maxPriorityFeePerGas > reviewed.maxPriorityFeePerGas) {
                throw new Error("Network fees increased above your reviewed limit. Your approval is saved; review the action again.");
              }
            }
            feeFields = {
              maxFeePerGas: fee.maxFeePerGas < reviewed.maxFeePerGas ? fee.maxFeePerGas : reviewed.maxFeePerGas,
              maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
            };
          }
          // Nested protocol/bridge calls need headroom over eth_estimateGas.
          // Unused gas is not charged. Estimate only after prior approvals mine.
          const estimatedGas = client.estimateGas ? await client.estimateGas({
            account: route.walletAddress, to: transaction.to, data: transaction.data, value: transaction.value,
          }) : undefined;
          if (estimatedGas !== undefined && (estimatedGas <= 0n || estimatedGas > 50_000_000n)) {
            throw new Error("The network returned an invalid gas estimate.");
          }
          assertLockOwned();
          const request: WalletTransactionRequest = {
            chainId: route.chainId,
            from: route.walletAddress,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
            nonce,
            ...(estimatedGas !== undefined ? { gasLimit: gasLimitWithHeadroom(estimatedGas) } : {}),
            ...feeFields,
          };
          // The embedded wallet sends an unfundable request into a funding
          // screen that never settles, so stop before any wallet prompt opens.
          await assertNativeFundsCover(client, request);
          assertLockOwned();
          const hash = normalizeHash(await params.callbacks.requestSignature(request, transaction));
          step.hash = hash;
          const pendingRecord = recordPendingHash({
            operation: route.operation,
            stepKind: transaction.kind,
            intent: pendingActionIntent(route),
            walletAddress: route.walletAddress,
            chainId: route.chainId,
            hash,
            to: transaction.to,
            nonce,
            data: transaction.data,
            value: transaction.value,
            bridge: transaction.kind === "action" ? pendingBridgeContext(route) : undefined,
          });
          notifyStep(step);
          notifyStatus("submitted", `${label}: ${hash}`);

          const receipt = await waitForReceipt({
            client,
            hash,
            timeoutMs: options.receiptTimeoutMs,
            pollMs: options.pollMs,
          });
          if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
            throw new Error(`${label} receipt hash does not match the submitted transaction`);
          }
          if (typeof receipt.blockNumber !== "bigint" || receipt.blockNumber < 0n) {
            throw new Error(`${label} receipt is missing a canonical block number`);
          }
          if (!/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash)) {
            throw new Error(`${label} receipt is missing a canonical block hash`);
          }
          if (receipt.status !== "success" && receipt.status !== "reverted") {
            throw new Error(`${label} receipt does not contain a terminal on-chain status`);
          }
          // Once the submitted hash has a receipt, the chain may already have
          // mutated even if a later sender/destination/calldata verification
          // fails. Preserve that receipt on the failed step so the shared
          // failure path rereads official state at the canonical receipt
          // boundary (or after an explicitly requested extra block).
          step.receipt = receipt;
          if (
            receipt.from.toLowerCase() !== transaction.from.toLowerCase()
            || !receipt.to
            || receipt.to.toLowerCase() !== transaction.to.toLowerCase()
          ) {
            throw new Error(`${label} receipt sender or destination does not match the reviewed transaction`);
          }
          await verifySubmittedTransaction({
            client,
            hash,
            expected: {
              from: transaction.from,
              to: transaction.to,
              data: transaction.data,
              value: transaction.value,
              nonce,
            },
          });
          if (receipt.status !== "success") {
            updatePendingHashRecord(pendingRecord, "failed");
            step.status = "failed";
            step.error = `${label} reverted on-chain: ${hash}`;
            notifyStep(step);
            notifyStatus("failed", step.error);
            const failure = makeFailureResult(route, steps, step.error);
            await runPostConfirmRead(failure);
            return failure;
          }
          step.status = "included";
          step.includedBlockNumber = receipt.blockNumber;
          step.includedBlockHash = receipt.blockHash;
          step.confirmations = 1;
          step.requiredConfirmations = options.confirmations ?? 1;
          notifyStep(step);
          notifyStatus("included", `${label}: ${hash}`);
          const confirmedReceipt = await waitForConfirmations({
            client,
            hash,
            receipt,
            confirmations: options.confirmations,
            timeoutMs: options.receiptTimeoutMs,
            pollMs: options.pollMs,
            onProgress: (confirmations) => {
              step.status = "confirming";
              step.confirmations = confirmations;
              notifyStep(step);
              notifyStatus(
                "confirming",
                `${label}: ${confirmations}/${options.confirmations ?? 1} confirmations`,
              );
            },
          });
          step.receipt = confirmedReceipt;
          updatePendingHashRecord(pendingRecord, "confirmed");
          step.status = "confirmed";
          step.confirmations = Math.max(step.confirmations ?? 1, options.confirmations ?? 1);
          notifyStep(step);
          notifyStatus("confirmed", `${label}: ${hash}`);
        } catch (error) {
          // A reorg removes inclusion, but does not prove that the signed
          // hash reverted. Keep it recoverable in the journal and explicitly
          // downgrade the UI to submitted so History can reconcile it later.
          const wasFinalityPending = step.status === "included" || step.status === "confirming";
          if (error instanceof TransactionReorgError) step.status = "submitted";
          else if (!wasFinalityPending) step.status = "failed";
          step.error = error instanceof Error ? error.message : String(error);
          notifyStep(step);
          notifyStatus(error instanceof TransactionReorgError ? "submitted" : wasFinalityPending ? "confirming" : "failed", step.error);
          const failure = makeFailureResult(route, steps, step.error);
          // A finality timeout/reorg is not a safe state-read boundary. The
          // recovery journal keeps the hash pending for a later reconciliation.
          if (!wasFinalityPending) await runPostConfirmRead(failure);
          return failure;
        }
      }

      const result: TransactionExecutionResult = {
        status: "confirmed",
        operation: route.operation,
        chainId: route.chainId,
        walletAddress: route.walletAddress,
        steps,
      };
      await runPostConfirmRead(result);
      notifyStatus("confirmed", "All route steps confirmed");
      return result;
    },
  });
}
function pendingActionIntent(route: PlannedRoute): PendingActionIntent | undefined {
  const intent = route.policy?.reviewedAction;
  if (!intent) return route.operation === 'buildBridgeTx' ? 'Bridge' : undefined;
  switch (intent.kind) {
    case 'position-increase': return intent.positionId === 0 ? 'Open position' : 'Increase position';
    case 'position-reduce': return intent.isClosePosition ? 'Close position' : 'Reduce position';
    case 'position-adjust': return 'Adjust leverage';
    case 'deposit-and-mint': return intent.positionId === 0 ? 'Borrow' : 'Add collateral';
    case 'repay-and-withdraw': return intent.minimumRepayAmount > 0n && intent.withdrawAmount > 0n ? 'Repay and withdraw' : intent.minimumRepayAmount > 0n ? 'Repay' : 'Withdraw collateral';
    case 'fxsave-deposit': return 'Deposit';
    case 'fxsave-withdraw': return intent.directBasePool || intent.instant ? 'Withdraw' : 'Queue withdrawal';
    case 'fxsave-claim': return 'Claim';
    default: return undefined;
  }
}
