import { AppError } from '../domain/errors';
import type { ReviewedCall } from '../domain/ports';
import type { RpcPort } from './rpc';
import { ceil, hex, invariant, object, quantity } from './values';

export interface CostProof {
  readonly gasLimit: bigint;
  readonly feePerGasWei: bigint;
  readonly estimatedNetworkFeeWei: bigint;
  readonly requiredBalanceWei: bigint;
}

export function rpcCall(call: ReviewedCall): Record<string, string> {
  return { from: call.from, to: call.to, data: call.data, value: hex(call.value), nonce: hex(BigInt(call.nonce)) };
}

/** A live EIP-1559 estimate, not an instruction to override an external wallet. */
export function feeCap(value: unknown): bigint {
  const history = object(value);
  invariant(Array.isArray(history.baseFeePerGas) && history.baseFeePerGas.length === 6);
  invariant(Array.isArray(history.reward) && history.reward.length === 5);
  invariant(Array.isArray(history.gasUsedRatio) && history.gasUsedRatio.length === 5
    && history.gasUsedRatio.every((ratio) => typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1));
  quantity(history.oldestBlock);
  const bases = history.baseFeePerGas.map(quantity);
  invariant(bases.every((base) => base > 0n && base <= 10n ** 13n));
  const tips = history.reward.map((row) => {
    invariant(Array.isArray(row) && row.length === 1);
    const tip = quantity(row[0]);
    invariant(tip <= 10n ** 12n);
    return tip;
  }).sort((a, b) => a === b ? 0 : a < b ? -1 : 1);
  return bases[5]! * 2n + tips[2]!;
}

/** Every input is read again for the same immutable call; this never invokes a planner. */
export async function executionProof(rpc: RpcPort, call: ReviewedCall, signal: AbortSignal): Promise<CostProof> {
  const transaction = rpcCall(call);
  const [simulation, nonceRaw, gasRaw, feesRaw, balanceRaw] = await Promise.all([
    rpc.request('eth_call', [transaction, 'pending'], signal),
    rpc.request('eth_getTransactionCount', [call.from, 'pending'], signal),
    rpc.request('eth_estimateGas', [transaction, 'pending'], signal),
    rpc.request('eth_feeHistory', ['0x5', 'latest', [50]], signal),
    rpc.request('eth_getBalance', [call.from, 'pending'], signal),
  ]);
  if (simulation !== '0x') throw new AppError('simulation', 'The exact trade did not produce a verified successful simulation.');
  if (quantity(nonceRaw) !== BigInt(call.nonce)) throw new AppError('nonce-changed', 'Your wallet transaction count changed. Refresh the review.');
  const gas = quantity(gasRaw);
  invariant(gas >= 21_000n && gas <= 5_000_000n, 'The estimated gas requirement could not be verified.');
  const gasLimit = ceil(gas * 120n, 100n);
  const feePerGasWei = feeCap(feesRaw);
  const estimatedNetworkFeeWei = gasLimit * feePerGasWei;
  const requiredBalanceWei = call.value + estimatedNetworkFeeWei;
  const balance = quantity(balanceRaw);
  if (balance < requiredBalanceWei) throw new AppError('insufficient-funds', 'Your wallet needs more ETH for this amount and the verified network fee estimate.');
  return Object.freeze({ gasLimit, feePerGasWei, estimatedNetworkFeeWei, requiredBalanceWei });
}
