import { FX_TOKENS } from './fx/tokens';
import { assertConfiguredPublicClientChain, getPublicClient } from './fx/clients';
import { withReadDeadline } from './fx/readFacade';

const PREVIEW_DEPOSIT = [{
  type: 'function', name: 'previewDeposit', stateMutability: 'view',
  inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: 'shares', type: 'uint256' }],
}] as const;
const PREVIEW_SAVE_DEPOSIT = [{
  type: 'function', name: 'previewDeposit', stateMutability: 'view',
  inputs: [{ name: 'assets', type: 'uint256' }],
  outputs: [{ name: 'shares', type: 'uint256' }],
}] as const;

/** The two public previews used by the pinned SDK deposit planner. This value
 * is display-only: no account, allowance, nonce, route, or calldata is read. */
export async function quotePublicFxSaveDeposit(token: 'fxUSD' | 'usdc', amount: bigint): Promise<bigint> {
  if (amount <= 0n) throw new Error('Deposit amount must be positive');
  return withReadDeadline((async () => {
    await assertConfiguredPublicClientChain(1);
    const client = getPublicClient(1);
    const baseShares = await client.readContract({
      address: FX_TOKENS.fxUSDBasePool.address,
      abi: PREVIEW_DEPOSIT,
      functionName: 'previewDeposit',
      args: [token === 'usdc' ? FX_TOKENS.USDC.address : FX_TOKENS.fxUSD.address, amount],
    });
    if (baseShares <= 0n) return 0n;
    return client.readContract({
      address: FX_TOKENS.fxSAVE.address,
      abi: PREVIEW_SAVE_DEPOSIT,
      functionName: 'previewDeposit',
      args: [baseShares],
    });
  })());
}

/** A late RPC response must never repopulate a cleared or edited estimate. */
export function createEarnEstimateGuard() {
  let generation = 0;
  return {
    next: () => ++generation,
    current: (request: number) => request === generation,
    invalidate: () => { generation += 1; },
  };
}
