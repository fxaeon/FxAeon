import type { ProvenFork } from './guard';
import { hash, invariant, quantity, record } from './guard';

export interface NativeLongProof {
  readonly schemaVersion: 1;
  readonly kind: 'fxaeon-native-long-fork';
  readonly runId: string;
  readonly sourceManifestHash: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly fork: { readonly blockNumber: string; readonly blockHash: string; readonly instanceId: string; readonly clientVersion: string };
  readonly review: { readonly from: string; readonly to: string; readonly data: string; readonly valueWei: string; readonly nonce: number; readonly minimumWstEthWei: string };
  readonly execution: {
    readonly hash: string; readonly blockHash: string; readonly blockNumber: string; readonly status: 'success';
    readonly minedData: string; readonly minedValueWei: string; readonly minedNonce: number;
    readonly positionId: string; readonly currentOwner: string; readonly collateralStEthWei: string; readonly debtFxUsdWei: string;
    readonly networkFeeWei: string; readonly balanceBeforeWei: string; readonly balanceAfterWei: string;
  };
  readonly recovery: { readonly hash: string; readonly positionId: string; readonly dispatchesBefore: number; readonly dispatchesAfter: number; readonly canonicalReadsRepeated: true };
}

/** A zero subprocess exit or an old proof file cannot satisfy the fork gate. */
export function validateProof(input: unknown, expected: ProvenFork & { runId: string; sourceManifestHash: string }): NativeLongProof {
  const proof = record(input);
  invariant(proof.schemaVersion === 1 && proof.kind === 'fxaeon-native-long-fork' && proof.runId === expected.runId, 'The fork proof does not belong to this run.');
  invariant(typeof proof.startedAt === 'string' && typeof proof.completedAt === 'string'
    && Number.isFinite(Date.parse(proof.startedAt)) && Date.parse(proof.completedAt) >= Date.parse(proof.startedAt), 'The fork proof has invalid execution timestamps.');
  invariant(typeof proof.sourceManifestHash === 'string' && /^[0-9a-f]{64}$/.test(proof.sourceManifestHash)
    && proof.sourceManifestHash === expected.sourceManifestHash, 'The fork proof does not match its executable source manifest.');
  const fork = record(proof.fork);
  invariant(quantity(fork.blockNumber) === expected.blockNumber && hash(fork.blockHash) === expected.blockHash
    && hash(fork.instanceId) === expected.instanceId && fork.clientVersion === expected.clientVersion, 'The fork proof refers to a different fork or local instance.');
  const review = record(proof.review);
  const execution = record(proof.execution);
  const recovery = record(proof.recovery);
  invariant(typeof review.from === 'string' && /^0x[0-9a-f]{40}$/.test(review.from)
    && typeof review.to === 'string' && /^0x[0-9a-f]{40}$/.test(review.to), 'The reviewed account or target is invalid.');
  invariant(typeof review.data === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(review.data) && review.data.length <= 65_538, 'The reviewed calldata is missing.');
  invariant(Number.isSafeInteger(review.nonce) && Number(review.nonce) >= 0, 'The reviewed nonce is invalid.');
  invariant(quantity(review.valueWei) === 100_000_000_000_000_001n && quantity(review.minimumWstEthWei) > 0n, 'The exact final wei or enforced converter minimum was lost.');
  invariant(execution.status === 'success' && hash(execution.hash) && hash(execution.blockHash)
    && quantity(execution.blockNumber) > expected.blockNumber, 'A mined successful fork receipt is required.');
  invariant(execution.minedData === review.data && quantity(execution.minedValueWei) === quantity(review.valueWei)
    && execution.minedNonce === review.nonce, 'The mined transaction differs from the reviewed bytes.');
  invariant(quantity(execution.positionId) > 0n && execution.currentOwner === review.from
    && quantity(execution.collateralStEthWei) > 0n && quantity(execution.debtFxUsdWei) > 0n, 'Canonical position ownership and accounting were not proved.');
  invariant(quantity(execution.networkFeeWei) > 0n && quantity(execution.balanceBeforeWei) - quantity(execution.balanceAfterWei)
    === quantity(review.valueWei) + quantity(execution.networkFeeWei), 'The disposable wallet spend does not reconcile with the actual receipt fee.');
  invariant(recovery.hash === execution.hash && recovery.positionId === execution.positionId && recovery.dispatchesBefore === 1
    && recovery.dispatchesAfter === 1 && recovery.canonicalReadsRepeated === true, 'Recovery must re-observe the same position without another send.');
  // Allow only this fixed proof shape. Provider configuration, signed payloads,
  // private keys and arbitrary diagnostic objects have no place in the artifact.
  const fields: readonly [Record<string, unknown>, string][] = [
    [proof, 'schemaVersion,kind,runId,sourceManifestHash,startedAt,completedAt,fork,review,execution,recovery'],
    [fork, 'blockNumber,blockHash,instanceId,clientVersion'],
    [review, 'from,to,data,valueWei,nonce,minimumWstEthWei'],
    [execution, 'hash,blockHash,blockNumber,status,minedData,minedValueWei,minedNonce,positionId,currentOwner,collateralStEthWei,debtFxUsdWei,networkFeeWei,balanceBeforeWei,balanceAfterWei'],
    [recovery, 'hash,positionId,dispatchesBefore,dispatchesAfter,canonicalReadsRepeated'],
  ];
  for (const [value, allowed] of fields) invariant(Object.keys(value).sort().join(',') === allowed.split(',').sort().join(','), 'The proof contains missing or unapproved fields.');
  return input as NativeLongProof;
}
