import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address, Hash, ReviewedCall } from '../../src/domain/ports';
import { GuardedFork, invariant, quantity, record } from './guard';

export interface SubmittedLocalCall {
  readonly call: ReviewedCall;
  readonly hash: Hash;
}

/** A disposable test signer behind the actual production browser-wallet port.
 * There is no private key input, persistence, public transport, or signer fallback.
 */
export async function disposableProvider(fork: GuardedFork, reviewed: () => ReviewedCall | undefined) {
  await fork.prove();
  const account = privateKeyToAccount(generatePrivateKey());
  const address = account.address.toLowerCase() as Address;
  await fork.fundDisposable(address);
  const consumed = new Set<number>();
  const submitted: SubmittedLocalCall[] = [];
  let issued = 0;

  return {
    address,
    get issued(): number { return issued; },
    get submitted(): readonly SubmittedLocalCall[] { return [...submitted]; },
    async request(request: { method: string; params?: readonly unknown[] }): Promise<unknown> {
      if (request.method === 'eth_accounts' || request.method === 'eth_requestAccounts') return [address];
      if (request.method === 'eth_chainId') return fork.read('eth_chainId');
      invariant(request.method === 'eth_sendTransaction', 'The local test wallet rejects all other signing and mutation methods.');
      invariant(request.params?.length === 1, 'The local wallet requires one exact reviewed transaction.');
      const input = record(request.params[0]);
      const accepted = reviewed();
      invariant(accepted, 'An explicit current review must exist before a test wallet request.');
      invariant(Object.keys(input).sort().join(',') === 'chainId,data,from,nonce,to,value', 'The wallet request contains unreviewed fields.');
      invariant(typeof input.from === 'string' && input.from.toLowerCase() === address && accepted.from.toLowerCase() === address,
        'A different account cannot use the disposable signer.');
      invariant(input.to === accepted.to && input.data === accepted.data && quantity(input.value) === accepted.value
        && quantity(input.nonce) === BigInt(accepted.nonce) && quantity(input.chainId) === 1n && accepted.chainId === 1,
      'The wallet request differs from the accepted transaction.');
      invariant(!consumed.has(accepted.nonce), 'The disposable wallet will not retry a consumed nonce.');
      await fork.beforeSign(address);
      const [nonce, gas, gasPrice] = await Promise.all([
        fork.read('eth_getTransactionCount', [address, 'pending']),
        fork.read('eth_estimateGas', [input, 'pending']),
        fork.read('eth_gasPrice'),
      ]);
      invariant(quantity(nonce) === BigInt(accepted.nonce), 'The local nonce changed before signing.');
      invariant(quantity(gas) > 0n && quantity(gasPrice) > 0n, 'The local wallet could not prove its gas values.');
      await fork.beforeSign(address);
      consumed.add(accepted.nonce);
      issued++;
      const signed = await account.signTransaction({ chainId: 1, type: 'legacy', nonce: accepted.nonce,
        to: accepted.to, data: accepted.data, value: accepted.value,
        gas: quantity(gas) * 12n / 10n, gasPrice: quantity(gasPrice) });
      const transactionHash = await fork.sendRaw(address, signed);
      submitted.push(Object.freeze({ call: accepted, hash: transactionHash }));
      return transactionHash;
    },
  };
}
