import type { PendingBridgeContext, PendingBridgeDeliveryProof } from "./types";

const UINT256_MAX = (1n << 256n) - 1n;
const hash = (value: unknown): value is `0x${string}` =>
  typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) && !/^0x0{64}$/i.test(value);
const unsigned = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) <= UINT256_MAX;

/**
 * Validate and copy a cached observation. This establishes data shape and route
 * consistency, NOT on-chain truth. Even a well-formed local cache is untrusted.
 */
export function parsePendingBridgeDeliveryProof(
  value: unknown,
  context: { hash: string; bridge: PendingBridgeContext; submittedAt: number },
  now = Date.now(),
): PendingBridgeDeliveryProof | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const proof = value as Partial<PendingBridgeDeliveryProof>;
  if (!hash(proof.guid) || !hash(proof.sourceTxHash) || !hash(proof.destinationTxHash)
    || !hash(proof.destinationBlockHash)
    || proof.sourceTxHash.toLowerCase() !== context.hash.toLowerCase()
    || !unsigned(proof.sourceAmountSentLD) || !unsigned(proof.sourceAmountReceivedLD)
    || !unsigned(proof.destinationAmountReceivedLD) || !unsigned(proof.destinationBlockNumber)
    || !unsigned(context.bridge.amountLD) || !unsigned(context.bridge.minAmountLD)
    || !unsigned(context.bridge.destinationBaselineBlock)
    || !Number.isSafeInteger(proof.verifiedAt) || proof.verifiedAt! < context.submittedAt
    || proof.verifiedAt! > now + 30_000) return undefined;
  if (BigInt(proof.sourceAmountSentLD) <= 0n
    || BigInt(proof.sourceAmountSentLD) > BigInt(context.bridge.amountLD)
    || BigInt(proof.sourceAmountReceivedLD) < BigInt(context.bridge.minAmountLD)
    || BigInt(proof.destinationAmountReceivedLD) <= 0n
    || proof.destinationAmountReceivedLD !== proof.sourceAmountReceivedLD
    || BigInt(proof.destinationBlockNumber) < BigInt(context.bridge.destinationBaselineBlock)) return undefined;
  return {
    guid: proof.guid,
    sourceTxHash: proof.sourceTxHash,
    sourceAmountSentLD: proof.sourceAmountSentLD,
    sourceAmountReceivedLD: proof.sourceAmountReceivedLD,
    destinationTxHash: proof.destinationTxHash,
    destinationAmountReceivedLD: proof.destinationAmountReceivedLD,
    destinationBlockNumber: proof.destinationBlockNumber,
    destinationBlockHash: proof.destinationBlockHash,
    verifiedAt: proof.verifiedAt!,
  };
}

/** Compare every immutable recovery fact; proof metadata is deliberately excluded. */
export function samePendingBridgeContext(left: PendingBridgeContext, right: PendingBridgeContext): boolean {
  return left.destinationChainId === right.destinationChainId
    && left.sourceOftAddress.toLowerCase() === right.sourceOftAddress.toLowerCase()
    && left.destinationOftAddress.toLowerCase() === right.destinationOftAddress.toLowerCase()
    && left.recipient.toLowerCase() === right.recipient.toLowerCase()
    && left.amountLD === right.amountLD
    && left.minAmountLD === right.minAmountLD
    && left.destinationBaselineBlock === right.destinationBaselineBlock
    && left.bridgeToken === right.bridgeToken;
}
