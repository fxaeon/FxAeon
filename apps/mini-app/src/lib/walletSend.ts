import { decodeFunctionResult, encodeFunctionData, erc20Abi, formatUnits, getAddress, isAddress, parseUnits, zeroAddress, type Address, type Hex, type PublicClient } from 'viem';
import { canonicalAsset } from './walletAssets';
import { assertPublicClientChain, getPublicClient } from './fx/clients';
import { fetchGasTierQuotes, selectedGasTierQuote, type GasTierQuotes } from './fx/gasFeePolicy';
import { gasLimitWithHeadroom } from './fx/gasLimit';
import { calculateVerifiedNativeMax, type NativeMaxEstimate, type VerifiedNativeMax } from './fx/nativeMax';
import type { GasTier } from './settings';
import type { FxChainId, FxPublicClient } from './fx/types';

export type SendInput = { walletAddress: Address; chainId: FxChainId; recipient: Address; tokenAddress: Address | null; amount: string; tier: GasTier };
export type SendQuote = { input: SendInput; symbol: string; decimals: number; amountRaw: bigint; to: Address; data: Hex; value: bigint;
  gas: bigint; nonce: number; estimatedFee: bigint; requiredNative: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; validUntil: number };

/** Exact recipient and amount are estimated, including contract recipients
 * and Base's extra fees. This only fills the draft; review re-quotes it. */
export function prepareWalletSendMax(
  input: Omit<SendInput, 'amount'>,
  balanceWei: bigint,
  options: Parameters<typeof prepareWalletSend>[1] = {},
): Promise<VerifiedNativeMax> {
  if (input.tokenAddress) throw new Error('Native Max requires a native asset');
  return calculateVerifiedNativeMax({
    balanceWei,
    buildRoutes: async (amountWei) => [await prepareWalletSend({ ...input, amount: formatUnits(amountWei, 18) }, options)],
    estimateRoutes: async (quotes) => quotes.map((quote): NativeMaxEstimate => ({
      status: 'current', nativeValueWei: quote.value,
      totalNativeCostWei: quote.value + quote.estimatedFee,
      requiredNativeCostWei: quote.requiredNative,
      totalNativeCostScope: input.chainId === 8453 ? 'execution-plus-l1-plus-operator-plus-value' : 'execution-plus-value',
      validUntil: quote.validUntil,
    })),
  });
}

export function transferPayload(input: SendInput) {
  if (![1, 8453].includes(input.chainId) || !isAddress(input.walletAddress) || !isAddress(input.recipient) || input.recipient.toLowerCase() === zeroAddress) throw new Error('Enter a valid recipient address.');
  const token = canonicalAsset(input.chainId, input.tokenAddress);
  if (!token) throw new Error('This token is not supported on this network.');
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.amount) || (input.amount.split('.')[1]?.length ?? 0) > token.decimals) throw new Error('Enter a valid amount.');
  const amountRaw = parseUnits(input.amount, token.decimals);
  if (amountRaw <= 0n || amountRaw >= 2n ** 256n) throw new Error('Enter an amount greater than zero.');
  const recipient = getAddress(input.recipient);
  return { symbol: token.key, decimals: token.decimals, amountRaw,
    to: input.tokenAddress ?? recipient,
    value: input.tokenAddress ? 0n : amountRaw,
    data: input.tokenAddress ? encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient, amountRaw] }) : '0x' as Hex };
}

/** Standard wallet transfer, deliberately independent of the protocol SDK's route policy. */
export async function prepareWalletSend(input: SendInput, options: { client?: FxPublicClient & Pick<PublicClient, 'call'>; fetchFees?: (chainId: FxChainId) => Promise<GasTierQuotes> } = {}): Promise<SendQuote> {
  const payload = transferPayload(input);
  const client = options.client ?? getPublicClient(input.chainId) as FxPublicClient & Pick<PublicClient, 'call'>;
  await assertPublicClientChain(client, input.chainId);
  const [nativeBalance, tokenBalance, tiers, nonce] = await Promise.all([
    client.getBalance({ address: input.walletAddress, blockTag: 'pending' }),
    input.tokenAddress ? client.readContract({ address: input.tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [input.walletAddress] }) : Promise.resolve(null),
    (options.fetchFees ?? fetchGasTierQuotes)(input.chainId), client.getTransactionCount({ address: input.walletAddress, blockTag: 'pending' }),
  ]);
  if ((tokenBalance ?? nativeBalance) < payload.amountRaw) throw new Error('Insufficient funds.');
  if (input.tokenAddress) {
    const simulated = await client.call({ account: input.walletAddress, to: payload.to, data: payload.data, value: 0n });
    // USDT has no return data; standard ERC-20s must not return false.
    if (simulated.data && simulated.data !== '0x' && !decodeFunctionResult({ abi: erc20Abi, functionName: 'transfer', data: simulated.data })) throw new Error('The token rejected this transfer.');
  }
  if (!client.estimateGas) throw new Error('Network cost is unavailable. Try again.');
  const fee = selectedGasTierQuote(tiers, input.tier);
  if (tiers.chainId !== input.chainId || !Number.isSafeInteger(nonce) || nonce < 0) throw new Error('Network response could not be verified.');
  const tx = { account: input.walletAddress, to: payload.to, data: payload.data, value: payload.value };
  const estimate = await client.estimateGas(tx);
  const gas = gasLimitWithHeadroom(estimate);
  let extra = 0n;
  if (input.chainId === 8453) {
    if (!client.estimateL1Fee || !client.estimateOperatorFee) throw new Error('Base network cost is unavailable. Try again.');
    const [l1, operator] = await Promise.all([client.estimateL1Fee({ ...tx, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas }), client.estimateOperatorFee({ ...tx, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas })]);
    if (l1 < 0n || operator < 0n) throw new Error('Base network cost is unavailable.');
    extra = l1 + operator;
  }
  const requiredNative = payload.value + gas * fee.maxFeePerGas + (extra * 120n + 99n) / 100n;
  if (nativeBalance < requiredNative) throw new Error('Not enough ETH for the amount and network cost.');
  return { input: { ...input }, ...payload, gas, nonce, estimatedFee: estimate * fee.gasPriceWei + extra, requiredNative,
    maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas, validUntil: tiers.validUntil };
}
