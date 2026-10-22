import { decodeEventLog, toEventSelector } from 'viem';
import type { Hash, ReviewedCall, VerifiedReceipt } from '../domain/ports';
import { ADDRESSES, POOL_ABI } from './contracts';
import { address, bytes, hash, invariant, object, quantity } from './values';

const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)');

export interface ReceiptProof {
  readonly value: VerifiedReceipt;
  readonly logs: readonly unknown[];
}

/** Null/pending is handled by the caller. This function accepts terminal identity only. */
export function verifyReceipt(hashValue: Hash, call: ReviewedCall, receiptRaw: unknown, transactionRaw: unknown, blockRaw: unknown): ReceiptProof {
  const wanted = hash(hashValue);
  const receipt = object(receiptRaw);
  const transaction = object(transactionRaw);
  const block = object(blockRaw);
  invariant(hash(receipt.transactionHash) === wanted && hash(transaction.hash) === wanted);
  invariant(address(receipt.from) === address(call.from) && address(transaction.from) === address(call.from));
  invariant(address(receipt.to) === address(call.to) && address(transaction.to) === address(call.to));
  invariant(bytes(transaction.input) === bytes(call.data) && quantity(transaction.value) === call.value
    && quantity(transaction.nonce) === BigInt(call.nonce));
  if (transaction.chainId !== undefined) invariant(quantity(transaction.chainId) === 1n);
  const blockHash = hash(receipt.blockHash);
  const blockNumber = quantity(receipt.blockNumber);
  invariant(blockNumber > 0n && hash(transaction.blockHash) === blockHash && quantity(transaction.blockNumber) === blockNumber);
  invariant(hash(block.hash) === blockHash && quantity(block.number) === blockNumber);
  const status = quantity(receipt.status);
  invariant(status === 0n || status === 1n);
  const gasUsed = quantity(receipt.gasUsed);
  const price = quantity(receipt.effectiveGasPrice);
  invariant(gasUsed > 0n && gasUsed <= 30_000_000n && price > 0n && price <= 10n ** 13n);
  invariant(Array.isArray(receipt.logs));
  return Object.freeze({ value: Object.freeze({ hash: wanted, blockHash, blockNumber,
    status: status === 1n ? 'success' : 'reverted', networkFeeWei: gasUsed * price }), logs: receipt.logs });
}

/** A direct mint, or one exact router mint followed by delivery, is sufficient. */
export function mintedPosition(proof: ReceiptProof, call: ReviewedCall): bigint | undefined {
  if (proof.value.status !== 'success') return undefined;
  try {
    const transfers: { from: string; to: string; id: bigint; index: bigint }[] = [];
    for (const raw of proof.logs) {
      const log = object(raw);
      if (address(log.address) !== ADDRESSES.pool) continue;
      invariant(log.removed !== true && hash(log.transactionHash) === proof.value.hash
        && hash(log.blockHash) === proof.value.blockHash && quantity(log.blockNumber) === proof.value.blockNumber);
      invariant(Array.isArray(log.topics));
      if (log.topics[0] !== TRANSFER_TOPIC) continue;
      // A malformed competing mint must invalidate position evidence, rather
      // than disappear while a separate valid-looking mint is accepted.
      const event = decodeEventLog({ abi: POOL_ABI, data: bytes(log.data), topics: log.topics.map((topic) => hash(topic)) as [Hash, ...Hash[]], strict: true });
      if (event.eventName !== 'Transfer') continue;
      invariant(log.topics.length === 4 && log.data === '0x' && event.args.tokenId > 0n);
      transfers.push({ from: address(event.args.from), to: address(event.args.to), id: event.args.tokenId, index: quantity(log.logIndex) });
    }
    const owner = address(call.from);
    transfers.sort((a, b) => a.index === b.index ? 0 : a.index < b.index ? -1 : 1);
    if (transfers.length === 1) {
      const mint = transfers[0]!;
      return mint.from === ADDRESSES.native && mint.to === owner ? mint.id : undefined;
    }
    if (transfers.length === 2) {
      const [mint, delivery] = transfers as [typeof transfers[number], typeof transfers[number]];
      return mint.from === ADDRESSES.native && mint.to === ADDRESSES.router && delivery.from === ADDRESSES.router
        && delivery.to === owner && delivery.id === mint.id && delivery.index > mint.index ? mint.id : undefined;
    }
    return undefined;
  } catch { return undefined; }
}
