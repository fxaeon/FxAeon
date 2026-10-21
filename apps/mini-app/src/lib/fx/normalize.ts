import {
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import type { FxChainId, OfficialFxMethod, PlannedRoute, PlannedTransaction, RouteDetails } from "./types";
import { normalizePositionEconomics } from "./positionEconomics";

export interface RawSdkTransaction {
  from?: string;
  to: string;
  data: string;
  value?: bigint | number | string;
  nonce?: number;
  chainId?: number;
  type?: string;
}

function normalizeAddress(value: string, label: string): Address {
  if (!isAddress(value)) throw new Error(`${label} is not a valid address`);
  return getAddress(value);
}

function normalizeData(value: string): Hex {
  if (!/^0x[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
    throw new Error("SDK returned malformed transaction calldata");
  }
  return value as Hex;
}

function normalizeValue(value: RawSdkTransaction["value"]): bigint {
  if (value === undefined) return 0n;
  if (typeof value !== "bigint" && typeof value !== "number" && typeof value !== "string") {
    throw new Error("SDK returned malformed transaction value");
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error("SDK returned malformed transaction value");
  }
  if (typeof value === "string" && !(/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value))) {
    throw new Error("SDK returned malformed transaction value");
  }
  let normalized: bigint;
  try {
    normalized = typeof value === "bigint" ? value : BigInt(value);
  } catch {
    throw new Error("SDK returned malformed transaction value");
  }
  if (normalized < 0n) throw new Error("SDK returned a negative transaction value");
  return normalized;
}

function normalizeNonce(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("SDK returned an invalid transaction nonce");
  }
  return value;
}

function inferTransactionKind(type: string | undefined, data: Hex): PlannedTransaction["kind"] {
  if (type && /approve/i.test(type)) return "approval";
  // ERC-20 approve(address,uint256). Keep this inference conservative: other
  // protocol actions may contain arbitrary bytes that happen to match a word.
  if (data.slice(0, 10).toLowerCase() === "0x095ea7b3") return "approval";
  if (type) return "action";
  return "unknown";
}

/** Normalize and bind an SDK transaction to the selected Privy wallet. */
export function normalizeSdkTransaction(
  raw: RawSdkTransaction,
  params: {
    operation: OfficialFxMethod;
    chainId: FxChainId;
    walletAddress: Address;
    kind?: PlannedTransaction["kind"];
  },
): PlannedTransaction {
  const from = normalizeAddress(raw.from ?? params.walletAddress, "SDK transaction sender");
  const wallet = normalizeAddress(params.walletAddress, "wallet address");
  if (from.toLowerCase() !== wallet.toLowerCase()) {
    throw new Error("SDK transaction sender does not match the connected wallet");
  }
  if (raw.chainId !== undefined && raw.chainId !== params.chainId) {
    throw new Error(
      `SDK transaction chain ${raw.chainId} does not match expected chain ${params.chainId}`,
    );
  }
  return {
    chainId: params.chainId,
    from,
    to: normalizeAddress(raw.to, "SDK transaction destination"),
    data: normalizeData(raw.data),
    value: normalizeValue(raw.value),
    nonce: normalizeNonce(raw.nonce),
    type: raw.type,
    kind: params.kind ?? inferTransactionKind(raw.type, normalizeData(raw.data)),
    operation: params.operation,
  };
}

export function normalizeSdkTransactions(
  raw: readonly RawSdkTransaction[],
  params: {
    operation: OfficialFxMethod;
    chainId: FxChainId;
    walletAddress: Address;
  },
): PlannedTransaction[] {
  if (raw.length === 0) throw new Error("SDK returned an empty transaction route");
  return raw.map((tx) => normalizeSdkTransaction(tx, params));
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("SDK returned malformed route data");
  return value as Record<string, unknown>;
}

function numberField(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`SDK returned invalid ${label}`);
  }
  return value;
}

function stringField(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`SDK returned invalid ${label}`);
  return value;
}

function protocolFeeQuote(value: unknown): RouteDetails['protocolFeeQuote'] {
  if (!value || typeof value !== 'object') return undefined;
  const quote = value as Record<string, unknown>;
  if (typeof quote.poolAddress !== 'string' || !isAddress(quote.poolAddress)
    || typeof quote.routerAddress !== 'string' || !isAddress(quote.routerAddress)
    || !Array.isArray(quote.ratios) || quote.ratios.length !== 4
    || quote.ratios.some((ratio) => typeof ratio !== 'string' || !/^\d{1,10}$/.test(ratio) || BigInt(ratio) > 1_000_000_000n)) return undefined;
  return {
    poolAddress: getAddress(quote.poolAddress),
    routerAddress: getAddress(quote.routerAddress),
    ratios: [...quote.ratios] as [string, string, string, string],
  };
}

function fxSaveQuote(value: unknown): RouteDetails['fxSaveQuote'] {
  if (!value || typeof value !== 'object') return undefined;
  const quote = value as Record<string, unknown>;
  if (!['deposit', 'direct-withdraw', 'instant-withdraw'].includes(String(quote.kind))
    || typeof quote.tokenAddress !== 'string' || !isAddress(quote.tokenAddress)
    || typeof quote.actionTo !== 'string' || !isAddress(quote.actionTo)
    || typeof quote.actionData !== 'string' || !/^0x(?:[a-f0-9]{2})+$/i.test(quote.actionData)
    || !Number.isSafeInteger(quote.readAt) || Number(quote.readAt) <= 0) return undefined;
  const fields = ['inputAmount', 'estimatedOutput', 'instantFeeRatio', 'grossFxUSD', 'grossUSDC', 'netFxUSD', 'netUSDC'] as const;
  const amounts: Record<string, string> = {};
  for (const field of fields) {
    if (quote[field] === undefined && field !== 'inputAmount') continue;
    const raw = quote[field];
    if (typeof raw !== 'string' || !/^\d{1,78}$/.test(raw) || BigInt(raw) >= 1n << 256n) return undefined;
    amounts[field] = raw;
  }
  return { ...amounts, inputAmount: amounts.inputAmount,
    kind: quote.kind as NonNullable<RouteDetails['fxSaveQuote']>['kind'],
    tokenAddress: getAddress(quote.tokenAddress), actionTo: getAddress(quote.actionTo),
    actionData: quote.actionData as Hex, readAt: Number(quote.readAt) };
}

/** Normalize increase/reduce/adjust route results without reimplementing SDK logic. */
export function normalizeRouteResult(
  operation: "increasePosition" | "reducePosition" | "adjustPositionLeverage",
  result: unknown,
  walletAddress: Address,
): PlannedRoute[] {
  const root = record(result);
  if (!Array.isArray(root.routes) || root.routes.length === 0) {
    throw new Error(`SDK returned no routes for ${operation}`);
  }
  return root.routes.map((rawRoute) => {
    const route = record(rawRoute);
    if (!Array.isArray(route.txs)) throw new Error(`SDK returned malformed ${operation} route`);
    const txs = normalizeSdkTransactions(route.txs as RawSdkTransaction[], {
      operation,
      chainId: 1,
      walletAddress,
    });
    const details = {
      protocolFeeQuote: protocolFeeQuote(root.protocolFeeQuote),
      routeType: stringField(route.routeType, "route type"),
      positionId: numberField(root.positionId, "position ID"),
      leverage: numberField(route.leverage, "leverage"),
      positionEconomics: normalizePositionEconomics(route.positionEconomics),
      executionPrice: stringField(route.executionPrice, "execution price"),
      minOut: stringField(route.minOut, "minimum output"),
      colls: stringField(route.colls, "collateral quote"),
      debts: stringField(route.debts, "debt quote"),
      sdkSlippagePercent: numberField(root.slippage, "slippage"),
    };
    return {
      operation,
      chainId: 1,
      walletAddress,
      transactions: txs,
      details,
    };
  });
}

/** Normalize deposit/repay/fxSAVE/getRedeemTx transaction arrays. */
export function normalizeTxResult(
  operation:
    | "depositAndMint"
    | "repayAndWithdraw"
    | "getRedeemTx"
    | "depositFxSave"
    | "withdrawFxSave",
  result: unknown,
  walletAddress: Address,
): PlannedRoute {
  const root = record(result);
  if (!Array.isArray(root.txs)) throw new Error(`SDK returned no transactions for ${operation}`);
  return {
    operation,
    chainId: 1,
    walletAddress,
    transactions: normalizeSdkTransactions(root.txs as RawSdkTransaction[], {
      operation,
      chainId: 1,
      walletAddress,
    }),
    details: {
      protocolFeeQuote: protocolFeeQuote(root.protocolFeeQuote),
      fxSaveQuote: fxSaveQuote(root.fxSaveQuote),
      positionId: numberField(root.positionId, "position ID"),
      leverage: numberField(root.leverage, "leverage"),
      executionPrice: stringField(root.executionPrice, "execution price"),
      colls: stringField(root.colls, "collateral quote"),
      debts: stringField(root.debts, "debt quote"),
    },
  };
}
