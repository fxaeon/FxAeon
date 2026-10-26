import { parseAbi, type Address } from 'viem';
import { planBridge, resolveBridgeTokenAddress, getBridgeApprovalAllowance, resolveBridgeApprovalTokenAddress } from './bridge';
import { getPublicClient, assertPublicClientChain } from './clients';
import { validateBridgeRoute } from './validation';
import { withReadDeadline } from './readFacade';
import { estimatePlannedRouteCost, networkFeeWei } from './gasCost';
import type { FxChainId, PlannedRoute, BridgeRouteQuote } from './types';

// LayerZero IOFT.quoteOFT returns the debit/credit amounts for these exact send
// parameters. A messaging-fee quote alone cannot establish the amount received.
export const OFT_RECEIPT_QUOTE_ABI = parseAbi([
  'function quoteOFT((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam) view returns ((uint256 minAmountLD, uint256 maxAmountLD) limit, (int256 feeAmountLD, string description)[] fees, (uint256 amountSentLD, uint256 amountReceivedLD) receipt)',
]);
export const BRIDGE_PREVIEW_TTL = 30_000;
export type BridgePreview = {
  readAt: number;
  nativeFee: bigint;
  minimumReceived: bigint;
  estimatedReceived?: bigint;
  nativeBalance?: bigint;
  sourceGas?: bigint;
};

/** Read-only, exact-route receipt estimate. Never substitutes for simulation. */
export async function readBridgeReceiptEstimate(route: PlannedRoute): Promise<bigint | undefined> {
  validateBridgeRoute(route);
  const quote = route.quote as BridgeRouteQuote;
  const receipt = await withReadDeadline(getPublicClient(route.chainId).readContract({
    address: quote.sourceOftAddress,
    abi: OFT_RECEIPT_QUOTE_ABI,
    functionName: 'quoteOFT',
    args: [{ dstEid: quote.destinationEid, to: quote.recipientBytes32, amountLD: quote.amountLD,
      minAmountLD: quote.minAmountLD, extraOptions: quote.extraOptions, composeMsg: quote.composeMsg, oftCmd: quote.oftCmd }],
  })).catch(() => undefined);
  const received = receipt?.[2]?.amountReceivedLD;
  return typeof received === 'bigint' && received >= quote.minAmountLD && received <= quote.amountLD
    ? received : undefined;
}

/** Informational canonical preview only. Review always plans and validates anew. */
export async function fetchBridgePreview(params: {
  sourceChainId: FxChainId; destinationChainId: FxChainId; token: 'fxUSD' | 'fxSAVE';
  amount: bigint; wallet: Address; recipient: Address;
}, onUpdate?: (preview: BridgePreview) => void): Promise<BridgePreview> {
  const readAt = Date.now();
  const source = getPublicClient(params.sourceChainId);
  const destination = getPublicClient(params.destinationChainId);
  await withReadDeadline(Promise.all([assertPublicClientChain(source, params.sourceChainId), assertPublicClientChain(destination, params.destinationChainId)]));
  const [baseline, nativeBalance] = await withReadDeadline(Promise.all([
    destination.getBlockNumber(), source.getBalance({ address: params.wallet }).catch(() => undefined),
  ]));
  const route = await withReadDeadline(planBridge({
    sourceChainId: params.sourceChainId, destChainId: params.destinationChainId, token: params.token,
    amount: params.amount, walletAddress: params.wallet, recipient: params.recipient, refundAddress: params.wallet,
    includeApproval: false, destinationOftAddress: resolveBridgeTokenAddress(params.token, params.destinationChainId),
    destinationBaselineBlock: baseline,
  }));
  validateBridgeRoute(route);
  const action = route.transactions[0];
  const gas = async () => {
    // A missing token approval makes a standalone gas estimate incomplete.
    if (params.sourceChainId === 1) {
      const allowance = await getBridgeApprovalAllowance({ client: source, tokenAddress: resolveBridgeApprovalTokenAddress(params.token, 1), owner: params.wallet, spender: action.to });
      if (allowance < params.amount) return undefined;
    }
    const cost = await estimatePlannedRouteCost(route, { client: source, ttlMs: BRIDGE_PREVIEW_TTL });
    return cost.status === 'current' && cost.validUntil > Date.now() ? networkFeeWei(cost) : undefined;
  };
  const sourceGas = withReadDeadline(gas()).catch(() => undefined);
  const estimatedReceived = await readBridgeReceiptEstimate(route);
  const preview = { readAt, nativeFee: route.quote.nativeFee, minimumReceived: route.quote.minAmountLD, estimatedReceived, nativeBalance };
  // Gas is optional context. It must neither delay verified receipt amounts
  // nor renew the exact route's original freshness window.
  void sourceGas.then(value => {
    if (value !== undefined && isFreshBridgePreview(preview)) onUpdate?.({ ...preview, sourceGas: value });
  }).catch(() => undefined);
  return preview;
}

export function isFreshBridgePreview(preview: BridgePreview | undefined, now = Date.now()): preview is BridgePreview {
  return Boolean(preview && preview.readAt <= now && now - preview.readAt < BRIDGE_PREVIEW_TTL);
}
