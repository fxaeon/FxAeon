import {
  tokens as sdkTokens,
  type AdjustPositionLeverageRequest,
  type DepositAndMintRequest,
  type FxSaveDepositRequest,
  type FxSaveWithdrawRequest,
  type GetRedeemTxRequest,
  type IncreasePositionRequest,
  type ReducePositionRequest,
  type RepayAndWithdrawRequest,
} from "@aladdindao/fx-sdk";
// Runtime token identities and request types deliberately come from the same
// exact SDK package; FxAeon does not maintain a second protocol-address list.
import { createFxSdkFacade, getFxSdk } from "./sdk";
import { normalizeRouteResult, normalizeTxResult } from "./normalize";
import { planBridge } from "./bridge";
import { assertConfiguredPublicClientChain } from "./clients";
import { validateReviewedAction } from "./actionValidation";
import { readEthLongAccounting, type EthLongAccounting } from "./ethLongAccounting";
import { readLiquidationQuote } from "./liquidationQuote";
import { capabilityPolicy, positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from "./policy";
import { FX_TOKENS } from "./tokens";
import {
  assertAddress,
  assertLeverage,
  assertPositionId,
  assertPositiveAmount,
  assertSlippage,
  toSdkTokenAddress,
} from "./validation";
import type {
  BridgePlanParams,
  FxSdkFacade,
  PlannedRoute,
  ReviewedActionIntent,
} from "./types";

function withReviewedPolicy(
  route: PlannedRoute,
  limits: {
    maxValueWei?: bigint;
    expectedTokenApprovalAmount?: bigint;
    expectedPositionApprovalId?: number;
    allowActionBoundTokenApproval?: boolean;
    reviewedAction?: ReviewedActionIntent;
    approvalDestinations?: readonly `0x${string}`[];
    tokenApprovalDestinations?: readonly `0x${string}`[];
    positionApprovalDestinations?: readonly `0x${string}`[];
  },
): PlannedRoute {
  let reviewedAction = limits.reviewedAction;
  let details = route.details;
  if (reviewedAction) {
    const actions = route.transactions.filter((transaction) => transaction.kind !== "approval");
    if (actions.length !== 1) {
      throw new Error("official SDK route must contain exactly one protocol action");
    }
    const binding = validateReviewedAction(actions[0], reviewedAction);
    reviewedAction = {
      ...reviewedAction,
      expectedEconomicLimits: (binding.economicLimits ?? []).map((limit) => limit.value),
      expectedConversionFingerprints: (binding.conversionPaths ?? []).map((path) => path.fingerprint),
      expectedActionDataFingerprint: binding.actionDataFingerprint,
    };
    details = {
      ...details,
      economicLimits: (binding.economicLimits ?? []).map((limit) => ({
        label: limit.label,
        value: limit.value.toString(),
      })),
      conversionPaths: (binding.conversionPaths ?? []).map((path) => ({
        label: path.label,
        fingerprint: path.fingerprint,
      })),
    };
  }
  return {
    ...route,
    details,
    policy: capabilityPolicy({
      walletAddress: route.walletAddress,
      chainId: route.chainId,
      operation: route.operation,
      ...limits,
      reviewedAction,
    }),
  };
}

function isNativeToken(value: string): boolean {
  return value.toLowerCase() === sdkTokens.eth.toLowerCase();
}

const ETH_POSITION_INPUT_TOKENS = [
  sdkTokens.eth,
  sdkTokens.stETH,
  sdkTokens.weth,
  sdkTokens.wstETH,
  sdkTokens.usdc,
  sdkTokens.usdt,
  sdkTokens.fxUSD,
] as const;
const ETH_SHORT_OUTPUT_TOKENS = ETH_POSITION_INPUT_TOKENS.filter(
  (token) => token.toLowerCase() !== sdkTokens.stETH.toLowerCase(),
);
const BTC_POSITION_TOKENS = [sdkTokens.WBTC, sdkTokens.usdc, sdkTokens.usdt, sdkTokens.fxUSD] as const;
const ETH_LONG_COLLATERAL_TOKENS = [sdkTokens.eth, sdkTokens.stETH, sdkTokens.weth, sdkTokens.wstETH] as const;
const BTC_LONG_COLLATERAL_TOKENS = [sdkTokens.WBTC] as const;

function assertAllowedProtocolToken(
  value: string,
  allowed: readonly string[],
  label: string,
): `0x${string}` {
  const address = assertAddress(value, label);
  if (!allowed.some((candidate) => candidate.toLowerCase() === address.toLowerCase())) {
    throw new Error(`${label} is not supported by the official SDK capability`);
  }
  return address;
}

function positionInputToken(value: string, market: "ETH" | "BTC"): `0x${string}` {
  return assertAllowedProtocolToken(
    value,
    market === "ETH" ? ETH_POSITION_INPUT_TOKENS : BTC_POSITION_TOKENS,
    "position input token",
  );
}

function positionOutputToken(value: string, market: "ETH" | "BTC", type: "long" | "short"): `0x${string}` {
  const allowed = market === "BTC"
    ? BTC_POSITION_TOKENS
    : type === "short"
      ? ETH_SHORT_OUTPUT_TOKENS
      : ETH_POSITION_INPUT_TOKENS;
  return assertAllowedProtocolToken(value, allowed, "position output token");
}

function longCollateralToken(value: string, market: "ETH" | "BTC", label: string): `0x${string}` {
  return assertAllowedProtocolToken(
    value,
    market === "ETH" ? ETH_LONG_COLLATERAL_TOKENS : BTC_LONG_COLLATERAL_TOKENS,
    label,
  );
}

function withRequestDetails(
  route: PlannedRoute,
  extra: NonNullable<PlannedRoute["details"]>,
): PlannedRoute {
  return { ...route, details: { ...route.details, ...extra } };
}

/**
 * An ETH long's quote is reviewed in the pool's stETH accounting, so its
 * planner reads the live wstETH rate (and, for an existing position, the
 * collateral it holds) alongside the SDK call. The read never rejects.
 */
function ethLongAccounting(market: unknown, type: unknown, heldPositionId?: number): Promise<EthLongAccounting> | undefined {
  return market === "ETH" && type === "long" ? readEthLongAccounting({ heldPositionId }) : undefined;
}

function assertRequestedLeverage(route: PlannedRoute, requested: number): void {
  const planned = route.details?.leverage;
  if (planned === undefined || Math.abs(planned - requested) > 1e-9) {
    throw new Error("SDK route leverage does not match the reviewed target");
  }
}

function assertSdkSlippage(route: PlannedRoute, requested: number): void {
  const echoed = route.details?.sdkSlippagePercent;
  // Older SDK route shapes may omit the root echo. When it is present, bind
  // it to the exact user input so a route cannot silently be rebuilt with a
  // different tolerance between the form and the reviewed calldata.
  if (echoed !== undefined && Math.abs(echoed - requested) > 1e-9) {
    throw new Error("SDK route slippage does not match the reviewed tolerance");
  }
}

function assertMarket(value: unknown): asserts value is "ETH" | "BTC" {
  if (value !== "ETH" && value !== "BTC") {
    throw new Error("market must be ETH or BTC");
  }
}

function assertPositionType(value: unknown): asserts value is "long" | "short" {
  if (value !== "long" && value !== "short") {
    throw new Error("position type must be long or short");
  }
}

function assertFxSaveToken(value: unknown, label: string): asserts value is "usdc" | "fxUSD" | "fxUSDBasePool" {
  if (value !== "usdc" && value !== "fxUSD" && value !== "fxUSDBasePool") {
    throw new Error(`${label} must be usdc, fxUSD, or fxUSDBasePool`);
  }
}

function assertNonNegativeAmount(value: unknown, label: string): asserts value is bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new RangeError(`${label} must be a non-negative integer amount`);
  }
}

function validateCommonPositionRequest(request: {
  market: unknown;
  type: unknown;
  userAddress: string;
  positionId: number;
  slippage: number;
  leverage?: number;
  allowNew?: boolean;
}): void {
  assertMarket(request.market);
  assertPositionType(request.type);
  assertAddress(request.userAddress, "wallet address");
  assertPositionId(request.positionId, request.allowNew ?? false);
  assertSlippage(request.slippage);
  if (request.leverage !== undefined) assertLeverage(request.leverage);
}

function validateRouteTargets(request: { targets?: readonly unknown[] }): void {
  if (request.targets && request.targets.length === 0) {
    throw new Error("explicit SDK route targets cannot be empty");
  }
  if (request.targets?.some((target) => target !== "FxRoute")) {
    throw new Error("FxAeon only permits the audited native FxRoute transaction path");
  }
}

type AuditedRouteTarget = NonNullable<IncreasePositionRequest["targets"]>[number];
const AUDITED_ROUTE_TARGETS = ["FxRoute" as AuditedRouteTarget];

function auditedTargets(
  targets: IncreasePositionRequest["targets"],
): IncreasePositionRequest["targets"] {
  validateRouteTargets({ targets });
  // Aggregator routes embed third-party converter targets inside Router
  // calldata. Restricting the official SDK to its native route keeps the
  // complete transaction authority locally auditable.
  return targets ?? [...AUDITED_ROUTE_TARGETS];
}

export function createFxService(): FxSdkFacade {
  return createFxSdkFacade();
}

export async function planIncreasePosition(request: IncreasePositionRequest): Promise<PlannedRoute[]> {
  validateCommonPositionRequest({ ...request, allowNew: true });
  assertPositiveAmount(request.amount, "position input amount");
  const inputTokenAddress = positionInputToken(request.inputTokenAddress, request.market);
  await assertConfiguredPublicClientChain(1);
  const accounting = ethLongAccounting(request.market, request.type, request.positionId);
  const liquidation = request.positionId === 0 ? readLiquidationQuote({
    market: request.market, side: request.type,
    rate: accounting?.then((details) => details.stEthPerWstEth),
  }) : undefined;
  const result = await getFxSdk().increasePosition({
    ...request,
    userAddress: assertAddress(request.userAddress, "wallet address"),
    inputTokenAddress: toSdkTokenAddress(inputTokenAddress, "position input token"),
    targets: auditedTargets(request.targets),
  });
  const accountingDetails = accounting ? await accounting : {};
  const liquidationQuote = liquidation ? await liquidation : undefined;
  return normalizeRouteResult("increasePosition", result, assertAddress(request.userAddress)).map((route) => {
    assertRequestedLeverage(route, request.leverage);
    assertSdkSlippage(route, request.slippage);
    return withRequestDetails(withReviewedPolicy(route, {
      maxValueWei: isNativeToken(inputTokenAddress) ? request.amount : 0n,
      expectedTokenApprovalAmount: request.amount,
      expectedPositionApprovalId: request.positionId,
      approvalDestinations: [
        inputTokenAddress,
        positionPoolAddress(request.market, request.type),
      ],
      tokenApprovalDestinations: [inputTokenAddress],
      positionApprovalDestinations: [positionPoolAddress(request.market, request.type)],
      reviewedAction: {
        kind: "position-increase",
        poolAddress: positionPoolAddress(request.market, request.type),
        positionId: request.positionId,
        inputTokenAddress,
        inputAmount: request.amount,
        nativeInput: isNativeToken(inputTokenAddress),
        collateralTokenAddress: positionCollateralTokenAddress(request.market, request.type),
        debtTokenAddress: positionDebtTokenAddress(request.market, request.type),
        positionType: request.type,
        requestedLeverage: request.leverage,
        slippagePercent: request.slippage,
      },
    }), {
      ...accountingDetails,
      ...(liquidationQuote === undefined ? {} : { liquidationQuote }),
      requestedAmount: request.amount.toString(),
      requestedLeverage: request.leverage,
      slippagePercent: request.slippage,
    });
  });
}

export async function planReducePosition(request: ReducePositionRequest): Promise<PlannedRoute[]> {
  validateCommonPositionRequest(request);
  assertPositiveAmount(request.amount, "position reduction amount");
  const outputTokenAddress = positionOutputToken(request.outputTokenAddress, request.market, request.type);
  await assertConfiguredPublicClientChain(1);
  const result = await getFxSdk().reducePosition({
    ...request,
    userAddress: assertAddress(request.userAddress, "wallet address"),
    outputTokenAddress: toSdkTokenAddress(outputTokenAddress, "position output token"),
    targets: auditedTargets(request.targets),
  });
  return normalizeRouteResult("reducePosition", result, assertAddress(request.userAddress)).map((route) => {
    assertSdkSlippage(route, request.slippage);
    return withRequestDetails(withReviewedPolicy(route, {
      maxValueWei: 0n,
      expectedPositionApprovalId: request.positionId,
      approvalDestinations: [positionPoolAddress(request.market, request.type)],
      tokenApprovalDestinations: [],
      positionApprovalDestinations: [positionPoolAddress(request.market, request.type)],
      reviewedAction: {
        kind: "position-reduce",
        poolAddress: positionPoolAddress(request.market, request.type),
        positionId: request.positionId,
        outputTokenAddress,
        collateralTokenAddress: positionCollateralTokenAddress(request.market, request.type),
        debtTokenAddress: positionDebtTokenAddress(request.market, request.type),
        positionType: request.type,
        isClosePosition: request.isClosePosition ?? false,
        requestedAmount: request.amount,
        slippagePercent: request.slippage,
      },
    }), {
      requestedAmount: request.amount.toString(),
      slippagePercent: request.slippage,
    });
  });
}

export async function planAdjustPositionLeverage(
  request: AdjustPositionLeverageRequest,
): Promise<PlannedRoute[]> {
  validateCommonPositionRequest(request);
  await assertConfiguredPublicClientChain(1);
  const accounting = ethLongAccounting(request.market, request.type, request.positionId);
  const result = await getFxSdk().adjustPositionLeverage({
    ...request,
    userAddress: assertAddress(request.userAddress, "wallet address"),
    targets: auditedTargets(request.targets),
  });
  const accountingDetails = accounting ? await accounting : {};
  return normalizeRouteResult("adjustPositionLeverage", result, assertAddress(request.userAddress)).map((route) => {
    assertRequestedLeverage(route, request.leverage);
    assertSdkSlippage(route, request.slippage);
    return withRequestDetails(withReviewedPolicy(route, {
      maxValueWei: 0n,
      expectedPositionApprovalId: request.positionId,
      approvalDestinations: [positionPoolAddress(request.market, request.type)],
      tokenApprovalDestinations: [],
      positionApprovalDestinations: [positionPoolAddress(request.market, request.type)],
      reviewedAction: {
        kind: "position-adjust",
        poolAddress: positionPoolAddress(request.market, request.type),
        positionId: request.positionId,
        collateralTokenAddress: positionCollateralTokenAddress(request.market, request.type),
        debtTokenAddress: positionDebtTokenAddress(request.market, request.type),
        positionType: request.type,
        requestedLeverage: request.leverage,
        slippagePercent: request.slippage,
      },
    }), {
      ...accountingDetails,
      requestedLeverage: request.leverage,
      slippagePercent: request.slippage,
    });
  });
}

export async function planDepositAndMint(request: DepositAndMintRequest): Promise<PlannedRoute> {
  assertMarket(request.market);
  validateCommonPositionRequest({
    ...request,
    type: "long",
    slippage: 1,
    allowNew: true,
  });
  assertNonNegativeAmount(request.depositAmount, "deposit amount");
  assertNonNegativeAmount(request.mintAmount, "mint amount");
  if (request.depositAmount === 0n && request.mintAmount === 0n) {
    throw new RangeError("deposit and mint cannot both be zero");
  }
  const depositTokenAddress = longCollateralToken(request.depositTokenAddress, request.market, "deposit token");
  await assertConfiguredPublicClientChain(1);
  // Its quote is already stETH; the rate states the wstETH deposit floor in stETH too.
  const accounting = ethLongAccounting(request.market, "long");
  const liquidation = request.positionId === 0 && request.mintAmount > 0n ? readLiquidationQuote({
    market: request.market, side: 'long', rate: accounting?.then(details => details.stEthPerWstEth),
  }) : undefined;
  const result = await getFxSdk().depositAndMint({
    ...request,
    userAddress: assertAddress(request.userAddress, "wallet address"),
    depositTokenAddress: toSdkTokenAddress(depositTokenAddress, "deposit token"),
  });
  const accountingDetails = accounting ? await accounting : {};
  const liquidationQuote = liquidation ? await liquidation : undefined;
  return withRequestDetails(withReviewedPolicy(
    normalizeTxResult("depositAndMint", result, assertAddress(request.userAddress)),
    {
      maxValueWei: isNativeToken(depositTokenAddress) ? request.depositAmount : 0n,
      expectedTokenApprovalAmount: request.depositAmount,
      expectedPositionApprovalId: request.positionId,
      approvalDestinations: [
        depositTokenAddress,
        positionPoolAddress(request.market, "long"),
      ],
      tokenApprovalDestinations: [depositTokenAddress],
      positionApprovalDestinations: [positionPoolAddress(request.market, "long")],
      reviewedAction: {
        kind: "deposit-and-mint",
        poolAddress: positionPoolAddress(request.market, "long"),
        positionId: request.positionId,
        depositTokenAddress,
        depositAmount: request.depositAmount,
        nativeInput: isNativeToken(depositTokenAddress),
        mintAmount: request.mintAmount,
      },
    },
  ), { ...accountingDetails, ...(liquidationQuote === undefined ? {} : { liquidationQuote }) });
}

export async function planRepayAndWithdraw(request: RepayAndWithdrawRequest): Promise<PlannedRoute> {
  assertMarket(request.market);
  assertAddress(request.userAddress, "wallet address");
  assertPositionId(request.positionId);
  assertNonNegativeAmount(request.repayAmount, "repay amount");
  assertNonNegativeAmount(request.withdrawAmount, "withdrawal amount");
  if (request.repayAmount === 0n && request.withdrawAmount === 0n) {
    throw new RangeError("repay and withdrawal cannot both be zero");
  }
  const withdrawTokenAddress = longCollateralToken(request.withdrawTokenAddress, request.market, "withdraw token");
  await assertConfiguredPublicClientChain(1);
  const result = await getFxSdk().repayAndWithdraw({
    ...request,
    userAddress: assertAddress(request.userAddress, "wallet address"),
    withdrawTokenAddress: toSdkTokenAddress(withdrawTokenAddress, "withdraw token"),
  });
  return withReviewedPolicy(
    normalizeTxResult("repayAndWithdraw", result, assertAddress(request.userAddress)),
    {
      maxValueWei: 0n,
      expectedPositionApprovalId: request.positionId,
      allowActionBoundTokenApproval: request.repayAmount > 0n,
      approvalDestinations: [
        FX_TOKENS.fxUSD.address,
        positionPoolAddress(request.market, "long"),
      ],
      tokenApprovalDestinations: [FX_TOKENS.fxUSD.address],
      positionApprovalDestinations: [positionPoolAddress(request.market, "long")],
      reviewedAction: {
        kind: "repay-and-withdraw",
        poolAddress: positionPoolAddress(request.market, "long"),
        positionId: request.positionId,
        minimumRepayAmount: request.repayAmount,
        repayTokenAddress: FX_TOKENS.fxUSD.address,
        withdrawTokenAddress,
        withdrawAmount: request.withdrawAmount,
        collateralTokenAddress: positionCollateralTokenAddress(request.market, "long"),
      },
    },
  );
}

export async function planDepositFxSave(request: FxSaveDepositRequest): Promise<PlannedRoute> {
  assertFxSaveToken(request.tokenIn, "fxSAVE deposit token");
  assertAddress(request.userAddress, "wallet address");
  assertPositiveAmount(request.amount, "fxSAVE deposit amount");
  if (request.slippage !== undefined) assertSlippage(request.slippage);
  await assertConfiguredPublicClientChain(1);
  const result = await getFxSdk().depositFxSave({
    ...request,
    userAddress: assertAddress(request.userAddress, "wallet address"),
  });
  return withReviewedPolicy(
    normalizeTxResult("depositFxSave", result, assertAddress(request.userAddress)),
    {
      maxValueWei: 0n,
      expectedTokenApprovalAmount: request.amount,
      approvalDestinations: [FX_TOKENS[request.tokenIn === "usdc" ? "USDC" : request.tokenIn].address],
      tokenApprovalDestinations: [FX_TOKENS[request.tokenIn === "usdc" ? "USDC" : request.tokenIn].address],
      positionApprovalDestinations: [],
      reviewedAction: {
        kind: "fxsave-deposit",
        tokenInAddress: FX_TOKENS[request.tokenIn === "usdc" ? "USDC" : request.tokenIn].address,
        amount: request.amount,
        receiver: assertAddress(request.userAddress, "wallet address"),
        directBasePool: request.tokenIn === "fxUSDBasePool",
        // SDK 1.0.5 does not apply the requested deposit slippage. Keep the
        // decoded base-pool floor; do not present an unsupported tolerance.
      },
    },
  );
}

export async function planWithdrawFxSave(request: FxSaveWithdrawRequest): Promise<PlannedRoute> {
  assertFxSaveToken(request.tokenOut, "fxSAVE withdrawal token");
  assertAddress(request.userAddress, "wallet address");
  assertPositiveAmount(request.amount, "fxSAVE withdrawal amount");
  if (request.tokenOut === "fxUSDBasePool" && request.instant) {
    throw new Error("fxUSDBasePool withdrawals cannot use instant redemption");
  }
  if (request.instant) {
    if (request.slippage === undefined) throw new Error("instant fxSAVE withdrawal requires slippage");
    assertSlippage(request.slippage);
  }
  await assertConfiguredPublicClientChain(1);
  const result = await getFxSdk().withdrawFxSave({
    ...request,
    userAddress: assertAddress(request.userAddress, "wallet address"),
  });
  return withReviewedPolicy(
    normalizeTxResult("withdrawFxSave", result, assertAddress(request.userAddress)),
    {
      maxValueWei: 0n,
      expectedTokenApprovalAmount: request.amount,
      approvalDestinations: [FX_TOKENS.fxSAVE.address],
      tokenApprovalDestinations: [FX_TOKENS.fxSAVE.address],
      positionApprovalDestinations: [],
      reviewedAction: {
        kind: "fxsave-withdraw",
        tokenOutAddress: FX_TOKENS[request.tokenOut === "usdc" ? "USDC" : request.tokenOut].address,
        amount: request.amount,
        receiver: assertAddress(request.userAddress, "wallet address"),
        instant: request.instant ?? false,
        directBasePool: request.tokenOut === "fxUSDBasePool",
        slippagePercent: request.slippage,
      },
    },
  );
}

export async function planRedeem(request: GetRedeemTxRequest): Promise<PlannedRoute> {
  const walletAddress = assertAddress(request.userAddress, "wallet address");
  const receiver = request.receiver
    ? assertAddress(request.receiver, "redeem receiver")
    : walletAddress;
  await assertConfiguredPublicClientChain(1);
  const result = await getFxSdk().getRedeemTx({
    ...request,
    userAddress: walletAddress,
    receiver: request.receiver ? assertAddress(request.receiver, "redeem receiver") : undefined,
  });
  return withReviewedPolicy(
    normalizeTxResult("getRedeemTx", result, walletAddress),
    {
      maxValueWei: 0n,
      reviewedAction: { kind: "fxsave-claim", receiver },
    },
  );
}

export async function planBridgeRoute(params: BridgePlanParams): Promise<PlannedRoute> {
  return planBridge(params);
}
